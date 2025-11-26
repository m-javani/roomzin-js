import { RzError } from "../err";
import { NodeAddr } from "../../types/discovery";

export interface DiscoveryMap {
    resolve(nodeId: string): { host: string; tcpPort: number; apiPort: number } | null;
}

export interface NodeInfo {
    node_id: string;
    zone_id: string;
    shard_id: string;
    leader_id: string;
}

export class ClusterError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ClusterError';
    }
}

export const ErrNoLeaderAvailable = new ClusterError('no leader found in cluster');

function parseNodeIds(s: string): string[] {
    return s
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id !== '');
}

async function httpGet<T = any>(
    host: string,
    port: number,
    path: string,
    authToken: string,
    timeoutMs: number
): Promise<T> {
    const url = `http://${host}:${port}${path}`;
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const headers: Record<string, string> = {};
        if (authToken) {
            headers['Authorization'] = `Bearer ${authToken}`;
        }

        const res = await fetch(url, {
            method: 'GET',
            headers,
            signal: controller.signal,
        });

        if (!res.ok) {
            throw new ClusterError(`http ${res.status}`);
        }

        return (await res.json()) as T;
    } finally {
        clearTimeout(tid);
    }
}

export async function getNodeInfo(
    host: string,
    port: number,
    authToken: string,
    timeoutMs: number
): Promise<NodeInfo> {
    return httpGet<NodeInfo>(host, port, '/node-info', authToken, timeoutMs);
}

export async function healthCheck(
    host: string,
    port: number,
    authToken: string,
    timeoutMs: number
): Promise<string> {
    const url = `http://${host}:${port}/healthz`;
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const headers: Record<string, string> = {};
        if (authToken) {
            headers['Authorization'] = `Bearer ${authToken}`;
        }

        const res = await fetch(url, {
            method: 'GET',
            headers,
            signal: controller.signal,
        });

        if (!res.ok) {
            throw new ClusterError(`healthz ${res.status}`);
        }

        const text = await res.text();
        return text.trim();
    } finally {
        clearTimeout(tid);
    }
}

async function getPeers(
    host: string,
    port: number,
    authToken: string,
    timeoutMs: number
): Promise<string[]> {
    try {
        return await httpGet<string[]>(host, port, '/peers', authToken, timeoutMs);
    } catch {
        return [];
    }
}

interface NodeInfoInternal {
    nodeID: string;
    host: string;
    tcpPort: number;
    apiPort: number;
    health: string;
    leaderID: string;
}

export async function getClusterInfo(
    seedNodeIds: string,
    authToken: string,
    apiPort: number,
    httpTimeout: number,
    dmap: DiscoveryMap
): Promise<{ leader: NodeAddr; followers: NodeAddr[] }> {
    const nodeIDs = parseNodeIds(seedNodeIds);
    if (nodeIDs.length === 0) {
        throw new Error('no seed node IDs provided');
    }

    const nodes = new Map<string, NodeInfoInternal>(); // keyed by host
    const existing = new Set(nodeIDs);
    const discovered = new Set<string>();

    // First phase: seed nodes
    const firstPhasePromises = nodeIDs.map(async (nodeID) => {
        const resolved = dmap.resolve(nodeID);
        if (!resolved) return;

        const { host, tcpPort, apiPort: nodeApiPort } = resolved;

        try {
            const health = await healthCheck(host, nodeApiPort, authToken, httpTimeout);
            if (health === 'unavailable') return;

            const info = await getNodeInfo(host, nodeApiPort, authToken, httpTimeout);

            nodes.set(host, {
                nodeID,
                host,
                tcpPort,
                apiPort: nodeApiPort,
                health,
                leaderID: info.leader_id,
            });
        } catch {
            // ignore
        }

        // Discover peers
        try {
            const peers = await getPeers(host, nodeApiPort, authToken, httpTimeout);
            for (const peerID of peers) {
                if (!existing.has(peerID)) {
                    discovered.add(peerID);
                }
            }
        } catch {
            // ignore peer discovery failures
        }
    });

    await Promise.all(firstPhasePromises);

    // Second phase: discovered nodes
    if (discovered.size > 0) {
        const secondPhasePromises = Array.from(discovered).map(async (nodeID) => {
            const resolved = dmap.resolve(nodeID);
            if (!resolved) return;

            const { host, tcpPort, apiPort: nodeApiPort } = resolved;

            try {
                const health = await healthCheck(host, nodeApiPort, authToken, httpTimeout);
                if (health === 'unavailable') return;

                const info = await getNodeInfo(host, nodeApiPort, authToken, httpTimeout);

                nodes.set(host, {
                    nodeID,
                    host,
                    tcpPort,
                    apiPort: nodeApiPort,
                    health,
                    leaderID: info.leader_id,
                });
            } catch {
                // ignore dead nodes
            }
        });

        await Promise.all(secondPhasePromises);
    }

    // Leader election: count votes
    const votes = new Map<string, number>();
    for (const node of nodes.values()) {
        if (node.leaderID) {
            votes.set(node.leaderID, (votes.get(node.leaderID) || 0) + 1);
        }
    }

    if (votes.size === 0) {
        throw RzError(ErrNoLeaderAvailable);
    }

    let leaderID = '';
    let maxVotes = 0;
    for (const [id, count] of votes.entries()) {
        if (count > maxVotes) {
            maxVotes = count;
            leaderID = id;
        }
    }

    let leader: NodeAddr | null = null;
    const followers: NodeAddr[] = [];

    for (const node of nodes.values()) {
        if (node.leaderID === leaderID) {
            const addr: NodeAddr = {
                node_id: node.nodeID,
                addr: node.host,
                tcp_port: node.tcpPort,
                api_port: node.apiPort,
            };

            if (node.health === 'active_leader') {
                leader = addr;
            } else if (node.health === 'active_follower') {
                followers.push(addr);
            }
        }
    }

    if (!leader) {
        throw RzError(ErrNoLeaderAvailable);
    }

    return { leader, followers };
}