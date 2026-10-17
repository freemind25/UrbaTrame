import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { detectShapefileCrs, parseShapefileBundle } from '../public/js/atelier/shapefile.mjs';

function pointShp(x = 6.7, y = 36.2) {
  const buffer = new ArrayBuffer(128), view = new DataView(buffer);
  view.setInt32(0, 9994, false); view.setInt32(24, 64, false);
  view.setInt32(28, 1000, true); view.setInt32(32, 1, true);
  view.setInt32(100, 1, false); view.setInt32(104, 10, false);
  view.setInt32(108, 1, true); view.setFloat64(112, x, true); view.setFloat64(120, y, true);
  return buffer;
}

function pointDbf(name = 'Place') {
  const buffer = new ArrayBuffer(76), view = new DataView(buffer);
  view.setUint8(0, 3); view.setUint32(4, 1, true); view.setUint16(8, 65, true); view.setUint16(10, 11, true);
  const bytes = new Uint8Array(buffer);
  for (const [index, value] of [...'NAME'].entries()) bytes[32 + index] = value.charCodeAt(0);
  bytes[43] = 'C'.charCodeAt(0); bytes[48] = 10; bytes[64] = 0x0d;
  bytes[65] = 0x20;
  for (let i = 0; i < name.length; i++) bytes[66 + i] = name.charCodeAt(i);
  return buffer;
}

function polygonShp() {
  const points = [[0, 0], [0, 0.01], [0.01, 0.01], [0.01, 0], [0, 0]];
  const contentLength = 4 + 32 + 8 + 4 + points.length * 16;
  const buffer = new ArrayBuffer(100 + 8 + contentLength), view = new DataView(buffer);
  view.setInt32(0, 9994, false); view.setInt32(24, buffer.byteLength / 2, false);
  view.setInt32(28, 1000, true); view.setInt32(32, 5, true);
  view.setInt32(100, 1, false); view.setInt32(104, contentLength / 2, false);
  const start = 108; view.setInt32(start, 5, true);
  view.setFloat64(start + 4, 0, true); view.setFloat64(start + 12, 0, true);
  view.setFloat64(start + 20, 0.01, true); view.setFloat64(start + 28, 0.01, true);
  view.setInt32(start + 36, 1, true); view.setInt32(start + 40, points.length, true); view.setInt32(start + 44, 0, true);
  let offset = start + 48;
  for (const [x, y] of points) { view.setFloat64(offset, x, true); view.setFloat64(offset + 8, y, true); offset += 16; }
  return buffer;
}

describe('UrbaTrame · lecture Shapefile locale', () => {
  test('lit le SHP et la table DBF sans envoyer les fichiers', () => {
    const collection = parseShapefileBundle({ shp: pointShp(), dbf: pointDbf(), sourceCrs: 'EPSG:4326', fileName: 'places.shp' });
    assert.equal(collection.type, 'FeatureCollection');
    assert.equal(collection.features.length, 1);
    assert.equal(collection.features[0].properties.NAME, 'Place');
    assert.deepEqual(collection.features[0].geometry.coordinates, [6.7, 36.2]);
    assert.equal(collection.sourceCrs, 'EPSG:4326');
  });

  test('lit les polygones et convertit un Shapefile projeté vers WGS 84', () => {
    const projectedPoint = parseShapefileBundle({ shp: pointShp(293104.763959, 4015713.156033), sourceCrs: 'EPSG:32632' });
    assert.ok(Math.abs(projectedPoint.features[0].geometry.coordinates[0] - 6.6969) < 1e-6);
    assert.ok(Math.abs(projectedPoint.features[0].geometry.coordinates[1] - 36.2642) < 1e-6);
    const polygon = parseShapefileBundle({ shp: polygonShp(), sourceCrs: 'EPSG:4326' });
    assert.equal(polygon.features[0].geometry.type, 'Polygon');
    assert.equal(polygon.features[0].geometry.coordinates[0].length, 5);
  });

  test('détecte des CRS connus dans les WKT .prj et refuse une géométrie invalide', () => {
    assert.equal(detectShapefileCrs('PROJCS["WGS 84 / UTM zone 32N",AUTHORITY["EPSG","32632"]]'), 'EPSG:32632');
    assert.equal(detectShapefileCrs('GEOGCS["WGS 84",DATUM["World Geodetic System 1984"]]'), 'EPSG:4326');
    assert.equal(detectShapefileCrs('LOCAL_CS["Unknown"]'), '');
    assert.throws(() => parseShapefileBundle({ shp: pointShp(200, 95), sourceCrs: 'EPSG:4326' }), error => error.code === 'COORDINATE_OUT_OF_RANGE');
    assert.throws(() => parseShapefileBundle({ shp: pointShp() }), error => error.code === 'SHP_CRS_REQUIRED');
    assert.throws(() => parseShapefileBundle({ shp: new ArrayBuffer(40), sourceCrs: 'EPSG:4326' }), error => error.code === 'SHP_FILE_SIZE');
  });
});
