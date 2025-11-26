// src/internal/command/get_prop_room_day.ts
import { GetRoomDayRequest } from '../../types/request';
import { GetRoomDayResult } from '../../types/response';
import { Field } from '../protocol/types';
import { Codecs } from '../../types/codecs';
import { bitmaskToRateFeatureStrings } from '../protocol/helpers';
import { RzError } from '../err';

export function buildGetPropRoomDayPayload(p: GetRoomDayRequest): Buffer {
    const cmdName = 'GETPROPROOMDAY';

    const fields = [
        { id: 0x01, type: 0x01, data: Buffer.from(p.propertyID) },
        { id: 0x02, type: 0x01, data: Buffer.from(p.roomType) },
        { id: 0x03, type: 0x01, data: Buffer.from(p.date) },
    ];

    let size = 1 + cmdName.length + 2; // cmd_len + cmd + field_count
    for (const f of fields) {
        size += 2 + 1 + 4 + f.data.length;
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

export function parseGetPropRoomDayResp(
    codecs: Codecs | null,
    status: string,
    fields: Field[]
): GetRoomDayResult {
    if (status !== 'SUCCESS') {
        const msg = fields.length > 0 && fields[0].fieldType === 0x01
            ? fields[0].data.toString('utf8')
            : '';
        throw RzError(msg);
    }

    if (fields.length < 5) {
        throw RzError(`expected 5 response fields, got ${fields.length}`);
    }

    const [f0, f1, f2, f3, f4] = fields;

    // Validate rate_feature field length (now u32 = 4 bytes)
    if (f4.data.length !== 4) {
        throw RzError(`invalid rate_feature field length: expected 4 bytes, got ${f4.data.length}`);
    }

    const rateFeatureMask = f4.data.readUInt32LE(0);

    return {
        propertyID: f0.data.toString('utf8'),
        date: f1.data.toString('utf8'),
        availability: f2.data[0],
        finalPrice: f3.data.readUInt32LE(0),
        rateFeature: bitmaskToRateFeatureStrings(codecs, rateFeatureMask),
    };
}