// src/cluster/client.ts
import { Handler } from '../internal/cluster/handler';
import type { ClusterConfig } from './config';
import type { CacheClientAPI } from '../api/client';
import type { Codecs } from '../types/codecs';
import type { Field, RawResult } from '../internal/protocol/types';

import {
    buildGetCodecsPayload,
    parseGetCodecsResp,
    buildSetPropPayload,
    parseSetPropResp,
    buildSearchPropPayload,
    parseSearchPropResp,
    buildSearchAvailPayload,
    parseSearchAvailResp,
    buildSetRoomPkgPayload,
    parseSetRoomPkgResp,
    buildSetRoomAvlPayload,
    parseSetRoomAvlResp,
    buildIncRoomAvlPayload,
    parseIncRoomAvlResp,
    buildDecRoomAvlPayload,
    parseDecRoomAvlResp,
    buildPropExistPayload,
    parsePropExistResp,
    buildPropRoomExistPayload,
    parsePropRoomExistResp,
    buildPropRoomListPayload,
    parsePropRoomListResp,
    buildPropRoomDateListPayload,
    parsePropRoomDateListResp,
    buildDelPropPayload,
    parseDelPropResp,
    buildDelSegmentPayload,
    parseDelSegmentResp,
    buildDelPropDayPayload,
    parseDelPropDayResp,
    buildDelPropRoomPayload,
    parseDelPropRoomResp,
    buildDelRoomDayPayload,
    parseDelRoomDayResp,
    buildGetPropRoomDayPayload,
    parseGetPropRoomDayResp,
    buildGetSegmentsPayload,
    parseGetSegmentsResp,
} from '../internal/command/index';

import { DelPropDayRequest, DelPropRoomPayload, DelRoomDayRequest, GetRoomDayRequest, PropRoomDateListPayload, PropRoomExistPayload, SearchAvailPayload, SearchPropPayload, SetPropPayload, SetRoomPkgPayload, UpdRoomAvlPayload, verifyDelPropDayRequest, verifyDelRoomDayRequest, verifyGetRoomDayRequest, verifySearchAvailPayload, verifySearchPropPayload, verifySetPropPayload, verifySetRoomPkgPayload, verifyUpdRoomAvlPayload } from '../types/request';
import { RzError } from '../internal/err';
import { ErrorKind } from '../types';

export class Client implements CacheClientAPI {
    private handler: Handler;
    private codecs: Codecs | null = null;

    private constructor(handler: Handler) {
        this.handler = handler;

        // Invalidate codecs on any reconnect (leader or follower change)
        handler.setOnReconnectCallback?.(() => {
            this.codecs = null;
        });
    }

    static async create(cfg: ClusterConfig): Promise<Client> {
        if (!cfg) throw RzError('cfg must not be null', ErrorKind.Client);


        const handler = new Handler({
            SeedNodeIds: cfg.seedNodeIds,
            APIPort: cfg.apiPort,
            TCPPort: cfg.tcpPort,
            AuthToken: cfg.authToken || '',
            Timeout: cfg.timeout || 5000,
            HttpTimeout: cfg.httpTimeout || 3000,
            KeepAlive: cfg.keepAlive || 30000,
            MaxActiveConns: cfg.maxActiveConns || 100,
            NodeProbeInterval: 2000, // 2 seconds
            DiscoveryAddr: cfg.discoveryAddr || '',
            StaticDiscovery: cfg.staticDiscovery || [],
        });

        const client = new Client(handler);

        // Wait for handler to be ready
        const start = Date.now();
        const timeout = cfg.timeout || 5000;
        while (Date.now() - start < timeout * 3) {
            if (handler.isReady()) {
                break;
            }
            await new Promise(r => setTimeout(r, 50));
        }

        client.codecs = await client.fetchCodecs();

        return client;
    }

    private async getCodecsInternal(): Promise<Codecs> {
        if (this.codecs != null) {
            return this.codecs;
        }
        this.codecs = await this.fetchCodecs();
        return this.codecs;
    }

    private async fetchCodecs(): Promise<Codecs> {
        const payload = buildGetCodecsPayload();
        const resp = await this.handler.execute(false, payload);
        if (resp.status === 'ERROR' && resp.fields.length > 0) {
            throw RzError(resp.fields[0].data.toString('utf8'));
        }
        const codecs = parseGetCodecsResp(resp.status, resp.fields);
        if (!codecs) throw RzError('failed to parse codecs from server');
        return codecs;
    }

    private assertOk(resp: RawResult, context: string): void {
        if (resp.status === 'ERROR') {
            const msg = resp.fields.length > 0 ? resp.fields[0].data.toString('utf8') : 'unknown error';
            throw RzError(`${context}: ${msg}`);
        }
        if (resp.status !== 'SUCCESS') {
            throw RzError(`${context}: unexpected status "${resp.status}"`);
        }
    }

    // ———————————————————————— PUBLIC API ————————————————————————

    async getCodecs(): Promise<Codecs> {
        if (this.codecs) return this.codecs;
        this.codecs = await this.fetchCodecs();
        return this.codecs;
    }

    async setProp(p: SetPropPayload): Promise<void> {
        const codecs = await this.getCodecsInternal();
        const [valid, errMsg] = verifySetPropPayload(p, codecs);
        if (!valid) throw RzError(errMsg);

        const payload = buildSetPropPayload(p);
        const resp = await this.handler.execute(true, payload);
        this.assertOk(resp, 'setProp');
        return parseSetPropResp(resp.status, resp.fields);

    }

    async setRoomPkg(p: SetRoomPkgPayload): Promise<void> {
        const codecs = await this.getCodecsInternal();
        const [valid, errMsg] = verifySetRoomPkgPayload(p, codecs);
        if (!valid) throw RzError(errMsg);

        const payload = buildSetRoomPkgPayload(p);
        const resp = await this.handler.execute(true, payload);
        this.assertOk(resp, 'setRoomPkg');
        return parseSetRoomPkgResp(resp.status, resp.fields);

    }

    async setRoomAvl(p: UpdRoomAvlPayload): Promise<number> {
        const [valid, errMsg] = verifyUpdRoomAvlPayload(p);
        if (!valid) throw RzError(errMsg);

        const payload = buildSetRoomAvlPayload(p);
        const resp = await this.handler.execute(true, payload);
        this.assertOk(resp, 'setRoomAvl');
        return parseSetRoomAvlResp(resp.status, resp.fields);
    }

    async incRoomAvl(p: UpdRoomAvlPayload): Promise<number> {
        const [valid, errMsg] = verifyUpdRoomAvlPayload(p);
        if (!valid) throw RzError(errMsg);

        const payload = buildIncRoomAvlPayload(p);
        const resp = await this.handler.execute(true, payload);
        this.assertOk(resp, 'incRoomAvl');
        return parseIncRoomAvlResp(resp.status, resp.fields);
    }

    async decRoomAvl(p: UpdRoomAvlPayload): Promise<number> {
        const [valid, errMsg] = verifyUpdRoomAvlPayload(p);
        if (!valid) throw RzError(errMsg);

        const payload = buildDecRoomAvlPayload(p);
        const resp = await this.handler.execute(true, payload);
        this.assertOk(resp, 'decRoomAvl');
        return parseDecRoomAvlResp(resp.status, resp.fields);
    }

    async searchProp(p: SearchPropPayload): Promise<string[]> {
        const codecs = await this.getCodecsInternal();
        const [valid, errMsg] = verifySearchPropPayload(p, codecs);
        if (!valid) throw RzError(errMsg);

        const payload = buildSearchPropPayload(p);
        const resp = await this.handler.execute(false, payload);
        this.assertOk(resp, 'searchProp');
        return parseSearchPropResp(resp.status, resp.fields);
    }

    async searchAvail(p: SearchAvailPayload): Promise<any[]> {
        const codecs = await this.getCodecsInternal();
        const [valid, errMsg] = verifySearchAvailPayload(p, codecs);
        if (!valid) throw RzError(errMsg);

        const payload = buildSearchAvailPayload(p);
        const resp = await this.handler.execute(false, payload);
        this.assertOk(resp, 'searchAvail');
        return parseSearchAvailResp(codecs, resp.status, resp.fields);
    }

    async propExist(propertyID: string): Promise<boolean> {
        if (!propertyID?.trim()) throw RzError('propertyID is required');
        const payload = buildPropExistPayload(propertyID.trim());
        const resp = await this.handler.execute(false, payload);
        this.assertOk(resp, 'propExist');
        return parsePropExistResp(resp.status, resp.fields);
    }

    async propRoomExist(p: PropRoomExistPayload): Promise<boolean> {
        if (!p.propertyID?.trim()) throw RzError('propertyID is required');
        if (!p.roomType?.trim()) throw RzError('roomType is required');

        const payload = buildPropRoomExistPayload(p);
        const resp = await this.handler.execute(false, payload);
        this.assertOk(resp, 'propRoomExist');
        return parsePropRoomExistResp(resp.status, resp.fields);
    }

    async propRoomList(propertyID: string): Promise<string[]> {
        if (!propertyID?.trim()) throw RzError('propertyID is required');
        const payload = buildPropRoomListPayload(propertyID.trim());
        const resp = await this.handler.execute(false, payload);
        this.assertOk(resp, 'propRoomList');
        return parsePropRoomListResp(resp.status, resp.fields);
    }

    async propRoomDateList(p: PropRoomDateListPayload): Promise<string[]> {
        if (!p.propertyID?.trim()) throw RzError('propertyID is required');
        if (!p.roomType?.trim()) throw RzError('roomType is required');

        const payload = buildPropRoomDateListPayload(p);
        const resp = await this.handler.execute(false, payload);
        this.assertOk(resp, 'propRoomDateList');
        return parsePropRoomDateListResp(resp.status, resp.fields);
    }

    async delProp(propertyID: string): Promise<void> {
        if (!propertyID?.trim()) throw RzError('propertyID is required');
        const payload = buildDelPropPayload(propertyID.trim());
        const resp = await this.handler.execute(true, payload);
        this.assertOk(resp, 'delProp');
        return parseDelPropResp(resp.status, resp.fields);

    }

    async delSegment(segment: string): Promise<void> {
        if (!segment?.trim()) throw RzError('segment is required');
        const payload = buildDelSegmentPayload(segment.trim());
        const resp = await this.handler.execute(true, payload);
        this.assertOk(resp, 'delSegment');
        return parseDelSegmentResp(resp.status, resp.fields);
    }

    async delPropDay(p: DelPropDayRequest): Promise<void> {
        const [valid, errMsg] = verifyDelPropDayRequest(p);
        if (!valid) throw RzError(errMsg);

        const payload = buildDelPropDayPayload(p);
        const resp = await this.handler.execute(true, payload);
        this.assertOk(resp, 'delPropDay');
        return parseDelPropDayResp(resp.status, resp.fields);
    }

    async delPropRoom(p: DelPropRoomPayload): Promise<void> {
        if (!p.propertyID?.trim()) throw RzError('propertyID is required');
        if (!p.roomType?.trim()) throw RzError('roomType is required');

        const payload = buildDelPropRoomPayload(p);
        const resp = await this.handler.execute(true, payload);
        this.assertOk(resp, 'delPropRoom');
        return parseDelPropRoomResp(resp.status, resp.fields);
    }

    async delRoomDay(p: DelRoomDayRequest): Promise<void> {
        const [valid, errMsg] = verifyDelRoomDayRequest(p);
        if (!valid) throw RzError(errMsg);

        const payload = buildDelRoomDayPayload(p);
        const resp = await this.handler.execute(true, payload);
        this.assertOk(resp, 'delRoomDay');
        return parseDelRoomDayResp(resp.status, resp.fields);
    }

    async getPropRoomDay(p: GetRoomDayRequest): Promise<any> {
        const [valid, errMsg] = verifyGetRoomDayRequest(p);
        if (!valid) throw RzError(errMsg);

        const payload = buildGetPropRoomDayPayload(p);
        const resp = await this.handler.execute(false, payload);
        this.assertOk(resp, 'getPropRoomDay');
        const codecs = await this.getCodecsInternal();
        return parseGetPropRoomDayResp(codecs, resp.status, resp.fields);
    }

    async getSegments(): Promise<any[]> {
        const payload = buildGetSegmentsPayload();
        const resp = await this.handler.execute(false, payload);
        this.assertOk(resp, 'getSegments');
        return parseGetSegmentsResp(resp.status, resp.fields);
    }

    async close(): Promise<void> {
        await this.handler.close();
    }
}