import net from 'net';
import { EventEmitter } from 'events';
import { RawResult, Field } from '../protocol/types';
import { parseFields, prependHeader } from '../protocol/frame';
import { buildLoginPayload } from '../protocol/login';
import { ClusterError, getClusterInfo, DiscoveryMap as IDiscoveryMap } from './httputil';
import { readFull } from '../protocol/frame';
import { RzError } from '../err';
import { NodeAddr } from '../../types/discovery';

const MAGIC = 0xFF;
const HEADER_SIZE = 9;
const MAX_BUFFER = 2 * 1024 * 1024;
const QUEUE_CAPACITY = 1024;

// ========================================================
//   DiscoveryMap - thread-safe map for node ID -> address
// ========================================================
export class DiscoveryMap implements IDiscoveryMap {
    private data: Map<string, { host: string; tcpPort: number; apiPort: number }> = new Map();

    resolve(nodeId: string): { host: string; tcpPort: number; apiPort: number } | null {
        const entry = this.data.get(nodeId);
        if (!entry) return null;
        return { ...entry };
    }

    update(nodes: NodeAddr[], defaultTcpPort: number, defaultApiPort: number): void {
        const newData = new Map<string, { host: string; tcpPort: number; apiPort: number }>();
        for (const n of nodes) {
            const tcpPort = n.tcp_port ?? defaultTcpPort;
            const apiPort = n.api_port ?? defaultApiPort;
            newData.set(n.node_id, {
                host: n.addr,
                tcpPort,
                apiPort,
            });
        }
        this.data = newData;
    }

    setStatic(nodes: NodeAddr[], defaultTcpPort: number, defaultApiPort: number): void {
        const data = new Map<string, { host: string; tcpPort: number; apiPort: number }>();
        for (const n of nodes) {
            const tcpPort = n.tcp_port ?? defaultTcpPort;
            const apiPort = n.api_port ?? defaultApiPort;
            data.set(n.node_id, {
                host: n.addr,
                tcpPort,
                apiPort,
            });
        }
        this.data = data;
    }
}

// ========================================================
//   buildDiscoveryMap - creates map based on config
// ========================================================
function buildDiscoveryMap(cfg: HandlerConfig): DiscoveryMap {
    const dm = new DiscoveryMap();

    if (cfg.DiscoveryAddr) {
        // HTTP mode: start empty, populated later by background task
        return dm;
    }

    // Static mode
    if (!cfg.StaticDiscovery || cfg.StaticDiscovery.length === 0) {
        throw RzError('static discovery enabled but StaticDiscovery is empty');
    }

    dm.setStatic(cfg.StaticDiscovery, cfg.TCPPort, cfg.APIPort);
    return dm;
}

// ========================================================
//   Channel (unchanged)
// ========================================================
class Channel<T> extends EventEmitter {
    private buffer: T[] = [];
    private resolvers: ((value: T) => void)[] = [];
    private closed = false;

    constructor(private capacity = Infinity) {
        super();
    }

    async send(value: T): Promise<void> {
        if (this.closed) throw RzError('channel closed');

        if (this.resolvers.length > 0) {
            this.resolvers.shift()!(value);
            return;
        }

        if (this.buffer.length < this.capacity) {
            this.buffer.push(value);
            return;
        }

        await new Promise<void>(resolve => this.resolvers.push(resolve as any));
        this.buffer.push(value);
    }

    async receive(): Promise<T> {
        if (this.buffer.length > 0) return this.buffer.shift()!;
        if (this.closed) throw RzError('channel closed');
        return new Promise<T>(resolve => {
            this.resolvers.push(resolve);
        });
    }

    close() {
        this.closed = true;
        this.resolvers.forEach(r => r(undefined as any));
        this.resolvers = [];
    }

    [Symbol.asyncIterator](): AsyncIterator<T> {
        return {
            next: () => this.receive().then(value => ({ value, done: false })),
        };
    }
}

// ========================================================
//   DemuxMap (unchanged)
// ========================================================
interface Pending {
    resolve: (res: RawResult) => void;
    reject: (err: Error) => void;
    sentAt: number;
    timer: NodeJS.Timeout;
    resolved?: boolean;
}

class DemuxMap {
    private map = new Map<number, Pending>();
    private timer: NodeJS.Timeout;
    private maxAgeMs: number;

    constructor(maxAgeMs: number) {
        this.maxAgeMs = maxAgeMs;
        this.timer = setInterval(() => this.cleanup(), maxAgeMs / 2).unref();
    }

    store(id: number, p: Pending) {
        this.map.set(id, p);
    }

    loadRemove(id: number): [Pending | undefined, boolean] {
        const p = this.map.get(id);
        if (p) {
            this.map.delete(id);
        }
        return [p, !!p];
    }

    private cleanup() {
        const threshold = Date.now() - this.maxAgeMs;
        for (const [id, p] of this.map) {
            if (!p.resolved && p.sentAt < threshold) {
                clearTimeout(p.timer);
                p.reject(new Error('request timeout'));
                p.resolved = true;
                this.map.delete(id);
            }
        }
    }

    destroy() {
        clearInterval(this.timer);
        for (const p of this.map.values()) {
            if (!p.resolved) {
                clearTimeout(p.timer);
                p.reject(new Error('handler closed'));
                p.resolved = true;
            }
        }
        this.map.clear();
    }
}

// ========================================================
//   Request
// ========================================================
interface Request {
    payload: Buffer;
    resolve: (r: RawResult) => void;
    reject: (e: Error) => void;
    isWrite: boolean;
}

// ========================================================
//   Connection
// ========================================================
class Connection extends EventEmitter {
    public closed = false;
    public readonly address?: string;

    private socket: net.Socket;
    private pendingHeader: Buffer | null = null;
    private readonly owner?: Handler;

    constructor(
        socket: net.Socket,
        private demux: DemuxMap,
        cfg: HandlerConfig,
        owner?: Handler,
        address?: string
    ) {
        super();
        this.socket = socket;
        this.owner = owner;
        this.address = address;
        socket.setNoDelay(true);
        socket.setKeepAlive(true, cfg.KeepAlive);

        this.startReading();

        socket.on('close', () => this.close());
        socket.on('error', err => {
            console.error('[cluster] socket error:', err.message);
            this.close();
        });
    }

    private async startReading() {
        try {
            for await (const _ of this.readFrames()) {
                // no-op
            }
        } catch (err) {
            console.error('[cluster] frame read error:', err);
            this.close();
        }
    }

    private async * readFrames(): AsyncGenerator<void> {
        while (!this.closed) {
            if (!this.pendingHeader) {
                this.pendingHeader = Buffer.alloc(9);
                await readFull(this.socket, this.pendingHeader);
            }

            if (this.pendingHeader[0] !== 0xFF) {
                throw RzError(`bad magic: 0x${this.pendingHeader[0].toString(16)}`);
            }

            const clrID = this.pendingHeader.readUInt32LE(1);
            const payloadLen = this.pendingHeader.readUInt32LE(5);

            const payload = Buffer.alloc(payloadLen);
            await readFull(this.socket, payload);

            this.pendingHeader = null;
            this.handleFrame(clrID, payload);
            yield;
        }
    }

    private handleFrame(clrID: number, payload: Buffer) {
        if (payload.length < 1) {
            this.close();
            return;
        }

        const statusLen = payload[0];
        if (payload.length < 1 + statusLen + 2) {
            this.close();
            return;
        }

        const status = payload.toString('utf8', 1, 1 + statusLen);
        const fieldCnt = payload.readUInt16LE(1 + statusLen);
        const fieldsData = payload.subarray(1 + statusLen + 2);

        let fields: Field[] = [];
        try {
            fields = parseFields(fieldsData, fieldCnt);
        } catch (err) {
            console.error('[cluster] field parse error:', err);
            this.close();
            return;
        }

        const [pending, found] = this.demux.loadRemove(clrID);

        if (!found || !pending || pending.resolved) return;

        clearTimeout(pending.timer);
        pending.resolved = true;

        if (status === 'ERROR' && fields.length > 0) {
            const code = fields[0].data.toString();
            if (['308', '405', '503'].includes(code)) this.close();
        }

        pending.resolve({ status, fields });
    }

    write(frame: Buffer) {
        if (this.closed) return;
        this.socket.write(frame, err => {
            if (err) {
                console.error('[cluster] write error:', err.message);
                this.close();
            }
        });
    }

    close() {
        if (this.closed) return;
        this.closed = true;
        this.socket.destroy();
        this.pendingHeader = null;

        if (this.owner && this.address) {
            this.owner['removeFollower'](this.address);
        }

        this.emit('close');
    }
}

// ========================================================
//   HandlerConfig
// ========================================================
export interface HandlerConfig {
    SeedNodeIds: string;
    APIPort: number;
    TCPPort: number;
    AuthToken: string;
    Timeout: number;
    HttpTimeout: number;
    KeepAlive: number;
    MaxActiveConns: number;
    NodeProbeInterval: number;
    DiscoveryAddr: string;
    StaticDiscovery: NodeAddr[];
}

// ========================================================
//   Handler
// ========================================================
export class Handler {
    private cfg: HandlerConfig;
    private discovery: DiscoveryMap;
    private leaderDemux: DemuxMap;
    private followerDemux: DemuxMap;
    private leaderConn?: Connection;
    private followerConns: Connection[] = [];
    private followerRRIndex = 0;
    private leaderClrID = 0;
    private followerClrID = 0;
    private reqChan = new Channel<Request>(QUEUE_CAPACITY);
    private closed = false;
    private onReconnect?: () => void;

    private followerProbeTimer?: NodeJS.Timeout;
    private followerFastCheckTimer?: NodeJS.Timeout;
    private discoveryTimer?: NodeJS.Timeout;

    constructor(cfg: HandlerConfig) {
        this.cfg = cfg;

        // Build discovery map (static or empty for HTTP mode)
        this.discovery = buildDiscoveryMap(cfg);

        this.leaderDemux = new DemuxMap(cfg.Timeout * 2);
        this.followerDemux = new DemuxMap(cfg.Timeout * 2);

        this.drainRequests();

        this.startLeaderWorker();
        this.startFollowerWorker();

        // Start discovery task if in HTTP mode
        if (cfg.DiscoveryAddr) {
            this.startDiscoveryTask();
        }
    }

    setOnReconnectCallback(cb: () => void) {
        this.onReconnect = cb;
    }

    private removeFollower(addr: string) {
        const index = this.followerConns.findIndex(c => c.address === addr);
        if (index !== -1) {
            this.followerConns.splice(index, 1);
            if (this.followerRRIndex >= this.followerConns.length) {
                this.followerRRIndex = 0;
            }
        }
    }

    // ========================================================
    //   updateDiscoveryMap - replaces map content (HTTP mode)
    // ========================================================
    private updateDiscoveryMap(nodes: NodeAddr[]): void {
        this.discovery.update(nodes, this.cfg.TCPPort, this.cfg.APIPort);
    }

    // ========================================================
    //   fetchExternalDiscovery - calls external discovery service
    // ========================================================
    private async fetchExternalDiscovery(): Promise<NodeAddr[]> {
        if (!this.cfg.DiscoveryAddr) {
            throw new Error('discovery address not configured');
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        try {
            const response = await fetch(this.cfg.DiscoveryAddr, {
                method: 'GET',
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`discovery service returned status: ${response.status}`);
            }

            const data = await response.json() as { nodes: NodeAddr[] };

            if (!data.nodes || data.nodes.length === 0) {
                throw new Error('discovery service returned empty node list');
            }

            return data.nodes;
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    }

    // ========================================================
    //   startDiscoveryTask - background task for HTTP mode
    // ========================================================
    private startDiscoveryTask(): void {
        const interval = this.cfg.NodeProbeInterval || 2000;

        // Initial fetch on startup
        this.fetchExternalDiscovery()
            .then(nodes => {
                if (nodes.length > 0) {
                    this.updateDiscoveryMap(nodes);
                }
            })
            .catch(() => {
                // silent fail - keep using empty map
            });

        // Periodic fetch
        this.discoveryTimer = setInterval(() => {
            this.fetchExternalDiscovery()
                .then(nodes => {
                    if (nodes.length > 0) {
                        this.updateDiscoveryMap(nodes);
                    }
                })
                .catch(() => {
                    // silent fail - keep using existing map
                });
        }, interval).unref();
    }

    private async connect(host: string): Promise<net.Socket> {
        return new Promise((resolve, reject) => {
            const socket = net.createConnection({
                host,
                port: this.cfg.TCPPort,
                keepAlive: true,
                keepAliveInitialDelay: this.cfg.KeepAlive,
            });

            const timer = setTimeout(() => {
                socket.destroy();
                reject(new Error('connect timeout'));
            }, this.cfg.Timeout);

            const cleanup = () => {
                clearTimeout(timer);
                socket.removeAllListeners();
            };

            socket.once('connect', () => {
                socket.write(prependHeader(0, buildLoginPayload(this.cfg.AuthToken)));
            });

            socket.once('data', data => {
                if (data.toString().includes('LOGIN OK')) {
                    cleanup();
                    resolve(socket);
                }
            });

            socket.once('error', err => {
                cleanup();
                reject(err);
            });
        });
    }

    private async reconnectLeader() {
        try {
            const { leader } = await getClusterInfo(
                this.cfg.SeedNodeIds,
                this.cfg.AuthToken,
                this.cfg.APIPort,
                this.cfg.HttpTimeout,
                this.discovery
            );

            const socket = await this.connect(leader.addr);
            const conn = new Connection(socket, this.leaderDemux, this.cfg);
            this.leaderConn?.close();
            this.leaderConn = conn;
            this.onReconnect?.();
        } catch {
            // silent fail
        }
    }

    private async syncFollowers() {
        try {
            const { followers } = await getClusterInfo(
                this.cfg.SeedNodeIds,
                this.cfg.AuthToken,
                this.cfg.APIPort,
                this.cfg.HttpTimeout,
                this.discovery
            );

            const wanted = new Set(followers.map(f => f.addr));

            // Update existing connections
            for (let i = this.followerConns.length - 1; i >= 0; i--) {
                const conn = this.followerConns[i];
                if (!conn.address || !wanted.has(conn.address)) {
                    conn.close();
                    this.followerConns.splice(i, 1);
                    if (this.followerRRIndex >= this.followerConns.length) {
                        this.followerRRIndex = 0;
                    }
                }
            }

            // Add new connections
            for (const follower of followers) {
                const exists = this.followerConns.some(c => c.address === follower.addr);
                if (exists) continue;

                try {
                    const socket = await this.connect(follower.addr);
                    const conn = new Connection(socket, this.followerDemux, this.cfg, this, follower.addr);
                    this.followerConns.push(conn);
                } catch {
                    // ignore connection errors
                }
            }
        } catch {
            // ignore sync errors
        }
    }

    private startLeaderWorker() {
        (async () => {
            let backoff = 100;
            while (!this.closed) {
                if (!this.leaderConn || this.leaderConn.closed) {
                    await this.reconnectLeader();
                }
                await new Promise(r => setTimeout(r, backoff + Math.random() * 50));
                backoff = Math.min(backoff * 2, 2000);
            }
        })().catch(() => { });
    }

    private startFollowerWorker() {
        this.followerProbeTimer = setInterval(() => {
            this.syncFollowers().catch(() => { });
        }, this.cfg.NodeProbeInterval).unref();

        this.followerFastCheckTimer = setInterval(() => {
            const allClosed = [...this.followerConns.values()].every(c => c.closed);
            if (allClosed && this.followerConns.length > 0) {
                this.syncFollowers().catch(() => { });
            }
        }, 100).unref();
    }

    private async drainRequests() {
        try {
            for await (const req of this.reqChan) {
                if (this.closed) break;

                const deadline = Date.now() + this.cfg.Timeout * 3;
                let backoff = 10;
                let conn: Connection | undefined;

                while (Date.now() < deadline) {
                    conn = req.isWrite ? this.leaderConn : this.nextFollowerConnection();
                    if (conn && !conn.closed) break;
                    await new Promise(r => setTimeout(r, backoff));
                    backoff = Math.min(backoff * 2, 1000);
                    if (!req.isWrite) await this.syncFollowers();
                }

                if (!conn || conn.closed) {
                    req.reject(new ClusterError('no healthy node'));
                    continue;
                }

                const clrID = req.isWrite
                    ? (this.leaderClrID = (this.leaderClrID + 1) >>> 0)
                    : (this.followerClrID = (this.followerClrID + 1) >>> 0);

                const frame = prependHeader(clrID, req.payload);
                const demux = req.isWrite ? this.leaderDemux : this.followerDemux;

                const pending: Pending = {
                    resolve: req.resolve,
                    reject: req.reject,
                    sentAt: Date.now(),
                    timer: setTimeout(() => {
                        const [p] = demux.loadRemove(clrID);
                        if (p && !p.resolved) {
                            p.reject(new Error('request timeout'));
                            p.resolved = true;
                        }
                    }, this.cfg.Timeout * 2).unref(),
                };

                demux.store(clrID, pending);
                conn.write(frame);
                pending.sentAt = Date.now();
            }
        } catch (err) {
            console.error('FATAL: request drain loop died:', err);
            process.exit(1);
        }
    }

    private nextFollowerConnection(): Connection | undefined {
        if (this.followerConns.length === 0) return undefined;

        const startIndex = this.followerRRIndex;
        let attempts = 0;

        while (attempts < this.followerConns.length) {
            const index = (startIndex + attempts) % this.followerConns.length;
            const conn = this.followerConns[index];

            if (!conn.closed) {
                this.followerRRIndex = (index + 1) % this.followerConns.length;
                return conn;
            }

            attempts++;
        }

        return undefined;
    }

    async execute(isWrite: boolean, payload: Buffer): Promise<RawResult> {
        if (payload.length === 0) throw RzError('empty payload');

        if (isWrite && !this.leaderConn) {
            throw RzError("cluster has no leader");
        }

        const result = await new Promise<RawResult>((resolve, reject) => {
            this.reqChan.send({ payload, resolve, reject, isWrite })
                .catch(reject);
        });

        if (result.status === 'SUCCESS') return result;

        const code = result.fields[0]?.data.toString() || result.status;
        const maxRetries = 5;
        let attempts = 1;

        while (attempts++ < maxRetries) {
            if (code === '503' || code === '429') {
                await new Promise(r => setTimeout(r, attempts * 100));
            }
            const retryResult = await new Promise<RawResult>((resolve, reject) => {
                try {
                    this.reqChan.send({ payload, resolve, reject, isWrite });
                } catch (err) {
                    reject(err);
                }
            });
            if (retryResult.status === 'SUCCESS') return retryResult;
        }

        throw RzError(`${code}`);
    }

    async close(): Promise<void> {
        this.closed = true;
        this.reqChan.close();

        if (this.followerProbeTimer !== undefined) {
            clearInterval(this.followerProbeTimer);
            this.followerProbeTimer = undefined;
        }
        if (this.followerFastCheckTimer !== undefined) {
            clearInterval(this.followerFastCheckTimer);
            this.followerFastCheckTimer = undefined;
        }
        if (this.discoveryTimer !== undefined) {
            clearInterval(this.discoveryTimer);
            this.discoveryTimer = undefined;
        }

        this.leaderDemux.destroy();
        this.followerDemux.destroy();
        this.leaderConn?.close();
        for (const c of this.followerConns.values()) c.close();
        this.followerConns = [];
    }

    isReady(): boolean {
        // Check if we have a leader connection (for writes) or any followers (for reads)
        return this.leaderConn !== undefined && !this.leaderConn.closed;
    }
}