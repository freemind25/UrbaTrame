const MAX_ARCHIVE_BYTES = 30 * 1024 * 1024;
const MAX_TOTAL_OUTPUT_BYTES = 30 * 1024 * 1024;
const MAX_ENTRY_BYTES = 15 * 1024 * 1024;
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
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function inflateRaw(bytes, maxOutputLength = MAX_ENTRY_BYTES) {
  if (typeof DecompressionStream === 'function') {
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      const reader = stream.getReader(), chunks = []; let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxOutputLength) { await reader.cancel(); fail('ZIP_ENTRY_TOO_LARGE'); }
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
    try {
      const { inflateRawSync } = await import('node:zlib');
      const output = inflateRawSync(bytes, { maxOutputLength });
      return output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength);
    } catch { fail('ZIP_INVALID'); }
  }
  fail('ZIP_COMPRESSION_UNSUPPORTED');
}

function asArrayBuffer(value) {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  return null;
}

async function extractZipEntries(value, { wanted, requiredExt, maxEntryBytes = MAX_ENTRY_BYTES, maxArchiveBytes = MAX_ARCHIVE_BYTES } = {}) {
  const buffer = asArrayBuffer(value);
  if (!buffer || buffer.byteLength < 22 || buffer.byteLength > maxArchiveBytes) fail('ZIP_INVALID');
  const view = new DataView(buffer);
  const lowerBound = Math.max(0, view.byteLength - 65_557);
  let eocd = -1;
  for (let offset = view.byteLength - 22; offset >= lowerBound; offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0 || eocd + 22 > view.byteLength) fail('ZIP_INVALID');
  const disk = view.getUint16(eocd + 4, true), directoryDisk = view.getUint16(eocd + 6, true);
  const diskCount = view.getUint16(eocd + 8, true), count = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true), directoryOffset = view.getUint32(eocd + 16, true);
  if (disk !== 0 || directoryDisk !== 0 || diskCount !== count || count > 2048 || directoryOffset + directorySize > eocd)
    fail('ZIP_INVALID');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const files = [];
  let offset = directoryOffset, outputBytes = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > view.byteLength || view.getUint32(offset, true) !== 0x02014b50) fail('ZIP_INVALID');
    const flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true);
    const checksum = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true), uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true), extraLength = view.getUint16(offset + 30, true), commentLength = view.getUint16(offset + 32, true);
    const startDisk = view.getUint16(offset + 34, true), localOffset = view.getUint32(offset + 42, true);
    const nameStart = offset + 46, next = nameStart + nameLength + extraLength + commentLength;
    if (next > view.byteLength || startDisk !== 0) fail('ZIP_INVALID');
    let pathName;
    try { pathName = decoder.decode(new Uint8Array(buffer, nameStart, nameLength)).replaceAll('\\', '/'); }
    catch { fail('ZIP_INVALID'); }
    offset = next;
    if (pathName.endsWith('/')) continue;
    const pathParts = pathName.split('/');
    if (pathName.startsWith('/') || pathParts.some(part => part === '..')) fail('ZIP_INVALID');
    if (!wanted.test(pathName)) continue;
    if (flags & 1 || flags & 0x40) fail('ZIP_ENCRYPTED');
    if (flags & 0x20 || ![0, 8].includes(method)) fail('ZIP_COMPRESSION_UNSUPPORTED');
    if (uncompressedSize > maxEntryBytes || compressedSize > maxArchiveBytes) fail('ZIP_ENTRY_TOO_LARGE');
    outputBytes += uncompressedSize;
    if (outputBytes > MAX_TOTAL_OUTPUT_BYTES) fail('ZIP_ENTRY_TOO_LARGE');
    if (localOffset + 30 > view.byteLength || view.getUint32(localOffset, true) !== 0x04034b50) fail('ZIP_INVALID');
    const localFlags = view.getUint16(localOffset + 6, true), localMethod = view.getUint16(localOffset + 8, true);
    const localNameLength = view.getUint16(localOffset + 26, true), localExtraLength = view.getUint16(localOffset + 28, true);
    if (localFlags !== flags || localMethod !== method) fail('ZIP_INVALID');
    const localNameStart = localOffset + 30;
    if (localNameStart + localNameLength + localExtraLength > view.byteLength) fail('ZIP_INVALID');
    let localName;
    try { localName = decoder.decode(new Uint8Array(buffer, localNameStart, localNameLength)).replaceAll('\\', '/'); }
    catch { fail('ZIP_INVALID'); }
    if (localName !== pathName) fail('ZIP_INVALID');
    const dataStart = localNameStart + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > view.byteLength) fail('ZIP_INVALID');
    const compressed = new Uint8Array(buffer, dataStart, compressedSize);
    const data = method === 0 ? compressed.slice().buffer : await inflateRaw(compressed, maxEntryBytes);
    if (data.byteLength !== uncompressedSize) fail('ZIP_INVALID');
    const bytes = new Uint8Array(data);
    if (crc32(bytes) !== checksum) fail('ZIP_INVALID');
    files.push({ name: pathParts.at(-1), path: pathName, buffer: data, size: data.byteLength });
  }
  if (!files.some(file => file.name.toLowerCase().endsWith(requiredExt))) fail(requiredExt === '.shp' ? 'ZIP_NO_SHP' : 'ZIP_NO_KML');
  return files;
}

export async function extractShapefileZip(value) {
  return extractZipEntries(value, { wanted: /\.(?:shp|dbf|prj|cpg)$/i, requiredExt: '.shp' });
}

export async function extractKmlFromZip(value) {
  const files = await extractZipEntries(value, { wanted: /\.kml$/i, requiredExt: '.kml' });
  files.sort((a, b) => (a.path.toLowerCase() === 'doc.kml' ? -1 : b.path.toLowerCase() === 'doc.kml' ? 1 : 0));
  return files[0];
}
