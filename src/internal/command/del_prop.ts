// src/internal/command/del_prop.ts
import { RzError } from '../err';
import { Field } from '../protocol/types';

export function buildDelPropPayload(propertyID: string): Buffer {
    const cmdName = 'DELPROP';

    const fields = [
        { id: 0x01, type: 0x01, data: Buffer.from(propertyID) },
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

    // 3. Single field: PropertyID (string)
    buf.writeUInt16LE(0x01, offset);
    offset += 2;
    buf[offset++] = 0x01; // type = string
    buf.writeUInt32LE(fields[0].data.length, offset);
    offset += 4;
    fields[0].data.copy(buf, offset);

    return buf;
}

export function parseDelPropResp(status: string, fields: Field[]): void {
    if (status === 'SUCCESS') {
        return;
    }

    if (fields.length > 0 && fields[0].fieldType === 0x01) {
        throw RzError(fields[0].data.toString('utf8'));
    }

    //  errors.New("")
    throw RzError('');
}