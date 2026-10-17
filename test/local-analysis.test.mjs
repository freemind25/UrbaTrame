import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { geometryMetrics, summarizeFeatures } from '../public/js/atelier/local-analysis.mjs';

describe('UrbaTrame · mesures vectorielles locales', () => {
  test('mesure la longueur d’une ligne avec une distance géodésique approximative', () => {
    const result = geometryMetrics({ type: 'LineString', coordinates: [[0, 0], [0.001, 0]] });
    assert.ok(Math.abs(result.lengthMeters - 111.195) < 0.2);
    assert.equal(result.areaSqMeters, 0);
  });

  test('calcule l’aire des polygones et retire les anneaux intérieurs', () => {
    const outer = [[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]];
    const hole = [[0.002, 0.002], [0.008, 0.002], [0.008, 0.008], [0.002, 0.008], [0.002, 0.002]];
    const solid = geometryMetrics({ type: 'Polygon', coordinates: [outer] });
    const withHole = geometryMetrics({ type: 'Polygon', coordinates: [outer, hole] });
    assert.ok(solid.areaSqMeters > 1_200_000 && solid.areaSqMeters < 1_300_000);
    assert.ok(withHole.areaSqMeters < solid.areaSqMeters);
    assert.ok(withHole.areaSqMeters > solid.areaSqMeters * 0.5);
    assert.ok(withHole.lengthMeters > solid.lengthMeters);
  });

  test('résume les types, l’emprise, la longueur, la surface et le nombre de sommets', () => {
    const features = [
      { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [6, 36] } },
      { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[6, 36], [6.001, 36]] } }
    ];
    const result = summarizeFeatures(features);
    assert.equal(result.featureCount, 2);
    assert.equal(result.types.Point, 1);
    assert.equal(result.types.LineString, 1);
    assert.ok(result.lengthMeters > 80 && result.lengthMeters < 100);
    assert.deepEqual(result.extent, { west: 6, south: 36, east: 6.001, north: 36 });
    assert.equal(result.coordinateCount, 3);
  });
});
