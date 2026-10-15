import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { plan } from '../public/js/plan-2d.mjs';
import {
  CLIMATE_DAYS, CLIMATE_SERIES, WINDROSE_SECTORS, WINDROSE_YEARS,
  estimateDataPreview, estimateTerrainTiles, layerLabel, terrainZoomForRadius
} from '../public/js/data-preview.mjs';

const SITE = { lat: 36.47, lon: 2.83 };

describe('aperçu local de disponibilité et de charge', () => {
  test('reprend les groupes et dépendances du planificateur partagé', () => {
    const preview = estimateDataPreview({ analysisIds: ['roads', 'gw'], radius: 600, ...SITE });
    const currentPlan = plan(['roads', 'gw'], 600, SITE.lat, SITE.lon);
    assert.deepEqual(preview.selected, currentPlan.selected);
    assert.deepEqual(preview.skipped, currentPlan.skipped);
    assert.deepEqual(preview.groups.map(group => ({ id: group.id, keys: group.keys })),
      currentPlan.groups.map(group => ({ id: group.id, keys: group.keys })));
    assert.ok(preview.layerKeys.includes('roads'));
    assert.ok(preview.layerKeys.includes('green'));
  });

  test('distingue surface d’étude et boîte réellement interrogée', () => {
    const circle = estimateDataPreview({ analysisIds: ['roads'], radius: 600, ...SITE, shape: 'circle' });
    const square = estimateDataPreview({ analysisIds: ['roads'], radius: 600, ...SITE, shape: 'square' });
    assert.ok(Math.abs(circle.osmAreaKm2 - 1.44) < 1e-9);
    assert.ok(Math.abs(circle.studyAreaKm2 - Math.PI * 0.36) < 1e-9);
    assert.equal(square.studyAreaKm2, square.osmAreaKm2);
  });

  test('annonce les séries et la rose prévues sans les confondre avec des requêtes déjà vérifiées', () => {
    const preview = estimateDataPreview({
      analysisIds: ['climtemp', 'wind'], radius: 600, ...SITE
    });
    assert.equal(preview.groups.length, 0);
    assert.deepEqual(preview.climate, {
      days: CLIMATE_DAYS, series: CLIMATE_SERIES, values: CLIMATE_DAYS * CLIMATE_SERIES
    });
    assert.deepEqual(preview.windrose, { years: WINDROSE_YEARS, sectors: WINDROSE_SECTORS });
    assert.equal(preview.ancillaryActions, 2);
  });

  test('estime la grille et les tuiles du relief avec les seuils du service', () => {
    assert.equal(terrainZoomForRadius(700), 14);
    assert.equal(terrainZoomForRadius(701), 13);
    assert.equal(terrainZoomForRadius(1601), 12);
    const terrain = estimateTerrainTiles(SITE.lat, SITE.lon, 600);
    assert.equal(terrain.zoom, 14);
    assert.equal(terrain.samples, 576);
    assert.ok(terrain.tiles >= 1 && terrain.tiles <= terrain.samples);
    const preview = estimateDataPreview({ analysisIds: ['volumes'], radius: 600, ...SITE });
    assert.deepEqual(preview.terrain, terrain);
  });

  test('signale une charge indicative et les analyses écartées par plafond', () => {
    const light = estimateDataPreview({ analysisIds: ['roads'], radius: 600, ...SITE });
    const heavy = estimateDataPreview({ analysisIds: ['roads'], radius: 3000, ...SITE });
    const capped = estimateDataPreview({ analysisIds: ['walkroutes'], radius: 2000, ...SITE });
    assert.equal(light.load, 'low');
    assert.equal(heavy.load, 'high');
    assert.deepEqual(capped.skipped, ['walkroutes']);
    assert.deepEqual(capped.selected, []);
  });

  test('fournit des libellés bilingues et rejette un plan géographique invalide', () => {
    assert.equal(layerLabel('roads', 'fr'), 'voirie');
    assert.equal(layerLabel('roads', 'en'), 'roads');
    assert.throws(() => estimateDataPreview({ analysisIds: ['roads'], radius: 600, lat: 90, lon: 0 }), /INVALID_LOCATION/);
  });
});
