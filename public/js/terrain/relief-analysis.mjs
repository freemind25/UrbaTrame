/* UrbaTrame · analyses du relief (phase C, inspirées de LANDFORM/ildar.space)
   ─────────────────────────────────────────────────────────────────────────
   Tout est calculé hors ligne, dans le navigateur, sur la grille DEM Terrarium
   déjà chargée : pente/exposition (Horn), hydrologie D8 (écoulement, accumulation,
   cours d'eau, bassins versants), indice d'humidité topographique (TWI), pas de
   courbes de niveau choisi par l'utilisateur, et plaques de découpe laser
   par niveau d'altitude (anneaux fermés, pièces numérotées, export SVG/DXF).

   Approximations pédagogiques affichées comme telles (« computed, not
   surveyed ») : ce n'est ni un relevé, ni un modèle hydraulique certifié.
   Aucune donnée externe : aucune requête réseau depuis ce module.
   ───────────────────────────────────────────────────────────────────────── */

export const CONTOUR_STEPS = [1, 2, 5, 10, 20, 50];

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const norm360 = a => ((a % 360) + 360) % 360;

/* Directions D8 : [di, dj] avec j vers le sud (ligne 0 = nord), et distance. */
const D8 = [
  [1, 0, 1], [1, -1, Math.SQRT2], [0, -1, 1], [-1, -1, Math.SQRT2],
  [-1, 0, 1], [-1, 1, Math.SQRT2], [0, 1, 1], [1, 1, Math.SQRT2]
];

/* ─────────────── grille ─────────────── */

export function gridStats(t) {
  if (!t || !Array.isArray(t.grid) || t.grid.length < 2) return null;
  const n = t.grid.length;
  if (!t.grid.every(row => Array.isArray(row) && row.length === n)) return null;
  let min = Infinity, max = -Infinity;
  for (const row of t.grid)
    for (const v of row) {
      if (!Number.isFinite(v)) return null;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  const radius = Number(t.radius);
  const mPerCell = Number.isFinite(radius) && radius > 0 ? 2 * radius / (n - 1) : NaN;
  return { n, grid: t.grid, min, max, range: max - min, mPerCell };
}

/* Pente et exposition (Horn 1981), bords répliqués. Exposition = direction
   de la plus forte pente descendante, en degrés depuis le nord (0=N, 90=E). */
export function slopeAspectGrid(t) {
  const g = gridStats(t);
  if (!g) return null;
  const { n, grid, mPerCell } = g;
  const at = (i, j) => grid[Math.max(0, Math.min(n - 1, j))][Math.max(0, Math.min(n - 1, i))];
  const slope = new Float64Array(n * n);
  const aspect = new Float64Array(n * n);
  let sum = 0, maxSlope = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const dzdx = ((at(i + 1, j - 1) + 2 * at(i + 1, j) + at(i + 1, j + 1)) -
                    (at(i - 1, j - 1) + 2 * at(i - 1, j) + at(i - 1, j + 1))) / (8 * mPerCell);
      const dzdyN = ((at(i - 1, j - 1) + 2 * at(i, j - 1) + at(i + 1, j - 1)) -
                     (at(i - 1, j + 1) + 2 * at(i, j + 1) + at(i + 1, j + 1))) / (8 * mPerCell);
      const s = Math.atan(Math.hypot(dzdx, dzdyN)) * R2D;
      const a = s > 1e-12 ? norm360(Math.atan2(-dzdx, -dzdyN) * R2D) : 0;
      const k = j * n + i;
      slope[k] = s;
      aspect[k] = a;
      sum += s;
      if (s > maxSlope) maxSlope = s;
    }
  }
  return { n, slope, aspect, meanSlope: sum / (n * n), maxSlope, mPerCell, min: g.min, max: g.max };
}

/* ─────────────── hydrologie D8 ─────────────── */

/* Direction d'écoulement de chaque cellule vers son voisin le plus bas
   (strictement plus bas, pondéré par la distance) ; -1 pour les puits et
   les plateaux plats (pas d'écoulement préférentiel). */
export function flowDirD8(t) {
  const g = gridStats(t);
  if (!g) return null;
  const { n, grid } = g;
  const dir = new Int8Array(n * n).fill(-1);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const z = grid[j][i];
      let best = 0, bestDir = -1;
      for (let d = 0; d < 8; d++) {
        const ni = i + D8[d][0], nj = j + D8[d][1];
        if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
        const score = (grid[nj][ni] - z) / D8[d][2];
        if (score < best) { best = score; bestDir = d; }
      }
      dir[j * n + i] = bestDir;
    }
  }
  return { dir, n, mPerCell: g.mPerCell, min: g.min, max: g.max };
}

/* Accumulation de flux : chaque cellule vaut 1 + la somme de ce que lui
   apportent ses amonts (tri par altitude décroissante). */
export function flowAccumulation(t) {
  const g = gridStats(t);
  const f = flowDirD8(t);
  if (!g || !f) return null;
  const n = g.n;
  const order = Array.from({ length: n * n }, (_, k) => k)
    .sort((a, b) => g.grid[Math.floor(b / n)][b % n] - g.grid[Math.floor(a / n)][a % n]);
  const acc = new Float64Array(n * n).fill(1);
  let maxAcc = 1;
  for (const k of order) {
    const d = f.dir[k];
    if (d < 0) continue;
    const i = k % n, j = Math.floor(k / n);
    const nk = (j + D8[d][1]) * n + (i + D8[d][0]);
    acc[nk] += acc[k];
  }
  for (let k = 0; k < n * n; k++) if (acc[k] > maxAcc) maxAcc = acc[k];
  return { acc, maxAcc, dir: f.dir, n, mPerCell: g.mPerCell };
}

/* Cours d'eau simulés : cellules dont l'accumulation dépasse le seuil.
   Sans seuil explicite, on prend au moins 20 cellules (seuil par défaut). */
export function streamCells(t, threshold = 0) {
  const a = flowAccumulation(t);
  if (!a) return null;
  const seuil = threshold > 0 ? threshold : Math.max(20, Math.ceil(a.n * a.n / 8));
  const cells = [];
  for (let j = 0; j < a.n; j++)
    for (let i = 0; i < a.n; i++)
      if (a.acc[j * a.n + i] >= seuil) cells.push([i, j]);
  return { cells, threshold: seuil, acc: a.acc, n: a.n };
}

/* Bassin versant amont d'une cellule : la cellule + toutes celles dont le
   chemin D8 y aboutit. Renvoie null hors grille. */
export function watershedAt(t, i, j) {
  const f = flowDirD8(t);
  if (!f) return null;
  const n = f.n;
  if (!Number.isInteger(i) || !Number.isInteger(j) || i < 0 || j < 0 || i >= n || j >= n) return null;
  const rev = Array.from({ length: n * n }, () => []);
  for (let k = 0; k < n * n; k++) {
    const d = f.dir[k];
    if (d < 0) continue;
    const ci = k % n, cj = Math.floor(k / n);
    rev[(cj + D8[d][1]) * n + (ci + D8[d][0])].push(k);
  }
  const start = j * n + i;
  const vu = new Set([start]);
  const pile = [start];
  while (pile.length) {
    const k = pile.pop();
    for (const amont of rev[k]) {
      if (vu.has(amont)) continue;
      vu.add(amont);
      pile.push(amont);
    }
  }
  const cells = [...vu].map(k => [k % n, Math.floor(k / n)]);
  return { cells, areaM2: cells.length * f.mPerCell * f.mPerCell, i, j, n, mPerCell: f.mPerCell };
}

/* Indice d'humidité topographique : TWI = ln(a / tan β), a = aire spécifique
   amont (accumulation × surface cellule / largeur cellule), β = pente locale
   plafonnée à ~0,057° pour éviter la division par zéro en terrain plat. */
export function twiGrid(t) {
  const g = gridStats(t);
  const s = slopeAspectGrid(t);
  const a = flowAccumulation(t);
  if (!g || !s || !a) return null;
  const n = g.n, m = g.mPerCell;
  const twi = new Float64Array(n * n);
  let min = Infinity, max = -Infinity;
  for (let k = 0; k < n * n; k++) {
    const aireSpecifique = a.acc[k] * m;                 // m² de bassin par mètre de courbe
    const tanBeta = Math.max(Math.tan(s.slope[k] * D2R), 0.001);
    const v = Math.log(aireSpecifique / tanBeta);
    twi[k] = v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { twi, min, max, n, mPerCell: m };
}

/* ─────────────── courbes de niveau ─────────────── */

/* Pas proposé à l'utilisateur : le pas valide le plus proche du pas demandé,
   en exigeant au moins ~4 courbes dans l'amplitude du DEM. */
export function contourIntervalChoice(min, max, wanted = 10) {
  const amp = Math.max(0, Number(max) - Number(min));
  const eligible = CONTOUR_STEPS.filter(s => amp / s >= 4);
  const pool = eligible.length ? eligible : [CONTOUR_STEPS[0]];
  let best = pool[0];
  for (const s of pool)
    if (Math.abs(s - wanted) < Math.abs(best - wanted)) best = s;
  return best;
}

/* Segments de courbes de niveau (marching squares) en coordonnées de cellule
   (x = colonne, y = ligne, origine haut-gauche). Pour le rendu cartographique. */
export function contourSegments(t, interval) {
  const g = gridStats(t);
  if (!g || !(interval > 0)) return [];
  const { n, grid } = g;
  const segs = [];
  const inter = (z1, z2, p1, p2, cote) => {
    const f = (cote - z1) / (z2 - z1);
    return [p1[0] + (p2[0] - p1[0]) * f, p1[1] + (p2[1] - p1[1]) * f];
  };
  for (let cote = Math.ceil(g.min / interval) * interval; cote < g.max; cote += interval) {
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const z00 = grid[j][i], z10 = grid[j][i + 1], z11 = grid[j + 1][i + 1], z01 = grid[j + 1][i];
        const coins = [[i, j, z00], [i + 1, j, z10], [i + 1, j + 1, z11], [i, j + 1, z01]];
        let idx = 0;
        coins.forEach((c, k) => { if (c[2] < cote) idx |= 1 << k; });
        if (idx === 0 || idx === 15) continue;
        const pts = [];
        const bord = k => {
          const a = coins[k], b = coins[(k + 1) % 4];
          if ((a[2] < cote) !== (b[2] < cote)) pts.push(inter(a[2], b[2], [a[0], a[1]], [b[0], b[1]], cote));
        };
        bord(0); bord(1); bord(2); bord(3);
        if (pts.length >= 2) segs.push({ cote, pts: [pts[0], pts[pts.length - 1]] });
      }
    }
  }
  return segs;
}

/* ─────────────── plaques de découpe laser ─────────────── */

/* Anneaux fermés des cellules d'une bande d'altitude [lo, hi[.
   Les arêtes de la frontière sont chaînées une à une (liste + listes
   d'adjacence, jamais de Map indexée sur le seul point de départ : aux
   contacts en diagonale deux arêtes partagent le même sommet, et le contact
   diagonal doit rester deux anneaux distincts). Coordonnées en coins de
   cellule ; chaque anneau est refermé (premier = dernier). */
export function bandRings(grid, n, lo, hi) {
  const dans = (i, j) => i >= 0 && j >= 0 && i < n && j < n && grid[j][i] >= lo && grid[j][i] < hi;
  const aretes = [];   // [x1, y1, x2, y2]
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      if (!dans(i, j)) continue;
      if (!dans(i, j - 1)) aretes.push([i + 1, j, i, j]);
      if (!dans(i + 1, j)) aretes.push([i + 1, j + 1, i + 1, j]);
      if (!dans(i, j + 1)) aretes.push([i, j + 1, i + 1, j + 1]);
      if (!dans(i - 1, j)) aretes.push([i, j, i, j + 1]);
    }
  }
  const cle = (x, y) => x + ',' + y;
  const sortant = new Map();   // sommet de départ -> [{vers, index}]
  aretes.forEach((a, index) => {
    const k = cle(a[0], a[1]);
    if (!sortant.has(k)) sortant.set(k, []);
    sortant.get(k).push({ vers: [a[2], a[3]], index });
  });
  const utilisee = new Array(aretes.length).fill(false);
  const anneaux = [];
  for (let e0 = 0; e0 < aretes.length; e0++) {
    if (utilisee[e0]) continue;
    const a0 = aretes[e0];
    utilisee[e0] = true;
    const anneau = [[a0[0], a0[1]]];
    let courant = [a0[2], a0[3]];
    let precedent = [a0[0], a0[1]];
    const depart = [a0[0], a0[1]];
    while (!(courant[0] === depart[0] && courant[1] === depart[1])) {
      anneau.push(courant);
      const din = [courant[0] - precedent[0], courant[1] - precedent[1]];
      const candidats = (sortant.get(cle(courant[0], courant[1])) || []).filter(c => !utilisee[c.index]);
      if (!candidats.length) break;
      let choix = candidats[0], angleMax = -Infinity;
      for (const c of candidats) {
        const dout = [c.vers[0] - courant[0], c.vers[1] - courant[1]];
        /* virage le plus à gauche possible : atan2(cross, dot), le plus grand
           angle gagne (demi-tour exclu de fait par la grille) */
        const angle = Math.atan2(din[0] * dout[1] - din[1] * dout[0], din[0] * dout[0] + din[1] * dout[1]);
        if (angle > angleMax) { angleMax = angle; choix = c; }
      }
      utilisee[choix.index] = true;
      precedent = courant;
      courant = choix.vers;
    }
    anneau.push(depart);   // anneau fermé
    anneaux.push(anneau);
  }
  return anneaux;
}

const aireAnneau = ring => {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++)
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return Math.abs(a / 2);
};

/* Plaques par niveau d'altitude : une plaque par bande de `pas` mètres,
   numérotée, avec ses anneaux (cellules) et son aire. La somme des aires
   couvre exactement la grille. */
export function laserPlates(t, o = {}) {
  const g = gridStats(t);
  if (!g) return null;
  const pas = Number(o.pas) > 0 ? Number(o.pas) : 10;
  const { n, grid, mPerCell } = g;
  const coteMin0 = Math.floor(g.min / pas) * pas;
  const plates = [];
  /* borne haute incluse : la cellule la plus haute (z = max) doit avoir sa
     plaque, même quand max tombe exactement sur un multiple du pas */
  for (let cote = coteMin0; cote <= g.max; cote += pas) {
    const rings = bandRings(grid, n, cote, cote + pas);
    if (!rings.length) continue;
    let cells = 0, aire = 0;
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++)
        if (grid[j][i] >= cote && grid[j][i] < cote + pas) cells++;
    for (const r of rings) aire += aireAnneau(r);
    plates.push({
      numero: plates.length + 1, coteMin: cote, coteMax: cote + pas,
      rings, cells, areaM2: aire * mPerCell * mPerCell
    });
  }
  return {
    pas, plates, n, mPerCell, min: g.min, max: g.max,
    totalAreaM2: plates.reduce((a, p) => a + p.areaM2, 0)
  };
}

/* Entités DXF des plaques (calques PLAQUES + TEXTE, Z = cote de la plaque),
   directement consommables par le writer DXF de l'atelier. */
export function platesDxfEntities(laser, o = {}) {
  if (!laser) return { entites: [], calques: [] };
  const origine = Array.isArray(o.origine) ? o.origine : [0, 0];
  const m = laser.mPerCell;
  const entites = [];
  for (const p of laser.plates) {
    for (const ring of p.rings) {
      entites.push({
        t: 'poly', calque: 'PLAQUES', ferme: true, z: p.coteMin,
        pts: ring.map(([x, y]) => [origine[0] + x * m, origine[1] + y * m])
      });
    }
    /* étiquette au centre de la plus grande emprise */
    const grand = p.rings.reduce((a, r) => (aireAnneau(r) > aireAnneau(a) ? r : a), p.rings[0]);
    let cx = 0, cy = 0;
    for (const [x, y] of grand) { cx += x; cy += y; }
    cx /= grand.length; cy /= grand.length;
    entites.push({
      t: 'texte', calque: 'TEXTE', z: p.coteMin, h: m * 0.6, align: 'center',
      pos: [origine[0] + cx * m, origine[1] + cy * m],
      txt: `P${p.numero} · ${p.coteMin} m`
    });
  }
  return {
    entites,
    calques: [{ nom: 'PLAQUES', couleur: 'blanc' }, { nom: 'TEXTE', couleur: 'bleu' }]
  };
}

/* ─────────────── exports graphiques des plaques ─────────────── */

const fmt = v => Math.round(v * 100) / 100;

function echelleAnneaux(rings, largeur, hauteur, marge) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings)
    for (const [x, y] of r) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  const sx = (largeur - 2 * marge) / Math.max(1e-9, x1 - x0);
  const sy = (hauteur - 2 * marge) / Math.max(1e-9, y1 - y0);
  const s = Math.min(sx, sy);
  return { s, x0, y0, ox: marge + (largeur - 2 * marge - (x1 - x0) * s) / 2, oy: marge + (hauteur - 2 * marge - (y1 - y0) * s) / 2 };
}

/* SVG d'une plaque individuelle (pièce à découper), avec cartouche et
   échelle graphique d'une cellule. */
export function platesSvg(plate, laser, o = {}) {
  const W = 640, H = 460, marge = 46;
  const e = echelleAnneaux(plate.rings, W, H - 90, marge);
  const proj = ([x, y]) => [e.ox + (x - e.x0) * e.s, H - 70 - (e.oy + (y - e.y0) * e.s)];
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="sans-serif">`;
  svg += `<rect width="${W}" height="${H}" fill="#ffffff"/>`;
  svg += `<text x="${marge}" y="30" font-size="16" font-weight="bold">PLAQUE n°${plate.numero}${o.titre ? ' — ' + o.titre : ''}</text>`;
  svg += `<text x="${marge}" y="48" font-size="12" fill="#555">Cote ${plate.coteMin} – ${plate.coteMax} m · ${plate.cells} cellules · aire ${(plate.areaM2 / 10000).toFixed(2)} ha · échelle 1:${Math.max(1, Math.round(laser.mPerCell * 100 / e.s))}</text>`;
  for (const ring of plate.rings) {
    const pts = ring.map(p => proj(p).map(fmt).join(',')).join(' ');
    svg += `<polygon points="${pts}" fill="none" stroke="#153e3d" stroke-width="1.6"/>`;
  }
  /* échelle graphique : une cellule du DEM */
  const barre = laser.mPerCell * e.s;
  svg += `<line x1="${W - marge - barre}" y1="${H - 24}" x2="${W - marge}" y2="${H - 24}" stroke="#153e3d" stroke-width="2"/>`;
  svg += `<text x="${W - marge - barre}" y="${H - 30}" font-size="11" fill="#153e3d">${laser.mPerCell} m</text>`;
  svg += `<text x="${marge}" y="${H - 12}" font-size="10" fill="#777">UrbaTrame · découpe laser (SVG) · DEM indicatif « computed, not surveyed » · pas ${laser.pas} m</text>`;
  svg += '</svg>';
  return svg;
}

/* Pile éclatée en axonométrie : toutes les plaques empilées, décalées, étiquetées. */
export function explodeSvg(laser, o = {}) {
  const W = 720, H = 520;
  const n = laser.plates.length;
  const dx = 26, dy = 14;
  const e = echelleAnneaux(laser.plates.flatMap(p => p.rings), W - 2 * dx * Math.min(n, 12), H - 120, 60);
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="sans-serif">`;
  svg += `<rect width="${W}" height="${H}" fill="#ffffff"/>`;
  svg += `<text x="30" y="30" font-size="16" font-weight="bold">Pile éclatée — ${n} plaques · pas ${laser.pas} m${o.titre ? ' — ' + o.titre : ''}</text>`;
  for (let k = 0; k < n; k++) {
    const p = laser.plates[k];
    const off = [30 + (n - 1 - k) * dx * 0.6, 60 + (n - 1 - k) * dy];
    for (const ring of p.rings) {
      const pts = ring.map(([x, y]) => fmt(off[0] + (x - e.x0) * e.s) + ',' + fmt(H - 40 - off[1] - (y - e.y0) * e.s)).join(' ');
      svg += `<polygon points="${pts}" fill="rgba(21,62,61,0.08)" stroke="#153e3d" stroke-width="1.1"/>`;
    }
    const r0 = p.rings[0];
    const cx = off[0] + (r0.reduce((a, q) => a + q[0], 0) / r0.length - e.x0) * e.s;
    const cy = H - 40 - off[1] - (r0.reduce((a, q) => a + q[1], 0) / r0.length - e.y0) * e.s;
    svg += `<text x="${fmt(cx)}" y="${fmt(cy)}" font-size="11" text-anchor="middle" fill="#153e3d">P${p.numero}</text>`;
  }
  svg += `<text x="30" y="${H - 14}" font-size="10" fill="#777">UrbaTrame · pile de découpe (SVG) · cote croissante vers le haut · « computed, not surveyed »</text>`;
  svg += '</svg>';
  return svg;
}
