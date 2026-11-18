/* Layer Atlas (layeratlas.com) — logique cliente PURE du panneau catalogue.
   Toute la partie réseau passe par NOTRE proxy /api/layeratlas/search
   (lecture seule) ; ce fichier ne fait que valider, normaliser et formater. */
import { LAYERATLAS_CATEGORIES, LAYERATLAS_CATEGORY_BY_ID, layerAtlasAssetTypeLabel, isLayerAtlasCategory } from './layeratlas-categories.mjs';

export { LAYERATLAS_CATEGORIES, layerAtlasAssetTypeLabel, isLayerAtlasCategory };

export const LAYERATLAS_SEARCH_URL = '/api/layeratlas/search';
export const LAYERATLAS_SITE_URL = 'https://layeratlas.com/';
export const LAYERATLAS_FAVORITES_KEY = 'urbatrame:layeratlas:favorites:v1';
export const LAYERATLAS_MAX_FAVORITES = 100;
export const LAYERATLAS_MAX_Q = 120;
export const LAYERATLAS_PAGE_SIZE = 12;

/* Suggestions de recherche utiles pour un travail urbain en Algérie. */
export const LAYERATLAS_SUGGESTIONS = [
  'Algeria', 'Algérie', 'Constantine', 'Alger', 'OSM', 'OpenStreetMap',
  'administrative', 'boundaries', 'WMS', 'WMTS', 'orthophoto', 'DEM', 'elevation'
];

export function buildSearchParams({ q = '', category = '', organization = '', keyword = '', limit = LAYERATLAS_PAGE_SIZE, offset = 0 } = {}) {
  const query = String(q ?? '').trim();
  if (query.length > LAYERATLAS_MAX_Q) throw Object.assign(new Error('La recherche dépasse 120 caractères.'), { code: 'QUERY_TOO_LONG' });
  const cat = String(category ?? '').trim();
  if (cat && !isLayerAtlasCategory(cat)) throw Object.assign(new Error('Catégorie inconnue.'), { code: 'CATEGORY_INVALID' });
  const params = new URLSearchParams();
  params.set('q', query || '*');
  if (cat) params.set('category', cat);
  const org = String(organization ?? '').trim();
  if (org) params.set('organization', org);
  const kw = String(keyword ?? '').trim();
  if (kw) params.set('keyword', kw);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25) throw Object.assign(new Error('Limite invalide.'), { code: 'LIMIT_INVALID' });
  if (!Number.isSafeInteger(offset) || offset < 0) throw Object.assign(new Error('Offset invalide.'), { code: 'OFFSET_INVALID' });
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  return params;
}

/* Normalise une "hit" venant de notre proxy (déjà en liste blanche côté serveur). */
export function normalizeHit(doc = {}) {
  const category = typeof doc.category === 'string' ? doc.category : null;
  return {
    id: String(doc.id || ''),
    name: String(doc.name || 'Sans nom'),
    assetType: typeof doc.assetType === 'string' ? doc.assetType : '',
    assetTypeLabel: layerAtlasAssetTypeLabel(doc.assetType),
    category,
    categoryLabel: (category && LAYERATLAS_CATEGORY_BY_ID.get(category)?.label) || category || '—',
    organization: String(doc.organization || ''),
    keywords: Array.isArray(doc.keywords) ? doc.keywords.map(String) : [],
    description: String(doc.description || ''),
    attributionTitle: String(doc.attributionTitle || ''),
    attributionURL: typeof doc.attributionURL === 'string' && /^https:\/\//.test(doc.attributionURL) ? doc.attributionURL : null,
    thumbnailUrl: typeof doc.thumbnailUrl === 'string' && /^https:\/\/upcdn\.io\//.test(doc.thumbnailUrl) ? doc.thumbnailUrl : null,
    popularity: Number(doc.popularity) || 0,
    createdAt: typeof doc.createdAt === 'string' ? doc.createdAt : null
  };
}

/* Vignette : endpoint image de Bytescale avec redimensionnement (même compte
   public que layeratlas.com utilise pour ses miniatures). */
export function layerAtlasThumbnailUrl(doc, width = 300, height = 200) {
  const hit = normalizeHit(doc);
  if (!hit.thumbnailUrl) return null;
  const path = hit.thumbnailUrl.replace(/^https:\/\/upcdn\.io\/[A-Za-z0-9]+\/raw/, '');
  return `https://upcdn.io/${hit.thumbnailUrl.split('/')[3]}/image${path}?w=${width}&h=${height}&fit=crop`;
}

/* Citation copiable (attribution obligatoire quand on réutilise une couche). */
export function buildCitation(doc, accessedOn = new Date()) {
  const hit = normalizeHit(doc);
  const date = accessedOn.toISOString().slice(0, 10);
  const parts = [
    `${hit.name}`,
    hit.organization && `— ${hit.organization}`,
    `Layer Atlas (${LAYERATLAS_SITE_URL})`,
    hit.attributionTitle && `Attribution : ${hit.attributionTitle}${hit.attributionURL ? ` (${hit.attributionURL})` : ''}`,
    `consulté le ${date}`
  ];
  return parts.filter(Boolean).join(', ');
}

/* Favoris stockés localement (localStorage), comme les gabarits de relevé. */
export function readFavorites(storage = globalThis.localStorage) {
  try {
    const raw = JSON.parse(storage.getItem(LAYERATLAS_FAVORITES_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter(x => x && typeof x.id === 'string').slice(0, LAYERATLAS_MAX_FAVORITES)
      .map(x => ({ id: x.id, name: String(x.name || ''), organization: String(x.organization || ''), addedAt: String(x.addedAt || '') }));
  } catch { return []; }
}

export function toggleFavorite(doc, storage = globalThis.localStorage, now = () => new Date().toISOString()) {
  const hit = normalizeHit(doc);
  if (!hit.id) throw Object.assign(new Error('Asset sans identifiant.'), { code: 'FAVORITE_INVALID' });
  const favs = readFavorites(storage);
  const index = favs.findIndex(f => f.id === hit.id);
  let added;
  if (index >= 0) { favs.splice(index, 1); added = false; }
  else {
    favs.unshift({ id: hit.id, name: hit.name, organization: hit.organization, addedAt: now() });
    added = true;
  }
  storage.setItem(LAYERATLAS_FAVORITES_KEY, JSON.stringify(favs.slice(0, LAYERATLAS_MAX_FAVORITES)));
  return { added, favorites: readFavorites(storage) };
}
