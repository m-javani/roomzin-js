// src/internal/command/prop_exist.ts
import { RzError } from '../err';
import { Field } from '../protocol/types';

export function buildPropExistPayload(propertyID: string): Buffer {
    const cmdName = 'PROPEXIST';

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

export function parsePropExistResp(status: string, fields: Field[]): boolean {
    if (status === 'SUCCESS') {
        // SUCCESS → field[0] is a single byte: 1 = exists, 0 = not exists
        if (!fields[0]?.data || fields[0].data.length < 1) {
            throw RzError('invalid PROPEXIST response: missing boolean byte');
        }
        return fields[0].data[0] === 1;
    }

    // Error path
    const msg = fields[0]?.data.toString('utf8') ?? 'unknown error';
    throw RzError(`${msg}`);
}