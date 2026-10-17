import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bufferPointFeatures, bufferLineFeatures, destinationPoint, MAX_BUFFER_POINTS, MAX_BUFFER_LINE_SEGMENTS } from '../public/js/atelier/local-buffer.mjs';
import { parseGeoJSONText } from '../public/js/atelier/local-layers.mjs';

function distanceMeters(a, b) {
  const rad = Math.PI / 180, lat1 = a[1] * rad, lat2 = b[1] * rad;
  const dLat = lat2 - lat1, dLon = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.sqrt(h));
}

describe('UrbaTrame · tampon ponctuel local', () => {
  test('construit un anneau fermé de rayon géodésique annoncé et conserve la provenance', () => {
    const source = [{ type: 'Feature', id: 'poi-7', properties: { usage: 'place' }, geometry: { type: 'Point', coordinates: [6.7, 36.2] } }];
    const result = bufferPointFeatures(source, {
      radiusMeters: 100, segments: 24, sourceLayer: 'Places', source: 'Relevé local', importedAt: '2026-10-01T00:00:00.000Z', now: new Date('2026-10-17T12:00:00.000Z')
    });
    assert.equal(result.pointCount, 1);
    assert.equal(result.outputPositions, 25);
    assert.equal(result.generatedAt, '2026-10-17T12:00:00.000Z');
    const buffered = result.features[0];
    assert.equal(buffered.geometry.type, 'Polygon');
    const ring = buffered.geometry.coordinates[0];
    assert.equal(ring.length, 25);
    assert.deepEqual(ring[0], ring.at(-1));
    const signedArea = ring.slice(0, -1).reduce((area, point, index, points) => {
      const next = points[(index + 1) % points.length]; return area + point[0] * next[1] - next[0] * point[1];
    }, 0) / 2;
    assert.ok(signedArea > 0, 'l’anneau extérieur suit l’orientation GeoJSON antihoraire');
    assert.ok(Math.abs(distanceMeters([6.7, 36.2], ring[0]) - 100) < 0.01);
    assert.equal(buffered.properties._urbaTrameDerivation.sourceFeatureId, 'poi-7');
    assert.equal(buffered.properties._urbaTrameDerivation.dissolved, false);
    assert.equal(source[0].geometry.coordinates[0], 6.7, 'la couche source reste intacte');
  });

  test('traite les MultiPoint et GeometryCollection et borne les sorties', () => {
    const result = bufferPointFeatures([
      { type: 'Feature', properties: {}, geometry: { type: 'MultiPoint', coordinates: [[0, 0], [1, 1]] } },
      { type: 'Feature', properties: {}, geometry: { type: 'GeometryCollection', geometries: [{ type: 'Point', coordinates: [2, 2] }] } }
    ], { radiusMeters: 50, segments: 12 });
    assert.equal(result.pointCount, 3);
    assert.equal(result.features.length, 3);
    assert.equal(result.outputPositions, 39);
    assert.throws(() => bufferPointFeatures([{ type: 'Feature', geometry: { type: 'MultiPoint', coordinates: Array.from({ length: MAX_BUFFER_POINTS + 1 }, () => [0, 0]) } }], { radiusMeters: 10 }), error => error.code === 'RECIPE_BUFFER_COMPLEXITY');
  });

  test('normalise l’antiméridien et valide rayon, résolution et types de données', () => {
    const east = destinationPoint(179.999, 0, Math.PI / 2, 500);
    assert.ok(east[0] >= -180 && east[0] <= 180);
    assert.throws(() => bufferPointFeatures([], { radiusMeters: 0 }), error => error.code === 'RECIPE_BUFFER_RADIUS_INVALID');
    assert.throws(() => bufferPointFeatures([], { radiusMeters: 10, segments: 8 }), error => error.code === 'RECIPE_BUFFER_SEGMENTS_INVALID');
    assert.throws(() => bufferPointFeatures([{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } }], { radiusMeters: 10 }), error => error.code === 'RECIPE_BUFFER_POINTS_REQUIRED');
    assert.throws(() => bufferPointFeatures([{ type: 'Feature', geometry: { type: 'Point', coordinates: [181, 0] } }], { radiusMeters: 10 }), error => error.code === 'RECIPE_BUFFER_COORDINATE_INVALID');
    assert.throws(() => bufferPointFeatures([{ type: 'Feature', geometry: { type: 'Point', coordinates: [179.999, 0] } }], { radiusMeters: 500 }), error => error.code === 'RECIPE_BUFFER_ANTIMERIDIAN_UNSUPPORTED');
  });
});

describe('UrbaTrame · tampon indicatif de lignes', () => {
  test('construit une capsule fermée par segment, avec provenance et sans modifier la source', () => {
    const source = [{ type: 'Feature', id: 'road-7', properties: { highway: 'residential' }, geometry: { type: 'LineString', coordinates: [[0, 0], [0.01, 0]] } }];
    const before = JSON.stringify(source);
    const result = bufferLineFeatures(source, {
      radiusMeters: 100, segments: 24, sourceLayer: 'Voirie', source: 'OSM', importedAt: '2026-10-01T00:00:00.000Z', now: new Date('2026-10-17T12:00:00.000Z')
    });
    assert.equal(result.segmentCount, 1);
    assert.equal(result.outputPositions, 27);
    assert.equal(result.generatedAt, '2026-10-17T12:00:00.000Z');
    const buffer = result.features[0], ring = buffer.geometry.coordinates[0];
    assert.equal(buffer.geometry.type, 'Polygon');
    assert.equal(ring.length, 27);
    assert.deepEqual(ring[0], ring.at(-1));
    assert.equal(parseGeoJSONText(JSON.stringify({ type: 'FeatureCollection', features: result.features })).features.length, 1);
    assert.ok(distanceMeters([0, 0], ring[0]) > 99.9 && distanceMeters([0, 0], ring[0]) < 100.1);
    for (const point of ring.slice(0, 13)) assert.ok(Math.abs(distanceMeters([0, 0], point) - 100) < 0.02);
    for (const point of ring.slice(13, 26)) assert.ok(Math.abs(distanceMeters([0.01, 0], point) - 100) < 0.02);
    const signedArea = ring.slice(0, -1).reduce((area, point, index, points) => {
      const next = points[(index + 1) % points.length]; return area + point[0] * next[1] - next[0] * point[1];
    }, 0) / 2;
    assert.ok(signedArea > 0, 'la capsule extérieure respecte l’orientation GeoJSON antihoraire');
    assert.equal(buffer.properties._urbaTrameDerivation.sourceFeatureId, 'road-7');
    assert.equal(buffer.properties._urbaTrameDerivation.sourceSegmentIndex, 0);
    assert.equal(buffer.properties._urbaTrameDerivation.dissolved, false);
    assert.equal(JSON.stringify(source), before);
  });

  test('traite MultiLineString et GeometryCollection sans dissoudre les capsules', () => {
    const result = bufferLineFeatures([
      { type: 'Feature', id: 'multi', properties: {}, geometry: { type: 'MultiLineString', coordinates: [[[0, 0], [0.001, 0], [0.002, 0]], [[1, 1], [1.001, 1]]] } },
      { type: 'Feature', id: 'collection', properties: {}, geometry: { type: 'GeometryCollection', geometries: [{ type: 'LineString', coordinates: [[2, 2], [2.001, 2]] }] } }
    ], { radiusMeters: 25, segments: 12 });
    assert.equal(result.segmentCount, 4);
    assert.equal(result.features.length, 4);
    assert.deepEqual(result.features.map(feature => feature.properties._urbaTrameDerivation.sourceFeatureId), ['multi', 'multi', 'multi', 'collection']);
    assert.deepEqual(result.features.map(feature => feature.properties._urbaTrameDerivation.sourceSegmentIndex), [0, 1, 2, 0]);
  });

  test('refuse les segments nuls, trop longs, traversant l’antiméridien et les sorties trop complexes', () => {
    const line = coordinates => [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } }];
    assert.throws(() => bufferLineFeatures([], { radiusMeters: 10 }), error => error.code === 'RECIPE_BUFFER_LINES_REQUIRED');
    assert.throws(() => bufferLineFeatures(line([[0, 0], [0, 0]]), { radiusMeters: 10 }), error => error.code === 'RECIPE_BUFFER_LINE_SEGMENT_INVALID');
    assert.throws(() => bufferLineFeatures(line([[0, 0], [1, 0]]), { radiusMeters: 10 }), error => error.code === 'RECIPE_BUFFER_LINE_SEGMENT_TOO_LONG');
    assert.throws(() => bufferLineFeatures(line([[179.999, 0], [-179.999, 0]]), { radiusMeters: 10 }), error => error.code === 'RECIPE_BUFFER_ANTIMERIDIAN_UNSUPPORTED');
    const dense = Array.from({ length: 1_494 }, (_, index) => [index * 0.000001, 0]);
    assert.throws(() => bufferLineFeatures(line(dense), { radiusMeters: 10, segments: 64 }), error => error.code === 'RECIPE_BUFFER_LINE_COMPLEXITY');
    assert.equal(MAX_BUFFER_LINE_SEGMENTS, 2_000);
  });
});
