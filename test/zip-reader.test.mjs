import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { extractShapefileZip } from '../public/js/atelier/zip-reader.mjs';
import { parseShapefileBundle } from '../public/js/atelier/shapefile.mjs';

function pointShp() {
  const buffer = new ArrayBuffer(128), view = new DataView(buffer);
  view.setInt32(0, 9994, false); view.setInt32(24, 64, false); view.setInt32(28, 1000, true); view.setInt32(32, 1, true);
  view.setInt32(100, 1, false); view.setInt32(104, 10, false); view.setInt32(108, 1, true);
  view.setFloat64(112, 6.7, true); view.setFloat64(120, 36.2, true);
  return Buffer.from(buffer);
}

function makeZip(files) {
  const local = [], central = [];
  let localOffset = 0;
  for (const [name, value] of Object.entries(files)) {
    const fileName = Buffer.from(name), original = Buffer.from(value), compressed = deflateRawSync(original);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(8, 8); header.writeUInt32LE(0, 10); header.writeUInt32LE(0, 14);
    header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(original.length, 22);
    header.writeUInt16LE(fileName.length, 26); header.writeUInt16LE(0, 28);
    local.push(header, fileName, compressed);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x800, 8); entry.writeUInt16LE(8, 10); entry.writeUInt32LE(0, 12); entry.writeUInt32LE(0, 16);
    entry.writeUInt32LE(compressed.length, 20); entry.writeUInt32LE(original.length, 24);
    entry.writeUInt16LE(fileName.length, 28); entry.writeUInt16LE(0, 30); entry.writeUInt16LE(0, 32);
    entry.writeUInt16LE(0, 34); entry.writeUInt16LE(0, 36); entry.writeUInt32LE(0, 38); entry.writeUInt32LE(localOffset, 42);
    central.push(entry, fileName);
    localOffset += header.length + fileName.length + compressed.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...local, centralBytes, end]);
}

describe('UrbaTrame · archive Shapefile locale', () => {
  test('extrait un lot ZIP deflate et lit le SHP sans extraction sur le serveur', async () => {
    const archive = makeZip({ 'lot/carte.shp': pointShp(), 'lot/carte.prj': 'GEOGCS["WGS 84"]', 'lot/notes.txt': 'ignore' });
    const files = await extractShapefileZip(archive);
    assert.deepEqual(files.map(file => file.name).sort(), ['carte.prj', 'carte.shp']);
    const shp = files.find(file => file.name.endsWith('.shp'));
    const project = parseShapefileBundle({ shp: shp.buffer, sourceCrs: 'EPSG:4326' });
    assert.deepEqual(project.features[0].geometry.coordinates, [6.7, 36.2]);
  });

  test('refuse les archives tronquées et les lots sans SHP', async () => {
    await assert.rejects(extractShapefileZip(new Uint8Array([1, 2, 3])), error => error.code === 'ZIP_INVALID');
    const archive = makeZip({ 'readme.txt': 'pas de formes' });
    await assert.rejects(extractShapefileZip(archive), error => error.code === 'ZIP_NO_SHP');
  });
});
