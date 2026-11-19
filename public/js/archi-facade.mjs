/* Rectification de façade — photo → lignes vectorielles → DXF/SVG/PNG.
   Cœur 100 % local, sans dépendance ni réseau : homographie 4 points,
   contours de Sobel, transformée de Hough. Aucune image ne quitte le
   navigateur. Les segments extraits alimentent l'écritureur DXF R12
   existant (exports.mjs). */

import { dxf } from './exports.mjs';

export const FACADE_VERSION = '1.0.0';

/* ── Homographie ─────────────────────────────────────────────── */

/* Résout H (3x3, h22 = 1) tel que dst ~ H * src pour 4 points.
   src/dst : tableaux de 4 [x, y]. Retourne un tableau de 9 nombres
   ou null si le système est dégénéré (points alignés). */
export function solveHomography(src, dst) {
  if (!src || !dst || src.length !== 4 || dst.length !== 4) return null;
  const A = []; const b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i]; const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  /* élimination de Gauss avec pivot partiel */
  const n = 8;
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-12) return null;
    [A[col], A[piv]] = [A[piv], A[col]]; [b[col], b[piv]] = [b[piv], b[col]];
    for (let r = col + 1; r < n; r++) {
      const f = A[r][col] / A[col][col];
      for (let c = col; c < n; c++) A[r][c] -= f * A[col][c];
      b[r] -= f * b[col];
    }
  }
  const h = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let c = r + 1; c < n; c++) s -= A[r][c] * h[c];
    h[r] = s / A[r][r];
  }
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

export function applyH(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

/* ── Rectification (warping) ─────────────────────────────────── */

/* Rectifie srcImg ({data,width,height} RGBA) selon les 4 points source
   (ordre haut-gauche, haut-droite, bas-droite, bas-gauche) vers un
   rectangle outW x outH. Échantillonnage bilinéaire. */
export function warpToRect(srcImg, srcPts, outW, outH) {
  const dstPts = [[0, 0], [outW - 1, 0], [outW - 1, outH - 1], [0, outH - 1]];
  const H = solveHomography(dstPts, srcPts);           // destination -> source
  if (!H) return null;
  const out = new Uint8ClampedArray(outW * outH * 4);
  const { data, width, height } = srcImg;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const [sx, sy] = applyH(H, x, y);
      const i = (y * outW + x) * 4;
      if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx < -1e-6 || sy < -1e-6 || sx > width - 1 + 1e-6 || sy > height - 1 + 1e-6) {
        out[i + 3] = 0; continue;
      }
      const cx = Math.max(0, Math.min(width - 1, sx)), cy = Math.max(0, Math.min(height - 1, sy));
      const x0 = Math.min(Math.floor(cx), width - 2);
      const y0 = Math.min(Math.floor(cy), height - 2);
      const fx = cx - x0, fy = cy - y0;
      for (let c = 0; c < 4; c++) {
        const p00 = data[(y0 * width + x0) * 4 + c];
        const p10 = data[(y0 * width + x0 + 1) * 4 + c];
        const p01 = data[((y0 + 1) * width + x0) * 4 + c];
        const p11 = data[((y0 + 1) * width + x0 + 1) * 4 + c];
        out[i + c] = p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy)
          + p01 * (1 - fx) * fy + p11 * fx * fy;
      }
    }
  }
  return { data: out, width: outW, height: outH };
}

/* ── Contours (Sobel) + Hough ────────────────────────────────── */

export function toGray(img) {
  const { data, width, height } = img;
  const g = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++)
    g[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  return g;
}

/* Magnitude du gradient de Sobel. */
export function sobel(gray, w, h) {
  const mag = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = -gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1]
        + gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1];
      const gy = -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1]
        + gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
      mag[i] = Math.hypot(gx, gy);
    }
  }
  return mag;
}

/* Transformée de Hough classique sur les pixels de contour >= seuil.
   Pour chaque (rho, theta) retenue, on marche le long de la droite et
   on regroupe les pixels de contour en segments (trous <= maxGap,
   longueur >= minLen). Retourne [{ a:[x,y], b:[x,y], votes }]. */
export function houghSegments(mag, w, h, o = {}) {
  const seuil = Math.max(1, Number(o.seuil) || 120);
  const minLen = Math.max(2, Number(o.minLen) || 24);
  const maxGap = Math.max(1, Number(o.maxGap) || 4);
  const nTheta = 90, step = Math.PI / nTheta;
  const offset = Math.ceil(Math.hypot(w, h)), nRho = 2 * offset + 1;
  const acc = new Uint32Array(nRho * nTheta);
  const cos = Array.from({ length: nTheta }, (_, t) => Math.cos(t * step));
  const sin = Array.from({ length: nTheta }, (_, t) => Math.sin(t * step));
  // Sous-échantillonnage déterministe : coût borné même sur une photo texturée.
  let count = 0;
  for (let i = 0; i < mag.length; i++) if (mag[i] >= seuil) count++;
  const stride = Math.max(1, Math.ceil(count / 20000));
  const pts = [];
  for (let i = 0, n = 0; i < mag.length; i++) {
    if (mag[i] >= seuil && n++ % stride === 0) pts.push([i % w, Math.floor(i / w)]);
  }
  for (const [x, y] of pts) for (let t = 0; t < nTheta; t++) {
    const r = Math.round(x * cos[t] + y * sin[t]) + offset;
    acc[r * nTheta + t]++;
  }
  const peaks = [];
  const minVotes = Math.max(4, Math.ceil(minLen / stride * 0.45));
  for (let r = 1; r < nRho - 1; r++) for (let t = 0; t < nTheta; t++) {
    const v = acc[r * nTheta + t];
    if (v < minVotes) continue;
    let peak = true;
    for (let dr = -2; dr <= 2 && peak; dr++) for (let dt = -1; dt <= 1; dt++) {
      const rr = r + dr, tt = t + dt;
      if (rr < 0 || rr >= nRho || tt < 0 || tt >= nTheta || (!dr && !dt)) continue;
      if (acc[rr * nTheta + tt] > v) { peak = false; break; }
    }
    if (peak) peaks.push({ r, t, v });
  }
  peaks.sort((a, b) => b.v - a.v);
  const segs = [];
  for (const { r, t, v } of peaks.slice(0, 120)) {
    const rho = r - offset, dx = -sin[t], dy = cos[t];
    const proj = [];
    for (const [x, y] of pts) if (Math.abs(x * cos[t] + y * sin[t] - rho) <= 1.5)
      proj.push(x * dx + y * dy);
    proj.sort((a, b) => a - b);
    if (!proj.length) continue;
    let start = proj[0], last = start;
    const flush = () => {
      if (last - start >= minLen) segs.push({
        a: [start * dx + rho * cos[t], start * dy + rho * sin[t]],
        b: [last * dx + rho * cos[t], last * dy + rho * sin[t]], votes: v
      });
    };
    for (let i = 1; i < proj.length; i++) {
      // Sous-échantillonnage peut créer de petits trous artificiels.
      if (proj[i] - last > Math.max(maxGap, stride * 1.5)) { flush(); start = proj[i]; }
      last = proj[i];
    }
    flush();
  }
  return segs.slice(0, 1000);
}

/* Les classes sont choisies par l'utilisateur, pas reconnues par IA. */
export const FACADE_LAYERS = Object.freeze({
  FACADE: { couleur: 7, svg: '#153e3d' }, MUR: { couleur: 1, svg: '#d22b3a' },
  FENETRE: { couleur: 5, svg: '#245ad3' }, PORTE: { couleur: 3, svg: '#16834d' },
  CORNICHE: { couleur: 2, svg: '#ae7700' }, HYPOTHESE: { couleur: 6, svg: '#a2229a' }
});
const layerOf = s => Object.hasOwn(FACADE_LAYERS, s.layer) ? s.layer : 'FACADE';
const length = s => Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);

/* Déduplication volontairement prudente : ne supprime que les segments presque
   superposés et de longueurs comparables, jamais les traits parallèles éloignés.
   L'utilisateur peut annuler car deux véritables bords proches restent possibles. */
export function removeDuplicateSegments(segments, tolerance = 2) {
  const tol = Math.max(0, Math.min(10, Number(tolerance) || 0));
  const retained = [];
  const ranked = segments.map((s, i) => ({s, i})).sort((a, b) => length(b.s) - length(a.s));
  for (const entry of ranked) {
    const s = entry.s, len = length(s);
    if (!Number.isFinite(len) || len < 0.001) continue;
    const ux = (s.b[0] - s.a[0]) / len, uy = (s.b[1] - s.a[1]) / len;
    const duplicate = retained.some(({s: t}) => {
      if (layerOf(s) !== layerOf(t)) return false;
      const tl = length(t), vx = (t.b[0] - t.a[0]) / tl, vy = (t.b[1] - t.a[1]) / tl;
      if (Math.abs(ux * vx + uy * vy) < Math.cos(2 * Math.PI / 180)) return false;
      const cross = p => Math.abs((p[0] - s.a[0]) * uy - (p[1] - s.a[1]) * ux);
      if (cross(t.a) > tol || cross(t.b) > tol) return false;
      const project = p => (p[0] - s.a[0]) * ux + (p[1] - s.a[1]) * uy;
      const a = project(t.a), b = project(t.b);
      const overlap = Math.max(0, Math.min(len, Math.max(a, b)) - Math.max(0, Math.min(a, b)));
      return overlap >= 0.85 * Math.max(len, tl);
    });
    if (!duplicate) retained.push(entry);
  }
  return retained.sort((a, b) => a.i - b.i).map(e => e.s);
}

export function nearestSegment(segments, point, radius) {
  let best = -1, distance = radius;
  segments.forEach((s, i) => {
    const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1], d = dx * dx + dy * dy;
    const t = d ? Math.max(0, Math.min(1, ((point[0] - s.a[0]) * dx + (point[1] - s.a[1]) * dy) / d)) : 0;
    const dist = Math.hypot(point[0] - s.a[0] - t * dx, point[1] - s.a[1] - t * dy);
    if (dist <= distance) { best = i; distance = dist; }
  });
  return best;
}

/* Une cote ajuste une échelle déjà proportionnée ; elle ne corrige pas le
   rapport largeur/hauteur choisi lors de la rectification. */
export function calibratedScales(a, b, distanceMetres, sx, sy) {
  if (![...a, ...b, distanceMetres, sx, sy].every(Number.isFinite) || distanceMetres <= 0 || sx <= 0 || sy <= 0) return null;
  const current = Math.hypot((b[0] - a[0]) * sx, (b[1] - a[1]) * sy);
  if (current < 1e-9 || Math.hypot(b[0] - a[0], b[1] - a[1]) < 2) return null;
  const factor = distanceMetres / current;
  if (!Number.isFinite(factor) || factor < 1e-6 || factor > 1e6) return null;
  return { sx: sx * factor, sy: sy * factor };
}

/* Propositions géométriques, pas une reconnaissance sémantique : recherche
   quatre bords presque horizontaux/verticaux à partir des lignes détectées. */
export function openingCandidates(segments, {tolerance = 5, minSize = 12} = {}) {
  const horizontal = [], vertical = [];
  for (const s of segments.slice(0, 1000)) {
    const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1];
    if (Math.abs(dx) >= minSize && Math.abs(dy) <= Math.max(2, Math.abs(dx) * 0.04))
      horizontal.push({x1: Math.min(s.a[0], s.b[0]), x2: Math.max(s.a[0], s.b[0]), y: (s.a[1] + s.b[1]) / 2});
    if (Math.abs(dy) >= minSize && Math.abs(dx) <= Math.max(2, Math.abs(dy) * 0.04))
      vertical.push({y1: Math.min(s.a[1], s.b[1]), y2: Math.max(s.a[1], s.b[1]), x: (s.a[0] + s.b[0]) / 2});
  }
  // Encadre le coût et évite le blocage sur des façades très texturées.
  horizontal.length = Math.min(horizontal.length, 100); vertical.length = Math.min(vertical.length, 100);
  const result = [];
  for (let i = 0; i < horizontal.length; i++) for (let j = i + 1; j < horizontal.length; j++) {
    let top = horizontal[i], bottom = horizontal[j]; if (top.y > bottom.y) [top, bottom] = [bottom, top];
    if (bottom.y - top.y < minSize) continue;
    const left = Math.max(top.x1, bottom.x1), right = Math.min(top.x2, bottom.x2);
    if (right - left < minSize) continue;
    const sides = vertical.filter(v => v.x >= left - tolerance && v.x <= right + tolerance && v.y1 <= top.y + tolerance && v.y2 >= bottom.y - tolerance);
    for (let l = 0; l < sides.length; l++) for (let r = l + 1; r < sides.length; r++) {
      const x1 = Math.min(sides[l].x, sides[r].x), x2 = Math.max(sides[l].x, sides[r].x);
      if (x2 - x1 < minSize) continue;
      if (result.some(b => Math.abs(b.x1-x1)<tolerance && Math.abs(b.x2-x2)<tolerance && Math.abs(b.y1-top.y)<tolerance && Math.abs(b.y2-bottom.y)<tolerance)) continue;
      result.push({x1,x2,y1:top.y,y2:bottom.y});
      if (result.length >= 60) return result;
    }
  }
  return result;
}

/* Relie seulement deux extrémités distinctes presque colinéaires, sur demande.
   Il s'agit d'une hypothèse géométrique, pas de reconstruction observée. */
export function bridgeSegments(a, b, maxGap = 80, tolerance = 4) {
  const la = length(a), lb = length(b);
  if (!(la > 2 && lb > 2)) return null;
  const ux = (a.b[0]-a.a[0])/la, uy = (a.b[1]-a.a[1])/la;
  const vx = (b.b[0]-b.a[0])/lb, vy = (b.b[1]-b.a[1])/lb;
  if (Math.abs(ux*vx + uy*vy) < Math.cos(3*Math.PI/180)) return null;
  const pairs = [[a.a,b.a],[a.a,b.b],[a.b,b.a],[a.b,b.b]].map(([p,q]) => ({p,q,d:Math.hypot(p[0]-q[0],p[1]-q[1])})).sort((x,y)=>x.d-y.d);
  const {p,q,d} = pairs[0];
  if (d < 2 || d > maxGap || Math.abs((q[0]-p[0])*uy - (q[1]-p[1])*ux) > tolerance) return null;
  // Ne pas relier des lignes qui se chevauchent : les extrémités doivent pointer l'une vers l'autre.
  const otherA = p === a.a ? a.b : a.a, otherB = q === b.a ? b.b : b.a;
  if ((q[0]-p[0])*(otherA[0]-p[0]) + (q[1]-p[1])*(otherA[1]-p[1]) >= 0 ||
      (p[0]-q[0])*(otherB[0]-q[0]) + (p[1]-q[1])*(otherB[1]-q[1]) >= 0) return null;
  return {a:[...p], b:[...q], layer:'HYPOTHESE'};
}

/* Les masques sont des rectangles choisis par l'utilisateur, en pixels de
   l'image rectifiée. Ils excluent les contours, pas le contenu de la photo. */
export function maskEdges(mag, w, h, masks) {
  const out = new Float32Array(mag);
  for (const m of masks) {
    const x1 = Math.max(0, Math.floor(Math.min(m.x1,m.x2))), x2 = Math.min(w-1, Math.ceil(Math.max(m.x1,m.x2)));
    const y1 = Math.max(0, Math.floor(Math.min(m.y1,m.y2))), y2 = Math.min(h-1, Math.ceil(Math.max(m.y1,m.y2)));
    for (let y=y1;y<=y2;y++) out.fill(0, y*w+x1, y*w+x2+1);
  }
  return out;
}

/* Coupe aussi les lignes qui traversent un masque après Hough : aucun trait
   n'est supposé visible dans l'obstacle. Aucune reconstruction implicite. */
export function clipSegmentsByMasks(segments, masks) {
  let list = segments.map(s => ({...s, a:[...s.a], b:[...s.b]}));
  for (const m of masks) {
    const xmin=Math.min(m.x1,m.x2), xmax=Math.max(m.x1,m.x2), ymin=Math.min(m.y1,m.y2), ymax=Math.max(m.y1,m.y2);
    const next=[];
    for (const s of list) {
      const dx=s.b[0]-s.a[0], dy=s.b[1]-s.a[1];
      let lo=0, hi=1, intersects=true;
      for (const [p,q] of [[-dx,s.a[0]-xmin],[dx,xmax-s.a[0]],[-dy,s.a[1]-ymin],[dy,ymax-s.a[1]]]) {
        if (Math.abs(p)<1e-12) { if (q<0) {intersects=false;break;} }
        else { const r=q/p; if(p<0) lo=Math.max(lo,r); else hi=Math.min(hi,r); if(lo>hi){intersects=false;break;} }
      }
      if (!intersects) { next.push(s); continue; }
      const at=t=>[s.a[0]+t*dx,s.a[1]+t*dy];
      if (lo>1e-9) next.push({...s,b:at(lo)});
      if (hi<1-1e-9) next.push({...s,a:at(hi)});
    }
    list=next;
  }
  return list;
}

/* Pipeline géométrique local : des segments et des rectangles candidats,
   sans déduction de la fonction, du style ou de l'époque des éléments. */
export function analyzeFacadeGeometry(image, {seuil = 120, minLen = 24, tolerance = 2, masks = []} = {}) {
  const edges = maskEdges(sobel(toGray(image), image.width, image.height), image.width, image.height, masks);
  const raw = clipSegmentsByMasks(houghSegments(edges, image.width, image.height, {seuil, minLen}), masks);
  const segments = removeDuplicateSegments(raw, tolerance);
  const rectangles = openingCandidates(segments);
  return { segments, rectangles, rawCount: raw.length, removed: raw.length - segments.length };
}

/* ── Export : entités DXF (mètres) + SVG ─────────────────────── */

/* Convertit des segments en pixels (origine haut-gauche, y vers le bas)
   en entités DXF en mètres : x_m = x * scale, y_m = (h - y) * scale
   (retournement pour passer en coordonnées montantes). */
export function segmentsToEntities(segs, h, scale, scaleY = scale) {
  return segs.map(s => ({
    t: 'ligne',
    calque: layerOf(s),
    a: [s.a[0] * scale, (h - s.a[1]) * scaleY],
    b: [s.b[0] * scale, (h - s.b[1]) * scaleY]
  }));
}

export function facadeDxf(segs, h, scale, titre, scaleY = scale, unitless = false) {
  const out = dxf(segmentsToEntities(segs, h, scale, scaleY), Object.entries(FACADE_LAYERS).map(([nom, v]) => ({ nom, couleur: v.couleur })),
    { titre: titre || 'Facade UrbaTrame' });
  return unitless ? out.replace('$INSUNITS\n70\n6\n', '$INSUNITS\n70\n0\n') : out;
}

export function segmentsToSvg(segs, w, h) {
  const l = [`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`];
  for (const s of segs)
    l.push(`<line x1="${s.a[0].toFixed(1)}" y1="${s.a[1].toFixed(1)}" x2="${s.b[0].toFixed(1)}" y2="${s.b[1].toFixed(1)}" stroke="${FACADE_LAYERS[layerOf(s)].svg}" stroke-width="1" data-layer="${layerOf(s)}"/>`);
  l.push('</svg>');
  return l.join('\n');
}

/* ── UI (navigateur uniquement) ──────────────────────────────── */

export function validCorners(p) {
  if (p.length !== 4 || p.some(q => !Number.isFinite(q[0]) || !Number.isFinite(q[1]))) return false;
  const crosses = p.map((a, i) => {
    const b = p[(i + 1) % 4], c = p[(i + 2) % 4];
    return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
  });
  return crosses.every(v => v > 4) || crosses.every(v => v < -4);
}

export function initFacadeRectify(doc) {
  const $ = id => doc.getElementById(id);
  const file = $('facadeFile'), cv = $('facadeCanvas'), res = $('facadeResult');
  if (!file || !cv || !res) return;
  const ctx = cv.getContext('2d'), rctx = res.getContext('2d');
  let img = null, corners = [], rect = null, segs = [], loading = 0, revision = 0, history = [], pending = null, dirty = false, candidates = [], firstBridge = -1, refPoints = [], masks = [];
  const say = m => { $('facadeStatus').textContent = m; };
  const clearSummary = () => { $('facadeAnalysisSummary').textContent = ''; };
  const invalidate = () => { revision++; rect = null; segs = []; history = []; pending = null; dirty = false; candidates = []; firstBridge = -1; refPoints = []; masks = []; clearSummary(); rctx.clearRect(0, 0, res.width, res.height); };
  const remember = () => { revision++; history.push(segs.map(s => ({ ...s, a: [...s.a], b: [...s.b] }))); if (history.length > 30) history.shift(); };
  const render = () => {
    if (!rect) return;
    rctx.putImageData(new ImageData(rect.data, rect.width, rect.height), 0, 0);
    rctx.lineWidth = Math.max(1, rect.width / 600);
    for (const s of segs) {
      rctx.strokeStyle = FACADE_LAYERS[layerOf(s)].svg;
      rctx.beginPath(); rctx.moveTo(...s.a); rctx.lineTo(...s.b); rctx.stroke();
    }
    for (const m of masks) { rctx.fillStyle = 'rgba(213, 40, 100, .22)'; rctx.fillRect(m.x1,m.y1,m.x2-m.x1,m.y2-m.y1); rctx.strokeStyle = '#c71657'; rctx.lineWidth = 2; rctx.strokeRect(m.x1,m.y1,m.x2-m.x1,m.y2-m.y1); }
    rctx.strokeStyle = '#d88400'; rctx.lineWidth = 2; rctx.setLineDash([6,4]);
    for (const b of candidates) rctx.strokeRect(b.x1,b.y1,b.x2-b.x1,b.y2-b.y1);
    rctx.setLineDash([]);
    if (pending) { rctx.fillStyle = '#d11'; rctx.beginPath(); rctx.arc(...pending, 4, 0, 2 * Math.PI); rctx.fill(); }
  };
  const drawCorners = () => {
    if (!img) return;
    ctx.putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
    ctx.font = 'bold 16px sans-serif';
    corners.forEach((p, i) => {
      ctx.fillStyle = '#d11'; ctx.beginPath(); ctx.arc(p[0], p[1], 6, 0, 7); ctx.fill();
      ctx.fillText(String(i + 1), p[0] + 9, p[1] - 9);
    });
  };
  const loadSource = (url, revoke, label) => {
    const current = ++loading;
    $('facadeUnit').value = 'relative';
    img = null; corners = []; invalidate(); ctx.clearRect(0, 0, cv.width, cv.height);
    const im = new Image();
    im.onload = () => {
      if (revoke) URL.revokeObjectURL(url);
      if (current !== loading) return;
      if (im.width < 2 || im.height < 2) return say('Image trop petite.');
      const k = Math.min(1, 1200 / Math.max(im.width, im.height));
      cv.width = Math.max(2, Math.round(im.width * k)); cv.height = Math.max(2, Math.round(im.height * k));
      ctx.drawImage(im, 0, 0, cv.width, cv.height);
      img = ctx.getImageData(0, 0, cv.width, cv.height);
      say(`${label} : cliquez les 4 coins haut-gauche, haut-droite, bas-droite, bas-gauche.`);
    };
    im.onerror = () => { if (revoke) URL.revokeObjectURL(url); if (current === loading) say('Impossible de lire cette image.'); };
    im.src = url;
  };
  const okReplace = () => !segs.length || window.confirm('Changer d’image effacera les lignes actuelles. Continuer ?');
  file.addEventListener('change', () => {
    const f = file.files[0];
    if (!f) return;
    if (!okReplace()) { file.value = ''; return; }
    if (f.size > 20 * 1024 * 1024) return say('Image trop volumineuse : maximum 20 Mo.');
    loadSource(URL.createObjectURL(f), true, 'Photo chargée');
  });
  $('facadeUseReference').addEventListener('click', () => {
    const preview = $('photoPreview');
    const src = preview.getAttribute('src');
    if (!src || !src.startsWith('data:image/')) return say('Choisissez d’abord une photo dans « 5 · La photo de référence ».');
    if (!okReplace()) return;
    loadSource(src, false, 'Photo de référence chargée localement');
  });
  $('facadeUseFront').addEventListener('click', () => {
    if (doc.querySelector('[data-tab="fronts"]').getAttribute('aria-selected') !== 'true')
      return say('Affichez d’abord l’onglet « 3 · Front bâti » dans les planches.');
    const svg = doc.querySelector('#viewport svg');
    if (!svg) return say('Planche front bâti introuvable.');
    if (!okReplace()) return;
    const markup = new XMLSerializer().serializeToString(svg);
    loadSource(URL.createObjectURL(new Blob([markup], {type:'image/svg+xml'})), true,
      'Dessin schématique chargé (ce n’est pas une photo réelle)');
  });
  cv.addEventListener('click', ev => {
    if (!img || corners.length >= 4) return;
    const r = cv.getBoundingClientRect();
    corners.push([(ev.clientX - r.left) * cv.width / r.width, (ev.clientY - r.top) * cv.height / r.height]);
    invalidate(); drawCorners();
    say(corners.length === 4 ? '4 coins posés. Saisissez les proportions ou dimensions mesurées puis rectifiez.' : `Coin ${corners.length} posé sur 4.`);
  });
  $('facadeUndo').addEventListener('click', () => { if (segs.length && !window.confirm('Modifier les coins effacera les lignes actuelles. Continuer ?')) return; corners.pop(); invalidate(); drawCorners(); say('Dernier coin retiré ; rectifiez de nouveau.'); });
  for (const id of ['facadeW', 'facadeH']) $(id).addEventListener('input', () => { if (rect) { dirty = true; revision++; pending = null; render(); say('Dimensions modifiées : rectifiez de nouveau avant d’exporter. Les lignes actuelles seront remplacées.'); } });
  for (const id of ['facadeSeuil', 'facadeMinLen']) $(id).addEventListener('input', () => {
    revision++; pending = null; render();
    say('Paramètres modifiés : une nouvelle extraction remplacera les lignes actuelles.');
  });
  $('facadeRectify').addEventListener('click', () => {
    if (segs.length && !window.confirm('Rectifier de nouveau effacera les lignes actuelles. Continuer ?')) return;
    invalidate();
    if (!img || !validCorners(corners)) return say('Posez 4 coins distincts dans l’ordre indiqué, formant un quadrilatère convexe.');
    const wm = Number($('facadeW').value), hm = Number($('facadeH').value);
    if (!Number.isFinite(wm) || !Number.isFinite(hm) || wm < 0.5 || wm > 500 || hm < 0.5 || hm > 200 || Math.max(wm / hm, hm / wm) > 100)
      return say('Saisissez des valeurs positives (largeur 0,5–500, hauteur 0,5–200, rapport inférieur à 100).');
    const k = Math.min(40, 799 / Math.max(wm, hm));
    const w = Math.max(2, Math.round(wm * k) + 1), h = Math.max(2, Math.round(hm * k) + 1);
    rect = warpToRect(img, corners, w, h);
    if (!rect) return say('Rectification impossible : vérifiez les coins.');
    rect.sx = wm / (w - 1); rect.sy = hm / (h - 1);
    res.width = w; res.height = h; rctx.putImageData(new ImageData(rect.data, w, h), 0, 0);
    say(`Photo rectifiée : ${w} × ${h} pixels. Vous pouvez extraire les lignes.`);
  });
  $('facadeLines').addEventListener('click', () => {
    clearSummary();
    if (!rect || dirty) return say('Rectifiez d’abord avec les dimensions actuelles.');
    const seuil = Number($('facadeSeuil').value), minLen = Number($('facadeMinLen').value);
    if (!(seuil >= 20 && seuil <= 800 && minLen >= 6 && minLen <= 400)) return say('Seuil : 20–800 ; longueur minimale : 6–400 px.');
    if (segs.length && !window.confirm('Une nouvelle extraction remplacera les lignes actuelles. Continuer ?')) return;
    const run = ++revision;
    say('Extraction en cours…');
    // Laisse le navigateur afficher le message avant le calcul.
    const target = rect;
    setTimeout(() => {
      if (target !== rect || run !== revision) return;
      const edges = maskEdges(sobel(toGray(rect), rect.width, rect.height), rect.width, rect.height, masks);
      const found = clipSegmentsByMasks(houghSegments(edges, rect.width, rect.height, { seuil, minLen }), masks);
      remember(); segs = found; pending = null; candidates = []; firstBridge = -1; render();
      say(`${segs.length} segments détectés. Résultat indicatif à nettoyer et vérifier.`);
    }, 20);
  });
  $('facadeAnalyze').addEventListener('click', () => {
    if (!rect || dirty) return say('Choisissez une photo, posez 4 coins puis rectifiez avant l’analyse.');
    const seuil = Number($('facadeSeuil').value), minLen = Number($('facadeMinLen').value);
    const tolerance = Number($('facadeTolerance').value);
    if (!(seuil >= 20 && seuil <= 800 && minLen >= 6 && minLen <= 400 && tolerance >= 0 && tolerance <= 10))
      return say('Vérifiez les paramètres : seuil 20–800, longueur 6–400 px, tolérance 0–10 px.');
    if (segs.length && !window.confirm('L’analyse remplacera les lignes actuelles. Continuer ?')) return;
    const run = ++revision, target = rect;
    clearSummary(); say('Analyse géométrique locale en cours…');
    setTimeout(() => {
      if (target !== rect || run !== revision) return;
      const result = analyzeFacadeGeometry(rect, {seuil, minLen, tolerance, masks});
      remember(); segs = result.segments; candidates = result.rectangles; pending = null; firstBridge = -1;
      $('facadeEditMode').value = 'candidate'; render();
      $('facadeAnalysisSummary').textContent = `À la fin de l’analyse géométrique : ${result.rawCount} segments bruts, ${result.removed} doublons retirés, ${segs.length} lignes conservées et ${candidates.length} rectangles candidats. Ce ne sont pas des fenêtres ou portes identifiées. Résultats approximatifs à vérifier et classer manuellement.`;
      say('Analyse terminée. Cliquez un rectangle orange pour le classer, ou corrigez les traits.');
    }, 20);
  });
  $('facadeClean').addEventListener('click', () => {
    if (!rect || dirty || !segs.length) return say('Rectifiez avec les dimensions actuelles et ajoutez des lignes avant de nettoyer.');
    const tol = Number($('facadeTolerance').value);
    if (!Number.isFinite(tol) || tol < 0 || tol > 10) return say('Tolérance autorisée : 0 à 10 pixels.');
    const cleaned = removeDuplicateSegments(segs, tol), n = segs.length - cleaned.length;
    if (n) { remember(); segs = cleaned; pending = null; candidates = []; firstBridge = -1; render(); }
    say(`${n} doublon(s) retiré(s), ${segs.length} ligne(s) conservée(s). Annulez si un trait utile a disparu.`);
  });
  $('facadeEditUndo').addEventListener('click', () => {
    pending = null; candidates = []; firstBridge = -1;
    if (!history.length) { render(); return say('Aucune modification à annuler.'); }
    revision++; segs = history.pop(); render(); say(`Modification annulée : ${segs.length} ligne(s).`);
  });
  $('facadeEditMode').addEventListener('change', () => { pending = null; firstBridge = -1; refPoints = []; render(); });
  $('facadeMaskUndo').addEventListener('click', () => {
    pending = null;
    if (!masks.length) { render(); return say('Aucune zone d’exclusion à retirer.'); }
    revision++; masks.pop(); render();
    say(`Dernière zone retirée (${masks.length} restante(s)). Relancez l’extraction pour actualiser les lignes.`);
  });
  $('facadePropose').addEventListener('click', () => {
    if (!rect || dirty || !segs.length) return say('Rectifiez puis extrayez d’abord les lignes.');
    candidates = openingCandidates(segs); pending = null; firstBridge = -1;
    $('facadeEditMode').value = 'candidate'; render();
    say(`${candidates.length} rectangle(s) proposés en orange : ce ne sont pas des fenêtres reconnues. Cliquez pour les classer manuellement.`);
  });
  $('facadeCalibrate').addEventListener('click', () => {
    if (!rect || dirty || refPoints.length !== 2) return say('Choisissez le mode cote, puis cliquez deux points sur la façade rectifiée.');
    const n = Number($('facadeReferenceLength').value);
    const result = calibratedScales(refPoints[0], refPoints[1], n, rect.sx, rect.sy);
    if (!result) return say('Cote invalide : entrez une longueur positive et deux points distincts.');
    rect.sx = result.sx; rect.sy = result.sy; refPoints = []; pending = null; render();
    $('facadeW').value = String(rect.sx * (rect.width-1)); $('facadeH').value = String(rect.sy * (rect.height-1));
    say(`Échelle ajustée sur ${n} m. Les proportions initiales restent supposées : vérifiez les autres cotes.`);
  });
  res.addEventListener('click', e => {
    if (!rect || dirty) return say('Rectifiez d’abord avec les dimensions actuelles.');
    const box = res.getBoundingClientRect();
    const p = [Math.max(0, Math.min(rect.width - 1, (e.clientX - box.left) * rect.width / box.width)),
      Math.max(0, Math.min(rect.height - 1, (e.clientY - box.top) * rect.height / box.height))];
    const mode = $('facadeEditMode').value, layer = $('facadeLayer').value;
    if (mode === 'mask') {
      if (!pending) { pending = p; render(); return say('Premier coin posé : cliquez le coin opposé de l’obstacle.'); }
      const x1=Math.min(p[0],pending[0]), y1=Math.min(p[1],pending[1]);
      const x2=Math.max(p[0],pending[0]), y2=Math.max(p[1],pending[1]);
      if (x2-x1 < 3 || y2-y1 < 3) return say('Choisissez une zone d’au moins 3 × 3 pixels.');
      if (masks.length >= 30) return say('Maximum 30 zones d’exclusion.');
      masks.push({x1,y1,x2,y2}); pending=null; revision++; candidates=[]; render();
      return say(`Zone ${masks.length} ajoutée : relancez l’extraction pour exclure ses contours. La photo ne sera pas effacée.`);
    }
    if (mode === 'calibrate') {
      if (refPoints.length === 2) refPoints = [];
      refPoints.push(p); pending = p; render();
      return say(refPoints.length === 1 ? 'Premier point de cote posé ; cliquez le second.' : 'Deux points posés : saisissez la cote en mètres puis appliquez.');
    }
    if (mode === 'candidate') {
      const i = candidates.findIndex(b => p[0] >= b.x1-4 && p[0] <= b.x2+4 && p[1] >= b.y1-4 && p[1] <= b.y2+4);
      if (i < 0) return say('Cliquez dans un rectangle orange proposé.');
      const b = candidates.splice(i,1)[0]; remember();
      segs.push({a:[b.x1,b.y1],b:[b.x2,b.y1],layer}, {a:[b.x2,b.y1],b:[b.x2,b.y2],layer},
        {a:[b.x2,b.y2],b:[b.x1,b.y2],layer}, {a:[b.x1,b.y2],b:[b.x1,b.y1],layer});
      render(); return say(`Rectangle ajouté au calque ${layer} : classement manuel, à vérifier.`);
    }
    if (mode === 'bridge') {
      const i = nearestSegment(segs, p, Math.max(5, 8 * rect.width / box.width));
      if (i < 0) return say('Cliquez près d’un trait existant.');
      if (firstBridge < 0) { firstBridge = i; return say('Premier trait choisi. Cliquez un second trait aligné.'); }
      const bridge = i === firstBridge ? null : bridgeSegments(segs[firstBridge], segs[i]); firstBridge = -1;
      if (!bridge) return say('Traits non compatibles : ils doivent être séparés, courts à relier et presque alignés.');
      remember(); segs.push(bridge); candidates = []; render();
      return say('Liaison ajoutée en HYPOTHESE : partie masquée non observée, à vérifier.');
    }
    if (mode === 'draw') {
      if (!pending) { pending = p; render(); return say('Premier point posé : cliquez le second point de la ligne.'); }
      if (Math.hypot(p[0] - pending[0], p[1] - pending[1]) < 2) return say('Les deux points doivent être distincts.');
      remember(); segs.push({ a: pending, b: p, layer }); pending = null; candidates = []; render();
      return say(`Ligne ajoutée au calque ${layer} ; ${segs.length} ligne(s).`);
    }
    const i = nearestSegment(segs, p, Math.max(5, 8 * rect.width / box.width));
    if (i < 0) return say('Aucune ligne à proximité.');
    remember(); candidates = [];
    if (mode === 'delete') { segs.splice(i, 1); say(`Ligne supprimée ; ${segs.length} ligne(s).`); }
    else if (mode === 'classify') { segs[i] = { ...segs[i], layer }; say(`Ligne classée dans ${layer}. Classement manuel, à vérifier.`); }
    render();
  });
  const dl = (name, data, mime) => {
    const a = doc.createElement('a'), url = URL.createObjectURL(new Blob([data], { type: mime }));
    a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  $('facadeDxf').addEventListener('click', () => {
    if (!rect || dirty || !segs.length) return say('Aucune ligne à exporter : rectifiez avec les dimensions actuelles puis ajoutez des lignes.');
    const unitless = $('facadeUnit').value !== 'metric';
    dl('facade.dxf', facadeDxf(segs, rect.height - 1, rect.sx, 'Facade', rect.sy, unitless), 'application/dxf');
    say(unitless ? 'DXF téléchargé en unités arbitraires : ne pas lire les coordonnées comme des mètres.' : 'DXF téléchargé en mètres déclarés : validité conditionnée aux mesures saisies.');
  });
  $('facadeSvg').addEventListener('click', () => {
    if (!rect || dirty || !segs.length) return say('Aucune ligne à exporter avec les dimensions actuelles.');
    dl('facade.svg', segmentsToSvg(segs, rect.width, rect.height), 'image/svg+xml'); say('SVG téléchargé.');
  });
  $('facadePng').addEventListener('click', () => {
    if (!rect || dirty) return say('Rectifiez d’abord avec les dimensions actuelles.');
    res.toBlob(b => { if (b) { dl('facade.png', b, 'image/png'); say('PNG téléchargé : photo rectifiée avec les lignes affichées.'); } else say('Export PNG impossible.'); }, 'image/png');
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => initFacadeRectify(document));
  else initFacadeRectify(document);
}
