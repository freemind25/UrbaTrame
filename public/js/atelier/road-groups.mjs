/* Groupes explicites de la classification OpenStreetMap pour l'affichage 2D. */
export const ROAD_GROUPS = Object.freeze([
  { id: 'major', fr: 'Autoroutes et voies rapides', en: 'Motorways and trunk roads', values: ['motorway', 'motorway_link', 'trunk', 'trunk_link'] },
  { id: 'primary', fr: 'Voies primaires', en: 'Primary roads', values: ['primary', 'primary_link'] },
  { id: 'secondary', fr: 'Voies secondaires', en: 'Secondary roads', values: ['secondary', 'secondary_link'] },
  { id: 'tertiary', fr: 'Tertiaires et non classées', en: 'Tertiary and unclassified', values: ['tertiary', 'tertiary_link', 'unclassified'] },
  { id: 'residential', fr: 'Rues résidentielles', en: 'Residential streets', values: ['residential', 'living_street'] },
  { id: 'service', fr: 'Service et accès', en: 'Service and access', values: ['service'] },
  { id: 'paths', fr: 'Chemins et pistes cyclables', en: 'Paths and cycleways', values: ['pedestrian', 'footway', 'path', 'cycleway', 'steps', 'track', 'bridleway', 'corridor'] },
  { id: 'other', fr: 'Autres ou inconnues', en: 'Other or unknown', values: [] }
]);
const LOOKUP = new Map(ROAD_GROUPS.flatMap(group => group.values.map(value => [value, group.id])));
export function roadGroup(highway) {
  return LOOKUP.get(String(highway || '').trim().toLowerCase()) || 'other';
}
export function filterRoads(roads, selected) {
  const list = Array.isArray(roads) ? roads : [];
  if (selected == null) return list;
  const active = new Set(Array.isArray(selected) ? selected : []);
  return list.filter(r => active.has(roadGroup(r?.h ?? r?.tags?.highway)));
}
