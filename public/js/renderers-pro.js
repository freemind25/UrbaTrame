/* Freemap · renderers — série Pro (24 analyses)
   Morphologie, usage, mobilité, environnement, climat. Même contrat que le
   noyau : (ctx, palette) → SVG produit par wrap(). */
(function (G) {
  'use strict';
  const E = G.FMEngine, R = G.FMRender;
  const {
    W, H, PAD, SCH, L, getBounds, proj, polyArea, centroid, polyLen,
    distToSeg, distToPolyline, projectOnSeg, azimuth, polylinePath, grid,
    contours, nearestField, voronoiCells, wrap, siteMark, blank, esc,
    fmtM, fmtA, fmtN, axono
  } = E;
  const ROADMAJOR = /motorway|trunk|primary|secondary/;
  const FOOT = /footway|path|pedestrian|cycleway|steps|living_street/;

  /* ══════════ helpers partagés ══════════ */
  function roadLines(ctx) {
    const b = getBounds(ctx), out = [];
    for (const r of ctx.D.roads || []) {
      const pts = r.g.map(p => proj(p[0], p[1], b));
      if (pts.length > 1 && !pts.some(p => !isFinite(p[0]))) out.push({ h: r.h, n: r.n, pts });
    }
    return out;
  }
  function bldPolys(ctx) {
    const b = getBounds(ctx), out = [];
    for (const x of ctx.D.build || []) {
      const pts = x.g.map(p => proj(p[0], p[1], b));
      if (pts.length > 2 && !pts.some(p => !isFinite(p[0]))) out.push({ t: x.t, h: x.h, u: x.u, pts });
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
  /* Carrefours : sommets de voirie regroupés sur une trame de 4 px,
     ne conservant que les cellules où ≥ 2 voies distinctes se rejoignent. */
  function intersections(ctx, lines) {
    const cell = 4, map = new Map();
    lines.forEach((ln, li) => {
      ln.pts.forEach(p => {
        const k = Math.round(p[0] / cell) + ':' + Math.round(p[1] / cell);
        let e = map.get(k);
        if (!e) { e = { x: 0, y: 0, n: 0, ways: new Set() }; map.set(k, e); }
        e.x += p[0]; e.y += p[1]; e.n++; e.ways.add(li);
      });
    });
    const out = [];
    for (const e of map.values())
      if (e.n >= 3 && e.ways.size >= 2) out.push([e.x / e.n, e.y / e.n]);
    return out;
  }
  /* Graphe piéton : sommets = points d'échantillonnage regroupés sur 3 px. */
  function buildGraph(lines) {
    const cell = 3, map = new Map(), nodes = [], edges = [];
    const idOf = (x, y) => {
      const k = Math.round(x / cell) + ':' + Math.round(y / cell);
      let i = map.get(k);
      if (i === undefined) { i = nodes.length; nodes.push([x, y]); map.set(k, i); }
      return i;
    };
    for (const ln of lines) {
      let prev = null;
      for (const p of ln.pts) {
        const i = idOf(p[0], p[1]);
        if (prev !== null && prev !== i) {
          const a = nodes[prev], b = nodes[i];
          const w = Math.hypot(b[0] - a[0], b[1] - a[1]);
          edges.push([prev, i, w]);
        }
        prev = i;
      }
    }
    return { nodes, edges };
  }
  function dijkstra(graph, src, limitPx) {
    const { nodes, edges } = graph;
    const adj = nodes.map(() => []);
    for (const [a, b, w] of edges) { adj[a].push([b, w]); adj[b].push([a, w]); }
    const dist = new Float32Array(nodes.length).fill(Infinity);
    dist[src] = 0;
    const seen = new Uint8Array(nodes.length);
    /* file simple par tableau trié par insertion (réseaux de qq milliers de nœuds) */
    const pq = [[0, src]];
    while (pq.length) {
      pq.sort((a, b) => b[0] - a[0]);
      const [d, u] = pq.pop();
      if (seen[u]) continue; seen[u] = 1;
      if (d > limitPx) continue;
      for (const [v, w] of adj[u]) {
        const nd = d + w;
        if (nd < dist[v]) { dist[v] = nd; pq.push([nd, v]); }
      }
    }
    return dist;
  }
  const nearestNode = (nodes, x, y) => {
    let bi = -1, bd = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      const d = (nodes[i][0] - x) ** 2 + (nodes[i][1] - y) ** 2;
      if (d < bd) { bd = d; bi = i; }
    }
    return bi;
  };
  const pxPerM = ctx => (W - PAD * 2) / (ctx.curR * 2);
  const polyStr = pts => pts.map(p => (+p[0]).toFixed(1) + ',' + (+p[1]).toFixed(1)).join(' ');

  /* ══════════ climat : agrégation mensuelle NASA POWER ══════════ */
  function monthly(ctx) {
    const p = ctx.climate && ctx.climate.params;
    if (!p) return null;
    const mean = (o, filter) => {
      const buckets = Array.from({ length: 12 }, () => []);
      for (const [k, v] of Object.entries(o)) {
        if (v <= -900 || v === null) continue;
        const m = +k.slice(4, 6) - 1;
        if (m < 0 || m > 11) continue;
        if (filter && !filter(k)) continue;
        buckets[m].push(v);
      }
      return buckets.map(b => b.length ? b.reduce((a, c) => a + c, 0) / b.length : null);
    };
    /* NASA POWER renvoie des totaux JOURNALIERS : on moyenne par mois
       (et non on somme, sans quoi le cumul annuel est triplé par les 3 ans de série). */
    const sum = o => {
      const years = new Set(Object.keys(o).map(k => k.slice(0, 4))).size || 1;
      const buckets = Array.from({ length: 12 }, () => []);
      for (const [k, v] of Object.entries(o)) {
        if (v <= -900 || v === null) continue;
        const m = +k.slice(4, 6) - 1;
        if (m >= 0 && m < 12) buckets[m].push(v);
      }
      return buckets.map(b => b.length ? b.reduce((a, c) => a + c, 0) / b.length : null);
    };
    const out = {};
    if (p.T2M_MAX) out.tmax = mean(p.T2M_MAX);
    if (p.T2M_MIN) out.tmin = mean(p.T2M_MIN);
    if (p.PRECTOTCORR) out.prec = sum(p.PRECTOTCORR);
    if (p.ALLSKY_SFC_SW_DWN) out.solar = mean(p.ALLSKY_SFC_SW_DWN);
    return out;
  }
  const MOIS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
  const noClimate = ctx => blank(ctx, L(ctx, 'CLIMAT INDISPONIBLE — RELANCER', 'CLIMATE UNAVAILABLE — RETRY'));
  function chartFrame(ctx, s, title) {
    return '<rect width="' + W + '" height="' + H + '" fill="' + s.bg + '"/>' +
      '<text x="' + PAD + '" y="' + (PAD - 6) + '" font-size="6.5" fill="' + s.txt + '" font-family="ui-monospace,monospace">' + esc(title) + '</text>';
  }
  function monthAxis(s, y0, h, maxV, minV) {
    let out = '';
    const x0 = PAD + 10, x1 = W - PAD;
    const step = (x1 - x0) / 11;
    for (let i = 0; i < 12; i++) {
      const x = x0 + i * step;
      out += '<line x1="' + x.toFixed(1) + '" y1="' + (y0 + h) + '" x2="' + x.toFixed(1) + '" y2="' + (y0 + h + 3) + '" stroke="' + s.axis + '" stroke-width=".6"/>' +
             '<text x="' + x.toFixed(1) + '" y="' + (y0 + h + 10) + '" text-anchor="middle" font-size="5.5" fill="' + s.txt + '" font-family="ui-monospace,monospace">' + MOIS[i] + '</text>';
    }
    return out;
  }
  const yOf = (v, maxV, minV, y0, h) => y0 + h - (v - minV) / (maxV - minV || 1) * h;

  /* ══════════ 12 · ORIENTATION ══════════ */
  R.orient = (ctx, sc) => {
    const s = SCH.orient[sc % SCH.orient.length];
    const lines = roadLines(ctx);
    let body = '<rect width="' + W + '" height="' + H + '" fill="' + s.bg + '"/>';
    for (const ln of lines)
      body += '<path d="' + polylinePath(ln.pts) + '" fill="none" stroke="' + s.grid + '" stroke-width="1"/>';
    let ns = 0, ew = 0, tot = 0, weighted = 0, wsum = 0;
    for (const bl of bldPolys(ctx)) {
      /* azimut de la plus longue façade = orientation dominante de l'emprise */
      let best = 0, bestLen = 0;
      for (let i = 0; i < bl.pts.length; i++) {
        const a = bl.pts[i], b2 = bl.pts[(i + 1) % bl.pts.length];
        const len = Math.hypot(b2[0] - a[0], b2[1] - a[1]);
        if (len > bestLen) { bestLen = len; best = azimuth(a, b2); }
      }
      const t = Math.cos(best * Math.PI / 90);      // 1 = nord-sud, -1 = est-ouest
      const mix = (t + 1) / 2;
      tot++; if (Math.abs(best) < 30 || Math.abs(best - 180) < 30) ns++; else if (Math.abs(best - 90) < 30) ew++;
      weighted += best * bestLen; wsum += bestLen;
      const c1 = [74, 110, 140], c2 = [192, 138, 42];
      const col = 'rgb(' + c1.map((v, i) => Math.round(v + (c2[i] - v) * (1 - mix))).join(',') + ')';
      body += '<polygon points="' + polyStr(bl.pts) + '" fill="' + col + '" stroke="rgba(0,0,0,.25)" stroke-width=".2"/>';
    }
    body += siteMark(ctx, getBounds(ctx));
    const dom = wsum ? (weighted / wsum) : 45;
    return wrap(ctx, body, [
      { type: 'rect', c: 'rgb(74,110,140)', s: 'rgb(74,110,140)', l: L(ctx, 'AXE N-S', 'N-S AXIS') },
      { type: 'rect', c: 'rgb(192,138,42)', s: 'rgb(192,138,42)', l: L(ctx, 'AXE E-O', 'E-W AXIS') }
    ], Math.round(dom) + '° ' + L(ctx, 'AZIMUT DOMINANT (pondéré longueur) · ', 'WEIGHTED DOMINANT AZIMUT · ') + ns + ' N-S / ' + ew + ' E-O / ' + tot);
  };

  /* ══════════ 13 · ROSE DES ORIENTATIONS ══════════ */
  R.orientrose = (ctx, sc) => {
    const s = SCH.orient[sc % SCH.orient.length];
    const lines = roadLines(ctx), bins = new Float32Array(18), binB = new Float32Array(18);
    const addSeg = (a, b2, arr, w) => {
      let ang = Math.atan2(b2[1] - a[1], b2[0] - a[0]) * 180 / Math.PI;
      ang = ((ang % 180) + 180) % 180;
      arr[Math.min(17, Math.floor(ang / 10))] += w;
    };
    for (const ln of lines) for (let i = 1; i < ln.pts.length; i++) addSeg(ln.pts[i - 1], ln.pts[i], bins, 1);
    for (const bl of bldPolys(ctx)) for (let i = 0; i < bl.pts.length; i++) {
      const a = bl.pts[i], b2 = bl.pts[(i + 1) % bl.pts.length];
      addSeg(a, b2, binB, 1);
    }
    const cx = W / 2, cy = H / 2 - 6;
    let body = '<rect width="' + W + '" height="' + H + '" fill="' + s.bg + '"/>';
    for (let r = 20; r <= 74; r += 18)
      body += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + s.grid + '" stroke-width=".5"/>';
    for (let a = 0; a < 180; a += 30) {
      const rad = (a - 90) * Math.PI / 180;
      body += '<line x1="' + cx + '" y1="' + cy + '" x2="' + (cx + 76 * Math.cos(rad)).toFixed(1) + '" y2="' + (cy + 76 * Math.sin(rad)).toFixed(1) + '" stroke="' + s.grid + '" stroke-width=".4"/>';
    }
    body += '<text x="' + cx + '" y="' + (cy - 80) + '" text-anchor="middle" font-size="6" font-weight="700" fill="' + s.bld + '" font-family="ui-monospace,monospace">N</text>';
    const maxR = Math.max(...bins, ...binB, 1);
    /* secteur annulaire : petit arc intérieur, grand arc extérieur, refermé */
    const sector = (a0, a1, r0, r1, col, op) => {
      const pa = (a0 - 90) * Math.PI / 180, pb = (a1 - 90) * Math.PI / 180;
      const p = (r, a) => [(cx + r * Math.cos(a)).toFixed(1), (cy + r * Math.sin(a)).toFixed(1)];
      const [x1, y1] = p(r0, pa), [x2, y2] = p(r1, pa), [x3, y3] = p(r1, pb), [x4, y4] = p(r0, pb);
      const large = (a1 - a0) > 180 ? 1 : 0;
      return '<path d="M' + x1 + ',' + y1 + 'L' + x2 + ',' + y2 +
        'A' + r1.toFixed(1) + ',' + r1.toFixed(1) + ' 0 ' + large + ' 1 ' + x3 + ',' + y3 +
        'L' + x4 + ',' + y4 +
        'A' + r0.toFixed(1) + ',' + r0.toFixed(1) + ' 0 ' + large + ' 0 ' + x1 + ',' + y1 +
        'Z" fill="' + col + '" fill-opacity="' + op + '"/>';
    };
    for (let i = 0; i < 18; i++) {
      const a0 = i * 10, a1 = a0 + 9.2;
      if (bins[i] > 0) body += sector(a0, a1, 7, 7 + (bins[i] / maxR) * 66, s.rosa, .88);
      if (binB[i] > 0) body += sector(a0, a1, 2.5, 2.5 + (binB[i] / maxR) * 66, s.bld, .5);
    }
    let maxI = 0;
    for (let i = 1; i < 18; i++) if (bins[i] > bins[maxI]) maxI = i;
    const domA = maxI * 10 + 5;
    body += siteMark(ctx, getBounds(ctx));
    return wrap(ctx, body, [
      { type: 'rect', c: s.rosa, s: s.rosa, l: L(ctx, 'VOIRIE', 'STREETS') },
      { type: 'rect', c: s.bld, s: s.bld, l: L(ctx, 'BÂTI', 'BUILDINGS') }
    ], L(ctx, 'AXE DOMINANT ', 'DOMINANT AXIS ') + domA + '° · ' + lines.length + L(ctx, ' TRONÇONS', ' SEGMENTS'));
  };

  /* ══════════ 14 · BRUIT ROUTIER ══════════ */
  R.noise = (ctx, sc) => {
    const s = SCH.noise[sc % SCH.noise.length];
    const lines = roadLines(ctx);
    const grades = [
      { re: /motorway|trunk/, w: 26, lbl: 'MOTORWAY' },
      { re: /primary/, w: 20, lbl: 'PRIMARY' },
      { re: /secondary/, w: 14, lbl: 'SECONDARY' },
      { re: /tertiary|unclassified|residential|living_street|service/, w: 8, lbl: 'LOCAL' }
    ];
    let body = '<rect width="' + W + '" height="' + H + '" fill="' + s.bg + '"/>';
    /* du plus large au plus étroit : le centre reste le plus « fort » */
    const passes = [
      { w: 1.0, c: s.quiet, o: .85 },
      { w: 0.62, c: s.mid, o: .85 },
      { w: 0.36, c: s.loud, o: .9 },
      { w: 0.16, c: s.worst, o: .95 }
    ];
    for (const p of passes) {
      for (const ln of lines) for (const g2 of grades) {
        if (!g2.re.test(ln.h)) continue;
        body += '<path d="' + polylinePath(ln.pts) + '" fill="none" stroke="' + p.c + '" stroke-width="' + (g2.w * p.w).toFixed(1) +
                '" stroke-opacity="' + p.o + '" stroke-linecap="round" stroke-linejoin="round"/>';
      }
    }
    let exposed = 0, tot = 0;
    for (const bl of bldPolys(ctx)) {
      const [cx, cy] = centroid(bl.pts); tot++;
      let near = false;
      for (const ln of lines) {
        const g2 = grades.find(g3 => g3.re.test(ln.h));
        if (g2 && distToPolyline(cx, cy, ln.pts) < g2.w * 0.6) { near = true; break; }
      }
      if (near) {
        exposed++;
        body += '<polygon points="' + polyStr(bl.pts) + '" fill="none" stroke="' + s.site + '" stroke-width=".5" stroke-opacity=".8"/>';
      }
    }
    body += siteMark(ctx, getBounds(ctx));
    return wrap(ctx, body, [
      { type: 'rect', c: s.quiet, s: s.quiet, l: L(ctx, 'CALME', 'QUIET') },
      { type: 'rect', c: s.mid, s: s.mid, l: L(ctx, 'MODÉRÉ', 'MODERATE') },
      { type: 'rect', c: s.loud, s: s.loud, l: L(ctx, 'FORT', 'LOUD') },
      { type: 'rect', c: s.worst, s: s.worst, l: L(ctx, 'TRÈS FORT', 'VERY LOUD') }
    ], exposed + '/' + tot + L(ctx, ' BÂTIMENTS EN ZONE D\'EXPOSITION (ESTIMATION PAR CLASSE)', ' BUILDINGS IN EXPOSURE ZONES (CLASS ESTIMATE)'));
  };

  /* ══════════ 15 · VITALITÉ DES RUES ══════════ */
  R.vitality = (ctx, sc) => {
    const s = SCH.vitality[sc % SCH.vitality.length];
    const lines = roadLines(ctx), pois = poiPts(ctx);
    const maxD = 40;
    const countNear = (x, y) => {
      let n = 0;
      for (const p of pois) {
        if (p.k === 'transit') continue;
        if ((p.px - x) ** 2 + (p.py - y) ** 2 < maxD * maxD) n++;
      }
      return n;
    };
    const segs = [];
    for (const ln of lines) {
      for (let i = 1; i < ln.pts.length; i++) {
        const a = ln.pts[i - 1], b2 = ln.pts[i];
        const [mx, my] = [(a[0] + b2[0]) / 2, (a[1] + b2[1]) / 2];
        segs.push({ a, b: b2, v: countNear(mx, my), h: ln.h });
      }
    }
    const maxV = Math.max(1, ...segs.map(x => x.v));
    let body = '<rect width="' + W + '" height="' + H + '" fill="' + s.bg + '"/>';
    for (const bl of bldPolys(ctx))
      body += '<polygon points="' + polyStr(bl.pts) + '" fill="' + s.low + '" stroke="none" fill-opacity=".7"/>';
    let live = 0, lenLive = 0, lenAll = 0;
    for (const sg of segs) {
      const r = sg.v / maxV;
      const c = r > .75 ? s.top : r > .45 ? s.high : r > .18 ? s.mid : s.low2 || s.low;
      const w2 = ROADMAJOR.test(sg.h) ? 2 : 1;
      const len = Math.hypot(sg.b[0] - sg.a[0], sg.b[1] - sg.a[1]) / pxPerM(ctx);
      lenAll += len; if (r > .18) { live++; lenLive += len; }
      body += '<line x1="' + sg.a[0].toFixed(1) + '" y1="' + sg.a[1].toFixed(1) + '" x2="' + sg.b[0].toFixed(1) + '" y2="' + sg.b[1].toFixed(1) +
              '" stroke="' + c + '" stroke-width="' + w2 + '" stroke-linecap="round"/>';
    }
    for (const p of pois)
      body += '<circle cx="' + p.px.toFixed(1) + '" cy="' + p.py.toFixed(1) + '" r=".9" fill="' + s.poi + '" fill-opacity=".75"/>';
    body += siteMark(ctx, getBounds(ctx));
    return wrap(ctx, body, [
      { type: 'rect', c: s.low, s: s.low, l: L(ctx, 'CALME', 'QUIET') },
      { type: 'rect', c: s.mid, s: s.mid, l: L(ctx, 'ANIMÉ', 'LIVELY') },
      { type: 'rect', c: s.high, s: s.high, l: L(ctx, 'ACTIF', 'BUSY') },
      { type: 'rect', c: s.top, s: s.top, l: L(ctx, 'TRÈS ACTIF', 'VERY BUSY') }
    ], L(ctx, 'ACTIVITÉ RIVERAINE (POI < ', 'STREET-SIDE ACTIVITY (POI < ') + maxD + 'px) · ' + Math.round(lenLive) + '/' + Math.round(lenAll) + ' m');
  };

  /* ══════════ 16 · ACCÈS TRANSPORT ══════════ */
  R.transit = (ctx, sc) => {
    const s = SCH.transit[sc % SCH.transit.length];
    const pois = poiPts(ctx).filter(p => p.k === 'transit');
    const b = getBounds(ctx);
    const [sx, sy] = proj(ctx.sLat, ctx.sLng, b);
    let body = '<rect width="' + W + '" height="' + H + '" fill="' + s.bg + '"/>';
    for (const ln of roadLines(ctx))
      body += '<path d="' + polylinePath(ln.pts) + '" fill="none" stroke="' + s.rail + '" stroke-width="' + (ROADMAJOR.test(ln.h) ? .8 : .35) + '" stroke-opacity=".7"/>';
    const rings = [5, 10, 15], speed = 4.8 * 1000 / 60;   // 4,8 km/h → m/min
    const px = pxPerM(ctx);
    let reach5 = 0, reach10 = 0;
    for (const mn of rings) {
      const r = mn * speed * px;
      body += '<circle cx="' + sx.toFixed(1) + '" cy="' + sy.toFixed(1) + '" r="' + r.toFixed(1) +
              '" fill="' + s.fill + '" stroke="' + s.ring + '" stroke-width=".6" stroke-dasharray="3,2" fill-opacity=".5"/>' +
              '<text x="' + (sx + 3).toFixed(1) + '" y="' + (sy - r + 8).toFixed(1) + '" font-size="5.5" fill="' + s.lbl + '" font-family="ui-monospace,monospace">' + mn + ' MIN</text>';
    }
    for (const p of pois) {
      const d = Math.hypot(p.px - sx, p.py - sy) / px;
      if (mn => 0) { }
      if (d <= 400) reach5++; else if (d <= 800) reach10++;
      body += '<circle cx="' + p.px.toFixed(1) + '" cy="' + p.py.toFixed(1) + '" r="2" fill="' + s.stop + '" stroke="#FFFFFF" stroke-width=".4"/>';
    }
    body += siteMark(ctx, b);
    const nearest = pois.map(p => Math.hypot(p.px - sx, p.py - sy) / px).sort((a, c) => a - c)[0];
    return wrap(ctx, body, [
      { type: 'rect', c: s.stop, s: s.stop, l: L(ctx, 'ARRÊTS (' + pois.length + ')', 'STOPS (' + pois.length + ')') },
      { type: 'line', c: s.ring, l: L(ctx, 'ISOCHRONES', 'ISOCHRONES'), w: .9, da: '3,2' }
    ], pois.length ? L(ctx, 'LE PLUS PROCHE ', 'NEAREST ') + fmtM(nearest) + ' · ' + reach5 + L(ctx, ' ARRÊTS < 5 MIN', ' STOPS < 5 MIN') : L(ctx, 'AUCUN ARRÊT CARTOGRAPHIÉ DANS LE RAYON', 'NO MAPPED STOP IN RADIUS'));
  };

  /* ══════════ 17 · ACCESSIBILITÉ ══════════ */
  R.access = (ctx, sc) => {
    const s = SCH.access[sc % SCH.access.length];
    const lines = roadLines(ctx), px = pxPerM(ctx);
    const majors = lines.filter(l => ROADMAJOR.test(l.h));
    const N = 22, g = grid(N);
    let body = '<rect width="' + W + '" height="' + H + '" fill="' + s.bg + '"/>';
    const dist = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = g.cx(i), y = g.cy(j);
      let best = Infinity;
      for (const ln of majors) {
        const d = distToPolyline(x, y, ln.pts);
        if (d < best) best = d;
      }
      dist[g.idx(i, j)] = best / px;
    }
    const bands = [50, 100, 200, 400, 800];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const d = dist[g.idx(i, j)];
      const c = d < bands[0] ? s.f4 : d < bands[1] ? s.f3 : d < bands[2] ? s.f2 : d < bands[3] ? s.f1 : null;
      if (!c) continue;
      body += '<rect x="' + g.x(i).toFixed(1) + '" y="' + g.y(j).toFixed(1) + '" width="' + g.cell.toFixed(1) +
              '" height="' + g.cell.toFixed(1) + '" fill="' + c + '" fill-opacity=".9"/>';
    }
    for (const ln of lines)
      body += '<path d="' + polylinePath(ln.pts) + '" fill="none" stroke="' + (ROADMAJOR.test(ln.h) ? s.major : s.minor) +
              '" stroke-width="' + (ROADMAJOR.test(ln.h) ? 1.2 : .35) + '" stroke-linecap="round"/>';
    const south = Array.from(dist).filter(d => d < 200);
    body += siteMark(ctx, getBounds(ctx));
    return wrap(ctx, body, [
      { type: 'rect', c: s.f4, s: s.f4, l: L(ctx, '< 50 M', '< 50 M') },
      { type: 'rect', c: s.f3, s: s.f3, l: '< 100 M' },
      { type: 'rect', c: s.f2, s: s.f2, l: '< 200 M' },
      { type: 'rect', c: s.f1, s: s.f1, l: '< 400 M' }
    ], Math.round(south.length / (N * N) * 100) + L(ctx, '% DE LA SURFACE À MOINS DE 200 M DU RÉSEAU STRUCTURANT', '% OF AREA WITHIN 200 M OF THE MAJOR NETWORK'));
  };

  /* ══════════ 18 · RÉSEAU PIÉTON ══════════ */
  R.pedestrian = (ctx, sc) => {
    const s = SCH.access[(sc + 2) % SCH.access.length];
    const lines = roadLines(ctx), px = pxPerM(ctx);
    let body = '<rect width="' + W + '" height="' + H + '" fill="' + s.bg + '"/>';
    let walkLen = 0, vehLen = 0, footways = 0;
    for (const ln of lines) {
      const len = polyLen(ln.pts) / px;
      if (FOOT.test(ln.h)) {
        footways++; walkLen += len;
        body += '<path d="' + polylinePath(ln.pts) + '" fill="none" stroke="#FFFFFF" stroke-width="2.6" stroke-linecap="round" opacity=".9"/>';
        body += '<path d="' + polylinePath(ln.pts) + '" fill="none" stroke="' + s.f4 + '" stroke-width="1.2" stroke-linecap="round"/>';
      } else {
        vehLen += len;
        body += '<path d="' + polylinePath(ln.pts) + '" fill="none" stroke="' + s.minor + '" stroke-width="' + (ROADMAJOR.test(ln.h) ? 1.1 : .4) + '"/>';
      }
    }
    /* Connectivité : nœuds du réseau piéton et de la voirie locale. */
    const graph = buildGraph(lines.filter(l => FOOT.test(l.h) || /residential|living_street|tertiary|service/.test(l.h)));
    let deg1 = 0, deg0 = 0;
    const deg = new Uint16Array(graph.nodes.length);
    for (const [a, b2] of graph.edges) { deg[a]++; deg[b2]++; }
    for (let i = 0; i < deg.length; i++) { if (deg[i] === 0) deg0++; else if (deg[i] === 1) deg1++; }
    for (const ln of lines) {
      if (!FOOT.test(ln.h)) continue;
      for (const p of ln.pts) body += '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r=".8" fill="' + s.f4 + '"/>';
    }
    body += siteMark(ctx, getBounds(ctx));
    const total = walkLen + vehLen || 1;
    return wrap(ctx, body, [
      { type: 'line', c: s.f4, l: L(ctx, 'CHEMINEMENTS ' + fmtM(walkLen), 'FOOT PATHS ' + fmtM(walkLen)), w: 1.4 },
      { type: 'line', c: s.minor, l: L(ctx, 'VOIRIE ' + fmtM(vehLen), 'STREETS ' + fmtM(vehLen)), w: .8 },
      { type: 'rect', c: s.major, s: s.major, l: L(ctx, 'NŒUDS EN CUL-DE-SAC ' + deg1, 'DEAD-END NODES ' + deg1) }
    ], footways + L(ctx, ' CHEMINEMENTS · ', ' FOOTWAYS · ') + Math.round(walkLen / total * 100) + L(ctx, '% DU LINÉAIRE · ' + graph.nodes.length + ' NŒUDS', '% OF NETWORK · ' + graph.nodes.length + ' NODES'));
  };

  /* ══════════ 19 · ANALYSE NODALE ══════════ */
  R.nodes = (ctx, sc) => {
    const pal = SCH.vitality[sc % SCH.vitality.length];
    const lines = roadLines(ctx), pois = poiPts(ctx);
    const nodes = intersections(ctx, lines);
    let body = '<rect width="' + W + '" height="' + H + '" fill="#FFFFFF"/>';
    for (const ln of lines)
      body += '<path d="' + polylinePath(ln.pts) + '" fill="none" stroke="' + pal.low + '" stroke-width="' + (ROADMAJOR.test(ln.h) ? 1 : .4) + '"/>';
    /* polarités : carrefours enrichis par les POI alentour */
    const scored = nodes.map(([x, y]) => {
      let n = 0;
      for (const p of pois) if ((p.px - x) ** 2 + (p.py - y) ** 2 < 30 * 30) n++;
      return { x, y, n };
    }).sort((a, b2) => b2.n - a.n);
    for (const nd of scored) {
      const r = 1.6 + Math.min(6, nd.n * .6);
      body += '<circle cx="' + nd.x.toFixed(1) + '" cy="' + nd.y.toFixed(1) + '" r="' + r.toFixed(1) + '" fill="' + (nd.n >= 4 ? pal.top : pal.high) +
              '" fill-opacity=".85" stroke="#FFFFFF" stroke-width=".4"/>';
    }
    body += siteMark(ctx, getBounds(ctx));
    const strong = scored.filter(s2 => s2.n >= 4).length;
    return wrap(ctx, body, [
      { type: 'rect', c: pal.high, s: pal.high, l: L(ctx, 'CARREFOUR', 'JUNCTION') },
      { type: 'rect', c: pal.top, s: pal.top, l: L(ctx, 'POLARITÉ (≥4 POI)', 'HUB (≥4 POI)') }
    ], nodes.length + L(ctx, ' CARREFOURS DÉTECTÉS · ', ' JUNCTIONS DETECTED · ') + strong + L(ctx, ' POLARITÉS · ', ' HUBS · ') + pois.length + ' POI');
  };

  /* ══════════ 20 · SOURCES SONORES ══════════ */
  R.soundmap = (ctx, sc) => {
    const key = /bar|pub|nightclub|restaurant|cafe|fast_food|marketplace|fuel|car_repair/;
    const mid = /school|university|college|kindergarten|playground|pitch|sports_centre|stadium|fitness_centre|community_centre/;
    const s = SCH.sound[sc % SCH.sound.length];
    const pois = poiPts(ctx);
    const lines = roadLines(ctx);
    let body = '<rect width="' + W + '" height="' + H + '" fill="' + s.bg + '"/>';
    for (const ln of lines)
      body += '<path d="' + polylinePath(ln.pts) + '" fill="none" stroke="' + s.road + '" stroke-width="' + (ROADMAJOR.test(ln.h) ? 1.2 : .4) + '"/>';
    let loud = 0, medium = 0;
    const drawRings = (p, col, rMax) => {
      for (let i = 1; i <= 3; i++) {
        const r = (rMax / 3) * i * pxPerM(ctx) * 60;   // 60 m par anneau
        body += '<circle cx="' + p.px.toFixed(1) + '" cy="' + p.py.toFixed(1) + '" r="' + r.toFixed(1) + '" fill="none" stroke="' + col +
                '" stroke-width=".5" stroke-opacity=".' + (9 - i * 2) + '"/>';
      }
    };
    for (const p of pois) {
      const txt = (p.a || '') + ' ' + (p.s || '') + ' ' + (p.l || '');
      if (key.test(txt)) { loud++; drawRings(p, s.src, 1); }
      else if (mid.test(txt)) { medium++; drawRings(p, s.s3, .7); }
    }
    for (const p of pois) {
      const txt = (p.a || '') + ' ' + (p.s || '') + ' ' + (p.l || '');
      if (!key.test(txt) && !mid.test(txt)) continue;
      body += '<circle cx="' + p.px.toFixed(1) + '" cy="' + p.py.toFixed(1) + '" r="1.8" fill="' + (key.test(txt) ? s.src : s.s3) + '" stroke="#FFFFFF" stroke-width=".4"/>';
    }
    body += siteMark(ctx, getBounds(ctx));
    return wrap(ctx, body, [
      { type: 'rect', c: s.src, s: s.src, l: L(ctx, 'ÉMETTEURS FORTS ' + loud, 'LOUD SOURCES ' + loud) },
      { type: 'rect', c: s.s3, s: s.s3, l: L(ctx, 'MOYENS ' + medium, 'MEDIUM ' + medium) },
      { type: 'line', c: s.s4, l: L(ctx, 'ANNEAUX 60 M', 'RINGS 60 M'), w: .7 }
    ], L(ctx, 'SOURCES DÉDUITES DES CATÉGORIES OSM (BARS, ÉCOLES, SPORT, GARAGES…)', 'SOURCES INFERRED FROM OSM CATEGORIES (BARS, SCHOOLS, SPORT, GARAGES…)'));
  };

  /* ══════════ 21 · ACCESSIBILITÉ PIÉTONNE (isochrones) ══════════ */
  R.walkroutes = (ctx, sc) => {
    const s = SCH.transit[sc % SCH.transit.length];
    const lines = roadLines(ctx), px = pxPerM(ctx), b = getBounds(ctx);
    const graph = buildGraph(lines);
    if (!graph.nodes.length) return blank(ctx, L(ctx, 'RÉSEAU INDISPONIBLE', 'NETWORK UNAVAILABLE'));
    const [sx, sy] = proj(ctx.sLat, ctx.sLng, b);
    const src = nearestNode(graph.nodes, sx, sy);
    const speed = 4.8 * 1000 / 60;              // m/min
    const maxMin = 15;
    const dist = dijkstra(graph, src, maxMin * speed * px);
    const bandsM = [5, 10, 15].map(m => m * speed);
    const colors = ['#2E6E93', '#5A9AB8', '#8FC0D4'];
    let body = '<rect width="' + W + '" height="' + H + '" fill="' + s.bg + '"/>';
    for (const ln of lines)
      body += '<path d="' + polylinePath(ln.pts) + '" fill="none" stroke="' + s.rail + '" stroke-width=".4" stroke-opacity=".55"/>';
    /* chaque arête colorée par le temps de parcours depuis le site */
    let reach10 = 0, edges = 0;
    for (const [a, b2] of graph.edges) {
      const d = Math.max(dist[a], dist[b2]);
      if (!isFinite(d)) continue;
      edges++;
      const m = d / px;
      const c = m <= bandsM[0] ? colors[0] : m <= bandsM[1] ? colors[1] : m <= bandsM[2] ? colors[2] : null;
      if (!c) continue;
      if (m <= bandsM[1]) reach10++;
      const A = graph.nodes[a], B = graph.nodes[b2];
      body += '<line x1="' + A[0].toFixed(1) + '" y1="' + A[1].toFixed(1) + '" x2="' + B[0].toFixed(1) + '" y2="' + B[1].toFixed(1) +
              '" stroke="' + c + '" stroke-width="1.5" stroke-linecap="round"/>';
    }
    for (const mn of [5, 10, 15])
      body += '<text x="' + (sx + 3).toFixed(1) + '" y="' + (sy - mn * speed * px + 8).toFixed(1) + '" font-size="5.5" fill="' + s.lbl + '" font-family="ui-monospace,monospace">' + mn + '\'</text>';
    body += siteMark(ctx, b);
    return wrap(ctx, body, [
      { type: 'rect', c: colors[0], s: colors[0], l: L(ctx, '5 MIN', '5 MIN') },
      { type: 'rect', c: colors[1], s: colors[1], l: '10 MIN' },
      { type: 'rect', c: colors[2], s: colors[2], l: '15 MIN' }
    ], L(ctx, '4,8 KM/H · ', '4.8 KM/H · ') + Math.round(reach10 / (edges || 1) * 100) + L(ctx, '% DU RÉSEAU À 10 MIN', '% OF NETWORK WITHIN 10 MIN'));
  };

  /* ══════════ 22 · TERRITOIRES DE SERVICE (voronoï) ══════════ */
  R.voronoi = (ctx, sc) => {
    const keep = p => {
      const t = (p.a || '') + ' ' + (p.s || '') + ' ' + (p.l || '');
      return /school|university|college|library|hospital|clinic|pharmacy|supermarket|marketplace|park|garden|pharmacy|convenience|mall/.test(t);
    };
    const sites = poiPts(ctx).filter(keep).slice(0, 14);
    const pal = ['#C0392B', '#2A6A98', '#3FA86A', '#8858A8', '#D4A830', '#4A4844', '#B0562A', '#2E7A7A', '#7A2B6E', '#5A8C2A'];
    let body = '<rect width="' + W + '" height="' + H + '" fill="#FFFFFF"/>';
    if (sites.length < 2) return wrap(ctx, body + siteMark(ctx, getBounds(ctx)), [], L(ctx, 'PAS ASSEZ D\'ÉQUIPEMENTS CARTOGRAPHIÉS', 'NOT ENOUGH MAPPED FACILITIES'));
    const N = 26, g = grid(N);
    const cellSites = sites.map(p => [(p.px - PAD) / g.cell, (p.py - PAD) / g.cell]);
    const owner = voronoiCells(N, cellSites);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const o = owner[g.idx(i, j)];
      if (o < 0) continue;
      const c = pal[o % pal.length];
      body += '<rect x="' + g.x(i).toFixed(1) + '" y="' + g.y(j).toFixed(1) + '" width="' + (g.cell + .3).toFixed(1) +
              '" height="' + (g.cell + .3).toFixed(1) + '" fill="' + c + '" fill-opacity=".3"/>';
      /* frontières : cellule voisine différente */
      const right = i + 1 < N ? owner[g.idx(i + 1, j)] : o, down = j + 1 < N ? owner[g.idx(i, j + 1)] : o;
      if (right !== o) body += '<line x1="' + g.x(i + 1).toFixed(1) + '" y1="' + g.y(j).toFixed(1) + '" x2="' + g.x(i + 1).toFixed(1) + '" y2="' + g.y(j + 1).toFixed(1) + '" stroke="#55524C" stroke-width=".7" stroke-opacity=".8"/>';
      if (down !== o) body += '<line x1="' + g.x(i).toFixed(1) + '" y1="' + g.y(j + 1).toFixed(1) + '" x2="' + g.x(i + 1).toFixed(1) + '" y2="' + g.y(j + 1).toFixed(1) + '" stroke="#55524C" stroke-width=".7" stroke-opacity=".8"/>';
    }
    for (const ln of roadLines(ctx))
      body += '<path d="' + polylinePath(ln.pts) + '" fill="none" stroke="rgba(0,0,0,.25)" stroke-width=".3"/>';
    for (let i = 0; i < sites.length; i++) {
      const p = sites[i];
      body += '<circle cx="' + p.px.toFixed(1) + '" cy="' + p.py.toFixed(1) + '" r="2.4" fill="' + pal[i % pal.length] + '" stroke="#FFF" stroke-width=".5"/>';
    }
    body += siteMark(ctx, getBounds(ctx));
    return wrap(ctx, body, [
      { type: 'rect', c: pal[0], s: pal[0], l: L(ctx, 'ÉQUIPEMENTS ' + sites.length, 'FACILITIES ' + sites.length) },
      { type: 'line', c: '#55524C', l: L(ctx, 'FRONTIÈRES', 'BOUNDARIES'), w: .8 }
    ], L(ctx, 'CELLULES DE PLUS PROCHE VOISIN (ÉQUIDISTANCE AUX SERVICES)', 'NEAREST-NEIGHBOUR CELLS (EQUIDISTANT TO SERVICES)'));
  };

  /* ══════════ 23 · CARTE ANNOTÉE ══════════ */
  R.sitemap = (ctx, sc) => {
    const s = SCH.access[sc % SCH.access.length];
    const b = getBounds(ctx), px = pxPerM(ctx);
    const [sx, sy] = proj(ctx.sLat, ctx.sLng, b);
    let body = '<rect width="' + W + '" height="' + H + '" fill="#FFFFFF"/>';
    for (const bl of bldPolys(ctx))
      body += '<polygon points="' + polyStr(bl.pts) + '" fill="' + s.f1 + '" stroke="none"/>';
    for (const ln of roadLines(ctx))
      body += '<path d="' + polylinePath(ln.pts) + '" fill="none" stroke="' + (ROADMAJOR.test(ln.h) ? s.major : s.minor) +
              '" stroke-width="' + (ROADMAJOR.test(ln.h) ? 1.1 : .35) + '" stroke-linecap="round"/>';
    const cat = p => {
      const t = (p.a || '') + ' ' + (p.s || '') + ' ' + (p.l || '');
      if (/school|university|college|kindergarten|library/.test(t)) return [0, L(ctx, 'école', 'school')];
      if (/hospital|clinic|doctors|pharmacy/.test(t)) return [1, L(ctx, 'santé', 'health')];
      if (/supermarket|marketplace|convenience|mall|shop/.test(t)) return [2, L(ctx, 'commerce', 'shop')];
      if (p.k === 'transit') return [3, L(ctx, 'transport', 'transit')];
      if (/park|garden|leisure/.test(t)) return [4, L(ctx, 'parc', 'park')];
      return [5, ''];
    };
    const cols = ['#C0392B', '#8858A8', '#D4A830', '#2A6A98', '#3FA86A', '#9A9690'];
    const picked = [];
    for (const p of poiPts(ctx)) {
      const [k, lbl] = cat(p);
      if (k === 5) continue;
      body += '<circle cx="' + p.px.toFixed(1) + '" cy="' + p.py.toFixed(1) + '" r="1.9" fill="' + cols[k] + '" stroke="#FFF" stroke-width=".4"/>';
      const d = Math.hypot(p.px - sx, p.py - sy) / px;
      picked.push({ p, k, lbl, d });
    }
    /* les 6 destinations les plus proches sont annotées */
    picked.sort((a, c) => a.d - c.d).slice(0, 6).forEach((it, i) => {
      const above = i % 2 === 0;
      const ty = it.p.py + (above ? -7 : 11);
      const tx = it.p.px + (it.p.px > W / 2 ? -6 : 6);
      const anchor = it.p.px > W / 2 ? 'end' : 'start';
      const name = (it.p.n || it.lbl).slice(0, 16);
      body += '<line x1="' + it.p.px.toFixed(1) + '" y1="' + it.p.py.toFixed(1) + '" x2="' + it.p.px.toFixed(1) + '" y2="' + (it.p.py + (above ? -4 : 4)).toFixed(1) + '" stroke="' + cols[it.k] + '" stroke-width=".5"/>' +
              '<text x="' + tx.toFixed(1) + '" y="' + ty.toFixed(1) + '" text-anchor="' + anchor + '" font-size="5.6" fill="#3A3835" font-family="ui-sans-serif,sans-serif">' +
              esc(name) + ' · ' + fmtM(it.d) + '</text>';
    });
    body += siteMark(ctx, b);
    return wrap(ctx, body, [
      { type: 'rect', c: cols[0], s: cols[0], l: L(ctx, 'ÉCOLES', 'SCHOOLS') },
      { type: 'rect', c: cols[1], s: cols[1], l: L(ctx, 'SANTÉ', 'HEALTH') },
      { type: 'rect', c: cols[2], s: cols[2], l: L(ctx, 'COMMERCES', 'SHOPS') },
      { type: 'rect', c: cols[3], s: cols[3], l: L(ctx, 'TRANSPORT', 'TRANSIT') },
      { type: 'rect', c: cols[4], s: cols[4], l: L(ctx, 'PARCS', 'PARKS') }
    ], picked.length + L(ctx, ' DESTINATIONS · 6 ANNONCÉES · DISTANCES À VOL D\'OISEAU', ' DESTINATIONS · 6 LABELLED · STRAIGHT-LINE DISTANCES'));
  };

  /* ══════════ 24 · CONTEXTE URBAIN ══════════ */
  R.context = (ctx, sc) => {
    const s = SCH.access[(sc + 1) % SCH.access.length];
    const b = getBounds(ctx), px = pxPerM(ctx);
    const [sx, sy] = proj(ctx.sLat, ctx.sLng, b);
    let body = '<rect width="' + W + '" height="' + H + '" fill="' + s.bg + '"/>';
    for (const bl of bldPolys(ctx))
      body += '<polygon points="' + polyStr(bl.pts) + '" fill="' + s.f2 + '" fill-opacity=".9"/>';
    for (const ln of roadLines(ctx))
      body += '<path d="' + polylinePath(ln.pts) + '" fill="none" stroke="' + (ROADMAJOR.test(ln.h) ? s.major : s.minor) +
              '" stroke-width="' + (ROADMAJOR.test(ln.h) ? 1 : .25) + '" stroke-linecap="round"/>';
    /* couronnes de distance, étiquetées au-delà du site */
    for (const m of [250, 500, 1000, 2000]) {
      const r = m * px;
      if (r > 200) continue;
      body += '<circle cx="' + sx.toFixed(1) + '" cy="' + sy.toFixed(1) + '" r="' + r.toFixed(1) + '" fill="none" stroke="' + s.f4 +
              '" stroke-width=".5" stroke-dasharray="4,3" stroke-opacity=".85"/>' +
              '<text x="' + (sx + 3).toFixed(1) + '" y="' + (sy - r + 8).toFixed(1) + '" font-size="5.4" fill="' + s.major + '" font-family="ui-monospace,monospace">' + (m >= 1000 ? (m / 1000) + ' km' : m + ' m') + '</text>';
    }
    body += siteMark(ctx, b);
    const built = (ctx.D.build || []).length;
    return wrap(ctx, body, [
      { type: 'rect', c: s.f2, s: s.f2, l: L(ctx, 'BÂTI ' + built, 'BUILT ' + built) },
      { type: 'line', c: s.major, l: L(ctx, 'RÉSEAU PRINCIPAL', 'MAIN ROADS'), w: 1.1 },
      { type: 'line', c: s.f4, l: L(ctx, 'COURONNES', 'RINGS'), w: .8, da: '4,3' }
    ], ctx.siteName ? esc(String(ctx.siteName).slice(0, 44)) : L(ctx, 'CONTEXTE ÉLARGI', 'WIDER CONTEXT'));
  };

  /* ══════════ 25 · CHAMP DE CONNEXITÉ ══════════ */
  R.connectionfield = (ctx, sc) => {
    const s = SCH.density[(sc + 1) % SCH.density.length];
    const lines = roadLines(ctx), px = pxPerM(ctx);
    const nodes = intersections(ctx, lines);
    const N = 20, g = grid(N);
    let body = '<rect width="' + W + '" height="' + H + '" fill="' + s.none + '"/>';
    if (nodes.length < 2) return wrap(ctx, body + siteMark(ctx, getBounds(ctx)), [], L(ctx, 'PAS ASSEZ DE CARREFOURS', 'NOT ENOUGH JUNCTIONS'));
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = g.cx(i), y = g.cy(j);
      let best = Infinity;
      for (const [nx, ny] of nodes) {
        const d2 = (nx - x) ** 2 + (ny - y) ** 2;
        if (d2 < best) best = d2;
      }
      const d = Math.sqrt(best);
      const c = d < 12 ? s.l5 : d < 26 ? s.l4 : d < 44 ? s.l3 : d < 66 ? s.l2 : s.l1;
      body += '<rect x="' + g.x(i).toFixed(1) + '" y="' + g.y(j).toFixed(1) + '" width="' + (g.cell + .3).toFixed(1) +
              '" height="' + (g.cell + .3).toFixed(1) + '" fill="' + c + '" fill-opacity=".92"/>';
    }
    for (const ln of lines)
      body += '<path d="' + polylinePath(ln.pts) + '" fill="none" stroke="#FFFFFF" stroke-width="' + (ROADMAJOR.test(ln.h) ? 1.1 : .45) + '" stroke-opacity=".9"/>';
    for (const [x, y] of nodes)
      body += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="1.1" fill="#1A1917"/>';
    body += siteMark(ctx, getBounds(ctx));
    return wrap(ctx, body, [
      { type: 'rect', c: s.l5, s: s.l5, l: L(ctx, 'TRÈS CONNECTÉ', 'HIGHLY CONNECTED') },
      { type: 'rect', c: s.l3, s: s.l3, l: L(ctx, 'INTERMÉDIAIRE', 'IN BETWEEN') },
      { type: 'rect', c: s.l1, s: s.l1, l: L(ctx, 'ISOLÉ', 'ISOLATED') }
    ], nodes.length + L(ctx, ' CARREFOURS · CHAMP DE DISTANCE GÉOMÉTRIQUE (NON UN FLUX MESURÉ)', ' JUNCTIONS · GEOMETRIC DISTANCE FIELD (NOT MEASURED FLOW)'));
  };

  /* ══════════ 26 · COURSE SOLAIRE & OMBRES ══════════ */
  function sunPos(lat, dayOfYear, hour) {
    const rad = Math.PI / 180;
    const decl = 23.44 * Math.sin(rad * 360 / 365 * (284 + dayOfYear));
    const H = 15 * (hour - 12);
    const alt = Math.asin(Math.sin(rad * lat) * Math.sin(rad * decl) +
      Math.cos(rad * lat) * Math.cos(rad * decl) * Math.cos(rad * H)) / rad;
    let az = Math.atan2(
      Math.sin(rad * H),
      Math.cos(rad * H) * Math.sin(rad * lat) - Math.tan(rad * decl) * Math.cos(rad * lat)
    ) / rad;
    az = 180 - az;    // 0 = nord, 90 = est
    if (az < 0) az += 360;
    if (H > 0) az = (az + 180) % 360;
    return { alt, az };
  }
  R.sun = (ctx, sc) => {
    const s = SCH.sun[sc % SCH.sun.length];
    const hour = ctx.time != null ? ctx.time : 12;
    const doy = 172;                                  // 21 juin par défaut
    const pos = sunPos(ctx.sLat, doy, hour);
    const b = getBounds(ctx), px = pxPerM(ctx);
    const [sx, sy] = proj(ctx.sLat, ctx.sLng, b);
    let body = '<rect width="' + W + '" height="' + H + '" fill="' + s.bg + '"/>';
    for (const ln of roadLines(ctx))
      body += '<path d="' + polylinePath(ln.pts) + '" fill="none" stroke="' + s.ground + '" stroke-width="' + (ROADMAJOR.test(ln.h) ? 2 : 1) + '"/>';
    /* ombres portées : décalage = hauteur / tan(altitude), direction opposée au soleil */
    if (pos.alt > 2) {
      const azRad = (pos.az) * Math.PI / 180;
      const dx = Math.sin(azRad), dy = -Math.cos(azRad);   // vers lequel pointe l'ombre
      const k = 1 / Math.tan(pos.alt * Math.PI / 180);
      for (const bl of bldPolys(ctx)) {
        const hm = bl.h > 0 ? bl.h : 9;
        const off = Math.min(60, hm * k * px);
        body += '<polygon points="' + polyStr(bl.pts.map(p => [p[0] - dx * off * .55, p[1] - dy * off * .55])) +
                '" fill="' + s.bldShadow + '" fill-opacity=".85"/>';
        body += '<polygon points="' + polyStr(bl.pts) + '" fill="' + s.bld + '"/>';
      }
    } else {
      for (const bl of bldPolys(ctx))
        body += '<polygon points="' + polyStr(bl.pts) + '" fill="' + s.bld + '"/>';
    }
    /* héliodon : trajectoire du soleil sur la voute */
    const cx = W / 2, cy = H + 26, rad = 100;
    let arc = '';
    for (let h = 4; h <= 20; h += .5) {
      const p = sunPos(ctx.sLat, doy, h);
      if (p.alt < 0) continue;
      const r = rad * (1 - p.alt / 110);
      const a = (p.az - 180) * Math.PI / 180;
      const x = cx - r * Math.sin(a) * -1, y = cy - r * Math.cos(a) * 0 - (1 - p.alt / 110) * 40 - 8;
      arc += (arc ? 'L' : 'M') + x.toFixed(1) + ',' + y.toFixed(1);
    }
    if (arc) body += '<path d="' + arc + '" fill="none" stroke="' + s.arc + '" stroke-width="1.1" stroke-opacity=".9"/>';
    body += '<circle cx="' + sx.toFixed(1) + '" cy="' + sy.toFixed(1) + '" r="3.2" fill="' + s.now + '"/>';
    body += siteMark(ctx, b);
    const hh = String(Math.floor(hour)).padStart(2, '0'), mm = String(Math.round((hour % 1) * 60)).padStart(2, '0');
    return wrap(ctx, body, [
      { type: 'rect', c: s.bld, s: s.bld, l: L(ctx, 'BÂTI', 'BUILT') },
      { type: 'rect', c: s.bldShadow, s: s.bldShadow, l: L(ctx, 'OMBRE PORTÉE', 'CAST SHADOW') },
      { type: 'rect', c: s.arc, s: s.arc, l: L(ctx, 'HÉLIODON', 'SUN PATH') }
    ], L(ctx, '21 JUIN · ', 'JUNE 21 · ') + hh + ':' + mm + ' · ' + L(ctx, 'HAUTEUR ', 'ALTITUDE ') + pos.alt.toFixed(0) + '° · ' + L(ctx, 'AZIMUT ', 'AZIMUTH ') + pos.az.toFixed(0) + '°' +
      (pos.alt <= 2 ? L(ctx, ' · SOLEIL COUCHÉ', ' · SUN BELOW HORIZON') : ''), { dark: sc % 4 >= 2 });
  };

  /* ══════════ 27 · SITUATION ══════════ */
  R.location = (ctx, sc) => {
    const s = SCH.access[sc % SCH.access.length];
    const b = getBounds(ctx), px = pxPerM(ctx);
    const [sx, sy] = proj(ctx.sLat, ctx.sLng, b);
    const lat = ctx.sLat, lon = ctx.sLng;
    const hem = lat >= 0 ? L(ctx, 'HÉMISPHÈRE NORD', 'NORTHERN HEMISPHERE') : L(ctx, 'HÉMISPHÈRE SUD', 'SOUTHERN HEMISPHERE');
    const zone = Math.abs(lat) < 23.5 ? L(ctx, 'TROPICAL', 'TROPICAL') : Math.abs(lat) < 66.5 ? L(ctx, 'TEMPÉRÉ', 'TEMPERATE') : L(ctx, 'POLAIRE', 'POLAR');
    let body = '<rect width="' + W + '" height="' + H + '" fill="' + s.bg + '"/>';
    for (const bl of bldPolys(ctx))
      body += '<polygon points="' + polyStr(bl.pts) + '" fill="' + s.f1 + '"/>';
    for (const ln of roadLines(ctx))
      body += '<path d="' + polylinePath(ln.pts) + '" fill="none" stroke="' + (ROADMAJOR.test(ln.h) ? s.major : s.minor) +
              '" stroke-width="' + (ROADMAJOR.test(ln.h) ? 1 : .3) + '"/>';
    for (const m of [500, 1000, 2000]) {
      const r = m * px;
      if (r > 180) continue;
      body += '<circle cx="' + sx.toFixed(1) + '" cy="' + sy.toFixed(1) + '" r="' + r.toFixed(1) + '" fill="none" stroke="' + s.f4 + '" stroke-width=".5" stroke-dasharray="3,3"/>';
    }
    const fmt = (v, pos, neg) => Math.abs(v).toFixed(4) + '° ' + (v >= 0 ? pos : neg);
    body += '<rect x="' + PAD + '" y="' + (H - 34) + '" width="' + (W - PAD * 2) + '" height="20" fill="#FFFFFF" fill-opacity=".82" rx="3"/>';
    body += '<text x="' + (PAD + 4) + '" y="' + (H - 24) + '" font-size="7" fill="#2E2C28" font-family="ui-monospace,monospace" font-weight="700">' + fmt(lat, 'N', 'S') + '  ' + fmt(lon, 'E', 'O') + '</text>';
    body += '<text x="' + (PAD + 4) + '" y="' + (H - 17) + '" font-size="5.4" fill="' + s.major + '" font-family="ui-monospace,monospace">' + hem + ' · ' + zone + ' · ' + L(ctx, 'FUSEAU ', 'UTC ') + (lon >= 0 ? '+' : '') + Math.round(lon / 15) + '</text>';
    body += siteMark(ctx, b);
    return wrap(ctx, body, [
      { type: 'rect', c: s.f1, s: s.f1, l: L(ctx, 'BÂTI', 'BUILT') },
      { type: 'line', c: s.f4, l: L(ctx, 'COURONNES', 'RINGS'), w: .8, da: '3,3' }
    ], (ctx.siteName ? esc(String(ctx.siteName).slice(0, 34)) + ' · ' : '') + L(ctx, 'ÉQUATEUR ', 'EQUATOR ') + Math.round(Math.abs(lat) * 111.32) + ' km · ' + L(ctx, 'MÉRIDIEN ', 'MERIDIAN ') + Math.round(Math.abs(lon) * 111.32 * Math.cos(lat * Math.PI / 180)) + ' km');
  };

  /* ══════════ terrain : helpers ══════════ */
  function terrainGrid(ctx) {
    const t = ctx.terrain;
    if (!t || !t.grid || !t.grid.length) return null;
    const n = t.grid.length;
    let min = Infinity, max = -Infinity;
    for (const row of t.grid) for (const v of row) { if (v < min) min = v; if (v > max) max = v; }
    return { grid: t.grid, n, min, max, range: max - min || 1, zoom: t.zoom };
  }
  const tNoData = ctx => blank(ctx, L(ctx, 'ALTIMÉTRIE INDISPONIBLE — RELANCER', 'ELEVATION UNAVAILABLE — RETRY'));

  /* ══════════ 28 · TOPOGRAPHIE ══════════ */
  R.contour = (ctx, sc) => {
    const T = terrainGrid(ctx);
    if (!T) return tNoData(ctx);
    const s = SCH.terrain[sc % SCH.terrain.length];
    const { grid: G2, n, min, max, range } = T;
    const cell = (W - PAD * 2) / (n - 1);
    const bands = 7, cols = [s.c1, s.c2, s.c3, s.c4, s.c5, s.c6, s.hi];
    let body = '<rect width="' + W + '" height="' + H + '" fill="' + s.bg + '"/>';
    for (let j = 2; j < n; j++) for (let i = 2; i < n; i++) {
      const v = G2[j][i], band = Math.min(bands - 1, Math.floor((v - min) / range * bands));
      body += '<rect x="' + (PAD + (i - 1) * cell - cell / 2).toFixed(1) + '" y="' + (PAD + (j - 1) * cell - cell / 2).toFixed(1) +
              '" width="' + (cell + .6).toFixed(1) + '" height="' + (cell + .6).toFixed(1) + '" fill="' + cols[band] + '"/>';
    }
    /* courbes de niveau tous les 10 % de l'amplitude */
    const inv = 1 / cell;
    for (let k = 1; k < 8; k++) {
      const lvl = min + range * (k / 8);
      const lines = contours(G2, n, lvl);
      for (const ln of lines) {
        const pts = ln.map(([x, y]) => [(PAD + x * cell).toFixed(1), (PAD + y * cell).toFixed(1)]);
        body += '<path d="' + polylinePath(pts) + '" fill="none" stroke="' + s.line + '" stroke-width="' + (k % 4 === 0 ? .9 : .55) + '" stroke-opacity=".9"/>';
      }
    }
    body += siteMark(ctx, getBounds(ctx));
    /* pente moyenne */
    let slopeSum = 0, cnt = 0, acc = 0;
    const mPerCell = (ctx.curR * 2) / (n - 1);
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const gx = (G2[j][i + 1] - G2[j][i]) / mPerCell, gy = (G2[j + 1][i] - G2[j][i]) / mPerCell;
      slopeSum += Math.atan(Math.hypot(gx, gy)) * 180 / Math.PI; cnt++;
      acc += (G2[j][i] - min);
    }
    return wrap(ctx, body, [
      { type: 'rect', c: s.lo, s: s.lo, l: fmtN(min) + ' m' },
      { type: 'rect', c: s.line, s: s.line, l: L(ctx, 'COURBES', 'CONTOURS') },
      { type: 'rect', c: s.hi, s: s.hi, l: fmtN(max) + ' m' }
    ], L(ctx, 'SRTM/USGS · ', 'SRTM/USGS · ') + fmtN(range) + L(ctx, ' M D\'AMPLITUDE · PENTE MOYENNE ', ' M RANGE · MEAN SLOPE ') + (slopeSum / cnt).toFixed(1) + '°');
  };

  /* ══════════ 29 · PENTE & EXPOSITION ══════════ */
  R.aspect = (ctx, sc) => {
    const T = terrainGrid(ctx);
    if (!T) return tNoData(ctx);
    const s = SCH.terrain[(sc + 2) % SCH.terrain.length];
    const { grid: G2, n, min, range } = T;
    const cell = (W - PAD * 2) / (n - 1);
    const mPerCell = (ctx.curR * 2) / (n - 1);
    /* exposition : N (bleu), E (jaune), S (rouge), O (vert) — teinte par angle */
    const ASP = [[210, '#4A6E8C'], [120, '#5E9E6E'], [0, '#C0604A'], [300, '#B08F4A']];
    const aspectColor = ang => {
      const mix = (a, b2, t) => a.map((v, i) => Math.round(v + (b2[i] - v) * t));
      const stops = [[210, [74, 110, 140]], [120, [94, 158, 110]], [30, [192, 96, 74]], [300, [176, 143, 74]], [210, [74, 110, 140]]];
      let a = ang; if (a < 30) a += 360;
      for (let i = 0; i < stops.length - 1; i++) {
        const [a1, c1] = stops[i], [a2, c2] = stops[i + 1];
        if (a <= a1 && a >= a2) {
          const t = (a1 - a) / (a1 - a2);
          const c = mix(c1, c2, t);
          return 'rgb(' + c.join(',') + ')';
        }
      }
      return 'rgb(148,148,148)';
    };
    let body = '<rect width="' + W + '" height="' + H + '" fill="' + s.bg + '"/>';
    let steepest = 0, flat = 0;
    for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
      const dzdx = (G2[j][i + 1] - G2[j][i - 1]) / (2 * mPerCell);
      const dzdy = (G2[j + 1][i] - G2[j - 1][i]) / (2 * mPerCell);
      const slope = Math.atan(Math.hypot(dzdx, dzdy)) * 180 / Math.PI;
      steepest = Math.max(steepest, slope); if (slope < 1) flat++;
      /* exposition : pente descendante, azimut 0 = nord */
      let ang = Math.atan2(-dzdx, dzdy) * 180 / Math.PI;
      if (ang < 0) ang += 360;
      body += '<rect x="' + (PAD + (i - .5) * cell).toFixed(1) + '" y="' + (PAD + (j - .5) * cell).toFixed(1) +
              '" width="' + (cell + .6).toFixed(1) + '" height="' + (cell + .6).toFixed(1) +
              '" fill="' + aspectColor(ang) + '" fill-opacity="' + (0.25 + Math.min(.7, slope / 25)).toFixed(2) + '"/>';
      if ((i + j) % 4 === 0 && slope > 2) {
        const dx = Math.sin(ang * Math.PI / 180), dy = -Math.cos(ang * Math.PI / 180);
        const x = PAD + i * cell, y = PAD + j * cell, L2 = 3 + Math.min(5, slope / 4);
        body += '<line x1="' + (x - dx * L2).toFixed(1) + '" y1="' + (y - dy * L2).toFixed(1) + '" x2="' + (x + dx * L2).toFixed(1) + '" y2="' + (y + dy * L2).toFixed(1) +
                '" stroke="#3A3835" stroke-width=".45" stroke-opacity=".7"/>';
      }
    }
    body += siteMark(ctx, getBounds(ctx));
    return wrap(ctx, body, [
      { type: 'rect', c: '#4A6E8C', s: '#4A6E8C', l: L(ctx, 'NORD', 'NORTH') },
      { type: 'rect', c: '#5E9E6E', s: '#5E9E6E', l: L(ctx, 'EST', 'EAST') },
      { type: 'rect', c: '#C0604A', s: '#C0604A', l: L(ctx, 'SUD', 'SOUTH') },
      { type: 'rect', c: '#B08F4A', s: '#B08F4A', l: L(ctx, 'OUEST', 'WEST') }
    ], L(ctx, 'PENTE MAX ', 'MAX SLOPE ') + steepest.toFixed(1) + '° · ' + Math.round(flat / (n * n) * 100) + L(ctx, '% DE PLAT (<1°) · FLÈCHES = DESCENTE', '% FLAT (<1°) · ARROWS POINT DOWNHILL'));
  };

  /* ══════════ 30 · TRAME DE TERRAIN ══════════ */
  R.wireframe = (ctx, sc) => {
    const T = terrainGrid(ctx);
    if (!T) return tNoData(ctx);
    const s = SCH.terrain[sc % SCH.terrain.length];
    const { grid: G2, n, min, max, range } = T;
    const ax = axono();
    const step = 2;                                   // une ligne sur deux (lisibilité)
    const span = 158;                                 // encombrement du losange dans la toile
    const project = (i, j) => {
      const h = (G2[j][i] - min) / range * 42;
      const x = 120 + ((i / (n - 1)) - .5) * span;
      const y = 134 + ((j / (n - 1)) - .5) * span;
      return ax.pt(x, y, -h);
    };
    let body = '<rect width="' + W + '" height="' + H + '" fill="' + s.bg + '"/>';
    for (let j = 0; j < n; j += step) {
      let d = '';
      for (let i = 0; i < n; i++) { const p = project(i, j); d += (d ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1); }
      const v = G2[j][Math.floor(n / 2)];
      const band = Math.min(6, Math.floor((v - min) / range * 7));
      body += '<path d="' + d + '" fill="none" stroke="' + [s.c1, s.c2, s.c3, s.c4, s.c5, s.c6, s.hi][band] + '" stroke-width=".6" stroke-opacity=".95"/>';
    }
    for (let i = 0; i < n; i += step) {
      let d = '';
      for (let j = 0; j < n; j++) { const p = project(i, j); d += (d ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1); }
      const v = G2[Math.floor(n / 2)][i];
      const band = Math.min(6, Math.floor((v - min) / range * 7));
      body += '<path d="' + d + '" fill="none" stroke="' + [s.c1, s.c2, s.c3, s.c4, s.c5, s.c6, s.hi][band] + '" stroke-width=".6" stroke-opacity=".6"/>';
    }
    const c = project(Math.floor(n / 2), Math.floor(n / 2));
    body += '<circle cx="' + c[0].toFixed(1) + '" cy="' + c[1].toFixed(1) + '" r="3" fill="' + s.site + '"/>' +
            '<text x="' + (c[0] + 5).toFixed(1) + '" y="' + (c[1] + 2).toFixed(1) + '" font-size="5.5" fill="#3A3835" font-family="ui-monospace,monospace">' + fmtN(G2[Math.floor(n / 2)][Math.floor(n / 2)]) + ' m</text>';
    return wrap(ctx, body, [
      { type: 'rect', c: s.lo, s: s.lo, l: fmtN(min) + ' m' },
      { type: 'rect', c: s.hi, s: s.hi, l: fmtN(max) + ' m' }
    ], L(ctx, 'TRAME ', 'MESH ') + n + '×' + n + ' · ' + L(ctx, 'ZOOM TUILES ', 'TILE ZOOM ') + T.zoom + ' · ' + L(ctx, 'EXAGÉRATION VERTICALE ≈ ×', 'VERTICAL EXAGGERATION ≈ ×') + (range / (ctx.curR * 2) * (42 / range) * (ctx.curR * 2) / 42 * 1).toFixed(0) + ' corps');
  };

  /* ══════════ 31-35 · CLIMAT ══════════ */
  R.climtemp = (ctx, sc) => {
    const M = monthly(ctx); if (!M || !M.tmax) return noClimate(ctx);
    const s = SCH.climate[sc % SCH.climate.length];
    let body = chartFrame(ctx, s, L(ctx, 'TEMPÉRATURES MENSUELLES · NASA POWER (3 ANS)', 'MONTHLY TEMPERATURES · NASA POWER (3 YR)'));
    const all = M.tmax.concat(M.tmin).filter(v => v != null);
    const min = Math.floor(Math.min(...all) - 2), max = Math.ceil(Math.max(...all) + 2);
    const y0 = PAD + 6, h = H - PAD * 2 - 22;
    let up = '', dn = '';
    M.tmax.forEach((v, i) => {
      if (v == null) return;
      const x = PAD + 10 + i * (W - PAD * 2 - 10) / 11, y = yOf(v, max, min, y0, h);
      up += (up ? 'L' : 'M') + x.toFixed(1) + ',' + y.toFixed(1);
    });
    M.tmin.forEach((v, i) => {
      if (v == null) return;
      const x = PAD + 10 + i * (W - PAD * 2 - 10) / 11, y = yOf(v, max, min, y0, h);
      dn += (dn ? 'L' : 'M') + x.toFixed(1) + ',' + y.toFixed(1);
    });
    const band = up + 'L' + dn.replace(/^M/, '').split('L').reverse().join('L') + 'Z';
    body += '<path d="' + band + '" fill="' + s.warm + '" fill-opacity=".12"/>';
    body += '<path d="' + up + '" fill="none" stroke="' + s.warm + '" stroke-width="1.6"/>';
    body += '<path d="' + dn + '" fill="none" stroke="' + s.cool + '" stroke-width="1.6"/>';
    for (let k = 0; k <= 4; k++) {
      const v = min + (max - min) * k / 4, y = yOf(v, max, min, y0, h);
      body += '<line x1="' + (PAD + 10) + '" y1="' + y.toFixed(1) + '" x2="' + (W - PAD) + '" y2="' + y.toFixed(1) + '" stroke="' + s.axis + '" stroke-width=".3"/>' +
              '<text x="' + (PAD + 7) + '" y="' + (y + 1.8).toFixed(1) + '" text-anchor="end" font-size="5" fill="' + s.txt + '" font-family="ui-monospace,monospace">' + Math.round(v) + '</text>';
    }
    body += monthAxis(s, y0, h);
    const mean = a => a.filter(v => v != null).reduce((x, y) => x + y, 0) / a.filter(v => v != null).length;
    const amax = Math.max(...M.tmax.filter(v => v != null)), amin = Math.min(...M.tmin.filter(v => v != null));
    return wrap(ctx, body, [
      { type: 'rect', c: s.warm, s: s.warm, l: L(ctx, 'MAX', 'HIGH') },
      { type: 'rect', c: s.cool, s: s.cool, l: L(ctx, 'MIN', 'LOW') }
    ], L(ctx, 'MOYENNE ', 'MEAN ') + mean(M.tmax).toFixed(1) + '/' + mean(M.tmin).toFixed(1) + L(ctx, ' °C · AMPLITUDE ', ' °C · RANGE ') + (amax - amin).toFixed(1) + ' °C');
  };

  R.climprecip = (ctx, sc) => {
    const M = monthly(ctx); if (!M || !M.prec) return noClimate(ctx);
    const s = SCH.climate[sc % SCH.climate.length];
    let body = chartFrame(ctx, s, L(ctx, 'PRÉCIPITATIONS MENSUELLES · NASA POWER', 'MONTHLY PRECIPITATION · NASA POWER'));
    const vals = M.prec.map(v => v == null ? 0 : v);
    const max = Math.max(...vals, 1) * 1.15;
    const y0 = PAD + 6, h = H - PAD * 2 - 22, x0 = PAD + 10;
    const step = (W - PAD - x0) / 12;
    let wettest = 0;
    vals.forEach((v, i) => {
      if (v > vals[wettest]) wettest = i;
      const bh = (v / max) * h;
      body += '<rect x="' + (x0 + i * step + 1).toFixed(1) + '" y="' + (y0 + h - bh).toFixed(1) + '" width="' + (step - 2).toFixed(1) +
              '" height="' + bh.toFixed(1) + '" fill="' + (i === wettest ? s.cool : s.bar) + '"/>';
    });
    for (let k = 0; k <= 3; k++) {
      const v = max * k / 3, y = yOf(v, max, 0, y0, h);
      body += '<line x1="' + x0 + '" y1="' + y.toFixed(1) + '" x2="' + (W - PAD) + '" y2="' + y.toFixed(1) + '" stroke="' + s.axis + '" stroke-width=".3"/>' +
              '<text x="' + (x0 - 3) + '" y="' + (y + 1.8).toFixed(1) + '" text-anchor="end" font-size="5" fill="' + s.txt + '" font-family="ui-monospace,monospace">' + (v * 30.4).toFixed(0) + '</text>';
    }
    body += monthAxis(s, y0, h);
    return wrap(ctx, body, [
      { type: 'rect', c: s.bar, s: s.bar, l: L(ctx, 'MM / MOIS', 'MM / MONTH') },
      { type: 'rect', c: s.cool, s: s.cool, l: L(ctx, 'MOIS LE PLUS ARROSÉ', 'WETTEST MONTH') }
    ], L(ctx, 'CUMUL ANNUEL ≈ ', 'ANNUAL TOTAL ≈ ') + fmtN(vals.reduce((a, v) => a + v, 0) / 12 * 365) + ' mm · ' + L(ctx, 'MAX ', 'PEAK ') + (max / 1.15 * 30.4).toFixed(0) + ' mm');
  };

  R.climover = (ctx, sc) => {
    const M = monthly(ctx); if (!M || !M.tmax) return noClimate(ctx);
    const s = SCH.climate[sc % SCH.climate.length];
    let body = chartFrame(ctx, s, L(ctx, 'CLIMAT ANNUEL · TEMPÉRATURE & PLUIE', 'ANNUAL CLIMATE · TEMPERATURE & RAIN'));
    const y0 = PAD + 6, h = H - PAD * 2 - 22, x0 = PAD + 10;
    const step = (W - PAD - x0) / 12;
    const pmax = Math.max(...(M.prec || [0]).map(v => v || 0), .1) * 1.2;
    (M.prec || []).forEach((v, i) => {
      if (v == null) return;
      const bh = (v / pmax) * h;
      body += '<rect x="' + (x0 + i * step + 1).toFixed(1) + '" y="' + (y0 + h - bh).toFixed(1) + '" width="' + (step - 2).toFixed(1) +
              '" height="' + bh.toFixed(1) + '" fill="' + s.bar + '" fill-opacity=".65"/>';
    });
    const all = M.tmax.concat(M.tmin).filter(v => v != null);
    const tminV = Math.floor(Math.min(...all) - 2), tmaxV = Math.ceil(Math.max(...all) + 2);
    let up = '', dn = '';
    M.tmax.forEach((v, i) => {
      if (v == null) return;
      up += (up ? 'L' : 'M') + (x0 + i * step + step / 2).toFixed(1) + ',' + yOf(v, tmaxV, tminV, y0, h).toFixed(1);
    });
    M.tmin.forEach((v, i) => {
      if (v == null) return;
      dn += (dn ? 'L' : 'M') + (x0 + i * step + step / 2).toFixed(1) + ',' + yOf(v, tmaxV, tminV, y0, h).toFixed(1);
    });
    body += '<path d="' + up + '" fill="none" stroke="' + s.warm + '" stroke-width="1.5"/>' +
            '<path d="' + dn + '" fill="none" stroke="' + s.cool + '" stroke-width="1.5"/>';
    body += monthAxis(s, y0, h);
    const mean = a => a.filter(v => v != null).reduce((x, y) => x + y, 0) / a.filter(v => v != null).length;
    const meanP = (M.prec || []).filter(v => v != null);
    const totalP = (meanP.reduce((a, v) => a + v, 0) / (meanP.length || 1)) * 365;
    return wrap(ctx, body, [
      { type: 'rect', c: s.bar, s: s.bar, l: L(ctx, 'PLUIE', 'RAIN') },
      { type: 'rect', c: s.warm, s: s.warm, l: L(ctx, 'T° MAX', 'HIGH T') },
      { type: 'rect', c: s.cool, s: s.cool, l: L(ctx, 'T° MIN', 'LOW T') }
    ], L(ctx, 'MOYENNE ', 'MEAN ') + mean(M.tmax).toFixed(1) + ' °C · ' + fmtN(totalP) + ' mm/an · NASA POWER');
  };

  R.climday = (ctx, sc) => {
    const s = SCH.climate[sc % SCH.climate.length];
    const rad = Math.PI / 180;
    const hours = [];
    for (let m = 0; m < 12; m++) {
      const doy = 15 + m * 30.4;
      const decl = 23.44 * Math.sin(rad * 360 / 365 * (284 + doy)) * rad;
      const latR = ctx.sLat * rad;
      const cosH = -Math.tan(latR) * Math.tan(decl);
      const Hh = Math.acos(Math.max(-1, Math.min(1, cosH))) / rad / 15;
      hours.push(Hh * 2);
    }
    let body = chartFrame(ctx, s, L(ctx, 'DURÉE DU JOUR MOIS PAR MOIS (CALCULÉ)', 'DAYLIGHT HOURS PER MONTH (COMPUTED)'));
    const y0 = PAD + 6, h = H - PAD * 2 - 22, x0 = PAD + 10;
    const step = (W - PAD - x0) / 12;
    const max = 24, min = 0;
    let area = 'M' + x0.toFixed(1) + ',' + (y0 + h).toFixed(1);
    hours.forEach((v, i) => {
      area += 'L' + (x0 + i * step + step / 2).toFixed(1) + ',' + yOf(v, max, min, y0, h).toFixed(1);
    });
    area += 'L' + (x0 + 11 * step + step / 2).toFixed(1) + ',' + (y0 + h).toFixed(1) + 'Z';
    body += '<path d="' + area + '" fill="' + s.mid + '" fill-opacity=".2"/>';
    let line = '';
    hours.forEach((v, i) => { line += (line ? 'L' : 'M') + (x0 + i * step + step / 2).toFixed(1) + ',' + yOf(v, max, min, y0, h).toFixed(1); });
    body += '<path d="' + line + '" fill="none" stroke="' + s.mid + '" stroke-width="1.6"/>';
    body += '<line x1="' + x0 + '" y1="' + yOf(12, max, min, y0, h).toFixed(1) + '" x2="' + (W - PAD) + '" y2="' + yOf(12, max, min, y0, h).toFixed(1) + '" stroke="' + s.axis + '" stroke-width=".4" stroke-dasharray="3,3"/>' +
            '<text x="' + (W - PAD - 2) + '" y="' + (yOf(12, max, min, y0, h) - 3).toFixed(1) + '" text-anchor="end" font-size="5" fill="' + s.txt + '" font-family="ui-monospace,monospace">' + L(ctx, '12 H (ÉQUINOXE)', '12 H (EQUINOX)') + '</text>';
    body += monthAxis(s, y0, h);
    const fmtH = v => Math.floor(v) + ' h ' + String(Math.round((v % 1) * 60)).padStart(2, '0');
    const mn = Math.min(...hours), mx = Math.max(...hours);
    return wrap(ctx, body, [
      { type: 'line', c: s.mid, l: L(ctx, 'DURÉE DU JOUR', 'DAYLIGHT'), w: 1.4 }
    ], L(ctx, 'SOLSTICES ', 'SOLSTICES ') + fmtH(mn) + ' – ' + fmtH(mx) + ' · ' + L(ctx, 'LATITUDE ', 'LATITUDE ') + Math.abs(ctx.sLat).toFixed(2) + '°');
  };

  R.climsolar = (ctx, sc) => {
    const M = monthly(ctx); if (!M || !M.solar) return noClimate(ctx);
    const s = SCH.climate[sc % SCH.climate.length];
    let body = chartFrame(ctx, s, L(ctx, 'IRRADIATION JOURNALIÈRE · KWH/M²/J', 'DAILY IRRADIATION · KWH/M²/D'));
    const vals = M.solar.map(v => v == null ? 0 : v);
    const max = Math.max(...vals, .5) * 1.15;
    const y0 = PAD + 6, h = H - PAD * 2 - 22, x0 = PAD + 10;
    const step = (W - PAD - x0) / 12;
    let area = 'M' + x0.toFixed(1) + ',' + (y0 + h).toFixed(1);
    vals.forEach((v, i) => { area += 'L' + (x0 + i * step + step / 2).toFixed(1) + ',' + yOf(v, max, 0, y0, h).toFixed(1); });
    area += 'L' + (x0 + 11 * step + step / 2).toFixed(1) + ',' + (y0 + h).toFixed(1) + 'Z';
    body += '<path d="' + area + '" fill="' + s.mid + '" fill-opacity=".35"/>';
    let line = '';
    vals.forEach((v, i) => { line += (line ? 'L' : 'M') + (x0 + i * step + step / 2).toFixed(1) + ',' + yOf(v, max, 0, y0, h).toFixed(1); });
    body += '<path d="' + line + '" fill="none" stroke="' + s.warm + '" stroke-width="1.6"/>';
    for (let k = 0; k <= 3; k++) {
      const v = max * k / 3, y = yOf(v, max, 0, y0, h);
      body += '<line x1="' + x0 + '" y1="' + y.toFixed(1) + '" x2="' + (W - PAD) + '" y2="' + y.toFixed(1) + '" stroke="' + s.axis + '" stroke-width=".3"/>' +
              '<text x="' + (x0 - 3) + '" y="' + (y + 1.8).toFixed(1) + '" text-anchor="end" font-size="5" fill="' + s.txt + '" font-family="ui-monospace,monospace">' + v.toFixed(1) + '</text>';
    }
    body += monthAxis(s, y0, h);
    const anual = vals.reduce((a, b2) => a + b2, 0) / 12 * 365;
    const peak = Math.max(...vals), low = Math.min(...vals.filter(v => v > 0));
    return wrap(ctx, body, [
      { type: 'rect', c: s.mid, s: s.mid, l: L(ctx, 'IRRADIATION', 'IRRADIATION') },
      { type: 'rect', c: s.warm, s: s.warm, l: L(ctx, 'MAX ' + peak.toFixed(1), 'PEAK ' + peak.toFixed(1)) }
    ], L(ctx, 'CUMUL ≈ ', 'ANNUAL ≈ ') + fmtN(anual) + ' kWh/m²/an · ' + L(ctx, 'RAPPORT ÉTÉ/HIVER ', 'SUMMER/WINTER ') + (peak / (low || 1)).toFixed(1) + '×');
  };
})(globalThis);
