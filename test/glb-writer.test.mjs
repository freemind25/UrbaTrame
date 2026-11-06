import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildGlb, couleurVersRgb, scene3dVersMeshes } from '../public/js/glb-writer.mjs';
import { parseGlb } from '../public/js/atelier/local-layers.mjs';

const triangle = {
  name: 'TRI',
  positions: [0, 0, 0, 10, 0, 0, 0, 10, 5],
  indices: [0, 1, 2],
  colors: [1, 0, 0, 0, 1, 0, 0, 0, 1]
};

describe('export GLB (phase D, volet 19)', () => {
  test('couleurVersRgb : hex 6, hex 3, rgb(), défaut', () => {
    assert.deepEqual(couleurVersRgb('#ff0000'), [1, 0, 0]);
    assert.deepEqual(couleurVersRgb('#0f0'), [0, 1, 0]);
    assert.deepEqual(couleurVersRgb('rgb(0, 128, 255)').map(v => Math.round(v * 255)), [0, 128, 255]);
    assert.deepEqual(couleurVersRgb(undefined), [0.8, 0.8, 0.8]);
    assert.deepEqual(couleurVersRgb('nimp'), [0.8, 0.8, 0.8]);
  });

  test('buildGlb : en-tête et chunks conformes glTF 2.0 binaire', () => {
    const glb = buildGlb([triangle]);
    const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
    assert.equal(dv.getUint32(0, true), 0x20544C46);      // 'glTF'
    assert.equal(dv.getUint32(4, true), 2);                // version 2
    assert.equal(dv.getUint32(8, true), glb.length);       // longueur totale
    const jsonLen = dv.getUint32(12, true);
    assert.equal(dv.getUint32(16, true), 0x4E4F534A);      // 'JSON'
    const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLen)));
    assert.equal(json.asset.version, '2.0');
    assert.equal(json.meshes.length, 1);
    assert.equal(json.meshes[0].primitives[0].attributes.POSITION !== undefined, true);
    assert.equal(json.meshes[0].primitives[0].attributes.COLOR_0 !== undefined, true);
    const binOff = 20 + jsonLen;
    assert.equal((jsonLen + 20) % 4, 0, 'chunk JSON aligné sur 4');
    const binLen = dv.getUint32(binOff, true);
    assert.equal(dv.getUint32(binOff + 4, true), 0x004E4942); // 'BIN'
    assert.equal(binOff + 8 + binLen, glb.length);
    assert.equal(json.accessors[0].min.length, 3);
    assert.deepEqual(json.accessors[0].min, [0, 0, 0]);
    assert.deepEqual(json.accessors[0].max, [10, 10, 5]);
  });

  test('buildGlb → parseGlb : aller-retour des sommets (parseur existant du dépôt)', () => {
    const glb = buildGlb([triangle, { name: 'QUAD', positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], indices: [0, 1, 2, 0, 2, 3] }]);
    const mesh = parseGlb(glb);
    assert.equal(mesh.vertices.length, 3);
    assert.deepEqual(mesh.vertices[2], [0, 10, 5]);
    assert.equal(mesh.json.meshes.length, 2);
    assert.equal(mesh.json.meshes[1].name, 'QUAD');
    const acc = mesh.json.accessors[mesh.json.meshes[1].primitives[0].attributes.POSITION];
    assert.equal(acc.count, 4);
  });

  test('buildGlb : refuse un maillage vide ou des positions invalides', () => {
    assert.throws(() => buildGlb([]), /GLB_EMPTY/);
    assert.throws(() => buildGlb([{ name: 'x', positions: [1, 2] }]), /GLB_BAD_POSITIONS/);
    assert.throws(() => buildGlb([{ name: 'x', positions: triangle.positions, indices: [0, 99] }]), /GLB_BAD_INDICES/);
  });

  test('scene3dVersMeshes : quads → 2 triangles, polygones en éventail, zRef ajouté, groupes typés', () => {
    const sc = {
      faces: [
        { type: 'mur', pts3: [[0, 0, 0], [10, 0, 0], [10, 0, 8], [0, 0, 8]], fill: '#c0ffee' },
        { type: 'toit', pts3: [[0, 0, 8], [10, 0, 8], [10, 10, 8], [0, 10, 8]], fill: '#333333' },
        { type: 'arbre', pts3: [[1, 1, 0], [2, 1, 0], [1.5, 1, 3]], fill: '#2e7d32' },
        { type: 'mur', pts3: [[0, 0], [1, 1]], fill: '#fff' }   // invalide : ignorée
      ],
      maille: [{ pts: [[-5, -5, 0], [5, -5, 0], [5, 5, 0], [-5, 5, 0]], fill: '#c9bfa8' }]
    };
    const meshes = scene3dVersMeshes(sc, { zRef: 412.5 });
    const parNom = Object.fromEntries(meshes.map(m => [m.name, m]));
    assert.deepEqual(Object.keys(parNom).sort(), ['ARBRES', 'BATI', 'SOL', 'TOITS']);
    assert.equal(parNom.BATI.indices.length, 6);       // quad → 2 triangles
    assert.equal(parNom.TOITS.indices.length, 6);
    assert.equal(parNom.ARBRES.indices.length, 3);
    assert.equal(parNom.SOL.indices.length, 6);
    assert.equal(parNom.BATI.positions.length, 4 * 3);
    assert.ok(Math.abs(parNom.BATI.positions[2] - 412.5) < 1e-6, 'zRef ajouté à Z');
    assert.deepEqual(parNom.BATI.colors.slice(0, 3).map(v => Math.round(v * 255)), [0xc0, 0xff, 0xee]);
    /* le GLB produit se relit avec le parseur du dépôt */
    const glb = buildGlb(meshes);
    const relu = parseGlb(glb);
    assert.equal(relu.json.meshes.length, 4);
    assert.equal(relu.vertices.length, parNom.BATI.positions.length / 3);
  });

  test('scene3dVersMeshes : scène vide → liste vide', () => {
    assert.deepEqual(scene3dVersMeshes(null), []);
    assert.deepEqual(scene3dVersMeshes({ faces: [], maille: [] }), []);
  });
});
