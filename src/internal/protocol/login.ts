export function buildLoginPayload(token: string): Buffer {
    const cmdName = "LOGIN";

    // Calculate total size to pre-allocate Buffer
    const totalSize = 1 + cmdName.length + 2 + 2 + 1 + 4 + token.length;
    const buf = Buffer.alloc(totalSize);
    let offset = 0;

    // Write command name length and name
    buf.writeUInt8(cmdName.length, offset);
    offset += 1;
    buf.write(cmdName, offset, 'utf8');
    offset += cmdName.length;

    // Write field count (1 field)
    buf.writeUInt16LE(1, offset);
    offset += 2;

    // Write field ID (2 bytes)
    buf.writeUInt16LE(0x01, offset);
    offset += 2;

    // Write field type (string = 0x01)
    buf.writeUInt8(0x01, offset);
    offset += 1;

    // Write token length and token
    buf.writeUInt32LE(token.length, offset);
    offset += 4;
    buf.write(token, offset, 'utf8');

    return buf;
}