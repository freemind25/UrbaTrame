import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGeoJSONText } from '../public/js/atelier/local-layers.mjs';
import { parseLocalProject, serializeLocalProject } from '../public/js/atelier/project.mjs';
import { movePoint, setFeatureAttribute } from '../public/js/atelier/editing.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sampleTiff = new Uint8Array(fs.readFileSync(path.join(ROOT, 'test/fixtures/geodata/mnt_test.tif')));

const collection = parseGeoJSONText(JSON.stringify({
  type: 'FeatureCollection', remotePages: 2, remoteTruncated: true, remoteTruncationReason: 'PAGE_LIMIT',
  urbatrameDerivation: { operation: 'within-distance', distanceMeters: 500 },
  urbatrame: { sources: [{ name: 'Places', source: 'Survey · 2026' }] },
  features: [{ type: 'Feature', properties: { type: 'park', name: 'Square' }, geometry: { type: 'Point', coordinates: [6.1, 36.8] } }]
}));
const sampleLayer = {
  name: 'Places', fileName: 'places.geojson', source: 'Survey · 2026', importedAt: '2026-10-01T12:00:00.000Z',
  crs: 'EPSG:4326', sourceCrs: 'EPSG:3857', color: '#28734f', visible: true,
  categoryField: 'type', categoryColors: new Map([['park', '#388b89']]), labelField: 'name',
  filter: { field: 'type', value: 'park' }, geojson: collection
};

describe('UrbaTrame · projet cartographique local', () => {
  test('sérialise puis recharge géométries, attributs, style et provenance sans couche externe', () => {
    const saved = serializeLocalProject([sampleLayer], new Date('2026-10-17T12:00:00Z'));
    assert.equal(saved.format, 'UrbaTrameProject');
    assert.equal(saved.exportedAt, '2026-10-17T12:00:00.000Z');
    const [loaded] = parseLocalProject(JSON.stringify(saved));
    assert.equal(loaded.name, 'Places');
    assert.equal(loaded.sourceCrs, 'EPSG:3857');
    assert.equal(loaded.categoryColors.get('park'), '#388b89');
    assert.equal(loaded.labelField, 'name');
    assert.deepEqual(loaded.filter, { field: 'type', value: 'park' });
    assert.deepEqual(loaded.geojson.features[0].geometry.coordinates, [6.1, 36.8]);
    assert.equal(loaded.geojson.remotePages, 2);
    assert.equal(loaded.geojson.remoteTruncated, true);
    assert.equal(loaded.geojson.remoteTruncationReason, 'PAGE_LIMIT');
    assert.deepEqual(loaded.geojson.urbatrameDerivation, { operation: 'within-distance', distanceMeters: 500 });
    assert.deepEqual(loaded.geojson.urbatrame.sources[0].source, 'Survey · 2026');
    assert.equal('basemap' in loaded, false);
  });

  test('embarque le GeoTIFF source dans le projet local et le valide au rechargement', () => {
    const rasterLayer = {
      kind: 'raster', name: 'MNT test', fileName: 'mnt_test.tif', source: 'Échantillon synthétique',
      importedAt: '2026-10-17T12:00:00.000Z', sourceCrs: 'EPSG:32631', crs: 'EPSG:4326',
      color: '#28734f', visible: true, raster: { sourceBytes: sampleTiff, pixelCount: 256 * 256, opacity: 0.6 },
      geojson: { type: 'FeatureCollection', name: 'mnt_test.tif', crs: 'EPSG:4326', sourceCrs: 'EPSG:32631', features: [] }
    };
    const saved = JSON.stringify(serializeLocalProject([rasterLayer]));
    const [loaded] = parseLocalProject(saved);
    assert.equal(loaded.kind, 'raster');
    assert.equal(loaded.sourceCrs, 'EPSG:32631');
    assert.equal(loaded.raster.opacity, 0.6);
    assert.equal(loaded.raster.pixelCount, 256 * 256);
    assert.deepEqual(Buffer.from(loaded.raster.sourceDataBase64, 'base64'), Buffer.from(sampleTiff));
    const malformed = JSON.parse(saved); malformed.layers[0].raster.sourceDataBase64 = 'not-base64!';
    assert.throws(() => parseLocalProject(JSON.stringify(malformed)), error => error.code === 'PROJECT_RASTER_INVALID');
  });

  test('le projet sauvegarde les sommets et attributs modifiés, sans enregistrer l’historique de session', () => {
    const layer = { ...sampleLayer, geojson: JSON.parse(JSON.stringify(collection)), positionCount: 1, editHistory: { undo: [], redo: [] } };
    movePoint(layer, 0, 6.2, 36.9);
    setFeatureAttribute(layer, 0, 'validated', true);
    const [loaded] = parseLocalProject(JSON.stringify(serializeLocalProject([layer])));
    assert.deepEqual(loaded.geojson.features[0].geometry.coordinates, [6.2, 36.9]);
    assert.equal(loaded.geojson.features[0].properties.validated, true);
    assert.equal(loaded.lastEditedAt, layer.lastEditedAt);
    assert.deepEqual(loaded.editHistory.undo, []);
    assert.deepEqual(loaded.editHistory.redo, []);
  });

  test('refuse les formats, couches et CRS non valides', () => {
    assert.throws(() => parseLocalProject('{'), error => error.code === 'PROJECT_INVALID');
    assert.throws(() => parseLocalProject(JSON.stringify({ format: 'unknown', version: 1, layers: [] })), error => error.code === 'PROJECT_FORMAT');
    assert.throws(() => parseLocalProject(JSON.stringify({ format: 'UrbaTrameProject', version: 1, layers: Array(13).fill({}) })), error => error.code === 'PROJECT_TOO_MANY_LAYERS');
    const bad = { format: 'UrbaTrameProject', version: 1, layers: [{ ...sampleLayer, sourceCrs: 'EPSG:26910' }] };
    assert.throws(() => parseLocalProject(JSON.stringify(bad)), error => error.code === 'UNSUPPORTED_CRS');
  });
});
