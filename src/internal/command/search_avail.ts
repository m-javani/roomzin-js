// src/internal/command/search_avail.ts
import { SearchAvailPayload } from '../../types/request';
import { PropertyAvail, DayAvail } from '../../types/response';
import { Field } from '../protocol/types';
import { Codecs } from '../../types/codecs';
import {
    makeF64,
    makeU32,
    makeU64,
    bytesToPropertyID,
    u16ToDate,
    bitmaskToRateFeatureStrings,
} from '../protocol/helpers';
import { RzError } from '../err';

export function buildSearchAvailPayload(p: SearchAvailPayload): Buffer {
    const cmdName = 'SEARCHAVAIL';

    const fields: Array<{ id: number; type: number; data: Buffer }> = [
        // Required fields
        { id: 0x01, type: 0x01, data: Buffer.from(p.segment) },
        { id: 0x02, type: 0x01, data: Buffer.from(p.roomType) },
    ];

    // Optional fields
    if (p.area) fields.push({ id: 0x03, type: 0x01, data: Buffer.from(p.area) });
    if (p.propertyID) fields.push({ id: 0x04, type: 0x01, data: Buffer.from(p.propertyID) });
    if (p.type) fields.push({ id: 0x05, type: 0x01, data: Buffer.from(p.type) });
    if (p.stars !== undefined) fields.push({ id: 0x06, type: 0x02, data: Buffer.from([p.stars]) });
    if (p.category) fields.push({ id: 0x07, type: 0x01, data: Buffer.from(p.category) });
    if (p.amenities.length > 0) fields.push({ id: 0x08, type: 0x01, data: Buffer.from(p.amenities.join(',')) });
    if (p.longitude !== undefined) fields.push({ id: 0x09, type: 0x03, data: makeF64(p.longitude) });
    if (p.latitude !== undefined) fields.push({ id: 0x0A, type: 0x03, data: makeF64(p.latitude) });
    if (p.date.length > 0) fields.push({ id: 0x0B, type: 0x01, data: Buffer.from(p.date.join(',')) });
    if (p.availability !== undefined) fields.push({ id: 0x0C, type: 0x02, data: Buffer.from([p.availability]) });
    if (p.finalPrice !== undefined) fields.push({ id: 0x0D, type: 0x03, data: makeU32(p.finalPrice) });
    if (p.rateFeature.length > 0) fields.push({ id: 0x0E, type: 0x01, data: Buffer.from(p.rateFeature.join(',')) });
    if (p.limit !== undefined) fields.push({ id: 0x0F, type: 0x03, data: makeU64(p.limit) });

    // Dynamic size — safe
    let size = 1 + cmdName.length + 2;
    for (const f of fields) size += 2 + 1 + 4 + f.data.length;

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

export function parseSearchAvailResp(
    codecs: Codecs | null,
    status: string,
    fields: Field[]
): PropertyAvail[] {
    if (status !== 'SUCCESS') {
        const msg = fields.length > 0 && fields[0].fieldType === 0x01
            ? fields[0].data.toString('utf8')
            : `search failed with status=${status}`;
        throw RzError(msg);
    }

    // First field: num_days (id=1, type=0x02, 2 bytes)
    const numDaysField = fields[0];
    if (numDaysField.id !== 1 || numDaysField.fieldType !== 0x02 || numDaysField.data.length !== 2) {
        throw RzError('expected num_days field (id=1, type=0x02, len=2)');
    }
    const numDays = numDaysField.data.readUInt16LE(0);

    const result: PropertyAvail[] = [];
    let i = 1;

    while (i < fields.length) {
        // Property ID (string)
        const propField = fields[i++];
        if (propField.fieldType !== 0x01) {
            throw RzError(`expected property ID string, got type 0x${propField.fieldType.toString(16)}`);
        }
        const propertyID = bytesToPropertyID(propField.data);

        // Days vector (type 0x08)
        if (i >= fields.length) throw RzError(`property "${propertyID}" missing days vector`);
        const daysField = fields[i++];
        if (daysField.fieldType !== 0x08) {
            throw RzError(`expected days vector (0x08) for property "${propertyID}", got 0x${daysField.fieldType.toString(16)}`);
        }

        const data = daysField.data;
        if (data.length < 2) throw RzError(`property "${propertyID}" days vector too short`);

        const daysCount = data.readUInt16LE(0);
        if (daysCount !== numDays) {
            throw RzError(`property "${propertyID}" days count mismatch: expected ${numDays}, got ${daysCount}`);
        }

        // Updated: 11 bytes per day (date 2 + avail 1 + price 4 + rate_feature u32 4)
        const expectedLen = 2 + daysCount * 11;
        if (data.length !== expectedLen) {
            throw RzError(`property "${propertyID}" days vector length mismatch: expected ${expectedLen}, got ${data.length}`);
        }

        const days: DayAvail[] = [];
        let cursor = 2;

        for (let d = 0; d < daysCount; d++) {
            const datePacked = data.readUInt16LE(cursor); cursor += 2;
            const availability = data[cursor]; cursor += 1;
            const finalPrice = data.readUInt32LE(cursor); cursor += 4;
            const rateFeatureMask = data.readUInt32LE(cursor); cursor += 4;

            const date = u16ToDate(datePacked);
            days.push({
                date,
                availability,
                finalPrice,
                rateFeature: bitmaskToRateFeatureStrings(codecs, rateFeatureMask),
            });
        }

        result.push({ propertyID, days });
    }

    if (i !== fields.length) {
        throw RzError(`extra fields after parsing: consumed=${i}, total=${fields.length}`);
    }

    return result;
}