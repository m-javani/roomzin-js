// src/internal/command/dec_room_avl.ts
import { UpdRoomAvlPayload } from '../../types/request';
import { RzError } from '../err';
import { Field } from '../protocol/types';

export function buildDecRoomAvlPayload(p: UpdRoomAvlPayload): Buffer {
    const cmdName = 'DECROOMAVL';

    const fields = [
        { id: 0x01, type: 0x01, data: Buffer.from(p.propertyID) },
        { id: 0x02, type: 0x01, data: Buffer.from(p.roomType) },
        { id: 0x03, type: 0x01, data: Buffer.from(p.date) },
        { id: 0x04, type: 0x02, data: Buffer.from([p.amount]) },
    ];

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

    // 3. Fields
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

export function parseDecRoomAvlResp(status: string, fields: Field[]): number {
    if (status === 'SUCCESS') {
        const b = fields[0]?.data;
        if (!b || b.length !== 1) {
            throw RzError('missing or invalid scalar value');
        }
        return b[0];
    }

    const msg = fields[0]?.data.toString('utf8') ?? 'unknown error';
    throw RzError(`${msg}`);
}