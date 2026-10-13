import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { planPNG, sectionPNG, scenePNG } from '../tools/atelier/png.mjs';
import { loadKernel, makeCtx, sceneFor } from '../tools/atelier/kernel.mjs';
import * as X from '../public/js/atelier/exports.mjs';

const pngSize = b => [b.readUInt32BE(16), b.readUInt32BE(20)];
function pixelRGBA(b, x, y) {
  let i = 8, chunks = [];
  while (i < b.length) {
    const n = b.readUInt32BE(i), type = b.toString('ascii', i + 4, i + 8);
    if (type === 'IDAT') chunks.push(b.subarray(i + 8, i + 8 + n));
    i += n + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks)), w = pngSize(b)[0], stride = w * 4 + 1;
  assert.equal(raw[y * stride], 0, 'le rasteriseur utilise les lignes PNG sans filtre');
  return [...raw.subarray(y * stride + 1 + x * 4, y * stride + 1 + x * 4 + 4)];
}
const checkPNG = (b, w, h) => {
  assert.deepEqual([...b.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.deepEqual(pngSize(b), [w, h]);
};

describe('aperçus PNG autonomes de la CLI', () => {
  test('le plan est encodé en PNG RGBA', () => {
    const b = planPNG([{ t: 'poly', calque: 'BATI', ferme: true, pts: [[0,0],[10,0],[10,10],[0,10]] }], { width: 80, height: 60 });
    checkPNG(b, 80, 60);
  });
  test('la coupe est encodée avec son profil et le bâti traversé', () => {
    const b = sectionPNG({ longueur: 100, zMin: 5, zMax: 15, pts: [{d:0,z:5},{d:100,z:15}], bati: [{d0:40,d1:60,z0:9,z1:11,h:8}] }, { width: 240, height: 100 });
    checkPNG(b, 240, 100);
  });
  test('la vue 3D accepte le maillage relief/bâti', () => {
    loadKernel();
    const ctx = makeCtx();
    const scene = sceneFor(ctx, { width: 300, height: 220 });
    const b = scenePNG(scene, { width: 300, height: 220 });
    checkPNG(b, 300, 220);
  });
  test('le rasteriseur reconnaît les couleurs CSS rgb des faces 3D', () => {
    const cam = { W: 40, H: 40, projLocal: (x, y, z) => [x, y, z], ecran: p => p };
    const b = scenePNG({ cam, maille: [{ pts: [[5,5,0],[35,5,0],[35,35,0],[5,35,0]], fill: 'rgb(200,198,194)' }], ombres: [], arbres: [], faces: [] }, { width: 40, height: 40 });
    assert.deepEqual(pixelRGBA(b, 20, 10), [200, 198, 194, 255]);
  });
});
