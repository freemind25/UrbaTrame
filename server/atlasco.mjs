/* Atlas (atlas.co) — « Community Maps » : bibliothèque publique de modèles
   cartographiques (atlas.co/community/maps/) et cartes partagées publiques
   (app.atlas.co/shared/<projectId>).

   Lecture seule, côté serveur uniquement :
   - la page communautaire + ses collections sont des pages publiques
     (sitemap-0.xml liste les /maps/<slug> ; robots.txt autorise tout) :
     on les parse pour obtenir titre, catégorie, image, lien « View solution » ;
   - les métadonnées publiques d'une carte partagée : GET gis-api
     /v1/project/{id}/public-metadata (anonyme, 200) ;
   - l'arborescence des couches d'une carte partagée publique : GET gis-api
     /folders/project/{id}/tree, avec un jeton Firebase ANONYME obtenu via
     accounts:signUp sans mot de passe (même mécanisme que signInAnonymously
     utilisé par leur propre app ; clé web publique embarquée dans leur bundle).
     Ce jeton ne donne accès qu'aux projets explicitement partagés publiquement.
   Le CONTENU des jeux de données (tuiles MVT, GeoJSON, features) exige un
   vrai compte : nous ne le demandons PAS (403 anon) et ne le proposons pas.
   Aucune donnée utilisateur n'est transmise à Atlas. */
import { log, send } from './http.mjs';

export const ATLASCO = {
  site: 'https://atlas.co',
  app: 'https://app.atlas.co',
  gisApi: 'https://gis-api.atlas.co',
  firebaseIdentity: 'https://identitytoolkit.googleapis.com/v1/accounts:signUp',
  firebaseApiKey: 'AIzaSyB_kiOz7PDpsq71ATN3m52HpPEiZDfe5nU', // clé web publique du bundle app.atlas.co
  communityPage: '/community/maps/',
  mapPagePrefix: '/maps/',
  requestTimeoutMs: 15_000,
  listCacheTtlMs: 60 * 60_000,     // la bibliothèque évolue lentement : 1 h
  detailCacheTtlMs: 60 * 60_000,
  layersCacheTtlMs: 10 * 60_000,
  tokenTtlSafety: 0.8              // renouvellement du jeton à 80 % de sa validité (1 h)
};

export const ATLASCO_LIMITS = {
  MAX_Q: 120,
  MAX_LIMIT: 25,
  DEFAULT_LIMIT: 12,
  MAX_OFFSET: 1_000,
  RATE_WINDOW_MS: 60_000,
  RATE_MAX: 30,
  MAX_TEMPLATES: 500
};

/* Catégories affichées sur atlas.co/community/maps/ */
export const ATLASCO_KINDS = [
  { id: 'solution', label: 'Multi-product solution', fr: 'Solution multi-produits' },
  { id: 'workflow', label: 'Workflows', fr: 'Workflow' },
  { id: 'data', label: 'Data', fr: 'Données' }
];
const KIND_BY_LABEL = new Map(ATLASCO_KINDS.map(k => [k.label, k]));
export function atlasCoKindId(label) {
  return KIND_BY_LABEL.get(String(label || '').trim())?.id || null;
}

/* ── Parsing des pages publiques (fonctions pures, testables) ───────────── */

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function cleanText(s) {
  return decodeEntities(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/* Cartes « template » d'une page community : <a href="/maps/<slug>/">…img…titre…kind…</a> */
export function parseTemplateCards(html) {
  const out = [];
  const seen = new Set();
  const re = /<a[^>]+href="(\/maps\/([a-z0-9-]+)\/)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const slug = m[2];
    if (seen.has(slug)) continue;
    const inner = m[3];
    const img = (inner.match(/src="(https:\/\/atlas\.co\/images\/community-maps\/[^"]+)"/) || [])[1] || null;
    const text = cleanText(inner);
    const title = text.replace(/\s*(Multi-product solution|Workflows|Data)\s*$/i, '').trim();
    const kindLabel = (text.match(/(Multi-product solution|Workflows|Data)\s*$/i) || [])[1] || null;
    if (!title) continue;
    seen.add(slug);
    out.push({
      slug,
      title: title.slice(0, 200),
      kind: atlasCoKindId(kindLabel),
      kindLabel: kindLabel || null,
      image: img,
      pageUrl: `${ATLASCO.site}${m[1]}`
    });
  }
  return out;
}

/* Collections de la page d'accueil : <a href="/community/maps/collections/<slug>/">Label N templates</a> */
export function parseCollections(html) {
  const out = [];
  const re = /<a[^>]+href="(\/community\/maps\/collections\/([a-z0-9-]+)\/)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const text = cleanText(m[3]);
    const count = Number((text.match(/(\d+)\s*templates?/) || [])[1]) || null;
    out.push({ slug: m[2], label: text.replace(/\s*\d+\s*templates?\s*$/i, '').trim().slice(0, 120), count });
  }
  return out;
}

/* Page /maps/<slug>/ : shareId + JSON-LD (titre + description) */
export function parseMapPage(html, slug) {
  const shareIds = [...new Set([...html.matchAll(/app\.atlas\.co\/shared\/([A-Za-z0-9]{10,30})/g)].map(m => m[1]))];
  const shareId = shareIds[0] || null;
  let name = null, description = null;
  const ld = html.match(/application\/ld\+json">([\s\S]*?)<\/script>/);
  if (ld) {
    try {
      const j = JSON.parse(ld[1]);
      name = typeof j.name === 'string' ? j.name : null;
      description = typeof j.description === 'string' ? j.description : null;
    } catch { /* ignore */ }
  }
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  return {
    slug,
    title: (name || cleanText(h1 ? h1[1] : '') || slug).slice(0, 200),
    description: (description || '').slice(0, 600) || null,
    shareId,
    shareUrl: shareId ? `${ATLASCO.app}/shared/${shareId}` : null,
    embedUrl: shareId ? `${ATLASCO.app}/embeds/${shareId}` : null,
    duplicateUrl: shareId ? `${ATLASCO.app}/login?projectToDuplicate=${shareId}` : null,
    pageUrl: `${ATLASCO.site}${ATLASCO.mapPagePrefix}${slug}/`
  };
}

/* Arbre des couches d'un projet partagé public → liste aplatie de datasets */
export function flattenSharedTree(tree) {
  const out = [];
  const walk = (node, depth) => {
    if (!node || typeof node !== 'object') return;
    if (node.item_type === 'dataset_in_folder' || node.item_type === 'dataset') {
      const bbox = Array.isArray(node.bbox) && node.bbox.length === 4 && node.bbox.every(Number.isFinite) ? node.bbox : null;
      out.push({
        itemId: String(node.item_id || node.id || ''),
        name: String(node.name || node.path || '').slice(0, 200),
        path: String(node.path || '').slice(0, 300),
        type: String(node.type || ''),
        bbox,
        contentRevision: Number(node.content_revision) || 0
      });
    }
    for (const child of node.children || []) walk(child, depth + 1);
  };
  walk(tree && tree.root_node, 0);
  return out.filter(d => d.itemId && d.name);
}

/* ── Validation des entrées ─────────────────────────────────────────────── */

const SLUG_RE = /^[a-z0-9-]{2,80}$/;
const PROJECT_RE = /^[A-Za-z0-9]{10,30}$/;
const KIND_IDS = new Set(ATLASCO_KINDS.map(k => k.id));

export function sanitizeTemplatesQuery(raw = {}) {
  const q = String(raw.q ?? '').trim().slice(0, ATLASCO_LIMITS.MAX_Q + 1);
  if (q.length > ATLASCO_LIMITS.MAX_Q) throw Object.assign(new Error('QUERY_TOO_LONG'), { code: 'QUERY_TOO_LONG' });
  const kind = String(raw.kind ?? '').trim();
  if (kind && !KIND_IDS.has(kind)) throw Object.assign(new Error('KIND_INVALID'), { code: 'KIND_INVALID' });
  const collection = String(raw.collection ?? '').trim();
  if (collection && !SLUG_RE.test(collection)) throw Object.assign(new Error('COLLECTION_INVALID'), { code: 'COLLECTION_INVALID' });
  const limitRaw = raw.limit === undefined || raw.limit === '' ? ATLASCO_LIMITS.DEFAULT_LIMIT : Number(raw.limit);
  if (!Number.isSafeInteger(limitRaw) || limitRaw < 1 || limitRaw > ATLASCO_LIMITS.MAX_LIMIT)
    throw Object.assign(new Error('LIMIT_INVALID'), { code: 'LIMIT_INVALID' });
  const offsetRaw = raw.offset === undefined || raw.offset === '' ? 0 : Number(raw.offset);
  if (!Number.isSafeInteger(offsetRaw) || offsetRaw < 0 || offsetRaw > ATLASCO_LIMITS.MAX_OFFSET)
    throw Object.assign(new Error('OFFSET_INVALID'), { code: 'OFFSET_INVALID' });
  return { q: q.toLowerCase(), kind: kind || null, collection: collection || null, limit: limitRaw, offset: offsetRaw };
}

export function sanitizeSlug(raw) {
  const slug = String(raw ?? '').trim().toLowerCase();
  if (!SLUG_RE.test(slug)) throw Object.assign(new Error('SLUG_INVALID'), { code: 'SLUG_INVALID' });
  return slug;
}

export function sanitizeProjectId(raw) {
  const id = String(raw ?? '').trim();
  if (!PROJECT_RE.test(id)) throw Object.assign(new Error('PROJECT_INVALID'), { code: 'PROJECT_INVALID' });
  return id;
}

export function filterTemplates(templates, { q, kind, collection, limit, offset }) {
  let list = templates;
  if (kind) list = list.filter(t => t.kind === kind);
  if (collection) list = list.filter(t => (t.collections || []).includes(collection));
  if (q) list = list.filter(t => `${t.title} ${t.slug}`.toLowerCase().includes(q));
  const total = list.length;
  return { total, items: list.slice(offset, offset + limit) };
}

/* ── Client réseau (fetch injectable) ────────────────────────────────────── */

async function fetchText(fetchImpl, url, options, timeoutMs) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { ...options, signal: ac.signal });
    const text = await res.text();
    return { status: res.status, ok: res.ok, text: text.slice(0, 4_000_000), json: async () => JSON.parse(text) };
  } finally { clearTimeout(t); }
}

export function createAtlasCoClient({ fetch: fetchImpl = fetch, now = () => Date.now(), timeoutMs = ATLASCO.requestTimeoutMs, listCacheTtlMs = ATLASCO.listCacheTtlMs, detailCacheTtlMs = ATLASCO.detailCacheTtlMs, layersCacheTtlMs = ATLASCO.layersCacheTtlMs } = {}) {
  let listCache = null;   // { expiresAt, templates, collections }
  let detailCache = new Map();
  let layersCache = new Map();
  let tokenCache = null; // { token, expiresAt }

  async function getAnonymousToken() {
    if (tokenCache && tokenCache.expiresAt > now()) return tokenCache.token;
    // accounts:signUp sans mot de passe = compte Firebase anonyme (comme signInAnonymously)
    const r = await fetchText(fetchImpl, `${ATLASCO.firebaseIdentity}?key=${ATLASCO.firebaseApiKey}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
    }, timeoutMs);
    const json = r.ok ? await r.json().catch(() => null) : null;
    const token = json?.idToken;
    if (!token) throw Object.assign(new Error('ATLASCO_TOKEN_FAILED'), { code: 'ATLASCO_TOKEN_FAILED', status: r.status });
    tokenCache = { token, expiresAt: now() + 3_600_000 * ATLASCO.tokenTtlSafety };
    return token;
  }

  async function listTemplates() {
    if (listCache && listCache.expiresAt > now()) return listCache;
    const main = await fetchText(fetchImpl, `${ATLASCO.site}${ATLASCO.communityPage}`, {}, timeoutMs);
    if (!main.ok) throw Object.assign(new Error('ATLASCO_LIST_FAILED'), { code: 'ATLASCO_LIST_FAILED', status: main.status });
    const collections = parseCollections(main.text);
    const bySlug = new Map();
    for (const t of parseTemplateCards(main.text)) bySlug.set(t.slug, { ...t, collections: [] });
    for (const col of collections) {
      const page = await fetchText(fetchImpl, `${ATLASCO.site}/community/maps/collections/${col.slug}/`, {}, timeoutMs);
      if (!page.ok) continue;
      for (const t of parseTemplateCards(page.text)) {
        const existing = bySlug.get(t.slug) || { ...t, collections: [] };
        if (!existing.collections.includes(col.slug)) existing.collections.push(col.slug);
        if (!existing.image && t.image) existing.image = t.image;
        if (!existing.kind && t.kind) { existing.kind = t.kind; existing.kindLabel = t.kindLabel; }
        bySlug.set(t.slug, existing);
      }
    }
    const templates = [...bySlug.values()].slice(0, ATLASCO_LIMITS.MAX_TEMPLATES);
    listCache = { expiresAt: now() + listCacheTtlMs, templates, collections };
    return listCache;
  }

  async function getMapDetail(slug) {
    const key = slug;
    const cached = detailCache.get(key);
    if (cached && cached.expiresAt > now()) return cached.detail;
    const page = await fetchText(fetchImpl, `${ATLASCO.site}${ATLASCO.mapPagePrefix}${slug}/`, {}, timeoutMs);
    if (!page.ok) throw Object.assign(new Error('ATLASCO_MAP_FAILED'), { code: 'ATLASCO_MAP_FAILED', status: page.status });
    const detail = parseMapPage(page.text, slug);
    detailCache.set(key, { expiresAt: now() + detailCacheTtlMs, detail });
    return detail;
  }

  async function getSharedLayers(projectId) {
    const cached = layersCache.get(projectId);
    if (cached && cached.expiresAt > now()) return cached.layers;
    const token = await getAnonymousToken();
    const r = await fetchText(fetchImpl, `${ATLASCO.gisApi}/folders/project/${projectId}/tree`, {
      headers: { authorization: `Bearer ${token}` }
    }, timeoutMs);
    if (!r.ok) throw Object.assign(new Error('ATLASCO_LAYERS_FAILED'), { code: 'ATLASCO_LAYERS_FAILED', status: r.status });
    const json = await r.json();
    const layers = flattenSharedTree(json);
    layersCache.set(projectId, { expiresAt: now() + layersCacheTtlMs, layers });
    return layers;
  }

  return { listTemplates, getMapDetail, getSharedLayers, getAnonymousToken };
}

/* ── Handlers HTTP ──────────────────────────────────────────────────────── */

function createRateLimiter({ now, rateLimit = ATLASCO_LIMITS.RATE_MAX, rateWindowMs = ATLASCO_LIMITS.RATE_WINDOW_MS } = {}) {
  const hitsByIp = new Map();
  return ip => {
    const t = now();
    const arr = (hitsByIp.get(ip) || []).filter(ts => t - ts < rateWindowMs);
    hitsByIp.set(ip, arr);
    if (arr.length >= rateLimit) return Math.ceil((arr[0] + rateWindowMs - t) / 1000);
    arr.push(t);
    return null;
  };
}

export function createAtlasCoHandlers({ client = createAtlasCoClient(), now = () => Date.now(), logger = log } = {}) {
  const rateLimited = createRateLimiter({ now });

  function readQuery(req) {
    try { return new URL(req.url, 'http://x'); } catch { return null; }
  }

  async function templates(req, res, ip) {
    if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'GET only' });
    const url = readQuery(req);
    if (!url) return send(res, 400, { ok: false, error: 'BAD_URL' });
    let input;
    try { input = sanitizeTemplatesQuery(Object.fromEntries(url.searchParams.entries())); }
    catch (error) { return send(res, 400, { ok: false, error: error.code || 'BAD_PARAMS' }); }
    const retryAfter = rateLimited(ip);
    if (retryAfter) return send(res, 429, { ok: false, error: 'RATE_LIMITED', retryAfter }, 'application/json; charset=utf-8', { 'Retry-After': String(retryAfter) });
    try {
      const { templates: all, collections } = await client.listTemplates();
      const result = filterTemplates(all, input);
      logger(`atlasco templates q=${input.q || '*'} kind=${input.kind || '-'} coll=${input.collection || '-'} -> ${result.total} ip=${ip}`);
      send(res, 200, {
        ok: true,
        total: result.total,
        kinds: ATLASCO_KINDS.map(k => ({ id: k.id, label: k.label, fr: k.fr })),
        collections,
        items: result.items
      });
    } catch (error) {
      logger(`atlasco templates ERREUR code=${error.code || '?'} status=${error.status || '?'} ip=${ip}`);
      send(res, 502, { ok: false, error: error.code || 'ATLASCO_FAILED' });
    }
  }

  async function map(req, res, ip) {
    if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'GET only' });
    const url = readQuery(req);
    if (!url) return send(res, 400, { ok: false, error: 'BAD_URL' });
    let slug;
    try { slug = sanitizeSlug(url.searchParams.get('slug')); }
    catch (error) { return send(res, 400, { ok: false, error: error.code || 'BAD_PARAMS' }); }
    const retryAfter = rateLimited(ip);
    if (retryAfter) return send(res, 429, { ok: false, error: 'RATE_LIMITED', retryAfter }, 'application/json; charset=utf-8', { 'Retry-After': String(retryAfter) });
    try {
      const detail = await client.getMapDetail(slug);
      logger(`atlasco map slug=${slug} share=${detail.shareId || '-'} ip=${ip}`);
      send(res, 200, { ok: true, ...detail });
    } catch (error) {
      const status = error.status === 404 ? 404 : 502;
      send(res, status, { ok: false, error: error.code || 'ATLASCO_FAILED' });
    }
  }

  async function layers(req, res, ip) {
    if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'GET only' });
    const url = readQuery(req);
    if (!url) return send(res, 400, { ok: false, error: 'BAD_URL' });
    let project;
    try { project = sanitizeProjectId(url.searchParams.get('project')); }
    catch (error) { return send(res, 400, { ok: false, error: error.code || 'BAD_PARAMS' }); }
    const retryAfter = rateLimited(ip);
    if (retryAfter) return send(res, 429, { ok: false, error: 'RATE_LIMITED', retryAfter }, 'application/json; charset=utf-8', { 'Retry-After': String(retryAfter) });
    try {
      const list = await client.getSharedLayers(project);
      logger(`atlasco layers project=${project} -> ${list.length} couche(s) ip=${ip}`);
      send(res, 200, { ok: true, project, layers: list });
    } catch (error) {
      logger(`atlasco layers ERREUR project=${project} code=${error.code || '?'} status=${error.status || '?'} ip=${ip}`);
      send(res, 502, { ok: false, error: error.code || 'ATLASCO_FAILED' });
    }
  }

  return { templates, map, layers };
}
