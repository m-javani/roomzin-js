// src/internal/command/search_prop.ts
import { SearchPropPayload } from '../../types/request';
import { Field } from '../protocol/types';
import { makeF64, makeU64, bytesToPropertyID } from '../protocol/helpers';
import { RzError } from '../err';

export function buildSearchPropPayload(p: SearchPropPayload): Buffer {
    const cmdName = 'SEARCHPROP';

    const fields: Array<{ id: number; type: number; data: Buffer }> = [
        // Required: segment
        { id: 0x01, type: 0x01, data: Buffer.from(p.segment) },
    ];

    // Optional fields
    if (p.area) fields.push({ id: 0x02, type: 0x01, data: Buffer.from(p.area) });
    if (p.type) fields.push({ id: 0x03, type: 0x01, data: Buffer.from(p.type) });
    if (p.stars !== undefined) fields.push({ id: 0x04, type: 0x02, data: Buffer.from([p.stars]) });
    if (p.category) fields.push({ id: 0x05, type: 0x01, data: Buffer.from(p.category) });
    if (p.amenities && p.amenities.length > 0) {
        fields.push({ id: 0x06, type: 0x01, data: Buffer.from(p.amenities.join(',')) });
    }
    if (p.longitude !== undefined) fields.push({ id: 0x07, type: 0x03, data: makeF64(p.longitude) });
    if (p.latitude !== undefined) fields.push({ id: 0x08, type: 0x03, data: makeF64(p.latitude) });
    if (p.limit !== undefined) fields.push({ id: 0x09, type: 0x03, data: makeU64(p.limit) });

    // Dynamic size — no bugs, no math
    let size = 1 + cmdName.length + 2;
    for (const f of fields) size += 2 + 1 + 4 + f.data.length;

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

export function parseSearchPropResp(status: string, fields: Field[]): string[] {
    if (status !== 'SUCCESS') {
        if (fields.length > 0 && fields[0].id === 0x01 && fields[0].fieldType === 0x01) {
            throw RzError(`search prop error: ${fields[0].data.toString('utf8')}`);
        }
        throw RzError('search prop error: no error message');
    }

    const ids: string[] = [];

    for (let i = 0; i < fields.length; i++) {
        const f = fields[i];

        // expects field ID == i+1 (1-based sequential)
        if (f.id !== i + 1) {
            throw RzError(`invalid field ID ${f.id}: expected ${i + 1}`);
        }

        if (f.fieldType !== 0x01) {
            throw RzError(`invalid field type at ID ${f.id}: expected 0x01`);
        }

        ids.push(bytesToPropertyID(f.data));
    }

    return ids;
}