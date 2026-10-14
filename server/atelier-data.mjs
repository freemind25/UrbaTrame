/* Données et requêtes du module Atelier topographique (Altiplan) de Freemap.
   Les sélecteurs Overpass sont fixés côté serveur : le client ne peut pas
   transmettre une requête libre. Les limites de parcelles restent strictement
   celles présentes dans OSM ; aucune donnée cadastrale n'est fabriquée. */
export const MIN_RADIUS = 200;
export const MAX_RADIUS = 3989; // rayon correspondant à environ 50 km²

export const DATASETS = {
  buildings: ['way["building"]', 'relation["building"]', 'way["building:part"]', 'relation["building:part"]'],
  roads: ['way["highway"~"motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|pedestrian|footway|cycleway|path|steps"]'],
  landuse: ['way["landuse"]', 'way["leisure"]', 'way["amenity"~"school|university|hospital|clinic|park"]', 'relation["landuse"]', 'relation["leisure"]'],
  water: ['way["waterway"]', 'way["natural"="water"]', 'relation["natural"="water"]'],
  rail: ['way["railway"~"rail|subway|light_rail|tram|monorail|narrow_gauge"]'],
  trees: ['node["natural"="tree"]', 'way["natural"="tree_row"]'],
  parcels: ['way["boundary"="parcel"]', 'relation["boundary"="parcel"]'],
  pois: ['node["amenity"]', 'node["shop"]', 'node["tourism"]', 'node["leisure"]', 'node["public_transport"]']
};
export const DATASET_IDS = Object.keys(DATASETS);

/* Les coordonnées commerciales de contact OSM ne servent pas au relevé. Ne les
   transmettons pas à l'interface ni dans l'exemple embarqué. */
const contactKey = key => {
  const k = String(key).toLowerCase();
  return k === 'email' || k === 'phone' || k === 'fax' || k === 'website' || k === 'opening_hours' ||
    k.startsWith('contact:') || [':email', ':phone', ':fax', ':website'].some(s => k.endsWith(s));
};

export function withoutContactTags(elements = []) {
  const clean = item => {
    if (!item || typeof item !== 'object') return item;
    let out = item;
    if (item.tags && typeof item.tags === 'object') {
      const tags = Object.fromEntries(Object.entries(item.tags).filter(([key]) => !contactKey(key)));
      if (Object.keys(tags).length !== Object.keys(item.tags).length) out = { ...out, tags };
    }
    if (Array.isArray(item.members)) {
      const members = item.members.map(clean);
      if (members.some((member, i) => member !== item.members[i])) out = { ...out, members };
    }
    return out;
  };
  return Array.isArray(elements) ? elements.map(clean) : [];
}

export function validateSite(lat, lon, radius) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180)
    throw new Error('INVALID_LOCATION');
  if (!Number.isFinite(radius) || radius < MIN_RADIUS || radius > MAX_RADIUS)
    throw new Error('RADIUS_OUT_OF_RANGE');
  const dy = radius / 111320;
  const dx = dy / Math.cos(lat * Math.PI / 180);
  if (lon - dx < -180 || lon + dx > 180 || lat - dy < -85 || lat + dy > 85)
    throw new Error('SITE_CROSSES_MAP_LIMIT');
  return { dy, dx, bbox: [lat - dy, lon - dx, lat + dy, lon + dx].map(n => n.toFixed(7)).join(',') };
}

export function queryFor({ lat, lon, radius, include = DATASET_IDS }) {
  const box = validateSite(Number(lat), Number(lon), Number(radius)).bbox;
  const selected = [...new Set((Array.isArray(include) ? include : []).filter(id => DATASET_IDS.includes(id)))];
  if (!selected.length) throw new Error('NO_DATASETS_SELECTED');
  const selectors = [...new Set(selected.flatMap(id => DATASETS[id]))];
  const timeout = Number(radius) > 2500 ? 45 : 30;
  return `[out:json][timeout:${timeout}][maxsize:268435456];(${selectors.map(s => `${s}(${box});`).join('')});out geom;`;
}
