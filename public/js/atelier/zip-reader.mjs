const MAX_ARCHIVE_BYTES = 30 * 1024 * 1024;
const MAX_ENTRY_BYTES = 15 * 1024 * 1024;
const wanted = /\.(?:shp|dbf|prj|cpg)$/i;

function fail(code) { const error = new Error(code); error.code = code; throw error; }

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'function') {
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      const reader = stream.getReader(), chunks = []; let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_ENTRY_BYTES) { await reader.cancel(); fail('ZIP_ENTRY_TOO_LARGE'); }
        chunks.push(value);
      }
      const output = new Uint8Array(total); let cursor = 0;
      for (const chunk of chunks) { output.set(chunk, cursor); cursor += chunk.byteLength; }
      return output.buffer;
    } catch (error) {
      if (error?.code) throw error;
    }
  }
  if (typeof process !== 'undefined' && process.versions?.node) {
    const { inflateRawSync } = await import('node:zlib');
    const output = inflateRawSync(bytes, { maxOutputLength: MAX_ENTRY_BYTES });
    return output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength);
  }
  fail('ZIP_COMPRESSION_UNSUPPORTED');
}

export async function extractShapefileZip(value) {
  const buffer = value instanceof ArrayBuffer ? value : ArrayBuffer.isView(value)
    ? value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) : null;
  if (!buffer || buffer.byteLength < 22 || buffer.byteLength > MAX_ARCHIVE_BYTES) fail('ZIP_INVALID');
  const view = new DataView(buffer);
  const lowerBound = Math.max(0, view.byteLength - 65_557);
  let eocd = -1;
  for (let offset = view.byteLength - 22; offset >= lowerBound; offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) fail('ZIP_INVALID');
  const count = view.getUint16(eocd + 10, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  if (count > 2048 || directoryOffset >= view.byteLength) fail('ZIP_INVALID');
  const decoder = new TextDecoder('utf-8');
  const files = [];
  let offset = directoryOffset;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > view.byteLength || view.getUint32(offset, true) !== 0x02014b50) fail('ZIP_INVALID');
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const nameStart = offset + 46;
    const next = nameStart + nameLength + extraLength + commentLength;
    if (next > view.byteLength) fail('ZIP_INVALID');
    const name = decoder.decode(new Uint8Array(buffer, nameStart, nameLength)).replace(/\\/g, '/');
    offset = next;
    if (!wanted.test(name) || name.endsWith('/')) continue;
    if (flags & 1) fail('ZIP_ENCRYPTED');
    if (![0, 8].includes(method)) fail('ZIP_COMPRESSION_UNSUPPORTED');
    if (uncompressedSize > MAX_ENTRY_BYTES || compressedSize > MAX_ARCHIVE_BYTES) fail('ZIP_ENTRY_TOO_LARGE');
    if (localOffset + 30 > view.byteLength || view.getUint32(localOffset, true) !== 0x04034b50) fail('ZIP_INVALID');
    const localName = view.getUint16(localOffset + 26, true), localExtra = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localName + localExtra;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > view.byteLength) fail('ZIP_INVALID');
    const compressed = new Uint8Array(buffer, dataStart, compressedSize);
    const data = method === 0 ? compressed.slice().buffer : await inflateRaw(compressed);
    if (data.byteLength !== uncompressedSize) fail('ZIP_INVALID');
    files.push({ name: name.split('/').at(-1), buffer: data, size: data.byteLength });
  }
  if (!files.some(file => file.name.toLowerCase().endsWith('.shp'))) fail('ZIP_NO_SHP');
  return files;
}
