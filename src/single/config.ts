// src/single/config.ts

import { RzError } from "../internal/err";
import { ErrorKind } from "../types";

export class Config {
    host = '';
    tcpPort = 0;
    authToken = '';
    timeout = 2_000; // 2 seconds in ms
    keepAlive = 30_000; // 30 seconds in ms

}

export class ConfigBuilder {
    private config = new Config();

    private constructor() { }

    /** Create a new builder with sensible defaults */
    static new(): ConfigBuilder {
        return new ConfigBuilder();
    }

    withHost(host: string): this {
        this.config.host = host.trim();
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

    withTimeout(timeoutMs: number): this {
        this.config.timeout = timeoutMs;
        return this;
    }

    withKeepAlive(keepAliveMs: number): this {
        this.config.keepAlive = keepAliveMs;
        return this;
    }

    /** Build and validate the config */
    build(): Config {
        const errors: string[] = [];

        if (!this.config.host) {
            errors.push('server address is required');
        }
        if (this.config.tcpPort === 0) {
            errors.push('TCP port is required');
        }
        if (!this.config.authToken) {
            errors.push('authentication requires a token');
        }

        if (errors.length > 0) {
            throw RzError(`Config validation failed:\n  - ${errors.join('\n  - ')}`, ErrorKind.Client);
        }

        return { ...this.config };
    }
}