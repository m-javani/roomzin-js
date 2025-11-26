import { RzError } from '../err';
import { Header, Field, ErrShortFrame, ErrMissingMagic } from './types';

// PrependHeader takes the already-serialised payload (status string + fields)
// and returns a complete frame ready to write to the server:
// | magic(1) | clrid(4) | totalLen(4) | payload |
// totalLen == len(payload)
export function prependHeader(clrID: number, payload: Buffer): Buffer {
    const totalLen = payload.length;
    const out = Buffer.alloc(9 + totalLen);

    out[0] = 0xFF; // magic byte
    out.writeUInt32LE(clrID, 1); // clrID at position 1-4
    out.writeUInt32LE(totalLen, 5); // totalLen at position 5-8
    payload.copy(out, 9); // payload at position 9+

    return out;
}

// DrainFrame reads a full frame and returns header + raw payload.
// The payload starts at [statusLen][status][fieldCount]...fields
export async function drainFrame(stream: NodeJS.ReadableStream): Promise<[Header, Buffer]> {
    const fix = Buffer.alloc(9);

    // Read the fixed header (9 bytes)
    await readFull(stream, fix);

    // Frame layout: [0xFF][ClrID:4][payloadLen:4]
    if (fix[0] !== 0xFF) {
        throw RzError(`bad magic byte: got 0x${fix[0].toString(16).padStart(2, '0')}`);
    }

    const clrID = fix.readUInt32LE(1);
    const payloadLen = fix.readUInt32LE(5);

    // Read the payload
    const payload = Buffer.alloc(payloadLen);
    await readFull(stream, payload);

    if (payload.length < 1) {
        throw RzError("short frame: no statusLen");
    }

    const statusLen = payload[0];
    if (payload.length < 1 + statusLen + 2) {
        throw RzError("short frame: missing status or fieldCount");
    }

    const status = payload.toString('utf8', 1, 1 + statusLen);
    const fieldCnt = payload.readUInt16LE(1 + statusLen);

    const header: Header = {
        clrID,
        status,
        fieldCnt
    };

    return [header, payload];
}

// ParseFields decodes the flat field array from payload.
// The slice must start at the first field (not status).
export function parseFields(data: Buffer, fieldCount: number): Field[] {
    const fields: Field[] = [];
    let offset = 0;

    for (let i = 0; i < fieldCount; i++) {
        if (offset + 7 > data.length) {
            throw RzError(`short frame: not enough bytes for field header at field ${i}`);
        }

        const id = data.readUInt16LE(offset);
        const fieldType = data[offset + 2];
        const length = data.readUInt32LE(offset + 3);
        offset += 7;

        if (offset + length > data.length) {
            throw RzError(`short frame: not enough data for field payload (field ${i}, need ${length}, have ${data.length - offset})`);
        }

        const fieldData = Buffer.from(data.subarray(offset, offset + length));
        fields.push({
            id,
            fieldType,
            data: fieldData
        });
        offset += length;
    }

    // Rust version enforces: all fields must be consumed
    if (offset !== data.length) {
        throw RzError(`extra ${data.length - offset} bytes after parsing fields`);
    }

    return fields;
}

// Helper function to read exact number of bytes from stream
export function readFull(stream: NodeJS.ReadableStream, buffer: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
        let bytesRead = 0;

        const readChunk = () => {
            const chunk = stream.read(buffer.length - bytesRead) as Buffer | null;
            if (chunk) {
                chunk.copy(buffer, bytesRead);
                bytesRead += chunk.length;

                if (bytesRead === buffer.length) {
                    stream.removeListener('readable', readChunk);
                    stream.removeListener('error', onError);
                    stream.removeListener('end', onEnd);
                    resolve();
                }
            }
        };

        const onError = (error: Error) => {
            stream.removeListener('readable', readChunk);
            stream.removeListener('end', onEnd);
            reject(error);
        };

        const onEnd = () => {
            stream.removeListener('readable', readChunk);
            stream.removeListener('error', onError);
            if (bytesRead < buffer.length) {
                reject(new Error('stream ended before reading required bytes'));
            }
        };

        stream.on('readable', readChunk);
        stream.on('error', onError);
        stream.on('end', onEnd);

        // Trigger initial read
        readChunk();
    });
}