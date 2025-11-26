// src/internal/command/set_room_pkg.ts
import { SetRoomPkgPayload } from '../../types/request';
import { RzError } from '../err';
import { Field } from '../protocol/types';

export function buildSetRoomPkgPayload(p: SetRoomPkgPayload): Buffer {
    if (!p.propertyID || !p.roomType || !p.date) {
        throw RzError('missing required fields');
    }

    const cmdName = 'SETROOMPKG';

    const fields: Array<{ id: number; type: number; data: Buffer }> = [
        { id: 0x01, type: 0x01, data: Buffer.from(p.propertyID) },
        { id: 0x02, type: 0x01, data: Buffer.from(p.roomType) },
        { id: 0x03, type: 0x01, data: Buffer.from(p.date) },
    ];

    // Optional: Availability (byte)
    if (p.availability !== undefined && p.availability !== null) {
        fields.push({
            id: 0x04,
            type: 0x02,
            data: Buffer.from([p.availability]),
        });
    }

    // Optional: FinalPrice (u32 LE)
    if (p.finalPrice !== undefined && p.finalPrice !== null) {
        const b = Buffer.alloc(4);
        b.writeUInt32LE(p.finalPrice, 0);
        fields.push({
            id: 0x05,
            type: 0x03,
            data: b,
        });
    }

    // Optional: RateFeature list → comma-separated string
    if (p.rateFeature && p.rateFeature.length > 0) {
        const rateFeatureStr = p.rateFeature.join(',');
        fields.push({
            id: 0x06,
            type: 0x01,
            data: Buffer.from(rateFeatureStr),
        });
    }

    // --- Dynamic size calculation (safe) ---
    let size = 1 + cmdName.length + 2; // cmd_len + cmd + field_count
    for (const f of fields) {
        size += 2 + 1 + 4 + f.data.length; // id + type + len + data
    }

    const buf = Buffer.alloc(size);
    let offset = 0;

    // 1. Command name
    buf[offset++] = cmdName.length;
    offset += buf.write(cmdName, offset);

    // 2. Field count
    buf.writeUInt16LE(fields.length, offset);
    offset += 2;

    // 3.Fields
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

export function parseSetRoomPkgResp(status: string, fields: Field[]): void {
    if (status === 'SUCCESS') {
        return;
    }

    const msg = fields[0]?.data.toString('utf8') ?? 'unknown error';
    ;
    throw RzError(`${msg}`);
}