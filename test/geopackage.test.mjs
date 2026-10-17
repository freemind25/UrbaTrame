import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { decodeGeoPackageGeometry, GEOPACKAGE_APPLICATION_ID, parseGeoPackage } from '../public/js/atelier/geopackage.mjs';
import { MAX_IMPORT_BYTES } from '../public/js/atelier/local-layers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = fs.readFileSync(path.join(ROOT, 'test/fixtures/geodata/donnees_test.gpkg'));
const SQL = await initSqlJs();

function gpkgPoint(x, y, { srsId = 32631, type = 1 } = {}) {
  const bytes = new Uint8Array(8 + 1 + 4 + 16);
  bytes[0] = 0x47; bytes[1] = 0x50; bytes[2] = 0; bytes[3] = 1;
  const view = new DataView(bytes.buffer);
  view.setInt32(4, srsId, true);
  bytes[8] = 1;
  view.setUint32(9, type, true);
  view.setFloat64(13, x, true); view.setFloat64(21, y, true);
  return bytes;
}

describe('UrbaTrame · import GeoPackage local', () => {
  test('lit les quatre couches vectorielles de l’échantillon synthétique et conserve les attributs', () => {
    const layers = parseGeoPackage(new Uint8Array(fixture), SQL, { fileName: 'donnees_test.gpkg' });
    assert.deepEqual(layers.map(layer => layer.name), ['axes', 'emprise', 'reperes', 'zones_analyse']);
    assert.deepEqual(layers.map(layer => layer.geojson.features.length), [2, 1, 4, 3]);
    for (const layer of layers) {
      assert.equal(layer.sourceCrs, 'EPSG:32631');
      assert.equal(layer.geojson.sourceCrs, 'EPSG:32631');
      assert.equal(layer.geojson.crs, 'EPSG:4326');
      assert.equal(layer.geojson.urbatrame.format, 'GeoPackage');
      assert.ok(layer.geojson.features.every(feature => feature.type === 'Feature'));
    }
    assert.deepEqual(layers.find(layer => layer.name === 'emprise').geojson.features[0].properties,
      { nom: 'Emprise de test', surface_m2: 6553600 });
    const firstPoint = layers.find(layer => layer.name === 'reperes').geojson.features[0];
    assert.deepEqual(firstPoint.properties, { id: 1, nom: 'P1', categorie: 'repere', altitude_m: 133.9600067138672 });
    assert.ok(Math.abs(firstPoint.geometry.coordinates[0] - 3.0044775) < 1e-6);
    assert.ok(Math.abs(firstPoint.geometry.coordinates[1] - 36.6901445) < 1e-6);
    assert.equal(layers.find(layer => layer.name === 'axes').geojson.features[0].geometry.type, 'LineString');
    assert.equal(layers.find(layer => layer.name === 'emprise').geojson.features[0].geometry.type, 'Polygon');
  });

  test('décode l’en-tête GeoPackage et WKB, et vérifie le CRS déclaré', () => {
    const geometry = decodeGeoPackageGeometry(gpkgPoint(500000, 4060000), 32631);
    assert.deepEqual(geometry, { type: 'Point', coordinates: [500000, 4060000] });
    assert.throws(() => decodeGeoPackageGeometry(gpkgPoint(500000, 4060000, { srsId: 4326 }), 32631), error => error.code === 'GPKG_SRS_MISMATCH');
    assert.throws(() => decodeGeoPackageGeometry(gpkgPoint(0, 0, { type: 8 }), 32631), error => error.code === 'GPKG_GEOMETRY_UNSUPPORTED');
    const badHeader = gpkgPoint(1, 2); badHeader[0] = 0;
    assert.throws(() => decodeGeoPackageGeometry(badHeader, 32631), error => error.code === 'GPKG_GEOMETRY_INVALID');
  });

  test('refuse une base SQLite qui ne déclare pas GeoPackage et les fichiers trop volumineux', () => {
    assert.equal(GEOPACKAGE_APPLICATION_ID, 0x47504b47);
    const db = new SQL.Database();
    db.run('PRAGMA application_id = 12345');
    const invalid = db.export();
    db.close();
    assert.throws(() => parseGeoPackage(invalid, SQL), error => error.code === 'GPKG_NOT_VALID');
    assert.throws(() => parseGeoPackage(new Uint8Array(MAX_IMPORT_BYTES + 1), SQL), error => error.code === 'FILE_TOO_LARGE');
    assert.throws(() => parseGeoPackage(new Uint8Array([1, 2, 3]), SQL), error => error.code === 'GPKG_INVALID');
  });
});
