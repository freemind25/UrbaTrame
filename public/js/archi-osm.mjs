/* Relevé automatique d'une rue depuis OSM (Overpass direct, côté navigateur).
   Entrée : éléments Overpass `out geom` (ways highway + building autour du point).
   Sortie : un relevé `rue.json` normalisé (archi-rue.mjs), avec hypothèses signalées.
   Aucune donnée ne sort du navigateur : Overpass est public et anonymisant. */
import { normalizeSurvey } from './archi-rue.mjs';
import { heightOf } from './osm.mjs';

const D2R = Math.PI / 180;

/* Largeur de chaussée par défaut selon la classe OSM (m). */
const ROAD_WIDTH = {
  motorway: 14, trunk: 12, primary: 10, secondary: 9, tertiary: 7,
  unclassified: 6, residential: 6, living_street: 5, service: 4,
  pedestrian: 5, footway: 2.5, cycleway: 2, path: 2, steps: 1.5
};
const ROAD_RANK = Object.keys(ROAD_WIDTH);
const PED = ['pedestrian', 'footway', 'path', 'steps', 'cycleway'];

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };

function centroid(geom) {
  let la = 0, lo = 0;
  for (const p of geom) { la += p.lat; lo += p.lon; }
  return { lat: la / geom.length, lon: lo / geom.length };
}

/* distance point→segment en mètres (projection équirectangulaire locale) */
function distSegM(p, a, b) {
  const mx = Math.cos(((a.lat + b.lat) / 2) * D2R) * 111320;
  const my = 111320;
  const ax = a.lon * mx, ay = a.lat * my, bx = b.lon * mx, by = b.lat * my;
  const px = p.lon * mx, py = p.lat * my;
  const dx = bx - ax, dy = by - ay;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1e-9), 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function distToWay(p, geom) {
  let d = Infinity;
  for (let i = 0; i < geom.length - 1; i++) d = Math.min(d, distSegM(p, geom[i], geom[i + 1]));
  return d;
}

function wayLengthM(geom) {
  let L = 0;
  for (let i = 0; i < geom.length - 1; i++) L += distSegM(geom[i], geom[i], geom[i + 1]);
  return L;
}

/* azimut (degrés, 0 = nord) du premier au dernier point */
function azimuthDeg(a, b) {
  const mx = Math.cos(((a.lat + b.lat) / 2) * D2R) * 111320, my = 111320;
  const dx = (b.lon - a.lon) * mx, dy = (b.lat - a.lat) * my;
  return ((Math.atan2(dx, dy) / D2R) + 360) % 360;
}

function roadWidth(tags) {
  const w = parseFloat(String(tags.width || '').replace(/[^\d.,]/g, '').replace(',', '.'));
  if (Number.isFinite(w) && w > 0 && w < 60) return w;
  return ROAD_WIDTH[String(tags.highway || '').split(':')[0]] || 6;
}

/* Relevé calculable hors ligne (testé) : éléments Overpass → relevé normalisé. */
export function surveyFromOSM(elements, { lat, lon, nom = '', lieu = '' } = {}) {
  const ways = (elements || []).filter(e => e && e.type === 'way' && Array.isArray(e.geometry) && e.geometry.length > 1);
  const roads = ways.filter(w => w.tags && w.tags.highway);
  if (!roads.length || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const center = { lat, lon };
  const ranked = roads.map(w => {
    const cls = String(w.tags.highway).split(':')[0];
    const rank = ROAD_RANK.indexOf(cls);
    return { w, cls, d: distToWay(center, w.geometry), rank: rank < 0 ? 99 : rank };
  }).sort((a, b) => a.rank - b.rank || a.d - b.d);
  const main = ranked[0];
  const g = main.w.geometry;
  const axe = azimuthDeg(g[0], g[g.length - 1]);
  const width = clamp(roadWidth(main.w.tags || {}), 2, 80);
  const longueur = clamp(wayLengthM(g), 5, 400);
  const isPed = PED.includes(main.cls);

  /* bandes de sol : trottoirs + passage (chaussée), ou passage seul si piéton */
  const trott = isPed ? 0 : (width >= 7 ? 2 : 1.2);
  const bandes = isPed
    ? [{ type: 'passage', largeur: width, cote: '' }]
    : [
        { type: 'trottoir', largeur: trott, cote: 'ouest' },
        { type: 'passage', largeur: Math.max(1, width - 2 * trott), cote: '' },
        { type: 'trottoir', largeur: trott, cote: 'est' }
      ];

  /* immeubles de part et d'autre de l'axe de la rue principale */
  const dir = { lat: g[g.length - 1].lat - g[0].lat, lon: g[g.length - 1].lon - g[0].lon };
  const bySide = { ouest: [], est: [] };
  for (const b of ways) {
    if (!b.tags || !(b.tags.building || b.tags['building:part'])) continue;
    const c = centroid(b.geometry);
    const d = distToWay(c, g);
    if (d > Math.max(35, width + 10)) continue; /* hors du front de rue */
    const cross = dir.lon * (c.lat - g[0].lat) - dir.lat * (c.lon - g[0].lon);
    const side = cross > 0 ? 'est' : 'ouest';
    const tags = b.tags;
    const hTag = parseFloat(String(tags.height || '').replace(/[^\d.,]/g, '').replace(',', '.'));
    const hasH = Number.isFinite(hTag) && hTag > 0;
    const h = hasH ? hTag : heightOf(tags); /* sinon niveaux × 3,1 m */
    const lv = parseFloat(tags['building:levels']);
    const n = Number.isFinite(lv) && lv > 0 ? Math.round(lv) : (h > 0 ? Math.max(1, Math.round(h / 3.1)) : 4);
    const egout = h > 0 ? h : n * 3.1;
    bySide[side].push({
      d,
      nom: String(tags.name || ''),
      largeur: 8, /* hypothèse : travée moyenne */
      hauteur_egout: egout,
      hauteur_faitage: egout + 3.2,
      niveaux: 'R+' + n,
      rdc: tags.shop || tags.amenity || tags.office ? 'commerce' : 'habitation',
      suppose: !hasH /* hauteur déduite des niveaux, pas mesurée */
    });
  }
  const facades = {};
  for (const side of ['ouest', 'est']) {
    const list = bySide[side].sort((a, b) => a.d - b.d).slice(0, 12)
      .map(({ d, ...b }) => b);
    facades[side] = { rdc: 'mixte', niveaux: 'R+4', immeubles: list };
  }

  return normalizeSurvey({
    nom: nom || 'Rue relevée depuis OSM',
    lieu: lieu || `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
    latitude: lat,
    longitude: lon,
    axe_deg: Math.round(axe),
    axe_hypothese: true,
    largeur_facades: width,
    longueur_relevee: longueur,
    sol: isPed ? 'pavés' : 'asphalte',
    bandes,
    facades,
    mobilier: {},
    gens: { vus: 0, en_plan: 0 },
    note: 'Relevé automatique depuis OpenStreetMap (rue principale la plus proche, hauteurs OSM ou niveaux × 3,1 m supposés). À vérifier sur place.'
  });
}

/* Requête Overpass + relevé. `routes` = instance Routes (rotation des miroirs publics). */
/* Relais serveur (même origine) : la requête Overpass est composée côté
   serveur (/api/atelier/archi) — fiable depuis un navigateur dont le réseau
   bloque les miroirs publics. Si le relais est absent (404/405, ex. page
   servie sans serveur), on retombe sur overpassDirect (miroirs publics). */
export async function fetchOverpassRelay(kind, lat, lon, radius) {
  let r;
  try {
    r = await fetch('/api/atelier/archi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, lat, lon, radius })
    });
  } catch (e) {
    const err = new Error('RELAIS_INDISPONIBLE'); err.code = 'RELAIS_INDISPONIBLE'; throw err;
  }
  if (r.status === 401 || r.status === 403 || r.status === 404 || r.status === 405) {
    /* relais inaccessible pour ce navigateur (auth requise, page statique…) :
       on signale RELAIS_ABSENT pour que l'appelant retombe sur les miroirs publics */
    const err = new Error('RELAIS_ABSENT'); err.code = 'RELAIS_ABSENT'; err.status = r.status; throw err;
  }
  const d = await r.json().catch(() => null);
  if (!r.ok || !d || !d.ok) {
    const err = new Error((d && d.error) || ('HTTP ' + r.status));
    err.code = (d && d.error) || 'RELAIS_ERREUR';
    err.status = r.status;
    if (d && d.retryAfter) err.retryAfter = d.retryAfter;
    throw err;
  }
  return d.elements || [];
}

export async function fetchSurveyOSM(routes, lat, lon, radius = 150) {
  let elements = null;
  try {
    elements = await fetchOverpassRelay('rue', lat, lon, radius);
  } catch (e) {
    /* relais absent ou en erreur : on tente les miroirs publics directement ;
       si eux aussi échouent, on propage l'erreur du relais (plus pertinente) */
    try {
      const q = `[out:json][timeout:25];(way["highway"](around:${radius},${lat},${lon});` +
        `way["building"](around:${radius},${lat},${lon});way["building:part"](around:${radius},${lat},${lon}););out geom 600;`;
      const data = await routes.overpassDirect(q, 30_000);
      elements = (data && data.elements) || [];
    } catch (e2) {
      throw e;
    }
  }
  const survey = surveyFromOSM(elements, { lat, lon });
  if (!survey) { const e = new Error('RUE_INTROUVABLE'); e.code = 'RUE_INTROUVABLE'; throw e; }
  return survey;
}
