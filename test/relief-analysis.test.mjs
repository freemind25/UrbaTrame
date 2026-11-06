/* Analyses du relief (phase C) : pente/exposition, TWI, hydrologie D8,
   bassins versants, plaques de découpe laser. Tout est hors ligne sur des
   DEM synthétiques. */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  gridStats, slopeAspectGrid, twiGrid, flowDirD8, flowAccumulation,
  streamCells, watershedAt, contourIntervalChoice, bandRings, laserPlates,
  platesDxfEntities, platesSvg, explodeSvg, CONTOUR_STEPS
} from '../public/js/terrain/relief-analysis.mjs';

/* DEM 12×12 : pente régulière vers l'est + puits central. */
function dem() {
  const n = 12, grid = [];
  for (let j = 0; j < n; j++) { const row = []; for (let i = 0; i < n; i++) row.push(1000 + i * 8 + j * 2); grid.push(row); }
  grid[6][6] = 990;
  return { lat: 36.365, lon: 6.6147, radius: 550, grid };
}
const flat = () => ({ lat: 36.365, lon: 6.6147, radius: 550, grid: Array.from({ length: 8 }, () => Array(8).fill(1000)) });
/* DEM plat avec un seul puits central : tout le bassin versant y aboutit. */
const pitDem = () => {
  const grid = Array.from({ length: 12 }, () => Array(12).fill(1000));
  grid[6][6] = 990;
  return { lat: 36.365, lon: 6.6147, radius: 550, grid };
};

describe('grille et pentes', () => {
  test('gridStats : min/max/mPerCell', () => {
    const g = gridStats(dem());
    assert.equal(g.n, 12);
    assert.equal(g.min, 990);
    assert.ok(Math.abs(g.mPerCell - 1100 / 11) < 1e-9);
    assert.equal(gridStats(null), null);
    assert.equal(gridStats({ grid: [[1, 2], [3]] }), null);
  });

  test('terrain plat : pente 0 partout ; pente est : versant exposé à l’ouest (270°)', () => {
    const f = slopeAspectGrid(flat());
    assert.ok(f.maxSlope < 1e-9);
    const s = slopeAspectGrid(dem());
    assert.ok(s.meanSlope > 3 && s.maxSlope > 10);
    const a = s.aspect[6 * 12 + 10];   // cellule à l’est : descend vers l’ouest
    assert.ok(Math.abs(a - 270) < 25, 'aspect ≈ 270°, reçu ' + a);
  });

  test('choix du pas de courbes : arrondi au pas valide le plus proche', () => {
    assert.equal(contourIntervalChoice(1000, 1100, 5), 5);
    assert.equal(contourIntervalChoice(1000, 1008, 10), 2);   // amplitude 8 → pas ≤ 4
    assert.equal(contourIntervalChoice(1000, 1100, 7), 5);
    assert.ok(CONTOUR_STEPS.includes(1) && CONTOUR_STEPS.includes(50));
  });
});

describe('hydrologie D8', () => {
  test('le puits reçoit l’accumulation amont ; un point haut a acc = 1', () => {
    const acc = flowAccumulation(dem());
    assert.ok(acc.acc[6 * 12 + 6] > 15, 'puits drainé : ' + acc.acc[6 * 12 + 6]);
    assert.equal(acc.acc[0 * 12 + 11], 1, 'coin haut-est isolé');
    assert.ok(acc.maxAcc >= acc.acc[6 * 12 + 6]);
  });

  test('streamCells : seuil explicite puis défaut', () => {
    const st = streamCells(dem(), 5);
    assert.ok(st.cells.length > 5);
    assert.equal(st.threshold, 5);
    const def = streamCells(pitDem(), 0);
    assert.ok(def.threshold >= 20, 'seuil par défaut ≥ 20 cellules');
  });

  test('watershedAt : plateau à puits central → bassin = puits + ses 8 voisins (D8 strict)', () => {
    const ws = watershedAt(pitDem(), 6, 6);
    assert.equal(ws.cells.length, 9, 'puits + 8 voisins drainent vers le puits');
    assert.ok(ws.cells.some(([i, j]) => i === 6 && j === 6));
    assert.ok(ws.areaM2 > 0);
    assert.equal(watershedAt(pitDem(), 99, 99), null);
  });

  test('TWI : le puits central (accumulation max, pente plafonnée) a le TWI max', () => {
    const twi = twiGrid(pitDem());
    let idxMax = 0;
    for (let k = 0; k < twi.twi.length; k++) if (twi.twi[k] > twi.twi[idxMax]) idxMax = k;
    assert.equal(idxMax, 6 * 12 + 6, 'TWI max au puits');
    assert.ok(twi.max > twi.min);
  });
});

describe('plaques de découpe laser', () => {
  test('bandRings : bande pleine = 1 anneau fermé ; donut = 2 anneaux', () => {
    const full = Array.from({ length: 6 }, () => Array(6).fill(500));
    const r1 = bandRings(full, 6, 0, 1000);
    assert.equal(r1.length, 1);
    assert.equal(r1[0].length, 25);
    assert.deepEqual(r1[0][0], r1[0].at(-1));
    const donut = Array.from({ length: 6 }, (_, j) => Array.from({ length: 6 }, (_, i) => (i >= 2 && i <= 3 && j >= 2 && j <= 3) ? 100 : 500));
    const r2 = bandRings(donut, 6, 300, 600);
    assert.equal(r2.length, 2);
    const aires = r2.map(r => { let a = 0; for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return Math.abs(a / 2); });
    assert.deepEqual(aires.sort((a, b) => b - a), [36, 4]);
  });

  test('laserPlates : plaques numérotées, pas respecté, aires cohérentes', () => {
    const laser = laserPlates(dem(), { pas: 10 });
    assert.ok(laser.plates.length >= 10);
    assert.equal(laser.plates[0].numero, 1);
    assert.equal(laser.plates[1].numero, 2);
    assert.equal(laser.pas, 10);
    const total = laser.plates.reduce((a, p) => a + p.areaM2, 0);
    const grille = 12 * 12 * 100 * 100;   // n² × mPerCell²
    assert.ok(Math.abs(total - grille) / grille < 0.001, `somme des aires ${total} vs grille ${grille}`);
    for (const p of laser.plates) assert.ok(p.rings.length >= 1 && p.coteMax - p.coteMin === 10);
  });

  test('exports : entités DXF (PLAQUES + TEXTE, Z = cote), SVG plaque, pile éclatée', () => {
    const laser = laserPlates(dem(), { pas: 20 });
    const { entites, calques } = platesDxfEntities(laser, { origine: [0, 0] });
    assert.ok(calques.some(c => c.nom === 'PLAQUES'));
    assert.ok(calques.some(c => c.nom === 'TEXTE'));
    const polys = entites.filter(e => e.t === 'poly');
    assert.ok(polys.length >= laser.plates.length);
    assert.ok(polys.every(e => e.calque === 'PLAQUES' && e.ferme && Number.isFinite(e.z)));
    assert.ok(entites.some(e => e.t === 'texte' && /P\d+ · \d+ m/.test(e.txt)));
    const svg = platesSvg(laser.plates[0], laser, { titre: 'Test' });
    assert.ok(svg.startsWith('<svg') && svg.includes('PLAQUE n°1') && svg.includes('100 m'));
    const ex = explodeSvg(laser);
    assert.ok(ex.startsWith('<svg') && ex.includes('P1') && ex.includes('P' + laser.plates.length));
  });
});
