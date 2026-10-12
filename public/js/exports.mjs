/* Exports de plans et de modèles — DXF, OBJ, STL, coupe topographique.
   Aucune dépendance : ces formats sont du texte, on les écrit à la main.

   Repères retenus :
   · DXF : version R12 (AC1009), la plus largement lue (AutoCAD, QCAD,
     Illustrator, Inkscape…) — polylignes en POLYLINE/VERTEX/SEQEND, pas en
     LWPOLYLINE (apparue en R13 et ignorée des lecteurs anciens).
   · OBJ : un seul fichier, groupes « TERRAIN » et « BATI ».
   · STL : ASCII, facettes triangulaires.
   · Dans les trois cas : mètres, X vers l'est, Y vers le nord, Z vers le haut
     (convention CAO), comme le repère local du moteur 3D (`vue3d.js`).

   Deux systèmes de coordonnées au choix :
   · local (défaut) — origine au centre du site ;
   · géoréférencé (`geolocate`) — mètres UTM (WGS 84), pour se superposer à un
     fond cadastral ou à un relevé de géomètre. */

const D2R = Math.PI / 180;
const M_LAT = 111320;                                    // mètres par degré de latitude

/* ─────────────────────────── projection UTM (WGS 84) ─────────────────────────── */

/* Série de Krüger (précision centimétrique dans la zone d'usage).
   Renvoie { zone, hemisphere, easting, northing }. */
export function utm(lat, lon) {
  const a = 6378137, f = 1 / 298.257223563;              // ellipsoïde WGS 84
  const e2 = 2 * f - f * f, ep2 = e2 / (1 - e2);
  const zone = Math.floor((lon + 180) / 6) + 1;
  const lon0 = (zone - 1) * 6 - 180 + 3;                 // méridien central de la zone
  const k0 = 0.9996;
  const phi = lat * D2R, lam = (lon - lon0) * D2R;
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const T = Math.tan(phi) ** 2, C = ep2 * Math.cos(phi) ** 2;
  const A = Math.cos(phi) * lam;
  const M = a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * phi
    - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * phi)
    + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * phi)
    - (35 * e2 ** 3 / 3072) * Math.sin(6 * phi));
  const easting = k0 * N * (A + (1 - T + C) * A ** 3 / 6
    + (5 - 18 * T + T ** 2 + 72 * C - 58 * ep2) * A ** 5 / 120) + 500000;
  let northing = k0 * (M + N * Math.tan(phi) * (A ** 2 / 2
    + (5 - T + 9 * C + 4 * C ** 2) * A ** 4 / 24
    + (61 - 58 * T + T ** 2 + 600 * C - 330 * ep2) * A ** 6 / 720));
  const hemisphere = lat < 0 ? 'S' : 'N';
  if (lat < 0) northing += 10000000;                     // faux northing austral
  return { zone, hemisphere, easting, northing };
}

/* Géographique → mètres locaux (X est, Y nord), origine au centre du site. */
export function enLocal(lat, lon, lat0, lon0) {
  return [(lon - lon0) * M_LAT * Math.cos(lat0 * D2R), (lat - lat0) * M_LAT];
}

/* Repère de sortie : local, ou UTM si `geolocate`. */
export function repere(ctx, o) {
  o = o || {};
  const lat0 = ctx.sLat, lon0 = ctx.sLng;
  if (!o.geolocate) {
    return {
      type: 'local',
      vers: (x, y) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000],
      note: 'metres, origine au centre du site (X est, Y nord)'
    };
  }
  const u0 = utm(lat0, lon0);
  return {
    type: 'utm', zone: u0.zone, hemisphere: u0.hemisphere,
    origine: [u0.easting, u0.northing],
    vers: (x, y) => [Math.round((u0.easting + x) * 1000) / 1000, Math.round((u0.northing + y) * 1000) / 1000],
    note: 'metres UTM zone ' + u0.zone + u0.hemisphere + ' (WGS 84)'
  };
}

/* ─────────────────────────── écriture DXF (R12, AC1009) ─────────────────────────── */

const COULEURS = { rouge: 1, jaune: 2, vert: 3, cyan: 4, bleu: 5, magenta: 6, noir: 7, gris: 8, clair: 9 };
const couple = (code, valeur) => code + '\n' + valeur + '\n';
const fmt = v => (Math.round(v * 1000) / 1000).toFixed(3);

/* Le DXF R12 se lit le plus souvent en ANSI : plutôt que d'écrire du texte
   illisible dans AutoCAD, on retire accents et caractères non latins. */
const PONCTUATION = {
  '\u2013': '-', '\u2014': '-', '\u2012': '-', '\u2015': '-', '\u2212': '-',
  '\u2019': "'", '\u2018': "'", '\u201c': '"', '\u201d': '"',
  '\u00b7': '-', '\u2022': '-', '\u2026': '...', '\u00b0': ' deg', '\u00d7': 'x',
  '\u0153': 'oe', '\u0152': 'OE', '\u00e6': 'ae', '\u00c6': 'AE', '\u20ac': 'EUR'
};
export function sansAccent(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2013\u2014\u2012\u2015\u2212\u2019\u2018\u201c\u201d\u00b7\u2022\u2026\u00b0\u00d7\u0153\u0152\u00e6\u00c6\u20ac]/g, c => PONCTUATION[c] || '')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ').trim();
}

/* entites : { t: 'poly'|'ligne'|'texte'|'point', calque, pts|a|b|pos, txt, h, z, ferme }
   calques : { nom, couleur } */
export function dxf(entites, calques, o) {
  o = o || {};
  const l = [];
  l.push(couple(0, 'SECTION'), couple(2, 'HEADER'));
  l.push(couple(9, '$ACADVER'), couple(1, 'AC1009'));
  l.push(couple(9, '$INSUNITS'), couple(70, 6));         // 6 = mètres
  l.push(couple(9, '$MEASUREMENT'), couple(70, 1));      // système métrique
  if (o.titre) l.push(couple(9, '$PROJECTNAME'), couple(1, sansAccent(o.titre).slice(0, 30)));
  l.push(couple(0, 'ENDSEC'));

  l.push(couple(0, 'SECTION'), couple(2, 'TABLES'));
  l.push(couple(0, 'TABLE'), couple(2, 'LAYER'), couple(70, calques.length));
  for (const c of calques) {
    l.push(couple(0, 'LAYER'), couple(2, c.nom.toUpperCase()), couple(70, 0),
      couple(62, typeof c.couleur === 'number' ? c.couleur : COULEURS[c.couleur] || 7),
      couple(6, 'CONTINUOUS'));
  }
  l.push(couple(0, 'ENDTAB'), couple(0, 'ENDSEC'));

  l.push(couple(0, 'SECTION'), couple(2, 'ENTITIES'));
  for (const e of entites) {
    const calque = String(e.calque || '0').toUpperCase();
    const z = e.z === undefined ? 0 : e.z;
    if (e.t === 'poly' && e.pts && e.pts.length > 1) {
      l.push(couple(0, 'POLYLINE'), couple(8, calque), couple(66, 1), couple(70, e.ferme ? 1 : 0),
        couple(10, 0), couple(20, 0), couple(30, fmt(z)));
      for (const [x, y] of e.pts)
        l.push(couple(0, 'VERTEX'), couple(8, calque), couple(10, fmt(x)), couple(20, fmt(y)), couple(30, fmt(z)));
      l.push(couple(0, 'SEQEND'), couple(8, calque));
    } else if (e.t === 'ligne') {
      l.push(couple(0, 'LINE'), couple(8, calque),
        couple(10, fmt(e.a[0])), couple(20, fmt(e.a[1])), couple(30, fmt(z)),
        couple(11, fmt(e.b[0])), couple(21, fmt(e.b[1])), couple(31, fmt(z)));
    } else if (e.t === 'point') {
      l.push(couple(0, 'POINT'), couple(8, calque),
        couple(10, fmt(e.pos[0])), couple(20, fmt(e.pos[1])), couple(30, fmt(z)));
    } else if (e.t === 'texte' && e.txt && sansAccent(e.txt)) {
      /* un texte qui ne survit pas à la translittération (arabe, cyrillique…)
         n'est pas écrit du tout : mieux vaut rien qu'une chaîne vide */
      const h = e.h || 2;
      l.push(couple(0, 'TEXT'), couple(8, calque),
        couple(10, fmt(e.pos[0])), couple(20, fmt(e.pos[1])), couple(30, fmt(z)),
        couple(40, fmt(h)), couple(1, sansAccent(e.txt)), couple(50, e.angle || 0),
        couple(72, e.align === 'center' ? 1 : 0));
      /* avec un alignement, DXF attend le point d'insertion dans les codes 11/21 */
      if (e.align === 'center')
        l.push(couple(11, fmt(e.pos[0])), couple(21, fmt(e.pos[1])), couple(31, fmt(z)));
    }
  }
  l.push(couple(0, 'ENDSEC'), couple(0, 'EOF'));
  return l.join('');
}

/* ─────────────────────────── plan topographique (entités) ─────────────────────────── */

/* Même lecture de la grille d'altitudes que les analyses « topographie »,
   « pente & exposition » et « trame de terrain » ; y ajoute la géométrie. */
export function grilleTerrain(ctx) {
  const t = ctx && ctx.terrain;
  if (!t || !Array.isArray(t.grid) || !t.grid.length) return null;
  const n = t.grid.length;
  let min = Infinity, max = -Infinity;
  for (const r of t.grid) for (const v of r) { if (v < min) min = v; if (v > max) max = v; }
  return { grid: t.grid, n, min, max, range: max - min || 1, lat: t.lat, lon: t.lon, rayon: t.radius || ctx.curR };
}

/* Équidistance : celle demandée, sinon ~10 lignes sur l'amplitude, arrondie à
   une valeur ronde (… 1, 2, 5, 10, 20 …). */
export function equidistance(range, demandee) {
  if (demandee > 0) return demandee;
  const brut = range / 10, base = Math.pow(10, Math.floor(Math.log10(Math.max(0.1, brut))));
  for (const m of [1, 2, 5, 10]) if (brut <= m * base) return +(m * base).toFixed(3);
  return +(10 * base).toFixed(3);
}

/* Courbes de niveau sur la grille, en mètres locaux, avec leur altitude
   (la fonction de tracé vient du noyau : `FMEngine.contours`, marching squares). */
export function courbesDeNiveau(T, equi, noyau) {
  const E = noyau || globalThis.FMEngine;
  if (!E || !E.contours) throw new Error('NOYAU_ABSENT');
  const { grid, n, min, max, rayon } = T;
  const cote = 2 * rayon / (n - 1);                      // pas de la grille, en mètres
  const demi = (n - 1) / 2;
  const out = [];
  for (let niveau = Math.ceil(min / equi) * equi; niveau < max; niveau += equi) {
    const lvl = Math.round(niveau * 1000) / 1000;
    for (const ligne of E.contours(grid, n, lvl)) {
      const pts = ligne.map(([i, j]) => [(i - demi) * cote, (demi - j) * cote]);   // j croît vers le sud
      if (pts.length > 1) out.push({ niveau: lvl, pts });
    }
  }
  return out;
}

/* Anneau utilisable : doublons consécutifs et point de fermeture retirés (la
   polyligne DXF est déclarée fermée), au moins trois sommets distincts.
   `projeter` reçoit un couple (x, y) et renvoie un couple : par défaut, les
   points sont déjà en mètres et sont pris tels quels. */
export function anneauPropre(pts, projeter) {
  const f = projeter || ((x, y) => [x, y]);
  const out = [];
  for (const p of pts) {
    const q = f(p[0], p[1]);
    const d = out[out.length - 1];
    if (!d || Math.hypot(q[0] - d[0], q[1] - d[1]) > 0.01) out.push(q);
  }
  while (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= 0.01) out.pop();
  return out.length >= 3 ? out : null;
}

/* Découpe une polyligne par le disque de rayon R centré sur l'origine :
   ne reviennent que les morceaux situés dans l'emprise. Un tracé qui sort du
   site est donc arrêté à la limite, au lieu de continuer sur des kilomètres —
   c'est ce qu'on attend d'un plan de site. */
export function recadrer(pts, R) {
  const dedans = (x, y) => x * x + y * y <= R * R;
  /* part du segment [p, q] comprise dans le disque, en paramètre t ∈ [0, 1] */
  const morceaux = (p, q) => {
    const dx = q[0] - p[0], dy = q[1] - p[1];
    const a = dx * dx + dy * dy;
    const dedansT = t => dedans(p[0] + t * dx, p[1] + t * dy);
    if (a < 1e-12) return dedansT(0) ? [[0, 1]] : [];
    const b = 2 * (p[0] * dx + p[1] * dy), c = p[0] * p[0] + p[1] * p[1] - R * R;
    const disc = b * b - 4 * a * c;
    if (disc <= 0) return dedansT(0.5) ? [[0, 1]] : [];
    const s = Math.sqrt(disc);
    const bornes = [0, 1, (-b - s) / (2 * a), (-b + s) / (2 * a)]
      .filter(t => t >= 0 && t <= 1).sort((x, y) => x - y);
    const out = [];
    for (let k = 0; k + 1 < bornes.length; k++) {
      if (bornes[k + 1] - bornes[k] < 1e-9) continue;
      if (dedansT((bornes[k] + bornes[k + 1]) / 2)) out.push([bornes[k], bornes[k + 1]]);
    }
    return out;
  };
  const res = [];
  let courant = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i], q = pts[i + 1];
    const pieces = morceaux(p, q);
    for (const [t0, t1] of pieces) {
      const a = [p[0] + (q[0] - p[0]) * t0, p[1] + (q[1] - p[1]) * t0];
      const b = [p[0] + (q[0] - p[0]) * t1, p[1] + (q[1] - p[1]) * t1];
      if (!courant.length) courant = [a, b];
      else if (Math.hypot(courant[courant.length - 1][0] - a[0], courant[courant.length - 1][1] - a[1]) < 1e-6) courant.push(b);
      else { res.push(courant); courant = [a, b]; }
    }
    /* le segment sort du disque : le morceau en cours est terminé */
    if (!pieces.length && courant.length) { res.push(courant); courant = []; }
  }
  if (courant.length > 1) res.push(courant);
  return res;
}

/* Le plan topographique complet : courbes, bâti, voirie, eau, végétation,
   points d'intérêt, emprise et cartouche.
   o.avec : liste des calques à écrire (par défaut, tous) — les autres sont
   laissés de côté, et leur calque n'est même pas déclaré dans le DXF. */
export function entitesTopo(ctx, o) {
  o = o || {};
  const garde = nom => !o.avec || o.avec.includes(nom);
  const rep = repere(ctx, o);
  const lat0 = ctx.sLat, lon0 = ctx.sLng;
  const cosLat = Math.cos(lat0 * D2R);
  const P = (lat, lon) => rep.vers(...enLocal(lat, lon, lat0, lon0));
  const calques = [
    { nom: 'COURBES', couleur: 'gris' },
    { nom: 'BATI', couleur: 'blanc' },
    { nom: 'VOIRIE', couleur: 'jaune' },
    { nom: 'EAU', couleur: 'cyan' },
    { nom: 'VERT', couleur: 'vert' },
    { nom: 'POI', couleur: 'magenta' },
    { nom: 'EMPRISE', couleur: 'rouge' },
    { nom: 'TEXTE', couleur: 'bleu' }
  ];
  const entites = [];
  const D = (ctx && ctx.D) || {};
  const R = (ctx && ctx.curR) || 600;
  /* Par défaut, on s'en tient à l'emprise : tout tracé qui en sort est coupé à
     la limite (le jeu de données peut couvrir bien plus large que le site). */
  const recadre = o.recadrer !== false;
  const dans = pts => (recadre ? recadrer(pts, R) : [pts]);
  /* Hauteur portée par les emprises dont l'altimétrie métrique manque : 9 m,
     la valeur par défaut du moteur 3D (H_DEFAUT) — le service, lui, écrit 6 m. */
  const hauteurBati = o.hauteurBati > 0 ? o.hauteurBati : 9;

  /* Courbes de niveau — l'altitude du tracé est celle de la courbe */
  const T = grilleTerrain(ctx);
  let equi = 0, nbCourbes = 0;
  if (T) {
    equi = equidistance(T.range, o.equidistance);
    for (const c of courbesDeNiveau(T, equi, o.noyau)) {
      if (!garde('COURBES')) continue;
      for (const morceau of dans(c.pts))
        entites.push({ t: 'poly', calque: 'COURBES', pts: morceau.map(([x, y]) => rep.vers(x, y)), z: c.niveau });
      nbCourbes++;
    }
  }

  /* Bâti — emprises fermées, à l'altitude de leur hauteur : un lecteur CAO
     peut les extruder d'un seul geste (même convention que le service). */
  for (const b of garde('BATI') ? D.build || [] : []) {
    const local = (b.g || []).map(([lat, lon]) => enLocal(lat, lon, lat0, lon0));
    if (local.length < 3) continue;
    const z = Number(b.h) > 0 ? Number(b.h) : hauteurBati;
    /* Anneau refermé sur lui-même avant découpage : un bâtiment à cheval sur
       la limite laisse alors sa part intérieure, fermée sur la corde. */
    const morceaux = recadre ? recadrer([...local, local[0]], R) : [local];
    let entier = false;
    for (const m of morceaux) {
      const anneau = anneauPropre(m);
      const pts = anneau || m;
      if (pts.length < 3) continue;
      entier = entier || (anneau && m.length === local.length + 1);
      entites.push({ t: 'poly', calque: 'BATI', pts: pts.map(([x, y]) => rep.vers(x, y)), ferme: !!anneau, z });
    }
    /* Cours intérieures : anneaux fermés à l'intérieur de l'emprise (ils ne
       sont écrits que si l'emprise du bâtiment est restée entière). */
    if (entier) for (const t of b.trous || []) {
      const h = anneauPropre((t || []).map(([lat, lon]) => enLocal(lat, lon, lat0, lon0)));
      if (h) entites.push({ t: 'poly', calque: 'BATI', pts: h.map(([x, y]) => rep.vers(x, y)), ferme: true, z });
    }
  }

  /* Voirie — une polyligne par tronçon */
  for (const r of garde('VOIRIE') ? D.roads || [] : []) {
    if (!r.g || r.g.length < 2) continue;
    for (const morceau of dans(r.g.map(([lat, lon]) => enLocal(lat, lon, lat0, lon0))))
      entites.push({ t: 'poly', calque: 'VOIRIE', pts: morceau.map(([x, y]) => rep.vers(x, y)) });
  }

  /* Eau et végétation (le jeu normalisé les range ensemble, `k === 'w'` = eau) */
  for (const x of D.green || []) {
    if (!x.g || x.g.length < 3) continue;
    const calque = x.k === 'w' ? 'EAU' : 'VERT';
    if (!garde(calque)) continue;
    const local = x.g.map(([lat, lon]) => enLocal(lat, lon, lat0, lon0));
    if (recadre) {
      for (const morceau of recadrer(local, R)) {
        const anneau = anneauPropre(morceau);
        entites.push({ t: 'poly', calque, pts: anneau ? anneau.map(([x, y]) => rep.vers(x, y)) : morceau.map(([x, y]) => rep.vers(x, y)), ferme: !!anneau });
      }
    } else {
      entites.push({ t: 'poly', calque, pts: local.map(([x, y]) => rep.vers(x, y)), ferme: true });
    }
  }

  /* Points d'intérêt : le point, et son nom s'il en a un */
  for (const q of garde('POI') ? D.pois || [] : []) {
    const lat = q.lat ?? q.y, lon = q.lon ?? q.x;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const [x, y] = enLocal(lat, lon, lat0, lon0);
    if (recadre && Math.hypot(x, y) > R) continue;
    const pos = rep.vers(x, y);
    entites.push({ t: 'point', calque: 'POI', pos });
    /* Les noms sur le plan sont utiles à la marge : ils sont donc facultatifs
       (o.nomsPoi), et vivent sur le calque POI — couper le calque les coupe. */
    const nom = q.nom || q.name || q.n;
    if (nom && o.nomsPoi) entites.push({ t: 'texte', calque: 'POI', pos, h: Math.max(2, R / 250), txt: nom });
  }

  /* Emprise étudiée */
  const cercle = [];
  for (let k = 0; garde('EMPRISE') && k <= 64; k++) {
    const a = k / 64 * Math.PI * 2;
    cercle.push(rep.vers(Math.cos(a) * R, Math.sin(a) * R));
  }
  entites.push({ t: 'poly', calque: 'EMPRISE', pts: cercle });

  /* Cartouche : sous l'emprise, comme un plan de présentation — de quoi lire
     le dessin sans le logiciel */
  const [x0, y0] = rep.vers(-R, -(R + R * 0.04));
  const haut = R * 0.018;
  const cartouche = [
    (o.titre || 'Freemap') + ' - plan topographique',
    (ctx && ctx.siteName ? ctx.siteName + ' - ' : '') +
      (T ? T.min.toFixed(1) + ' a ' + T.max.toFixed(1) + ' m' : 'altimetrie absente'),
    'Equidistance ' + (equi || '-') + ' m ; ' + nbCourbes + ' courbes ; bati ' +
      entites.filter(e => e.calque === 'BATI').length + ' emprises',
    'Repere : ' + rep.note,
    'Donnees (c) OpenStreetMap (ODbL) - relief Terrarium'
  ];
  if (garde('TEXTE')) cartouche.forEach((txt, k) => entites.push({
    t: 'texte', calque: 'TEXTE', h: haut, pos: [x0, y0 - k * haut * 2], txt
  }));

  /* on ne déclare que les calques réellement écrits */
  const utilises = new Set(entites.map(e => e.calque));
  return {
    entites, calques: calques.filter(c => utilises.has(c.nom)), calquesTous: calques,
    equi, courbes: nbCourbes, repere: rep, min: T ? T.min : null, max: T ? T.max : null
  };
}

/* Le DXF du plan topographique, prêt à télécharger.
   `entites` est la liste (pour l'aperçu), `nbEntites` le compte. */
export function dxfTopo(ctx, o) {
  o = o || {};
  const r = entitesTopo(ctx, o);
  return {
    dxf: dxf(r.entites, r.calques, { titre: o.titre || (ctx && ctx.siteName) || 'Freemap' }),
    entites: r.entites, nbEntites: r.entites.length,
    calques: r.calques, calquesTous: r.calquesTous, courbes: r.courbes,
    equidistance: r.equi, repere: r.repere, min: r.min, max: r.max
  };
}

/* ─────────────────────────── OBJ et STL : la maquette 3D ─────────────────────────── */

/* Triangule une face quelconque (éventail autour du premier sommet).
   Les anneaux OSM se referment sur leur premier point : sans le retirer, le
   dernier triangle serait plat — donc sans normale (0,0,0) dans le STL. */
export function triangles(pts) {
  const p = pts.filter((v, i) => i === 0 || Math.hypot(v[0] - pts[i - 1][0], v[1] - pts[i - 1][1], v[2] - pts[i - 1][2]) > 1e-9);
  if (p.length > 3 && Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1], p[0][2] - p[p.length - 1][2]) < 1e-9) p.pop();
  const out = [];
  for (let i = 1; i < p.length - 1; i++) out.push([p[0], p[i], p[i + 1]]);
  return out;
}

/* Scène 3D (`scene()` de vue3d.js) → maillage à écrire.
   Le sol vient du maillage du relief (`maille`), le bâti des faces : chacune
   porte sa géométrie 3D dans `pts3` (mètres locaux, Z vers le haut). Les deux
   sont relatifs à `terrainRef`, l'altitude vraie du zéro local : on l'ajoute
   pour écrire des altitudes absolues, lisibles sur un plan. */
export function maillageDeScene(sc, o) {
  o = o || {};
  const base = o.altitudeBase !== undefined ? o.altitudeBase
    : (Number.isFinite(sc && sc.terrainRef) ? sc.terrainRef : 0);
  const sommets = [], faces = [];
  /* Un anneau OSM se referme sur son premier point : on l'écarte (sinon la
     face OBJ se répète et la triangulation STL produit un triangle plat). */
  const propre = poly => (poly.length > 3 &&
    Math.hypot(poly[0][0] - poly[poly.length - 1][0], poly[0][1] - poly[poly.length - 1][1],
      poly[0][2] - poly[poly.length - 1][2]) < 1e-9) ? poly.slice(0, -1) : poly;
  const ajoute = (poly, calque) => {
    if (!poly || poly.length < 3) return;
    poly = propre(poly);
    if (poly.length < 3) return;
    const idx = poly.map(pt => {
      sommets.push([pt[0], pt[1], pt[2] + base]);        // altitude absolue
      return sommets.length;                             // OBJ : indices à partir de 1
    });
    faces.push({ pts: idx, calque });
  };
  for (const q of (sc && sc.maille) || []) ajoute(o.sol !== false ? q.pts : null, 'TERRAIN');
  for (const f of (sc && sc.faces) || []) {
    if (f.type === 'pointe' || !f.pts3 || f.pts3.length < 3) continue;
    ajoute(f.pts3, f.type === 'toit' || f.type === 'pan' ? 'TOIT' : 'BATI');
  }
  return { sommets, faces, base };
}

/* Texte OBJ (un seul fichier, groupes par calque). */
export function objDeScene(sc, o) {
  o = o || {};
  const M = maillageDeScene(sc, o);
  const l = ['# Freemap — modele 3D du site',
    '# unites : metres · X est, Y nord, Z altitude (Z vers le haut)',
    '# sol de reference (altitude 0) : ' + M.base.toFixed(2) + ' m',
    '# ' + sansAccent(o.mention || 'donnees © OpenStreetMap (ODbL) · relief Terrarium')];
  for (const v of M.sommets) l.push('v ' + v.map(fmt).join(' '));
  let courant = null;
  for (const f of M.faces) {
    if (f.calque !== courant) { l.push('g ' + f.calque); courant = f.calque; }
    l.push('f ' + f.pts.join(' '));
  }
  return l.join('\n') + '\n';
}

/* Texte STL ASCII (facettes triangulaires, normales calculées). */
export function stlDeScene(sc, o) {
  o = o || {};
  const M = maillageDeScene(sc, o);
  const l = ['solid freemap'];
  for (const f of M.faces) {
    const poly = f.pts.map(i => M.sommets[i - 1]);
    for (const tri of triangles(poly)) {
      const n = normale(tri[0], tri[1], tri[2]);
      l.push('  facet normal ' + n.map(e => e.toExponential(6)).join(' '));
      l.push('    outer loop');
      for (const v of tri) l.push('      vertex ' + v.map(e => e.toExponential(6)).join(' '));
      l.push('    endloop');
      l.push('  endfacet');
    }
  }
  l.push('endsolid freemap');
  return l.join('\n') + '\n';
}

export function normale(a, b, c) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const L = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / L, n[1] / L, n[2] / L];
}

/* ─────────────────────────── aperçus (SVG, sans dépendance) ─────────────────────────── */

/* Couleurs d'aperçu par calque — les mêmes teintes que les analyses 2D. */
const APERCU = {
  COURBES: '#8C7B62', BATI: '#2E2C28', VOIRIE: '#C9A227', EAU: '#5C8FA8',
  VERT: '#7BA05B', POI: '#C0392B', EMPRISE: '#C0392B', TEXTE: '#3D5A80',
  TERRAIN: '#8C7B62', AXE: '#C0392B', SOL: '#D8D2C6'
};

/* Aperçu SVG d'une liste d'entités DXF — de quoi vérifier le plan avant de
   l'ouvrir dans un logiciel. Renvoie { svg, bbox, echelle }. */
export function apercuSVG(entites, o) {
  o = o || {};
  const W = o.largeur || 640, H = o.hauteur || 480, pad = 10;
  const pts = [];
  for (const e of entites) {
    if (e.pts) pts.push(...e.pts);
    else if (e.t === 'ligne') pts.push(e.a, e.b);
    else if (e.pos) pts.push(e.pos);
  }
  if (!pts.length) return { svg: '', bbox: null, echelle: 0 };
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const ech = Math.min((W - pad * 2) / Math.max(1e-6, x1 - x0), (H - pad * 2) / Math.max(1e-6, y1 - y0));
  /* y inversé : en SVG l'axe descend, sur un plan il monte */
  const X = v => (pad + (v - x0) * ech).toFixed(1);
  const Y = v => (H - pad - (v - y0) * ech).toFixed(1);
  let corps = '';
  for (const e of entites) {
    const c = APERCU[String(e.calque || '').toUpperCase()] || '#555';
    const lw = e.calque === 'EMPRISE' || e.calque === 'AXE' ? 1.1 : e.calque === 'TEXTE' ? 0 : 0.7;
    if (e.t === 'poly' && e.pts) {
      const d = 'M' + e.pts.map(p => X(p[0]) + ' ' + Y(p[1])).join('L') + (e.ferme ? 'Z' : '');
      corps += `<path d="${d}" fill="none" stroke="${c}" stroke-width="${lw}"${e.ferme ? ' fill-opacity="0"' : ''}/>`;
    } else if (e.t === 'ligne') {
      corps += `<line x1="${X(e.a[0])}" y1="${Y(e.a[1])}" x2="${X(e.b[0])}" y2="${Y(e.b[1])}" stroke="${c}" stroke-width="${lw}"/>`;
    } else if (e.t === 'point') {
      corps += `<circle cx="${X(e.pos[0])}" cy="${Y(e.pos[1])}" r="1.6" fill="${c}"/>`;
    } else if (e.t === 'texte') {
      corps += `<text x="${X(e.pos[0])}" y="${Y(e.pos[1])}" font-size="${Math.max(6, (e.h || 2) * ech * 0.9).toFixed(1)}" fill="${c}" font-family="sans-serif">${echap(e.txt)}</text>`;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">` +
    `<rect width="${W}" height="${H}" fill="#FBF9F5"/>${corps}</svg>`;
  return { svg, bbox: { x0, y0, x1, y1 }, echelle: ech };
}

const echap = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* Aperçu d'une coupe : terrain en profil, bâti traversé, cotes horizontales et
   repères d'altitude. Renvoie { svg, largeur, hauteur }. */
export function coupeSVG(C, o) {
  o = o || {};
  const W = o.largeur || 760, H = o.hauteur || 320;
  const ml = 54, mr = 16, mt = 30, mb = 36;
  const zBas = Math.floor(Math.min(C.zMin, ...C.bati.map(b => Math.min(b.z0, b.z1))) - 2);
  const zHaut = Math.ceil(Math.max(C.zMax, ...C.bati.map(b => Math.max(b.z0, b.z1) + b.h)) + 2);
  const echX = (W - ml - mr) / Math.max(1, C.longueur);
  const echY = (H - mt - mb) / Math.max(1, zHaut - zBas);
  const X = d => ml + d * echX;
  const Y = z => H - mb - (z - zBas) * echY;
  const pasZ = Math.max(1, (zHaut - zBas) / 6);

  let corps = `<rect width="${W}" height="${H}" fill="#FBF9F5"/>`;
  /* cadre, grille d'altitudes, cotes de distance */
  for (let z = Math.ceil(zBas / pasZ) * pasZ; z <= zHaut; z += pasZ) {
    corps += `<line x1="${ml}" y1="${Y(z).toFixed(1)}" x2="${W - mr}" y2="${Y(z).toFixed(1)}" stroke="#E2DCD0" stroke-width="1"/>` +
      `<text x="${ml - 6}" y="${(Y(z) + 3.5).toFixed(1)}" font-size="10" fill="#7A736A" text-anchor="end" font-family="sans-serif">${Math.round(z)} m</text>`;
  }
  const pasD = pasRond(C.longueur / 6);
  for (let d = 0; d <= C.longueur + 1e-6; d += pasD) {
    corps += `<line x1="${X(d).toFixed(1)}" y1="${H - mb}" x2="${X(d).toFixed(1)}" y2="${H - mb + 4}" stroke="#B9B1A5"/>` +
      `<text x="${X(d).toFixed(1)}" y="${H - mb + 16}" font-size="10" fill="#7A736A" text-anchor="middle" font-family="sans-serif">${Math.round(d)}</text>`;
  }
  /* profil du terrain, rempli jusqu'au bas du cadre */
  const ligne = C.pts.map(q => X(q.d).toFixed(1) + ' ' + Y(q.z).toFixed(1));
  corps += `<path d="M${X(C.pts[0].d).toFixed(1)} ${Y(zBas).toFixed(1)}L${ligne.join('L')}L${X(C.longueur).toFixed(1)} ${Y(zBas).toFixed(1)}Z" fill="#EDE7DA"/>` +
    `<path d="M${ligne.join('L')}" fill="none" stroke="#6B5A44" stroke-width="1.6"/>`;
  /* bâti traversé */
  for (const b of C.bati) {
    const z0 = Math.min(b.z0, b.z1);
    const x = X(b.d0), w = Math.max(1, X(b.d1) - X(b.d0)), y = Y(z0 + b.h), h = Math.max(1, Y(z0) - Y(z0 + b.h));
    corps += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="#2E2C28" fill-opacity=".82"/>`;
    /* la cote de hauteur n'est écrite que si le bâtiment a la place de la
       porter : sur un mur d'un mètre, elle déborderait du trait */
    if (h > 14 && w > 26)
      corps += `<text x="${(x + w / 2).toFixed(1)}" y="${(y + 11).toFixed(1)}" font-size="9" fill="#FBF9F5" text-anchor="middle" font-family="sans-serif">${b.h.toFixed(1).replace('.', o.lang === 'en' ? '.' : ',')} m</text>`;
  }
  /* extrémités A et B, sous le sol (en haut, elles heurteraient le titre) */
  corps += `<circle cx="${ml}" cy="${Y(C.pts[0].z).toFixed(1)}" r="3" fill="#C0392B"/>` +
    `<circle cx="${X(C.longueur).toFixed(1)}" cy="${Y(C.pts[C.pts.length - 1].z).toFixed(1)}" r="3" fill="#C0392B"/>` +
    `<text x="${ml}" y="${H - 4}" font-size="11" fill="#C0392B" font-family="sans-serif">A</text>` +
    `<text x="${(W - mr).toFixed(0)}" y="${H - 4}" font-size="11" fill="#C0392B" text-anchor="end" font-family="sans-serif">B</text>`;
  const titre = (o.titre || 'Coupe') + ' · ' + Math.round(C.longueur) + ' m · ' +
    (o.lang === 'en' ? 'elevation ' : 'altitude ') + C.zMin.toFixed(1) + ' – ' + C.zMax.toFixed(1) +
    ' m · ' + C.bati.length + (o.lang === 'en' ? ' buildings' : ' bâtiments') +
    ' · ' + (o.lang === 'en' ? 'over ' : 'sur ') + C.pts.length + (o.lang === 'en' ? ' samples' : ' points');
  corps += `<text x="${ml}" y="16" font-size="11" fill="#2E2C28" font-family="sans-serif">${echap(titre)}</text>`;
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">${corps}</svg>`, largeur: W, hauteur: H };
}

/* Pas « rond » pour les graduations (1, 2, 5, 10, 20, 50…). */
export function pasRond(v) {
  const base = Math.pow(10, Math.floor(Math.log10(Math.max(1e-6, v))));
  for (const m of [1, 2, 5, 10]) if (v <= m * base) return m * base;
  return 10 * base;
}

/* ─────────────────────────── coupe topographique ─────────────────────────── */

/* Altitude interpolée (bilinéaire) dans la grille, bornée aux bords. */
export function altitudeDans(T, lat, lon) {
  if (!T) return 0;
  const { grid, n, lat: lat0, lon: lon0, rayon } = T;
  const dy = rayon / M_LAT, dx = dy / Math.cos((lat0 || 0) * D2R);
  const y = Math.max(0, Math.min(n - 1, (lat0 + dy - lat) / (2 * dy) * (n - 1)));
  const x = Math.max(0, Math.min(n - 1, (lon - (lon0 - dx)) / (2 * dx) * (n - 1)));
  const j = Math.min(n - 2, Math.floor(y)), i = Math.min(n - 2, Math.floor(x));
  const fy = y - j, fx = x - i, g = (a, b) => grid[a][b] || 0;
  return (g(j, i) * (1 - fy) + g(j + 1, i) * fy) * (1 - fx) +
         (g(j, i + 1) * (1 - fy) + g(j + 1, i + 1) * fy) * fx;
}

/* Profil du terrain le long de A → B, échantillonné régulièrement.
   Renvoie { pts: [{ d, lat, lon, z }], longueur, zMin, zMax }. */
export function profilTerrain(ctx, a, b, options) {
  const o = options || {};
  const T = grilleTerrain(ctx);
  const cosLat = Math.cos(ctx.sLat * D2R);
  const dx = (b[1] - a[1]) * M_LAT * cosLat, dy = (b[0] - a[0]) * M_LAT;
  const longueur = Math.hypot(dx, dy);
  const pas = o.pas > 0 ? o.pas : Math.max(2, longueur / 160);
  const pts = [];
  for (let d = 0; d <= longueur + 1e-6; d += pas) {
    const t = longueur ? Math.min(1, d / longueur) : 0;
    const lat = a[0] + (b[0] - a[0]) * t, lon = a[1] + (b[1] - a[1]) * t;
    pts.push({ d, lat, lon, z: altitudeDans(T, lat, lon) });
  }
  /* le dernier point tombe exactement sur B (sans cela, l'axe s'arrête à
     quelques nanomètres du but et les cotes sont bancales) */
  const fin = pts[pts.length - 1];
  if (fin) { fin.d = longueur; fin.lat = b[0]; fin.lon = b[1]; fin.z = altitudeDans(T, b[0], b[1]); }
  const zs = pts.map(q => q.z);
  return { pts, longueur, zMin: Math.min(...zs), zMax: Math.max(...zs), a, b, terrain: T };
}

/* Point du profil à l'abscisse d. */
export function pointAxe(P, d) {
  const t = P.longueur ? d / P.longueur : 0;
  return [P.a[0] + (P.b[0] - P.a[0]) * t, P.a[1] + (P.b[1] - P.a[1]) * t];
}

/* Coupe complète : profil du terrain, et bâti traversé (entrée, sortie,
   hauteur). Un bâtiment est traversé si un de ses murs coupe la droite de la
   coupe — test par changement de signe de l'écart perpendiculaire. */
export function coupe(ctx, a, b, options) {
  const o = options || {};
  const P = profilTerrain(ctx, a, b, o);
  const cosLat = Math.cos(ctx.sLat * D2R);
  const dx = (b[1] - a[1]) * M_LAT * cosLat, dy = (b[0] - a[0]) * M_LAT;
  const L2 = Math.hypot(dx, dy) || 1;
  const ux = dx / L2, uy = dy / L2;
  const hauteurDefaut = o.hauteurBati > 0 ? o.hauteurBati : 9;   // comme la vue 3D
  const bati = [];
  for (const bt of (ctx.D && ctx.D.build) || []) {
    const g = bt.g || [];
    if (g.length < 3) continue;
    const cotes = g.map(([lat, lon]) => {
      const x = (lon - a[1]) * M_LAT * cosLat, y = (lat - a[0]) * M_LAT;
      return { d: x * ux + y * uy, perp: -x * uy + y * ux };      // abscisse, écart signé
    });
    let traverse = false, dMin = Infinity, dMax = -Infinity;
    for (let i = 0; i < cotes.length; i++) {
      const s1 = cotes[i], s2 = cotes[(i + 1) % cotes.length];
      if (s1.perp === 0 || s2.perp === 0 || (s1.perp < 0) !== (s2.perp < 0)) traverse = true;
      dMin = Math.min(dMin, s1.d); dMax = Math.max(dMax, s1.d);
    }
    if (!traverse || dMax < 0 || dMin > L2) continue;
    const d0 = Math.max(0, dMin), d1 = Math.min(L2, dMax);
    if (d1 - d0 < 0.5) continue;
    bati.push({
      d0, d1, h: Number(bt.h) > 0 ? Number(bt.h) : hauteurDefaut,
      nom: bt.nom || '', t: bt.t || 'yes',
      z0: altitudeDans(P.terrain, ...pointAxe(P, d0)),
      z1: altitudeDans(P.terrain, ...pointAxe(P, d1))
    });
  }
  bati.sort((x, y) => x.d0 - y.d0);
  return { ...P, bati };
}

/* DXF de la coupe : terrain en polyligne, bâti en rectangles, abscisse vers
   l'est et altitude vers le nord — un dessin prêt à mettre en page. */
export function dxfCoupe(C, o) {
  o = o || {};
  const calques = [
    { nom: 'TERRAIN', couleur: 'gris' },
    { nom: 'BATI', couleur: 'blanc' },
    { nom: 'AXE', couleur: 'rouge' },
    { nom: 'TEXTE', couleur: 'bleu' }
  ];
  const e = [];
  e.push({ t: 'poly', calque: 'TERRAIN', pts: C.pts.map(q => [q.d, q.z]) });
  for (const b of C.bati) {
    const z0 = Math.min(b.z0, b.z1);
    e.push({
      t: 'poly', calque: 'BATI', ferme: true,
      pts: [[b.d0, z0], [b.d1, z0], [b.d1, z0 + b.h], [b.d0, z0 + b.h]]
    });
  }
  const zAxe = Math.floor(C.zMin - 2);
  e.push({ t: 'poly', calque: 'AXE', pts: [[0, zAxe], [C.longueur, zAxe]] });
  e.push({
    t: 'texte', calque: 'TEXTE', h: Math.max(1, C.longueur / 120), pos: [0, zAxe - 3.5],
    txt: (o.titre || 'Freemap') + ' - coupe ' + Math.round(C.longueur) + ' m ; sol ' +
      C.zMin.toFixed(1) + ' a ' + C.zMax.toFixed(1) + ' m ; ' + C.bati.length + ' batiments traverses'
  });
  return dxf(e, calques, { titre: (o.titre || 'Freemap') + ' coupe' });
}
