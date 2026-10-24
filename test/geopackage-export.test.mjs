import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';
import { createGeoPackage } from '../public/js/atelier/geopackage-export.mjs';
import { parseGeoPackage } from '../public/js/atelier/geopackage.mjs';

const require = createRequire(import.meta.url);
const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
let sqlPromise;
function sqlRuntime() { return sqlPromise ||= initSqlJs({ locateFile: () => wasmPath }); }

describe('UrbaTrame · export GeoPackage EPSG:4326', () => {
  test('exporte puis relit géométries, attributs et couche vide via sql.js', async () => {
    const SQL = await sqlRuntime();
    const layers = [
      {
        kind: 'vector', name: 'Relevé', source: 'Fiche locale · 2026', visible: true,
        geojson: { type: 'FeatureCollection', features: [{
          type: 'Feature', id: 'gnss-1',
          properties: { categorie: 'Mobilier', cote_m: -2.75, _urbaTrame: { source: 'GNSS navigateur' } },
          geometry: { type: 'Point', coordinates: [6.7, 36.2, 145.5] }
        }] }
      },
      { kind: 'vector', name: 'Vide', source: 'Gabarit', visible: true, geojson: { type: 'FeatureCollection', features: [] } },
      { kind: 'vector', name: 'Masquée', source: 'ne pas exporter', visible: false, geojson: { type: 'FeatureCollection', features: [] } }
    ];
    const bytes = createGeoPackage(layers, SQL);
    assert.ok(bytes.byteLength > 1000);
    const parsed = parseGeoPackage(bytes, SQL, { fileName: 'releve.gpkg' });
    assert.equal(parsed.length, 2);
    const [feature] = parsed[0].geojson.features;
    assert.deepEqual(feature.geometry.coordinates, [6.7, 36.2, 145.5]);
    assert.equal(feature.properties.cote_m, -2.75);
    assert.equal(feature.properties.categorie, 'Mobilier');
    assert.equal(feature.properties._urbaTrame, JSON.stringify({ source: 'GNSS navigateur' }));
    assert.equal(parsed[1].geojson.features.length, 0);
  });

  test('refuse l’absence de couche vectorielle et une dépendance SQL invalide', async () => {
    assert.throws(() => createGeoPackage([{ kind: 'raster', visible: true }], {}), error => error.code === 'GPKG_READER_UNAVAILABLE');
    const SQL = await sqlRuntime();
    assert.throws(() => createGeoPackage([{ kind: 'raster', visible: true }], SQL), error => error.code === 'GPKG_EXPORT_NO_VECTOR_LAYERS');
  });
});
