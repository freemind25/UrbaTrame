/* Prévision locale des données nécessaires à une génération UrbaTrame.
   Elle réutilise le plan Overpass partagé et n'interroge aucun fournisseur.
   Les volumes d'objets OSM restent inconnus tant que la requête réelle n'a
   pas été exécutée; seules l'emprise, les dépendances et la charge indicative
   sont calculées ici. */
import { LAYER_NAMES, plan } from './plan-2d.mjs';
import { getObmTilePlan } from './openbuildingmap.mjs';

export const TERRAIN_GRID_SIZE = 24;
export const CLIMATE_DAYS = 3 * 365;
export const CLIMATE_SERIES = 5;
export const WINDROSE_YEARS = 10;
export const WINDROSE_SECTORS = 16;

export function terrainZoomForRadius(radius) {
  return radius <= 700 ? 14 : radius <= 1600 ? 13 : 12;
}

export function estimateObmTiles(lat, lon, radius) {
  const plan = getObmTilePlan(lat, lon, radius);
  return { zoom: plan.z, tiles: plan.tiles.length, maxTiles: plan.maxTiles };
}

const lonToX = (lon, z) => (lon + 180) / 360 * 2 ** z;
const latToY = (lat, z) =>
  (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** z;

/* Nombre de tuiles distinctes touchées par la grille 24×24 utilisée par le
   service. C'est une estimation géométrique locale, sans requête réseau. */
export function estimateTerrainTiles(lat, lon, radius, n = TERRAIN_GRID_SIZE) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(radius) || radius <= 0 || n < 2)
    return { zoom: null, tiles: 0, samples: 0 };
  const zoom = terrainZoomForRadius(radius);
  const dy = radius / 111320;
  const dx = dy / Math.cos(lat * Math.PI / 180);
  const keys = new Set();
  for (let j = 0; j < n; j++) {
    const la = (lat + dy) - (j / (n - 1)) * 2 * dy;
    const ty = Math.floor(latToY(la, zoom));
    for (let i = 0; i < n; i++) {
      const lo = (lon - dx) + (i / (n - 1)) * 2 * dx;
      const tx = Math.floor(lonToX(lo, zoom));
      keys.add(`${tx}/${ty}`);
    }
  }
  return { zoom, tiles: keys.size, samples: n * n };
}

function loadBand({ osmGroups, osmAreaKm2, terrainTiles, ancillaryActions }) {
  const osmFootprint = osmAreaKm2 * osmGroups;
  if (osmGroups >= 3 || osmFootprint >= 16 || terrainTiles >= 8) return 'high';
  if (osmGroups >= 2 || osmFootprint >= 4 || terrainTiles >= 4 || ancillaryActions >= 3) return 'medium';
  return 'low';
}

/**
 * Construit une prévision sans réseau à partir des identifiants sélectionnés.
 * `groups[].query` sert seulement à rechercher une copie exacte dans IndexedDB.
 */
export function estimateDataPreview({ analysisIds, radius, lat, lon, shape = 'circle' } = {}) {
  const requestPlan = plan(analysisIds, radius, lat, lon);
  const osmAreaKm2 = (2 * radius / 1000) ** 2; // bbox carrée réellement interrogée
  const studyAreaKm2 = shape === 'circle' ? Math.PI * radius ** 2 / 1e6 : osmAreaKm2;
  const terrain = requestPlan.terrain ? estimateTerrainTiles(lat, lon, radius) : null;
  const climate = requestPlan.climate ? {
    days: CLIMATE_DAYS,
    series: CLIMATE_SERIES,
    values: CLIMATE_DAYS * CLIMATE_SERIES
  } : null;
  const windrose = requestPlan.windrose ? {
    years: WINDROSE_YEARS,
    sectors: WINDROSE_SECTORS
  } : null;
  const obm = requestPlan.selected.includes('obmoccupancy')
    ? estimateObmTiles(lat, lon, radius)
    : null;
  const osmGroups = requestPlan.groups.map(group => ({
    id: group.id,
    keys: group.keys.slice(),
    query: group.query
  }));
  const keys = [...new Set(osmGroups.flatMap(group => group.keys))];
  const ancillaryActions = Number(!!climate) + Number(!!windrose) + Number(!!terrain) + Number(!!obm);

  return {
    selected: requestPlan.selected,
    skipped: requestPlan.skipped,
    groups: osmGroups,
    layerKeys: keys,
    osmAreaKm2,
    studyAreaKm2,
    shape,
    radius,
    climate,
    windrose,
    terrain,
    obm,
    ancillaryActions,
    load: loadBand({ osmGroups: osmGroups.length, osmAreaKm2, terrainTiles: terrain?.tiles || 0, ancillaryActions })
  };
}

export function layerLabel(key, lang = 'fr') {
  const pair = LAYER_NAMES[key];
  return pair ? pair[lang === 'en' ? 1 : 0] : key;
}
