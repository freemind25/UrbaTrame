import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  typomorphoFromOSM, fetchTypomorphoOSM, unionIntervals, areaPolygonM2, projectOnAxisM,
  familleHauteur, FAMILLES_HAUTEUR
} from '../public/js/archi-typomorpho.mjs';

const REF = { lat: 36.0, lon: 6.0 };
/* rue est-ouest (axe 90°) passant par (36.0, 6.005), largeur 8 m */
const road = {
  type: 'way', id: 'r1', tags: { highway: 'residential', width: '8' },
  geometry: [{ lat: 36.0, lon: 6.0 }, { lat: 36.0, lon: 6.01 }]
};
/* voie nord-sud croisant la rue → carrefour en T/croix au point (36.0, 6.005) */
const cross = {
  type: 'way', id: 'r2', tags: { highway: 'residential' },
  geometry: [{ lat: 36.002, lon: 6.005 }, { lat: 36.0, lon: 6.005 }, { lat: 35.998, lon: 6.005 }]
};
/* 4 bâtiments au nord de la rue : 2 accolés R+3 (12 m), 1 isolé bas R+1 (5 m), 1 collectif (10 m) */
function bat(id, lats, lons, tags) {
  return {
    type: 'way', id, tags,
    geometry: lats.map((la, i) => ({ lat: la, lon: lons[i] }))
  };
}
/* positions en mètres depuis le centre (36.0, 6.005), 1° lon ≈ 90 100 m à lat 36 */
const M = d => 6.005 + d / (Math.cos(36 * Math.PI / 180) * 111320);
const LAT = d => 36.0 + d / 111320;
/* b1 : -30 à -12 m, b2 : -11 à +7 m (accolés à 1 m), b3 : +20 à +38 m (trou de 13 m avant), b4 : +39 à +57 m */
const b1 = bat('b1', [LAT(3), LAT(3), LAT(9), LAT(9)], [M(-30), M(-12), M(-12), M(-30)], { building: 'yes', height: '12', 'building:levels': '3' });
const b2 = bat('b2', [LAT(3), LAT(3), LAT(9), LAT(9)], [M(-11), M(7), M(7), M(-11)], { building: 'yes', height: '12', 'building:levels': '3' });
const b3 = bat('b3', [LAT(3), LAT(3), LAT(10), LAT(10)], [M(20), M(38), M(38), M(20)], { building: 'apartments', 'building:levels': '1', height: '5' });
const b4 = bat('b4', [LAT(3), LAT(3), LAT(9), LAT(9)], [M(41), M(59), M(59), M(41)], { building: 'yes', height: '10', shop: 'bakery' });
/* barrière : voie ferrée au sud */
const rail = { type: 'way', id: 'w1', tags: { railway: 'rail' }, geometry: [{ lat: 35.9985, lon: 6.0 }, { lat: 35.9985, lon: 6.01 }] };

describe('helpers géométriques', () => {
  test('areaPolygonM2 : carré de ~10 m de côté ≈ 100 m²', () => {
    const ref = { lat: 36, lon: 6 };
    const g = [{ lat: 36, lon: 6 }, { lat: 36, lon: 6 + 10 / (Math.cos(36 * Math.PI / 180) * 111320) }, { lat: 36 + 10 / 111320, lon: 6 + 10 / (Math.cos(36 * Math.PI / 180) * 111320) }, { lat: 36 + 10 / 111320, lon: 6 }];
    assert.ok(Math.abs(areaPolygonM2(g, ref) - 100) < 2, 'aire = ' + areaPolygonM2(g, ref));
  });
  test('unionIntervals : fusion + trous', () => {
    const u = unionIntervals([[0, 10], [5, 15], [30, 40]], 6);
    assert.equal(u.covered, 25);
    assert.equal(u.trous.length, 1);
    assert.ok(Math.abs(u.trous[0].largeur - 15) < 1e-9);
  });
  test('projectOnAxisM : axe est (90°) → projection = composante est', () => {
    const t = projectOnAxisM({ lat: 36, lon: 6 + 100 / (Math.cos(36 * Math.PI / 180) * 111320) }, REF, 90);
    assert.ok(Math.abs(t - 100) < 1, 't = ' + t);
  });
  test('familleHauteur', () => {
    assert.equal(familleHauteur(5).id, 'maison');
    assert.equal(familleHauteur(12).id, 'collectif');
    assert.equal(familleHauteur(30).id, 'haut');
    assert.equal(FAMILLES_HAUTEUR.length, 3);
  });
});

describe('typomorphoFromOSM', () => {
  const typo = typomorphoFromOSM([road, cross, b1, b2, b3, b4, rail], { lat: 36.0, lon: 6.005, nom: 'Rue Test', radius: 250 });

  test('renvoie null sans voie', () => {
    assert.equal(typomorphoFromOSM([b1], { lat: 36, lon: 6 }), null);
  });

  test('voie : hiérarchie, largeur, axe, ligne de croissance', () => {
    assert.ok(typo);
    assert.equal(typo.voie.classe, 'residential');
    assert.equal(typo.voie.hierarchie, 'rue résidentielle');
    assert.equal(typo.voie.largeur, 8);
    assert.ok(Math.abs(typo.voie.axeDeg - 90) < 3);
    assert.equal(typo.croissance.type, 'linéaire');
    assert.ok(Math.abs(typo.croissance.axeDeg - 90) < 3);
    assert.ok(typo.croissance.ligne.includes('artificielle'), 'voie rectiligne = ligne artificielle');
  });

  test('front bâti : continuité < 100 % et un trou détecté entre b2 et b3', () => {
    assert.ok(typo.continuiteFrontPct > 0 && typo.continuiteFrontPct < 100, 'continuité = ' + typo.continuiteFrontPct);
    assert.equal(typo.trous.length, 1, 'un seul trou > 6 m entre les bâtiments');
    assert.ok(typo.trous[0].largeur > 6);
  });

  test('typologie : b1 et b2 accolés, types agrégés, dominant = collectif accolé', () => {
    assert.ok(typo.types.length >= 2, 'au moins 2 types : ' + typo.types.map(t => t.label).join(' / '));
    const accoles = typo.types.find(t => t.accol);
    assert.ok(accoles, 'un type accolés existe');
    assert.equal(accoles.effectif, 2, 'b1+b2 accolés = 2 immeubles');
    assert.equal(typo.typeDominant.accol, true);
    assert.ok(typo.types.some(t => !t.accol && t.famille.includes('maison')), 'maison isolée R+1 reconnue');
    assert.ok(typo.types.some(t => t.rdc === 'commerce'), 'RDC commerce reconnu (b4)');
  });

  test('îlot : densité bâtie et emprise moyenne cohérentes', () => {
    assert.equal(typo.ilot.nbBatiments, 4);
    assert.ok(typo.ilot.densiteBatiePct > 0 && typo.ilot.densiteBatiePct < 100);
    assert.ok(typo.ilot.empriseMoyenneM2 > 0);
  });

  test('carrefour en croix/T détecté près du point', () => {
    assert.ok(typo.carrefours.length >= 1, 'carrefour détecté');
    assert.ok(['croix', 'T'].includes(typo.carrefours[0].type));
    assert.ok(typo.carrefours[0].distanceM < 50);
  });

  test('barrière artificielle (voie ferrée) listée', () => {
    assert.ok(typo.croissance.barrieres.some(b => b.kind.includes('ferrée')), JSON.stringify(typo.croissance.barrieres));
  });

  test('lecture topologique + densification', () => {
    assert.ok(['fluide', 'canalise', 'statique', 'intermediaire'].includes(typo.lecture.code));
    assert.equal(typo.croissance.densification.parSubstitution, typo.trous.length);
    assert.ok(typo.croissance.densification.parElevation >= 1, 'b3 (5 m) sous 80 % de la moyenne');
  });

  test('fetchTypomorphoOSM lève RUE_INTROUVABLE sans voie', async () => {
    const fakeRoutes = { overpassDirect: async () => ({ elements: [{ type: 'way', tags: { building: 'yes' }, geometry: [{ lat: 36, lon: 6 }] }] }) };
    await assert.rejects(() => fetchTypomorphoOSM(fakeRoutes, 36, 6), /RUE_INTROUVABLE|Aucune voie/);
  });
});

describe('planche SVG typomorpho', () => {
  test('renderAll(survey, typo) produit la planche 7', async () => {
    const { renderAll } = await import('../public/js/archi-rue-draw.mjs');
    const { DEMO_SURVEY } = await import('../public/js/archi-rue.mjs');
    const typo = typomorphoFromOSM([road, cross, b1, b2, b3, b4, rail], { lat: 36.0, lon: 6.005, nom: 'Rue Test', radius: 250 });
    const d = renderAll(DEMO_SURVEY, typo);
    assert.ok(d.typomorpho.startsWith('<svg'), 'SVG produit');
    assert.ok(d.typomorpho.includes('TYPOMORPHOLOGIE'), 'cartouche présent');
    assert.ok(d.typomorpho.includes('TYPE DOMINANT'), 'type dominant signalé');
    assert.ok(d.typomorpho.includes('parcelle vacante'), 'trous dessinés');
    assert.ok(d.planche.includes('6 dessins'), 'planche A3 toujours OK');
    assert.ok(!d.planche.includes('TYPOMORPHOLOGIE'), 'la planche A3 reste à 6 dessins');
  });
});
