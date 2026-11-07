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

describe('garde-fou : le bouton « Charger les modèles » couvre aussi « Autre endpoint »', () => {
  test('CATALOG_PROVIDERS déclaré une fois, inclut custom, et utilisé par l’UI (setProviderUI, updateAiControls, loadModels)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const src = fs.readFileSync(path.join(root, 'public/js/atelier/s5-comparison.mjs'), 'utf8');
    const decls = src.match(/const CATALOG_PROVIDERS = \[([^\]]*)\];/g) || [];
    assert.equal(decls.length, 1, 'CATALOG_PROVIDERS déclaré exactement une fois');
    assert.ok(decls[0].includes("'custom'"), 'custom présent dans CATALOG_PROVIDERS');
    for (const usage of ['elements.loadModels.hidden = !CATALOG_PROVIDERS.includes(provider)',
                         'elements.modelSelectField.hidden = !CATALOG_PROVIDERS.includes(provider)',
                         'elements.loadModels.disabled = !hasKey || !CATALOG_PROVIDERS.includes(provider)',
                         'if (!CATALOG_PROVIDERS.includes(provider)) return;'])
      assert.ok(src.includes(usage), `usage UI présent : ${usage.slice(0, 60)}…`);
    assert.ok(/const total = Array\.isArray\(payload\)/.test(src), 'total du catalogue déclaré avant usage');
    assert.ok(src.includes('`l’endpoint ${new URL(endpoint).host}`'), 'label custom dans loadModels');
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
    // endpoint perso (custom) : tarif nul déclaré ou suffixe :free, les payants exclus
    const custom = freeModelsFromCatalog({ data: [
      { id: 'cc-modele', pricing: { prompt: '0', completion: '0' } },
      { id: 'mon-modele:free' },
      { id: 'modele-payant', pricing: { prompt: '0.001', completion: '0' } }
    ] }, 'custom');
    assert.deepEqual(custom.map(model => model.id), ['cc-modele', 'mon-modele:free']);
    // FreeLLMAPI : les ID en « :free » du catalogue sont reconnus comme gratuits
    const freellm = freeModelsFromCatalog({ data: [{ id: 'glm-5.3:free' }, { id: 'qwen3.8-max' }, { id: 'payant', pricing: { prompt: '1', completion: '1' } }] }, 'freellmapi');
    assert.deepEqual(freellm.map(model => model.id), ['glm-5.3:free']);
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

describe('garde-fou : fournisseur FreeLLMAPI (routeur local) branché dans S5', () => {
  test('option HTML, base localhost:3001, catalogue direct, note confidentialité', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const js = fs.readFileSync(path.join(root, 'public/js/atelier/s5-comparison.mjs'), 'utf8');
    const html = fs.readFileSync(path.join(root, 'public/atelier-s5.html'), 'utf8');
    assert.ok(html.includes('value="freellmapi"'), 'option freellmapi dans le select');
    assert.ok(js.includes("'freellmapi'"), 'provider freellmapi câblé');
    assert.ok(js.includes('http://localhost:3001/v1'), 'base par défaut du routeur local');
    assert.ok(js.includes("provider === 'freellmapi' ? 'FreeLLMAPI"), 'label FreeLLMAPI');
    assert.ok(html.includes('freellmapi.co/privacy'), 'note confidentialité liée');
    assert.ok(html.includes('github.com/tashfeenahmed/freellmapi'), 'lien GitHub MIT');
    assert.ok(html.includes('DASHBOARD_ORIGINS=https://freemap-rose.vercel.app'), 'commande docker CORS dans la note S5');
    assert.ok(js.includes('DASHBOARD_ORIGINS=https://freemap-rose.vercel.app'), 'hint CORS dans le catch de loadModels');
  });
});
