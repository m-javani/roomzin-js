// src/internal/command/prop_room_list.ts
import { RzError } from '../err';
import { Field } from '../protocol/types';

export function buildPropRoomListPayload(propertyID: string): Buffer {
    const cmdName = 'PROPROOMLIST';

    const fields = [
        { id: 0x01, type: 0x01, data: Buffer.from(propertyID) },
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

    // Single field: PropertyID (string)
    buf.writeUInt16LE(0x01, offset);
    offset += 2;
    buf[offset++] = 0x01; // type = string
    buf.writeUInt32LE(fields[0].data.length, offset);
    offset += 4;
    fields[0].data.copy(buf, offset);

    return buf;
}

export function parsePropRoomListResp(status: string, fields: Field[]): string[] {
    if (status !== 'SUCCESS') {
        const msg = fields.length > 0 && fields[0].fieldType === 0x01
            ? fields[0].data.toString('utf8')
            : '';
        throw RzError(msg);
    }

    // SUCCESS → all fields are room type strings
    const list: string[] = [];
    for (const field of fields) {
        list.push(field.data.toString('utf8'));
    }

    return list;
}