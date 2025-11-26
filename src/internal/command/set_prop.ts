// src/internal/command/set_prop.ts
import { SetPropPayload } from '../../types/request';
import { RzError } from '../err';
import { makeF64 } from '../protocol/helpers';
import { Field } from '../protocol/types';

export function buildSetPropPayload(p: SetPropPayload): Buffer {
    const cmdName = 'SETPROP';
    const amenityStr = p.amenities.join(',');

    const fields = [
        { id: 0x01, type: 0x01, data: Buffer.from(p.segment) },
        { id: 0x02, type: 0x01, data: Buffer.from(p.area) },
        { id: 0x03, type: 0x01, data: Buffer.from(p.propertyID) },
        { id: 0x04, type: 0x01, data: Buffer.from(p.propertyType) },
        { id: 0x05, type: 0x01, data: Buffer.from(p.category) },
        { id: 0x06, type: 0x02, data: Buffer.from([p.stars]) },
        { id: 0x07, type: 0x03, data: makeF64(p.latitude) },
        { id: 0x08, type: 0x03, data: makeF64(p.longitude) },
        { id: 0x09, type: 0x01, data: Buffer.from(amenityStr) },
    ];

    let size = 1 + cmdName.length + 2; // cmd len + cmd + field count
    for (const f of fields) {
        size += 2 + 1 + 4 + f.data.length; // id + type + len + data
    }

    const buf = Buffer.alloc(size);
    let offset = 0;

    buf[offset++] = cmdName.length;
    offset += buf.write(cmdName, offset);

    buf.writeUInt16LE(fields.length, offset);
    offset += 2;

    for (const f of fields) {
        buf.writeUInt16LE(f.id, offset);
        offset += 2;
        buf[offset++] = f.type;
        buf.writeUInt32LE(f.data.length, offset);
        offset += 4;
        f.data.copy(buf, offset);
        offset += f.data.length;
    }

    return buf;
}

export function parseSetPropResp(status: string, fields: Field[]): void {
    if (status === 'SUCCESS') return;
    throw RzError(`${fields[0]?.data.toString('utf8') ?? 'unknown'}`);
}