/* Freemap · moteur graphique
   ─────────────────────────────────────────────────────────────────────────
   Langage de composition décrit dans le rapport : toutes les analyses
   produisent un SVG de 240 × 268 unités (W=H=240, PAD=22) rendu par une
   primitive unique wrap() — cadre clippé au profil du site, bandeau de
   légende, échelle graphique, flèche nord, filigrane du mode essai.

   Aucun usage du DOM : le module s'attache à globalThis pour pouvoir être
   évalué aussi bien par le navigateur que par un banc d'essai Node.
   ───────────────────────────────────────────────────────────────────────── */
(function (G) {
  'use strict';

  const W = 240, H = 240, PAD = 22;

  G.FMEngine = { W, H, PAD };

  /* ════════════ Palettes ════════════
     Tableaux parallèles indexés par le même entier : changer la palette d'une
     carte recolore toutes les cartes de façon cohérente. Les variantes
     marquées dark basculent les renderers en fond sombre. */
  const SCH = {
    roads: [
      { p: '#1A1917', s: '#5A5856', t: '#A8A6A0', ph: '#D0CECC', dark: false },
      { p: '#2C4A6E', s: '#5A7A9E', t: '#8FAAC4', ph: '#BDD0E4', dark: false },
      { p: '#E8E4DC', s: '#A8A090', t: '#686460', ph: '#484440', dot: '#E8C87A', dark: true },
      { p: '#EAD9A8', s: '#B89A6A', t: '#5E6E8E', ph: '#34405E', dot: '#5CE0C0', dark: true },
      { p: '#3A2C1C', s: '#7A5C3A', t: '#AC8E62', ph: '#CBB58C', dot: '#A8642A', dark: false }
    ],
    landuse: [
      { res: '#E8B4A0', com: '#F0D080', civ: '#88B0D8', ind: '#C0A8D0', prk: '#A8CC88', wtr: '#80C0D8', other: '#E9E6E0' },
      { res: '#D4785A', com: '#D4A830', civ: '#3A78B8', ind: '#8858A8', prk: '#5A9848', wtr: '#2888B8', other: '#DDDAD3' },
      { res: '#C85A6E', com: '#D8A23A', civ: '#3A78C0', ind: '#7E58B0', prk: '#3FA86A', wtr: '#2A8AB0', other: '#E2DED6' },
      { res: '#C08A6A', com: '#CBA85E', civ: '#7E96A0', ind: '#A08A78', prk: '#8A9456', wtr: '#6E96A0', other: '#E6E2DA' }
    ],
    gw: [
      { g: '#B8D9A8', gs: '#7AAE68', w: '#8EC4DC', ws: '#4A92B8' },
      { g: '#A0C878', gs: '#5C8A38', w: '#5AAAD0', ws: '#2A6A98' },
      { g: '#3FA86A', gs: '#1E7A4A', w: '#2A8AB0', ws: '#155E80' },
      { g: '#8A9456', gs: '#5E6838', w: '#7E9EA4', ws: '#4E6E74' }
    ],
    fabric: [
      { bld: '#26241F', void: '#F2F0EC', road: '#DBD8D1', site: '#C0392B' },
      { bld: '#1B2A3A', void: '#EEF1F4', road: '#D2D8DE', site: '#C0392B' },
      { bld: '#3A2C22', void: '#F4EFE6', road: '#DED6C8', site: '#9C3B26' },
      { bld: '#101010', void: '#FFFFFF', road: '#E4E4E4', site: '#FF3B30' }
    ],
    density: [
      { none: '#F7F6F3', l1: '#DDE6EA', l2: '#B7CBD6', l3: '#8AA9BC', l4: '#5B7E96', l5: '#33566E', line: '#C9C6C0' },
      { none: '#FAF7F0', l1: '#F0E3C8', l2: '#E2C88E', l3: '#CFA455', l4: '#B07A2A', l5: '#7E5016', line: '#D8D2C4' },
      { none: '#F3F7F5', l1: '#CFE6D8', l2: '#9DCDB4', l3: '#68B08D', l4: '#3D8C68', l5: '#1F6446', line: '#C6D2CB' },
      { none: '#F5F5F7', l1: '#DADAE6', l2: '#B6B6CE', l3: '#8E8EB4', l4: '#666699', l5: '#3E3E7A', line: '#CFCFD8' }
    ],
    massing: [
      { top: '#D9D2C6', left: '#B4AC9E', right: '#8E877B', ground: '#F2F0EC', road: '#DCD9D2', water: '#B7D3E2', site: '#C0392B' },
      { top: '#C6D2DE', left: '#9BAABC', right: '#76889C', ground: '#EEF1F4', road: '#D3D9DF', water: '#9CC4DC', site: '#C0392B' },
      { top: '#E7DCC8', left: '#C4B598', right: '#9C8C70', ground: '#F6F1E7', road: '#DED6C7', water: '#B9D6E4', site: '#9C3B26' },
      { top: '#2A2A2E', left: '#1E1E22', right: '#141417', ground: '#F4F4F5', road: '#DDDDDF', water: '#B7D3E2', site: '#FF3B30' }
    ],
    poiheat: [
      { c1: '#F7F4D8', c2: '#F7D97A', c3: '#EFA33C', c4: '#D6602F', c5: '#A32020', dot: '#7A2B12', line: '#D6D2C8' },
      { c1: '#E4ECF5', c2: '#A9C7E4', c3: '#6E9DCB', c4: '#3D6EA8', c5: '#1F3F70', dot: '#1F3F70', line: '#CBD4DD' },
      { c1: '#E7F2E4', c2: '#B6DCA9', c3: '#7CBF6D', c4: '#40924E', c5: '#1C6135', dot: '#1C6135', line: '#CBDBC6' },
      { c1: '#F0E8F2', c2: '#CDB6D8', c3: '#A57FBB', c4: '#7A4F98', c5: '#4C2A63', dot: '#4C2A63', line: '#D6CEDA' }
    ],
    combined: [
      { bg: '#FFFFFF', road: '#D5D2CB', roadP: '#2A2824', bld: '#E7E3DA', green: '#BFDCA9', water: '#A8CFE0', poi: '#C0392B' },
      { bg: '#F0F3F7', road: '#C7D0DA', roadP: '#22313F', bld: '#D9E1E9', green: '#A9CDB8', water: '#8FBFD8', poi: '#1F3F70' },
      { bg: '#FBF8F2', road: '#E0D8C8', roadP: '#3A2C1C', bld: '#EDE4D2', green: '#C6D9A6', water: '#A9CFDE', poi: '#9C3B26' },
      { bg: '#FFFFFF', road: '#E2E2E2', roadP: '#111111', bld: '#EFEFEF', green: '#D8EAD2', water: '#CFE4EE', poi: '#FF3B30' }
    ],
    orient: [
      { bg: '#FFFFFF', rosa: '#7E96A0', rosaFill: 'rgba(126,150,160,.22)', bld: '#33322E', axis: '#C0392B', grid: '#E4E2DC' },
      { bg: '#F4F7F9', rosa: '#3A78B8', rosaFill: 'rgba(58,120,184,.20)', bld: '#22313F', axis: '#C0392B', grid: '#DFE4E8' },
      { bg: '#FAF7F0', rosa: '#B07A2A', rosaFill: 'rgba(176,122,42,.20)', bld: '#3A2C1C', axis: '#9C3B26', grid: '#E8E1D2' },
      { bg: '#FFFFFF', rosa: '#111', rosaFill: 'rgba(0,0,0,.12)', bld: '#111', axis: '#FF3B30', grid: '#EAEAEA' }
    ],
    noise: [
      { bg: '#FFFFFF', quiet: '#E8F0E4', mid: '#F4E6C0', loud: '#E8B48C', worst: '#C86A50', road: '#4A4844', site: '#C0392B', lbl: '#6B6860' },
      { bg: '#F2F5F7', quiet: '#DCE8EE', mid: '#EADFC4', loud: '#E0B090', worst: '#C07058', road: '#22313F', site: '#C0392B', lbl: '#5A6670' },
      { bg: '#FFFFFF', quiet: '#EDEDED', mid: '#DCDCDC', loud: '#C4C4C4', worst: '#A0A0A0', road: '#111', site: '#FF3B30', lbl: '#4A4A4A' },
      { bg: '#FBF8F2', quiet: '#EFE7D8', mid: '#E8D3AE', loud: '#DBA97C', worst: '#C0703C', road: '#3A2C1C', site: '#9C3B26', lbl: '#6E5A3E' }
    ],
    transit: [
      { bg: '#FFFFFF', ring: '#4A6E8C', fill: 'rgba(74,110,140,.12)', stop: '#1A1917', rail: '#5A5856', site: '#C0392B', lbl: '#6B6860' },
      { bg: '#F2F5F7', ring: '#2A6A98', fill: 'rgba(42,106,152,.12)', stop: '#22313F', rail: '#8FAAC4', site: '#C0392B', lbl: '#5A6670' },
      { bg: '#FFFFFF', ring: '#B07A2A', fill: 'rgba(176,122,42,.14)', stop: '#3A2C1C', rail: '#AC8E62', site: '#9C3B26', lbl: '#6E5A3E' },
      { bg: '#FFFFFF', ring: '#111', fill: 'rgba(0,0,0,.08)', stop: '#111', rail: '#CCC', site: '#FF3B30', lbl: '#4A4A4A' }
    ],
    access: [
      { bg: '#FFFFFF', f1: '#DDE6EA', f2: '#B7CBD6', f3: '#8AA9BC', f4: '#5B7E96', major: '#1A1917', minor: '#C9C6C0', site: '#C0392B' },
      { bg: '#FAF7F0', f1: '#F0E3C8', f2: '#E2C88E', f3: '#CFA455', f4: '#B07A2A', major: '#3A2C1C', minor: '#DED6C7', site: '#9C3B26' },
      { bg: '#F3F7F5', f1: '#CFE6D8', f2: '#9DCDB4', f3: '#68B08D', f4: '#3D8C68', major: '#1E4A34', minor: '#C6D2CB', site: '#C0392B' },
      { bg: '#FFFFFF', f1: '#EAEAEA', f2: '#D2D2D2', f3: '#B4B4B4', f4: '#8C8C8C', major: '#111', minor: '#DCDCDC', site: '#FF3B30' }
    ],
    vitality: [
      { bg: '#FFFFFF', low: '#E6E4DE', mid: '#E8C87A', high: '#D6602F', top: '#A32020', poi: '#3A3835', site: '#C0392B' },
      { bg: '#F2F5F7', low: '#DCE3E8', mid: '#A9C7E4', high: '#3D6EA8', top: '#1F3F70', poi: '#22313F', site: '#C0392B' },
      { bg: '#FFFFFF', low: '#EDEDED', mid: '#C4C4C4', high: '#6E6E6E', top: '#111', poi: '#111', site: '#FF3B30' },
      { bg: '#FBF8F2', low: '#EAE2D2', mid: '#D8BE8E', high: '#B07A2A', top: '#7E5016', poi: '#3A2C1C', site: '#9C3B26' }
    ],
    terrain: [
      { bg: '#FFFFFF', c1: '#DCE8D4', c2: '#C2D8B4', c3: '#A6C79A', c4: '#8AB483', c5: '#6E9E70', c6: '#548460', line: '#8A9E86', hi: '#5A7A5C', lo: '#A8BE9E', site: '#C0392B' },
      { bg: '#FFFFFF', c1: '#E4E0D6', c2: '#D2CCBC', c3: '#BEB6A2', c4: '#A89E88', c5: '#92876E', c6: '#7C7058', line: '#9A927E', hi: '#6E644E', lo: '#C4BCA8', site: '#9C3B26' },
      { bg: '#F4F7F9', c1: '#E2EBF0', c2: '#C8D9E4', c3: '#AEC7D8', c4: '#94B5CC', c5: '#7AA3C0', c6: '#6091B4', line: '#8AA6B8', hi: '#4E7A94', lo: '#C6D6E0', site: '#C0392B' },
      { bg: '#FFFFFF', c1: '#F0F0F0', c2: '#DEDEDE', c3: '#CCCCCC', c4: '#B6B6B6', c5: '#A0A0A0', c6: '#8A8A8A', line: '#A8A8A8', hi: '#6E6E6E', lo: '#D2D2D2', site: '#FF3B30' }
    ],
    climate: [
      { bg: '#FFFFFF', warm: '#D6602F', cool: '#3E7CA8', mid: '#E0A83A', bar: '#8899AA', axis: '#C9C6C0', txt: '#6B6860' },
      { bg: '#F7F9FA', warm: '#C0504A', cool: '#2A6A98', mid: '#CFA455', bar: '#9BAABC', axis: '#CBD4DD', txt: '#5A6670' },
      { bg: '#FFFFFF', warm: '#A32020', cool: '#3A3835', mid: '#8A8A8A', bar: '#B4B4B4', axis: '#DDD', txt: '#4A4A4A' },
      { bg: '#FBF8F2', warm: '#B0562A', cool: '#6E7A86', mid: '#C49A52', bar: '#C4B598', axis: '#DED6C7', txt: '#6E5A3E' }
    ],
    typology: [
      { bg: '#FFFFFF', a: '#E2A96E', b: '#8FB0C8', c: '#B08FB0', d: '#A8C08A', e: '#D0C8B8', line: '#FFFFFF' },
      { bg: '#F2F5F7', a: '#D08C4A', b: '#5A8CB0', c: '#906AA8', d: '#7EA862', e: '#B8C0C8', line: '#FFFFFF' },
      { bg: '#FFFFFF', a: '#B07A2A', b: '#3A78B8', c: '#7E58B0', d: '#4A8A48', e: '#C0B8A8', line: '#FFFFFF' },
      { bg: '#FFFFFF', a: '#9A9A9A', b: '#7A7A7A', c: '#5E5E5E', d: '#444', e: '#BEBEBE', line: '#FFF' }
    ],
    sun: [
      { bg: '#FAF8F3', ground: '#FFFFFF', bld: '#5A5750', bldShadow: '#C9C4B8', arc: '#C9922A', hour: '#9A958C', now: '#C0392B', north: '#8C8A82', txt: '#4A4844' },
      { bg: '#F2F5F8', ground: '#FFFFFF', bld: '#3F4A56', bldShadow: '#B9C4CE', arc: '#B8862A', hour: '#8A96A2', now: '#C0392B', north: '#8C8A82', txt: '#46505A' },
      { bg: '#0E1116', ground: '#161B22', bld: '#7C8794', bldShadow: '#2A323C', arc: '#E0A83A', hour: '#F0D8A8', now: '#FFF3D0', north: '#8899AA', txt: '#C8D0D8' },
      { bg: '#0A0A0A', ground: '#111', bld: '#8A8A8A', bldShadow: '#262626', arc: '#E8413A', hour: '#F4D0CC', now: '#FFFFFF', north: '#666', txt: '#BBBBBB' }
    ],
    sound: [
      { bg: '#FFFFFF', s1: '#D8E4EC', s2: '#B0C8D8', s3: '#88A8C0', s4: '#607A94', src: '#C0392B', dot: '#2A2824', road: '#DAD8D2' },
      { bg: '#F6F3EC', s1: '#EDE2CC', s2: '#DCC8A0', s3: '#C4A878', s4: '#A08352', src: '#9C3B26', dot: '#3A2C1C', road: '#E2DACA' },
      { bg: '#FFFFFF', s1: '#E8E8E8', s2: '#CCCCCC', s3: '#AAAAAA', s4: '#888888', src: '#111', dot: '#111', road: '#E2E2E2' },
      { bg: '#F2F6F3', s1: '#D6E6DA', s2: '#AED2BA', s3: '#86BA98', s4: '#5E9E76', src: '#C0392B', dot: '#1E4A34', road: '#D6E2DA' }
    ]
  };
  G.FMEngine.SCH = SCH;

  /* ════════════ Traduction ════════════ */
  const L = (ctx, fr, en) => (ctx && ctx.lang === 'en' ? en : fr);
  G.FMEngine.L = L;

  /* ════════════ Géométrie de base ════════════ */
  function getBounds(ctx) {
    const d = ctx.curR / 111320;
    const dl = d / Math.cos(ctx.sLat * Math.PI / 180);
    return { mnLat: ctx.sLat - d, mxLat: ctx.sLat + d, mnLng: ctx.sLng - dl, mxLng: ctx.sLng + dl };
  }
  function proj(lat, lng, b) {
    if (!b || b.mxLng === b.mnLng || b.mxLat === b.mnLat) return [W / 2, H / 2];
    const x = PAD + (lng - b.mnLng) / (b.mxLng - b.mnLng) * (W - PAD * 2);
    const y = PAD + (b.mxLat - lat) / (b.mxLat - b.mnLat) * (H - PAD * 2);
    return [isFinite(x) ? x : W / 2, isFinite(y) ? y : H / 2];
  }
  function wpts(g, b) {
    if (!g || g.length < 2) return '';
    const s = g.map(n => proj(n[0], n[1], b).join(',')).join(' ');
    return s.includes('NaN') ? '' : s;
  }
  const polyArea = pts => {
    if (!pts) return 0;
    const p = typeof pts === 'string'
      ? pts.trim().split(' ').map(v => v.split(',').map(Number))
      : pts;
    let a = 0;
    for (let i = 0; i < p.length; i++) {
      const q = p[i], r = p[(i + 1) % p.length];
      a += q[0] * r[1] - r[0] * q[1];
    }
    return Math.abs(a) / 2;
  };
  const centroid = pts => {
    let x = 0, y = 0;
    for (const p of pts) { x += p[0]; y += p[1]; }
    return [x / pts.length, y / pts.length];
  };
  function polyLen(pts) {
    let d = 0;
    for (let i = 1; i < pts.length; i++)
      d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return d;
  }
  function distToSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /* distance minimale d'un point (coordonnées écran) à une polyligne projetée */
  function distToPolyline(px, py, line) {
    if (line.length < 2) return Infinity;
    let best = Infinity;
    for (let i = 1; i < line.length; i++) {
      const d = distToSeg(px, py, line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]);
      if (d < best) best = d;
    }
    return best;
  }
  /* azimut (0-179°) d'un segment : orientation d'une façade */
  function azimuth(a, b) {
    let ang = Math.atan2(b[0] - a[0], b[1] - a[1]) * 180 / Math.PI;
    ang = ((ang % 180) + 180) % 180;
    return ang;
  }
  function snapToNetwork(px, py, lines, maxD) {
    let best = null;
    for (const ln of lines) {
      for (let i = 1; i < ln.length; i++) {
        const d = distToSeg(px, py, ln[i - 1][0], ln[i - 1][1], ln[i][0], ln[i][1]);
        if (d < (best ? best.d : maxD)) best = { d, x: px, y: py, ln, i };
      }
    }
    return best;
  }
  function projectOnSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2)) : 0;
    return { x: x1 + t * dx, y: y1 + t * dy, t };
  }
  function polylinePath(pts) {
    if (!pts.length) return '';
    return 'M' + pts.map(p => (+p[0]).toFixed(1) + ',' + (+p[1]).toFixed(1)).join('L');
  }

  /* ════════════ Grilles & champs ════════════ */
  /* Grille cartésienne sur la toile : renvoie {n, cell, x(i), y(j), k(i,j)} */
  function grid(n) {
    const cell = (W - PAD * 2) / n;
    return {
      n, cell,
      x: i => PAD + i * cell,
      y: j => PAD + j * cell,
      cx: i => PAD + i * cell + cell / 2,
      cy: j => PAD + j * cell + cell / 2,
      idx: (i, j) => j * n + i,
      inside: (i, j) => i >= 0 && j >= 0 && i < n && j < n
    };
  }
  /* Marching squares : segments d'iso-valeur sur une grille n×n.
     grid[j][i], j = 0 au nord. Renvoie des polylignes en coordonnées grille. */
  function contours(gridVals, n, level) {
    const segs = [], key = (x, y) => (Math.round(x * 1000) + ':' + Math.round(y * 1000));
    const map = new Map();
    const at = (j, i) => gridVals[j][i];
    const ip = (a, b) => (level - a) / (b - a);
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const p00 = at(j, i), p10 = at(j, i + 1), p11 = at(j + 1, i + 1), p01 = at(j + 1, i);
      let idx = 0;
      if (p00 > level) idx |= 1;
      if (p10 > level) idx |= 2;
      if (p11 > level) idx |= 4;
      if (p01 > level) idx |= 8;
      if (idx === 0 || idx === 15) continue;
      const top = [i + ip(p00, p10), j], right = [i + 1, j + ip(p10, p11)],
            bottom = [i + ip(p01, p11), j + 1], left = [i, j + ip(p00, p01)];
      let a = null, b = null;
      switch (idx) {
        case 1: case 14: a = left; b = top; break;
        case 2: case 13: a = top; b = right; break;
        case 3: case 12: a = left; b = right; break;
        case 4: case 11: a = right; b = bottom; break;
        case 5: a = left; b = top; segs.push([[i + ip(p01, p11), j + 1], right]); break;
        case 6: case 9: a = top; b = bottom; break;
        case 7: case 8: a = left; b = bottom; break;
        case 10: a = top; b = right; segs.push([[i, j + ip(p00, p01)], [i + ip(p01, p11), j + 1]]); break;
      }
      if (a && b) segs.push([a, b]);
    }
    /* recousage léger des segments pour des chemins plus courts */
    for (const [a, b] of segs) {
      const ka = key(a[0], a[1]), kb = key(b[0], b[1]);
      if (!map.has(ka)) map.set(ka, []);
      map.get(ka).push(b);
      if (!map.has(kb)) map.set(kb, []);
      map.get(kb).push(a);
    }
    const used = new Set(), lines = [];
    for (const [start] of map) {
      const [sx, sy] = start.split(':').map(Number);
      const sp = [sx / 1000, sy / 1000];
      if (used.has(start)) continue;
      let cur = sp, line = [cur];
      for (let guard = 0; guard < 100000; guard++) {
        const ck = key(cur[0], cur[1]);
        if (used.has(ck)) break;
        used.add(ck);
        const nxt = (map.get(ck) || []).find(p => !used.has(key(p[0], p[1])));
        if (!nxt) break;
        line.push(nxt); cur = nxt;
      }
      if (line.length > 1) lines.push(line);
    }
    return lines;
  }
  /* Champ d'influence : distance (en cellules) au plus proche site d'une liste */
  function nearestField(n, sites, maxCells) {
    const g = new Float32Array(n * n).fill(maxCells);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      let best = maxCells;
      for (const s of sites) {
        const d = Math.hypot(i - s[0], j - s[1]);
        if (d < best) best = d;
      }
      g[j * n + i] = best;
    }
    return g;
  }
  /* Voronoï approximatif : cellule la plus proche (rendu par pavage) */
  function voronoiCells(n, sites) {
    const owner = new Int16Array(n * n).fill(-1);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      let best = Infinity, bi = -1;
      for (let s = 0; s < sites.length; s++) {
        const d = (i - sites[s][0]) ** 2 + (j - sites[s][1]) ** 2;
        if (d < best) { best = d; bi = s; }
      }
      owner[j * n + i] = bi;
    }
    return owner;
  }

  /* ════════════ Composition : wrap() ════════════ */
  function siteMark(ctx, b, sx, sy) {
    const p = b ? proj(ctx.sLat, ctx.sLng, b) : [sx, sy];
    if (ctx.noSiteMark) return '';
    return '<line x1="' + (p[0] - 9) + '" y1="' + p[1] + '" x2="' + (p[0] + 9) + '" y2="' + p[1] + '" stroke="#C0392B" stroke-width="1.8"/>' +
           '<line x1="' + p[0] + '" y1="' + (p[1] - 9) + '" x2="' + p[0] + '" y2="' + (p[1] + 9) + '" stroke="#C0392B" stroke-width="1.8"/>' +
           '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="4" fill="none" stroke="#C0392B" stroke-width="1.2"/>';
  }

  function wrap(ctx, inner, leg, note, opts) {
    opts = opts || {};
    const cx = W / 2, cy = H / 2, cr = W / 2 - PAD + 4;
    const uid = 'u' + Math.random().toString(36).slice(2, 8);
    const legY = H + 18;
    const nL = Math.max((leg || []).length, 1);
    const sw = (W - 10) / nL;
    /* La taille du libellé s'adapte à la place disponible : avec 5 entrées et
       des mots longs, un corps fixe faisait se chevaucher les légendes. */
    const legS = (leg || []).map((it, i) => {
      const x = 5 + i * sw;
      const lab = esc(it.l);
      const avail = sw - 15;                                   // largeur après la pastille
      const fs = Math.max(4.1, Math.min(6.5, avail / (Math.max(lab.length, 1) * 0.62))).toFixed(2);
      const T = (dx, dy, y) => '<text x="' + (x + dx) + '" y="' + y + '" font-size="' + fs +
        '" fill="#A8A69F" font-family="ui-monospace,monospace">' + lab + '</text>';
      if (it.type === 'rect')
        return '<rect x="' + x + '" y="' + (legY - 6) + '" width="11" height="7" fill="' + it.c +
               '" stroke="' + (it.s || it.c) + '" stroke-width=".5"/>' + T(14, 0, legY + 1);
      return '<line x1="' + x + '" y1="' + (legY - 2) + '" x2="' + (x + 11) + '" y2="' + (legY - 2) + '" stroke="' + it.c +
             '" stroke-width="' + (it.w || 1.2) + '"' + (it.da ? ' stroke-dasharray="' + it.da + '"' : '') + '/>' + T(14, 0, legY + 2);
    }).join('');
    const noteS = note
      ? '<text x="' + (W - 4) + '" y="' + (H + 25) + '" text-anchor="end" font-size="5.5" fill="#D8D6D0" font-family="ui-monospace,monospace">' + esc(note) + '</text>'
      : '';

    /* échelle graphique : la largeur du diagramme couvre ~2·curR mètres */
    let scaleS = '';
    if (opts.noScale !== true) {
      const mPerPx = (ctx.curR * 2) / (W - PAD * 2);
      const targetM = 70 * mPerPx;
      const nice = [50, 100, 200, 250, 500, 1000, 2000];
      let pick = nice[0];
      for (const n of nice) if (n <= targetM) pick = n;
      const barPx = pick / mPerPx, bx = PAD + 2, by = H - 6;
      const lbl = pick >= 1000 ? (pick / 1000) + 'km' : pick + 'm';
      scaleS = '<g font-family="ui-monospace,monospace">' +
        '<line x1="' + bx + '" y1="' + by + '" x2="' + (bx + barPx) + '" y2="' + by + '" stroke="#8C8A82" stroke-width="1.3"/>' +
        '<line x1="' + bx + '" y1="' + (by - 2.5) + '" x2="' + bx + '" y2="' + (by + 2.5) + '" stroke="#8C8A82" stroke-width="1.3"/>' +
        '<line x1="' + (bx + barPx) + '" y1="' + (by - 2.5) + '" x2="' + (bx + barPx) + '" y2="' + (by + 2.5) + '" stroke="#8C8A82" stroke-width="1.3"/>' +
        '<text x="' + (bx + barPx / 2) + '" y="' + (by - 4) + '" text-anchor="middle" font-size="6" fill="#8C8A82">' + lbl + '</text></g>';
    }
    const nx = W - PAD - 2, ny = PAD + 4;
    const northS = opts.noNorth ? '' :
      '<g font-family="ui-monospace,monospace">' +
      '<line x1="' + nx + '" y1="' + ny + '" x2="' + nx + '" y2="' + (ny + 13) + '" stroke="#8C8A82" stroke-width="1"/>' +
      '<path d="M' + nx + ',' + (ny - 2) + ' l-2.6,5 l2.6,-1.7 l2.6,1.7 z" fill="#8C8A82"/>' +
      '<text x="' + nx + '" y="' + (ny + 21) + '" text-anchor="middle" font-size="6" fill="#8C8A82" font-weight="700">N</text></g>';

    const isRect = (ctx.shape === 'rect' || ctx.shape === 'square');
    const isPoly = ctx.shape === 'poly' && ctx.sitePolygon && ctx.sitePolygon.length >= 3;
    let polyPts = '';
    if (isPoly) {
      const bb = getBounds(ctx);
      polyPts = ctx.sitePolygon.map(p => proj(p.lat, p.lng, bb).join(',')).join(' ');
    }
    const rx = ctx.shape === 'square' ? 0 : 18;
    const clipShape = isPoly ? '<polygon points="' + polyPts + '"/>'
      : isRect ? '<rect x="' + PAD + '" y="' + PAD + '" width="' + (W - PAD * 2) + '" height="' + (H - PAD * 2) + '" rx="' + rx + '"/>'
      : '<circle cx="' + cx + '" cy="' + cy + '" r="' + cr + '"/>';
    const borderShape = isPoly
      ? '<polygon points="' + polyPts + '" fill="none" stroke="#D8D6D0" stroke-width=".7" stroke-dasharray="3,3"/>'
      : isRect
        ? '<rect x="' + PAD + '" y="' + PAD + '" width="' + (W - PAD * 2) + '" height="' + (H - PAD * 2) + '" rx="' + rx + '" ry="' + rx + '" fill="none" stroke="#D8D6D0" stroke-width=".7" stroke-dasharray="3,3"/>'
        : '<circle cx="' + cx + '" cy="' + cy + '" r="' + cr + '" fill="none" stroke="#D8D6D0" stroke-width=".7" stroke-dasharray="3,3"/>';

    /* Filigrane du mode essai : injecté DANS le SVG (survit à l'export). */
    let wm = '';
    if (!ctx.isPro && ctx.watermark !== false) {
      const dark = !!opts.dark;
      let tiles = '';
      for (let yy = -20; yy < H + 40; yy += 46)
        for (let xx = -20; xx < W + 40; xx += 120)
          tiles += '<text x="' + xx + '" y="' + yy + '" font-family="ui-monospace,monospace" font-size="9" fill="' +
                   (dark ? '#FFFFFF' : '#1A1917') + '" fill-opacity="0.14" transform="rotate(-30 ' + xx + ' ' + yy + ')">' +
                   (ctx.lang === 'en' ? 'Freemap · trial' : 'Freemap · essai') + '</text>';
      wm = '<g data-fm-watermark="true" pointer-events="none">' + tiles + '</g>';
    }

    const vbH = H + 28;
    return '<svg viewBox="0 0 ' + W + ' ' + vbH + '" xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + vbH + '">' +
      '<defs><clipPath id="' + uid + '">' + clipShape + '</clipPath></defs>' +
      '<g clip-path="url(#' + uid + ')">' + inner + '</g>' +
      borderShape + scaleS + northS +
      '<g clip-path="url(#' + uid + ')">' + wm + '</g>' +
      legS + noteS + '</svg>';
  }

  function blank(ctx, msg) {
    const m = esc(msg || (L(ctx, 'DONNÉES INDISPONIBLES', 'NO DATA')));
    return wrap(ctx,
      '<rect width="' + W + '" height="' + H + '" fill="#FFFFFF"/>' +
      '<text x="' + (W / 2) + '" y="' + (H / 2) + '" text-anchor="middle" font-size="8" fill="#B8B5AE" font-family="ui-monospace,monospace">' + m + '</text>',
      [], '');
  }

  /* ════════════ Formatage ════════════ */
  const fmtM = m => m >= 1000 ? (m / 1000).toFixed(m >= 10000 ? 0 : 1) + ' km' : Math.round(m) + ' m';
  const fmtA = a => a >= 10000 ? Math.round(a / 1000) + ' ha' : Math.round(a) + ' m²';
  const fmtN = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  /* ════════════ Axonométrie 30° ════════════ */
  function axonoTransform() {
    const COS = Math.cos(Math.PI / 6), SIN = Math.sin(Math.PI / 6);
    const cx = W / 2, cy = H / 2 + 16;
    return {
      pt: (x, y, h) => [
        cx + (x - cx) * COS - (y - cy) * SIN,
        cy + (x - cx) * SIN + (y - cy) * COS - h
      ]
    };
  }

  G.FMEngine.getBounds = getBounds;
  G.FMEngine.proj = proj;
  G.FMEngine.wpts = wpts;
  G.FMEngine.polyArea = polyArea;
  G.FMEngine.centroid = centroid;
  G.FMEngine.polyLen = polyLen;
  G.FMEngine.distToSeg = distToSeg;
  G.FMEngine.distToPolyline = distToPolyline;
  G.FMEngine.projectOnSeg = projectOnSeg;
  G.FMEngine.snapToNetwork = snapToNetwork;
  G.FMEngine.azimuth = azimuth;
  G.FMEngine.polylinePath = polylinePath;
  G.FMEngine.grid = grid;
  G.FMEngine.contours = contours;
  G.FMEngine.nearestField = nearestField;
  G.FMEngine.voronoiCells = voronoiCells;
  G.FMEngine.wrap = wrap;
  G.FMEngine.siteMark = siteMark;
  G.FMEngine.blank = blank;
  G.FMEngine.esc = esc;
  G.FMEngine.fmtM = fmtM;
  G.FMEngine.fmtA = fmtA;
  G.FMEngine.fmtN = fmtN;
  G.FMEngine.axono = axonoTransform;
  G.FMRender = G.FMRender || {};
})(typeof globalThis !== 'undefined' ? globalThis : this);
