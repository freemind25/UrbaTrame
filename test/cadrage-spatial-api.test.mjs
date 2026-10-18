import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CADRAGE_DATASET_IDS, MAX_CADRAGE_RADIUS, MAX_RADIUS, queryForCadrage, queryFor
} from '../server/atelier-data.mjs';
import { createAtelierHandlers } from '../server/atelier-api.mjs';

function response() {
  return {
    statusCode: 0, headers: {}, body: '',
    writeHead(code, headers) { this.statusCode = code; this.headers = headers; },
    end(body = '') { this.body = String(body); }
  };
}
async function call(handler, method, body) {
  const req = { method, url: '/api/atelier/cadrage-extract', body, headers: {}, socket: { remoteAddress: '127.0.0.1' } };
  const res = response(); await handler(req, res);
  return { ...res, json: res.body ? JSON.parse(res.body) : null };
}

describe('Cadrage spatial · plafond serveur distinct', () => {
  test('la requête dédiée accepte 3 000 m, refuse tout dépassement et ne permet pas de sélecteur libre', () => {
    assert.equal(MAX_CADRAGE_RADIUS, 3000);
    assert.equal(CADRAGE_DATASET_IDS.includes('parcels'), false);
    const query = queryForCadrage({ lat: 36.7538, lon: 3.0588, radius: 3000, include: ['roads', 'barriers', 'places'] });
    assert.match(query, /highway/);
    assert.match(query, /barrier/);
    assert.match(query, /place/);
    assert.match(query, /around:3000\.0,36\.7538000,3\.0588000/);
    assert.doesNotMatch(query, /boundary.*parcel/);
    assert.doesNotMatch(query, /evil|interpreter|\.\.\//);
    assert.throws(() => queryForCadrage({ lat: 36.7538, lon: 3.0588, radius: 3000.01, include: ['roads'] }), /CADRAGE_RADIUS_OUT_OF_RANGE/);
    assert.throws(() => queryForCadrage({ lat: 36, lon: 6, radius: 600, include: ['anything'] }), /NO_DATASETS_SELECTED/);
  });

  test('la route Cadrage refuse >3 000 m avant tout appel externe', async () => {
    let calls = 0;
    const handlers = createAtelierHandlers({
      overpass: async () => { calls++; return { elements: [] }; },
      terrain: async () => { calls++; return null; }, log: () => {}
    });
    const result = await call(handlers.extractCadrage, 'POST', {
      lat: 36.7538, lon: 3.0588, radius: 3000.1, include: ['roads'], terrain: true
    });
    assert.equal(result.statusCode, 400);
    assert.equal(result.json.error, 'CADRAGE_RADIUS_OUT_OF_RANGE');
    assert.equal(result.json.maxRadius, 3000);
    assert.equal(calls, 0);
  });

  test('la route dédiée extrait seulement les thèmes autorisés et transmet le rayon plafond', async () => {
    let requestedQuery = '', terrainCalls = 0;
    const handlers = createAtelierHandlers({
      overpass: async query => { requestedQuery = query; return { elements: [{ type: 'node', id: 2, lat: 36.75, lon: 3.05, tags: { place: 'neighbourhood', name: 'Quartier' } }] }; },
      terrain: async (lat, lon, radius, n) => { terrainCalls++; assert.equal(radius, 3000); assert.equal(n, 24); return { n, grid: [[40]], lat, lon, radius, zoom: 12 }; },
      now: () => 1_800_000_000_000, log: () => {}
    });
    const result = await call(handlers.extractCadrage, 'POST', {
      lat: 36.7538, lon: 3.0588, radius: 3000, include: ['roads', 'places'], terrain: true
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.json.ok, true);
    assert.equal(result.json.maxRadius, 3000);
    assert.match(requestedQuery, /place/);
    assert.match(requestedQuery, /highway/);
    assert.doesNotMatch(requestedQuery, /building/);
    assert.equal(terrainCalls, 1);
    assert.equal(result.json.elements.length, 1);
    assert.equal(result.json.source.osm, 'OpenStreetMap contributors (ODbL)');
  });

  test('la réponse trop volumineuse est refusée avec un message compréhensible', async () => {
    const elements = Array.from({ length: 12001 }, (_, index) => ({ type: 'node', id: index + 1, lat: 36.75, lon: 3.05, tags: { amenity: 'bench' } }));
    const handlers = createAtelierHandlers({ overpass: async () => ({ elements }), terrain: async () => null, log: () => {} });
    const result = await call(handlers.extractCadrage, 'POST', {
      lat: 36.7538, lon: 3.0588, radius: 200, include: ['pois'], terrain: false
    });
    assert.equal(result.statusCode, 413);
    assert.equal(result.json.error, 'CADRAGE_DATA_LIMIT');
    assert.match(result.json.message, /Réduisez le rayon/);
  });

  test('le plafond historique d’Altiplan reste inchangé et la nouvelle route est intégrée', async () => {
    assert.equal(MAX_RADIUS, 3989);
    const requested = [];
    const handlers = createAtelierHandlers({ overpass: async query => { requested.push(query); return { elements: [] }; }, terrain: async () => null, log: () => {} });
    const old = await call(handlers.extract, 'POST', { lat: 36.7538, lon: 3.0588, radius: 3989, include: ['roads'], terrain: false });
    assert.equal(old.statusCode, 200);
    assert.equal(requested.length, 1);
    assert.match(requested[0], /highway/);
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const api = fs.readFileSync(path.join(root, 'server/api.mjs'), 'utf8');
    const vercel = fs.readFileSync(path.join(root, 'api/atelier/cadrage-extract.js'), 'utf8');
    assert.match(api, /\/api\/atelier\/cadrage-extract/);
    assert.match(vercel, /handleAtelierCadrageExtract/);
  });
});
