/* Layer Atlas (https://layeratlas.com) — proxy LECTURE SEULE du catalogue
   communautaire de couches géospatiales (édité par A. Pasotti / Kartoza).

   Ce module ne fait QUE lire des données publiques :
   1. identité anonyme Cognito (identity pool public du site, "unauthenticated
      identities enabled") ;
   2. requête AppSync signée AWS_IAM (SigV4) `TypesenseApiKeyQuery`, qui renvoie
      une clé Typesense de RECHERCHE limitée aux assets publics (la clé embarquée
      contient filter_by: visibleByGroups:[public]) ;
   3. recherche Typesense (GET /collections/assets-prod/documents/search) avec
      exactement les mêmes paramètres que le front de layeratlas.com.

   Aucune écriture n'est possible avec cette clé, et la clé analytics du bundle
   (X-TYPESENSE-API-KEY en dur chez eux) n'est JAMAIS utilisée ici.
   Aucune donnée utilisateur n'est transmise : seuls les termes de recherche et
   filtres explicites envoyés par l'utilisateur atteignent Layer Atlas.
   Les fichiers des assets (.qlr, datasets) ne sont PAS téléchargeables
   anonymement (S3 privé) : on ne sert que les métadonnées + miniatures. */
import crypto from 'node:crypto';
import { LAYERATLAS_CATEGORIES, LAYERATLAS_CATEGORY_BY_ID, isLayerAtlasCategory, layerAtlasAssetTypeLabel } from '../public/js/atelier/layeratlas-categories.mjs';
import { log, send } from './http.mjs';

export const LAYERATLAS = {
  region: 'eu-west-3',
  identityPoolId: 'eu-west-3:67fc3763-cc61-4c8d-9315-472bb520f03a',
  appsyncEndpoint: 'https://djftdhtdwnh6notkiqsyalyyrm.appsync-api.eu-west-3.amazonaws.com/graphql',
  typesenseHost: 'l0pic5w7kf2nxza8p-1.a1.typesense.net',
  collection: 'assets-prod',
  queryBy: ['name', 'organization', 'keywords', 'description', 'attributionTitle'],
  facetBy: 'organization, keywords, category',
  sortBy: '_text_match(buckets:10):desc,popularity:desc'
};

export const LAYERATLAS_LIMITS = {
  MAX_Q: 120,
  MAX_LIMIT: 25,
  DEFAULT_LIMIT: 12,
  MAX_OFFSET: 10_000,
  KEY_TTL_SAFETY: 0.8,          // on renouvelle la clé à 80 % de son validité
  SEARCH_CACHE_TTL_MS: 120_000, // 2 min : la recherche est read-only et stable
  REQUEST_TIMEOUT_MS: 15_000,
  RATE_WINDOW_MS: 60_000,
  RATE_MAX: 30                   // 30 recherches / minute / IP
};

const sha256hex = data => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

/* ── Validation des entrées (tout ce qui part chez Layer Atlas) ─────────── */

/* Caractères sûrs pour un filtre Typesense : on n'accepte que des valeurs
   simples (lettres, chiffres, espaces, - _ . /). Guillemets et antislash
   sont REFUSÉS : aucune injection de filtre possible. */
const FILTER_VALUE_RE = /^[\p{L}\p{N} _.\-/]{1,60}$/u;

export function sanitizeFilterValue(value, code = 'FILTER_VALUE_INVALID') {
  const v = String(value ?? '').trim();
  if (!v) return { ok: true, value: null };
  if (!FILTER_VALUE_RE.test(v)) throw Object.assign(new Error(code), { code });
  return { ok: true, value: v };
}

export function sanitizeSearchInput(raw = {}) {
  const q = String(raw.q ?? '').trim().slice(0, LAYERATLAS_LIMITS.MAX_Q + 1);
  if (q.length > LAYERATLAS_LIMITS.MAX_Q) throw Object.assign(new Error('QUERY_TOO_LONG'), { code: 'QUERY_TOO_LONG' });
  const category = String(raw.category ?? '').trim();
  if (category && !isLayerAtlasCategory(category)) throw Object.assign(new Error('CATEGORY_INVALID'), { code: 'CATEGORY_INVALID' });
  const limitRaw = raw.limit === undefined || raw.limit === '' ? LAYERATLAS_LIMITS.DEFAULT_LIMIT : Number(raw.limit);
  if (!Number.isSafeInteger(limitRaw) || limitRaw < 1 || limitRaw > LAYERATLAS_LIMITS.MAX_LIMIT)
    throw Object.assign(new Error('LIMIT_INVALID'), { code: 'LIMIT_INVALID' });
  const offsetRaw = raw.offset === undefined || raw.offset === '' ? 0 : Number(raw.offset);
  if (!Number.isSafeInteger(offsetRaw) || offsetRaw < 0 || offsetRaw > LAYERATLAS_LIMITS.MAX_OFFSET)
    throw Object.assign(new Error('OFFSET_INVALID'), { code: 'OFFSET_INVALID' });
  const organization = sanitizeFilterValue(raw.organization, 'ORGANIZATION_INVALID').value;
  const keyword = sanitizeFilterValue(raw.keyword, 'KEYWORD_INVALID').value;
  return {
    q: q || '*',
    category: category || null,
    organization,
    keyword,
    limit: limitRaw,
    offset: offsetRaw
  };
}

/* Construit le filter_by Typesense (mêmes facettes que leur front). */
export function buildFilterBy({ category = null, organization = null, keyword = null } = {}) {
  const parts = [];
  if (category) {
    if (!isLayerAtlasCategory(category)) throw Object.assign(new Error('CATEGORY_INVALID'), { code: 'CATEGORY_INVALID' });
    parts.push(`category:=${category}`);
  }
  if (organization) parts.push(`organization:="${organization}"`);
  if (keyword) parts.push(`keywords:="${keyword}"`);
  return parts.join(' && ');
}

export function buildTypesenseSearchParams(input) {
  const p = new URLSearchParams();
  p.set('q', input.q);
  p.set('query_by', LAYERATLAS.queryBy.join(','));
  const filterBy = buildFilterBy(input);
  if (filterBy) p.set('filter_by', filterBy);
  p.set('facet_by', LAYERATLAS.facetBy);
  p.set('sort_by', LAYERATLAS.sortBy);
  p.set('highlight_fields', 'none');
  p.set('limit', String(input.limit));
  p.set('offset', String(input.offset));
  return p;
}

/* ── Sanitation des réponses (on ne renvoie au navigateur qu'une liste blanche) ── */

const HIT_FIELDS = ['id', 'name', 'assetType', 'category', 'organization', 'keywords', 'description', 'attributionTitle', 'attributionURL', 'thumbnailUrl', 'attachedFilePaths', 'popularity', 'createdAt', 'updatedAt'];
const MAX_FACET_COUNTS = 10;

export function sanitizeHit(doc = {}) {
  const out = {};
  for (const key of HIT_FIELDS) {
    const v = doc[key];
    if (v === undefined || v === null) continue;
    if (key === 'keywords' || key === 'attachedFilePaths') {
      if (Array.isArray(v)) out[key] = v.filter(x => typeof x === 'string').slice(0, key === 'keywords' ? 12 : 5);
    } else if (typeof v === 'string' || typeof v === 'number') {
      out[key] = typeof v === 'string' ? v.slice(0, key === 'description' ? 600 : 300) : v;
    }
  }
  if (typeof out.thumbnailUrl === 'string' && !/^https:\/\/upcdn\.io\/[A-Za-z0-9]+\//.test(out.thumbnailUrl)) out.thumbnailUrl = null;
  if (typeof out.attributionURL === 'string' && !/^https:\/\//.test(out.attributionURL)) out.attributionURL = null;
  out.categoryLabel = LAYERATLAS_CATEGORY_BY_ID.get(out.category)?.label || out.category || null;
  out.assetTypeLabel = layerAtlasAssetTypeLabel(out.assetType);
  return out;
}

export function sanitizeSearchResponse(json = {}) {
  const hits = Array.isArray(json.hits) ? json.hits.map(h => sanitizeHit(h.document || {})) : [];
  const facets = Array.isArray(json.facet_counts) ? json.facet_counts.map(f => ({
    field: String(f.field_name || ''),
    counts: (Array.isArray(f.counts) ? f.counts : []).slice(0, MAX_FACET_COUNTS).map(c => ({ value: String(c.value ?? ''), count: Number(c.count) || 0 }))
  })) : [];
  return {
    found: Number(json.found) || 0,
    outOf: Number(json.out_of) || 0,
    page: Number(json.page) || 1,
    hits,
    facets
  };
}

/* ── Client réseau (fetch injectable pour les tests) ────────────────────── */

function sigV4Headers({ method, url, headers, body, service, region, accessKey, secretKey, sessionToken, amzdate }) {
  const u = new URL(url);
  const datestamp = amzdate.slice(0, 8);
  const payloadHash = sha256hex(body);
  const all = { ...headers, host: u.host, 'x-amz-date': amzdate, 'x-amz-content-sha256': payloadHash };
  if (sessionToken) all['x-amz-security-token'] = sessionToken;
  const names = Object.keys(all).map(k => k.toLowerCase()).sort();
  const canonicalHeaders = names.map(k => `${k}:${String(all[k]).trim().replace(/\s+/g, ' ')}\n`).join('');
  const canonicalRequest = [method, u.pathname, u.search, canonicalHeaders, names.join(';'), payloadHash].join('\n');
  const scope = `${datestamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzdate, scope, sha256hex(canonicalRequest)].join('\n');
  let k = hmac(`AWS4${secretKey}`, datestamp);
  k = hmac(k, region); k = hmac(k, service); k = hmac(k, 'aws4_request');
  const signature = crypto.createHmac('sha256', k).update(stringToSign).digest('hex');
  return { ...all, authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` };
}

async function fetchJsonWithTimeout(fetchImpl, url, options, timeoutMs) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { ...options, signal: ac.signal });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* garde null */ }
    return { status: res.status, ok: res.ok, json, text: text.slice(0, 500) };
  } finally { clearTimeout(t); }
}

/* Client Layer Atlas en lecture seule, avec clé mise en cache. */
export function createLayerAtlasClient({ fetch: fetchImpl = fetch, now = () => Date.now(), timeoutMs = LAYERATLAS_LIMITS.REQUEST_TIMEOUT_MS } = {}) {
  let keyCache = null; // { key, expiresAt }

  async function cognito(action, payload) {
    const body = JSON.stringify(payload);
    const r = await fetchJsonWithTimeout(fetchImpl, `https://cognito-identity.${LAYERATLAS.region}.amazonaws.com/`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': `AWSCognitoIdentityService.${action}` },
      body
    }, timeoutMs);
    if (!r.ok) throw Object.assign(new Error('LAYERATLAS_COGNITO_FAILED'), { code: 'LAYERATLAS_COGNITO_FAILED', status: r.status, detail: r.text });
    return r.json;
  }

  async function getSearchKey() {
    if (keyCache && keyCache.expiresAt > now()) return keyCache.key;
    const id = await cognito('GetId', { IdentityPoolId: LAYERATLAS.identityPoolId });
    const creds = await cognito('GetCredentialsForIdentity', { IdentityId: id.IdentityId });
    const c = creds.Credentials;
    const amzdate = new Date(now()).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const gql = JSON.stringify({ query: 'query TypesenseApiKeyQuery { TypesenseApiKeyQuery { TYPESENSE_USER_APIKEY } }' });
    const headers = sigV4Headers({
      method: 'POST', url: LAYERATLAS.appsyncEndpoint, service: 'appsync', region: LAYERATLAS.region,
      headers: { 'content-type': 'application/json' }, body: gql,
      accessKey: c.AccessKeyId, secretKey: c.SecretKey, sessionToken: c.SessionToken, amzdate
    });
    const r = await fetchJsonWithTimeout(fetchImpl, LAYERATLAS.appsyncEndpoint, { method: 'POST', headers, body: gql }, timeoutMs);
    const key = r.ok ? r.json?.data?.TypesenseApiKeyQuery?.TYPESENSE_USER_APIKEY : null;
    if (!key) throw Object.assign(new Error('LAYERATLAS_KEY_FAILED'), { code: 'LAYERATLAS_KEY_FAILED', status: r.status, detail: r.text });
    const expiresAt = now() + Math.max(60_000, Number(c.Expiration ? (new Date(c.Expiration).getTime() - now()) * LAYERATLAS_LIMITS.KEY_TTL_SAFETY : 3_600_000));
    keyCache = { key, expiresAt };
    return key;
  }

  async function search(input) {
    const key = await getSearchKey();
    const url = `https://${LAYERATLAS.typesenseHost}/collections/${LAYERATLAS.collection}/documents/search?${buildTypesenseSearchParams(input)}`;
    const r = await fetchJsonWithTimeout(fetchImpl, url, { headers: { 'X-TYPESENSE-API-KEY': key } }, timeoutMs);
    if (!r.ok) throw Object.assign(new Error('LAYERATLAS_SEARCH_FAILED'), { code: 'LAYERATLAS_SEARCH_FAILED', status: r.status, detail: r.text });
    return sanitizeSearchResponse(r.json);
  }

  return { search, getSearchKey, _cacheSize: () => (keyCache ? 1 : 0) };
}

/* ── Handler HTTP GET /api/layeratlas/search ────────────────────────────── */

export function createLayerAtlasSearchHandler({ client = createLayerAtlasClient(), now = () => Date.now(), logger = log, rateLimit = LAYERATLAS_LIMITS.RATE_MAX, rateWindowMs = LAYERATLAS_LIMITS.RATE_WINDOW_MS, cacheTtlMs = LAYERATLAS_LIMITS.SEARCH_CACHE_TTL_MS } = {}) {
  const cache = new Map();   // clé normalisée -> { expiresAt, payload }
  const hitsByIp = new Map(); // ip -> [timestamps]

  function rateLimited(ip) {
    const t = now();
    const arr = (hitsByIp.get(ip) || []).filter(ts => t - ts < rateWindowMs);
    hitsByIp.set(ip, arr);
    if (arr.length >= rateLimit) return Math.ceil((arr[0] + rateWindowMs - t) / 1000);
    arr.push(t);
    return null;
  }

  return async function search(req, res, ip = 'unknown') {
    let url;
    try { url = new URL(req.url, 'http://x'); } catch { return send(res, 400, { ok: false, error: 'BAD_URL' }); }
    if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'GET only' });
    let input;
    try {
      input = sanitizeSearchInput(Object.fromEntries(url.searchParams.entries()));
    } catch (error) {
      return send(res, 400, { ok: false, error: error.code || 'BAD_PARAMS' });
    }
    const retryAfter = rateLimited(ip);
    if (retryAfter) return send(res, 429, { ok: false, error: 'RATE_LIMITED', retryAfter }, 'application/json; charset=utf-8', { 'Retry-After': String(retryAfter) });

    const cacheKey = JSON.stringify(input);
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > now()) {
      logger(`layeratlas search (cache) q=${input.q} cat=${input.category || '-'} ip=${ip}`);
      return send(res, 200, { ok: true, cached: true, ...cached.payload });
    }

    try {
      const payload = await client.search(input);
      cache.set(cacheKey, { expiresAt: now() + cacheTtlMs, payload });
      logger(`layeratlas search q=${input.q} cat=${input.category || '-'} org=${input.organization || '-'} kw=${input.keyword || '-'} -> ${payload.found}/${payload.outOf} ip=${ip}`);
      send(res, 200, { ok: true, cached: false, ...payload });
    } catch (error) {
      logger(`layeratlas search ERREUR q=${input.q} code=${error.code || '?'} status=${error.status || '?'} ip=${ip}`);
      const status = error.code === 'LAYERATLAS_KEY_FAILED' || error.code === 'LAYERATLAS_COGNITO_FAILED' ? 502 : 502;
      send(res, status, { ok: false, error: error.code || 'LAYERATLAS_FAILED' });
    }
  };
}

export { LAYERATLAS_CATEGORIES };
