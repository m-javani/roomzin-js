// src/internal/command/prop_room_exist.ts
import { PropRoomExistPayload } from '../../types/request';
import { RzError } from '../err';
import { Field } from '../protocol/types';

export function buildPropRoomExistPayload(p: PropRoomExistPayload): Buffer {
    const cmdName = 'PROPROOMEXIST';

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

export function parsePropRoomExistResp(status: string, fields: Field[]): boolean {
    if (status === 'SUCCESS') {
        // SUCCESS → first field is a single byte: 1 = exists, 0 = does not exist
        if (!fields[0]?.data || fields[0].data.length === 0) {
            throw RzError('invalid PROPROOMEXIST response: missing boolean byte');
        }
        return fields[0].data[0] === 1;
    }

    // On error (including "not found")
    throw RzError('');
}