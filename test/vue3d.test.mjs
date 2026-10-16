/* Vue 3D : position du soleil, caméra, scène (murs, toits, ombres), désignation
   au clic, lecture des deux sources de bâtiments. Entièrement hors ligne : les
   géométries d'essai sont fabriquées ici, seule la géométrie est vérifiée. */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadKernel, makeCtx, sample } from '../tools/kernel.mjs';
import { buildingsQuery, DEPS } from '../public/js/plan-2d.mjs';
import { batimentsDepuisOverpass, batimentsDepuisTuiles } from '../public/js/osm.mjs';

loadKernel();
const V = globalThis.FMVue3D;
const D2R = Math.PI / 180;

/* Un carré de 20 m de côté autour d'un point, en [lat, lon]. */
function carre(lat, lon, cote = 20) {
  const dy = (cote / 2) / 111320, dx = dy / Math.cos(lat * D2R);
  return [[lat - dy, lon - dx], [lat - dy, lon + dx], [lat + dy, lon + dx], [lat + dy, lon - dx], [lat - dy, lon - dx]];
}
const LAT = 36.2642, LON = 6.6969;

describe('position du soleil', () => {
  test('au zénith solaire, le soleil est haut et au sud', () => {
    /* midi solaire local ≈ longitude / 15 h UTC */
    const { instantLocal, soleil } = V;
    for (const [jour, hauteurMin] of [['2026-06-21', 70], ['2026-12-21', 25]]) {
      const s = soleil(instantLocal(12, LAT, LON, jour), LAT, LON);
      const alt = s.hauteur / D2R, az = s.azimut;
      assert.ok(alt > hauteurMin, jour + ' : altitude ' + alt.toFixed(1) + '°');
      assert.ok(Math.abs(az - 180) < 8, jour + ' : azimut ' + az.toFixed(1) + '° (attendu ≈ 180, plein sud)');
    }
  });

  test('la hauteur culmine à midi et devient négative la nuit', () => {
    const h = [];
    for (let heure = 0; heure < 24; heure++) h.push(V.soleil(V.instantLocal(heure, LAT, LON), LAT, LON).hauteur / D2R);
    const midi = h[12];
    assert.ok(midi > h[8] && midi > h[16], 'le maximum est à midi');
    assert.ok(h[0] < 0 && h[2] < 0 && h[23] < 0, 'la nuit : hauteur négative');
  });

  test('l’azimut tourne d’est en ouest', () => {
    const matin = V.soleil(V.instantLocal(8, LAT, LON), LAT, LON).azimut;
    const soir = V.soleil(V.instantLocal(16, LAT, LON), LAT, LON).azimut;
    assert.ok(matin > 60 && matin < 180, 'matin : ' + matin.toFixed(0) + '° (est)');
    assert.ok(soir > 180 && soir < 300, 'soir : ' + soir.toFixed(0) + '° (ouest)');
  });

  test('hémisphère sud : le soleil passe au nord', () => {
    const s = V.soleil(V.instantLocal(12, -33.9, 151.2, '2026-12-21'), -33.9, 151.2);
    assert.ok(s.azimut > 300 || s.azimut < 60, 'azimut ' + s.azimut.toFixed(0) + '°');
  });
});

describe('caméra', () => {
  const cam = V.camera({ lat: LAT, lon: LON, rayon: 600, cap: 0, inclinaison: 45, largeur: 400, hauteur: 400 });

  test('le centre du site se projette au centre de l’image', () => {
    const p = cam.proj(LAT, LON, 0);
    assert.ok(Math.abs(p[0] - 200) < 1 && Math.abs(p[1] - 200) < 1, JSON.stringify(p));
  });

  test('un point au nord se projette plus haut, à l’est plus à droite', () => {
    const nord = cam.proj(LAT + 0.002, LON, 0);
    const est = cam.proj(LAT, LON + 0.002, 0);
    assert.ok(nord[1] < 200, 'le nord est en haut');
    assert.ok(est[0] > 200, 'l’est est à droite');
  });

  test('l’altitude fait monter le point à l’écran', () => {
    const sol = cam.proj(LAT, LON, 0);
    const haut = cam.proj(LAT, LON, 30);
    assert.ok(haut[1] < sol[1], 'l’altitude réduit y');
  });

  test('inclinaison 0 : vue verticale, une distance double une autre', () => {
    const cam0 = V.camera({ lat: LAT, lon: LON, rayon: 600, cap: 0, inclinaison: 0, largeur: 400, hauteur: 400 });
    const a = cam0.proj(LAT, LON, 0);
    const b = cam0.proj(LAT + 0.001, LON, 0);
    const c = cam0.proj(LAT + 0.002, LON, 0);
    const d1 = a[1] - b[1], d2 = a[1] - c[1];
    assert.ok(d1 > 0, 'le nord est en haut (' + d1.toFixed(1) + ' px)');
    assert.ok(Math.abs(d2 / d1 - 2) < 0.06, 'rapport ' + (d2 / d1).toFixed(3));
  });

  test('inclinaison 0 : les quatre points cardinaux encadrent le centre', () => {
    const cam0 = V.camera({ lat: LAT, lon: LON, rayon: 600, cap: 0, inclinaison: 0, largeur: 400, hauteur: 400 });
    const n = cam0.proj(LAT + 0.001, LON, 0), s2 = cam0.proj(LAT - 0.001, LON, 0);
    const e = cam0.proj(LAT, LON + 0.001, 0), o = cam0.proj(LAT, LON - 0.001, 0);
    assert.ok(n[1] < 200 && s2[1] > 200, 'nord en haut, sud en bas');
    assert.ok(o[0] < 200 && e[0] > 200, 'ouest à gauche, est à droite');
  });

  test('rotation de 90° : en regardant à l’est, le nord passe à gauche', () => {
    const cam90 = V.camera({ lat: LAT, lon: LON, rayon: 600, cap: 90, inclinaison: 30, largeur: 400, hauteur: 400 });
    const nord = cam90.proj(LAT + 0.002, LON, 0);
    assert.ok(nord[0] < 195, 'x = ' + nord[0].toFixed(1) + ' (le nord est à gauche quand on regarde à l’est)');
    const camOuest = V.camera({ lat: LAT, lon: LON, rayon: 600, cap: -90, inclinaison: 30, largeur: 400, hauteur: 400 });
    const nordOuest = camOuest.proj(LAT + 0.002, LON, 0);
    assert.ok(nordOuest[0] > 205, 'x = ' + nordOuest[0].toFixed(1) + ' (à droite en regardant à l’ouest)');
  });

  test('un point derrière la caméra n’est pas projeté', () => {
    /* caméra au sud du site, regardant vers le nord : ce qui est au sud, loin,
       passe derrière elle */
    const cam80 = V.camera({ lat: LAT, lon: LON, rayon: 600, cap: 0, inclinaison: 80, largeur: 400, hauteur: 400 });
    assert.equal(cam80.proj(LAT - 0.5, LON, 0), null, 'un point très au sud');
    assert.ok(cam80.proj(LAT + 0.002, LON, 0), 'un point proche au nord reste visible');
  });
});

describe('scène : murs, toits, ombres', () => {
  const bat = [
    { g: carre(LAT, LON - 0.001), h: 12, t: 'residential' },
    { g: carre(LAT + 0.001, LON + 0.001), h: 0, t: 'yes' },
    { g: carre(LAT - 0.001, LON + 0.001, 14), h: 20, hauteurToit: 4, t: 'commercial' }
  ];
  const cam = V.camera({ lat: LAT, lon: LON, rayon: 600, cap: 0, inclinaison: 45, largeur: 400, hauteur: 400 });
  const midi = V.soleil(V.instantLocal(12, LAT, LON), LAT, LON);

  test('chaque bâtiment donne des murs et un toit', () => {
    const sc = V.scene(bat, cam, { soleil: midi });
    assert.ok(sc.faces.length >= 6, 'faces : ' + sc.faces.length);
    assert.ok(sc.faces.some(f => f.type === 'mur'));
    assert.ok(sc.faces.some(f => f.type === 'toit'));
    assert.equal(sc.batiments.length, 3);
  });

  test('les murs vus de dos sont écartés', () => {
    const sc = V.scene(bat, cam, { soleil: midi });
    const murs = sc.faces.filter(f => f.type === 'mur');
    /* au plus 3 murs visibles par bâtiment (sur 4), donc strictement moins
       que le total des arêtes */
    assert.ok(murs.length < 3 * 4, 'murs dessinés : ' + murs.length);
  });

  test('les faces sont triées de la plus lointaine à la plus proche', () => {
    const sc = V.scene(bat, cam, { soleil: midi });
    for (let i = 1; i < sc.faces.length; i++)
      assert.ok(sc.faces[i - 1].prof >= sc.faces[i].prof, 'tri à l’index ' + i);
  });

  test('le soleil de midi donne des ombres ; la nuit n’en donne pas', () => {
    const jourS = V.scene(bat, cam, { soleil: midi });
    assert.equal(jourS.ombres.length, 3, 'une ombre par bâtiment');
    const nuit = V.soleil(V.instantLocal(1, LAT, LON), LAT, LON);
    assert.ok(nuit.hauteur < 0);
    assert.equal(V.scene(bat, cam, { soleil: nuit }).ombres.length, 0, 'aucune ombre la nuit');
  });

  test('l’ombre s’allonge quand le soleil descend', () => {
    const long = s => {
      const sc = V.scene([bat[0]], cam, { soleil: s });
      const xs = sc.ombres[0].pts.map(p => p[0]), ys = sc.ombres[0].pts.map(p => p[1]);
      return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    };
    const midiB = long(midi);
    const seize = long(V.soleil(V.instantLocal(16.5, LAT, LON), LAT, LON));
    assert.ok(seize > midiB, '16 h 30 (' + seize.toFixed(1) + ') > midi (' + midiB.toFixed(1) + ')');
  });

  test('l’ombre part du côté opposé au soleil', () => {
    const matin = V.soleil(V.instantLocal(8, LAT, LON), LAT, LON);   // soleil à l'est
    const sc = V.scene([bat[0]], cam, { soleil: matin });
    const cx = sc.ombres[0].pts.reduce((s, p) => s + p[0], 0) / sc.ombres[0].pts.length;
    const sol = cam.proj(LAT, LON - 0.001, 0);
    assert.ok(Math.abs(cx - sol[0]) > 2, 'l’ombre est décalée à l’horizontale');
  });

  test('un bâtiment sans hauteur est dessiné à 9 m, et signalé', () => {
    const sc = V.scene([bat[1]], cam, { soleil: midi });
    const murs = sc.faces.filter(f => f.type === 'mur');
    assert.ok(murs.length, 'des murs sont produits');
    assert.ok(sc.batiments[0].h > 0, 'hauteur de dessin renseignée');
  });

  test('hauteur de toit : un pan de toit supplémentaire apparaît', () => {
    const avec = V.scene([bat[2]], cam, { soleil: midi }).faces.length;
    const sans = V.scene([{ ...bat[2], hauteurToit: 0 }], cam, { soleil: midi }).faces.length;
    assert.ok(avec > sans, avec + ' > ' + sans);
  });

  test('une emprise dégénérée est ignorée sans erreur', () => {
    const sc = V.scene([{ g: [[LAT, LON], [LAT, LON + 0.00001]], h: 10 }], cam, { soleil: midi });
    assert.equal(sc.faces.length, 0);
  });
});

describe('désignation d’un bâtiment au clic', () => {
  const bat = [{ g: carre(LAT, LON, 30), h: 15, t: 'yes', nom: 'essai' }];
  const cam = V.camera({ lat: LAT, lon: LON, rayon: 600, cap: 0, inclinaison: 40, largeur: 400, hauteur: 400 });
  const sc = V.scene(bat, cam, { soleil: V.soleil(V.instantLocal(12, LAT, LON), LAT, LON) });

  test('le centre du bâtiment le désigne', () => {
    const p = cam.proj(LAT, LON, 7.5);
    assert.equal(V.designer(sc, p[0], p[1]), bat[0]);
  });

  test('un point vide ne désigne rien', () => {
    assert.equal(V.designer(sc, 2, 2), null);
  });

  test('le point-dans-polygone est correct', () => {
    const poly = [[0, 0], [10, 0], [10, 10], [0, 10]];
    assert.equal(V.dans(poly, 5, 5), true);
    assert.equal(V.dans(poly, 15, 5), false);
  });
});

describe('sortie SVG de la vue 3D', () => {
  const bat = [{ g: carre(LAT, LON), h: 12, t: 'residential' }];

  test('le SVG est bien formé et sans valeur invalide', () => {
    const svg = V.versSVG(bat, {
      lat: LAT, lon: LON, rayon: 600, cap: 30, inclinaison: 45,
      soleil: V.soleil(V.instantLocal(10, LAT, LON), LAT, LON)
    });
    assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'));
    for (const bad of ['NaN', 'undefined', 'Infinity']) assert.ok(!svg.includes(bad), bad);
  });

  test('la planche du catalogue est exploitable', () => {
    const ctx = makeCtx({ time: 15 });
    const p = V.planche(ctx, {});
    assert.ok(p.svg.length > 2000, 'longueur ' + p.svg.length);
    assert.ok(p.mesures > 0 && p.mesures <= p.batiments);
    assert.ok(/soleil 15 h/.test(p.note), p.note);
    assert.ok(!p.svg.includes('NaN'));
  });

  test('la date solaire choisie change l’ombre et reste annoncée sur la planche', () => {
    const ete = V.planche(makeCtx({ time: 12, sunDate: '2026-06-21' }), {});
    const hiver = V.planche(makeCtx({ time: 12, sunDate: '2026-12-21' }), {});
    assert.match(ete.note, /2026-06-21/);
    assert.match(hiver.note, /2026-12-21/);
    assert.notEqual(ete.soleil.hauteur, hiver.soleil.hauteur);
    assert.notEqual(ete.svg, hiver.svg);
  });

  test('la planche de nuit annonce la nuit', () => {
    const p = V.planche(makeCtx({ time: 2 }), {});
    assert.ok(/nuit 2 h/.test(p.note), p.note);
  });

  test('une scène vide ne casse rien', () => {
    const p = V.planche(makeCtx({ D: { roads: [], build: [], green: [], pois: [] } }), {});
    assert.ok(p.svg.startsWith('<rect'));
  });
});

describe('lecture des bâtiments', () => {
  test('Overpass : way, relation à cour, hauteur par niveaux', () => {
    const elements = [
      { type: 'way', id: 1, tags: { building: 'residential', height: '12' },
        geometry: carre(LAT, LON).map(p => ({ lat: p[0], lon: p[1] })) },
      { type: 'relation', id: 2, tags: { building: 'yes', 'building:levels': '3' },
        members: [
          { role: 'outer', geometry: carre(LAT + 0.002, LON).map(p => ({ lat: p[0], lon: p[1] })) },
          { role: 'inner', geometry: carre(LAT + 0.002, LON, 5).map(p => ({ lat: p[0], lon: p[1] })) }
        ] },
      { type: 'node', id: 3, lat: LAT, lon: LON, tags: { amenity: 'cafe' } },
      { type: 'way', id: 4, tags: { highway: 'residential' },
        geometry: carre(LAT, LON).map(p => ({ lat: p[0], lon: p[1] })) }
    ];
    const b = batimentsDepuisOverpass(elements);
    assert.equal(b.length, 2, 'deux bâtiments (le nœud et la voirie sont écartés)');
    assert.equal(b[0].h, 12);
    assert.equal(b[1].h, 9.3, '3 niveaux × 3,1 m');
    assert.ok(b.every(x => x.g.length >= 4));
    /* La cour intérieure (membre « inner ») devient un trou de l'emprise,
       au lieu d'être jetée ou remplie. */
    assert.equal(b[0].trous.length, 0, 'un way n’a pas de cour');
    assert.equal(b[1].trous.length, 1, 'la relation à cour garde sa cour');
    assert.ok(b[1].trous[0].length >= 4, 'la cour est un anneau');
  });

  test('relation à plusieurs emprises : la cour revient à celle qui la contient', () => {
    const carreGeo = (lat, lon, cote) => carre(lat, lon, cote).map(p => ({ lat: p[0], lon: p[1] }));
    const b = batimentsDepuisOverpass([{
      type: 'relation', id: 9, tags: { building: 'yes', height: '10' },
      members: [
        { role: 'outer', geometry: carreGeo(LAT, LON, 40) },        // grande emprise
        { role: 'outer', geometry: carreGeo(LAT + 0.01, LON, 20) }, // voisine, sans cour
        { role: 'inner', geometry: carreGeo(LAT, LON, 10) }         // cour de la grande
      ]
    }]);
    assert.equal(b.length, 2, 'deux emprises');
    assert.equal(b[0].trous.length, 1, 'la cour est attachée à la grande emprise');
    assert.equal(b[1].trous.length, 0, 'la voisine n’hérite pas de la cour');
  });

  test('tuile GeoJSON : ordre [lon, lat] remis en [lat, lon], attributs repris', () => {
    const j = { type: 'FeatureCollection', features: [{
      type: 'Feature', id: 'osm-w42',
      geometry: { type: 'Polygon', coordinates: [carre(LAT, LON).map(p => [p[1], p[0]])] },
      properties: { height: 18, minHeight: 4, roofHeight: 3, roofShape: 'flat', color: '#c8c8c8', name: 'Mairie' }
    }] };
    const b = batimentsDepuisTuiles(j);
    assert.equal(b.length, 1);
    assert.equal(b[0].h, 18);
    assert.equal(b[0].minH, 4);
    assert.equal(b[0].hauteurToit, 3);
    assert.equal(b[0].couleur, '#c8c8c8');
    assert.equal(b[0].nom, 'Mairie');
    assert.equal(b[0].source, 'osmbuildings');
    assert.ok(Math.abs(b[0].g[0][0] - LAT) < 0.0002, 'latitude reconnue (' + b[0].g[0][0] + ')');
    assert.ok(Math.abs(b[0].g[0][1] - LON) < 0.0002, 'longitude reconnue (' + b[0].g[0][1] + ')');
  });

  test('tuile sans hauteur : déduite des niveaux', () => {
    const j = { features: [{ id: 'x', geometry: { type: 'Polygon', coordinates: [carre(LAT, LON).map(p => [p[1], p[0]])] }, properties: { levels: 4 } }] };
    assert.ok(Math.abs(batimentsDepuisTuiles(j)[0].h - 12.4) < 0.01);
  });

  test('Polygon et MultiPolygon sont acceptés', () => {
    const ring = carre(LAT, LON).map(p => [p[1], p[0]]);
    const mp = { features: [{ id: 'm', geometry: { type: 'MultiPolygon', coordinates: [[ring]] }, properties: { height: 9 } }] };
    assert.equal(batimentsDepuisTuiles(mp).length, 1);
  });
});

describe('requête de bâtiments (planificateur)', () => {
  test('la requête demande les ways ET les relations, sur le bon cadre', () => {
    const q = buildingsQuery(LAT, LON, 600);
    assert.ok(q.startsWith('[out:json]') && q.endsWith('out geom;'));
    assert.ok(q.includes('way["building"](') && q.includes('relation["building"]('));
    const bbox = q.match(/way\["building"\]\(([^)]+)\)/)[1].split(',').map(Number);
    const dy = 600 / 111320;
    assert.ok(Math.abs(bbox[0] - (LAT - dy)) < 1e-6 && Math.abs(bbox[2] - (LAT + dy)) < 1e-6, 'latitude du cadre');
    assert.ok(bbox[1] < LON && bbox[3] > LON, 'longitude encadre le point');
  });

  test('rayon et position invalides sont refusés', () => {
    assert.throws(() => buildingsQuery(LAT, LON, 50), /RADIUS_200_3000/);
    assert.throws(() => buildingsQuery(89, LON, 600), /INVALID_LOCATION/);
    assert.throws(() => buildingsQuery(LAT, 179.999, 3000), /SITE_CROSSES_DATELINE/);
  });

  test('l’analyse « volumes » demande le bâti et l’altimétrie', () => {
    /* sans la grille d'altitudes, les volumes ne peuvent pas se poser sur le
       terrain : les deux couches montent ensemble */
    assert.deepEqual(DEPS.volumes, ['buildings', 'terrain']);
  });
});

describe('fond de carte (tuiles raster)', () => {
  test('les tuiles nécessaires couvrent tout le site', () => {
    const rayon = 600, z = 16;
    const t = V.tuilesPour(LAT, LON, rayon, z);
    assert.ok(t.length >= 1 && t.length <= 30, 'tuiles : ' + t.length);
    assert.ok(t.every(x => x.z === z && Number.isInteger(x.x) && Number.isInteger(x.y)));
    /* chaque coin du carré circonscrit doit tomber dans une tuile de la liste */
    const dLat = rayon / 111320, dLon = dLat / Math.cos(LAT * D2R);
    for (const [la, lo] of [[LAT + dLat, LON - dLon], [LAT + dLat, LON + dLon],
                            [LAT - dLat, LON - dLon], [LAT - dLat, LON + dLon]]) {
      const { x, y } = V.tuileXY(la, lo, z);
      assert.ok(t.some(u => u.x === x && u.y === y), 'coin ' + la.toFixed(4) + ',' + lo.toFixed(4) + ' non couvert');
    }
  });

  test('la boîte d’une tuile encadre le point de départ', () => {
    const { x, y } = V.tuileXY(LAT, LON, 16);
    const box = V.tuileBoite(x, y, 16);
    const latMin = Math.min(box[0][0], box[2][0]), latMax = Math.max(box[0][0], box[2][0]);
    const lonMin = Math.min(box[0][1], box[1][1]), lonMax = Math.max(box[0][1], box[1][1]);
    assert.ok(LAT > latMin - 1e-9 && LAT < latMax + 1e-9, 'latitude dans la tuile');
    assert.ok(LON > lonMin - 1e-9 && LON < lonMax + 1e-9, 'longitude dans la tuile');
  });

  test('l’URL de tuile est correctement remplie', () => {
    const u = V.urlTuile('https://{s}.tile.example/{z}/{x}/{y}.png', { x: 3, y: 4, z: 5 }, 'b');
    assert.equal(u, 'https://b.tile.example/5/3/4.png');
  });
});

describe('relief : les volumes se posent sur le terrain', () => {
  /* Grille d'essai : 5 × 5 sur 800 m, en pente douce d'ouest en est
     (100 m à l'ouest, +10 m par colonne). */
  const N = 5, R = 400;
  const grille = (f = (i) => 100 + 10 * i) =>
    Array.from({ length: N }, () => Array.from({ length: N }, (_, i) => f(i)));
  const t = { n: N, zoom: 14, lat: LAT, lon: LON, radius: R, grid: grille() };

  test('la grille se lit en repère local : zéro au centre du site', () => {
    const terr = V.prepareTerrain(t, 1);
    assert.equal(terr.n, N);
    assert.ok(Math.abs(terr.z(LAT, LON)) < 1e-9, 'centre à zéro');
    assert.ok(Math.abs(terr.altitude(LAT, LON) - 120) < 1e-6, 'altitude absolue au centre : ' + terr.altitude(LAT, LON));
    const dx = (R / 111320) / Math.cos(LAT * D2R);
    assert.ok(terr.z(LAT, LON - dx) < -19.9, 'bord ouest plus bas : ' + terr.z(LAT, LON - dx).toFixed(1));
    assert.ok(terr.z(LAT, LON + dx) > 19.9, 'bord est plus haut : ' + terr.z(LAT, LON + dx).toFixed(1));
    assert.equal(terr.mini, 100);
    assert.equal(terr.maxi, 140);
  });

  test('le maillage déborde de la grille et garde l’altitude du bord', () => {
    const terr = V.prepareTerrain(t, 1);
    const q = V.maillageRelief(terr);
    assert.equal(q.length, (N - 1 + 2 * V.RELIEF_MARGE) ** 2, 'quads : ' + q.length);
    assert.ok(q.every(x => Number.isFinite(x.z) && x.n.every(Number.isFinite)), 'valeurs finies');
    /* les nœuds s'étendent au-delà du carré de la grille (rayon R) … */
    const xMax = Math.max(...q.flatMap(x => x.pts.map(p => Math.abs(p[0]))));
    const yMax = Math.max(...q.flatMap(x => x.pts.map(p => Math.abs(p[1]))));
    assert.ok(xMax > R && yMax > R, 'débord : ' + xMax.toFixed(0) + ' × ' + yMax.toFixed(0) + ' m');
    /* … mais leur altitude reste celle du bord : aucun quad plus haut que la
       grille elle-même, aucune extrapolation. */
    const hors = q.filter(x => x.pts.some(p => Math.hypot(p[0], p[1]) > R * 1.02));
    const bas = terr.mini - terr.ref, haut = terr.maxi - terr.ref;   // repère local
    assert.ok(hors.length > 0, 'des quads hors grille : ' + hors.length);
    assert.ok(hors.every(x => x.z >= bas - 1e-9 && x.z <= haut + 1e-9),
      'altitudes bornées (' + bas + ' … ' + haut + ' m)');
  });

  test('sans relief, l’assise est à zéro ; avec relief, elle suit la pente', () => {
    const bat = [
      { g: carre(LAT, LON - 0.002), h: 10, t: 'yes' },
      { g: carre(LAT, LON + 0.002), h: 10, t: 'yes' }
    ];
    const cam = V.camera({ lat: LAT, lon: LON, rayon: 600, cap: 0, inclinaison: 45, largeur: 400, hauteur: 400 });
    const plat = V.scene(bat, cam, {});
    assert.equal(plat.batiments[0].z, 0);
    assert.equal(plat.batiments[1].z, 0);
    const sc = V.scene(bat, cam, { terrain: t });
    const [ouest, est] = sc.batiments;
    assert.ok(ouest.z < -8, 'bâti de l’ouest en contrebas : ' + ouest.z.toFixed(1) + ' m');
    assert.ok(est.z > 8, 'bâti de l’est en surplomb : ' + est.z.toFixed(1) + ' m');
    /* 4,5 mm de longitude par mètre : 0,002° ≈ 200 m de part et d'autre du
       centre, soit ≈ 0,9 cellule de 200 m et 10 m de pente par cellule */
    assert.ok(Math.abs((est.z - ouest.z) - 18) < 0.5, 'dénivelé : ' + (est.z - ouest.z).toFixed(1) + ' m');
    /* le centre retenu est bien le centre de gravité, pas le sommet de
       fermeture répété : l'assise ne dépend pas du point écrit en double */
    const sansDouble = V.scene([{ ...bat[1], g: bat[1].g.slice(0, -1) }], cam, { terrain: t });
    assert.ok(Math.abs(sansDouble.batiments[0].z - est.z) < 0.05,
      'assise identique (' + sansDouble.batiments[0].z.toFixed(2) + ' vs ' + est.z.toFixed(2) + ')');
    /* la hauteur dessinée, elle, ne dépend pas du relief */
    assert.equal(ouest.h, 10);
  });

  test('un relief plat ne change pas l’image, mais annonce son altitude', () => {
    const cam = V.camera({ lat: LAT, lon: LON, rayon: 600, cap: 0, inclinaison: 45, largeur: 400, hauteur: 400 });
    const bat = [{ g: carre(LAT, LON), h: 12, t: 'yes' }];
    const sc = V.scene(bat, cam, { terrain: { ...t, grid: grille(() => 630) } });
    assert.equal(sc.batiments[0].z, 0, 'relief plat : assise à zéro');
    assert.equal(sc.batiments[0].h, 12);
  });

  test('la planche annonce l’amplitude du relief', () => {
    const p = V.planche(makeCtx(), {});
    assert.ok(/sol 589–665 m/.test(p.note), p.note);
    assert.deepEqual(p.relief.map(Math.round), [589, 665]);
    /* sans grille, la note reste celle d'avant */
    const sans = V.planche(makeCtx({ terrain: null }), {});
    assert.ok(!/ sol /.test(sans.note), sans.note);
    assert.equal(sans.relief, null);
  });
});

describe('cours intérieures et volumes imbriqués', () => {
  /* Immeuble de 40 m à cour centrale de 16 m. */
  const avecCour = {
    g: carre(LAT, LON, 40), h: 14, t: 'yes',
    trous: [carre(LAT, LON, 16)]
  };
  const plein = { g: carre(LAT, LON, 40), h: 14, t: 'yes' };
  const cam = V.camera({ lat: LAT, lon: LON, rayon: 600, cap: 0, inclinaison: 45, largeur: 400, hauteur: 400 });
  const midi = V.soleil(V.instantLocal(12, LAT, LON), LAT, LON);

  test('la cour ajoute des murs intérieurs, sans remplacer l’emprise', () => {
    const sc = V.scene([avecCour], cam, { soleil: midi });
    const murs = sc.faces.filter(f => f.type === 'mur');
    assert.ok(murs.some(f => f.ext === false), 'murs de cour');
    assert.ok(murs.some(f => f.ext !== false), 'murs d’emprise');
    const sans = V.scene([plein], cam, { soleil: midi }).faces.filter(f => f.type === 'mur');
    assert.ok(murs.length > sans.length, murs.length + ' murs avec cour > ' + sans.length + ' sans');
  });

  test('la cour est dessinée à sa taille, pas réduite à un point', () => {
    /* Projeter une cour en degrés au lieu de mètres locaux la réduit à un
       pixel : le trou doit occuper la part attendue de l'emprise (16/40). */
    const sc = V.scene([avecCour], cam, { soleil: midi });
    const toit = sc.faces.find(f => f.type === 'toit');
    const largeur = pts => Math.max(...pts.map(p => p[0])) - Math.min(...pts.map(p => p[0]));
    const part = largeur(toit.trous[0]) / largeur(toit.pts);
    assert.ok(part > 0.25 && part < 0.6, 'part de la cour à l’écran : ' + part.toFixed(2));
    assert.ok(largeur(toit.trous[0]) > 3, 'cour large de ' + largeur(toit.trous[0]).toFixed(1) + ' px');
  });

  test('le toit est évidé, pas dessiné par-dessus la cour', () => {
    const sc = V.scene([avecCour], cam, { soleil: midi });
    const toit = sc.faces.find(f => f.type === 'toit');
    assert.ok(toit, 'un toit');
    assert.equal(toit.trous.length, 1, 'un trou');
    assert.equal(toit.trous[0].length, toit.pts.length, 'trou et emprise de même finesse');
    /* deux sous-tracés : l'emprise, puis la cour */
    const d = V.toitSVG(toit);
    assert.ok(d.includes('fill-rule="evenodd"'), 'remplissage pair-impair');
    assert.equal((d.match(/M/g) || []).length, 2, 'deux anneaux dans le tracé');
    assert.ok(d.trim().endsWith('/>'), d.slice(-14));
    /* sans cour : un simple polygone plein */
    const pleinSvg = V.toitSVG(V.scene([plein], cam, { soleil: midi }).faces.find(f => f.type === 'toit'));
    assert.ok(pleinSvg.startsWith('<polygon') && !pleinSvg.includes('evenodd'), pleinSvg.slice(0, 40));
  });

  test('l’image SVG évide bien la cour et la signale au clic', () => {
    const svg = V.versSVG([avecCour], {
      lat: LAT, lon: LON, rayon: 600, cap: 0, inclinaison: 45, soleil: midi
    });
    assert.ok(svg.includes('fill-rule="evenodd"'), 'un tracé évidé');
    for (const bad of ['NaN', 'undefined', 'Infinity']) assert.ok(!svg.includes(bad), bad);
    const sc = V.scene([avecCour], cam, { soleil: midi });
    const c = cam.proj(LAT, LON - 0.0001, 14);           // sur le toit, près du bord sud
    assert.equal(V.designer(sc, c[0], c[1]), avecCour, 'le bâti se désigne toujours');
  });

  test('le tri groupe les faces par bâtiment, du plus lointain au plus proche', () => {
    /* une grande barre au nord (loin), une petite au sud (près) */
    const loin = { g: carre(LAT + 0.0025, LON, 60), h: 20, t: 'yes' };
    const près = { g: carre(LAT - 0.0015, LON, 12), h: 20, t: 'yes' };
    const sc = V.scene([loin, près], cam, { soleil: midi });
    assert.equal(sc.groupes.length, 2, 'un groupe par bâtiment');
    assert.ok(sc.groupes[0].prof > sc.groupes[1].prof, 'du plus lointain au plus proche');
    assert.equal(sc.groupes[1].faces[0].b, près, 'le groupe suivant est le plus proche');
    /* les faces sont bien celles des groupes, mises bout à bout */
    assert.equal(sc.faces.length, sc.groupes.reduce((n, g) => n + g.faces.length, 0));
    for (let i = 1; i < sc.faces.length; i++) {
      const avant = sc.faces[i - 1], après = sc.faces[i];
      if (avant.b === après.b) assert.ok(avant.prof >= après.prof, 'faces d’un même bâti triées');
    }
  });

  test('au clic, c’est le bâtiment le plus proche qui répond', () => {
    const loin = { g: carre(LAT + 0.0022, LON, 80), h: 24, t: 'yes', nom: 'loin' };
    const près = { g: carre(LAT - 0.0022, LON, 24), h: 24, t: 'yes', nom: 'près' };
    const sc = V.scene([loin, près], cam, { soleil: midi });
    const c = cam.proj(LAT - 0.0022, LON, 12);           // sur le bâtiment proche
    assert.equal(V.designer(sc, c[0], c[1]), près, 'le proche l’emporte sur l’arrière-plan');
    /* et le bâtiment lointain reste désignable là où il est seul */
    const haut = cam.proj(LAT + 0.0022, LON, 12);
    assert.equal(V.designer(sc, haut[0], haut[1]), loin);
  });
});

describe('vue interactive : rendu sur canevas', () => {
  /* Faux contexte 2D : on n'évalue pas le dessin, on vérifie seulement que le
     chemin de la vue interactive accepte le relief et les cours sans broncher,
     et qu'il évide bien les toits à cour. */
  function fauxContexte() {
    const appels = [];
    const g = {
      appels,
      canvas: { width: 400, height: 400 },
      save() {}, restore() {}, clearRect() {}, beginPath() {}, closePath() {},
      moveTo() {}, lineTo() {}, arc() {}, stroke() {}, fillRect() {},
      createLinearGradient: () => ({ addColorStop() {} }), drawImage() {}, setTransform() {},
      arcTo() {}, quadraticCurveTo() {},
      fill(regle) { appels.push({ op: 'fill', regle: regle || 'nonzero', style: g.fillStyle }); },
      stroke() { appels.push({ op: 'stroke' }); },
      set fillStyle(v) { this._f = v; }, get fillStyle() { return this._f; },
      set strokeStyle(v) { this._s = v; }, get strokeStyle() { return this._s; },
      set globalAlpha(v) {}, get globalAlpha() { return 1; },
      set lineWidth(v) {}, set lineJoin(v) {}, set font(v) {}, set textAlign(v) {},
      set textBaseline(v) {}, set globalCompositeOperation(v) {}, set lineCap(v) {},
      setTransform(a, b, c, d, e, f) {}, measureText: () => ({ width: 10 }),
      fillText() {}, strokeText() {}
    };
    return g;
  }

  test('le relief et les cours passent par le canevas', () => {
    const terr = {
      n: 5, zoom: 14, lat: LAT, lon: LON, radius: 400,
      grid: Array.from({ length: 5 }, (_, j) => Array.from({ length: 5 }, (_, i) => 100 + 6 * i - 4 * j))
    };
    const bat = [
      { g: carre(LAT, LON, 40), h: 14, t: 'yes', trous: [carre(LAT, LON, 16)] },
      { g: carre(LAT + 0.002, LON, 20), h: 8, t: 'yes' }
    ];
    const cam = V.camera({ lat: LAT, lon: LON, rayon: 600, cap: 0, inclinaison: 45, largeur: 400, hauteur: 400 });
    const sc = V.scene(bat, cam, { soleil: V.soleil(V.instantLocal(12, LAT, LON), LAT, LON), terrain: terr });
    const g = fauxContexte();
    assert.doesNotThrow(() => V.dessiner(g, sc, { routes: [] }), 'rendu sans erreur');
    assert.ok(g.appels.filter(a => a.op === 'fill').length > sc.maille.length,
      'le maillage du sol est peint : ' + g.appels.length + ' appels');
    assert.ok(g.appels.some(a => a.regle === 'evenodd'), 'le toit à cour est évidé');
    assert.doesNotThrow(() => V.dessiner(g, V.scene(bat, cam, {}), { routes: [] }),
      'rendu sans relief ni cour, sans erreur');
  });
});
