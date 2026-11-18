import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ATLASCO, ATLASCO_KINDS, parseTemplateCards, parseCollections, parseMapPage, flattenSharedTree,
  sanitizeTemplatesQuery, sanitizeSlug, sanitizeProjectId, filterTemplates, createAtlasCoClient, createAtlasCoHandlers
} from '../server/atlasco.mjs';
import {
  ATLASCO_KINDS as CLIENT_KINDS, buildTemplatesParams, normalizeTemplate, kindFr, extractAtlasProjectId,
  buildCitation, readFavorites, toggleFavorite, ATLASCO_FAVORITES_KEY
} from '../public/js/atelier/atlasco.mjs';

const COMMUNITY_HTML = `
<html><body>
<a href="/community/maps/collections/energy-utilities/"><img src="/x.png">Energy &amp; Utilities 9 templates</a>
<a href="/community/maps/collections/government-public-sector/">Government &amp; Public Sector 13 templates</a>
<a href="/maps/global-power-plants-map/"><img src="https://atlas.co/images/community-maps/global-power-plants-map.jpg"><span>Global Power Plants Map</span><span>Multi-product solution</span></a>
<a href="/maps/analyzing-airbnb-data/"><img src="https://atlas.co/images/community-maps/airbnb-data.jpg">Analyzing Airbnb Data Workflows</a>
<a href="/maps/population-in-africa/"><img src="https://atlas.co/images/community-maps/population-in-africa.jpg">Population in Africa Data</a>
<a href="/maps/global-power-plants-map/">doublon</a>
</body></html>`;

const MAP_HTML = `
<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage","name":"Global Power Plants Map","description":"Interactive global map of power plants."}</script></head>
<body><a href="https://app.atlas.co/shared/YoMNg7XIlgeQkwf9yXQb?loc=8.3z">View solution</a>
<a href="https://app.atlas.co/login?projectToDuplicate=YoMNg7XIlgeQkwf9yXQb">Use this template</a></body></html>`;

const TREE = {
  root_node: {
    item_type: 'folder', name: 'Root', children: [
      { item_type: 'dataset_in_folder', item_id: 'ds-1', name: 'global-power-plant-database', path: 'Root/global-power-plant-database', type: 'vector', bbox: [-179.1, -77.8, 179.3, 71.2], content_revision: 3, children: [] },
      { item_type: 'folder', name: 'Sous-dossier', children: [
        { item_type: 'dataset_in_folder', item_id: 'ds-2', name: 'frontières', path: 'Root/Sous-dossier/frontières', type: 'vector', bbox: 'pas-un-bbox', children: [] }
      ] }
    ]
  }
};

function mockStorage() {
  const map = new Map();
  return { getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k) };
}

describe('UrbaTrame · cartes communautaires Atlas (atlas.co), lecture seule', () => {
  test('parse les cartes modèles de la page community (titre, catégorie, image, dédoublonnage)', () => {
    const cards = parseTemplateCards(COMMUNITY_HTML);
    assert.equal(cards.length, 3);
    assert.deepEqual(cards[0], {
      slug: 'global-power-plants-map', title: 'Global Power Plants Map', kind: 'solution',
      kindLabel: 'Multi-product solution',
      image: 'https://atlas.co/images/community-maps/global-power-plants-map.jpg',
      pageUrl: 'https://atlas.co/maps/global-power-plants-map/'
    });
    assert.equal(cards[1].kind, 'workflow');
    assert.equal(cards[2].kind, 'data');
    const collections = parseCollections(COMMUNITY_HTML);
    assert.deepEqual(collections.map(c => [c.slug, c.label, c.count]), [
      ['energy-utilities', 'Energy & Utilities', 9],
      ['government-public-sector', 'Government & Public Sector', 13]
    ]);
  });

  test('parse la page /maps/<slug>/ : shareId, JSON-LD, liens', () => {
    const d = parseMapPage(MAP_HTML, 'global-power-plants-map');
    assert.equal(d.shareId, 'YoMNg7XIlgeQkwf9yXQb');
    assert.equal(d.shareUrl, 'https://app.atlas.co/shared/YoMNg7XIlgeQkwf9yXQb');
    assert.equal(d.embedUrl, 'https://app.atlas.co/embeds/YoMNg7XIlgeQkwf9yXQb');
    assert.equal(d.title, 'Global Power Plants Map');
    assert.match(d.description, /power plants/);
    assert.equal(d.pageUrl, 'https://atlas.co/maps/global-power-plants-map/');
    // page sans shareId → pas de shareUrl
    assert.equal(parseMapPage('<html></html>', 'x').shareUrl, null);
  });

  test('aplatit l’arbre d’une carte partagée en liste de couches sûre', () => {
    const layers = flattenSharedTree(TREE);
    assert.equal(layers.length, 2);
    assert.equal(layers[0].itemId, 'ds-1');
    assert.deepEqual(layers[0].bbox, [-179.1, -77.8, 179.3, 71.2]);
    assert.equal(layers[1].bbox, null); // bbox invalide neutralisé
    assert.equal(layers[1].name, 'frontières');
  });

  test('validation des paramètres des routes', () => {
    const q = sanitizeTemplatesQuery({ q: 'Power', kind: 'data', collection: 'energy-utilities', limit: '10', offset: '20' });
    assert.deepEqual(q, { q: 'power', kind: 'data', collection: 'energy-utilities', limit: 10, offset: 20 });
    assert.equal(sanitizeTemplatesQuery({}).limit, 12);
    assert.throws(() => sanitizeTemplatesQuery({ q: 'x'.repeat(121) }), e => e.code === 'QUERY_TOO_LONG');
    assert.throws(() => sanitizeTemplatesQuery({ kind: 'hack' }), e => e.code === 'KIND_INVALID');
    assert.throws(() => sanitizeTemplatesQuery({ collection: '../etc' }), e => e.code === 'COLLECTION_INVALID');
    assert.throws(() => sanitizeTemplatesQuery({ limit: 99 }), e => e.code === 'LIMIT_INVALID');
    assert.throws(() => sanitizeSlug('Bad Slug!'), e => e.code === 'SLUG_INVALID');
    assert.equal(sanitizeSlug(' global-power-plants-map '), 'global-power-plants-map');
    assert.throws(() => sanitizeProjectId('short'), e => e.code === 'PROJECT_INVALID');
    assert.equal(sanitizeProjectId('YoMNg7XIlgeQkwf9yXQb'), 'YoMNg7XIlgeQkwf9yXQb');
  });

  test('filterTemplates : recherche plein texte, kind, collection, pagination', () => {
    const all = parseTemplateCards(COMMUNITY_HTML).map(t => ({ ...t, collections: t.slug === 'global-power-plants-map' ? ['energy-utilities'] : [] }));
    assert.equal(filterTemplates(all, sanitizeTemplatesQuery({})).total, 3);
    assert.equal(filterTemplates(all, sanitizeTemplatesQuery({ q: 'power' })).total, 1);
    assert.equal(filterTemplates(all, sanitizeTemplatesQuery({ kind: 'data' })).total, 1);
    assert.equal(filterTemplates(all, sanitizeTemplatesQuery({ collection: 'energy-utilities' })).total, 1);
    const page = filterTemplates(all, sanitizeTemplatesQuery({ limit: 2, offset: 2 }));
    assert.equal(page.total, 3);
    assert.equal(page.items.length, 1);
  });

  test('client : liste via pages publiques, détail via /maps/<slug>, couches via jeton Firebase anonyme (mock)', async () => {
    const calls = [];
    const fakeFetch = async (url, options = {}) => {
      calls.push({ url: String(url), auth: options.headers?.authorization, method: options.method || 'GET' });
      const u = String(url);
      const text = async () => {
        if (u.includes('identitytoolkit')) return JSON.stringify({ idToken: 'FB_ANON_TOKEN', expiresIn: '3600' });
        if (u.endsWith('/community/maps/')) return COMMUNITY_HTML;
        if (u.includes('/community/maps/collections/')) return COMMUNITY_HTML;
        if (u.includes('/maps/global-power-plants-map/')) return MAP_HTML;
        if (u.includes('/folders/project/')) return JSON.stringify(TREE);
        throw new Error('URL inattendue ' + u);
      };
      return { ok: true, status: 200, text, json: async () => JSON.parse(await text()) };
    };
    const client = createAtlasCoClient({ fetch: fakeFetch, now: () => 1_000_000 });
    const list = await client.listTemplates();
    assert.equal(list.templates.length, 3);
    assert.equal(list.collections.length, 2);
    assert.ok(list.templates.find(t => t.slug === 'global-power-plants-map').collections.includes('energy-utilities'));
    const detail = await client.getMapDetail('global-power-plants-map');
    assert.equal(detail.shareId, 'YoMNg7XIlgeQkwf9yXQb');
    const layers = await client.getSharedLayers('YoMNg7XIlgeQkwf9yXQb');
    assert.equal(layers.length, 2);
    // le jeton Firebase anonyme a été obtenu puis réutilisé (cache)
    assert.equal(calls.filter(c => c.url.includes('identitytoolkit')).length, 1);
    const treeCall = calls.find(c => c.url.includes('/folders/project/'));
    assert.equal(treeCall.auth, 'Bearer FB_ANON_TOKEN');
    await client.getSharedLayers('YoMNg7XIlgeQkwf9yXQb');
    assert.equal(calls.filter(c => c.url.includes('identitytoolkit')).length, 1); // toujours 1 : jeton en cache
  });

  test('handlers : 200 + filtres, 400, 429, 404', async () => {
    const client = {
      listTemplates: async () => ({ templates: parseTemplateCards(COMMUNITY_HTML).map(t => ({ ...t, collections: [] })), collections: parseCollections(COMMUNITY_HTML) }),
      getMapDetail: async slug => {
        if (slug !== 'global-power-plants-map') throw Object.assign(new Error('nf'), { code: 'ATLASCO_MAP_FAILED', status: 404 });
        return parseMapPage(MAP_HTML, slug);
      },
      getSharedLayers: async () => flattenSharedTree(TREE)
    };
    const h = createAtlasCoHandlers({ client, now: () => 1_000_000 });
    const mkRes = () => {
      const res = { statusCode: 0, body: '', headers: {} };
      res.writeHead = (code, headers) => { res.statusCode = code; Object.assign(res.headers, headers || {}); };
      res.end = p => { res.body = p; };
      return res;
    };
    const req = (path, q) => ({ method: 'GET', url: `/api/atlasco/${path}${q}`, headers: {} });

    let res = mkRes();
    await h.templates(req('templates', '?q=power&kind=solution&limit=5'), res, '1.1.1.1');
    assert.equal(res.statusCode, 200);
    let body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.equal(body.total, 1);
    assert.equal(body.items[0].slug, 'global-power-plants-map');
    assert.equal(body.kinds.length, ATLASCO_KINDS.length);
    assert.equal(body.collections.length, 2);

    res = mkRes();
    await h.templates(req('templates', '?kind=hack'), res, '1.1.1.1');
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).error, 'KIND_INVALID');

    res = mkRes();
    await h.map(req('map', '?slug=Bad!'), res, '1.1.1.1');
    assert.equal(res.statusCode, 400);

    res = mkRes();
    await h.map(req('map', '?slug=global-power-plants-map'), res, '1.1.1.1');
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).shareUrl, 'https://app.atlas.co/shared/YoMNg7XIlgeQkwf9yXQb');

    res = mkRes();
    await h.map(req('map', '?slug=inconnu'), res, '1.1.1.1');
    assert.equal(res.statusCode, 404);

    res = mkRes();
    await h.layers(req('layers', '?project=YoMNg7XIlgeQkwf9yXQb'), res, '1.1.1.1');
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).layers.length, 2);

    res = mkRes();
    await h.layers(req('layers', '?project=!!'), res, '1.1.1.1');
    assert.equal(res.statusCode, 400);

    // quota : 30 req/min/IP dépassé -> 429
    let last = mkRes();
    for (let i = 0; i < 31; i++) { last = mkRes(); await h.templates(req('templates', '?q=x' + i), last, '2.2.2.2'); }
    assert.equal(last.statusCode, 429);
    assert.equal(JSON.parse(last.body).error, 'RATE_LIMITED');
  });

  test('client : extractAtlasProjectId accepte lien shared/embeds ou ID brut, refuse le reste', () => {
    assert.equal(extractAtlasProjectId('https://app.atlas.co/shared/YoMNg7XIlgeQkwf9yXQb?loc=8.3,17.9,2.1z'), 'YoMNg7XIlgeQkwf9yXQb');
    assert.equal(extractAtlasProjectId('https://app.atlas.co/embeds/YoMNg7XIlgeQkwf9yXQb'), 'YoMNg7XIlgeQkwf9yXQb');
    assert.equal(extractAtlasProjectId('  YoMNg7XIlgeQkwf9yXQb  '), 'YoMNg7XIlgeQkwf9yXQb');
    assert.throws(() => extractAtlasProjectId(''), e => e.code === 'PROJECT_INVALID');
    assert.throws(() => extractAtlasProjectId('https://atlas.co/maps/global-power-plants-map/'), e => e.code === 'PROJECT_INVALID');
    assert.throws(() => extractAtlasProjectId('https://app.atlas.co/shared/ab!'), e => e.code === 'PROJECT_INVALID');
    assert.throws(() => extractAtlasProjectId('12345'), e => e.code === 'PROJECT_INVALID');
  });

  test('client : params, normalisation, citation, favoris', () => {
    const p = buildTemplatesParams({ q: 'Power', kind: 'data', collection: 'energy-utilities', limit: 12, offset: 24 });
    assert.equal(p.get('q'), 'Power');
    assert.equal(p.get('kind'), 'data');
    assert.equal(p.get('collection'), 'energy-utilities');
    assert.throws(() => buildTemplatesParams({ q: 'x'.repeat(121) }), e => e.code === 'QUERY_TOO_LONG');
    assert.equal(CLIENT_KINDS.length, 3);
    assert.equal(kindFr('solution'), 'Solution multi-produits');
    const t = normalizeTemplate({ slug: 'global-power-plants-map', title: 'Global Power Plants Map', kind: 'solution', image: 'https://atlas.co/images/community-maps/x.jpg', pageUrl: 'https://atlas.co/maps/global-power-plants-map/', collections: ['energy-utilities'] });
    assert.equal(t.image, 'https://atlas.co/images/community-maps/x.jpg');
    assert.equal(normalizeTemplate({ slug: 'x', image: 'https://evil.example.com/i.png' }).image, null);
    const citation = buildCitation(t, new Date('2026-11-15T10:00:00Z'));
    assert.match(citation, /Global Power Plants Map/);
    assert.match(citation, /atlas\.co\/community\/maps/);
    assert.match(citation, /catégorie : Solution multi-produits/);
    assert.match(citation, /consulté le 2026-11-15/);

    const storage = mockStorage();
    assert.deepEqual(readFavorites(storage), []);
    const r1 = toggleFavorite(t, storage, () => '2026-11-15T10:00:00.000Z');
    assert.equal(r1.added, true);
    assert.equal(r1.favorites[0].slug, 'global-power-plants-map');
    assert.equal(toggleFavorite(t, storage).added, false);
    for (let i = 0; i < 120; i++) toggleFavorite({ slug: 's' + i, title: 't' + i }, storage);
    assert.equal(readFavorites(storage).length, 100);
    storage.setItem(ATLASCO_FAVORITES_KEY, '42');
    assert.deepEqual(readFavorites(storage), []);
    assert.throws(() => toggleFavorite({ title: 'sans slug' }, storage), e => e.code === 'FAVORITE_INVALID');
  });
});
