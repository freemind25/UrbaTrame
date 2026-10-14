/* Conversion des éléments Overpass vers les couches consommées par la section Atelier de Freemap.
   Les coordonnées restent en degrés [latitude, longitude] jusqu'à l'export.
   Les données brutes et leurs tags sont conservés pour permettre GeoJSON. */
import { batimentsDepuisOverpass, heightOf, dedupe } from './osm.mjs';
import { classifyBuilding, roadWidth } from './geometry.mjs';

const geo = e => Array.isArray(e?.geometry)
  ? e.geometry.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon)).map(p => [p.lat, p.lon]) : [];
const fermé = g => g.length > 3 && Math.abs(g[0][0] - g.at(-1)[0]) < 1e-10 && Math.abs(g[0][1] - g.at(-1)[1]) < 1e-10;
const nommer = e => e.tags?.name || e.tags?.['name:fr'] || e.tags?.['name:en'] || '';
const hauteur = tags => heightOf(tags || {}) || Number.parseFloat(tags?.['tree:height']) || Number.parseFloat(tags?.height) || 0;

export function normaliser(elements = []) {
  const unique = dedupe(Array.isArray(elements) ? elements : []);
  const base = { roads: [], build: [], green: [], pois: [] };
  const arbres = [], rangéesArbres = [], parcelles = [], usage = [], rail = [], eauLinéaire = [];

  for (const e of unique) {
    const t = e.tags || {};
    if (e.type === 'node') {
      if (t.natural === 'tree') {
        arbres.push({ id: e.id, lat: e.lat, lon: e.lon, h: hauteur(t), nom: nommer(e), espèce: t.species || '' });
      } else if (t.amenity || t.shop || t.leisure || t.tourism || t.public_transport || t.railway) {
        base.pois.push({ id: e.id, lat: e.lat, lon: e.lon, nom: nommer(e), amenity: t.amenity || '', shop: t.shop || '', leisure: t.leisure || '' });
      }
      continue;
    }

    const g = geo(e);
    if (e.type === 'relation' && e.members?.length) {
      for (const member of e.members) {
        const mg = geo(member);
        if (mg.length < 2 || member.role === 'inner') continue;
        ajouteAireOuLigne(e, t, mg, base, { arbres, rangéesArbres, parcelles, usage, rail, eauLinéaire });
      }
      continue;
    }
    if (g.length < 2) continue;
    ajouteAireOuLigne(e, t, g, base, { arbres, rangéesArbres, parcelles, usage, rail, eauLinéaire });
  }

  /* La normalisation dédiée gère les hauteurs, formes multipolygones et trous
     des relations bâties. On conserve également les géométries simples utiles
     à la coupe et au plan 2D. */
  base.build = batimentsDepuisOverpass(unique);
  const verts = base.green.filter(x => x.k === 'g');
  const eaux = base.green.filter(x => x.k === 'w' && fermé(x.g || []));
  base.green = [...verts, ...eaux];
  return {
    ...base,
    trees: arbres,
    treeRows: rangéesArbres,
    parcels: parcelles,
    landuse: usage,
    rail,
    waterways: eauLinéaire,
    raw: unique
  };
}

function ajouteAireOuLigne(e, t, g, base, extra) {
  const fermé = g.length > 3 && Math.abs(g[0][0] - g.at(-1)[0]) < 1e-10 && Math.abs(g[0][1] - g.at(-1)[1]) < 1e-10;
  const item = { id: e.id, nom: t.name || t['name:fr'] || '', tags: t, g };
  if (t.building || t['building:part']) {
    const h = heightOf(t);
    base.build.push({ ...item, h, t: t.building || t['building:part'], u: t.amenity || t.shop || '',
      class: classifyBuilding(t), buildingPart: !!t['building:part'] && !t.building,
      roofShape: t['roof:shape'] || '', roofDirection: Number(t['roof:direction']) || null,
      roofOrientation: t['roof:orientation'] || '', roofLevels: Number(t['roof:levels']) || 0,
      roofMaterial: t['roof:material'] || '' });
    return;
  }
  if (t.highway) {
    const w = roadWidth(t);
    base.roads.push({ ...item, h: t.highway, n: item.nom, width: w.metres,
      widthSource: w.source, bridge: !!t.bridge && t.bridge !== 'no',
      layer: Number(t.layer) || 0, junction: t.junction || '', surface: t.surface || '' });
    return;
  }
  if (t.natural === 'tree_row') { extra.rangéesArbres.push(item); return; }
  if (t.boundary === 'parcel' || t.cadastral === 'parcel') {
    if (g.length >= 3) extra.parcelles.push(item);
    return;
  }
  if (t.railway && !['station', 'halt', 'tram_stop', 'subway_entrance'].includes(t.railway)) {
    extra.rail.push(item); return;
  }
  if (t.waterway) {
    extra.eauLinéaire.push(item); return;
  }
  if (t.natural === 'water' || t.water || t.landuse === 'basin' || t.landuse === 'reservoir') {
    if (g.length >= 3) base.green.push({ ...item, k: 'w' });
    return;
  }
  if (t.natural || t.leisure || ['forest', 'grass', 'meadow', 'recreation_ground', 'cemetery'].includes(t.landuse)) {
    if (g.length >= 3 && fermé) base.green.push({ ...item, k: 'g' });
  }
  if ((t.landuse || t.leisure || t.amenity || t.natural) && g.length >= 3 && fermé && !t.building)
    extra.usage.push(item);
}

/* Une rangée d’arbres OSM est une ligne, pas une multitude de points. Pour la
   maquette 3D seulement, en déduire des marqueurs régulièrement espacés ; on
   ne transforme jamais ces marqueurs en objets OSM exportés au plan 2D. */
export function arbresDepuisRangées(rows = [], { espacement = 7, limite = 4000 } = {}) {
  const interval = Number.isFinite(espacement) && espacement > 0 ? espacement : 7;
  const max = Number.isFinite(limite) && limite > 0 ? Math.floor(limite) : 4000;
  const points = [];
  for (const row of rows || []) {
    if (points.length >= max || !Array.isArray(row.g) || row.g.length < 2) break;
    const g = row.g.filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (g.length < 2) continue;
    const cos = Math.cos(g.reduce((s, p) => s + p[0], 0) / g.length * Math.PI / 180);
    const lengths = [];
    let total = 0;
    for (let i = 1; i < g.length; i++) {
      const dy = (g[i][0] - g[i - 1][0]) * 111320;
      const dx = (g[i][1] - g[i - 1][1]) * 111320 * cos;
      const length = Math.hypot(dx, dy);
      lengths.push(length); total += length;
    }
    if (total < 0.1) continue;
    const count = total < interval ? 1 : Math.ceil(total / interval) + 1;
    for (let k = 0; k < count && points.length < max; k++) {
      const target = count === 1 ? total / 2 : total * k / (count - 1);
      let walked = 0, index = 0;
      while (index < lengths.length - 1 && walked + lengths[index] < target) walked += lengths[index++];
      const segment = lengths[index];
      const t = segment > 0 ? Math.max(0, Math.min(1, (target - walked) / segment)) : 0;
      const a = g[index], b = g[index + 1];
      const h = hauteur(row.tags || {}) || 6;
      points.push({
        id: `row-${row.id ?? points.length}-${k}`,
        lat: a[0] + (b[0] - a[0]) * t,
        lon: a[1] + (b[1] - a[1]) * t,
        h, nom: row.nom || '', row: row.id
      });
    }
  }
  return points;
}

export function dansEmprise(lat, lon, rayon, points) {
  const cos = Math.cos(lat * Math.PI / 180);
  return points.some(([la, lo]) => Math.hypot((lo - lon) * 111320 * cos, (la - lat) * 111320) <= rayon + 1);
}
