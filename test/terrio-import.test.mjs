import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import initSqlJs from 'sql.js';
import * as GeoTIFF from 'geotiff';
import { parseGeoPackage } from '../public/js/atelier/geopackage.mjs';
import { parseGeoTiff } from '../public/js/atelier/geotiff-raster.mjs';
import {
  loadTerrio, importFileWithTerrio, terrioSupported, extensionOf
} from '../public/js/atelier/terrio-import.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// En Node, le glue wasm-bindgen ne suit pas les URL file: : on passe les octets du .wasm.
globalThis.__TERRIO_CORE_URL__ = pathToFileURL(path.join(ROOT, 'public/vendor/terrio/core/terrio.js')).href;
globalThis.__TERRIO_WASM_PATH__ = path.join(ROOT, 'public/vendor/terrio/core/terrio_bg.wasm');

const gpkgFixture = new Uint8Array(fs.readFileSync(path.join(ROOT, 'test/fixtures/geodata/donnees_test.gpkg')));
const tifFixture = new Uint8Array(fs.readFileSync(path.join(ROOT, 'test/fixtures/geodata/mnt_test.tif')));
const SQL = await initSqlJs();

function positionsOf(features) {
  const out = [];
  const walk = (coords) => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === 'number') { out.push(coords); return; }
    coords.forEach(walk);
  };
  for (const feature of features) walk(feature.geometry?.coordinates);
  return out.map(p => [Number(p[0]), Number(p[1])]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

describe('UrbaTrame · import local via terrio-js/core (vendored, auto-hébergé)', () => {
  test('les extensions SIG cibles sont reconnues, les autres non', () => {
    for (const ext of ['gpkg', 'fgb', 'geojson', 'json', 'kml', 'kmz', 'gml', 'gpx', 'tif', 'tiff'])
      assert.ok(terrioSupported(ext), ext);
    for (const ext of ['csv', 'tsv', 'zip', 'dxf', 'obj', 'glb', 'txt'])
      assert.ok(!terrioSupported(ext), ext);
    assert.equal(extensionOf('Couche.GPKG'), 'gpkg');
  });

  test('GeoPackage échantillon : parité couche par couche avec le lecteur sql.js', async () => {
    const legacy = parseGeoPackage(gpkgFixture, SQL, { fileName: 'donnees_test.gpkg' });
    const result = await importFileWithTerrio(gpkgFixture, 'donnees_test.gpkg');
    assert.equal(result.kind, 'vector');
    const byName = new Map(result.layers.map(layer => [layer.name, layer]));
    assert.deepEqual([...byName.keys()].sort(), legacy.map(layer => layer.name).sort());
    for (const old of legacy) {
      const neu = byName.get(old.name);
      assert.ok(neu, `couche ${old.name} présente`);
      assert.equal(neu.geojson.features.length, old.geojson.features.length, `nb entités · ${old.name}`);
      assert.equal(neu.geojson.crs, 'EPSG:4326');
      assert.equal(neu.geojson.sourceCrs, old.sourceCrs);
      assert.equal(neu.geojson.urbatrame.format, 'GeoPackage');
      const a = positionsOf(old.geojson.features), b = positionsOf(neu.geojson.features);
      assert.equal(a.length, b.length, `nb positions · ${old.name}`);
      for (let i = 0; i < a.length; i++)
        assert.ok(Math.abs(a[i][0] - b[i][0]) < 1e-6 && Math.abs(a[i][1] - b[i][1]) < 1e-6, `position ${i} · ${old.name}`);
      const oldKeys = Object.keys(old.geojson.features[0]?.properties || {});
      const neuProps = neu.geojson.features[0]?.properties || {};
      for (const key of oldKeys) assert.ok(key in neuProps, `attribut « ${key} » conservé · ${old.name}`);
    }
  });

  test('GeoTIFF échantillon : parité avec geotiff.js (géométrie, pixels, statistiques)', async () => {
    const legacy = await parseGeoTiff(tifFixture, GeoTIFF, { fileName: 'mnt_test.tif' });
    const result = await importFileWithTerrio(tifFixture, 'mnt_test.tif');
    assert.equal(result.kind, 'raster');
    const r = result.raster;
    assert.equal(r.width, legacy.width);
    assert.equal(r.height, legacy.height);
    assert.equal(r.samplesPerPixel, legacy.samplesPerPixel);
    assert.equal(r.sourceCrs, legacy.sourceCrs);
    assert.equal(r.noData, legacy.noData);
    assert.equal(r.pixelCount, legacy.pixelCount);
    assert.equal(r.validPixels, legacy.validPixels);
    assert.ok(Math.abs(r.bands[0].min - legacy.bands[0].min) < 1e-4, 'min bande 1');
    assert.ok(Math.abs(r.bands[0].max - legacy.bands[0].max) < 1e-3, 'max bande 1');
    for (const key of ['west', 'south', 'east', 'north'])
      assert.ok(Math.abs(r.boundsWgs84[key] - legacy.boundsWgs84[key]) < 1e-6, `emprise WGS84 ${key}`);
    assert.equal(r.values.length, legacy.values.length);
    for (let i = 0; i < r.values.length; i += 997)
      assert.ok(Math.abs(r.values[i] - legacy.values[i]) < 1e-3, `pixel ${i}`);
  });

  test('fichier illisible → TERRIO_PARSE_FAILED (l’UI retombe alors sur le lecteur historique)', async () => {
    await assert.rejects(
      () => importFileWithTerrio(new Uint8Array([1, 2, 3, 4, 5]), 'faux.gpkg'),
      (error) => error.code === 'TERRIO_PARSE_FAILED'
    );
  });

  test('extension non gérée par terrio → TERRIO_UNSUPPORTED_EXTENSION', async () => {
    await assert.rejects(
      () => importFileWithTerrio(new Uint8Array([1]), 'notes.txt'),
      (error) => error.code === 'TERRIO_UNSUPPORTED_EXTENSION'
    );
  });
});
