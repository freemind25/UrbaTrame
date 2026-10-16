import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateFeasibility } from '../public/js/site-summary.mjs';
import {
  buildConceptMassing, conceptMeshScene, renderConceptMassingSvg
} from '../public/js/concept-massing.mjs';
import { maillageDeScene, normale, objDeScene, stlDeScene, triangles } from '../public/js/exports.mjs';

function modelFor({ count = 2, gap = 6, ratio = 1.5, floorHeight = 3.2 } = {}) {
  const capacity = calculateFeasibility({
    siteAreaM2: 2_000, far: 2, coveragePct: 30, floors: 3
  });
  return buildConceptMassing({
    siteAreaM2: 2_000,
    floorAreaM2: capacity.floorAreaM2,
    footprintM2: capacity.footprintM2,
    floors: 3,
    floorHeightM: floorHeight,
    volumeCount: count,
    aspectRatio: ratio,
    gapM: gap
  });
}

describe('volumes 3D conceptuels', () => {
  test('dérive des blocs égaux depuis la capacité et les dimensions saisies', () => {
    const m = modelFor();
    assert.ok(m);
    assert.equal(m.siteAreaM2, 2_000);
    assert.equal(m.floorAreaM2, 1_800);
    assert.equal(m.footprintM2, 600);
    assert.equal(m.volumeCount, 2);
    assert.ok(Math.abs(m.heightM - 9.6) < 1e-12);
    assert.equal(m.gapM, 6);
    assert.equal(m.blocks.length, 2);
    assert.equal(m.blocks[0].footprintM2 + m.blocks[1].footprintM2, 600);
    assert.equal(m.blocks[0].floorAreaM2 + m.blocks[1].floorAreaM2, 1_800);
    assert.equal(m.blocks[0].xM, 0);
    assert.equal(m.blocks[1].xM, m.widthM + 6);
    assert.ok(Math.abs(m.widthM * m.depthM - 300) < 1e-9);
    assert.ok(Math.abs(m.widthM / m.depthM - 1.5) < 1e-9);
  });

  test('une seule masse accepte un espacement non renseigné et conserve la géométrie en mètres', () => {
    const capacity = calculateFeasibility({ siteAreaM2: 1_000, far: 1.5, coveragePct: 50, floors: 4 });
    const m = buildConceptMassing({
      siteAreaM2: 1_000, floorAreaM2: capacity.floorAreaM2, footprintM2: capacity.footprintM2,
      floors: 4, floorHeightM: 3.5, volumeCount: 1, aspectRatio: 1, gapM: ''
    });
    assert.ok(m);
    assert.equal(m.gapM, 0);
    assert.equal(m.heightM, 14);
    assert.equal(m.blocks[0].widthM, m.blocks[0].depthM);
  });

  test('refuse les paramètres incomplets, incohérents ou hors limites', () => {
    const base = {
      siteAreaM2: 2_000, floorAreaM2: 1_800, footprintM2: 600, floors: 3,
      floorHeightM: 3.2, volumeCount: 2, aspectRatio: 1.5, gapM: 6
    };
    for (const change of [
      { floorHeightM: '' }, { volumeCount: 0 }, { volumeCount: 1.5 },
      { aspectRatio: 0 }, { gapM: '' }, { gapM: -1 },
      { footprintM2: 700 }, { floorAreaM2: 1_700 }, { floors: 2.5 },
      { siteAreaM2: 0 }, { volumeCount: 25 }
    ]) assert.equal(buildConceptMassing({ ...base, ...change }), null, JSON.stringify(change));
    assert.equal(buildConceptMassing(), null);
  });

  test('rend un SVG autonome, lisible et sans suggérer une emprise juridique', () => {
    const m = modelFor();
    const svg = renderConceptMassingSvg(m, { lang: 'fr', viewAngleDeg: 45 });
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(svg, /Volumes 3D conceptuels/);
    assert.match(svg, /Emprise cumulée/);
    assert.match(svg, /sans limite foncière/);
    assert.match(svg, /aucune géométrie cadastrale/);
    assert.match(svg, /<polygon/);
    assert.doesNotMatch(svg, /NaN|Infinity|undefined/);

    const rotated = renderConceptMassingSvg(m, { lang: 'en', viewAngleDeg: 270 });
    assert.match(rotated, /Conceptual 3D massing/);
    assert.match(rotated, /not georeferenced/);
    assert.doesNotMatch(rotated, /NaN|Infinity|undefined/);
    assert.equal(renderConceptMassingSvg(null), '');
  });

  test('exporte des boîtes fermées OBJ/STL en mètres, sans ajouter de géométrie de parcelle', () => {
    const m = modelFor({ count: 2, gap: 6 });
    const scene = conceptMeshScene(m);
    assert.equal(scene.terrainRef, 0);
    assert.equal(scene.faces.length, 12);
    assert.equal(scene.maille.length, 0);
    const mesh = maillageDeScene(scene);
    assert.equal(mesh.faces.length, 12);
    assert.ok(mesh.sommets.every(v => v.every(Number.isFinite)));
    scene.faces.forEach((face, i) => {
      const box = m.blocks[Math.floor(i / 6)];
      const tri = triangles(face.pts3)[0];
      const n = normale(...tri);
      const center = [box.xM + box.widthM / 2, box.yM + box.depthM / 2, box.heightM / 2];
      const faceCenter = tri[0].map((v, axis) => (v + tri[1][axis] + tri[2][axis]) / 3);
      const outward = n.reduce((sum, v, axis) => sum + v * (faceCenter[axis] - center[axis]), 0);
      assert.ok(outward > 0, `face ${i} has an outward normal`);
    });

    const obj = objDeScene(scene, { titre: 'volumes 3D conceptuels', mention: 'hypotheses utilisateur · sans georeferencement' });
    assert.match(obj, /^# UrbaTrame — volumes 3D conceptuels/m);
    assert.match(obj, /g BATI/);
    assert.match(obj, /g TOIT/);
    assert.match(obj, /hypotheses utilisateur/);
    assert.doesNotMatch(obj, /OpenStreetMap|cadastre|parcelle/i);

    const stl = stlDeScene(scene);
    assert.match(stl, /^solid urbatrame/);
    assert.match(stl, /endsolid urbatrame\n$/);
    assert.equal((stl.match(/facet normal/g) || []).length, 24);
    assert.doesNotMatch(stl, /NaN|Infinity/);
  });

  test('fusionne les blocs contigus pour éviter des faces internes dans les exports', () => {
    const m = modelFor({ count: 3, gap: 0 });
    const scene = conceptMeshScene(m);
    assert.equal(scene.faces.length, 6);
    const stl = stlDeScene(scene);
    assert.equal((stl.match(/facet normal/g) || []).length, 12);
  });
});
