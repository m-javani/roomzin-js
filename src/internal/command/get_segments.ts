// src/internal/command/get_segments.ts
import { SegmentInfo } from '../../types/response';
import { RzError } from '../err';
import { Field } from '../protocol/types';

export function buildGetSegmentsPayload(): Buffer {
    const cmdName = 'GETSEGMENTS';

    const size = 1 + cmdName.length + 2; // cmd_len + cmd + field_count(0)
    const buf = Buffer.alloc(size);
    let offset = 0;

    buf[offset++] = cmdName.length;
    offset += buf.write(cmdName, offset);
    buf.writeUInt16LE(0, offset); // 0 fields

    return buf;
}

export function parseGetSegmentsResp(status: string, fields: Field[]): SegmentInfo[] {
    if (status !== 'SUCCESS') {
        const msg = fields.length > 0 && fields[0].fieldType === 0x01
            ? fields[0].data.toString('utf8')
            : 'unknown error';
        throw RzError(msg);
    }

    if (fields.length % 2 !== 0) {
        throw RzError('invalid field count: expected pairs of segment and propCount');
    }

    const list: SegmentInfo[] = [];

    for (let i = 0; i < fields.length; i += 2) {
        const segmentField = fields[i];
        const countField = fields[i + 1];

        // Field i: segment string (type 0x01)
        if (segmentField.fieldType !== 0x01) {
            throw RzError(`expected string segment at field ${i}, got type ${segmentField.fieldType}`);
        }
        const segment = segmentField.data.toString('utf8');

        // Field i+1: propCount u32 (type 0x03, 4 bytes)
        if (countField.fieldType !== 0x03) {
            throw RzError(`expected u32 propCount at field ${i + 1}, got type ${countField.fieldType}`);
        }
        if (countField.data.length !== 4) {
            throw RzError(`invalid propCount length: expected 4 bytes, got ${countField.data.length}`);
        }

        const propCount = countField.data.readUInt32LE(0);

        list.push({ segment, propCount });
    }

    return list;
}