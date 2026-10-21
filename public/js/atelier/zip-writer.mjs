/* Petit écrivain ZIP sans compression pour exporter des KMZ autonomes. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function fail(code) { const error = new Error(code); error.code = code; throw error; }
function asBytes(value) {
  if (typeof value === 'string') return new TextEncoder().encode(value);
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  fail('ZIP_WRITE_INPUT_INVALID');
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function createStoredZip(entries, { maxBytes = 30 * 1024 * 1024, maxEntries = 128 } = {}) {
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > maxEntries) fail('ZIP_WRITE_ENTRIES_INVALID');
  const encoder = new TextEncoder();
  const files = entries.map(entry => {
    const name = String(entry?.name || '').replaceAll('\\', '/');
    if (!name || name.startsWith('/') || name.split('/').some(part => part === '..' || part === '')) fail('ZIP_WRITE_NAME_INVALID');
    const nameBytes = encoder.encode(name);
    if (!nameBytes.length || nameBytes.length > 65_535) fail('ZIP_WRITE_NAME_INVALID');
    const data = asBytes(entry.data);
    if (data.byteLength > 0xffffffff) fail('ZIP_WRITE_TOO_LARGE');
    return { name, nameBytes, data, crc: crc32(data) };
  });
  const totalData = files.reduce((sum, file) => sum + file.data.byteLength, 0);
  const centralLength = files.reduce((sum, file) => sum + 46 + file.nameBytes.byteLength, 0);
  const totalLength = totalData + files.reduce((sum, file) => sum + 30 + file.nameBytes.byteLength, 0) + centralLength + 22;
  if (totalLength > maxBytes || totalLength > 0xffffffff || totalData > 0xffffffff) fail('ZIP_WRITE_TOO_LARGE');
  const output = new Uint8Array(totalLength), view = new DataView(output.buffer);
  let cursor = 0;
  const localOffsets = [];
  for (const file of files) {
    localOffsets.push(cursor);
    view.setUint32(cursor, 0x04034b50, true);
    view.setUint16(cursor + 4, 20, true);
    view.setUint16(cursor + 6, 0x0800, true);
    view.setUint16(cursor + 8, 0, true);
    view.setUint16(cursor + 10, 0, true);
    view.setUint16(cursor + 12, 0, true);
    view.setUint32(cursor + 14, file.crc, true);
    view.setUint32(cursor + 18, file.data.byteLength, true);
    view.setUint32(cursor + 22, file.data.byteLength, true);
    view.setUint16(cursor + 26, file.nameBytes.byteLength, true);
    view.setUint16(cursor + 28, 0, true);
    cursor += 30;
    output.set(file.nameBytes, cursor); cursor += file.nameBytes.byteLength;
    output.set(file.data, cursor); cursor += file.data.byteLength;
  }
  const centralOffset = cursor;
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    view.setUint32(cursor, 0x02014b50, true);
    view.setUint16(cursor + 4, 20, true);
    view.setUint16(cursor + 6, 20, true);
    view.setUint16(cursor + 8, 0x0800, true);
    view.setUint16(cursor + 10, 0, true);
    view.setUint16(cursor + 12, 0, true);
    view.setUint16(cursor + 14, 0, true);
    view.setUint32(cursor + 16, file.crc, true);
    view.setUint32(cursor + 20, file.data.byteLength, true);
    view.setUint32(cursor + 24, file.data.byteLength, true);
    view.setUint16(cursor + 28, file.nameBytes.byteLength, true);
    view.setUint16(cursor + 30, 0, true);
    view.setUint16(cursor + 32, 0, true);
    view.setUint16(cursor + 34, 0, true);
    view.setUint16(cursor + 36, 0, true);
    view.setUint32(cursor + 38, 0, true);
    view.setUint32(cursor + 42, localOffsets[index], true);
    cursor += 46;
    output.set(file.nameBytes, cursor); cursor += file.nameBytes.byteLength;
  }
  const centralSize = cursor - centralOffset;
  view.setUint32(cursor, 0x06054b50, true);
  view.setUint16(cursor + 4, 0, true);
  view.setUint16(cursor + 6, 0, true);
  view.setUint16(cursor + 8, files.length, true);
  view.setUint16(cursor + 10, files.length, true);
  view.setUint32(cursor + 12, centralSize, true);
  view.setUint32(cursor + 16, centralOffset, true);
  view.setUint16(cursor + 20, 0, true);
  return output;
}
