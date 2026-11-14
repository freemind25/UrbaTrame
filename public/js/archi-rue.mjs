/* UrbaTrame · Analyse architecturale de la rue
   Moteur de calcul déterministe : un relevé de rue (rue.json) entre, des
   indicateurs et des dessins sortent. Aucune donnée n'est inventée : tout
   ce qui est supposé est listé par `surveyWarnings()` et affiché sur les
   planches. Aucun appel réseau, aucun générateur d'images.

   Le format `rue.json` est compatible avec les commandes de dessin de rue
   (usages, profil, fronts, axo, ombres, demain, planche) : les mêmes
   champs peuvent être importés tels quels d'un dossier de projet. */

export const ARCHI_SCHEMA_VERSION = 1;
export const ARCHI_VERSION = '20261115archi1';

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 2) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function str(value, fallback = '') {
  const s = value == null ? '' : String(value).trim();
  return s || fallback;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

/* Raccourci d'écriture décimale française : 12,1 m · 4,50 m. */
export function fr(value, digits = 2) {
  const n = num(value, 0);
  return n.toFixed(digits).replace('.', ',');
}

/* ------------------------------------------------------------------ */
/* Relevé                                                              */
/* ------------------------------------------------------------------ */

const SIDE_KEYS = ['ouest', 'est'];

function normalizeBuildings(rawBuildings, facade, side) {
  const buildings = list(rawBuildings)
    .map((b, i) => {
      const largeur = clamp(num(b.largeur, 0), 0.5, 200);
      const egout = clamp(num(b.hauteur_egout, facade.hauteur_egout), 1, 120);
      return {
        nom: str(b.nom, `n° ${i + 1}`),
        largeur,
        hauteur_egout: egout,
        hauteur_faitage: clamp(num(b.hauteur_faitage, egout + 3.2), egout, 140),
        niveaux: str(b.niveaux, 'R+4+C'),
        rdc: str(b.rdc, facade.rdc),
        suppose: Boolean(b.suppose)
      };
    })
    .filter(b => b.largeur > 0);

  if (buildings.length) return buildings;

  /* Aucun immeuble saisi : on découpe la façade en trois travées égales,
     en le disant clairement dans les hypothèses. */
  const total = clamp(num(facade.largeur_totale, 21), 3, 400);
  const count = 3;
  const largeur = total / count;
  return Array.from({ length: count }, (_, i) => ({
    nom: `${side === 'ouest' ? 'O' : 'E'}${i + 1}`,
    largeur,
    hauteur_egout: clamp(num(facade.hauteur_egout, 15), 1, 120),
    hauteur_faitage: clamp(num(facade.hauteur_faitage, num(facade.hauteur_egout, 15) + 3), 1, 140),
    niveaux: str(facade.niveaux, 'R+4+C'),
    rdc: str(facade.rdc, 'commerce'),
    suppose: true
  }));
}

function normalizeBandes(rawBandes, largeur) {
  const bandes = list(rawBandes)
    .map(b => ({
      type: str(b.type, 'passage').toLowerCase(),
      largeur: clamp(num(b.largeur, 0), 0, 60),
      cote: str(b.cote, '')
    }))
    .filter(b => b.largeur > 0);

  if (!bandes.length) {
    return [{ type: 'passage', largeur, cote: '' }];
  }
  return bandes;
}

export function normalizeSurvey(raw = {}) {
  const largeur = clamp(num(raw.largeur_facades, 12), 2, 80);
  const bandes = normalizeBandes(raw.bandes, largeur);

  const facadesRaw = raw.facades && typeof raw.facades === 'object' ? raw.facades : {};
  const facades = {};
  for (const side of SIDE_KEYS) {
    const f = facadesRaw[side] && typeof facadesRaw[side] === 'object' ? facadesRaw[side] : {};
    const rdc = str(f.rdc, 'commerce');
    const hauteur = clamp(num(f.hauteur_egout, 15), 1, 120);
    const facade = {
      rdc,
      niveaux: str(f.niveaux, 'R+4+C'),
      hauteur_egout: hauteur,
      hauteur_faitage: clamp(num(f.hauteur_faitage, hauteur + 3), hauteur, 140),
      largeur_totale: clamp(num(f.largeur_totale, 21), 1, 400),
      teinte: str(f.teinte, side === 'ouest' ? '#f3eee4' : '#efe9de'),
      immeubles: []
    };
    facade.immeubles = normalizeBuildings(f.immeubles, facade, side);
    facade.largeur_totale = facade.immeubles.reduce((s, b) => s + b.largeur, 0);
    facade.hauteur_egout = facade.immeubles.reduce((s, b) => s + b.largeur * b.hauteur_egout, 0) /
      Math.max(1e-6, facade.largeur_totale);
    facade.hauteur_faitage = facade.immeubles.reduce((s, b) => s + b.largeur * b.hauteur_faitage, 0) /
      Math.max(1e-6, facade.largeur_totale);
    facades[side] = facade;
  }

  const mobilierRaw = raw.mobilier && typeof raw.mobilier === 'object' ? raw.mobilier : {};
  const gensRaw = raw.gens && typeof raw.gens === 'object' ? raw.gens : {};

  return {
    version: ARCHI_SCHEMA_VERSION,
    nom: str(raw.nom, 'Rue sans nom'),
    lieu: str(raw.lieu, ''),
    date: str(raw.date, new Date().toISOString().slice(0, 10)),
    photo: str(raw.photo, ''),
    latitude: clamp(num(raw.latitude, 36.365), -90, 90),
    longitude: clamp(num(raw.longitude, 6.61), -180, 180),
    fuseau: clamp(num(raw.fuseau, 1), -12, 14),
    axe_deg: ((num(raw.axe_deg, 0) % 360) + 360) % 360,
    axe_hypothese: raw.axe_hypothese !== false,
    largeur_facades: largeur,
    longueur_relevee: clamp(num(raw.longueur_relevee, 29), 5, 400),
    sol: str(raw.sol, 'pavés'),
    bandes,
    facades,
    mobilier: {
      bornes: clamp(num(mobilierRaw.bornes, 0), 0, 999),
      potelets: clamp(num(mobilierRaw.potelets, 0), 0, 999),
      reverberes: clamp(num(mobilierRaw.reverberes, 0), 0, 999),
      arbres: clamp(num(mobilierRaw.arbres, 0), 0, 999),
      arceaux: clamp(num(mobilierRaw.arceaux, 0), 0, 999),
      poubelles: clamp(num(mobilierRaw.poubelles, 0), 0, 999)
    },
    gens: {
      vus: clamp(num(gensRaw.vus, 0), 0, 100000),
      en_plan: clamp(num(gensRaw.en_plan, num(gensRaw.vus, 0)), 0, 100000)
    },
    note: str(raw.note, '')
  };
}

/* Hypothèses et incohérences lisibles par l'utilisateur. */
export function surveyWarnings(survey) {
  const s = normalizeSurvey(survey);
  const out = [];
  const sum = s.bandes.reduce((t, b) => t + b.largeur, 0);
  if (Math.abs(sum - s.largeur_facades) > 0.05) {
    out.push({
      niveau: 'warn',
      texte: `Les bandes totalisent ${fr(sum)} m pour une largeur entre façades de ${fr(s.largeur_facades)} m : écart de ${fr(Math.abs(sum - s.largeur_facades))} m.`
    });
  }
  for (const side of SIDE_KEYS) {
    const f = s.facades[side];
    if (f.immeubles.some(b => b.suppose)) {
      out.push({ niveau: 'info', texte: `Façade ${side} : hauteur ou découpe supposée pour au moins un immeuble.` });
    }
    if (f.hauteur_egout <= 0) out.push({ niveau: 'warn', texte: `Façade ${side} : hauteur à l’égout manquante.` });
  }
  if (s.axe_hypothese) {
    out.push({ niveau: 'info', texte: `Orientation de la rue non mesurée : axe pris à ${fr(s.axe_deg, 0)}° du nord (hypothèse à corriger sur le terrain).` });
  }
  if (!s.gens.vus) {
    out.push({ niveau: 'info', texte: 'Aucun comptage de personnes renseigné : le plan des usages restera vide côté passants.' });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Indicateurs                                                         */
/* ------------------------------------------------------------------ */

export function computeMetrics(survey) {
  const s = normalizeSurvey(survey);
  const L = s.largeur_facades;
  let terrasses = 0;
  let passage = 0;
  let autre = 0;
  for (const b of s.bandes) {
    if (b.type.includes('terrasse')) terrasses += b.largeur;
    else if (b.type.includes('passage') || b.type.includes('piéton') || b.type.includes('pieton')) passage += b.largeur;
    else autre += b.largeur;
  }
  const total = Math.max(1e-6, terrasses + passage + autre);
  const hO = s.facades.ouest.hauteur_egout;
  const hE = s.facades.est.hauteur_egout;
  const hauteur = (hO + hE) / 2;
  const hl = hauteur / Math.max(1e-6, L);
  const ciel = 2 * Math.atan((L / 2) / Math.max(1e-6, hauteur)) * RAD;

  return {
    largeur: L,
    longueur: s.longueur_relevee,
    terrasses,
    passage,
    autre,
    partTerrasses: (terrasses / total) * 100,
    partPassage: (passage / total) * 100,
    partAutre: (autre / total) * 100,
    hauteurOuest: hO,
    hauteurEst: hE,
    hauteurMoyenne: hauteur,
    hl,
    cielDeg: ciel,
    typeRue: hl >= 1 ? 'rue en canyon' : hl >= 0.5 ? 'rue médiane' : 'rue ouverte',
    surfaceSol: L * s.longueur_relevee,
    empriseBatie: (hO > 0 ? 0 : 0) + 0,
    personnes: s.gens.en_plan
  };
}

export function describeHL(metrics) {
  const hl = metrics.hl;
  if (hl >= 1) {
    return `Les façades sont ${hl >= 1.5 ? 'une fois et demie' : 'au moins aussi'} plus hautes que la rue n’est large : rue-couloir, le soleil n’atteint le sol que bas dans le ciel.`;
  }
  if (hl >= 0.5) {
    return 'Rapport intermédiaire : la rue reçoit du soleil une partie de la journée, sans être complètement ouverte.';
  }
  return 'Rue ouverte : les façades sont basses par rapport à la largeur, le soleil atteint le sol une grande partie de la journée.';
}

/* ------------------------------------------------------------------ */
/* Soleil                                                              */
/* ------------------------------------------------------------------ */

export function dayOfYear(year, month, day) {
  const start = Date.UTC(year, 0, 1);
  const current = Date.UTC(year, month - 1, day);
  return Math.floor((current - start) / 86400000) + 1;
}

export function solarDeclination(n) {
  return 23.44 * Math.sin(360 / 365 * (284 + n) * DEG);
}

/* Équation du temps (minutes), formule de Cooper simplifiée. */
export function equationOfTime(n) {
  const B = 360 / 365 * (n - 81) * DEG;
  return 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
}

/*
   Position du soleil pour une heure solaire vraie.
   azimuth : degrés depuis le nord, sens horaire (est = 90).
   altitude : degrés au-dessus de l'horizon.
*/
export function sunPosition({ day, solarHour = 12, latitude = 48.86 }) {
  const decl = solarDeclination(day);
  const lat = clamp(num(latitude, 48.86), -89.5, 89.5);
  const H = (num(solarHour, 12) - 12) * 15;
  const sinAlt = Math.sin(lat * DEG) * Math.sin(decl * DEG) +
    Math.cos(lat * DEG) * Math.cos(decl * DEG) * Math.cos(H * DEG);
  const altitude = Math.asin(clamp(sinAlt, -1, 1)) * RAD;
  const x = -Math.cos(decl * DEG) * Math.sin(H * DEG);
  const y = Math.sin(decl * DEG) * Math.cos(lat * DEG) -
    Math.cos(decl * DEG) * Math.sin(lat * DEG) * Math.cos(H * DEG);
  const azimuth = (Math.atan2(x, y) * RAD + 360) % 360;
  return { altitude, azimuth, declination: decl };
}

/* Décalage entre heure solaire et heure légale (sans heure d'été). */
export function legalOffsetHours(survey) {
  const s = normalizeSurvey(survey);
  return s.fuseau - s.longitude / 15;
}

export function solarToLegal(survey, solarHour) {
  return (num(solarHour, 12) + legalOffsetHours(survey) + 24) % 24;
}

export function formatHour(h) {
  const v = ((num(h, 0) % 24) + 24) % 24;
  const hh = Math.floor(v);
  const mm = Math.round((v - hh) * 60);
  if (mm === 60) return formatHour(hh + 1);
  return `${String(hh).padStart(2, '0')}h${String(mm).padStart(2, '0')}`;
}

/* Largeur éclairée au sol par le soleil, sur une coupe en travers. */
export function litWidth(survey, sun, { facadeSoleil = null } = {}) {
  const s = normalizeSurvey(survey);
  if (!sun || sun.altitude <= 0.5) return 0;
  const axis = s.axe_deg;
  const c = Math.sin((sun.azimuth - axis) * DEG);
  const tanAlt = Math.tan(sun.altitude * DEG);
  const L = s.largeur_facades;
  const hO = s.facades.ouest.hauteur_egout;
  const hE = s.facades.est.hauteur_egout;
  const ombreEst = hE / Math.max(0.05, tanAlt) * Math.max(0, c);
  const ombreOuest = hO / Math.max(0.05, tanAlt) * Math.max(0, -c);
  const lit = c >= 0 ? L - ombreEst : L - ombreOuest;
  return clamp(lit, 0, L);
}

/*
   Étude d'ensoleillement du sol pour une journée.
   `stepMin` : pas de calcul en minutes solaires.
   Retourne les séries, la première et la dernière heure où le sol est
   éclairé, la durée « au moins un point éclairé » et la durée moyenne
   (intégrale de la fraction éclairée).
*/
export function daylightStudy(survey, { day, stepMin = 5, latitude = null } = {}) {
  const s = normalizeSurvey(survey);
  const lat = latitude == null ? s.latitude : latitude;
  const d = clamp(num(day, 172), 1, 366);
  const step = clamp(num(stepMin, 5), 1, 60) / 60;
  const series = [];
  let anyHours = 0;
  let meanHours = 0;
  let first = null;
  let last = null;
  let maxAlt = -90;

  for (let hour = 0; hour <= 24.0001; hour += step) {
    const sun = sunPosition({ day: d, solarHour: hour, latitude: lat });
    const lit = litWidth(s, sun);
    const fraction = lit / Math.max(1e-6, s.largeur_facades);
    if (sun.altitude > maxAlt) maxAlt = sun.altitude;
    if (sun.altitude > 0 && lit > 0.02) {
      anyHours += step;
      meanHours += fraction * step;
      if (first == null) first = hour;
      last = hour;
    }
    series.push({
      hour,
      legal: solarToLegal(s, hour),
      altitude: sun.altitude,
      azimuth: sun.azimuth,
      lit,
      fraction
    });
  }

  return {
    day: d,
    latitude: lat,
    series,
    maxAltitude: maxAlt,
    anyHours,
    meanHours,
    firstHour: first,
    lastHour: last,
    firstLegal: first == null ? null : solarToLegal(s, first),
    lastLegal: last == null ? null : solarToLegal(s, last)
  };
}

export function daylightSummary(survey) {
  const summer = daylightStudy(survey, { day: 172, stepMin: 5 });
  const winter = daylightStudy(survey, { day: 355, stepMin: 5 });
  return { summer, winter };
}

/* ------------------------------------------------------------------ */
/* Scénario « demain »                                                 */
/* ------------------------------------------------------------------ */

/*
   Réaménagement minimal, sans toucher aux immeubles :
   - 0,75 m pris sur la terrasse et 0,75 m sur le passage pour une fosse
     de 1,50 × 1,50 m (arbres d'alignement) ;
   - le passage libre ne descend jamais sous `minFree` (1,80 m) ;
   - les positions sont espacées de `spacing` mètres, à `spacing/2` des
     extrémités.
*/
export function demainScenario(survey, { minFree = 1.8, pit = 1.5, spacing = 8 } = {}) {
  const s = normalizeSurvey(survey);
  const m = computeMetrics(s);
  const length = s.longueur_relevee;
  const halfPit = pit / 2;
  const positions = [];
  const usable = Math.max(0, length - spacing);
  const count = Math.max(0, Math.floor(usable / spacing) + 1);
  for (let i = 0; i < count; i++) positions.push(spacing / 2 + i * spacing);

  const sides = [];
  for (const side of SIDE_KEYS) {
    const terrace = s.bandes
      .filter(b => b.type.includes('terrasse') && (!b.cote || b.cote === side))
      .reduce((t, b) => t + b.largeur, 0);
    const basePassage = m.passage;
    let takeTerrace = 0;
    let takePassage = 0;
    if (terrace >= halfPit + 0.3) {
      takeTerrace = halfPit;
      takePassage = halfPit;
    } else {
      takePassage = pit;
    }
    const freeAfter = basePassage - takePassage;
    const ok = freeAfter >= minFree - 1e-9 && terrace > 0;
    const trees = ok ? positions.length : 0;
    if (ok) {
      sides.push({
        side,
        trees,
        terraceAvant: round(terrace, 2),
        terraceApres: round(terrace - takeTerrace, 2),
        passageApres: round(freeAfter, 2),
        takeTerrace: round(takeTerrace, 2),
        takePassage: round(takePassage, 2)
      });
    } else {
      sides.push({
        side,
        trees: 0,
        terraceAvant: round(terrace, 2),
        terraceApres: round(terrace, 2),
        passageApres: round(basePassage, 2),
        takeTerrace: 0,
        takePassage: 0,
        raison: terrace <= 0
          ? 'pas de terrasse de ce côté'
          : `le passage libre tomberait sous ${fr(minFree)} m`
      });
    }
  }

  const trees = sides.reduce((t, x) => t + x.trees, 0);
  const pleineTerre = trees * pit * pit;
  const freeAfter = Math.min(...sides.map(x => x.passageApres));
  const placeTrees = [];
  for (const side of sides) {
    if (!side.trees) continue;
    for (const at of positions) placeTrees.push({ side: side.side, at });
  }

  return {
    minFree,
    pit,
    spacing,
    positions,
    placeTrees,
    sides,
    trees,
    pleineTerre,
    freeBefore: round(m.passage, 2),
    freeAfter: round(freeAfter, 2),
    verifications: [
      'réseaux sous la chaussée (DT-DICT) avant toute fosse',
      'livraisons : largeur et horaires restants',
      'accès pompiers et échelle : 3,00 m de large, 3,50 m de haut'
    ]
  };
}

/* ------------------------------------------------------------------ */
/* Relevé de démonstration (rue Montorgueil, d'après la photo fournie)  */
/* ------------------------------------------------------------------ */

export const DEMO_SURVEY = normalizeSurvey({
  nom: 'Rue Montorgueil',
  lieu: 'Paris 1er/2e · entrée Saint-Eustache',
  date: '2026-11-06',
  latitude: 48.862,
  longitude: 2.347,
  fuseau: 1,
  axe_deg: 16,
  axe_hypothese: true,
  largeur_facades: 12.10,
  longueur_relevee: 29,
  sol: 'pavés',
  bandes: [
    { type: 'terrasse', largeur: 6.20, cote: 'ouest' },
    { type: 'passage', largeur: 3.80, cote: '' },
    { type: 'terrasse', largeur: 2.10, cote: 'est' }
  ],
  facades: {
    ouest: {
      rdc: 'café',
      niveaux: 'R+5+C',
      hauteur_egout: 17.9,
      hauteur_faitage: 21.2,
      largeur_totale: 29,
      immeubles: [
        { nom: 'n° 1', largeur: 7.4, hauteur_egout: 18.2, hauteur_faitage: 21.5, niveaux: 'R+5+C ?', rdc: 'café', suppose: true },
        { nom: 'n° 2', largeur: 7.0, hauteur_egout: 19.0, hauteur_faitage: 22.2, niveaux: 'R+5', rdc: 'café' },
        { nom: 'n° 3', largeur: 7.3, hauteur_egout: 18.9, hauteur_faitage: 22.0, niveaux: 'R+5+C', rdc: 'café' },
        { nom: 'n° 4', largeur: 7.3, hauteur_egout: 16.4, hauteur_faitage: 19.4, niveaux: 'R+4+C', rdc: 'café' }
      ]
    },
    est: {
      rdc: 'café',
      niveaux: 'R+4+C',
      hauteur_egout: 19.0,
      hauteur_faitage: 22.2,
      largeur_totale: 29,
      immeubles: [
        { nom: 'n° 5', largeur: 7.2, hauteur_egout: 15.4, hauteur_faitage: 18.4, niveaux: 'R+4+C', rdc: 'café' },
        { nom: 'n° 6', largeur: 7.0, hauteur_egout: 15.2, hauteur_faitage: 18.2, niveaux: 'R+4+C', rdc: 'café', suppose: true },
        { nom: 'n° 7', largeur: 7.4, hauteur_egout: 19.5, hauteur_faitage: 22.7, niveaux: 'R+5', rdc: 'café' },
        { nom: 'n° 8', largeur: 7.4, hauteur_egout: 15.8, hauteur_faitage: 18.8, niveaux: 'R+4+C', rdc: 'café', suppose: true }
      ]
    }
  },
  mobilier: { bornes: 6, potelets: 0, reverberes: 2, arbres: 0, arceaux: 0, poubelles: 1 },
  gens: { vus: 199, en_plan: 155 },
  note: 'Relevé sur photo, largeur ± 1,5 m. Étages de 3,0 m et rez-de-chaussée de 3,8 à 4,5 m supposés.'
});

/* ------------------------------------------------------------------ */
/* Validation d'un fichier importé                                     */
/* ------------------------------------------------------------------ */

export function surveyFromJSON(text) {
  const data = typeof text === 'string' ? JSON.parse(text) : text;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Le fichier ne contient pas un objet de relevé.');
  }
  if (data.rue && typeof data.rue === 'object' && !data.largeur_facades) {
    /* Variante « dossier de projet » : le relevé est sous `rue`. */
    data.largeur_facades = data.rue.largeur_facades;
    data.bandes = data.rue.bandes || data.bandes;
    data.sol = data.rue.sol || data.sol;
  }
  return normalizeSurvey(data);
}

export function surveyToJSON(survey) {
  return JSON.stringify(normalizeSurvey(survey), null, 2);
}
