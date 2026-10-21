import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAX_IMPORT_BYTES, MAX_FEATURES, MAX_COORDINATE_POSITIONS, parseGeoJSONText, parseDelimitedText,
  detectCoordinateFields, csvToGeoJSON, extentOfFeatures, exportVisibleGeoJSON,
  normalizeCrs, toWgs84, countFeaturePositions
} from '../public/js/atelier/local-layers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function point(lon, lat, properties = {}) {
  return { type: 'Feature', properties, geometry: { type: 'Point', coordinates: [lon, lat] } };
}

describe('UrbaTrame · couches vectorielles locales', () => {
  test('importe une FeatureCollection GeoJSON WGS 84 et conserve géométries et attributs', () => {
    const input = {
      type: 'FeatureCollection', name: 'Terrain',
      features: [point(6.7, 36.2, { nom: 'Place', valeur: 12 }), {
        type: 'Feature', properties: { type: 'chemin' },
        geometry: { type: 'LineString', coordinates: [[6.69, 36.2], [6.71, 36.21]] }
      }]
    };
    const result = parseGeoJSONText(JSON.stringify(input), { fileName: 'terrain.geojson' });
    assert.equal(result.type, 'FeatureCollection');
    assert.equal(result.name, 'Terrain');
    assert.equal(result.crs, 'EPSG:4326');
    assert.equal(result.features.length, 2);
    assert.deepEqual(result.features[0].properties, { nom: 'Place', valeur: 12 });
    assert.deepEqual(result.features[0].geometry.coordinates, [6.7, 36.2]);
  });

  test('préserve les métadonnées de dérivation et de pagination sans avaler de métadonnées volumineuses', () => {
    const input = {
      type: 'FeatureCollection', remotePages: 5, remoteTruncated: true, remoteTruncationReason: 'FEATURE_LIMIT',
      urbatrameDerivation: { operation: 'buffer-lines', radiusMeters: 25, dissolved: false },
      urbatrame: { sources: [{ name: 'Voirie', source: 'OSM' }] }, features: [point(6.7, 36.2)]
    };
    const parsed = parseGeoJSONText(JSON.stringify(input));
    assert.equal(parsed.remotePages, 5);
    assert.equal(parsed.remoteTruncated, true);
    assert.equal(parsed.remoteTruncationReason, 'FEATURE_LIMIT');
    assert.deepEqual(parsed.urbatrameDerivation, input.urbatrameDerivation);
    assert.deepEqual(parsed.urbatrame, input.urbatrame);
    const oversized = parseGeoJSONText(JSON.stringify({ ...input, urbatrameDerivation: { note: 'x'.repeat(16_001) } }));
    assert.equal(oversized.features.length, 1);
    assert.equal(oversized.urbatrameDerivation, undefined);
  });

  test('accepte une Feature et une géométrie seules en les normalisant en collection', () => {
    const feature = parseGeoJSONText(JSON.stringify(point(2.3, 48.8)), { fileName: 'un.geojson' });
    const geometry = parseGeoJSONText(JSON.stringify({ type: 'Point', coordinates: [2.3, 48.8] }));
    const noProperties = parseGeoJSONText(JSON.stringify({ type: 'Feature', geometry: { type: 'Point', coordinates: [2.3, 48.8] } }));
    assert.equal(feature.features.length, 1);
    assert.equal(geometry.features.length, 1);
    assert.deepEqual(geometry.features[0].properties, {});
    assert.deepEqual(noProperties.features[0].properties, {});
  });

  test('refuse les systèmes de coordonnées inconnus et les coordonnées hors plages', () => {
    const projected = { type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'EPSG:4269' } }, features: [point(0, 0)] };
    assert.throws(() => parseGeoJSONText(JSON.stringify(projected)), error => error.code === 'UNSUPPORTED_CRS');
    assert.throws(() => parseGeoJSONText(JSON.stringify({ type: 'FeatureCollection', features: [point(181, 0)] })), error => error.code === 'COORDINATE_OUT_OF_RANGE');
    assert.throws(() => parseGeoJSONText('{'), error => error.code === 'INVALID_JSON');
    assert.throws(() => parseGeoJSONText(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Circle', coordinates: [0, 0] } }] })), error => error.code === 'UNSUPPORTED_GEOMETRY');
    assert.throws(() => parseGeoJSONText(JSON.stringify({ type: 'Point', coordinates: [[0, 0]] })), error => error.code === 'INVALID_COORDINATES');
  });

  test('reprojette explicitement GeoJSON et CSV depuis Web Mercator et UTM WGS 84', () => {
    const lon = 6.6969, lat = 36.2642, radius = 6378137;
    const x3857 = lon * Math.PI / 180 * radius;
    const y3857 = Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) * radius;
    const converted3857 = toWgs84(x3857, y3857, 'EPSG:3857');
    assert.ok(Math.abs(converted3857[0] - lon) < 1e-8);
    assert.ok(Math.abs(converted3857[1] - lat) < 1e-8);
    const convertedUtm = toWgs84(293104.763959, 4015713.156033, 'EPSG:32632');
    assert.ok(Math.abs(convertedUtm[0] - lon) < 1e-6);
    assert.ok(Math.abs(convertedUtm[1] - lat) < 1e-6);
    const convertedSouth = toWgs84(334435.70614, 6250816.39775, 'EPSG:32756');
    assert.ok(Math.abs(convertedSouth[0] - 151.21) < 1e-6);
    assert.ok(Math.abs(convertedSouth[1] + 33.87) < 1e-6);
    assert.equal(normalizeCrs('urn:ogc:def:crs:EPSG::32632'), 'EPSG:32632');
    const fc = {
      type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'EPSG:3857' } },
      features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [x3857, y3857] } }]
    };
    const imported = parseGeoJSONText(JSON.stringify(fc));
    assert.equal(imported.sourceCrs, 'EPSG:3857');
    assert.equal(imported.crs, 'EPSG:4326');
    assert.ok(Math.abs(imported.features[0].geometry.coordinates[0] - lon) < 1e-8);
    const stringCrs = parseGeoJSONText(JSON.stringify({ type: 'FeatureCollection', crs: 'EPSG:3857', features: fc.features }));
    assert.equal(stringCrs.sourceCrs, 'EPSG:3857');
    assert.ok(Math.abs(stringCrs.features[0].geometry.coordinates[0] - lon) < 1e-8);
    const csv = parseDelimitedText('x;y;name\n293104.763959;4015713.156033;Site\n');
    const points = csvToGeoJSON(csv, { longitude: 'x', latitude: 'y', sourceCrs: 'EPSG:32632' });
    assert.ok(Math.abs(points.features[0].geometry.coordinates[0] - lon) < 1e-6);
    assert.equal(points.sourceCrs, 'EPSG:32632');
  });

  test('détecte séparateur, en-têtes et coordonnées CSV; gère les guillemets et décimales françaises', () => {
    const table = parseDelimitedText('\uFEFFnom;longitude;latitude;note\r\n"Place, centrale";6,7001;36,2002;"dit \""bonjour\"""\r\n');
    assert.equal(table.delimiter, ';');
    assert.deepEqual(detectCoordinateFields(table.headers), { longitude: 'longitude', latitude: 'latitude' });
    assert.equal(table.rows[0].nom, 'Place, centrale');
    assert.equal(table.rows[0].note, 'dit "bonjour"');
    const geojson = csvToGeoJSON(table, { longitude: 'longitude', latitude: 'latitude', fileName: 'lieux.csv' });
    assert.equal(geojson.features.length, 1);
    assert.deepEqual(geojson.features[0].geometry.coordinates, [6.7001, 36.2002]);
    assert.equal(geojson.features[0].properties.nom, 'Place, centrale');
  });

  test('CSV impose deux colonnes choisies distinctes et des coordonnées WGS 84 valides', () => {
    const table = parseDelimitedText('x,y,nom\n6.7,36.2,Site\n');
    assert.deepEqual(detectCoordinateFields(table.headers), { longitude: 'x', latitude: 'y' });
    assert.throws(() => csvToGeoJSON(table, { longitude: 'x', latitude: 'x' }), error => error.code === 'CSV_COORD_FIELDS_REQUIRED');
    const bad = parseDelimitedText('lon,lat\n6.7,95\n');
    assert.throws(() => csvToGeoJSON(bad, { longitude: 'lon', latitude: 'lat' }), error => error.code === 'CSV_COORDINATE_INVALID');
    assert.throws(() => parseDelimitedText('nom,lat\n"non fermé,36\n'), error => error.code === 'CSV_UNCLOSED_QUOTE');
  });

  test('applique des limites explicites de taille et de nombre d’entités', () => {
    assert.equal(MAX_IMPORT_BYTES, 15 * 1024 * 1024);
    assert.equal(MAX_FEATURES, 20_000);
    assert.equal(MAX_COORDINATE_POSITIONS, 100_000);
    assert.throws(() => parseGeoJSONText(' '.repeat(MAX_IMPORT_BYTES + 1)), error => error.code === 'FILE_TOO_LARGE');
    const oversized = { type: 'FeatureCollection', features: Array.from({ length: MAX_FEATURES + 1 }, () => point(0, 0)) };
    assert.throws(() => parseGeoJSONText(JSON.stringify(oversized)), error => error.code === 'TOO_MANY_FEATURES');
    const tooDetailed = { type: 'LineString', coordinates: Array.from({ length: MAX_COORDINATE_POSITIONS + 1 }, () => [0, 0]) };
    assert.throws(() => parseGeoJSONText(JSON.stringify(tooDetailed)), error => error.code === 'TOO_MANY_COORDINATES');
  });

  test('calcule l’emprise et exporte uniquement les couches visibles avec la provenance', () => {
    const features = [point(6, 36), { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[5, 35], [7, 37]] } }];
    assert.deepEqual(extentOfFeatures(features), { west: 5, south: 35, east: 7, north: 37 });
    const layers = [
      { name: 'Terrain', source: 'Relevé 2026', importedAt: '2026-10-17T10:00:00.000Z', lastEditedAt: '2026-10-17T11:00:00.000Z', visible: true, geojson: { features: [features[0]] } },
      { name: 'Masquée', source: 'Autre source', importedAt: '2026-10-17T10:00:00.000Z', visible: false, geojson: { features: [features[1]] } }
    ];
    const result = exportVisibleGeoJSON(layers, { now: new Date('2026-10-17T12:00:00.000Z') });
    assert.equal(result.features.length, 1);
    assert.equal(result.features[0].geometry.coordinates[0], 6);
    assert.deepEqual(result.urbatrame.sources, [{ name: 'Terrain', fileName: 'Terrain', source: 'Relevé 2026', crs: 'EPSG:4326', sourceCrs: 'EPSG:4326', importedAt: '2026-10-17T10:00:00.000Z', lastEditedAt: '2026-10-17T11:00:00.000Z', featureCount: 1 }]);
    assert.equal(result.urbatrame.exportedAt, '2026-10-17T12:00:00.000Z');
  });

  test('inclut le statut de pagination et la dérivation dans la provenance exportée', () => {
    const derivation = { operation: 'buffer-lines', radiusMeters: 50, dissolved: false };
    const layers = [{
      name: 'Service distant', source: 'WFS · producteur', importedAt: '2026-10-17T10:00:00.000Z', visible: true,
      geojson: { remotePages: 5, remoteTruncated: true, remoteTruncationReason: 'PAGE_LIMIT', urbatrameDerivation: derivation, features: [point(6.7, 36.2)] }
    }];
    const exported = exportVisibleGeoJSON(layers);
    assert.deepEqual(exported.urbatrame.sources[0].remoteImport, { pages: 5, truncated: true, limit: 'PAGE_LIMIT' });
    assert.deepEqual(exported.urbatrame.sources[0].derivation, derivation);
    const roundTrip = parseGeoJSONText(JSON.stringify(exported));
    assert.equal(roundTrip.urbatrame.sources[0].remoteImport.truncated, true);
  });

  test('compte les positions vectorielles dans les géométries imbriquées', () => {
    const features = [point(6, 36), { type: 'Feature', properties: {}, geometry: { type: 'GeometryCollection', geometries: [
      { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
      { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }
    ] } }];
    assert.equal(countFeaturePositions(features), 7);
  });

  test('l’atelier est intégré aux navigations UrbaTrame et expose ses limites de phase 1', () => {
    const page = fs.readFileSync(path.join(ROOT, 'public/atelier-cartographique.html'), 'utf8');
    const home = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
    assert.match(page, /Atelier cartographique/);
    assert.match(page, /Designed by M\.SADI/);
    assert.match(page, /EPSG:4326/);
    assert.match(page, /Les fichiers locaux ne sont jamais téléversés/);
    assert.match(page, /local-layers-ui\.mjs/);
    assert.match(home, /href="\/atelier-cartographique\.html"/);
    for (const file of ['public/atelier.html', 'public/atelier-analyse.html', 'public/atelier-s5.html']) {
      assert.match(fs.readFileSync(path.join(ROOT, file), 'utf8'), /href="\/atelier-cartographique\.html"/);
    }
  });
});
