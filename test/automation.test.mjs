import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runLocalRecipe } from '../public/js/atelier/automation.mjs';

const places = {
  name: 'Places', sourceCrs: 'EPSG:4326', visible: true,
  geojson: { sourceCrs: 'EPSG:4326', features: [
    { type: 'Feature', id: 'a', properties: { class: 'park', name: 'North' }, geometry: { type: 'Point', coordinates: [1, 1] } },
    { type: 'Feature', id: 'b', properties: { class: 'school', name: 'South' }, geometry: { type: 'Point', coordinates: [4, 4] } },
    { type: 'Feature', id: 'c', properties: { class: 'park', name: 'West' }, geometry: { type: 'Point', coordinates: [11, 9] } }
  ] }
};
const zones = {
  name: 'Zone-test', sourceCrs: 'EPSG:4326', visible: true,
  geojson: { sourceCrs: 'EPSG:4326', features: [{ type: 'Feature', id: 'zone', properties: {}, geometry: { type: 'Polygon', coordinates: [
    [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
    [[3, 3], [5, 3], [5, 5], [3, 5], [3, 3]]
  ] } }] }
};

describe('UrbaTrame · recettes déterministes locales', () => {
  test('mesure, filtre les attributs et exporte des sous-ensembles sans modifier les couches', () => {
    const result = runLocalRecipe([places, zones], { version: 1, steps: [
      { op: 'measure', layer: 'Places' },
      { op: 'filter', layer: 'Places', field: 'class', match: 'equals', value: 'park' }
    ] });
    assert.equal(result.reports[0].summary.featureCount, 3);
    assert.equal(result.reports[1].matched, 2);
    assert.deepEqual(result.artifacts[0].collection.features.map(feature => feature.id), ['a', 'c']);
    assert.equal(places.geojson.features.length, 3);
  });

  test('sélectionne les points contenus dans un polygone, en excluant son trou', () => {
    const result = runLocalRecipe([places, zones], { version: 1, steps: [
      { op: 'within-polygon', layer: 'Places', polygonLayer: 'Zone-test', polygonFeature: 0 }
    ] });
    assert.deepEqual(result.artifacts[0].collection.features.map(feature => feature.id), ['a']);
    assert.match(result.reports[0].note, /anneaux intérieurs/);
  });

  test('sélectionne des Point/MultiPoint proches selon une distance sphérique et conserve les couches sources', () => {
    const reference = {
      name: 'Arrêts', source: 'OSM · accès 2026-10-17', importedAt: '2026-10-17T10:00:00.000Z',
      geojson: { features: [
        { type: 'Feature', id: 'stop-a', properties: { kind: 'bus' }, geometry: { type: 'Point', coordinates: [1.001, 1] } },
        { type: 'Feature', id: 'stop-b', properties: { kind: 'bus' }, geometry: { type: 'MultiPoint', coordinates: [[4.005, 4], [4.006, 4]] } }
      ] }
    };
    const before = JSON.stringify([places.geojson.features, reference.geojson.features]);
    const result = runLocalRecipe([places, reference], { version: 1, steps: [
      { op: 'within-distance', layer: 'Places', referenceLayer: 'Arrêts', distanceMeters: 600 }
    ] });
    assert.deepEqual(result.artifacts[0].collection.features.map(feature => feature.id), ['a', 'b']);
    assert.equal(result.reports[0].matched, 2);
    assert.equal(result.reports[0].distanceMeters, 600);
    assert.equal(result.artifacts[0].collection.urbatrameDerivation.source.referenceLayer, 'Arrêts');
    assert.equal(JSON.stringify([places.geojson.features, reference.geojson.features]), before);

    const acrossDateline = { name: 'Dateline', geojson: { features: [{ type: 'Feature', id: 'east', properties: {}, geometry: { type: 'Point', coordinates: [179.999, 0] } }] } };
    const westPoint = { name: 'West', geojson: { features: [{ type: 'Feature', id: 'west', properties: {}, geometry: { type: 'Point', coordinates: [-179.999, 0] } }] } };
    const wrapped = runLocalRecipe([acrossDateline, westPoint], { version: 1, steps: [
      { op: 'within-distance', layer: 'Dateline', referenceLayer: 'West', distanceMeters: 250 }
    ] });
    assert.equal(wrapped.artifacts[0].collection.features.length, 1);
  });

  test('valide la distance et borne les comparaisons de proximité', () => {
    assert.throws(() => runLocalRecipe([places], { version: 1, steps: [
      { op: 'within-distance', layer: 'Places', referenceLayer: 'Places', distanceMeters: 100_001 }
    ] }), error => error.code === 'RECIPE_DISTANCE_INVALID');
    const target = { name: 'Cibles', geojson: { features: [{ type: 'Feature', properties: {}, geometry: { type: 'MultiPoint', coordinates: Array.from({ length: 2_501 }, () => [0, 0]) } }] } };
    const reference = { name: 'Références', geojson: { features: [{ type: 'Feature', properties: {}, geometry: { type: 'MultiPoint', coordinates: Array.from({ length: 2_000 }, () => [1, 1]) } }] } };
    assert.throws(() => runLocalRecipe([target, reference], { version: 1, steps: [
      { op: 'within-distance', layer: 'Cibles', referenceLayer: 'Références', distanceMeters: 100 }
    ] }), error => error.code === 'RECIPE_SPATIAL_COMPLEXITY');
  });

  test('borne la complexité des sélections et exige une géométrie polygonale', () => {
    const target = { name: 'Points-lourds', geojson: { features: [{ type: 'Feature', properties: {}, geometry: { type: 'MultiPoint', coordinates: Array.from({ length: 6_000 }, (_, i) => [i / 100, i / 100]) } }] } };
    const ring = Array.from({ length: 1_000 }, (_, i) => [Math.cos(i / 100), Math.sin(i / 100)]);
    ring.push(ring[0]);
    const polygon = { name: 'Polygone-lourd', geojson: { features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }] } };
    assert.throws(() => runLocalRecipe([target, polygon], { version: 1, steps: [{ op: 'within-polygon', layer: 'Points-lourds', polygonLayer: 'Polygone-lourd' }] }), error => error.code === 'RECIPE_SPATIAL_COMPLEXITY');
    const noPolygon = { name: 'Sans-polygone', geojson: { features: [{ type: 'Feature', properties: {}, geometry: { type: 'GeometryCollection', geometries: [{ type: 'Point', coordinates: [0, 0] }] } }] } };
    assert.throws(() => runLocalRecipe([target, noPolygon], { version: 1, steps: [{ op: 'within-polygon', layer: 'Points-lourds', polygonLayer: 'Sans-polygone' }] }), error => error.code === 'RECIPE_POLYGON_REQUIRED');
  });

  test('génère un tampon ponctuel indicatif avec provenance sans modifier la source', () => {
    const before = JSON.stringify(places.geojson.features);
    const result = runLocalRecipe([places], { version: 1, steps: [
      { op: 'buffer-points', layer: 'Places', radiusMeters: 125, segments: 16 }
    ] });
    assert.equal(result.reports[0].operation, 'buffer-points');
    assert.equal(result.reports[0].points, 3);
    assert.equal(result.artifacts[0].collection.features.length, 3);
    assert.equal(result.artifacts[0].collection.urbatrameDerivation.radiusMeters, 125);
    assert.equal(result.artifacts[0].collection.urbatrameDerivation.dissolved, false);
    assert.match(result.artifacts[0].collection.urbatrameDerivation.note, /limite cadastrale/);
    assert.equal(JSON.stringify(places.geojson.features), before);
  });

  test('intègre le tampon de lignes indicatif à la recette sans modifier la source', () => {
    const roads = {
      name: 'Voirie', source: 'OSM · relevé', importedAt: '2026-10-17T10:00:00.000Z',
      geojson: { features: [{ type: 'Feature', id: 'road-1', properties: { highway: 'service' }, geometry: { type: 'LineString', coordinates: [[6.7, 36.2], [6.701, 36.2], [6.701, 36.201]] } }] }
    };
    const before = JSON.stringify(roads.geojson.features);
    const result = runLocalRecipe([roads], { version: 1, steps: [{ op: 'buffer-lines', layer: 'Voirie', radiusMeters: 40, segments: 16 }] });
    assert.equal(result.reports[0].segmentsBuffered, 2);
    assert.equal(result.artifacts[0].collection.features.length, 2);
    assert.equal(result.artifacts[0].collection.urbatrameDerivation.dissolved, false);
    assert.match(result.artifacts[0].collection.urbatrameDerivation.note, /non dissoutes/);
    assert.equal(JSON.stringify(roads.geojson.features), before);
  });

  test('refuse un tampon en dehors des limites de distance', () => {
    assert.throws(() => runLocalRecipe([places], { version: 1, steps: [{ op: 'buffer-points', layer: 'Places', radiusMeters: 5_001 }] }), error => error.code === 'RECIPE_BUFFER_RADIUS_INVALID');
  });

  test('refuse les instructions qui sortent des opérations autorisées', () => {
    assert.throws(() => runLocalRecipe([places], { version: 1, steps: [{ op: 'eval', code: '1 + 1' }] }), error => error.code === 'RECIPE_OPERATION_UNSUPPORTED');
    assert.throws(() => runLocalRecipe([places], { version: 1, steps: Array(21).fill({ op: 'measure', layer: 'Places' }) }), error => error.code === 'RECIPE_TOO_MANY_STEPS');
    assert.throws(() => runLocalRecipe([places], { version: 1, steps: [{ op: 'filter', layer: 'Places', field: '__proto__', match: 'equals', value: 'x' }] }), error => error.code === 'RECIPE_FILTER_INVALID');
  });
});
