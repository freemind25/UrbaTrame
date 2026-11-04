import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../tools/kernel.mjs';
import { Routes } from '../public/js/routes.mjs';

const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

describe('carte préalable de la page Analyses urbaines', () => {
  test('la carte interactive est prête à s’afficher après la sélection d’un lieu', () => {
    const html = read('public/index.html');
    const app = read('public/js/app.js');
    const css = read('public/styles.css');
    assert.match(html, /id="analysisMapPanel" class="analysis-map-panel" hidden/);
    assert.match(html, /id="analysisMap" class="analysis-map"/);
    assert.match(html, /openstreetmap\.org\/copyright/);
    assert.match(html, /les requêtes OSM utilisent une boîte rectangulaire qui peut la dépasser/);
    assert.match(app, /import \{ createMap \} from '\.\/atelier\/map\.mjs'/);
    assert.match(app, /function ensureAnalysisMap\(\)/);
    assert.match(app, /onCenter: moveAnalysisMapCenter/);
    assert.match(app, /ensureAnalysisMap\(\);/);
    assert.match(app, /analysisMap\?\.setRadius\(S\.site\.R\)/);
    assert.match(app, /analysisMap\?\.setShape\(analysisMapShape\(\)\)/);
    assert.match(css, /\.analysis-map-panel\[hidden\]\{display:none!important\}/);
  });

  test('les tuiles cartographiques et les résultats restent séparés des couches d’analyse', () => {
    const map = read('public/js/atelier/map.mjs');
    const app = read('public/js/app.js');
    const html = read('public/index.html');
    assert.match(map, /tile\.openstreetmap\.org/);
    assert.match(map, /options\.onTileError\?\.\(key\)/);
    assert.match(app, /analysisMap\?\.setData\(S\.D\)/);
    assert.match(html, /Fond © OpenStreetMap/);
  });

  test('les limites de temps des miroirs navigateur partagent un budget global', async () => {
    const oldFetch = globalThis.fetch;
    const oldNow = Date.now;
    const oldSetTimeout = globalThis.setTimeout;
    const oldClearTimeout = globalThis.clearTimeout;
    let clock = 1_000;
    let calls = 0;
    const delays = [];
    try {
      Date.now = () => clock;
      globalThis.setTimeout = (_fn, delay) => { delays.push(delay); return delays.length; };
      globalThis.clearTimeout = () => {};
      globalThis.fetch = async () => {
        calls++;
        clock += 7_001;
        throw new Error('network blocked');
      };
      const routes = new Routes('', () => {});
      await assert.rejects(
        routes.overpassDirect('[out:json];node(0,0,0,0);out;', 15_000, true),
        error => error.error === 'MAP_SOURCE_UNAVAILABLE'
      );
      assert.equal(calls, 2, 'la deadline globale arrête les tentatives avant un troisième délai complet');
      assert.ok(delays.every(delay => delay <= 15_000), 'aucun miroir n’a de délai individuel démesuré');
      assert.deepEqual(delays, [12_000, 6_499]);
    } finally {
      globalThis.fetch = oldFetch;
      Date.now = oldNow;
      globalThis.setTimeout = oldSetTimeout;
      globalThis.clearTimeout = oldClearTimeout;
    }
  });
});
