// src/internal/single/handler.ts
import net from 'net';
import { Mutex } from 'async-mutex';
import { buildLoginPayload } from '../protocol/login';
import { prependHeader, drainFrame } from '../protocol/frame';
import { parseFields } from '../protocol/frame';
import { ErrConnClosed, ErrTimeout, RawResult } from '../protocol/types';
import { RzError } from '../err';

export interface SingleConfig {
    addr: string;
    tcpPort: number;
    authToken: string;
    timeout: number;    // ms
    keepAlive: number;  // ms
}

export class SingleHandler {
    private config: SingleConfig;
    private conn: net.Socket | null = null;
    private nextId = 0;
    private mu = new Mutex();
    private closed = false;
    private demux = new Map<number, { resolve: (r: RawResult) => void; timer?: NodeJS.Timeout }>();
    private onReconnect?: () => void;

    constructor(config: SingleConfig) {
        this.config = config;
    }

    async connect(): Promise<void> {
        await this.reconnect();
    }

    private async reconnect(): Promise<void> {
        const release = await this.mu.acquire();
        try {
            if (this.conn) {
                this.conn.destroy();
                this.conn = null;
            }

            const host = this.parseHost(this.config.addr);
            const addr = `${host}:${this.config.tcpPort}`;

            this.conn = await this.dial(addr);
            this.startReadLoop();
        } finally {
            release();
        }
    }

    private dial(addr: string): Promise<net.Socket> {
        return new Promise((resolve, reject) => {
            const socket = new net.Socket();
            const timeout = setTimeout(() => {
                socket.destroy();
                reject(new Error('dial timeout'));
            }, this.config.timeout);

            socket.connect(this.config.tcpPort, this.parseHost(this.config.addr), () => clearTimeout(timeout));

            socket.once('connect', async () => {
                try {
                    await this.handshake(socket);
                    socket.setKeepAlive(true, this.config.keepAlive);
                    clearTimeout(timeout);
                    resolve(socket);
                } catch (err) {
                    socket.destroy();
                    reject(err);
                }
            });

            socket.on('error', (err) => {
                clearTimeout(timeout);
                reject(err);
            });
        });
    }

    private handshake(socket: net.Socket): Promise<void> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('handshake timeout')), this.config.timeout);
            const payload = buildLoginPayload(this.config.authToken);
            const frame = prependHeader(0, payload);
            socket.write(frame);

            const onData = (data: Buffer) => {
                clearTimeout(timer);
                socket.removeListener('error', onError);
                const resp = data.toString('utf8').trim();
                if (resp === 'LOGIN OK') {
                    resolve();
                } else if (resp === 'LOGIN FAILED') {
                    reject(new Error('login failed: invalid token'));
                } else {
                    reject(new Error(`unexpected login reply: "${resp}"`));
                }
            };
            const onError = (err: Error) => {
                clearTimeout(timer);
                reject(err);
            };
            socket.once('data', onData);
            socket.once('error', onError);
        });
    }

    async close(): Promise<void> {
        const release = await this.mu.acquire();
        try {
            if (this.closed) return;
            this.closed = true;
            if (this.conn) this.conn.destroy();
            for (const entry of this.demux.values()) {
                clearTimeout(entry.timer);
                entry.resolve({ status: '', fields: [] });
            }
            this.demux.clear();
        } finally {
            release();
        }
    }

    nextID(): number {
        return ++this.nextId;
    }

    async roundTrip(clrId: number, payload: Buffer): Promise<RawResult> {
        const release = await this.mu.acquire();
        try {
            if (this.closed) throw RzError(ErrConnClosed);

            // Self-heal: reconnect if connection is gone
            if (!this.conn || this.conn.destroyed) {
                release();
                await this.reconnect();
                return this.roundTrip(clrId, payload); // retry once
            }

            const ch: (r: RawResult) => void = () => { };
            const promise = new Promise<RawResult>((resolve) => {
                const timer = setTimeout(() => {
                    this.demux.delete(clrId);
                    this.reconnect().catch(() => { });
                    resolve({ status: 'ERROR', fields: [] });
                }, this.config.timeout);

                this.demux.set(clrId, { resolve, timer });
            });

            const frame = prependHeader(clrId, payload);
            this.conn.write(frame, (err) => {
                if (err) {
                    this.demux.delete(clrId);
                    this.reconnect().catch(() => { });
                }
            });

            release();
            return await promise;
        } catch (err) {
            release();
            throw RzError(err instanceof Error ? err : String(err));
        }
    }

    private startReadLoop(): void {
        if (!this.conn) return;

        const loop = async () => {
            try {
                while (this.conn && !this.conn.destroyed && !this.closed) {
                    const [header, payload] = await drainFrame(this.conn);
                    const fieldStart = 1 + header.status.length + 2;
                    const fields = parseFields(payload.subarray(fieldStart), header.fieldCnt);

                    const entry = this.demux.get(header.clrID);
                    if (entry) {
                        clearTimeout(entry.timer);
                        entry.resolve({ status: header.status, fields });
                        this.demux.delete(header.clrID);
                    }
                }
            } catch (err) {
                // Connection died
                this.failAll(err instanceof Error ? err : new Error('read error'));
                if (this.onReconnect) this.onReconnect();
            }
        };

        loop();
    }

    private failAll(err: Error): void {
        for (const [id, entry] of this.demux) {
            clearTimeout(entry.timer);
            entry.resolve({ status: 'ERROR', fields: [] });
            this.demux.delete(id);
        }
        if (this.onReconnect) this.onReconnect();
    }

    private parseHost(addr: string): string {
        const parts = addr.split(':');
        return parts.length > 1 ? parts[0] : addr;
    }

    setOnReconnect(callback: () => void): void {
        this.onReconnect = callback;
    }
}