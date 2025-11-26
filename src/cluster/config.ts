import { RzError } from "../internal/err";
import { ErrorKind } from "../types";
import { NodeAddr } from "../types/discovery";

export class ClusterConfig {
    seedNodeIds = '';
    apiPort = 0;
    tcpPort = 0;
    authToken = '';
    timeout = 2_000;        // ms
    httpTimeout = 5_000;     // ms
    keepAlive = 30_000;      // ms
    maxActiveConns = 100;

    discoveryAddr = '';      // if set → HTTP discovery mode
    staticDiscovery: NodeAddr[] = []; // used only when discoveryAddr is empty
}

export class ClusterConfigBuilder {
    private config = new ClusterConfig();

    private constructor() { }

    static new(): ClusterConfigBuilder {
        return new ClusterConfigBuilder();
    }

    withSeedNodeIds(seeds: string): this {
        this.config.seedNodeIds = seeds.trim();
        return this;
    }

    withDiscoveryAddr(discoveryAddr: string): this {
        this.config.discoveryAddr = discoveryAddr;
        return this;
    }

    withStaticDiscovery(staticDiscovery: NodeAddr[]): this {
        this.config.staticDiscovery = staticDiscovery;
        return this;
    }

    withAPIPort(port: number): this {
        this.config.apiPort = port;
        return this;
    }

    withTCPPort(port: number): this {
        this.config.tcpPort = port;
        return this;
    }

    withToken(token: string): this {
        this.config.authToken = token;
        return this;
    }

    withTimeout(ms: number): this {
        this.config.timeout = ms;
        return this;
    }

    withHttpTimeout(ms: number): this {
        this.config.httpTimeout = ms;
        return this;
    }

    withKeepAlive(ms: number): this {
        this.config.keepAlive = ms;
        return this;
    }

    withMaxActiveConns(n: number): this {
        this.config.maxActiveConns = n > 0 ? n : 100;
        return this;
    }

    build(): ClusterConfig {
        const errors: string[] = [];

        if (!this.config.seedNodeIds) errors.push('at least one seed address is required');
        if (this.config.tcpPort === 0) errors.push('TCP port is required');
        if (this.config.apiPort === 0) errors.push('API port is required in clustered mode');
        if (!this.config.authToken) errors.push('authentication requires a token');

        if (errors.length > 0) {
            throw RzError(`ClusterConfig validation failed:\n  • ${errors.join('\n  • ')}`, ErrorKind.Client);
        }

        // Return a shallow clone + freeze for immutability
        return Object.freeze({ ...this.config });
    }
}