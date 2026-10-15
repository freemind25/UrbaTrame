import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateFeasibility, summarizeSite } from '../public/js/site-summary.mjs';

const geo = (east, north) => [north / 111320, east / 111320];
const square = (east, north, half = 5) => [
  geo(east - half, north - half), geo(east + half, north - half),
  geo(east + half, north + half), geo(east - half, north + half),
  geo(east - half, north - half)
];

const baseData = () => ({
  build: [
    { g: square(0, 0), h: 12 },
    { g: square(75, 75), h: 0 },
    { g: square(0, 150), h: 20 }
  ],
  green: [
    { k: 'g', g: square(0, 0) },
    { k: 'g', g: square(75, 75) },
    { k: 'w', g: square(0, 150) },
    { k: 'l', g: square(0, 0) }
  ],
  roads: [
    { h: 'residential', g: [geo(-200, 0), geo(200, 0)] },
    { h: 'service', g: [geo(-40, 150), geo(40, 150)] }
  ],
  pois: [
    { k: 'poi', a: 'school', y: geo(0, 0)[0], x: geo(0, 0)[1] },
    { k: 'poi', s: 'supermarket', y: geo(75, 75)[0], x: geo(75, 75)[1] },
    { k: 'transit', a: 'bus_stop', y: geo(0, 150)[0], x: geo(0, 150)[1] }
  ]
});

describe('tableau de synthèse urbaine', () => {
  test('calcule les métriques du cercle et écarte les objets dont le centre est hors zone', () => {
    const m = summarizeSite({ D: baseData(), lat: 0, lon: 0, radius: 100, shape: 'circle' });
    assert.ok(Math.abs(m.areaM2 - Math.PI * 10_000) < 1e-8);
    assert.equal(m.buildings.count, 1);
    assert.equal(m.buildings.footprintM2, 100);
    assert.equal(m.buildings.heightsKnown, 1);
    assert.equal(m.buildings.meanKnownHeightM, 12);
    assert.equal(m.buildings.knownVolumeM3, 1_200);
    assert.equal(m.green.count, 1);
    assert.equal(m.green.areaM2, 100);
    assert.equal(m.water.count, 0);
    assert.equal(m.landuseCount, 1);
    assert.equal(m.points.total, 1);
    assert.equal(m.points.amenities, 1);
    assert.equal(m.points.transit, 0);
    assert.deepEqual(m.points.categories, [{ name: 'school', count: 1 }]);
    assert.equal(m.roads.count, 1);
    assert.ok(Math.abs(m.roads.lengthM - 200) < 1e-6);
  });

  test('l’emprise carrée inclut ses angles et sa surface vaut quatre fois le rayon au carré', () => {
    const m = summarizeSite({ D: baseData(), lat: 0, lon: 0, radius: 100, shape: 'square' });
    assert.equal(m.areaM2, 40_000);
    assert.equal(m.buildings.count, 2);
    assert.equal(m.green.count, 2);
    assert.equal(m.points.total, 2);
    assert.equal(m.points.transit, 0);
    assert.equal(m.roads.count, 1);
    assert.ok(Math.abs(m.roads.lengthM - 200) < 1e-6);
  });

  test('utilise la surface réelle d’un polygone fourni et coupe approximativement les lignes à son contour', () => {
    const polygon = [geo(-50, -50), geo(50, -50), geo(50, 50), geo(-50, 50)];
    const m = summarizeSite({ D: baseData(), lat: 0, lon: 0, radius: 100, shape: 'poly', polygon });
    assert.equal(m.areaM2, 10_000);
    assert.equal(m.shape, 'polygon');
    assert.equal(m.buildings.count, 1);
    assert.ok(Math.abs(m.roads.lengthM - 100) < 1);
  });

  test('résume les sources terrain et climat en ignorant les valeurs NASA de remplissage', () => {
    const m = summarizeSite({
      terrain: { grid: [[120, 140], [130, 125], [null, '']] },
      climate: { source: 'NASA POWER', params: {
        T2M_MAX: { a: 20, b: -999, c: 30 },
        T2M_MIN: { a: 10, b: 12, c: null },
        PRECTOTCORR: { a: 1, b: 3 },
        WS10M: { a: 2, b: 6 },
        ALLSKY_SFC_SW_DWN: { a: 4, b: 6 }
      } }
    });
    assert.deepEqual(m.terrain, {
      source: 'Terrarium · SRTM/USGS', minM: 120, maxM: 140, reliefM: 20, samples: 4
    });
    assert.equal(m.climate.meanMaxC, 25);
    assert.equal(m.climate.meanMinC, 11);
    assert.equal(m.climate.estimatedAnnualRainMm, 730);
    assert.equal(m.climate.meanWind10mMs, 4);
    assert.equal(m.climate.meanSolarKwhM2Day, 5);
  });

  test('reste valide avec un extrait vide ou des séries manquantes', () => {
    const m = summarizeSite({ D: {}, climate: { params: { T2M_MAX: { a: -999 } } }, terrain: { grid: [] } });
    assert.equal(m.buildings.count, 0);
    assert.equal(m.roads.lengthM, 0);
    assert.equal(m.climate.meanMaxC, null);
    assert.equal(m.terrain.reliefM, null);
  });
});

describe('scénario de faisabilité indicatif', () => {
  test('retient la contrainte la plus stricte et calcule le coût si saisi', () => {
    const result = calculateFeasibility({
      siteAreaM2: 2_000, far: 2, coveragePct: 30, floors: 3, costPerM2: 80_000
    });
    assert.equal(result.areaByFarM2, 4_000);
    assert.equal(result.footprintLimitM2, 600);
    assert.equal(result.areaByCoverageM2, 1_800);
    assert.equal(result.floorAreaM2, 1_800);
    assert.equal(result.footprintM2, 600);
    assert.equal(result.bindingConstraint, 'coverage');
    assert.equal(result.costEstimate, 144_000_000);
  });

  test('le coût reste absent quand il n’est pas renseigné', () => {
    const result = calculateFeasibility({ siteAreaM2: 1_000, far: 1.5, coveragePct: 50, floors: 4 });
    assert.equal(result.floorAreaM2, 1_500);
    assert.equal(result.costEstimate, null);
  });

  test('refuse les paramètres invalides', () => {
    assert.equal(calculateFeasibility({ siteAreaM2: 0, far: 1, coveragePct: 50, floors: 3 }), null);
    assert.equal(calculateFeasibility({ siteAreaM2: 1_000, far: 1, coveragePct: 150, floors: 3 }), null);
    assert.equal(calculateFeasibility({ siteAreaM2: 1_000, far: 1, coveragePct: 50, floors: 0 }), null);
    assert.equal(calculateFeasibility({ siteAreaM2: 1_000, far: 1, coveragePct: 50, floors: 3, costPerM2: -1 }), null);
  });
});
