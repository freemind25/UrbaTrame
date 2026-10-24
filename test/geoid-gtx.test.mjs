import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseGtxGrid, interpolateGeoidUndulation, orthometricHeight } from '../public/js/atelier/geoid-gtx.mjs';

function makeSyntheticGrid({ littleEndian = false, headerBytes = 40, south = 20, west = 10, deltaLat = 1, deltaLon = 1, values = [1, 2, 3, 4] } = {}) {
  const rows = 2, columns = 2;
  const bytes = new Uint8Array(headerBytes + values.length * 4);
  const view = new DataView(bytes.buffer);
  view.setFloat64(0, south, littleEndian); view.setFloat64(8, west, littleEndian);
  view.setFloat64(16, deltaLat, littleEndian); view.setFloat64(24, deltaLon, littleEndian);
  view.setInt32(32, rows, littleEndian); view.setInt32(36, columns, littleEndian);
  if (headerBytes === 44) view.setInt32(40, 1, littleEndian);
  values.forEach((value, index) => view.setFloat32(headerBytes + index * 4, value, littleEndian));
  return bytes;
}

describe('UrbaTrame · lecture locale GTX et conversion H = h − N', () => {
  test('lit une fixture synthétique big-endian à en-tête de 40 octets et interpole au centre', () => {
    const grid = parseGtxGrid(makeSyntheticGrid(), { fileName: 'synthetic-40.gtx' });
    assert.equal(grid.headerBytes, 40);
    assert.equal(grid.byteOrder, 'big-endian');
    assert.equal(grid.values.length, 4);
    assert.equal(interpolateGeoidUndulation(grid, 10.5, 20.5), 2.5);
    assert.equal(orthometricHeight(100, 2.5), 97.5);
    assert.equal(interpolateGeoidUndulation(grid, 12, 20), null);
  });

  test('lit une fixture synthétique little-endian à en-tête candidat de 44 octets et normalise la longitude', () => {
    const grid = parseGtxGrid(makeSyntheticGrid({
      littleEndian: true, headerBytes: 44, south: -2, west: 179, deltaLon: 2,
      values: [0.1, 0.2, 0.3, 0.4]
    }), { fileName: 'synthetic-44.gtx' });
    assert.equal(grid.headerBytes, 44);
    assert.equal(grid.byteOrder, 'little-endian');
    assert.ok(Math.abs(interpolateGeoidUndulation(grid, -180, -1.5) - 0.25) < 1e-6);
  });

  test('refuse un en-tête incohérent, un fichier trop volumineux et une conversion non numérique', () => {
    assert.throws(() => parseGtxGrid(new Uint8Array([1, 2, 3])), error => error.code === 'GTX_INVALID');
    assert.throws(() => parseGtxGrid(makeSyntheticGrid(), { maxBytes: 48 }), error => error.code === 'GTX_TOO_LARGE');
    assert.equal(orthometricHeight(null, 20), null);
  });
});
