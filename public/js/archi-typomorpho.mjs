/* UrbaTrame · Analyse typo-morphologique (école italienne / française, cours M. Sadi,
   Université Constantine 3) — calculée en code depuis les objets OSM autour du point.

   Niveaux lus (cours p.17-18) : la voie (trame viaire : hiérarchie, carrefours),
   le bâti (typologie des édifices : accolés/isolés, retrait, famille de hauteur, RDC),
   l'îlot (densité bâtie, emprise moyenne), la lecture topologique de la rue
   (fluide / canalisé / statique, cours p.13) et la croissance (ligne, barrières,
   densification par substitution ou élévation, cours p.30-36).

   Pur et testable : typomorphoFromOSM(elements, opts) ne touche pas au réseau. */

import { surveyFromOSM } from './archi-osm.mjs';
import { heightOf } from './osm.mjs';

const D2R = Math.PI / 180;

/* --- géométrie équirectangulaire (mètres) ---------------------------- */

export function toXY(p, ref) {
  const mx = Math.cos((ref.lat) * D2R) * 111320;
  return { x: (p.lon - ref.lon) * mx, y: (p.lat - ref.lat) * 111320 };
}

export function distM(a, b, ref) {
  const A = toXY(a, ref), B = toXY(b, ref);
  return Math.hypot(A.x - B.x, A.y - B.y);
}

export function areaPolygonM2(geom, ref) {
  if (!geom || geom.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < geom.length; i++) {
    const A = toXY(geom[i], ref), B = toXY(geom[(i + 1) % geom.length], ref);
    s += A.x * B.y - B.x * A.y;
  }
  return Math.abs(s) / 2;
}

function distSegM(p, a, b, ref) {
  const P = toXY(p, ref), A = toXY(a, ref), B = toXY(b, ref);
  const dx = B.x - A.x, dy = B.y - A.y;
  const t = Math.max(0, Math.min(1, ((P.x - A.x) * dx + (P.y - A.y) * dy) / (dx * dx + dy * dy || 1e-9)));
  return Math.hypot(P.x - (A.x + t * dx), P.y - (A.y + t * dy));
}

export function distToGeomM(p, geom, ref) {
  let d = Infinity;
  for (let i = 0; i < geom.length - 1; i++) d = Math.min(d, distSegM(p, geom[i], geom[i + 1], ref));
  return d;
}

/* projection scalaire d'un point sur l'axe (origine = point du site, direction = azimut) */
export function projectOnAxisM(p, ref, azimutDeg) {
  const P = toXY(p, ref);
  const a = azimutDeg * D2R;
  return P.x * Math.sin(a) + P.y * Math.cos(a); /* metres le long de l'axe */
}

/* union d'intervalles [a,b] → longueur totale couverte et trous > minGap */
export function unionIntervals(intervals, minGap = 0) {
  const iv = intervals.filter(v => Number.isFinite(v[0]) && Number.isFinite(v[1]) && v[1] > v[0])
    .map(v => [Math.min(v[0], v[1]), Math.max(v[0], v[1])]).sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const v of iv) {
    const last = merged[merged.length - 1];
    if (last && v[0] <= last[1]) last[1] = Math.max(last[1], v[1]);
    else merged.push([v[0], v[1]]);
  }
  const covered = merged.reduce((t, v) => t + (v[1] - v[0]), 0);
  const trous = [];
  for (let i = 0; i < merged.length - 1; i++) {
    const gap = merged[i + 1][0] - merged[i][1];
    if (gap > minGap) trous.push({ debut: merged[i][1], fin: merged[i + 1][0], largeur: gap });
  }
  return { merged, covered, trous };
}

/* --- constantes typologiques (cours p.23-28) ------------------------- */

export const FAMILLES_HAUTEUR = [
  { id: 'maison', label: 'maison basse (R et R+1)', maxH: 7 },
  { id: 'collectif', label: 'immeuble collectif moyen (R+2 à R+4)', maxH: 15 },
  { id: 'haut', label: 'immeuble haut (R+5 et +)', maxH: Infinity }
];

export function familleHauteur(h) {
  return FAMILLES_HAUTEUR.find(f => h < f.maxH) || FAMILLES_HAUTEUR[FAMILLES_HAUTEUR.length - 1];
}

const HIERARCHIE_VOIE = {
  motorway: 'autoroute', trunk: 'voie rapide', primary: 'voie primaire',
  secondary: 'voie secondaire', tertiary: 'voie tertiaire', unclassified: 'voie locale',
  residential: 'rue résidentielle', living_street: 'zone de rencontre', service: 'voie de service',
  pedestrian: 'voie piétonne', footway: 'chemin piéton', path: 'sentier', track: 'chemin agricole'
};

/* --- analyse principale ---------------------------------------------- */

export function typomorphoFromOSM(elements, { lat, lon, nom = '', lieu = '', radius = 250 } = {}) {
  const ref = { lat, lon };
  const survey = surveyFromOSM(elements, { lat, lon, nom, lieu });
  if (!survey) return null;

  const ways = (elements || []).filter(e => e.type === 'way' && Array.isArray(e.geometry));
  const buildings = ways.filter(w => w.tags && (w.tags.building || w.tags['building:part']));
  const roads = ways.filter(w => w.tags && w.tags.highway);
  const refM = { lat, lon };

  /* voie principale : reprise du relevé */
  const voie = {
    classe: null, /* renseigné ci-dessous via la way la plus proche */
    largeur: survey.largeur_facades,
    axeDeg: survey.axe_deg,
    axeHypothese: survey.axe_hypothese
  };
  let bestRoad = null, bestD = Infinity;
  for (const r of roads) {
    const d = distToGeomM(ref, r.geometry, refM);
    if (d < bestD) { bestD = d; bestRoad = r; }
  }
  if (bestRoad) {
    voie.classe = bestRoad.tags.highway;
    voie.hierarchie = HIERARCHIE_VOIE[bestRoad.tags.highway] || bestRoad.tags.highway;
    /* longueur et sinuosité de la voie dans le rayon → ligne de croissance */
    let len = 0;
    for (let i = 0; i < bestRoad.geometry.length - 1; i++) len += distM(bestRoad.geometry[i], bestRoad.geometry[i + 1], refM);
    const extremes = distM(bestRoad.geometry[0], bestRoad.geometry[bestRoad.geometry.length - 1], refM);
    voie.longueurM = len;
    voie.sinuosite = extremes > 1 ? len / extremes : 1;
    voie.ligneNaturelle = voie.sinuosite > 1.15; /* tracé souple = ancien chemin (cours p.32) */
  }

  /* front bâti : bâtiments OSM à moins de maxD de l'axe de la voie principale */
  const L = survey.largeur_facades;
  const maxD = Math.max(35, L + 10);
  const near = [];
  for (const w of buildings) {
    const c = centroid(w.geometry, refM);
    const dAxe = bestRoad ? distToGeomM(c, bestRoad.geometry, refM) : distM(c, ref, refM);
    if (dAxe <= maxD) {
      const hTag = heightOf(w.tags || {});
      near.push({
        geom: w.geometry, centroid: c, dAxe,
        hauteur: hTag > 0 ? hTag : 0,
        rdc: (w.tags && (w.tags.shop || w.tags.amenity || w.tags.office)) ? 'commerce' : 'habitation',
        area: areaPolygonM2(w.geometry, refM)
      });
    }
  }
  /* projection de chaque bâtiment sur l'axe → couverture du front + trous (parcelles vacantes) */
  const a = survey.axe_deg * D2R;
  const proj = near.map(b => {
    let minT = Infinity, maxT = -Infinity, lat = 0;
    for (const g of b.geom) {
      const P = toXY(g, refM);
      const t = P.x * Math.sin(a) + P.y * Math.cos(a);
      minT = Math.min(minT, t); maxT = Math.max(maxT, t);
    }
    const C = toXY(b.centroid, refM);
    lat = C.x * Math.cos(a) - C.y * Math.sin(a); /* perpendiculaire à l'axe, + = un côté */
    return { ...b, t0: minT, t1: maxT, lateral: lat, side: lat >= 0 ? 'est' : 'ouest' };
  });
  const axeLen = bestRoad ? Math.min(voie.longueurM || 2 * radius, 2 * radius) : 2 * radius;
  const { covered, trous } = unionIntervals(proj.map(p => [p.t0, p.t1]), 6);
  const continuiteFrontPct = axeLen > 1 ? Math.max(0, Math.min(100, covered / axeLen * 100)) : 0;

  /* accolés : deux bâtiments dont les sommets sont à moins de 1,5 m (cours p.23) */
  const accoles = new Set();
  for (let i = 0; i < proj.length; i++) {
    for (let j = i + 1; j < proj.length; j++) {
      let dmin = Infinity;
      for (const g1 of proj[i].geom) {
        for (const g2 of proj[j].geom) {
          dmin = Math.min(dmin, distM(g1, g2, refM));
          if (dmin < 1.5) break;
        }
        if (dmin < 1.5) break;
      }
      if (dmin < 1.5) { accoles.add(i); accoles.add(j); }
    }
  }

  /* typologie des édifices (cours p.26) : famille de hauteur × accolés × RDC × retrait */
  const typesMap = new Map();
  for (let i = 0; i < proj.length; i++) {
    const p = proj[i];
    const fam = familleHauteur(p.hauteur);
    const accol = accoles.has(i);
    const rdc = p.rdc;
    /* relation à l'espace public : directe en bord de rue, indirecte en retrait (jardin/cour) */
    const retrait = p.dAxe <= L / 2 + 3 ? 'direct' : 'indirect';
    const key = `${fam.id}|${accol ? 'accolé' : 'isolé'}|${rdc}|${retrait}`;
    if (!typesMap.has(key)) {
      typesMap.set(key, {
        id: 'T' + (typesMap.size + 1),
        famille: fam.label, accol, rdc, retrait,
        label: `${fam.label} · ${accol ? 'accolé' : 'isolé'} · RDC ${rdc} · ${retrait === 'direct' ? 'en bord de rue' : 'en retrait'}`,
        effectif: 0, hauteurs: []
      });
    }
    const t = typesMap.get(key);
    t.effectif += 1;
    t.hauteurs.push(p.hauteur);
    p.typeId = t.id;
  }
  const types = [...typesMap.values()].sort((a, b) => b.effectif - a.effectif);
  const typeDominant = types[0] || null;

  /* îlot : densité bâtie dans le disque de rayon `radius` (cours p.22, 35) */
  const aireZone = Math.PI * radius * radius;
  const aireBatie = buildings.reduce((t, w) => t + areaPolygonM2(w.geometry, refM), 0);
  const nbBat = buildings.length;
  const densiteBatiePct = aireZone > 0 ? Math.min(100, aireBatie / aireZone * 100) : 0;
  const empriseMoyenne = nbBat > 0 ? aireBatie / nbBat : 0;

  /* carrefours (cours p.27) : nœuds où ≥ 3 branches de voies se croisent */
  const carrefours = [];
  for (const r of roads) {
    for (const p of r.geometry) {
      if (distM(p, ref, refM) > radius) continue;
      let branches = 0;
      for (const r2 of roads) {
        if (distToGeomM(p, r2.geometry, refM) >= 12) continue;
        const isEnd = distM(p, r2.geometry[0], refM) < 12 || distM(p, r2.geometry[r2.geometry.length - 1], refM) < 12;
        branches += isEnd ? 1 : 2; /* extrémité = 1 direction, nœud intérieur = 2 */
      }
      if (branches >= 3 && !carrefours.some(c => distM(c.at, p, refM) < 15)) {
        carrefours.push({ type: branches >= 4 ? 'croix' : 'T', branches, distanceM: distM(p, ref, refM), at: p });
      }
    }
  }

  /* barrières (cours p.34) : géographiques (eau, forêt) ou artificielles (voie ferrée, grand axe, enceinte) */
  const barrieres = [];
  for (const w of ways) {
    const t = w.tags || {};
    let kind = null;
    if (t.natural === 'water' || t.waterway) kind = 'barrière géographique (cours d’eau)';
    else if (t.railway) kind = 'barrière artificielle (voie ferrée)';
    else if (t.highway === 'motorway' || t.highway === 'trunk') kind = 'barrière artificielle (grand axe)';
    else if (t.barrier) kind = `barrière artificielle (${t.barrier})`;
    else if (t.natural === 'wood' || t.landuse === 'forest') kind = 'barrière géographique (forêt)';
    if (!kind) continue;
    const d = distToGeomM(ref, w.geometry, refM);
    if (d < radius) barrieres.push({ kind, distanceM: d });
  }

  /* lecture topologique de la rue (cours p.13) : fluide / canalisé / statique */
  const hMoyEgout = (survey.facades.ouest.hauteur_egout + survey.facades.est.hauteur_egout) / 2;
  const hl = hMoyEgout / Math.max(1e-6, L);
  let lecture;
  if (L >= 14 && hl < 0.5) lecture = { code: 'fluide', label: 'espace fluide — grand vide ouvert, sans encorbellement' };
  else if (continuiteFrontPct >= 60 && hl >= 1) lecture = { code: 'canalise', label: 'espace canalisé — rue-couloir qui incite au déplacement (dynamisme)' };
  else if (L <= 9 && hl >= 1) lecture = { code: 'statique', label: 'espace statique — petit et fermé, qui incite au stationnement' };
  else lecture = { code: 'intermediaire', label: 'espace intermédiaire — ni totalement ouvert ni canalisé' };

  /* croissance (cours p.30-36) : ligne le long de l'axe, barrières, densification */
  const hauteurs = proj.map(p => p.hauteur).filter(h => h > 0);
  const hMoy = hauteurs.length ? hauteurs.reduce((a, b) => a + b, 0) / hauteurs.length : 0;
  const croissance = {
    type: 'linéaire',
    axeDeg: survey.axe_deg,
    ligne: voie.ligneNaturelle ? 'ligne de croissance naturelle (tracé souple, ancien chemin)' : 'ligne de croissance artificielle (tracé rectiligne projeté)',
    barrieres,
    densification: {
      parSubstitution: trous.length, /* parcelles vacantes le long de l'axe */
      parElevation: hauteurs.filter(h => hMoy > 0 && h < 0.8 * hMoy).length /* immeubles sous la hauteur moyenne */
    }
  };

  return {
    nom, lieu, lat, lon, radius,
    voie, continuiteFrontPct, trous,
    types, typeDominant,
    ilot: { nbBatiments: nbBat, aireBatieM2: aireBatie, aireZoneM2: aireZone, densiteBatiePct, empriseMoyenneM2: empriseMoyenne },
    carrefours, lecture, croissance,
    nbImmeubles: proj.length,
    /* données pour le plan schématique : [t0, t1] sur l'axe, lateral, hauteur, type] */
    plan: proj.map(p => ({
      t0: p.t0, t1: p.t1, lateral: p.lateral, side: p.side,
      hauteur: p.hauteur, rdc: p.rdc, accol: accoles.has(proj.indexOf(p)),
      typeId: p.typeId || null, areaM2: p.area
    }))
  };
}

function centroid(geom, ref) {
  let x = 0, y = 0;
  for (const g of geom) { const P = toXY(g, ref); x += P.x; y += P.y; }
  const n = geom.length || 1;
  return { lat: ref.lat + (y / n) / 111320, lon: ref.lon + (x / n) / (Math.cos(ref.lat * D2R) * 111320) };
}

/* --- récupération réseau (navigateur) --------------------------------- */

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Une catégorie de données (bâtiments ou voies) : essai au rayon demandé,
   puis — si les miroirs sont en pause (retryAfter, typiquement 30 s après
   des 504) — attente du cooldown puis repli à 60 % du rayon. Jamais de
   réponse partielle silencieuse : ok=false est remonté. */
async function fetchCategorie(routes, makeQ, radius, onProgress) {
  const r2 = Math.max(60, Math.round(radius * 0.6));
  for (const [r, lim, force] of [[radius, 600, false], [r2, 400, true]]) {
    try {
      const d = await routes.overpassDirect(makeQ(r, lim), 25000, force);
      return { elements: (d && d.elements) || [], r, ok: true };
    } catch (e) {
      if (force) return { elements: [], r, ok: false, error: e };
      const wait = Math.min(35000, Math.max(0, Number(e.retryAfter) || 30) * 1000);
      if (onProgress) onProgress(`miroirs OSM en pause ${Math.ceil(wait / 1000)} s — repli à ${r2} m ensuite…`);
      await sleep(wait);
    }
  }
  return { elements: [], r: r2, ok: false };
}

export async function fetchTypomorphoOSM(routes, lat, lon, radius = 150, onProgress = null) {
  /* Deux requêtes légères plutôt qu'une grosse : chaque catégorie doit
     répondre en moins de 8 s pour passer le budget par miroir. */
  const qBat = (r, lim) => `[out:json][timeout:20];
(way["building"](around:${r},${lat},${lon});way["building:part"](around:${r},${lat},${lon}););
out geom ${lim};`;
  const qVoies = (r, lim) => `[out:json][timeout:20];
(way["highway"](around:${r},${lat},${lon});way["barrier"](around:${r},${lat},${lon});
 way["railway"](around:${r},${lat},${lon});way["waterway"](around:${r},${lat},${lon});
 way["natural"="water"](around:${r},${lat},${lon});way["leisure"="park"](around:${r},${lat},${lon}););
out geom ${Math.min(lim, 250)};`;
  const bat = await fetchCategorie(routes, qBat, radius, onProgress);
  const voies = await fetchCategorie(routes, qVoies, radius, onProgress);
  const elements = [...voies.elements, ...bat.elements];
  const typo = typomorphoFromOSM(elements, { lat, lon, radius: voies.r });
  if (!typo) {
    const e = new Error('Aucune voie OSM autour du point (miroirs indisponibles ou zone sans voie cartographiée)');
    e.code = 'RUE_INTROUVABLE';
    throw e;
  }
  typo.elements = elements;
  typo.radiusDemande = radius;
  typo.radiusEffectif = voies.r;
  typo.repli = voies.r < radius || bat.r < radius;
  typo.partiel = !voies.ok || !bat.ok; /* une des deux catégories a échoué */
  return typo;
}
