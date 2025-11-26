// src/internal/command/prop_room_date_list.ts
import { PropRoomDateListPayload } from '../../types/request';
import { RzError } from '../err';
import { Field } from '../protocol/types';

export function buildPropRoomDateListPayload(p: PropRoomDateListPayload): Buffer {
    const cmdName = 'PROPROOMDATELIST';

    const fields = [
        { id: 0x01, type: 0x01, data: Buffer.from(p.propertyID) },
        { id: 0x02, type: 0x01, data: Buffer.from(p.roomType) },
    ];

    let size = 1 + cmdName.length + 2; // cmd_len + cmd + field_count
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

export function parsePropRoomDateListResp(status: string, fields: Field[]): string[] {
    if (status !== 'SUCCESS') {
        const msg = fields.length > 0 && fields[0].fieldType === 0x01
            ? fields[0].data.toString('utf8')
            : '';
        throw RzError(msg);
    }

    const out: string[] = [];

    for (const field of fields) {
        const s = field.data.toString('utf8');
        if (s !== '') {
            out.push(s);
        }
    }

    out.sort();

    return out;
}