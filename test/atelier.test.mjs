import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATASET_IDS, queryFor, validateSite, withoutContactTags } from '../server/atelier-data.mjs';
import { createAtelierHandlers } from '../server/atelier-api.mjs';

function response() {
  return {
    statusCode: 0, headers: {}, body: '',
    writeHead(code, headers) { this.statusCode = code; this.headers = headers; },
    end(body = '') { this.body = String(body); }
  };
}
async function call(handler, method, body) {
  const req = { method, body, headers: {}, socket: { remoteAddress: '127.0.0.1' } };
  const res = response();
  await handler(req, res);
  return { ...res, json: res.body ? JSON.parse(res.body) : null };
}

describe('Freemap · section Altiplan', () => {
  test('les coordonnées et le rayon sont validés avant toute requête', () => {
    const site = validateSite(36.2642, 6.6969, 600);
    assert.match(site.bbox, /^36\.[0-9]+,6\.[0-9]+,36\.[0-9]+,6\.[0-9]+$/);
    assert.equal(DATASET_IDS.length, 8);
    assert.throws(() => validateSite(NaN, 6, 600), /INVALID_LOCATION/);
    assert.throws(() => validateSite(90, 6, 600), /INVALID_LOCATION/);
    assert.throws(() => validateSite(36, 6, 100), /RADIUS_OUT_OF_RANGE/);
    assert.throws(() => validateSite(36, 6, 5000), /RADIUS_OUT_OF_RANGE/);
  });

  test('Overpass ne reçoit que les couches autorisées, arbres et parcelles comprises', () => {
    const q = queryFor({ lat: 36.2642, lon: 6.6969, radius: 600, include: ['buildings', 'trees', 'parcels'] });
    assert.match(q, /way\["building"\]/);
    assert.match(q, /way\["building:part"\]/);
    assert.match(q, /node\["natural"="tree"\]/);
    assert.match(q, /way\["boundary"="parcel"\]/);
    assert.doesNotMatch(q, /evil|interpreter|\.\.\//);
    assert.throws(() => queryFor({ lat: 36, lon: 6, radius: 600, include: ['unknown'] }), /NO_DATASETS_SELECTED/);
  });

  test('les coordonnées de contact OSM sont retirées sans modifier la source', () => {
    const source = [{ type: 'node', id: 1, tags: {
      name: 'Lieu', email: 'a@example.test', phone: '000', website: 'https://example.test',
      'contact:facebook': 'x', opening_hours: '24/7', amenity: 'cafe'
    }, members: [{ tags: { 'operator:phone': '111', ref: 'A' } }] }];
    const clean = withoutContactTags(source);
    assert.deepEqual(clean[0].tags, { name: 'Lieu', amenity: 'cafe' });
    assert.deepEqual(clean[0].members[0].tags, { ref: 'A' });
    assert.equal(source[0].tags.email, 'a@example.test');
  });

  test('l’exemple embarqué ne contient pas de coordonnées de contact', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const demo = JSON.parse(fs.readFileSync(path.join(root, 'public/data/atelier-elkhroub.json'), 'utf8'));
    const hasContact = item => {
      if (!item || typeof item !== 'object') return false;
      if (Object.keys(item.tags || {}).some(key => /^(email|phone|fax|website|opening_hours)$/i.test(key) ||
        /^contact:/i.test(key) || /:(email|phone|fax|website)$/i.test(key))) return true;
      return Array.isArray(item.members) && item.members.some(hasContact);
    };
    assert.ok(demo.elements.every(item => !hasContact(item)));
  });

  test('health et géocodage sont intégrés à Freemap et mis en cache', async () => {
    let calls = 0;
    const h = createAtelierHandlers({
      geocode: async () => { calls++; return [{ display_name: 'El Khroub', lat: '36.2642', lon: '6.6969', type: 'city' }]; },
      now: () => 1_700_000_000_000, log: () => {}
    });
    const health = await call(h.health, 'GET');
    assert.equal(health.statusCode, 200);
    assert.equal(health.json.name, 'Freemap');
    assert.equal(health.json.feature, 'atelier-topographique');
    const first = await call(h.geocode, 'POST', { q: 'El Khroub' });
    const second = await call(h.geocode, 'POST', { q: 'El Khroub' });
    assert.equal(first.json.results[0].name, 'El Khroub');
    assert.equal(second.json.cached, true);
    assert.equal(calls, 1);
  });

  test('l’extraction publique filtre les contacts, traite le relief manquant et ne dépend pas d’un compte', async () => {
    let requestedQuery = '';
    const h = createAtelierHandlers({
      overpass: async query => {
        requestedQuery = query;
        return { elements: [{ type: 'node', id: 7, tags: { natural: 'tree', email: 'secret@example.test' } }] };
      },
      terrain: async () => { throw new Error('tiles offline'); },
      now: () => 1_700_000_000_000, log: () => {}
    });
    const result = await call(h.extract, 'POST', {
      lat: 36.2642, lon: 6.6969, radius: 600, include: ['trees'], terrainN: 24
    });
    assert.equal(result.statusCode, 200);
    assert.match(requestedQuery, /natural.*tree/);
    assert.deepEqual(result.json.warnings, ['RELIEF_UNAVAILABLE']);
    assert.deepEqual(result.json.elements[0].tags, { natural: 'tree' });
    assert.equal(result.json.terrain, null);
    assert.equal(result.json.ok, true);
  });

  test('les données invalides sont refusées sans appeler les sources', async () => {
    let calls = 0;
    const h = createAtelierHandlers({ overpass: async () => { calls++; return { elements: [] }; }, log: () => {} });
    const badLocation = await call(h.extract, 'POST', { lat: 91, lon: 0, radius: 600, include: ['trees'] });
    const noLayers = await call(h.extract, 'POST', { lat: 36, lon: 6, radius: 600, include: [] });
    const shortSearch = await call(h.geocode, 'POST', { q: 'x' });
    assert.equal(badLocation.statusCode, 400);
    assert.equal(noLayers.statusCode, 400);
    assert.equal(shortSearch.statusCode, 400);
    assert.equal(calls, 0);
  });
});
