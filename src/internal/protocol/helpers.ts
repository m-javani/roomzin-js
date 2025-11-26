import { Codecs } from '../../types/codecs';
import { RzError } from '../err';

// bitmaskToRateFeatureStrings converts 24-bit mask → string[] (matches Rust bitmask_to_rate_feature_string)
export function bitmaskToRateFeatureStrings(codecs: Codecs | null, mask: number): string[] {
    if (!codecs || !codecs.rateFeatures) {
        return [];
    }

    const out: string[] = [];
    for (let i = 0; i < 24 && i < codecs.rateFeatures.length; i++) {
        if (mask & (1 << i)) {
            out.push(codecs.rateFeatures[i]);
        }
    }
    return out;
}

// u16ToDate unpacks the 16-bit packed date (same bit layout as Rust)
export function u16ToDate(packed: number): string {
    const yearOffset = (packed >> 9) & 0b111;          // 0-7
    const month = ((packed >> 5) & 0b1111) + 1;   // 1-12
    const day = (packed & 0b11111) + 1;         // 1-31

    const baseYear = new Date().getFullYear();

    // Use the UTC constructor overload
    const date = new Date(Date.UTC(baseYear + yearOffset, month - 1, day, 0, 0, 0, 0));

    // validation (UTC values)
    if (date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
        throw RzError('invalid packed date');
    }

    // ISO string is already UTC, just drop the time part
    return date.toISOString().split('T')[0];
}


export function makeF64(v: number): Buffer {
    const buf = Buffer.alloc(8);
    buf.writeDoubleLE(v);
    return buf;
}

export function makeU64(v: number): Buffer {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(BigInt(v));
    return buf;
}

export function makeU32(v: number): Buffer {
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(v);
    return buf;
}

export function bytesToPropertyID(data: Buffer): string {
    // 1. Too short → return empty
    if (data.length < 7) {
        return "";
    }

    // 2. Short string marker
    if (data[6] === 0xF0) {
        // Left segment: 0..5
        let leftLen = 0;
        for (let i = 0; i < 6; i++) {
            if (i >= data.length || data[i] === 0) break;
            leftLen++;
        }

        // Right segment: 7..15
        let rightLen = 0;
        for (let i = 7; i < data.length; i++) {
            if (data[i] === 0) break;
            rightLen++;
        }

        const result = Buffer.alloc(leftLen + rightLen);
        data.copy(result, 0, 0, leftLen);
        data.copy(result, leftLen, 7, 7 + rightLen);
        return result.toString('utf8');
    }

    // 3. UUID detection (valid version)
    const version = (data[6] & 0xF0) >> 4;
    if ([1, 2, 3, 4, 5, 7].includes(version)) {
        const uuidBytes = Buffer.alloc(16);
        if (data.length >= 16) {
            data.copy(uuidBytes, 0, 0, 16);
        } else {
            data.copy(uuidBytes, 0); // pad remaining with zeros
        }

        try {
            // Convert to UUID string format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
            const hex = uuidBytes.toString('hex');
            return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
        } catch {
            // Invalid UUID, fall through
        }
    }

    // This should never happen with proper server data
    return "";
}