import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  LAYERATLAS, LAYERATLAS_LIMITS, sanitizeSearchInput, sanitizeFilterValue, buildFilterBy,
  buildTypesenseSearchParams, sanitizeHit, sanitizeSearchResponse, createLayerAtlasClient, createLayerAtlasSearchHandler
} from '../server/layeratlas.mjs';
import {
  LAYERATLAS_CATEGORIES as CLIENT_CATEGORIES, buildSearchParams, normalizeHit,
  layerAtlasThumbnailUrl, buildCitation, readFavorites, toggleFavorite, LAYERATLAS_FAVORITES_KEY
} from '../public/js/atelier/layeratlas.mjs';
import { LAYERATLAS_CATEGORIES as SHARED_CATEGORIES } from '../public/js/atelier/layeratlas-categories.mjs';

const EXPECTED_CATEGORIES = [
  ['cat1', 'Basemap'], ['cat2', 'Imagery'], ['cat3', 'Agriculture'], ['cat4', 'Culture'],
  ['cat5', 'Demography'], ['cat6', 'Economy'], ['cat7', 'Education'], ['cat8', 'Energy'],
  ['cat9', 'Environnement'], ['cat10', 'Geology'], ['cat11', 'Health'], ['cat12', 'Historical'],
  ['cat13', 'Infrastructure'], ['cat14', 'Marine'], ['cat15', 'Political'], ['cat16', 'Tourism'],
  ['cat17', 'Transport']
];

const SAMPLE_DOC = {
  id: 'bb18c1a0-9915-4b00-a294-36047f2fa72a',
  name: 'OSM Standard',
  assetType: 'QgsLayerDefinition',
  category: 'cat1',
  organization: 'OpenStreetMap (OSM)',
  keywords: ['Community', 'World'],
  description: 'Fond OpenStreetMap standard.',
  attributionTitle: '© OpenStreetMap contributors, CC-BY-SA',
  attributionURL: 'https://www.openstreetmap.org/copyright',
  thumbnailUrl: 'https://upcdn.io/12a1z1w/raw/asset-thumbnails-prod/4kRKwffqEL-file.jpeg',
  attachedFilePaths: ['public/eu-west-3:xxx/bb18c1a0.qlr'],
  popularity: 663,
  createdAt: '2024-08-08T14:19:57.867Z',
  updatedAt: '2024-08-08T14:19:57.867Z',
  owners: ['secret-owner-id'],          // champ interne : ne doit PAS sortir
  visibleByGroups: ['public']           // idem
};

function mockStorage() {
  const map = new Map();
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k)
  };
}

describe('UrbaTrame · catalogue Layer Atlas (lecture seule)', () => {
  test('les 17 catégories du catalogue sont épinglées et identiques des deux côtés', () => {
    assert.deepEqual(SHARED_CATEGORIES.map(c => [c.id, c.label]), EXPECTED_CATEGORIES);
    assert.deepEqual(CLIENT_CATEGORIES.map(c => [c.id, c.label]), EXPECTED_CATEGORIES);
    assert.equal(LAYERATLAS.collection, 'assets-prod');
    assert.equal(LAYERATLAS.queryBy.join(','), 'name,organization,keywords,description,attributionTitle');
  });

  test('sanitizeSearchInput valide et normalise les paramètres', () => {
    const input = sanitizeSearchInput({ q: '  OSM ', category: 'cat1', organization: 'Geofabrik', keyword: 'World', limit: '12', offset: '24' });
    assert.deepEqual(input, { q: 'OSM', category: 'cat1', organization: 'Geofabrik', keyword: 'World', limit: 12, offset: 24 });
    assert.equal(sanitizeSearchInput({}).q, '*'); // parcourir tout le catalogue
    assert.equal(sanitizeSearchInput({ q: '' }).q, '*');
    assert.equal(sanitizeSearchInput({ limit: '' }).limit, LAYERATLAS_LIMITS.DEFAULT_LIMIT);
    assert.throws(() => sanitizeSearchInput({ q: 'x'.repeat(121) }), e => e.code === 'QUERY_TOO_LONG');
    assert.throws(() => sanitizeSearchInput({ category: 'cat99' }), e => e.code === 'CATEGORY_INVALID');
    assert.throws(() => sanitizeSearchInput({ category: 'cat1; DROP' }), e => e.code === 'CATEGORY_INVALID');
    assert.throws(() => sanitizeSearchInput({ limit: 0 }), e => e.code === 'LIMIT_INVALID');
    assert.throws(() => sanitizeSearchInput({ limit: 26 }), e => e.code === 'LIMIT_INVALID');
    assert.throws(() => sanitizeSearchInput({ offset: -1 }), e => e.code === 'OFFSET_INVALID');
    assert.throws(() => sanitizeSearchInput({ organization: 'evil" || x:=' }), e => e.code === 'ORGANIZATION_INVALID');
  });

  test('buildFilterBy construit des filtres Typesense sûrs', () => {
    assert.equal(buildFilterBy({}), '');
    assert.equal(buildFilterBy({ category: 'cat5' }), 'category:=cat5');
    assert.equal(buildFilterBy({ category: 'cat5', organization: 'IGN', keyword: 'World' }), 'category:=cat5 && organization:="IGN" && keywords:="World"');
    assert.throws(() => buildFilterBy({ category: 'nope' }), e => e.code === 'CATEGORY_INVALID');
    // une valeur avec guillemet/antislash est REFUSÉE (pas d'injection de filtre)
    assert.throws(() => sanitizeFilterValue('Mon "Org"'), e => e.code === 'FILTER_VALUE_INVALID');
    assert.throws(() => sanitizeFilterValue('a\\b'), e => e.code === 'FILTER_VALUE_INVALID');
    assert.equal(sanitizeFilterValue('IGN France').value, 'IGN France');
  });

  test('buildTypesenseSearchParams reproduit la requête du front de layeratlas.com', () => {
    const p = buildTypesenseSearchParams(sanitizeSearchInput({ q: 'Algeria', category: 'cat1', limit: 5, offset: 10 }));
    assert.equal(p.get('q'), 'Algeria');
    assert.equal(p.get('query_by'), 'name,organization,keywords,description,attributionTitle');
    assert.equal(p.get('facet_by'), 'organization, keywords, category');
    assert.equal(p.get('sort_by'), '_text_match(buckets:10):desc,popularity:desc');
    assert.equal(p.get('highlight_fields'), 'none');
    assert.equal(p.get('filter_by'), 'category:=cat1');
    assert.equal(p.get('limit'), '5');
    assert.equal(p.get('offset'), '10');
  });

  test('sanitizeHit ne renvoie qu’une liste blanche, sans owners/visibleByGroups', () => {
    const hit = sanitizeHit(SAMPLE_DOC);
    assert.equal(hit.name, 'OSM Standard');
    assert.equal(hit.categoryLabel, 'Basemap');
    assert.equal(hit.assetTypeLabel, 'Définition de couche QGIS (.qlr)');
    assert.equal(hit.owners, undefined);
    assert.equal(hit.visibleByGroups, undefined);
    assert.equal(hit.thumbnailUrl, SAMPLE_DOC.thumbnailUrl);
    // une miniature non upcdn est neutralisée
    assert.equal(sanitizeHit({ id: 'x', thumbnailUrl: 'https://evil.example.com/t.png' }).thumbnailUrl, null);
    assert.equal(sanitizeHit({ id: 'x', attributionURL: 'javascript:alert(1)' }).attributionURL, null);
    assert.deepEqual(sanitizeHit({ id: 'x', keywords: ['a', 42, 'b'] }).keywords, ['a', 'b']);
  });

  test('sanitizeSearchResponse tronque les facettes et garde les compteurs numériques', () => {
    const out = sanitizeSearchResponse({
      found: '12', out_of: 555, page: 1,
      hits: [{ document: SAMPLE_DOC }],
      facet_counts: [{ field_name: 'organization', counts: Array.from({ length: 30 }, (_, i) => ({ value: 'org' + i, count: String(30 - i) })) }]
    });
    assert.equal(out.found, 12);
    assert.equal(out.outOf, 555);
    assert.equal(out.hits.length, 1);
    assert.equal(out.facets[0].counts.length, 10);
    assert.equal(out.facets[0].counts[0].count, 30);
  });

  test('client : flux anonyme Cognito → AppSync → Typesense, avec clé mise en cache', async () => {
    const calls = [];
    const fakeFetch = async (url, options = {}) => {
      calls.push({ url, target: options.headers?.['x-amz-target'], auth: options.headers?.authorization });
      if (String(url).includes('cognito-identity')) {
        if (options.headers['x-amz-target'] === 'AWSCognitoIdentityService.GetId')
          return { ok: true, status: 200, text: async () => JSON.stringify({ IdentityId: 'eu-west-3:test' }) , json: undefined };
        return { ok: true, status: 200, text: async () => JSON.stringify({ Credentials: { AccessKeyId: 'AKIA_TEST', SecretKey: 'secret', SessionToken: 'token', Expiration: new Date(Date.now() + 3_600_000).toISOString() } }) };
      }
      if (String(url).includes('appsync')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ data: { TypesenseApiKeyQuery: { TYPESENSE_USER_APIKEY: 'KEY123' } } }) };
      }
      if (String(url).includes('typesense.net')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ found: 1, out_of: 1, hits: [{ document: SAMPLE_DOC }], facet_counts: [] }) };
      }
      throw new Error('URL inattendue ' + url);
    };
    // fetchJsonWithTimeout attend res.text() puis JSON.parse : on fournit les deux
    const client = createLayerAtlasClient({ fetch: fakeFetch, now: () => 1_000_000 });
    const r1 = await client.search(sanitizeSearchInput({ q: 'OSM' }));
    assert.equal(r1.found, 1);
    assert.equal(r1.hits[0].name, 'OSM Standard');
    const typesenseCall = calls.find(c => String(c.url).includes('typesense.net'));
    assert.match(typesenseCall.url, /documents\/search\?/);
    assert.match(typesenseCall.url, /q=OSM/);
    assert.equal(client._cacheSize(), 1);
    await client.search(sanitizeSearchInput({ q: 'Algeria' }));
    // la clé est réutilisée : toujours 3 appels réseau au total (cognito x2 + appsync x1), pas 5
    assert.equal(calls.filter(c => String(c.url).includes('appsync')).length, 1);
    // la requête AppSync est signée SigV4 (IAM anonyme), jamais avec la clé analytics
    const appsyncCall = calls.find(c => String(c.url).includes('appsync'));
    assert.match(appsyncCall.auth, /^AWS4-HMAC-SHA256 Credential=AKIA_TEST\//);
    assert.match(appsyncCall.auth, /SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date;x-amz-security-token/);
  });

  test('handler : 200 + cache, 400 sur paramètres invalides, 429 au-delà du quota', async () => {
    let searchCalls = 0;
    const client = { search: async input => { searchCalls++; return { found: 1, outOf: 1, page: 1, hits: [sanitizeHit(SAMPLE_DOC)], facets: [] }; } };
    const handler = createLayerAtlasSearchHandler({ client, now: () => 1_000_000, rateLimit: 3, rateWindowMs: 60_000 });
    const mkRes = () => {
      const res = { statusCode: 0, body: '', headers: {} };
      res.writeHead = (code, headers) => { res.statusCode = code; Object.assign(res.headers, headers || {}); };
      res.end = payload => { res.body = payload; };
      return res;
    };
    const req = q => ({ method: 'GET', url: '/api/layeratlas/search?' + q, headers: {} });

    let res = mkRes();
    await handler(req('q=OSM&limit=5'), res, '1.2.3.4');
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.equal(body.hits[0].name, 'OSM Standard');
    assert.equal(body.hits[0].owners, undefined);

    res = mkRes();
    await handler(req('q=OSM&limit=5'), res, '1.2.3.4'); // mêmes params -> cache
    assert.equal(JSON.parse(res.body).cached, true);
    assert.equal(searchCalls, 1);

    res = mkRes();
    await handler(req('q=x&category=cat99'), res, '1.2.3.4');
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).error, 'CATEGORY_INVALID');

    res = mkRes();
    await handler(req('q=a'), res, '1.2.3.4'); // 3e appel IP 1.2.3.4 -> ok (la 400 ne consomme pas de quota)
    assert.equal(res.statusCode, 200);
    res = mkRes();
    await handler(req('q=b'), res, '1.2.3.4'); // 4e appel dans la fenêtre -> 429
    assert.equal(res.statusCode, 429);
    assert.equal(JSON.parse(res.body).error, 'RATE_LIMITED');
    assert.ok(res.headers['Retry-After']);

    res = mkRes();
    await handler({ method: 'POST', url: '/api/layeratlas/search?q=x', headers: {} }, res, '9.9.9.9');
    assert.equal(res.statusCode, 405);
  });

  test('client : buildSearchParams valide avant envoi', () => {
    const p = buildSearchParams({ q: 'Constantine', category: 'cat15', limit: 12, offset: 24 });
    assert.equal(p.get('q'), 'Constantine');
    assert.equal(p.get('category'), 'cat15');
    assert.equal(p.get('limit'), '12');
    assert.equal(p.get('offset'), '24');
    assert.equal(buildSearchParams({}).get('q'), '*');
    assert.throws(() => buildSearchParams({ q: 'x'.repeat(121) }), e => e.code === 'QUERY_TOO_LONG');
    assert.throws(() => buildSearchParams({ category: 'cat42' }), e => e.code === 'CATEGORY_INVALID');
    assert.throws(() => buildSearchParams({ limit: 99 }), e => e.code === 'LIMIT_INVALID');
  });

  test('client : normalizeHit, miniature redimensionnée et citation complète', () => {
    const hit = normalizeHit(SAMPLE_DOC);
    assert.equal(hit.categoryLabel, 'Basemap');
    assert.equal(hit.assetTypeLabel, 'Définition de couche QGIS (.qlr)');
    assert.equal(hit.attributionURL, 'https://www.openstreetmap.org/copyright');
    const thumb = layerAtlasThumbnailUrl(SAMPLE_DOC);
    assert.equal(thumb, 'https://upcdn.io/12a1z1w/image/asset-thumbnails-prod/4kRKwffqEL-file.jpeg?w=300&h=200&fit=crop');
    assert.equal(layerAtlasThumbnailUrl({ id: 'x', thumbnailUrl: '' }), null);
    const citation = buildCitation(SAMPLE_DOC, new Date('2026-11-15T10:00:00Z'));
    assert.match(citation, /OSM Standard/);
    assert.match(citation, /OpenStreetMap \(OSM\)/);
    assert.match(citation, /layeratlas\.com/);
    assert.match(citation, /© OpenStreetMap contributors, CC-BY-SA/);
    assert.match(citation, /consulté le 2026-11-15/);
  });

  test('client : favoris en localStorage, bascule et plafond', () => {
    const storage = mockStorage();
    assert.deepEqual(readFavorites(storage), []);
    const r1 = toggleFavorite(SAMPLE_DOC, storage, () => '2026-11-15T10:00:00.000Z');
    assert.equal(r1.added, true);
    assert.equal(r1.favorites.length, 1);
    assert.equal(r1.favorites[0].id, SAMPLE_DOC.id);
    const r2 = toggleFavorite(SAMPLE_DOC, storage);
    assert.equal(r2.added, false);
    assert.equal(r2.favorites.length, 0);
    for (let i = 0; i < 120; i++) toggleFavorite({ id: 'id-' + i, name: 'n' + i }, storage);
    assert.equal(readFavorites(storage).length, 100);
    storage.setItem(LAYERATLAS_FAVORITES_KEY, '{"pas":"un tableau"}');
    assert.deepEqual(readFavorites(storage), []);
    assert.throws(() => toggleFavorite({ name: 'sans id' }, storage), e => e.code === 'FAVORITE_INVALID');
  });
});
