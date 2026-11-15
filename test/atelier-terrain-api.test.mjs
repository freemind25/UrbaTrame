import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createAtelierHandlers } from '../server/atelier-api.mjs';
import { createApi } from '../server/api.mjs';

function response() {
  return {
    statusCode: 200, headers: {}, body: '',
    writeHead(status, headers = {}) { this.statusCode = status; this.headers = headers; },
    end(body = '') { this.body = String(body); },
    get json() { try { return JSON.parse(this.body); } catch { return null; } }
  };
}

async function call(handler, { method = 'POST', url = '/', body = {} } = {}) {
  const req = { method, url, body, headers: { 'content-type': 'application/json' }, socket: { remoteAddress: '127.0.0.1' } };
  const res = response();
  await handler(req, res);
  return res;
}

const gridFor = n => Array.from({ length: n }, (_, row) =>
  Array.from({ length: n }, (_, col) => 100 + row + col));

describe('API du relief Terrarium', () => {
  test('charge explicitement une grille de la résolution demandée', async () => {
    let requested;
    const handlers = createAtelierHandlers({
      terrain: async (lat, lon, radius, n) => {
        requested = { lat, lon, radius, n };
        return { lat, lon, radius, n, zoom: 14, grid: gridFor(n) };
      },
      now: () => 1_700_000_000_000,
      log: () => {}
    });
    const result = await call(handlers.terrain, {
      body: { lat: 36.2642, lon: 6.6969, radius: 300, n: 16 }
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.json.ok, true);
    assert.equal(result.json.terrain.grid.length, 16);
    assert.deepEqual(requested, { lat: 36.2642, lon: 6.6969, radius: 300, n: 16 });
    assert.match(result.json.source.elevation, /Terrarium.*AWS/);
    assert.equal(result.json.extractedAt, new Date(1_700_000_000_000).toISOString());
  });

  test('refuse les coordonnées invalides et le dépassement du budget de tuiles avant tout fetch', async () => {
    let tileCalls = 0;
    const handlers = createAtelierHandlers({
      terrain: async () => { tileCalls++; return {}; },
      log: () => {}
    });
    const invalid = await call(handlers.terrain, {
      body: { lat: 86, lon: 6, radius: 300, n: 24 }
    });
    const outside = await call(handlers.terrain, {
      body: { lat: 84.9, lon: 6, radius: 30_000, n: 24 }
    });
    const budget = await call(handlers.terrain, {
      body: { lat: 36.2642, lon: 6.6969, radius: 1_000_000, n: 24 }
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.json.error, 'INVALID_TERRAIN_REQUEST');
    assert.equal(outside.statusCode, 400);
    assert.equal(outside.json.error, 'TERRAIN_OUTSIDE_MAP');
    assert.equal(budget.statusCode, 413);
    assert.equal(budget.json.error, 'TERRAIN_TILE_BUDGET');
    assert.equal(tileCalls, 0);
  });

  test('le relais renvoie une erreur claire si les tuiles publiques sont indisponibles', async () => {
    const handlers = createAtelierHandlers({
      terrain: async () => { throw new Error('offline'); },
      log: () => {}
    });
    const result = await call(handlers.terrain, {
      body: { lat: 36.2642, lon: 6.6969, radius: 300, n: 24 }
    });
    assert.equal(result.statusCode, 502);
    assert.equal(result.json.error, 'TERRAIN_UNAVAILABLE');
  });
});

describe('routage et protection OTP du relief', () => {
  const base = {
    licence: { pubB64: '', knownCodes: () => [], check: () => ({ ok: true, tier: 'free' }) },
    quota: {}, runs: {}, publicDir: '.'
  };

  test('la route intégrée reconnaît le chemin et valide la requête avant le réseau', async () => {
    const handler = createApi({ ...base, studentAuth: { required: false, ready: true } });
    const result = await call(handler, {
      url: '/api/atelier/terrain',
      body: { lat: 36, lon: 6, radius: 20 }
    });
    assert.equal(result.statusCode, 400);
    assert.equal(result.json.error, 'INVALID_TERRAIN_REQUEST');
  });

  test('le mode OTP requis ferme la nouvelle route lorsque l’auth n’est pas prête', async () => {
    const handler = createApi({ ...base, studentAuth: { required: true, ready: false } });
    const result = await call(handler, {
      url: '/api/atelier/terrain',
      body: { lat: 36, lon: 6, radius: 300 }
    });
    assert.equal(result.statusCode, 503);
    assert.equal(result.json.error, 'STUDENT_AUTH_UNAVAILABLE');
  });

  test('le routeur Vercel consolidé autorise explicitement ce chemin', () => {
    const entry = fs.readFileSync(new URL('../api/index.js', import.meta.url), 'utf8');
    const routeSet = entry.slice(entry.indexOf('const API_PATHS'), entry.indexOf('function queryValue'));
    assert.match(routeSet, /'\/api\/atelier\/terrain'/);
    const config = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
    assert.ok(config.rewrites.some(rule => rule.source === '/api/(.*)' && rule.destination === '/api?__path=/$1'));
  });
});

describe('API atelier archi (relevé rue / typo-morpho par relais serveur)', () => {
  function archiHandlers(overpassImpl) {
    return createAtelierHandlers({ overpass: overpassImpl, log: () => {}, now: () => 1_700_000_000_000 });
  }
  test('kind=rue : requête composée serveur, coordonnées bornées, éléments nettoyés', async () => {
    let query;
    const handlers = archiHandlers(async (q) => { query = q; return { elements: [{ type: 'way', tags: { highway: 'residential', 'contact:email': 'x@y.z', phone: '123' }, geometry: [{ lat: 36, lon: 6 }] }] }; });
    const res = await call(handlers.archi, { body: { kind: 'rue', lat: 48.862, lon: 2.347, radius: 150 } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.kind, 'rue');
    assert.ok(query.includes('way["highway"](around:150,48.862,2.347)'), 'requête composée côté serveur');
    assert.ok(query.includes('out geom 600'));
    assert.equal(res.json.elements.length, 1);
    assert.equal(res.json.elements[0].tags['contact:email'], undefined, 'contact:email retiré');
    assert.equal(res.json.elements[0].tags.phone, undefined, 'phone retiré');
    assert.equal(res.json.elements[0].tags.highway, 'residential', 'tags utiles conservés');
  });
  test('tissu-bat / tissu-voies : deux requêtes distinctes', async () => {
    const qs = [];
    const handlers = archiHandlers(async (q) => { qs.push(q); return { elements: [] }; });
    await call(handlers.archi, { body: { kind: 'tissu-bat', lat: 36, lon: 6, radius: 150 } });
    await call(handlers.archi, { body: { kind: 'tissu-voies', lat: 36, lon: 6, radius: 150 } });
    assert.ok(qs[0].includes('way["building"]') && !qs[0].includes('way["highway"]'));
    assert.ok(qs[1].includes('way["highway"]') && qs[1].includes('leisure'));
  });
  test('coordonnées invalides → 400 ; rayon clampé à [60, 200]', async () => {
    let radius;
    const handlers = archiHandlers(async (q) => { radius = Number(q.match(/around:(\d+)/)[1]); return { elements: [] }; });
    const bad = await call(handlers.archi, { body: { kind: 'rue', lat: 95, lon: 6, radius: 150 } });
    assert.equal(bad.statusCode, 400);
    assert.equal(bad.json.error, 'INVALID_COORDS');
    await call(handlers.archi, { body: { kind: 'rue', lat: 36, lon: 6, radius: 9999 } });
    assert.equal(radius, 200, 'rayon clampé à 200 m');
    await call(handlers.archi, { body: { kind: 'rue', lat: 36, lon: 6, radius: 10 } });
    assert.equal(radius, 60, 'rayon clampé à 60 m min');
  });
  test('cache 10 min : 2e appel identique servi depuis le cache', async () => {
    let n = 0;
    const handlers = archiHandlers(async () => { n += 1; return { elements: [] }; });
    await call(handlers.archi, { body: { kind: 'rue', lat: 36.1, lon: 6.1, radius: 150 } });
    const res = await call(handlers.archi, { body: { kind: 'rue', lat: 36.1, lon: 6.1, radius: 150 } });
    assert.equal(n, 1, 'une seule requête Overpass');
    assert.equal(res.json.cached, true);
  });
  test('échec Overpass → 502 MAP_DATA_UNAVAILABLE avec retryAfter', async () => {
    const handlers = archiHandlers(async () => { const e = new Error('busy'); e.retryAfter = 30; throw e; });
    const res = await call(handlers.archi, { body: { kind: 'rue', lat: 36.2, lon: 6.2, radius: 150 } });
    assert.equal(res.statusCode, 502);
    assert.equal(res.json.error, 'MAP_DATA_UNAVAILABLE');
    assert.equal(res.json.retryAfter, 30);
    assert.equal(res.headers['Retry-After'], '30');
  });
  test('kind inconnu → ramené à "rue" ; GET → 405', async () => {
    let query = '';
    const handlers = archiHandlers(async (q) => { query = q; return { elements: [] }; });
    const res = await call(handlers.archi, { body: { kind: 'pirate', lat: 36, lon: 6, radius: 150 } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json.kind, 'rue');
    assert.ok(query.includes('way["highway"]'));
    const get = await call(handlers.archi, { method: 'GET', body: {} });
    assert.equal(get.statusCode, 405);
  });
});
