import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  areaForShape, classifyBuilding, clipPolygonToSquare, clipPolylineToSquare,
  normalizeBoundary, polygonArea, roadSurface, roadWidth
} from '../public/js/atelier/geometry.mjs';

const origin = { lat: 36, lon: 6 };

describe('géométrie cartographique additionnelle', () => {
  test('les six familles de bâtiments se déduisent des tags OSM sans perdre les tags', () => {
    assert.equal(classifyBuilding({ building: 'apartments' }), 'residential');
    assert.equal(classifyBuilding({ building: 'school' }), 'public');
    assert.equal(classifyBuilding({ building: 'retail' }), 'commercial');
    assert.equal(classifyBuilding({ building: 'warehouse' }), 'industrial');
    assert.equal(classifyBuilding({ building: 'garage' }), 'utility');
    assert.equal(classifyBuilding({ building: 'yes' }), 'other');
  });

  test('largeur de voie : priorité à width, puis lanes, puis estimation par classe', () => {
    assert.deepEqual(roadWidth({ highway: 'residential', width: '5.5 m' }), { metres: 5.5, source: 'osm-width' });
    assert.equal(roadWidth({ highway: 'primary', lanes: '2' }).metres, 6);
    assert.equal(roadWidth({ highway: 'footway' }).metres, 1.8);
    assert.equal(roadWidth({ highway: 'service', width: "20'" }).metres, 6.096);
  });

  test('aires de sélection cohérentes pour le cercle et le carré', () => {
    assert.ok(Math.abs(areaForShape('circle', 100) - Math.PI * 10_000) < 1e-8);
    assert.equal(areaForShape('square', 100), 40_000);
  });

  test('une limite utilisateur valide est nettoyée, et les limites dégénérées sont refusées', () => {
    const p = [[36, 6], [36, 6.001], [36.001, 6.001], [36.001, 6], [36, 6]];
    const clean = normalizeBoundary(p, origin);
    assert.equal(clean.length, 4);
    assert.ok(polygonArea(clean.map(point => [
      (point[1] - origin.lon) * 111320 * Math.cos(origin.lat * Math.PI / 180),
      (point[0] - origin.lat) * 111320
    ])) > 9_000);
    assert.throws(() => normalizeBoundary([[36, 6], [36, 6.001]], origin), /BOUNDARY_NEEDS_THREE_POINTS/);
    assert.throws(() => normalizeBoundary([[36, 6], [36.001, 6.001], [36.001, 6], [36, 6.001]], origin), /BOUNDARY_SELF_INTERSECTS/);
  });

  test('les lignes et surfaces sont découpées à la forme carrée sans inventer de géométrie', () => {
    const line = clipPolylineToSquare([[-20, 0], [20, 0]], 5);
    assert.deepEqual(line, [[[-5, 0], [5, 0]]]);
    const polygon = clipPolygonToSquare([[-10, -2], [10, -2], [10, 2], [-10, 2]], 5);
    assert.equal(polygon.length, 4);
    assert.ok(polygon.every(([x, y]) => Math.abs(x) <= 5 && Math.abs(y) <= 5));
  });

  test('le ruban de voirie conserve une largeur régulière sur un axe droit', () => {
    const road = roadSurface([[0, 0], [10, 0]], 4);
    assert.equal(road.length, 4);
    assert.deepEqual(road[0], [0, 2]);
    assert.deepEqual(road[1], [10, 2]);
    assert.equal(Math.abs(road[0][1] - road[3][1]), 4);
  });
});
