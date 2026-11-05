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
