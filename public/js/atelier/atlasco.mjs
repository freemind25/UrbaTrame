/* Atlas (atlas.co) — logique cliente PURE du panneau « Cartes communautaires
   Atlas ». Toute requête passe par NOTRE proxy /api/atlasco/* (lecture seule) ;
   seules les images des modèles sont chargées directement depuis atlas.co
   (images publiques, même logique que les tuiles OSM). */

export const ATLASCO_TEMPLATES_URL = '/api/atlasco/templates';
export const ATLASCO_MAP_URL = '/api/atlasco/map';
export const ATLASCO_LAYERS_URL = '/api/atlasco/layers';
export const ATLASCO_SITE_URL = 'https://atlas.co/';
export const ATLASCO_COMMUNITY_URL = 'https://atlas.co/community/maps/';
export const ATLASCO_FAVORITES_KEY = 'urbatrame:atlasco:favorites:v1';
export const ATLASCO_MAX_FAVORITES = 100;
export const ATLASCO_MAX_Q = 120;
export const ATLASCO_PAGE_SIZE = 12;

export const ATLASCO_KINDS = [
  { id: 'solution', fr: 'Solution multi-produits' },
  { id: 'workflow', fr: 'Workflow' },
  { id: 'data', fr: 'Données' }
];

export const ATLASCO_SUGGESTIONS = [
  'street light', 'tree', 'power plants', 'election', 'shelter', 'store locator',
  'restaurant', 'airbnb', 'wind', 'population', 'submarine', 'melbourne', 'school'
];

export function buildTemplatesParams({ q = '', kind = '', collection = '', limit = ATLASCO_PAGE_SIZE, offset = 0 } = {}) {
  const query = String(q ?? '').trim();
  if (query.length > ATLASCO_MAX_Q) throw Object.assign(new Error('La recherche dépasse 120 caractères.'), { code: 'QUERY_TOO_LONG' });
  const params = new URLSearchParams();
  params.set('q', query);
  if (kind) params.set('kind', kind);
  if (collection) params.set('collection', collection);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25) throw Object.assign(new Error('Limite invalide.'), { code: 'LIMIT_INVALID' });
  if (!Number.isSafeInteger(offset) || offset < 0) throw Object.assign(new Error('Page invalide.'), { code: 'OFFSET_INVALID' });
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  return params;
}

export function normalizeTemplate(item = {}) {
  const image = typeof item.image === 'string' && /^https:\/\/atlas\.co\/images\//.test(item.image) ? item.image : null;
  return {
    slug: String(item.slug || ''),
    title: String(item.title || item.slug || 'Sans titre'),
    kind: typeof item.kind === 'string' ? item.kind : null,
    kindLabel: String(item.kindLabel || ''),
    image,
    pageUrl: typeof item.pageUrl === 'string' && item.pageUrl.startsWith('https://atlas.co/maps/') ? item.pageUrl : `${ATLASCO_SITE_URL}maps/${item.slug}/`,
    collections: Array.isArray(item.collections) ? item.collections.map(String) : []
  };
}

export function kindFr(kindId, fallback = '') {
  return ATLASCO_KINDS.find(k => k.id === kindId)?.fr || fallback || kindId || '—';
}

/* Citation copiable pour un modèle Atlas. */
export function buildCitation(item, accessedOn = new Date()) {
  const t = normalizeTemplate(item);
  const date = accessedOn.toISOString().slice(0, 10);
  return [
    `${t.title}`,
    `Atlas — bibliothèque communautaire (${ATLASCO_COMMUNITY_URL})`,
    `modèle : ${t.pageUrl}`,
    t.kind ? `catégorie : ${kindFr(t.kind, t.kindLabel)}` : null,
    `consulté le ${date}`
  ].filter(Boolean).join(', ');
}

/* Favoris en localStorage (même pattern que le panneau Layer Atlas). */
export function readFavorites(storage = globalThis.localStorage) {
  try {
    const raw = JSON.parse(storage.getItem(ATLASCO_FAVORITES_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter(x => x && typeof x.slug === 'string').slice(0, ATLASCO_MAX_FAVORITES)
      .map(x => ({ slug: x.slug, title: String(x.title || ''), kind: String(x.kind || ''), addedAt: String(x.addedAt || '') }));
  } catch { return []; }
}

export function toggleFavorite(item, storage = globalThis.localStorage, now = () => new Date().toISOString()) {
  const t = normalizeTemplate(item);
  if (!t.slug) throw Object.assign(new Error('Modèle sans slug.'), { code: 'FAVORITE_INVALID' });
  const favs = readFavorites(storage);
  const index = favs.findIndex(f => f.slug === t.slug);
  let added;
  if (index >= 0) { favs.splice(index, 1); added = false; }
  else { favs.unshift({ slug: t.slug, title: t.title, kind: t.kind || '', addedAt: now() }); added = true; }
  storage.setItem(ATLASCO_FAVORITES_KEY, JSON.stringify(favs.slice(0, ATLASCO_MAX_FAVORITES)));
  return { added, favorites: readFavorites(storage) };
}
