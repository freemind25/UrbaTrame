/* Petit rasteriseur sans dépendance : les aperçus PNG de la CLI n'exigent ni
   navigateur, ni Python, ni moteur graphique installé. Primitives dessinées :
   lignes, contours, polygones pleins et texte bitmap 5×7. Le PNG est écrit
   avec node:zlib. */
import zlib from 'node:zlib';

const COLORS = {
  COURBES: '#8c7b62', BATI: '#302f2b', VOIRIE: '#bc922e', RAIL: '#8055a5',
  EAU: '#5c8fa8', VERT: '#7ba05b', USAGE: '#618c70', PARCELLES: '#a8654e',
  ARBRES: '#37734e', POI: '#c0392b', EMPRISE: '#c0392b', TEXTE: '#3d5a80',
  TERRAIN: '#6b5a44', AXE: '#c0392b', SOL: '#d8d2c6'
};
const rgb = value => {
  const text = String(value ?? '').trim();
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(text);
  if (m) return [Math.round(Number(m[1])), Math.round(Number(m[2])), Math.round(Number(m[3])), m[4] === undefined ? 255 : Math.round(Math.max(0, Math.min(1, Number(m[4]))) * 255)];
  let h = text.replace('#', '');
  if (h.length === 3) h = [...h].map(c => c + c).join('');
  return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0, 255];
};
const FONT = Object.fromEntries(Object.entries({
  ' ': '00000/00000/00000/00000/00000/00000/00000',
  A: '01110/10001/10001/11111/10001/10001/10001', B: '11110/10001/10001/11110/10001/10001/11110',
  C: '01111/10000/10000/10000/10000/10000/01111', D: '11110/10001/10001/10001/10001/10001/11110',
  E: '11111/10000/10000/11110/10000/10000/11111', F: '11111/10000/10000/11110/10000/10000/10000',
  G: '01111/10000/10000/10111/10001/10001/01111', H: '10001/10001/10001/11111/10001/10001/10001',
  I: '11111/00100/00100/00100/00100/00100/11111', J: '00111/00010/00010/00010/10010/10010/01100',
  K: '10001/10010/10100/11000/10100/10010/10001', L: '10000/10000/10000/10000/10000/10000/11111',
  M: '10001/11011/10101/10101/10001/10001/10001', N: '10001/11001/10101/10011/10001/10001/10001',
  O: '01110/10001/10001/10001/10001/10001/01110', P: '11110/10001/10001/11110/10000/10000/10000',
  Q: '01110/10001/10001/10001/10101/10010/01101', R: '11110/10001/10001/11110/10100/10010/10001',
  S: '01111/10000/10000/01110/00001/00001/11110', T: '11111/00100/00100/00100/00100/00100/00100',
  U: '10001/10001/10001/10001/10001/10001/01110', V: '10001/10001/10001/10001/10001/01010/00100',
  W: '10001/10001/10001/10101/10101/10101/01010', X: '10001/10001/01010/00100/01010/10001/10001',
  Y: '10001/10001/01010/00100/00100/00100/00100', Z: '11111/00001/00010/00100/01000/10000/11111',
  0: '01110/10001/10011/10101/11001/10001/01110', 1: '00100/01100/00100/00100/00100/00100/01110',
  2: '01110/10001/00001/00010/00100/01000/11111', 3: '11110/00001/00001/01110/00001/00001/11110',
  4: '00010/00110/01010/10010/11111/00010/00010', 5: '11111/10000/10000/11110/00001/00001/11110',
  6: '01110/10000/10000/11110/10001/10001/01110', 7: '11111/00001/00010/00100/01000/01000/01000',
  8: '01110/10001/10001/01110/10001/10001/01110', 9: '01110/10001/10001/01111/00001/00001/01110',
  '-': '00000/00000/00000/11111/00000/00000/00000', '_': '00000/00000/00000/00000/00000/00000/11111',
  '.': '00000/00000/00000/00000/00000/00110/00110', ',': '00000/00000/00000/00000/00110/00110/00100',
  ':': '00000/00110/00110/00000/00110/00110/00000', ';': '00000/00110/00110/00000/00110/00110/00100',
  '/': '00001/00010/00010/00100/01000/01000/10000', '+': '00000/00100/00100/11111/00100/00100/00000',
  '=': '00000/11111/00000/11111/00000/00000/00000', '(': '00010/00100/01000/01000/01000/00100/00010',
  ')': '01000/00100/00010/00010/00010/00100/01000', '?': '01110/10001/00001/00010/00100/00000/00100',
  "'": '00100/00100/00010/00000/00000/00000/00000', '"': '01010/01010/00100/00000/00000/00000/00000'
}).map(([k, v]) => [k, v.split('/')]));

class Raster {
  constructor(w, h, color = '#fbf9f5') {
    this.w = w; this.h = h; this.data = Buffer.alloc(w * h * 4);
    const c = rgb(color);
    for (let i = 0; i < this.data.length; i += 4) this.data.set(c, i);
  }
  pixel(x, y, c) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.data[i] = c[0]; this.data[i + 1] = c[1]; this.data[i + 2] = c[2]; this.data[i + 3] = c[3] ?? 255;
  }
  line(a, b, color, width = 1) {
    const c = typeof color === 'string' ? rgb(color) : color;
    let x0 = Math.round(a[0]), y0 = Math.round(a[1]), x1 = Math.round(b[0]), y1 = Math.round(b[1]);
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      const r = Math.max(0, Math.floor(width / 2));
      for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) this.pixel(x0 + ox, y0 + oy, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  polygon(points, color, fill = false, width = 1) {
    if (!points || points.length < 2) return;
    if (fill && points.length > 2) {
      const ys = points.map(p => p[1]), minY = Math.max(0, Math.floor(Math.min(...ys))), maxY = Math.min(this.h - 1, Math.ceil(Math.max(...ys)));
      const c = typeof color === 'string' ? rgb(color) : color;
      for (let y = minY; y <= maxY; y++) {
        const xs = [];
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
          const [xi, yi] = points[i], [xj, yj] = points[j];
          if ((yi <= y && yj > y) || (yj <= y && yi > y)) xs.push(xi + (y - yi) * (xj - xi) / (yj - yi));
        }
        xs.sort((a, b) => a - b);
        for (let i = 0; i + 1 < xs.length; i += 2)
          for (let x = Math.max(0, Math.ceil(xs[i])); x <= Math.min(this.w - 1, Math.floor(xs[i + 1])); x++) this.pixel(x, y, c);
      }
    }
    for (let i = 0; i < points.length; i++) this.line(points[i], points[(i + 1) % points.length], color, width);
  }
  polyline(points, color, width = 1) {
    for (let i = 1; i < (points || []).length; i++) this.line(points[i - 1], points[i], color, width);
  }
  circle(cx, cy, radius, color) {
    const r = Math.max(1, Math.round(radius)), c = typeof color === 'string' ? rgb(color) : color;
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++)
      if (x * x + y * y <= r * r) this.pixel(cx + x, cy + y, c);
  }
  text(value, x, baseline, color, scale = 1) {
    const c = typeof color === 'string' ? rgb(color) : color;
    const text = String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '')
      .replace(/[Ææ]/g, 'AE').replace(/[Œœ]/g, 'OE').replace(/ß/g, 'SS')
      .replace(/©/g, '(C)').toUpperCase();
    const s = Math.max(1, Math.min(8, Math.round(scale)));
    let penX = Math.round(x), penY = Math.round(baseline);
    for (const ch of text) {
      if (ch === '\n') { penX = Math.round(x); penY += 9 * s; continue; }
      const glyph = FONT[ch];
      if (!glyph) { penX += 6 * s; continue; }
      for (let row = 0; row < 7; row++) for (let col = 0; col < 5; col++) {
        if (glyph[row][col] !== '1') continue;
        for (let sy = 0; sy < s; sy++) for (let sx = 0; sx < s; sx++)
          this.pixel(penX + col * s + sx, penY - 7 * s + row * s + sy, c);
      }
      penX += 6 * s;
    }
  }
}

let CRC_TABLE;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type), len = Buffer.alloc(4), crc = Buffer.alloc(4);
  len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function encode(canvas) {
  const stride = canvas.w * 4, raw = Buffer.alloc((stride + 1) * canvas.h);
  for (let y = 0; y < canvas.h; y++) canvas.data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(canvas.w, 0); header.writeUInt32BE(canvas.h, 4);
  header[8] = 8; header[9] = 6; header[10] = 0; header[11] = 0; header[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))
  ]);
}

function fit(points, w, h, pad = 36) {
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const k = Math.min((w - pad * 2) / Math.max(1e-6, x1 - x0), (h - pad * 2) / Math.max(1e-6, y1 - y0));
  const project = p => [pad + (p[0] - x0) * k, h - pad - (p[1] - y0) * k];
  project.scale = k;
  return project;
}

export function planPNG(entities, { width = 1600, height = 1200 } = {}) {
  const c = new Raster(width, height);
  const all = [];
  for (const e of entities || []) if (e.pts) all.push(...e.pts); else if (e.pos) all.push(e.pos);
  if (!all.length) return encode(c);
  const xy = fit(all, width, height, 45);
  for (const e of entities || []) {
    const color = COLORS[e.calque] || '#555555';
    if (e.pts?.length > 1) {
      const pts = e.pts.map(xy);
      if (e.ferme) c.polygon(pts, color, false, e.calque === 'EMPRISE' ? 2 : 1);
      else c.polyline(pts, color, e.calque === 'VOIRIE' ? 2 : 1);
    } else if (e.t === 'point' && e.pos) {
      const [x, y] = xy(e.pos); c.line([x - 3, y], [x + 3, y], color, 1); c.line([x, y - 3], [x, y + 3], color, 1);
    } else if (e.t === 'texte' && e.pos && e.txt) {
      const [x, y] = xy(e.pos);
      const pixels = Math.max(6, (e.h || 2) * xy.scale * .9);
      c.text(e.txt, x, y, color, Math.max(1, Math.round(pixels / 7)));
    }
  }
  return encode(c);
}

export function sectionPNG(section, { width = 1600, height = 760, title = 'Coupe topographique' } = {}) {
  const c = new Raster(width, height);
  const left = 70, right = width - 30, top = 50, bottom = height - 55;
  const zMin = Math.min(section.zMin, ...section.bati.map(b => Math.min(b.z0, b.z1))) - 2;
  const zMax = Math.max(section.zMax, ...section.bati.map(b => Math.max(b.z0, b.z1) + b.h)) + 2;
  const x = d => left + d / Math.max(1, section.longueur) * (right - left);
  const y = z => bottom - (z - zMin) / Math.max(1, zMax - zMin) * (bottom - top);
  for (let k = 0; k <= 5; k++) {
    const zz = zMin + (zMax - zMin) * k / 5;
    c.line([left, y(zz)], [right, y(zz)], '#e3dfd7', 1);
    c.text(String(Math.round(zz)) + 'm', 6, y(zz) + 3, '#7a736a', 1);
  }
  for (let k = 0; k <= 5; k++) {
    const d = section.longueur * k / 5;
    c.line([x(d), bottom], [x(d), bottom + 4], '#b9b1a5', 1);
    c.text(String(Math.round(d)), x(d) - 8, bottom + 19, '#7a736a', 1);
  }
  c.text(title + ' · ' + Math.round(section.longueur) + 'm · ' + section.bati.length + ' batiments', left, 24, '#302f2b', 2);
  const terrainPts = section.pts.map(p => [x(p.d), y(p.z)]);
  c.polygon([[left, bottom], ...terrainPts, [right, bottom]], '#e9e2d4', true, 0);
  c.polyline(terrainPts, '#6b5a44', 2);
  for (const b of section.bati) {
    const z0 = Math.min(b.z0, b.z1);
    const rect = [[x(b.d0), y(z0)], [x(b.d1), y(z0)], [x(b.d1), y(z0 + b.h)], [x(b.d0), y(z0 + b.h)]];
    c.polygon(rect, '#383a35', true, 1);
    if (rect[1][0] - rect[0][0] > 34 && rect[0][1] - rect[3][1] > 15)
      c.text(String(Math.round(b.h)) + 'm', rect[0][0] + 4, rect[3][1] + 10, '#fbf9f5', 1);
  }
  c.text('A', left, height - 12, '#c0392b', 2);
  c.text('B', right - 12, height - 12, '#c0392b', 2);
  const attribution = '© OPENSTREETMAP CONTRIBUTORS · RELIEF TERRARIUM';
  c.text(attribution, Math.max(left + 24, width / 2 - attribution.length * 3), height - 4, '#7a736a', 1);
  return encode(c);
}

export function scenePNG(scene, { width = 1200, height = 900, title = 'Freemap · Atelier', hour = 15 } = {}) {
  const c = new Raster(width, height, '#e4ebf3');
  const cam = scene.cam;
  const screen = p => cam.ecran(cam.projLocal(p[0], p[1], p[2]));
  const terrain = scene.maille || [];
  for (const q of terrain) {
    const pts = q.pts.map(screen).filter(Boolean).map(p => [p[0] * width / cam.W, p[1] * height / cam.H]);
    if (pts.length === q.pts.length) c.polygon(pts, q.fill || '#d8d5cb', true, 0);
  }
  for (const sh of scene.ombres || []) {
    const pts = (sh.pts || []).map(p => [p[0] * width / cam.W, p[1] * height / cam.H]);
    if (pts.length > 2) c.polygon(pts, '#77766f', true, 0);
  }
  for (const tree of scene.arbres || []) {
    const p = cam.ecran(cam.projLocal(tree.x, tree.y, tree.z + tree.h * .62));
    if (p) c.circle(p[0] * width / cam.W, p[1] * height / cam.H, Math.max(2, tree.h * .35), '#43865a');
  }
  for (const f of scene.faces || []) {
    if (!f.pts || f.pts.length < 3 || f.type === 'pointe') continue;
    const pts = f.pts.map(p => [p[0] * width / cam.W, p[1] * height / cam.H]);
    c.polygon(pts, f.fill || '#b9b1a4', true, 1);
  }
  c.polygon([[0, height - 24], [width, height - 24], [width, height], [0, height]], '#fbf9f5', true, 0);
  c.text(`${title} · FREEMAP · ATELIER · OSM ODbL · TERRARIUM · ${String(hour).padStart(2, '0')}:00`, 10, height - 7, '#59645b', 1);
  return encode(c);
}
