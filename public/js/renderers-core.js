/* Freemap · renderers — noyau (11 analyses)
   Chaque renderer reçoit (ctx, paletteIndex) et renvoie une chaîne SVG produite
   par wrap(). ctx expose : sLat, sLng, curR, shape, isPro, lang, watermark,
   D = {roads, build, green, pois}, terrain, climate, time. */
(function (G) {
  'use strict';
  const E = G.FMEngine, R = G.FMRender;
  const {
    W, H, PAD, SCH, L, getBounds, proj, wpts, polyArea, centroid, polyLen,
    distToSeg, distToPolyline, snapToNetwork, azimuth, polylinePath, grid,
    contours, nearestField, voronoiCells, wrap, siteMark, blank, esc,
    fmtM, fmtA, fmtN, axono
  } = E;

  const ROADW = {
    motorway: [2.4, 3], trunk: [2.1, 3], primary: [1.8, 2], secondary: [1.3, 2],
    tertiary: [1, 1], residential: [.7, 0], living_street: [.6, 0], unclassified: [.6, 0],
    pedestrian: [.7, 0], footway: [.5, 0], cycleway: [.55, 0], path: [.4, 0],
    service: [.3, 0], steps: [.35, 0]
  };
  const ROADDA = { pedestrian: '2,2', footway: '1,2', cycleway: '3,2', path: '1,3', steps: '1,2' };

  /* ── helpers d'accès aux données projetées ── */
  function roadLines(ctx) {
    const b = getBounds(ctx);
    const out = [];
    for (const r of ctx.D.roads || []) {
      const pts = r.g.map(p => proj(p[0], p[1], b));
      if (pts.length > 1 && !pts.some(p => !isFinite(p[0]))) out.push({ h: r.h, n: r.n, pts });
    }
    return out;
  }
  function bldPolys(ctx) {
    const b = getBounds(ctx);
    const out = [];
    for (const x of ctx.D.build || []) {
      const pts = x.g.map(p => proj(p[0], p[1], b));
      if (pts.length > 2 && !pts.some(p => !isFinite(p[0]))) out.push({ t: x.t, h: x.h, u: x.u, pts });
    }
    return out;
  }
  function greenPolys(ctx) {
    const b = getBounds(ctx);
    const out = [];
    for (const x of ctx.D.green || []) {
      const pts = x.g.map(p => proj(p[0], p[1], b));
      if (pts.length > 2 && !pts.some(p => !isFinite(p[0]))) out.push({ k: x.k, n: x.n, lu: x.lu, pts });
    }
    return out;
  }
  function poiPts(ctx) {
    const b = getBounds(ctx);
    return (ctx.D.pois || []).map(p => {
      const [x, y] = proj(p.y, p.x, b);
      return { ...p, px: x, py: y };
    }).filter(p => isFinite(p.px));
  }
  /* Classification d'usage d'un bâtiment (comme l'analyse « zones fonctionnelles »). */
  function useCat(b) {
    const u = (b.u || '').toLowerCase(), t = (b.t || '').toLowerCase();
    if (/school|university|college|kindergarten|hospital|clinic|place_of_worship|library|museum/.test(u)) return 'civ';
    if (/restaurant|cafe|fast_food|bar|bank|market|shop|supermarket|mall|retail/.test(u)) return 'com';
    if (/industrial|warehouse|factory/.test(t + u)) return 'ind';
    if (/house|apartments|residential|terrace|dormitory|bungalow|detached/.test(t)) return 'resk';
    if (/commercial|retail|office|civic|public/.test(t + u)) return 'com';
    return 'other';
  }

  /* ═══════════════════ 1 · VOIRIE ═══════════════════ */
  R.roads = (ctx, sc) => {
    const s = SCH.roads[sc % SCH.roads.length], dark = !!s.dark;
    const lines = roadLines(ctx);
    let body = '<rect width="' + W + '" height="' + H + '" fill="' + (dark ? '#080808' : '#FFFFFF') + '"/>';
    let primary = 0, total = 0;
    for (const ln of lines) {
      const w = ROADW[ln.h] || [.3, 0];
      const da = ROADDA[ln.h];
      const pts = polylinePath(ln.pts);
      const c = w[1] === 3 ? s.p : w[1] === 2 ? s.s : (ROADDA[ln.h] ? s.ph : s.t);
      total++; if (w[1] >= 2) primary++;
      if (dark && w[1] >= 2)
        body += '<path d="' + pts + '" fill="none" stroke="' + c + '" stroke-width="' + (w[0] * 3.5) + '" stroke-linecap="round" opacity=".18"/>';
      body += '<path d="' + pts + '" fill="none" stroke="' + c + '" stroke-width="' + w[0] + '" stroke-linecap="round" stroke-linejoin="round"' +
              (da ? ' stroke-dasharray="' + da + '"' : '') + '/>';
    }
    /* Flèches de flux sur les voies structurantes (comme l'original). */
    if (!dark) for (const ln of lines) {
      if (!['primary', 'trunk', 'motorway'].includes(ln.h) || ln.pts.length < 3) continue;
      const i = Math.floor(ln.pts.length / 2);
      const a = ln.pts[i - 1], b2 = ln.pts[i];
      const ang = Math.atan2(b2[1] - a[1], b2[0] - a[0]);
      const mx = (a[0] + b2[0]) / 2, my = (a[1] + b2[1]) / 2, al = 6, aw = 3;
      body += '<polygon points="' +
        (mx + al * Math.cos(ang)).toFixed(1) + ',' + (my + al * Math.sin(ang)).toFixed(1) + ' ' +
        (mx - aw * Math.sin(ang) * .5).toFixed(1) + ',' + (my + aw * Math.cos(ang) * .5).toFixed(1) + ' ' +
        (mx + aw * Math.sin(ang) * .5).toFixed(1) + ',' + (my - aw * Math.cos(ang) * .5).toFixed(1) +
        '" fill="' + s.p + '" opacity=".55"/>';
    }
    if (!lines.length) {
      const cx = W / 2, cy = H / 2;
      body += '<line x1="' + PAD + '" y1="' + cy + '" x2="' + (W - PAD) + '" y2="' + cy + '" stroke="' + s.p + '" stroke-width="2"/>' +
              '<line x1="' + cx + '" y1="' + PAD + '" x2="' + cx + '" y2="' + (H - PAD) + '" stroke="' + s.p + '" stroke-width="2"/>';
    }
    body += siteMark(ctx, getBounds(ctx));
    return wrap(ctx, body, [
      { type: 'rect', c: s.p, l: L(ctx, 'STRUCTURANTES', 'MAJOR') },
      { type: 'rect', c: s.s, l: L(ctx, 'SECONDAIRES', 'SECONDARY') },
      { type: 'line', c: s.t, l: L(ctx, 'LOCALES', 'LOCAL'), w: 1 },
      { type: 'line', c: s.ph, l: L(ctx, 'PIÉTONNES', 'FOOT'), w: .8, da: '2,2' }
    ], 'OSM · ' + total + L(ctx, ' TRONÇONS', ' SEGMENTS') + (primary ? ' · ' + primary + L(ctx, ' STRUCTUR.', ' MAJOR') : ''), { dark });
  };

  /* ═══════════════════ 2 · VERT & EAU ═══════════════════ */
  R.gw = (ctx, sc) => {
    const s = SCH.gw[sc % SCH.gw.length], b = getBounds(ctx);
    const polys = greenPolys(ctx);
    let body = '<rect width="' + W + '" height="' + H + '" fill="#FFFFFF"/>';
    let g = 0, w = 0, gA = 0, wA = 0;
    const MAXW = W * H * .55;
    for (const p of polys) {
      if (p.k === 'l') continue;
      const isW = p.k === 'w', a = polyArea(p.pts);
      if (isW && a > MAXW) continue;            // garde-fou : un lac débordant est ignoré
      if (isW) { w++; wA += a; } else { g++; gA += a; }
      const ptsStr = p.pts.map(q => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' ');
      body += '<polygon points="' + ptsStr + '" fill="' + (isW ? s.w : s.g) +
              '" stroke="' + (isW ? s.ws : s.gs) + '" stroke-width=".6"/>';
    }
    if (!g && !w) {
      const cx = W / 2, cy = H / 2;
      body += '<ellipse cx="' + (cx - 28) + '" cy="' + (cy - 18) + '" rx="38" ry="30" fill="' + s.g + '" stroke="' + s.gs + '" stroke-width=".7"/>' +
              '<ellipse cx="' + (cx + 24) + '" cy="' + (cy + 20) + '" rx="30" ry="24" fill="' + s.g + '" stroke="' + s.gs + '" stroke-width=".7"/>' +
              '<ellipse cx="' + (cx + 12) + '" cy="' + (cy - 32) + '" rx="22" ry="17" fill="' + s.w + '" stroke="' + s.ws + '" stroke-width=".7"/>';
    }
    body += siteMark(ctx, b);
    const px2 = Math.pow((ctx.curR * 2) / (W - PAD * 2), 2);
    return wrap(ctx, body,
      [{ type: 'rect', c: s.g, s: s.gs, l: L(ctx, 'VERT', 'GREEN') }, { type: 'rect', c: s.w, s: s.ws, l: L(ctx, 'EAU', 'WATER') }],
      (g || w ? L(ctx, 'RÉEL', 'REAL') + ' · ' + g + L(ctx, ' VERT', ' GREEN') + ' ' + fmtA(gA * px2) + ' / ' + w + L(ctx, ' EAU', ' WATER') + ' ' + fmtA(wA * px2) : L(ctx, 'SCHÉMATIQUE', 'SCHEMATIC')));
  };

  /* ═══════════════════ 3 · ZONES FONCTIONNELLES ═══════════════════ */
  R.landuse = (ctx, sc) => {
    const s = SCH.landuse[sc % SCH.landuse.length], b = getBounds(ctx);
    let body = '<rect width="' + W + '" height="' + H + '" fill="#FFFFFF"/>';
    const counts = { resk: 0, com: 0, civ: 0, ind: 0, other: 0 };
    let aRes = 0, aAll = 0;
    for (const gr of greenPolys(ctx)) {
      if (gr.k === 'l') continue;
      body += '<polygon points="' + gr.pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ') +
              '" fill="' + (gr.k === 'w' ? s.wtr : s.prk) + '" fill-opacity=".85"/>';
    }
    const px2 = Math.pow((ctx.curR * 2) / (W - PAD * 2), 2);
    for (const bl of bldPolys(ctx)) {
      const k = useCat(bl);
      counts[k] = (counts[k] || 0) + 1;
      const a = polyArea(bl.pts); aAll += a; if (k === 'resk') aRes += a;
      body += '<polygon points="' + bl.pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ') +
              '" fill="' + (s[k] || s.other) + '" stroke="rgba(0,0,0,.25)" stroke-width=".2"/>';
    }
    body += siteMark(ctx, b);
    const pctRes = aAll ? Math.round(aRes / aAll * 100) : 0;
    return wrap(ctx, body, [
      { type: 'rect', c: s.resk || s.res, l: L(ctx, 'RÉSID.', 'RESID.') },
      { type: 'rect', c: s.com, l: L(ctx, 'ACTIV.', 'BUSIN.') },
      { type: 'rect', c: s.civ, l: L(ctx, 'ÉQUIP.', 'CIVIC') },
      { type: 'rect', c: s.ind, l: L(ctx, 'INDUSTR.', 'INDUSTRY') },
      { type: 'rect', c: s.prk, l: L(ctx, 'VERT/EAU', 'GREEN') }
    ], L(ctx, 'USAGE DÉDUIT DES TAGS · ', 'USE INFERRED FROM TAGS · ') + (aAll ? pctRes + L(ctx, '% EMPRISE RÉSIDENTIELLE', '% RESIDENTIAL AREA') : '0'));
  };

  /* ═══════════════════ 4 · TISSU URBAIN (Nolli) ═══════════════════ */
  R.fabric = (ctx, sc) => {
    const s = SCH.fabric[sc % SCH.fabric.length];
    let body = '<rect width="' + W + '" height="' + H + '" fill="' + s.void + '"/>';
    for (const ln of roadLines(ctx))
      body += '<path d="' + polylinePath(ln.pts) + '" fill="none" stroke="' + s.road + '" stroke-width="0.8" stroke-linecap="round"/>';
    const blds = bldPolys(ctx);
    let a = 0;
    for (const bl of blds) {
      a += polyArea(bl.pts);
      body += '<polygon points="' + bl.pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ') +
              '" fill="' + s.bld + '" stroke="' + s.bld + '" stroke-width=".3"/>';
    }
    body += siteMark(ctx, getBounds(ctx));
    const px2 = Math.pow((ctx.curR * 2) / (W - PAD * 2), 2);
    return wrap(ctx, body,
      [{ type: 'rect', c: s.bld, s: s.bld, l: L(ctx, 'BÂTI', 'BUILT') }, { type: 'rect', c: s.road, s: s.road, l: L(ctx, 'VOIRIE', 'STREET') }],
      'FIGURE-FOND · ' + blds.length + L(ctx, ' EMPRISES · ', ' FOOTPRINTS · ') + fmtA(a * px2));
  };

  /* ═══════════════════ 5 · DENSITÉ BÂTIE ═══════════════════ */
  R.density = (ctx, sc) => {
    const s = SCH.density[sc % SCH.density.length];
    const N = 12, g = grid(N), px2 = Math.pow((ctx.curR * 2) / (W - PAD * 2), 2);
    const area = new Float32Array(N * N), cover = new Int32Array(N * N), vol = new Float32Array(N * N);
    let totA = 0, totV = 0, noH = 0;
    for (const bl of bldPolys(ctx)) {
      const a = polyArea(bl.pts); totA += a;
      const [cxp, cyp] = centroid(bl.pts);
      const i = Math.floor((cxp - PAD) / g.cell), j = Math.floor((cyp - PAD) / g.cell);
      if (!g.inside(i, j)) continue;
      const k = g.idx(i, j);
      area[k] += a; cover[k]++;
      const h = bl.h > 0 ? bl.h : 9; if (!(bl.h > 0)) noH++;
      vol[k] += a * h; totV += a * h;
    }
    let body = '<rect width="' + W + '" height="' + H + '" fill="' + s.none + '"/>';
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = g.idx(i, j); if (!cover[k]) continue;
      const ratio = area[k] / (g.cell * g.cell);
      const c = ratio > .42 ? s.l5 : ratio > .30 ? s.l4 : ratio > .20 ? s.l3 : ratio > .10 ? s.l2 : s.l1;
      body += '<rect x="' + g.x(i).toFixed(1) + '" y="' + g.y(j).toFixed(1) + '" width="' + g.cell.toFixed(1) +
              '" height="' + g.cell.toFixed(1) + '" fill="' + c + '" stroke="' + s.line + '" stroke-width=".25"/>';
    }
    for (const ln of roadLines(ctx))
      body += '<path d="' + polylinePath(ln.pts) + '" fill="none" stroke="rgba(255,255,255,.5)" stroke-width=".4"/>';
    body += siteMark(ctx, getBounds(ctx));
    const far = 1 - (totA * px2) / (Math.PI * ctx.curR * ctx.curR);
    return wrap(ctx, body, [
      { type: 'rect', c: s.l1, l: L(ctx, 'FAIBLE', 'LOW') },
      { type: 'rect', c: s.l3, l: L(ctx, 'MOYENNE', 'MEDIUM') },
      { type: 'rect', c: s.l5, l: L(ctx, 'FORTE', 'HIGH') }
    ], 'CSC ' + Math.round(far * 100) + '% · ÉMPRISE ' + fmtA(totA * px2) + ' · ' + fmtN(totV * px2) + ' m³' + (noH ? L(ctx, ' (9 m par défaut)', ' (9 m default)') : ''));
  };

  /* ═══════════════════ 6 · VOLUMÉTRIE AXONOMÉTRIQUE ═══════════════════ */
  R.massing = (ctx, sc) => {
    const s = SCH.massing[sc % SCH.massing.length];
    const b = getBounds(ctx), ax = axono();
    let body = '<rect width="' + W + '" height="' + H + '" fill="' + s.ground + '"/>';
    for (const ln of roadLines(ctx))
      body += '<path d="' + polylinePath(ln.pts.map(([x, y]) => ax.pt(x, y, 0))) + '" fill="none" stroke="' + s.road + '" stroke-width=".5" opacity=".9"/>';
    for (const gr of greenPolys(ctx)) {
      if (gr.k !== 'w') continue;
      body += '<polygon points="' + gr.pts.map(([x, y]) => { const q = ax.pt(x, y, 0); return q[0].toFixed(1) + ',' + q[1].toFixed(1); }).join(' ') +
              '" fill="' + s.water + '" fill-opacity=".6"/>';
    }
    const faces = [];
    let withH = 0, defH = 0, maxH = 0;
    for (const bl of bldPolys(ctx)) {
      const hm = bl.h > 0 ? bl.h : 9;
      if (bl.h > 0) withH++; else defH++;
      maxH = Math.max(maxH, hm);
      const h = hm * 1.55 * (600 / ctx.curR) * 0.55;
      const top = bl.pts.map(([x, y]) => ax.pt(x, y, h));
      const gnd = bl.pts.map(([x, y]) => ax.pt(x, y, 0));
      const [cxg, cyg] = centroid(gnd);
      const zc = cyg + h * .001;
      faces.push({
        z: zc,
        svg: '<polygon points="' + gnd.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ') + '" fill="' + (cxg < W / 2 ? s.left : s.right) + '"/>' +
             '<polygon points="' + top.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ') + '" fill="' + s.top + '" stroke="rgba(0,0,0,.13)" stroke-width=".2"/>'
      });
    }
    faces.sort((a, c) => a.z - c.z);
    body += faces.map(f => f.svg).join('') + siteMark(ctx, b);
    return wrap(ctx, body, [
      { type: 'rect', c: s.top, s: s.top, l: L(ctx, 'TOIT', 'ROOF') },
      { type: 'rect', c: s.left, s: s.left, l: L(ctx, 'FAÇADE', 'FACADE') },
      { type: 'rect', c: s.water, s: s.water, l: L(ctx, 'EAU', 'WATER') }
    ], L(ctx, 'AXONO 30° · ', 'AXONO 30° · ') + withH + L(ctx, ' bât. mesurés · ', ' measured · ') + defH + L(ctx, ' à 9 m · Hmax ', ' default · Hmax ') + maxH.toFixed(0) + ' m', { dark: sc % SCH.massing.length === 3 });
  };

  /* ═══════════════════ 7 · CHALEUR DES POI ═══════════════════ */
  R.poiheat = (ctx, sc) => {
    const s = SCH.poiheat[sc % SCH.poiheat.length];
    const N = 16, g = grid(N);
    const pois = poiPts(ctx);
    const raw = new Float32Array(N * N);
    for (const p of pois) {
      const i = Math.floor((p.px - PAD) / g.cell), j = Math.floor((p.py - PAD) / g.cell);
      if (g.inside(i, j)) raw[g.idx(i, j)]++;
    }
    /* lissage 3×3 (poids 1 au centre, 0,5 en croix, 0,25 en diagonale) */
    const sm = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      let t = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!g.inside(i + di, j + dj)) continue;
        t += raw[g.idx(i + di, j + dj)] * ((di || dj) ? (di && dj ? .25 : .5) : 1);
      }
      sm[g.idx(i, j)] = t;
    }
    const mx = Math.max(1e-6, ...sm);
    let hot = 0;
    for (let k = 0; k < sm.length; k++) if (sm[k] / mx > .55) hot++;
    let body = '<rect width="' + W + '" height="' + H + '" fill="' + s.c1 + '"/>';
    const stops = [s.c1, s.c2, s.c3, s.c4, s.c5];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const v = sm[g.idx(i, j)] / mx; if (v <= .02) continue;
      body += '<rect x="' + g.x(i).toFixed(1) + '" y="' + g.y(j).toFixed(1) + '" width="' + g.cell.toFixed(1) +
              '" height="' + g.cell.toFixed(1) + '" fill="' + stops[Math.min(4, Math.floor(v * 5))] +
              '" fill-opacity="' + Math.min(1, .35 + v * .9).toFixed(2) + '"/>';
    }
    for (const ln of roadLines(ctx))
      body += '<path d="' + polylinePath(ln.pts) + '" fill="none" stroke="' + s.line + '" stroke-width=".35" opacity=".85"/>';
    for (const p of pois) {
      if (p.k === 'transit') continue;
      body += '<circle cx="' + p.px.toFixed(1) + '" cy="' + p.py.toFixed(1) + '" r="1.1" fill="' + s.dot + '" fill-opacity=".8"/>';
    }
    body += siteMark(ctx, getBounds(ctx));
    const dens = (pois.length / (Math.PI * Math.pow(ctx.curR / 1000, 2))).toFixed(1);
    return wrap(ctx, body, [
      { type: 'rect', c: s.c1, s: s.c2, l: L(ctx, 'FAIBLE', 'LOW') },
      { type: 'rect', c: s.c3, s: s.c3, l: L(ctx, 'MOYEN', 'MID') },
      { type: 'rect', c: s.c5, s: s.c5, l: L(ctx, 'ÉLEVÉ', 'HIGH') }
    ], pois.length + L(ctx, ' POI · ', ' POI · ') + dens + L(ctx, '/km² · ', '/km² · ') + hot + L(ctx, ' cellules chaudes', ' hot cells'));
  };

  /* ═══════════════════ 8 · TYPES DE POI ═══════════════════ */
  R.poitype = (ctx, sc) => {
    const pal = [['#C0392B', 'RESTAURATION', 'FOOD'], ['#2A6A98', 'COMMERCES', 'SHOPS'],
                 ['#3FA86A', 'ÉCOLES', 'SCHOOLS'], ['#8858A8', 'SANTÉ', 'HEALTH'],
                 ['#D4A830', 'CULTURE', 'CULTURE'], ['#4A4844', 'AUTRES', 'OTHER']];
    let body = '<rect width="' + W + '" height="' + H + '" fill="#FFFFFF"/>';
    for (const ln of roadLines(ctx))
      body += '<path d="' + polylinePath(ln.pts) + '" fill="none" stroke="#E6E4DF" stroke-width=".5"/>';
    const cnt = [0, 0, 0, 0, 0, 0];
    const klass = p => {
      const a = p.a || '', s = p.s || '', l2 = p.l || '';
      if (/restaurant|cafe|fast_food|bar|pub|food_court|ice_cream/.test(a)) return 0;
      if (s || /marketplace|bank/.test(a)) return 1;
      if (/school|university|college|kindergarten|library/.test(a)) return 2;
      if (/hospital|clinic|doctors|pharmacy|dentist/.test(a)) return 3;
      if (/theatre|cinema|museum|arts_centre|place_of_worship/.test(a) || /tourism/.test(l2)) return 4;
      return 5;
    };
    for (const p of poiPts(ctx)) {
      const k = klass(p); cnt[k]++;
      body += '<circle cx="' + p.px.toFixed(1) + '" cy="' + p.py.toFixed(1) + '" r="1.6" fill="' + pal[k][0] +
              '" fill-opacity=".85" stroke="#FFFFFF" stroke-width=".35"/>';
    }
    body += siteMark(ctx, getBounds(ctx));
    return wrap(ctx, body,
      pal.filter((_, i) => cnt[i]).slice(0, 5).map((p, i) => ({ type: 'rect', c: p[0], s: p[0], l: L(ctx, p[1].slice(0, 6), p[2].slice(0, 7)) })),
      cnt.reduce((a, b) => a + b, 0) + L(ctx, ' LIEUX GÉOLOCALISÉS (OSM)', ' PLACES (OSM)'));
  };

  /* ═══════════════════ 9 · TYPOLOGIE BÂTIE ═══════════════════ */
  R.typology = (ctx, sc) => {
    const s = SCH.typology[sc % SCH.typology.length];
    let body = '<rect width="' + W + '" height="' + H + '" fill="' + s.bg + '"/>';
    for (const ln of roadLines(ctx))
      body += '<path d="' + polylinePath(ln.pts) + '" fill="none" stroke="rgba(0,0,0,.06)" stroke-width="1.6"/>';
    const order = ['pav', 'coll', 'equip', 'act', 'ind'];
    const buckets = { pav: [], coll: [], equip: [], act: [], ind: [] };
    for (const bl of bldPolys(ctx)) {
      const t = (bl.t || '').toLowerCase(), u = (bl.u || '').toLowerCase(), a = polyArea(bl.pts);
      const key = /school|university|hospital|clinic|place_of_worship|public|civic/.test(t + u) ? 'equip'
        : /commercial|retail|office|industrial|warehouse/.test(t + u) ? 'act'
        : /apartments|dormitory|terrace/.test(t) ? 'coll'
        : /house|detached|bungalow|hut/.test(t) ? 'pav'
        : a > 260 ? 'act' : 'ind';
      buckets[key].push(bl);
    }
    const colors = { pav: s.a, coll: s.b, equip: s.c, act: s.d, ind: s.e };
    for (const k of order) for (const bl of buckets[k])
      body += '<polygon points="' + bl.pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ') +
              '" fill="' + colors[k] + '" stroke="' + s.line + '" stroke-width=".3"/>';
    body += siteMark(ctx, getBounds(ctx));
    const total = order.reduce((a, k) => a + buckets[k].length, 0) || 1;
    const share = k => Math.round(buckets[k].length / total * 100) + '%';
    return wrap(ctx, body, [
      { type: 'rect', c: s.a, s: s.a, l: L(ctx, 'PAVILLONNAIRE ' + share('pav'), 'HOUSES ' + share('pav')) },
      { type: 'rect', c: s.b, s: s.b, l: L(ctx, 'COLLECTIF ' + share('coll'), 'MULTI ' + share('coll')) },
      { type: 'rect', c: s.c, s: s.c, l: L(ctx, 'ÉQUIPEMENT ' + share('equip'), 'CIVIC ' + share('equip')) },
      { type: 'rect', c: s.d, s: s.d, l: L(ctx, 'ACTIVITÉ ' + share('act'), 'BUSINESS ' + share('act')) }
    ], total + L(ctx, ' BÂTIMENTS CLASSÉS PAR TYPE DÉCLARÉ', ' BUILDINGS BY DECLARED TYPE'));
  };

  /* ═══════════════════ 10 · TRAME ISOMÉTRIQUE ═══════════════════ */
  R.isogrid = (ctx, sc) => {
    const s = SCH.massing[sc % SCH.massing.length], ax = axono();
    const step = 12;
    let body = '<rect width="' + W + '" height="' + H + '" fill="' + s.ground + '"/>';
    for (let x = PAD - 40; x < W - PAD + 40; x += step)
      body += '<line x1="' + ax.pt(x, PAD, 0)[0].toFixed(1) + '" y1="' + ax.pt(x, PAD, 0)[1].toFixed(1) +
              '" x2="' + ax.pt(x, H - PAD, 0)[0].toFixed(1) + '" y2="' + ax.pt(x, H - PAD, 0)[1].toFixed(1) +
              '" stroke="' + s.road + '" stroke-width=".3"/>';
    for (let y = PAD - 40; y < H - PAD + 40; y += step)
      body += '<line x1="' + ax.pt(PAD, y, 0)[0].toFixed(1) + '" y1="' + ax.pt(PAD, y, 0)[1].toFixed(1) +
              '" x2="' + ax.pt(W - PAD, y, 0)[0].toFixed(1) + '" y2="' + ax.pt(W - PAD, y, 0)[1].toFixed(1) +
              '" stroke="' + s.road + '" stroke-width=".3"/>';
    const faces = [];
    for (const bl of bldPolys(ctx)) {
      const hm = bl.h > 0 ? bl.h : 9;
      const h = hm * 1.5 * (600 / ctx.curR) * .5;
      const top = bl.pts.map(([x, y]) => ax.pt(x, y, h));
      const gnd = bl.pts.map(([x, y]) => ax.pt(x, y, 0));
      const [cxg, cyg] = centroid(gnd);
      faces.push({
        z: cyg, svg: '<polygon points="' + gnd.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ') + '" fill="' + (cxg < W / 2 ? s.left : s.right) + '" fill-opacity=".92"/>' +
          '<polygon points="' + top.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ') + '" fill="' + s.top + '"/>'
      });
    }
    faces.sort((a, c) => a.z - c.z);
    body += faces.map(f => f.svg).join('') + siteMark(ctx, getBounds(ctx));
    return wrap(ctx, body, [
      { type: 'rect', c: s.top, s: s.top, l: L(ctx, 'TOIT', 'ROOF') },
      { type: 'rect', c: s.left, s: s.left, l: L(ctx, 'VOLUME', 'VOLUME') },
      { type: 'line', c: s.road, l: L(ctx, 'TRAME 30°', '30° GRID'), w: .8 }
    ], L(ctx, 'GRILLE ', 'GRID ') + step + ' px · ' + faces.length + L(ctx, ' VOLUMES', ' VOLUMES'), { dark: sc % 4 === 3 });
  };

  /* ═══════════════════ 11 · SUPERPOSITION COMBINÉE ═══════════════════ */
  R.combined = (ctx, sc) => {
    const s = SCH.combined[sc % SCH.combined.length];
    let body = '<rect width="' + W + '" height="' + H + '" fill="' + s.bg + '"/>';
    for (const gr of greenPolys(ctx)) {
      if (gr.k === 'l') continue;
      body += '<polygon points="' + gr.pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ') +
              '" fill="' + (gr.k === 'w' ? s.water : s.green) + '" fill-opacity=".85"/>';
    }
    for (const ln of roadLines(ctx)) {
      const major = (ROADW[ln.h] || [0, 0])[1] >= 2;
      body += '<path d="' + polylinePath(ln.pts) + '" fill="none" stroke="' + (major ? s.roadP : s.road) +
              '" stroke-width="' + (major ? 1.3 : .5) + '" stroke-linecap="round"/>';
    }
    for (const bl of bldPolys(ctx))
      body += '<polygon points="' + bl.pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ') +
              '" fill="' + s.bld + '" stroke="rgba(0,0,0,.25)" stroke-width=".18"/>';
    const pois = poiPts(ctx);
    for (const p of pois)
      body += '<circle cx="' + p.px.toFixed(1) + '" cy="' + p.py.toFixed(1) + '" r="1.3" fill="' + s.poi + '" fill-opacity=".75"/>';
    body += siteMark(ctx, getBounds(ctx));
    return wrap(ctx, body, [
      { type: 'rect', c: s.bld, s: s.bld, l: L(ctx, 'BÂTI', 'BUILT') },
      { type: 'rect', c: s.green, s: s.green, l: L(ctx, 'VERT', 'GREEN') },
      { type: 'rect', c: s.water, s: s.water, l: L(ctx, 'EAU', 'WATER') },
      { type: 'rect', c: s.poi, s: s.poi, l: 'POI ' + pois.length }
    ], L(ctx, 'SUPERPOSITION · 4 COUCHES OSM', 'OVERLAY · 4 OSM LAYERS'));
  };
})(globalThis);
