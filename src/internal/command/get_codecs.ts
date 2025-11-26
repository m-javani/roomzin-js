// src/internal/command/get_codecs.ts
import { Field } from '../protocol/types';
import { Codecs } from '../../types/codecs';
import { RzError } from '../err';

export function buildGetCodecsPayload(): Buffer {
    const cmdName = 'GETCODECS';

    // No fields → field count = 0
    const size = 1 + cmdName.length + 2; // cmd_len + cmd + field_count
    const buf = Buffer.alloc(size);
    let offset = 0;

    buf[offset++] = cmdName.length;
    offset += buf.write(cmdName, offset);
    buf.writeUInt16LE(0, offset); // 0 fields

    return buf;
}

export function parseGetCodecsResp(status: string, fields: Field[]): Codecs {
    if (status !== 'SUCCESS') {
        const msg = fields.length > 0 && fields[0].fieldType === 0x01
            ? fields[0].data.toString('utf8')
            : 'unknown error';
        throw RzError(msg);
    }

    if (fields.length !== 1) {
        throw RzError(`invalid field count: expected 1 field, got ${fields.length}`);
    }

    const field = fields[0];
    if (field.fieldType !== 0x09) {
        throw RzError(`expected YAML field type 0x09, got type ${field.fieldType}`);
    }

    return parseCodecsFromDelimited(field.data);
}

function parseCodecsFromDelimited(data: Buffer): Codecs {
    const str = data.toString('utf8');

    const rateFeatures = str.split(',').filter(item => item !== '');

    return { rateFeatures };
}