import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  freeModelsFromCatalog,
  lonLatToMercator,
  mercatorToLonLat,
  parseAiJson,
  solveAffineTransform,
  transformPixel,
  validateAiSynthesis
} from '../public/js/atelier/s5-core.mjs';

describe('comparateur historique S5 · géométrie vérifiable', () => {
  test('projection WGS84 ↔ EPSG:3857 conserve des coordonnées urbaines', () => {
    const projected = lonLatToMercator(6.6969, 36.2642);
    const geographic = mercatorToLonLat(projected.x, projected.y);
    assert.ok(Math.abs(geographic.lon - 6.6969) < 1e-10);
    assert.ok(Math.abs(geographic.lat - 36.2642) < 1e-10);
    assert.throws(() => lonLatToMercator(6, 86), /EPSG:3857/);
    assert.throws(() => lonLatToMercator(181, 0), /hors limites/);
  });

  test('un ajustement affine récupère translation, rotation/échelle et résidus', () => {
    const points = [
      { pixel: [0, 0], world: [1000, 2000] },
      { pixel: [100, 0], world: [1200, 2000] },
      { pixel: [0, 100], world: [1000, 1800] },
      { pixel: [100, 100], world: [1200, 1800] },
      { pixel: [50, 35], world: [1100, 1930] }
    ];
    const transform = solveAffineTransform(points);
    assert.ok(Math.abs(transform.a - 2) < 1e-12);
    assert.ok(Math.abs(transform.e + 2) < 1e-12);
    assert.ok(Math.abs(transform.c - 1000) < 1e-9);
    assert.ok(Math.abs(transform.f - 2000) < 1e-9);
    assert.equal(transform.pointCount, 5);
    assert.ok(transform.rmse < 1e-9);
    assert.deepEqual(transformPixel(transform, 25, 40), { x: 1050, y: 1920 });
    assert.equal(transform.residuals.length, 5);
  });

  test('les points colinéaires ou insuffisants sont refusés', () => {
    assert.throws(() => solveAffineTransform([
      { pixel: [0, 0], world: [0, 0] },
      { pixel: [1, 1], world: [1, 1] }
    ]), /au moins trois/);
    assert.throws(() => solveAffineTransform([
      { pixel: [0, 0], world: [0, 0] },
      { pixel: [1, 1], world: [1, 2] },
      { pixel: [2, 2], world: [2, 4] }
    ]), /points image.*alignés/);
    assert.throws(() => solveAffineTransform([
      { pixel: [0, 0], world: [0, 0] },
      { pixel: [1, 0], world: [1, 1] },
      { pixel: [0, 1], world: [2, 2] }
    ]), /coordonnées des repères.*alignées/);
  });
});

describe('catalogues d’inférence et sortie IA S5', () => {
  test('les modèles payants et sans vision déclarée ne sont pas présentés comme gratuits image', () => {
    const catalog = { data: [
      { id: 'demo/vision:free', name: 'Vision gratuite', pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text', 'image'] } },
      { id: 'demo/text:free', pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text'] } },
      { id: 'demo/paid', pricing: { prompt: '0.0001', completion: '0.0002' }, architecture: { input_modalities: ['text', 'image'] } },
      { id: 'demo/paid-image:free', pricing: { prompt: '0', completion: '0', image: '0.0001' }, architecture: { input_modalities: ['text', 'image'] } },
      { id: 'openrouter/free' }
    ] };
    const models = freeModelsFromCatalog(catalog, 'openrouter');
    assert.equal(models.length, 3);
    assert.equal(models[0].vision, true);
    assert.equal(models[1].vision, false);
    assert.equal(models[2].vision, null);
    const apinex = freeModelsFromCatalog({ data: [{ id: 'free/vision-preview' }, { id: 'paid/model' }] }, 'apinex');
    assert.deepEqual(apinex.map(model => model.id), ['free/vision-preview']);
  });

  test('JSON IA tolère les clôtures Markdown, filtre les coordonnées invalides et borne la sortie', () => {
    const parsed = parseAiJson('```json\n{"summary":"  Lecture prudente. ","observations":[{"label":"Rue","category":"viaire","confidence":1.3,"detail":"visible","x":0.25,"y":0.75},{"label":"hors image","x":-0.1,"y":0.5}]}\n```');
    const result = validateAiSynthesis(parsed);
    assert.equal(result.summary, 'Lecture prudente.');
    assert.equal(result.observations.length, 1);
    assert.equal(result.observations[0].confidence, 1);
    assert.equal(result.observations[0].confirmed, false);
    assert.equal(result.observations[0].origin, 'IA');
    assert.throws(() => parseAiJson('aucun objet'), /JSON/);
  });
});
