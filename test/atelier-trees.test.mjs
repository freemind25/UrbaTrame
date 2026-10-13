import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as X from '../public/js/atelier/exports.mjs';
import { loadKernel, makeCtx, sceneFor } from '../tools/atelier/kernel.mjs';

describe('maquette 3D des arbres cartographiés', () => {
  const sc = { terrainRef: 412.6, maille: [], faces: [], arbres: [{ x: 4, y: -2, z: 1.4, h: 8, r: 1.8 }] };
  test('l’arbre devient un tronc et une couronne en facettes, en altitude absolue', () => {
    const m = X.maillageDeScene(sc);
    assert.equal(m.base, 412.6);
    assert.ok(m.faces.some(f => f.calque === 'ARBRE_TRONC'));
    assert.ok(m.faces.some(f => f.calque === 'ARBRES'));
    assert.ok(m.sommets.every(v => v.every(Number.isFinite)));
    assert.ok(Math.min(...m.sommets.map(v => v[2])) > 413);
    assert.ok(Math.max(...m.sommets.map(v => v[2])) > 420);
  });
  test('l’OBJ et le STL regroupent les arbres, option désactivable', () => {
    assert.match(X.objDeScene(sc), /^g ARBRE_TRONC$/m);
    assert.match(X.objDeScene(sc), /^g ARBRES$/m);
    assert.match(X.stlDeScene(sc), /facet normal/);
    assert.equal(X.maillageDeScene(sc, { arbres: false }).faces.length, 0);
  });
  test('une rangée OSM devient une ligne d’arbres dans la scène 3D exportée', () => {
    const D = { build: [], roads: [], green: [], trees: [], treeRows: [
      { id: 8, tags: {}, g: [[36.2642, 6.696], [36.2642, 6.697]] }
    ] };
    const scene = sceneFor(makeCtx({ D, terrain: null, curR: 200 }), { terrain: false, buildings: false });
    assert.ok(scene.arbres.length >= 10);
    assert.match(X.objDeScene(scene), /^g ARBRES$/m);
  });
  test('les empreintes du modèle sont coupées au cercle demandé', () => {
    const V = loadKernel().vue3d;
    const clipped = V.clipRingToCircle([[-200, -50], [200, -50], [200, 50], [-200, 50], [-200, -50]], 100);
    assert.ok(clipped && clipped.length > 4);
    assert.ok(clipped.every(p => Math.hypot(p[0], p[1]) <= 100 + 1e-6));
    assert.equal(V.clipRingToCircle([[200, 200], [220, 200], [220, 220], [200, 220]], 100), null);
  });
  test('la scène ignore le bâti hors emprise circulaire', () => {
    const rect = (lat, lon, size) => [[lat, lon], [lat, lon + size], [lat + size, lon + size], [lat + size, lon], [lat, lon]];
    const lat = 36.2642, lon = 6.6969;
    const D = { build: [
      { id: 1, g: rect(lat, lon, .00005), h: 8 },
      { id: 2, g: rect(lat, lon + .02, .00005), h: 8 }
    ], roads: [], green: [], trees: [], treeRows: [] };
    const scene = sceneFor(makeCtx({ sLat: lat, sLng: lon, D, terrain: null, curR: 200 }), { terrain: false });
    assert.equal(scene.batiments.length, 1);
  });
});
