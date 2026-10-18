import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CADRAGE_PROJECT_TYPE, CADRAGE_PROJECT_VERSION, LAYERS, LEVELS, MAX_STUDY_RADIUS_M,
  createDefaultFramingRecord, defaultLayerVisibility, distanceMeters, normalizeAnnotation,
  normalizeFramingProject, normalizeFramingRecord, parseFramingProject, perimeterStats,
  radiusForScale, scaleDenominator, serializeFramingProject, toLocalMeters,
  validatePerimeter
} from '../public/js/spatial-framing-core.mjs';

const center = { lat: 36.7538, lon: 3.0588, name: 'Alger' };

describe('Cadrage spatial · règles géométriques', () => {
  test('quatre niveaux distinguent le repérage schématique du cadrage d’analyse', () => {
    assert.deepEqual(LEVELS.map(level => level.id), [
      'wilaya-country', 'city-wilaya', 'neighborhood-city', 'neighborhood-environment'
    ]);
    assert.equal(LEVELS[0].schematic, true);
    assert.equal(LEVELS[1].schematic, true);
    assert.equal(LEVELS[2].schematic, false);
    assert.equal(LEVELS[3].schematic, false);
  });

  test('le plafond propre au module est bien de 3 000 m', () => {
    assert.equal(MAX_STUDY_RADIUS_M, 3000);
    const accepted = validatePerimeter({ type: 'circle', center: [center.lon, center.lat], radiusMeters: 3000 }, center);
    const rejected = validatePerimeter({ type: 'circle', center: [center.lon, center.lat], radiusMeters: 3000.6 }, center);
    assert.equal(accepted.ok, true);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.code, 'PERIMETER_TOO_LARGE');
    assert.ok(rejected.stats.maxDistanceM > MAX_STUDY_RADIUS_M);
  });

  test('le cercle tient compte du décalage de son centre par rapport au centre de cadrage', () => {
    const offset = [center.lon + 1800 / (111320 * Math.cos(center.lat * Math.PI / 180)), center.lat];
    const check = validatePerimeter({ type: 'circle', center: offset, radiusMeters: 1300 }, center);
    assert.equal(check.ok, false);
    assert.equal(check.code, 'PERIMETER_TOO_LARGE');
    assert.ok(check.stats.maxDistanceM > 3000);
  });

  test('les sommets des polygones et rectangles sont contrôlés contre le centre', () => {
    const near = [
      [center.lon - .004, center.lat - .004], [center.lon + .004, center.lat - .004],
      [center.lon + .004, center.lat + .004], [center.lon - .004, center.lat + .004]
    ];
    assert.equal(validatePerimeter({ type: 'polygon', coordinates: near }, center).ok, true);
    const far = [...near.slice(0, 3), [center.lon + .04, center.lat + .04]];
    const result = validatePerimeter({ type: 'rectangle', coordinates: far }, center);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'PERIMETER_TOO_LARGE');
  });

  test('les mesures renvoient une surface et des dimensions pour un polygone local', () => {
    const ring = [
      [center.lon - .002, center.lat - .002], [center.lon + .002, center.lat - .002],
      [center.lon + .002, center.lat + .002], [center.lon - .002, center.lat + .002]
    ];
    const stats = perimeterStats({ type: 'polygon', coordinates: ring }, center);
    assert.ok(stats.areaM2 > 100_000 && stats.areaM2 < 300_000);
    assert.ok(stats.perimeterM > 1000 && stats.perimeterM < 3000);
    assert.ok(stats.widthM > 300 && stats.heightM > 400);
  });

  test('distance WGS 84 et projection locale sont cohérentes à l’échelle du quartier', () => {
    const point = [center.lon + .001, center.lat];
    const distance = distanceMeters([center.lon, center.lat], point);
    const local = toLocalMeters(point, center);
    assert.ok(Math.abs(distance - local[0]) < .5);
    assert.ok(distance > 80 && distance < 100);
  });

  test('l’échelle numérique et le rayon visible se convertissent l’un vers l’autre', () => {
    for (const width of [125, 175, 220]) {
      for (const radius of [100, 500, 1000, 3000]) {
        const denominator = scaleDenominator(radius, width);
        const restored = radiusForScale(denominator, width);
        assert.ok(Math.abs(restored - radius) <= width / 2000 + .1);
      }
    }
    assert.equal(scaleDenominator(1000, 200), 10000);
  });

  test('un cadrage détaillé sans contour ne peut pas être normalisé; un repérage peut', () => {
    const basic = createDefaultFramingRecord('wilaya-country', 1000);
    assert.ok(basic);
    const detailed = createDefaultFramingRecord('neighborhood-city', 1000);
    assert.ok(detailed);
    assert.equal(validatePerimeter(detailed.perimeter, detailed.center, { required: true }).code, 'PERIMETER_REQUIRED');
  });
});

describe('Cadrage spatial · projet local et annotations', () => {
  test('les annotations sont typées, bornées et nettoyées', () => {
    const point = normalizeAnnotation({ type: 'text', position: [3.05, 36.75], text: '  accès\n principal ', color: '#336699' }, 0);
    assert.equal(point.text, 'accès principal');
    assert.equal(point.color, '#336699');
    assert.equal(normalizeAnnotation({ type: 'point', position: [900, 200] }), null);
    assert.equal(normalizeAnnotation({ type: 'zone', coordinates: [[3, 36], [3.1, 36]] }), null);
    assert.ok(normalizeAnnotation({ type: 'arrow', coordinates: [[3.05, 36.75], [3.06, 36.76]], text: 'Accès' }));
  });

  test('le cadrage conserve les couches, les paramètres d’export et les identifiants locaux', () => {
    const base = createDefaultFramingRecord('wilaya-country', 10_000);
    const record = normalizeFramingRecord({
      ...base, name: 'Carte de situation', wilayaGid: 'DZA.16_1', wilayaName: 'Alger',
      layerVisibility: { ...defaultLayerVisibility(), relief: false, roadsMain: true },
      comments: 'Visite de terrain', layout: { pageSize: 'A3', orientation: 'portrait', dpi: 300 },
      annotations: [{ type: 'point', position: [3.05, 36.75], text: 'Entrée', category: 'access' }]
    }, { now: 11_000 });
    assert.ok(record);
    assert.equal(record.name, 'Carte de situation');
    assert.equal(record.wilayaGid, 'DZA.16_1');
    assert.equal(record.layerVisibility.relief, false);
    assert.equal(record.layout.pageSize, 'A3');
    assert.equal(record.layout.orientation, 'portrait');
    assert.equal(record.annotations.length, 1);
    assert.equal(record.comments, 'Visite de terrain');
  });

  test('le projet JSON se valide et les schémas inconnus ou tronqués sont refusés', () => {
    const base = createDefaultFramingRecord('wilaya-country', 20_000);
    const text = serializeFramingProject([base], 21_000);
    const project = parseFramingProject(text, { now: 22_000 });
    assert.equal(project.type, CADRAGE_PROJECT_TYPE);
    assert.equal(project.version, CADRAGE_PROJECT_VERSION);
    assert.equal(project.cadrages.length, 1);
    assert.equal(parseFramingProject('{bad'), null);
    assert.equal(parseFramingProject(JSON.stringify({ ...project, type: 'other' })), null);
    assert.equal(parseFramingProject('x'.repeat(16 * 1024 * 1024)), null);
  });

  test('une couche GeoJSON locale limitée peut accompagner le cadrage exporté', () => {
    const base = createDefaultFramingRecord('wilaya-country', 30_000);
    const snapshot = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'contour' }, geometry: { type: 'Polygon', coordinates: [[[3.05, 36.75], [3.051, 36.75], [3.051, 36.751], [3.05, 36.75]]] } }] };
    const record = normalizeFramingRecord({ ...base, localSnapshot: snapshot }, { now: 31_000 });
    assert.ok(record.localSnapshot);
    assert.equal(record.localSnapshot.features[0].properties.name, 'contour');
  });

  test('la légende et les couches sont définies sans créer de données cadastrales', () => {
    const ids = new Set(LAYERS.map(layer => layer.id));
    for (const id of ['country', 'wilaya', 'commune', 'study', 'roadsMain', 'pedestrian', 'equipment', 'transport', 'green', 'water', 'rail', 'barriers', 'relief', 'local', 'annotations']) assert.ok(ids.has(id), id);
    assert.equal(LAYERS.some(layer => /cadastr|parcel|parcelle/i.test(layer.id + layer.label)), false);
  });
});
