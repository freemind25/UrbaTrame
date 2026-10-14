/* Exports : plan DXF, maquette OBJ/STL, coupe topographique.
   Entièrement hors ligne : le jeu d'essai (El Khroub) fournit la grille
   d'altitudes et les emprises bâties ; les cas limites (bâti traversé, hors
   axe) sont fabriqués ici. Les coordonnées UTM sont comparées à des valeurs de
   référence calculées hors du projet (pyproj, EPSG:326xx). */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadKernel, makeCtx, sample } from '../tools/kernel.mjs';
import * as X from '../public/js/exports.mjs';

loadKernel();
const V = globalThis.FMVue3D;
const D2R = Math.PI / 180;
const ctx = makeCtx();

const carre = (lat, lon, cote) => {
  const dy = (cote / 2) / 111320, dx = dy / Math.cos(lat * D2R);
  return [[lat - dy, lon - dx], [lat - dy, lon + dx], [lat + dy, lon + dx], [lat + dy, lon - dx], [lat - dy, lon - dx]];
};
/* Point à `dx` mètres à l'est et `dy` au nord du centre du site. */
const aCote = (dx, dy) => [sample.site.lat + dy / 111320, sample.site.lon + dx / (111320 * Math.cos(sample.site.lat * D2R))];

/* Cap 35° : une caméra plein nord ne verrait qu'un seul mur d'un carré (les
   deux autres sont de profil) — on veut ici de la matière à exporter. */
const camera = () => V.camera({ lat: sample.site.lat, lon: sample.site.lon, rayon: sample.site.R, cap: 35, inclinaison: 42, largeur: 400, hauteur: 400 });
const scene = (batiments) => V.scene(batiments, camera(), { terrain: sample.terrain, palette: 0 });

const compte = (texte, motif) => (texte.match(motif) || []).length;
/* Nombre de sommets d'un anneau une fois le point de fermeture retiré — la
   même règle que l'export, pour compter les sommets d'un fichier OBJ. */
const sommetsAnneau = p => (p.length > 3 &&
  Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1], p[0][2] - p[p.length - 1][2]) < 1e-9)
  ? p.length - 1 : p.length;

/* ── lecture d'un DXF : paires code/valeur, puis entités (comme un lecteur
      minimal : c'est aussi le moyen de vérifier que le fichier est lisible) ── */
function lireDXF(t) {
  const l = t.split('\n');
  const ent = [];
  let cour = null;
  for (let i = 0; i + 1 < l.length; i += 2) {
    const code = l[i], val = l[i + 1];
    if (code === '0') { cour = { type: val, champs: [] }; ent.push(cour); }
    else if (cour) cour.champs.push([code, val]);
  }
  return ent;
}
const champ = (e, code) => (e.champs.find(c => c[0] === code) || [])[1];
const nombre = (e, code) => Number(champ(e, code));
const deType = (ent, type) => ent.filter(e => e.type === type);
/* Polylignes : POLYLINE + VERTEX… jusqu'au SEQEND. */
function polylignes(ent) {
  const out = [];
  let cour = null;
  for (const e of ent) {
    if (e.type === 'POLYLINE') cour = { calque: champ(e, '8'), ferme: champ(e, '70') === '1', z: Number(champ(e, '30')), pts: [] };
    else if (e.type === 'VERTEX' && cour) cour.pts.push([nombre(e, '10'), nombre(e, '20')]);
    else if (e.type === 'SEQEND' && cour) { out.push(cour); cour = null; }
  }
  return out;
}

describe('projection UTM', () => {
  /* Références pyproj : EPSG:32632, 32631, 32756, 32632. */
  const vecteurs = [
    [36.2642, 6.6969, 32, 293104.764, 4015713.156],
    [48.8566, 2.3522, 31, 452482.533, 5411717.177],
    [-33.9, 151.2, 56, 333568.941, 6247473.337],
    [60, 6, 32, 332705.179, 6655205.484],
    [36.2642, 6, 32, 230484.584, 4017428.586]
  ];

  test('les coordonnées UTM correspondent au calcul de référence', () => {
    for (const [lat, lon, zone, e, n] of vecteurs) {
      const u = X.utm(lat, lon);
      assert.equal(u.zone, zone, lat + ',' + lon + ' : zone ' + u.zone);
      assert.equal(u.hemisphere, lat < 0 ? 'S' : 'N');
      assert.ok(Math.abs(u.easting - e) < 0.01, lat + ',' + lon + ' : E ' + u.easting.toFixed(3) + ' (attendu ' + e + ')');
      assert.ok(Math.abs(u.northing - n) < 0.01, lat + ',' + lon + ' : N ' + u.northing.toFixed(3) + ' (attendu ' + n + ')');
    }
  });

  test('sur le méridien central, l’est est exactement à 500 000 m', () => {
    const u = X.utm(0, 3);
    assert.equal(u.zone, 31);
    assert.ok(Math.abs(u.easting - 500000) < 1e-6);
    assert.ok(Math.abs(u.northing) < 1e-6);
  });

  test('le repère local garde les mètres, le repère géoréférencé passe en UTM', () => {
    const local = X.repere(ctx, {});
    assert.equal(local.type, 'local');
    assert.deepEqual(local.vers(0, 0), [0, 0]);
    const utm0 = X.repere(ctx, { geolocate: true });
    assert.equal(utm0.type, 'utm');
    assert.match(utm0.note, /UTM zone 32N/);
    const [x, y] = utm0.vers(0, 0);
    assert.ok(Math.abs(x - 293104.76) < 0.01 && Math.abs(y - 4015713.16) < 0.01, x + ' ' + y);
  });

  test('un décalage de 100 m vers l’est avance de 100 m en UTM', () => {
    const u = X.repere(ctx, { geolocate: true });
    assert.ok(Math.abs(u.vers(100, 0)[0] - u.vers(0, 0)[0] - 100) < 0.01);
  });

  test('la géographie se convertit en mètres locaux, cap au nord', () => {
    const p = X.enLocal(sample.site.lat + 0.001, sample.site.lon + 0.001, sample.site.lat, sample.site.lon);
    assert.ok(Math.abs(p[1] - 111.32) < 0.1, 'nord : ' + p[1].toFixed(2));
    assert.ok(p[0] > 80 && p[0] < 95, 'est : ' + p[0].toFixed(2));
  });
});

describe('écriture DXF', () => {
  const calques = [{ nom: 'A', couleur: 'rouge' }, { nom: 'B', couleur: 3 }];
  const entites = [
    { t: 'poly', calque: 'A', pts: [[0, 0], [10, 0], [10, 10]], z: 3 },
    { t: 'poly', calque: 'B', pts: [[1, 1], [2, 2]], ferme: true },
    { t: 'ligne', calque: 'A', a: [0, 0], b: [5, 5] },
    { t: 'point', calque: 'B', pos: [7, 7] },
    { t: 'texte', calque: 'A', pos: [0, 0], txt: 'Côté sud — église', h: 2, align: 'center' }
  ];
  const t = X.dxf(entites, calques, { titre: 'El Khroub' });
  const ent = lireDXF(t);

  test('l’en-tête annonce la R12, les mètres et le nom du projet', () => {
    /* dans le bloc HEADER, chaque variable est annoncée par un code 9, et sa
       valeur suit immédiatement : c'est ce couple que lit un logiciel CAO */
    const variable = nom => {
      for (const e of ent) {
        const i = e.champs.findIndex(c => c[0] === '9' && c[1] === nom);
        if (i >= 0) return e.champs[i + 1][1];
      }
      return null;
    };
    assert.equal(variable('$ACADVER'), 'AC1009');
    assert.equal(variable('$INSUNITS'), '6');
    assert.equal(variable('$MEASUREMENT'), '1');
    assert.equal(variable('$PROJECTNAME'), 'El Khroub');
  });

  test('chaque calque est déclaré, dans l’ordre', () => {
    const c = deType(ent, 'LAYER');
    assert.deepEqual(c.map(e => champ(e, '2')), ['A', 'B']);
    assert.deepEqual(c.map(e => champ(e, '62')), ['1', '3']);   // rouge = 1, vert = 3
    assert.deepEqual(c.map(e => champ(e, '6')), ['CONTINUOUS', 'CONTINUOUS']);
  });

  test('une POLYLINE par polyligne, un SEQEND pour chacune', () => {
    const p = polylignes(ent);
    assert.equal(deType(ent, 'POLYLINE').length, 2);
    assert.equal(deType(ent, 'SEQEND').length, 2);
    assert.equal(deType(ent, 'VERTEX').length, 5);
    assert.equal(p.length, 2);
    assert.equal(p[0].calque, 'A');
    assert.equal(p[0].ferme, false);
    assert.deepEqual(p[0].pts, [[0, 0], [10, 0], [10, 10]]);
    assert.equal(p[0].z, 3);
    assert.equal(p[1].ferme, true);
  });

  test('ligne, point et texte sont écrits aux bons endroits', () => {
    const l = deType(ent, 'LINE')[0];
    assert.deepEqual([nombre(l, '10'), nombre(l, '20'), nombre(l, '11'), nombre(l, '21')], [0, 0, 5, 5]);
    const po = deType(ent, 'POINT')[0];
    assert.deepEqual([nombre(po, '10'), nombre(po, '20')], [7, 7]);
    const tx = deType(ent, 'TEXT')[0];
    assert.equal(champ(tx, '1'), 'Cote sud - eglise');    // accents retirés, tiret cadratin translittéré
    assert.equal(nombre(tx, '40'), 2);
    assert.equal(champ(tx, '72'), '1');                    // aligné au centre
    assert.equal(nombre(tx, '11'), 0);                     // point d'alignement
  });

  test('le fichier se termine par EOF et ne contient aucune valeur non numérique', () => {
    assert.match(t, /\n0\nEOF\n$/);
    assert.doesNotMatch(t, /NaN|undefined|Infinity|\[object/);
    assert.equal(compte(t, /\nSECTION\n/g), compte(t, /\nENDSEC\n/g));
  });
});

describe('plan topographique DXF', () => {
  const p = X.dxfTopo(ctx, {});
  const ent = lireDXF(p.dxf);

  test('les calques écrits sont ceux du plan, et eux seuls sont déclarés', () => {
    assert.deepEqual(p.calquesTous.map(c => c.nom),
      ['COURBES', 'BATI', 'VOIRIE', 'EAU', 'VERT', 'POI', 'EMPRISE', 'TEXTE']);
    const declares = deType(ent, 'LAYER').map(e => champ(e, '2')).sort();
    assert.deepEqual(declares, p.calques.map(c => c.nom).sort());
    /* El Khroub n'a pas d'eau dans le jeu d'essai : ce calque n'est pas écrit */
    const eau = (ctx.D.green || []).filter(x => x.k === 'w').length;
    assert.equal(deType(ent, 'LAYER').length, eau ? 8 : 7, 'un calque écrit par famille présente');
    if (!eau) assert.ok(!p.calques.some(c => c.nom === 'EAU'), 'pas de calque vide');
    /* et l'on peut n'en garder que quelques-uns */
    const court = X.dxfTopo(ctx, { avec: ['COURBES', 'EMPRISE'] });
    assert.deepEqual(court.calques.map(c => c.nom), ['COURBES', 'EMPRISE']);
    assert.deepEqual(deType(lireDXF(court.dxf), 'LAYER').map(e => champ(e, '2')).sort(), ['COURBES', 'EMPRISE']);
    assert.equal(polylignes(lireDXF(court.dxf)).filter(l => l.calque === 'BATI').length, 0);
  });

  test('les courbes de niveau couvrent l’amplitude à pas rond', () => {
    const T = X.grilleTerrain(ctx);
    assert.ok(p.courbes > 10, 'courbes : ' + p.courbes);
    assert.ok(p.equidistance >= 1 && Number.isInteger(p.equidistance), 'équidistance ' + p.equidistance);
    assert.ok(p.equidistance <= T.range / 4, 'pas trop grossier : ' + p.equidistance);
    assert.ok(p.min >= T.min - 1e-6 && p.max <= T.max + 1e-6);
  });

  test('l’équidistance demandée est respectée, et les courbes portent leur altitude', () => {
    const q = X.dxfTopo(ctx, { equidistance: 5 });
    assert.equal(q.equidistance, 5);
    const c = polylignes(lireDXF(q.dxf)).filter(e => e.calque === 'COURBES');
    assert.ok(c.length > 10, 'courbes : ' + c.length);
    for (const l of c) assert.equal(l.z % 5, 0, 'altitude ' + l.z + ' hors pas de 5 m');
  });

  test('les courbes restent dans l’emprise du relevé', () => {
    const n = sample.terrain.n, rayon = sample.terrain.radius;
    const demi = n / 2 * (2 * rayon / (n - 1)) + 1e-6;
    const c = polylignes(ent).filter(e => e.calque === 'COURBES');
    assert.ok(c.length > 10);
    for (const l of c) {
      assert.ok(l.pts.length > 1);
      for (const [x, y] of l.pts) assert.ok(Math.abs(x) <= demi && Math.abs(y) <= demi, 'point ' + x + ' ' + y + ' hors de ±' + demi.toFixed(0));
    }
  });

  test('les emprises bâties sont fermées et portent leur hauteur', () => {
    const b = polylignes(ent).filter(e => e.calque === 'BATI');
    const source = ctx.D.build || [];
    const R = sample.site.R;
    /* bâtiments entièrement dans l'emprise : un anneau fermé chacun ; ceux
       entièrement dehors sont écartés, ceux à cheval sont coupés */
    const dedans = source.filter(x => x.g.every(([lat, lon]) => {
      const p = X.enLocal(lat, lon, sample.site.lat, sample.site.lon);
      return Math.hypot(p[0], p[1]) <= R;
    }));
    const aCheval = source.length - dedans.length - source.filter(x => x.g.every(([lat, lon]) => {
      const p = X.enLocal(lat, lon, sample.site.lat, sample.site.lon);
      return Math.hypot(p[0], p[1]) > R;
    })).length;
    const fermes = b.filter(e => e.ferme);
    /* un anneau à cheval peut donner plusieurs morceaux fermés (plusieurs
       cordes), jamais moins : on borne par le haut */
    assert.ok(fermes.length >= dedans.length && fermes.length <= dedans.length + 2 * aCheval,
      'emprises : ' + fermes.length + ' pour ' + dedans.length + ' dedans + ' + aCheval + ' à cheval');
    assert.ok(b.every(e => e.pts.length >= 3), 'au moins trois sommets, sans sommet répété');
    assert.ok(b.length < source.length, 'les emprises hors emprise sont écartées');
    /* altitude portée : la hauteur mesurée quand elle existe, 9 m sinon */
    assert.ok(fermes.filter(e => e.z === 9).length > 500, 'emprises à 9 m');
    assert.equal(fermes.filter(e => e.z === 9).length + fermes.filter(e => e.z !== 9).length, fermes.length);
    /* le point de fermeture OSM est retiré : la polyligne est déclarée fermée
       (70 = 1), un sommet de moins que dans la donnée source */
    const i = source.findIndex(x => x.g.length === 5 && Math.hypot(x.g[0][0] - x.g[4][0], x.g[0][1] - x.g[4][1]) < 1e-9);
    assert.ok(i >= 0, 'le jeu d’essai contient bien des anneaux refermés');
    assert.equal(b[i].pts.length, source[i].g.length - 1, 'anneau dédoublé');
  });

  test('l’anneau DXF écarte doublons et point de fermeture', () => {
    assert.equal(X.anneauPropre([[0, 0], [0, 0], [10, 0], [10, 10], [0, 0]]).length, 3);
    assert.equal(X.anneauPropre([[0, 0], [1, 0]]), null, 'deux points : pas une emprise');
    assert.deepEqual(X.anneauPropre([[36, 6], [36, 6.001], [36.001, 6.001]],
      (la, lo) => [Math.round(lo * 1000), Math.round(la * 1000)]),
      [[6000, 36000], [6001, 36000], [6001, 36001]], 'projection appliquée au couple');
  });

  test('les cours intérieures deviennent des anneaux fermés', () => {
    const D = { ...ctx.D, build: [{ h: 20, t: 'yes', g: carre(...aCote(0, 0), 40), trous: [carre(...aCote(0, 0), 10)] }] };
    const b = polylignes(lireDXF(X.dxfTopo({ ...ctx, D }, {}).dxf)).filter(e => e.calque === 'BATI');
    assert.equal(b.length, 2, 'emprise + cour');
    assert.ok(b[1].ferme && b[1].pts.length === 4);
    assert.ok(Math.abs(Math.abs(b[1].pts[1][0] - b[1].pts[0][0]) - 10) < 0.5, 'côté de la cour');
    assert.deepEqual(b.map(e => e.z), [20, 20]);
  });

  test('la hauteur du bâti est réglable (6 m comme le service, 15 m pour deux étages)', () => {
    const compte = h => polylignes(lireDXF(X.dxfTopo(ctx, { hauteurBati: h }).dxf))
      .filter(e => e.calque === 'BATI' && e.z === h).length;
    /* même population d'emprises sans hauteur mesurée dans les deux cas */
    assert.ok(compte(6) > 500, 'emprises à 6 m : ' + compte(6));
    assert.equal(compte(6), compte(15), 'le réglage ne change que la valeur écrite');
  });

  test('le plan s’en tient à l’emprise : rien ne dépasse le cercle', () => {
    const R = sample.site.R;
    for (const l of polylignes(ent).filter(l => l.calque !== 'TEXTE'))
      for (const [x, y] of l.pts)
        assert.ok(l.calque && Math.hypot(x, y) <= R + 0.5, l.calque + ' : ' + Math.hypot(x, y).toFixed(1) + ' m du centre');
    for (const po of deType(ent, 'POINT'))
      assert.ok(Math.hypot(nombre(po, '10'), nombre(po, '20')) <= R + 0.5, 'point hors emprise');
  });

  test('sans recadrage, la donnée va bien au-delà du site', () => {
    const large = polylignes(lireDXF(X.dxfTopo(ctx, { recadrer: false }).dxf));
    const loin = large.filter(l => l.pts.some(([x, y]) => Math.hypot(x, y) > sample.site.R * 1.5)).length;
    assert.ok(loin > 20, 'tracés hors emprise : ' + loin);
  });

  test('voirie, eau, végétation et points d’intérêt suivent le jeu de données', () => {
    const par = c => polylignes(ent).filter(e => e.calque === c).length;
    /* la voirie est découpée à la limite : au moins un morceau par tronçon qui
       entre dans le site, et jamais moins qu'un tronçon sur deux ici */
    const entrees = (ctx.D.roads || []).filter(r => r.g.some(([lat, lon]) => {
      const p = X.enLocal(lat, lon, sample.site.lat, sample.site.lon);
      return Math.hypot(p[0], p[1]) <= sample.site.R;
    })).length;
    assert.ok(par('VOIRIE') >= entrees, 'morceaux de voirie : ' + par('VOIRIE') + ' pour ' + entrees + ' tronçons');
    assert.ok(par('VOIRIE') < (ctx.D.roads || []).length, 'les tracés hors site sont écartés');
    assert.equal(par('EAU'), (ctx.D.green || []).filter(x => x.k === 'w').length);
    assert.equal(par('VERT'), (ctx.D.green || []).filter(x => x.k !== 'w').length);
    const dedans = (ctx.D.pois || []).filter(q => {
      const p = X.enLocal(q.y ?? q.lat, q.x ?? q.lon, sample.site.lat, sample.site.lon);
      return Math.hypot(p[0], p[1]) <= sample.site.R;
    }).length;
    assert.equal(deType(ent, 'POINT').length, dedans, 'POI dans l’emprise : ' + dedans);
    assert.equal(deType(ent, 'TEXT').length, 5, 'le cartouche seul, sans les noms de POI');
    assert.equal(deType(ent, 'TEXT').filter(t => champ(t, '8') === 'POI').length, 0, 'aucun nom par défaut');
    for (const t of deType(ent, 'TEXT')) assert.ok(nombre(t, '20') < -sample.site.R, 'cartouche sous l’emprise');
  });

  test('les noms de POI sont facultatifs et vivent sur leur calque', () => {
    const R = sample.site.R;
    const noms = (ctx.D.pois || []).filter(q => {
      const p = X.enLocal(q.y, q.x, sample.site.lat, sample.site.lon);
      return Math.hypot(p[0], p[1]) <= R && X.sansAccent(q.n || '') !== '';
    });
    const textes = deType(lireDXF(X.dxfTopo(ctx, { nomsPoi: true }).dxf), 'TEXT');
    const nomsEcrits = textes.filter(t => champ(t, '8') === 'POI');
    /* les noms que la R12 ne sait pas écrire (arabe, cyrillique…) sont écartés */
    assert.equal(nomsEcrits.length, noms.length, 'noms écrits : ' + nomsEcrits.length + ' sur ' + noms.length + ' lisibles');
    assert.ok(textes.length - nomsEcrits.length === 5, 'le cartouche reste seul : ' + (textes.length - nomsEcrits.length));
    assert.ok(nomsEcrits.some(t => /[A-Za-z]{3}/.test(champ(t, '1'))), 'des noms lisibles');
  });

  test('l’emprise est un anneau fermé de rayon curR', () => {
    const e = polylignes(ent).find(p2 => p2.calque === 'EMPRISE');
    assert.equal(e.ferme, false);
    assert.equal(e.pts.length, 65);
    const r = Math.hypot(e.pts[0][0], e.pts[0][1]);
    assert.ok(Math.abs(r - sample.site.R) < 0.5, 'rayon ' + r.toFixed(1));
    assert.deepEqual(e.pts[0], e.pts[e.pts.length - 1], 'anneau refermé');
  });

  test('le repère géoréférencé décale tous les points en UTM', () => {
    const u = X.utm(sample.site.lat, sample.site.lon);
    const g = polylignes(lireDXF(X.dxfTopo(ctx, { geolocate: true }).dxf));
    const pts = g.flatMap(l => l.pts);
    assert.ok(pts.length > 200);
    /* le jeu d'essai est un relevé large : il déborde du site. On borne donc à
       4 km, et c'est le cercle d'emprise qui doit tenir dans le rayon demandé. */
    for (const [x, y] of pts) {
      assert.ok(Math.abs(x - u.easting) < 4000, 'X ' + x);
      assert.ok(Math.abs(y - u.northing) < 4000, 'Y ' + y);
    }
    for (const [x, y] of g.find(l => l.calque === 'EMPRISE').pts)
      assert.ok(Math.hypot(x - u.easting, y - u.northing) <= sample.site.R + 0.5, 'cercle du site');
    /* ordres de grandeur du fuseau 32 nord (est ≈ 293 000, nord ≈ 4 015 000) */
    assert.ok(pts.every(([x]) => x >= 100000 && x < 900000), 'est en mètres UTM');
    assert.ok(pts.every(([, y]) => y >= 3900000 && y < 4200000), 'nord en mètres UTM');
    assert.ok(pts.some(([x]) => x > 292000 && x < 294000), 'le site est bien à l’est de Constantine');
  });

  test('le cartouche nomme le site, l’équidistance et les sources', () => {
    const textes = deType(ent, 'TEXT').map(e => champ(e, '1'));
    assert.ok(textes.some(t => /plan topographique/.test(t)), JSON.stringify(textes));
    assert.ok(textes.some(t => /Equidistance \d+ m ; \d+ courbes ; bati \d+ emprises/.test(t)), JSON.stringify(textes));
    assert.ok(textes.some(t => /OpenStreetMap/.test(t)));
    assert.ok(textes.some(t => /Terrarium/.test(t)));
    assert.ok(textes.some(t => /El Khroub/.test(t)));
  });

  test('le plan ne modifie pas le jeu de données', () => {
    const avant = JSON.stringify(ctx.D);
    X.dxfTopo(ctx, { geolocate: true });
    X.dxfTopo(ctx, { hauteurBati: 15 });
    assert.equal(JSON.stringify(ctx.D), avant);
  });
});

describe('aperçu SVG des entités', () => {
  const p = X.entitesTopo(ctx, {});
  const a = X.apercuSVG(p.entites, {});

  test('chaque entité devient un élément, aucun NaN', () => {
    assert.match(a.svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 640 480"/);
    assert.equal(compte(a.svg, /<(path|line) /g), p.entites.filter(e => e.t === 'poly' || e.t === 'ligne').length);
    assert.equal(compte(a.svg, /<circle /g), p.entites.filter(e => e.t === 'point').length);
    assert.equal(compte(a.svg, /<text /g), p.entites.filter(e => e.t === 'texte').length);
    assert.doesNotMatch(a.svg, /NaN|undefined/);
  });

  test('les couleurs suivent les calques, l’inconnu reste lisible', () => {
    assert.match(a.svg, /stroke="#8C7B62"/);                        // courbes
    assert.match(a.svg, /stroke="#C0392B"/);                        // emprise
    const q = X.apercuSVG([{ t: 'poly', calque: 'ZZ', pts: [[0, 0], [1, 1]] }], {});
    assert.match(q.svg, /stroke="#555"/);
  });

  test('le cadre contient tout le plan et respecte l’orientation (Y vers le nord)', () => {
    assert.ok(a.echelle > 0);
    const { x0, y0, x1, y1 } = a.bbox;
    assert.ok(x1 - x0 > 1000 && y1 - y0 > 1000, 'amplitude du plan : ' + (x1 - x0).toFixed(0) + ' m');
    const bat = p.entites.find(e => e.t === 'poly' && e.calque === 'BATI');
    const nord = bat.pts.reduce((m, q) => (q[1] > m[1] ? q : m));
    /* le point le plus au nord du bâti se projette plus haut que le plus au sud */
    const Y = v => 480 - 10 - (v - y0) * a.echelle;
    const sud = bat.pts.reduce((m, q) => (q[1] < m[1] ? q : m));
    assert.ok(Y(nord[1]) < Y(sud[1]));
    assert.ok(Y(nord[1]) >= 9 && Y(sud[1]) <= 471);
  });

  test('une entité vide ne produit pas d’aperçu', () => {
    assert.deepEqual(X.apercuSVG([], {}), { svg: '', bbox: null, echelle: 0 });
  });
});

describe('coupe topographique', () => {
  const A = aCote(-500, 0), B = aCote(500, 0);              // ouest → est, 1 000 m
  const T = X.grilleTerrain(ctx);

  test('la longueur et l’échantillonnage sont ceux de l’axe', () => {
    const P = X.profilTerrain(ctx, A, B, {});
    assert.ok(Math.abs(P.longueur - 1000) < 0.5, 'longueur ' + P.longueur.toFixed(2));
    assert.equal(P.pts.length, 161);
    assert.ok(Math.abs(P.pts[80].d - 500) < 5);
    assert.ok(Math.abs(P.pts[0].lon - A[1]) < 1e-9 && Math.abs(P.pts[160].lat - B[0]) < 1e-9);
    assert.ok(Math.abs(P.pts[0].lat - sample.site.lat) < 1e-6, 'axe est-ouest : latitude constante');
    assert.equal(P.pts[P.pts.length - 1].d, P.longueur, 'le dernier point tombe exactement sur B');
  });

  test('les abscisses croissent et les altitudes restent dans la grille', () => {
    const P = X.profilTerrain(ctx, A, B, {});
    for (let i = 1; i < P.pts.length; i++) assert.ok(P.pts[i].d > P.pts[i - 1].d);
    const min = Math.min(...sample.terrain.grid.flat()), max = Math.max(...sample.terrain.grid.flat());
    assert.ok(P.zMin >= min - 1e-9 && P.zMax <= max + 1e-9, P.zMin + ' – ' + P.zMax + ' hors ' + min + ' – ' + max);
    assert.ok(P.zMin >= T.min - 1e-6 && P.zMax <= T.max + 1e-6);
  });

  test('les extrémités du profil valent l’altitude bilinéaire', () => {
    const P = X.profilTerrain(ctx, A, B, {});
    assert.ok(Math.abs(P.pts[0].z - X.altitudeDans(T, A[0], A[1])) < 1e-9);
    const d = P.pts[P.pts.length - 1];
    assert.ok(Math.abs(d.z - X.altitudeDans(T, B[0], B[1])) < 1e-9);
  });

  test('hors de la grille, l’altitude est bornée (pas de débordement)', () => {
    const loin = X.altitudeDans(T, sample.site.lat + 5, sample.site.lon + 5);
    assert.ok(Number.isFinite(loin) && loin >= T.min && loin <= T.max);
    assert.equal(X.altitudeDans(null, A[0], A[1]), 0);
  });

  test('le bâti traversé est relevé, le reste écarté', () => {
    const batiments = [
      { h: 12, t: 'house', g: carre(sample.site.lat, sample.site.lon, 20) },                       // sur l'axe
      { h: 0, t: 'yes', g: carre(sample.site.lat + 200 / 111320, sample.site.lon, 20) },           // 200 m au nord
      { h: 25, t: 'apartments', g: carre(...aCote(2000, 0), 20) }                                 // au-delà de B
    ];
    const C = X.coupe({ ...ctx, D: { ...ctx.D, build: batiments } }, A, B, {});
    assert.equal(C.bati.length, 1, JSON.stringify(C.bati));
    const b = C.bati[0];
    assert.equal(b.h, 12);
    assert.equal(b.t, 'house');
    assert.ok(b.d0 < 500 && b.d1 > 500, 'entrée/sortie autour du milieu : ' + b.d0.toFixed(1) + ' → ' + b.d1.toFixed(1));
    assert.ok(Math.abs((b.d1 - b.d0) - 20) < 2.5, 'largeur traversée ' + (b.d1 - b.d0).toFixed(1));
    const p0 = X.pointAxe(C, b.d0), p1 = X.pointAxe(C, b.d1);
    assert.ok(Math.abs(b.z0 - X.altitudeDans(T, p0[0], p0[1])) < 1e-9, 'sol à l’entrée');
    assert.ok(Math.abs(b.z1 - X.altitudeDans(T, p1[0], p1[1])) < 1e-9, 'sol à la sortie');
  });

  test('un bâtiment sans hauteur prend 9 m, la valeur du moteur 3D', () => {
    const D = { ...ctx.D, build: [{ h: 0, t: 'yes', g: carre(sample.site.lat, sample.site.lon, 30) }] };
    const C = X.coupe({ ...ctx, D }, A, B, {});
    assert.equal(C.bati[0].h, 9);
    assert.equal(X.coupe({ ...ctx, D }, A, B, { hauteurBati: 15 }).bati[0].h, 15);
  });

  test('le bâti est classé le long de l’axe', () => {
    const batiments = [
      { h: 6, t: 'yes', g: carre(...aCote(100, 0), 20) },
      { h: 6, t: 'yes', g: carre(...aCote(-100, 0), 20) },
      { h: 6, t: 'yes', g: carre(...aCote(300, 0), 20) }
    ];
    const C = X.coupe({ ...ctx, D: { ...ctx.D, build: batiments } }, A, B, {});
    assert.equal(C.bati.length, 3);
    assert.ok(C.bati[0].d0 < C.bati[1].d0 && C.bati[1].d0 < C.bati[2].d0);
    assert.ok(Math.abs(C.bati[0].d0 - 390) < 3 && Math.abs(C.bati[2].d0 - 790) < 3,
      C.bati.map(b => b.d0.toFixed(0)).join(' '));
  });

  test('sur le relevé complet, la coupe relève les bâtiments de la ville', () => {
    const C = X.coupe(ctx, A, B, {});
    assert.ok(C.bati.length >= 3, 'bâtiments traversés : ' + C.bati.length);
    for (const b of C.bati) {
      assert.ok(b.d0 >= 0 && b.d1 <= C.longueur && b.d1 > b.d0);
      assert.ok(b.h >= 1 && b.h <= 200);
      assert.ok(b.z0 >= T.min - 1e-6 && b.z1 <= T.max + 1e-6);
    }
  });

  test('sans altimétrie, la coupe reste traçable (sol à zéro) et ne lève pas', () => {
    const sans = X.coupe({ ...ctx, terrain: null }, A, B, {});
    assert.equal(sans.zMin, 0);
    assert.equal(sans.zMax, 0);
    assert.ok(sans.pts.every(q => q.z === 0));
    assert.ok(sans.bati.length > 0 && sans.bati.every(b => Number.isFinite(b.z0)));
  });

  test('le profil se relit en DXF : terrain, bâti, axe', () => {
    const batiments = [{ h: 12, t: 'house', g: carre(sample.site.lat, sample.site.lon, 20) }];
    const C = X.coupe({ ...ctx, D: { ...ctx.D, build: batiments } }, A, B, {});
    const ent = lireDXF(X.dxfCoupe(C, { titre: 'El Khroub' }));
    const p = polylignes(ent);
    assert.deepEqual(p.map(l => l.calque), ['TERRAIN', 'BATI', 'AXE']);
    assert.equal(p[0].pts.length, C.pts.length);
    for (let i = 0; i < p[0].pts.length; i++) {
      assert.ok(Math.abs(p[0].pts[i][0] - C.pts[i].d) < 0.001, 'abscisse ' + i);
      assert.ok(Math.abs(p[0].pts[i][1] - C.pts[i].z) < 0.001, 'altitude ' + i);
    }
    const b = p[1];
    assert.equal(b.ferme, true);
    assert.equal(b.pts.length, 4);
    assert.ok(Math.abs(b.pts[1][0] - b.pts[0][0] - 20) < 2.5, 'largeur du bâtiment : ' + (b.pts[1][0] - b.pts[0][0]).toFixed(1));
    assert.ok(Math.abs((b.pts[3][1] - b.pts[0][1]) - 12) < 0.01, 'hauteur du bâtiment');
    assert.equal(p[2].pts.length, 2, 'ligne d’axe');
    const textes = deType(ent, 'TEXT').map(e => champ(e, '1'));
    assert.ok(textes.some(t => /El Khroub - coupe \d+ m ; sol [\d.]+ a [\d.]+ m ; 1 batiments traverses/.test(t)), JSON.stringify(textes));
    assert.deepEqual(deType(ent, 'LAYER').map(e => champ(e, '2')), ['TERRAIN', 'BATI', 'AXE', 'TEXTE']);
  });

  test('l’aperçu de la coupe dessine le fond et un rectangle par bâtiment', () => {
    const batiments = [{ h: 12, t: 'house', g: carre(sample.site.lat, sample.site.lon, 20) }];
    const C = X.coupe({ ...ctx, D: { ...ctx.D, build: batiments } }, A, B, {});
    const s = X.coupeSVG(C, { titre: 'El Khroub', lang: 'fr' });
    assert.equal(compte(s.svg, /<rect /g), 1 + C.bati.length);
    assert.match(s.svg, /El Khroub · 1000 m · altitude [\d.]+ – [\d.]+ m · 1 bâtiments · sur \d+ points/);
    assert.match(s.svg, />A</);
    assert.match(s.svg, />B</);
    assert.doesNotMatch(s.svg, /NaN|undefined/);
    assert.equal(s.largeur, 760);
  });

  test('le pas des graduations reste rond', () => {
    assert.equal(X.pasRond(1000 / 6), 200);
    assert.equal(X.pasRond(7), 10);
    assert.equal(X.pasRond(3.2), 5);
  });
});

describe('maquette 3D : OBJ et STL', () => {
  const batiments = [
    { h: 18, t: 'apartments', g: carre(...aCote(0, 0), 24) },
    { h: 0, t: 'house', g: carre(...aCote(120, 60), 16) }
  ];
  const sc = scene(batiments);

  test('la scène porte la géométrie 3D des faces (pts3) et l’altitude de référence', () => {
    assert.ok(sc.faces.filter(f => f.type === 'mur').length >= 4, 'murs : ' + sc.faces.length);
    assert.equal(sc.faces.filter(f => f.type === 'toit').length, 2, 'un toit plat par bâtiment');
    assert.equal(sc.faces.filter(f => f.type === 'pointe').length, 0, 'aucun toit en pointe ici');
    for (const f of sc.faces) {
      if (f.type === 'pointe') { assert.equal(f.pts3, undefined); continue; }
      assert.ok(Array.isArray(f.pts3) && f.pts3.length >= 3, f.type + ' sans pts3');
      for (const p of f.pts3) assert.ok(p.every(Number.isFinite), f.type + ' : ' + p);
    }
    assert.ok(Number.isFinite(sc.terrainRef));
    assert.equal(sc.grille, sample.terrain);
  });

  test('le maillage reprend le sol et le bâti, en altitudes absolues', () => {
    const M = X.maillageDeScene(sc, {});
    const quads = sc.maille.length;
    const ptsBati = sc.faces.filter(f => f.type !== 'pointe').reduce((s, f) => s + sommetsAnneau(f.pts3), 0);
    assert.equal(M.sommets.length, quads * 4 + ptsBati);
    assert.equal(M.faces.length, quads + sc.faces.filter(f => f.type !== 'pointe').length);
    assert.equal(M.faces.filter(f => f.calque === 'TERRAIN').length, quads);
    assert.ok(Math.abs(M.base - sc.terrainRef) < 1e-9);
    const z = M.sommets.map(v => v[2]);
    const min = Math.min(...sample.terrain.grid.flat()), max = Math.max(...sample.terrain.grid.flat());
    assert.ok(Math.min(...z) >= min - 1 && Math.max(...z) <= max + 20,
      'Z ' + Math.min(...z).toFixed(1) + ' – ' + Math.max(...z).toFixed(1));
    assert.ok(Math.max(...z) > X.altitudeDans(X.grilleTerrain(ctx), sample.site.lat, sample.site.lon) + 15, 'toits au-dessus du sol');
  });

  test('le maillage du sol couvre le site et sa couronne, centré sur l’origine', () => {
    const M = X.maillageDeScene(sc, {});
    const sol = M.faces.filter(f => f.calque === 'TERRAIN').flatMap(f => f.pts.map(i => M.sommets[i - 1]));
    const xs = sol.map(v => v[0]), ys = sol.map(v => v[1]);
    const pas = 2 * sample.terrain.radius / (sample.terrain.n - 1);   // 80 m pour le jeu d'essai
    const etendue = 2 * sample.terrain.radius + 2 * V.RELIEF_MARGE * pas;
    assert.ok(Math.abs((Math.max(...xs) - Math.min(...xs)) - etendue) < 1, 'étendue X ' + (Math.max(...xs) - Math.min(...xs)).toFixed(0) + ' m');
    assert.ok(Math.abs(Math.max(...xs) + Math.min(...xs)) < 1, 'centré en X');
    assert.ok(Math.abs(Math.max(...ys) + Math.min(...ys)) < 1, 'centré en Y');
  });

  test('l’OBJ est bien formé : en-tête, sommets, groupes et faces', () => {
    const o = X.objDeScene(sc, {});
    const vs = [...o.matchAll(/^v (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)$/gm)].map(m => m.slice(1).map(Number));
    const fs = [...o.matchAll(/^f ([\d ]+)$/gm)].map(m => m[1].trim().split(/\s+/).map(Number));
    assert.ok(vs.length > 1000, 'sommets : ' + vs.length);
    assert.ok(fs.length > 500, 'faces : ' + fs.length);
    assert.ok(vs.every(v => v.every(Number.isFinite)));
    for (const f of fs) {
      assert.ok(f.length >= 3);
      for (const i of f) assert.ok(i >= 1 && i <= vs.length, 'indice ' + i + ' hors de 1–' + vs.length);
    }
    assert.match(o, /^g TERRAIN$/m);
    assert.match(o, /^g BATI$/m);
    assert.match(o, /^# UrbaTrame — modele 3D du site$/m);
    assert.match(o, /X est, Y nord, Z altitude/);
    assert.match(o, /OpenStreetMap/);
    assert.doesNotMatch(o, /NaN|undefined/);
    const M = X.maillageDeScene(sc, {});
    assert.equal(vs.length, M.sommets.length);
    assert.equal(fs.length, M.faces.length);
    /* aucune face ne répète un sommet : les anneaux OSM sont dédoublonnés */
    for (const f of M.faces) {
      const pts = f.pts.map(i => M.sommets[i - 1]);
      for (let a = 0; a < pts.length; a++)
        for (let b2 = a + 1; b2 < pts.length; b2++)
          assert.ok(Math.hypot(...pts[a].map((v, k) => v - pts[b2][k])) > 1e-9,
            'sommets confondus dans une face ' + f.calque);
    }
  });

  test('l’option sol:false n’écrit que le bâti', () => {
    const M = X.maillageDeScene(sc, { sol: false });
    assert.equal(M.faces.filter(f => f.calque === 'TERRAIN').length, 0);
    assert.ok(M.faces.length > 0);
  });

  test('le STL est bien formé : facettes triangulaires, normales unitaires', () => {
    const s = X.stlDeScene(sc, {});
    assert.match(s, /^solid urbatrame\n/);
    assert.match(s, /\nendsolid urbatrame\n$/);
    const normales = [...s.matchAll(/facet normal (\S+) (\S+) (\S+)\n/g)].map(m => m.slice(1).map(Number));
    const sommets = [...s.matchAll(/      vertex (\S+) (\S+) (\S+)\n/g)].map(m => m.slice(1).map(Number));
    assert.equal(normales.length * 3, sommets.length);
    assert.ok(normales.length > 700, 'facettes : ' + normales.length);
    assert.ok(sommets.every(v => v.every(Number.isFinite)));
    for (const n of normales) assert.ok(Math.abs(Math.hypot(...n) - 1) < 1e-6, 'normale ' + n);
    const M = X.maillageDeScene(sc, {});
    assert.equal(normales.length, M.faces.reduce((s2, f) => s2 + X.triangles(f.pts.map(i => M.sommets[i - 1])).length, 0));
    assert.ok(normales.every(n => Math.hypot(...n) > 0), 'aucune facette plate (normale nulle)');
    assert.doesNotMatch(s, /NaN|undefined/);
  });

  test('la triangulation produit n−2 triangles par face', () => {
    assert.equal(X.triangles([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]).length, 2);
    assert.equal(X.triangles([[0, 0, 0], [1, 0, 0], [0, 1, 0]]).length, 1);
  });

  test('une scène sans relief s’exporte aussi (Z relatif au sol)', () => {
    const plat = V.scene(batiments, camera(), { palette: 0 });
    assert.equal(plat.terrainRef, 0);
    assert.equal(plat.maille, null);
    const M = X.maillageDeScene(plat, {});
    assert.ok(M.sommets.length > 0 && M.sommets.every(v => Number.isFinite(v[2])));
    assert.ok(M.faces.every(f => f.calque === 'BATI' || f.calque === 'TOIT'));
  });

  test('les exports ne modifient ni la scène ni le contexte', () => {
    const avant = JSON.stringify(sc.faces.map(f => f.pts3));
    const avantCtx = JSON.stringify(ctx.D);
    X.objDeScene(sc, {}); X.stlDeScene(sc, {}); X.maillageDeScene(sc, {});
    X.dxfTopo(ctx, { geolocate: true });
    assert.equal(JSON.stringify(sc.faces.map(f => f.pts3)), avant);
    assert.equal(JSON.stringify(ctx.D), avantCtx);
  });
});
