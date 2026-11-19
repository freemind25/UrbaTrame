import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDxfText } from '../public/js/atelier/local-layers.mjs';

import {
  FACADE_VERSION, solveHomography, applyH, warpToRect, toGray, sobel,
  houghSegments, segmentsToEntities, facadeDxf, segmentsToSvg, validCorners
} from '../public/js/archi-facade.mjs';

const near = (a, e, tol, msg) =>
  assert.ok(Math.abs(a - e) <= tol, `${msg || ''} attendu ${e} ± ${tol}, obtenu ${a}`);

describe('solveHomography / applyH', () => {
  test('identité', () => {
    const pts = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const H = solveHomography(pts, pts);
    assert.ok(H);
    const [x, y] = applyH(H, 3, 7);
    near(x, 3, 1e-9); near(y, 7, 1e-9);
  });
  test('translation + échelle connue', () => {
    const src = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const dst = [[5, 5], [25, 5], [25, 25], [5, 25]];   // x2 + (5,5)
    const H = solveHomography(src, dst);
    assert.ok(H);
    const [x, y] = applyH(H, 4, 6);
    near(x, 13, 1e-9, 'x'); near(y, 17, 1e-9, 'y');
  });
  test('points alignés -> null', () => {
    const bad = [[0, 0], [1, 1], [2, 2], [3, 3]];
    assert.equal(solveHomography(bad, [[0, 0], [1, 0], [2, 0], [3, 0]]), null);
  });
  test('mauvais nombre de points -> null', () => {
    assert.equal(solveHomography([[0, 0], [1, 0], [1, 1]], [[0, 0], [1, 0], [1, 1]]), null);
  });
});

describe('warpToRect', () => {
  test('rectification identité conserve les pixels', () => {
    const w = 6, h = 6;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) { data[i * 4] = (i * 7) % 256; data[i * 4 + 3] = 255; }
    const img = { data, width: w, height: h };
    const pts = [[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]];
    const out = warpToRect(img, pts, w, h);
    assert.ok(out);
    assert.equal(out.width, w); assert.equal(out.height, h);
    for (let i = 0; i < w * h * 4; i++) assert.equal(out.data[i], data[i], `pixel ${i}`);
  });
  test('points dégénérés -> null', () => {
    const img = { data: new Uint8ClampedArray(16 * 4), width: 4, height: 4 };
    assert.equal(warpToRect(img, [[0, 0], [1, 1], [2, 2], [3, 3]], 4, 4), null);
  });
});

describe('toGray / sobel / houghSegments', () => {
  test('sobel détecte un bord vertical', () => {
    const w = 20, h = 20;
    const g = new Float32Array(w * h).fill(0);
    for (let y = 0; y < h; y++) for (let x = 10; x < w; x++) g[y * w + x] = 255;
    const mag = sobel(g, w, h);
    assert.ok(mag[10 * w + 10] > 200, `bord fort attendu, obtenu ${mag[10 * w + 10]}`);
    assert.ok(mag[10 * w + 3] < 10, 'zone plate: pas de contour');
  });
  test('hough retrouve une ligne horizontale synthétique', () => {
    const w = 60, h = 40;
    const mag = new Float32Array(w * h);
    for (let x = 5; x < 55; x++) mag[20 * w + x] = 500;   // ligne horizontale y=20
    const segs = houghSegments(mag, w, h, { seuil: 100, minLen: 20, maxGap: 2 });
    assert.ok(segs.length >= 1, 'au moins un segment');
    const s = segs[0];
    near(s.a[1], 20, 2, 'y début'); near(s.b[1], 20, 2, 'y fin');
    const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
    assert.ok(len >= 40, `longueur ${len}`);
  });
  test('hough ne retourne rien sur image vide', () => {
    const mag = new Float32Array(30 * 30);
    assert.equal(houghSegments(mag, 30, 30, { seuil: 100, minLen: 10 }).length, 0);
  });
});

describe('exports', () => {
  test('segmentsToEntities : échelle + retournement Y', () => {
    const segs = [{ a: [10, 5], b: [30, 5], votes: 9 }];
    const ents = segmentsToEntities(segs, 100, 0.5);
    assert.equal(ents.length, 1);
    assert.equal(ents[0].t, 'ligne');
    assert.equal(ents[0].calque, 'FACADE');
    near(ents[0].a[0], 5, 1e-9); near(ents[0].a[1], (100 - 5) * 0.5, 1e-9);
    near(ents[0].b[0], 15, 1e-9);
  });
  test('facadeDxf produit un DXF R12 valide', () => {
    const segs = [{ a: [0, 0], b: [100, 0], votes: 50 }, { a: [0, 0], b: [0, 80], votes: 40 }];
    const out = facadeDxf(segs, 100, 0.1, 'Test facade');
    assert.ok(out.includes('AC1009'), 'version R12');
    assert.ok((out.match(/\nLINE\n/g) || []).length === 2, '2 entités LINE');
    assert.ok(out.includes('FACADE'), 'calque FACADE');
    assert.ok(out.trimEnd().endsWith('EOF'), 'fin EOF');
    assert.ok(out.includes('$INSUNITS'), 'unités métriques déclarées');
  });
  test('segmentsToSvg bien formé', () => {
    const svg = segmentsToSvg([{ a: [1, 2], b: [3, 4], votes: 1 }], 10, 10);
    assert.ok(svg.startsWith('<svg'));
    assert.ok(svg.includes('<line'));
    assert.ok(svg.trimEnd().endsWith('</svg>'));
  });
  test('version exportée', () => {
    assert.equal(typeof FACADE_VERSION, 'string');
  });
});


describe('validation et interopérabilité', () => {
  test('quadrilatère convexe accepté ; croisé, aplati et incomplet refusés', () => {
    assert.equal(validCorners([[1, 1], [50, 4], [45, 60], [2, 50]]), true);
    assert.equal(validCorners([[1, 1], [45, 60], [50, 4], [2, 50]]), false);
    assert.equal(validCorners([[0, 0], [10, 0], [20, 0], [0, 10]]), false);
    assert.equal(validCorners([[0, 0], [1, 1]]), false);
  });
  test('homographie perspective : les quatre coins correspondent', () => {
    const a = [[0, 0], [100, 0], [100, 80], [0, 80]];
    const b = [[10, 5], [90, 13], [110, 95], [2, 85]];
    const H = solveHomography(a, b);
    for (let i = 0; i < 4; i++) {
      const p = applyH(H, ...a[i]); near(p[0], b[i][0], 1e-7); near(p[1], b[i][1], 1e-7);
    }
  });
  test('DXF relu par le parseur du projet et échelles x/y exactes', () => {
    const data = facadeDxf([{a:[0,0], b:[400,200]}], 200, 12 / 400, 'Test', 8 / 200);
    const parsed = parseDxfText(data);
    assert.equal(parsed.entities.length, 1);
    assert.equal(parsed.entities[0].kind, 'line');
    assert.ok(data.includes('11\n12.000\n21\n0.000'));
    assert.ok(data.includes('10\n0.000\n20\n8.000'));
  });
});

describe('nettoyage et édition de façade', () => {
  test('supprime seulement le doublon proche, conserve les lignes éloignées et croisées', async () => {
    const { removeDuplicateSegments } = await import('../public/js/archi-facade.mjs');
    const a = { a: [0, 0], b: [100, 0] };
    const b = { a: [100, 1], b: [0, 1] };
    const c = { a: [0, 8], b: [100, 8] };
    const d = { a: [50, -50], b: [50, 50] };
    assert.deepEqual(removeDuplicateSegments([a, b, c, d], 2), [a, c, d]);
    assert.equal(removeDuplicateSegments([a, b], 0).length, 2);
    assert.equal(removeDuplicateSegments([a, {...b, layer: 'FENETRE'}], 2).length, 2);
  });
  test('ne fusionne pas des lignes partiellement superposées ou de longueur très différente', async () => {
    const { removeDuplicateSegments } = await import('../public/js/archi-facade.mjs');
    assert.equal(removeDuplicateSegments([{a:[0,0],b:[100,0]}, {a:[40,0],b:[140,0]}], 2).length, 2);
    assert.equal(removeDuplicateSegments([{a:[0,0],b:[100,0]}, {a:[10,0],b:[50,0]}], 2).length, 2);
  });
  test('sélection du segment le plus proche et distance maximale', async () => {
    const { nearestSegment } = await import('../public/js/archi-facade.mjs');
    const segs = [{a:[0,0],b:[10,0]}, {a:[0,10],b:[10,10]}];
    assert.equal(nearestSegment(segs, [5,9], 3), 1);
    assert.equal(nearestSegment(segs, [30,30], 3), -1);
  });
  test('calques manuels préservés en DXF et SVG ; calques inconnus refusés', () => {
    const lines = [{a:[0,0],b:[10,10], layer:'FENETRE'}, {a:[0,2],b:[10,2], layer:'HYPOTHESE'}, {a:[1,1],b:[2,2],layer:'BAD\n0\nEOF'}];
    const parsed = parseDxfText(facadeDxf(lines, 20, 1));
    assert.deepEqual(parsed.entities.map(e => e.layer), ['FENETRE', 'HYPOTHESE', 'FACADE']);
    const svg = segmentsToSvg(lines,20,20);
    assert.match(svg, /data-layer="FENETRE"/); assert.match(svg, /data-layer="HYPOTHESE"/);
    assert.doesNotMatch(svg, /BAD/);
  });
});
