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

export function facadeDxf(segs, h, scale, titre, scaleY = scale) {
  return dxf(segmentsToEntities(segs, h, scale, scaleY), Object.entries(FACADE_LAYERS).map(([nom, v]) => ({ nom, couleur: v.couleur })),
    { titre: titre || 'Facade UrbaTrame' });
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
  let img = null, corners = [], rect = null, segs = [], loading = 0, revision = 0, history = [], pending = null, dirty = false;
  const say = m => { $('facadeStatus').textContent = m; };
  const invalidate = () => { revision++; rect = null; segs = []; history = []; pending = null; dirty = false; rctx.clearRect(0, 0, res.width, res.height); };
  const remember = () => { history.push(segs.map(s => ({ ...s, a: [...s.a], b: [...s.b] }))); if (history.length > 30) history.shift(); };
  const render = () => {
    if (!rect) return;
    rctx.putImageData(new ImageData(rect.data, rect.width, rect.height), 0, 0);
    rctx.lineWidth = Math.max(1, rect.width / 600);
    for (const s of segs) {
      rctx.strokeStyle = FACADE_LAYERS[layerOf(s)].svg;
      rctx.beginPath(); rctx.moveTo(...s.a); rctx.lineTo(...s.b); rctx.stroke();
    }
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
  file.addEventListener('change', () => {
    const f = file.files[0];
    if (segs.length && !window.confirm('Changer de photo effacera les lignes actuelles. Continuer ?')) { file.value = ''; return; }
    const current = ++loading;
    img = null; corners = []; invalidate(); ctx.clearRect(0, 0, cv.width, cv.height);
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) return say('Image trop volumineuse : maximum 20 Mo.');
    const url = URL.createObjectURL(f), im = new Image();
    im.onload = () => {
      URL.revokeObjectURL(url);
      if (current !== loading) return;
      if (im.width < 2 || im.height < 2) return say('Image trop petite.');
      const k = Math.min(1, 1200 / Math.max(im.width, im.height));
      cv.width = Math.max(2, Math.round(im.width * k)); cv.height = Math.max(2, Math.round(im.height * k));
      ctx.drawImage(im, 0, 0, cv.width, cv.height);
      img = ctx.getImageData(0, 0, cv.width, cv.height);
      say('Photo chargée. Cliquez les 4 coins : haut-gauche, haut-droite, bas-droite, bas-gauche.');
    };
    im.onerror = () => { URL.revokeObjectURL(url); if (current === loading) say('Impossible de lire cette image.'); };
    im.src = url;
  });
  cv.addEventListener('click', ev => {
    if (!img || corners.length >= 4) return;
    const r = cv.getBoundingClientRect();
    corners.push([(ev.clientX - r.left) * cv.width / r.width, (ev.clientY - r.top) * cv.height / r.height]);
    invalidate(); drawCorners();
    say(corners.length === 4 ? '4 coins posés. Saisissez les deux dimensions mesurées puis rectifiez.' : `Coin ${corners.length} posé sur 4.`);
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
      return say('Saisissez des dimensions positives mesurées (largeur 0,5–500 m, hauteur 0,5–200 m, rapport inférieur à 100).');
    const k = Math.min(40, 799 / Math.max(wm, hm));
    const w = Math.max(2, Math.round(wm * k) + 1), h = Math.max(2, Math.round(hm * k) + 1);
    rect = warpToRect(img, corners, w, h);
    if (!rect) return say('Rectification impossible : vérifiez les coins.');
    rect.sx = wm / (w - 1); rect.sy = hm / (h - 1);
    res.width = w; res.height = h; rctx.putImageData(new ImageData(rect.data, w, h), 0, 0);
    say(`Photo rectifiée : ${w} × ${h} pixels. Vous pouvez extraire les lignes.`);
  });
  $('facadeLines').addEventListener('click', () => {
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
      const found = houghSegments(sobel(toGray(rect), rect.width, rect.height), rect.width, rect.height, { seuil, minLen });
      remember(); segs = found; pending = null; render();
      say(`${segs.length} segments détectés. Résultat indicatif à nettoyer et vérifier.`);
    }, 20);
  });
  $('facadeClean').addEventListener('click', () => {
    if (!rect || dirty || !segs.length) return say('Rectifiez avec les dimensions actuelles et ajoutez des lignes avant de nettoyer.');
    const tol = Number($('facadeTolerance').value);
    if (!Number.isFinite(tol) || tol < 0 || tol > 10) return say('Tolérance autorisée : 0 à 10 pixels.');
    const cleaned = removeDuplicateSegments(segs, tol), n = segs.length - cleaned.length;
    if (n) { remember(); segs = cleaned; pending = null; render(); }
    say(`${n} doublon(s) retiré(s), ${segs.length} ligne(s) conservée(s). Annulez si un trait utile a disparu.`);
  });
  $('facadeEditUndo').addEventListener('click', () => {
    pending = null;
    if (!history.length) { render(); return say('Aucune modification à annuler.'); }
    revision++; segs = history.pop(); render(); say(`Modification annulée : ${segs.length} ligne(s).`);
  });
  $('facadeEditMode').addEventListener('change', () => { pending = null; render(); });
  res.addEventListener('click', e => {
    if (!rect || dirty) return say('Rectifiez d’abord avec les dimensions actuelles.');
    const box = res.getBoundingClientRect();
    const p = [Math.max(0, Math.min(rect.width - 1, (e.clientX - box.left) * rect.width / box.width)),
      Math.max(0, Math.min(rect.height - 1, (e.clientY - box.top) * rect.height / box.height))];
    const mode = $('facadeEditMode').value, layer = $('facadeLayer').value;
    if (mode === 'draw') {
      if (!pending) { pending = p; render(); return say('Premier point posé : cliquez le second point de la ligne.'); }
      if (Math.hypot(p[0] - pending[0], p[1] - pending[1]) < 2) return say('Les deux points doivent être distincts.');
      remember(); segs.push({ a: pending, b: p, layer }); pending = null; render();
      return say(`Ligne ajoutée au calque ${layer} ; ${segs.length} ligne(s).`);
    }
    const i = nearestSegment(segs, p, Math.max(5, 8 * rect.width / box.width));
    if (i < 0) return say('Aucune ligne à proximité.');
    remember();
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
    dl('facade.dxf', facadeDxf(segs, rect.height - 1, rect.sx, 'Facade', rect.sy), 'application/dxf');
    say('DXF téléchargé : coordonnées locales en mètres.');
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
