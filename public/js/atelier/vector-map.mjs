/* Cartographie de présentation Freemap, écrite indépendamment à partir des
   capacités visibles d'urban:EXPORT. Les données restent celles de Freemap;
   aucun script, style ou fichier du service de référence n'est réutilisé. */
import { courbesDeNiveau, enLocal, equidistance, grilleTerrain } from './exports.mjs';
import { classifyBuilding, roadSurface, roadWidth } from './geometry.mjs';

export const MAP_PRESETS = Object.freeze(['classic', 'figure-ground', 'relief', 'night', 'blueprint']);
export const MAP_CLASSES = Object.freeze({
  residential: { fr: 'Résidentiel', en: 'Residential', color: '#D9C7A7' },
  public: { fr: 'Public', en: 'Public', color: '#91B7D3' },
  commercial: { fr: 'Commercial', en: 'Commercial', color: '#D5A36C' },
  industrial: { fr: 'Industriel', en: 'Industrial', color: '#AFA5C2' },
  utility: { fr: 'Annexe', en: 'Utility', color: '#AAB09A' },
  other: { fr: 'Autre', en: 'Other', color: '#B7B5AF' }
});

const PALETTES = Object.freeze({
  classic: { bg: '#F8F6F0', ink: '#34372F', road: '#D7C8AA', path: '#C9BFAE', rail: '#806A86', water: '#9CC6D8', green: '#C7D9B7', contour: '#917F64', site: '#BE6339', grid: '#B9B6AA' },
  'figure-ground': { bg: '#FFFFFF', ink: '#171918', road: '#E8E7E1', path: '#DEDDD7', rail: '#777777', water: '#E7EEF0', green: '#F4F4F1', contour: '#777777', site: '#B7382D', grid: '#D6D6D2' },
  relief: { bg: '#F1E9D8', ink: '#38382F', road: '#CBB99A', path: '#D8C9AD', rail: '#806A86', water: '#9EC3D1', green: '#BBCDA3', contour: '#877B61', site: '#B84735', grid: '#B6AF9C' },
  night: { bg: '#121A20', ink: '#E3E8E7', road: '#596871', path: '#46545B', rail: '#B08AC1', water: '#287F9F', green: '#365C4B', contour: '#7E8C7E', site: '#FF7B58', grid: '#425059' },
  blueprint: { bg: '#153B61', ink: '#F2F5F3', road: '#75A4C5', path: '#5B86A8', rail: '#C5A6D3', water: '#3F7092', green: '#315D7A', contour: '#8DB7CF', site: '#F5C878', grid: '#557B9B' }
});
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const fmt = n => Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
const hexRGB = h => {
  const s = String(h || '').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(s)) return [120, 120, 120];
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
};
const rgbHex = c => '#' + c.map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => { const x = hexRGB(a), y = hexRGB(b); return rgbHex(x.map((v, i) => v + (y[i] - v) * clamp(t, 0, 1))); };
const niceStep = n => {
  const p = 10 ** Math.floor(Math.log10(Math.max(.001, n)));
  for (const m of [1, 2, 5, 10]) if (n <= m * p) return m * p;
  return 10 * p;
};

export function vectorMapSVG(ctx, options = {}) {
  const W = Math.max(720, Math.min(2400, Math.floor(options.width || 1587)));
  const H = Math.max(540, Math.min(1800, Math.floor(options.height || 1122)));
  const pad = Math.max(28, Math.min(100, Number(options.margin) || 55));
  const mapTop = pad + 38, mapBottom = H - pad - 52;
  const mapLeft = pad, mapRight = W - pad;
  const mapW = mapRight - mapLeft, mapH = mapBottom - mapTop;
  const R = Math.max(1, Number(ctx.curR) || 600);
  const shape = options.shape === 'square' || ctx.shape === 'square' ? 'square' : 'circle';
  const preset = MAP_PRESETS.includes(options.preset) ? options.preset : 'classic';
  const p = { ...PALETTES[preset], ...(options.colors || {}) };
  const fitScale = Math.min(mapW / (2 * R), mapH / (2 * R));
  const selectedScale = options.printScale === 'fit' || !options.printScale ? null : Number(options.printScale);
  const pixelsPerMeter = selectedScale > 0 ? 3779.52756 / selectedScale : fitScale;
  const scale = pixelsPerMeter;
  const cx = (mapLeft + mapRight) / 2, cy = (mapTop + mapBottom) / 2;
  const xy = local => [cx + local[0] * scale, cy - local[1] * scale];
  const geo = point => xy(enLocal(point[0], point[1], ctx.sLat, ctx.sLng));
  const pathOf = (points, closed = false, project = xy) => {
    if (!Array.isArray(points) || points.length < 2) return '';
    const projected = points.map(project).filter(q => Number.isFinite(q[0]) && Number.isFinite(q[1]));
    return projected.length < 2 ? '' : 'M' + projected.map(q => `${fmt(q[0])},${fmt(q[1])}`).join('L') + (closed ? 'Z' : '');
  };
  const d = ctx.D || {};
  const layers = { buildings: true, roads: true, bridges: true, rail: true, water: true, green: true,
    trees: true, contours: true, labels: false, siteBoundary: true, grid: !!options.grid, ...(options.layers || {}) };
  const label = (fr, en) => options.lang === 'en' ? en : fr;
  const title = esc(options.title || ctx.siteName || 'Freemap · Atelier');
  const line = Math.max(.45, Math.min(4, Number(options.outlineWeight) || 1));
  const byType = options.colorByType !== false && preset !== 'figure-ground' && preset !== 'night' && preset !== 'blueprint';
  const parts = [];
  const framePath = shape === 'square'
    ? `<rect x="${fmt(cx - R * scale)}" y="${fmt(cy - R * scale)}" width="${fmt(2 * R * scale)}" height="${fmt(2 * R * scale)}"/>`
    : `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(R * scale)}"/>`;
  const clipMarkup = shape === 'square'
    ? `<rect x="${fmt(cx - R * scale)}" y="${fmt(cy - R * scale)}" width="${fmt(2 * R * scale)}" height="${fmt(2 * R * scale)}"/>`
    : `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(R * scale)}"/>`;
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="420mm" height="297mm" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label('Carte vectorielle Freemap', 'Freemap vector map')}">`);
  parts.push(`<rect width="${W}" height="${H}" fill="${p.bg}"/>`);
  parts.push(`<defs><clipPath id="fm-map-clip">${clipMarkup}</clipPath><linearGradient id="fm-height" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#EEE2C5"/><stop offset="1" stop-color="#54795B"/></linearGradient></defs>`);
  parts.push(`<text x="${pad}" y="${pad + 2}" font-family="sans-serif" font-size="20" font-weight="700" fill="${p.ink}">${title}</text>`);
  parts.push(`<text x="${pad}" y="${pad + 22}" font-family="sans-serif" font-size="10" fill="${p.ink}" opacity=".72">${label('Carte vectorielle · ', 'Vector map · ')}${shape === 'square' ? label('emprise carrée', 'square footprint') : label('emprise circulaire', 'circular footprint')} · ${selectedScale ? `1:${selectedScale}` : label('échelle ajustée', 'fit to page')}</text>`);

  parts.push('<g clip-path="url(#fm-map-clip)">');
  /* Fond et ombrage du relief, si le modèle altimétrique est présent. */
  const T = grilleTerrain(ctx);
  if (T && (preset === 'relief' || Number(options.hillshadeStrength) > 0 || Number(options.depthMapStrength) > 0)) {
    const grid = T.grid, n = T.n;
    const cellX = 2 * R * scale / Math.max(1, n - 1), cellY = cellX;
    const hill = clamp(Number(options.hillshadeStrength ?? (preset === 'relief' ? .45 : 0)), 0, 1);
    const depth = clamp(Number(options.depthMapStrength ?? (preset === 'relief' ? .24 : 0)), 0, 1);
    const az = Number(options.sunAzimuth ?? 315) * Math.PI / 180;
    const alt = clamp(Number(options.sunHeight ?? 35), 5, 85) * Math.PI / 180;
    const sun = [Math.sin(az) * Math.cos(alt), Math.cos(az) * Math.cos(alt), Math.sin(alt)];
    const min = T.min, range = T.max - T.min || 1;
    for (let row = 0; row < n - 1; row++) for (let col = 0; col < n - 1; col++) {
      const z00 = Number(grid[row]?.[col]) || 0, z10 = Number(grid[row]?.[col + 1]) || 0;
      const z01 = Number(grid[row + 1]?.[col]) || 0, z11 = Number(grid[row + 1]?.[col + 1]) || 0;
      const dzx = ((z10 + z11) - (z00 + z01)) / 2;
      const dzy = ((z01 + z11) - (z00 + z10)) / 2;
      const nn = Math.hypot(-dzx, -dzy, 2 * R / Math.max(1, n - 1)) || 1;
      const illum = clamp(((-dzx) * sun[0] + (-dzy) * sun[1] + (2 * R / Math.max(1, n - 1)) * sun[2]) / nn, 0, 1);
      const elev = ((z00 + z10 + z01 + z11) / 4 - min) / range;
      const fill = depth ? mix(p.bg, '#54795B', elev * depth) : p.bg;
      const x = cx - R * scale + col * cellX, y = cy - R * scale + row * cellY;
      parts.push(`<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(cellX + .3)}" height="${fmt(cellY + .3)}" fill="${fill}" opacity="${fmt(.55 + .45 * depth)}"/>`);
      if (hill) parts.push(`<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(cellX + .3)}" height="${fmt(cellY + .3)}" fill="${illum > .5 ? '#fff' : '#16201c'}" opacity="${fmt(Math.abs(illum - .5) * 2 * hill * .35)}"/>`);
    }
  }

  if (layers.green) for (const f of d.green || []) {
    const points = (f.g || []).map(geo), closed = points.length >= 3;
    const fill = f.k === 'w' ? p.water : p.green;
    if (closed) parts.push(`<path d="${pathOf(f.g, true, geo)}" fill="${fill}" stroke="${fill}" stroke-width="${line}"/>`);
  }
  if (layers.water) for (const f of d.waterways || []) {
    if ((f.g || []).length > 1) parts.push(`<path d="${pathOf(f.g, false, geo)}" fill="none" stroke="${p.water}" stroke-width="${Math.max(1, scale * (Number(f.width) || 1.4))}" stroke-linecap="round"/>`);
  }
  if (layers.rail) for (const f of d.rail || []) {
    if ((f.g || []).length > 1) parts.push(`<path d="${pathOf(f.g, false, geo)}" fill="none" stroke="${p.rail}" stroke-width="${Math.max(.8, line)}" stroke-dasharray="5 3"/>`);
  }

  let contourCount = 0;
  if (layers.contours && T && globalThis.FMEngine?.contours) {
    const interval = equidistance(T.range, Number(options.contourInterval) || 0);
    for (const c of courbesDeNiveau(T, interval, globalThis.FMEngine)) {
      if (contourCount++ > 1500) break;
      const points = c.pts.map(([x, y]) => xy([x, y]));
      parts.push(`<path d="${pathOf(points, false, q => q)}" fill="none" stroke="${p.contour}" stroke-width="${line * .72}" opacity=".78"/>`);
    }
  }

  if (layers.roads) for (const r of d.roads || []) {
    if (!Array.isArray(r.g) || r.g.length < 2) continue;
    const local = r.g.map(point => enLocal(point[0], point[1], ctx.sLat, ctx.sLng));
    const { metres } = Number(r.width) > 0 ? { metres: Number(r.width) } : roadWidth(r.tags || { highway: r.h });
    const path = pathOf(roadSurface(local, metres), true);
    if (!path) continue;
    const bridge = !!r.bridge;
    const cls = /footway|path|cycleway|steps|pedestrian/.test(r.h || '');
    const stroke = bridge && layers.bridges ? p.site : cls ? p.path : p.road;
    const opacity = preset === 'figure-ground' ? .78 : .94;
    parts.push(`<path d="${path}" fill="${stroke}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width=".35" stroke-linejoin="round"/>`);
    if (bridge && layers.bridges) {
      const center = pathOf(local, false);
      parts.push(`<path d="${center}" fill="none" stroke="${p.ink}" stroke-width="${Math.max(.55, line * .55)}" stroke-dasharray="4 3"/>`);
    }
  }

  if (layers.buildings) {
    /* Ombres décalées selon une direction/hauteur solaire réglable. */
    const shadowStrength = clamp(Number(options.shadowStrength ?? .15), 0, .7);
    const az = Number(options.sunAzimuth ?? 315) * Math.PI / 180;
    const sunHeight = clamp(Number(options.sunHeight ?? 35), 5, 85) * Math.PI / 180;
    const sx = -Math.sin(az), sy = Math.cos(az);
    if (shadowStrength > 0) for (const b of d.build || []) {
      if (!Array.isArray(b.g) || b.g.length < 3) continue;
      const h = clamp(Number(b.h) || 9, 2, 80);
      const shift = Math.min(65, h / Math.tan(sunHeight) * .55);
      const shadow = b.g.map(q => { const v = enLocal(q[0], q[1], ctx.sLat, ctx.sLng); return xy([v[0] + sx * shift, v[1] + sy * shift]); });
      parts.push(`<path d="${pathOf(shadow, true, q => q)}" fill="#111820" opacity="${shadowStrength}"/>`);
    }
    const strength = clamp(Number(options.depthMapStrength) || 0, 0, .7);
    for (const b of d.build || []) {
      if (!Array.isArray(b.g) || b.g.length < 3) continue;
      const cls = b.class || classifyBuilding(b.tags || { building: b.t });
      const base = preset === 'figure-ground' ? p.ink : preset === 'night' ? '#D4DFE1' : preset === 'blueprint' ? '#E9F3F7' : byType ? (options.classColors?.[cls] || MAP_CLASSES[cls]?.color || p.ink) : (options.colors?.building || '#BEB8AB');
      const h = clamp(Number(b.h) || 9, 0, 80);
      const fill = strength && !['figure-ground', 'night', 'blueprint'].includes(preset) ? mix(base, '#342C24', clamp(h / 60 * strength, 0, .65)) : base;
      const poly = b.g.map(geo);
      parts.push(`<path d="${pathOf(poly, true, q => q)}" fill="${fill}" stroke="${preset === 'figure-ground' ? p.ink : mix(fill, p.ink, .25)}" stroke-width="${line}" stroke-linejoin="round"/>`);
      if (layers.labels && b.nom) {
        const x = poly.reduce((s, q) => s + q[0], 0) / poly.length, y = poly.reduce((s, q) => s + q[1], 0) / poly.length;
        parts.push(`<text x="${fmt(x)}" y="${fmt(y)}" font-family="sans-serif" font-size="${Math.max(7, Math.min(12, scale * 4))}" text-anchor="middle" fill="${p.ink}">${esc(b.nom)}</text>`);
      }
    }
  }
  if (layers.labels) for (const poi of (d.pois || []).slice(0, 800)) {
    const name = poi.nom || poi.name;
    if (!name) continue;
    const [x, y] = geo([poi.lat ?? poi.y, poi.lon ?? poi.x]);
    parts.push(`<circle cx="${fmt(x)}" cy="${fmt(y)}" r="2.4" fill="${p.site}" stroke="${p.bg}" stroke-width=".8"/>`);
    parts.push(`<text x="${fmt(x + 4)}" y="${fmt(y - 4)}" font-family="sans-serif" font-size="${Math.max(7, Math.min(11, scale * 3.5))}" fill="${p.ink}" stroke="${p.bg}" stroke-width="2.4" paint-order="stroke">${esc(name)}</text>`);
  }
  if (layers.trees) {
    for (const tree of (d.trees || []).slice(0, 5000)) {
      const [x, y] = geo([tree.lat, tree.lon]);
      const radius = clamp((Number(tree.h) || 5) * scale * .12, 1.4, 6);
      parts.push(`<circle cx="${fmt(x)}" cy="${fmt(y)}" r="${fmt(radius)}" fill="#3F8055" stroke="${p.bg}" stroke-width=".7"/>`);
    }
    for (const row of d.treeRows || []) if ((row.g || []).length > 1)
      parts.push(`<path d="${pathOf(row.g, false, geo)}" fill="none" stroke="#3F8055" stroke-width="${Math.max(1, scale * 2)}" stroke-linecap="round"/>`);
  }
  if (layers.siteBoundary && Array.isArray(options.boundary || ctx.boundary)) {
    const boundary = options.boundary || ctx.boundary;
    if (boundary.length >= 3) parts.push(`<path d="${pathOf(boundary, true, geo)}" fill="rgba(190,99,57,.08)" stroke="${p.site}" stroke-width="${line * 1.7}" stroke-dasharray="6 3" stroke-linejoin="round"/>`);
  }
  parts.push('</g>');
  parts.push(`<g fill="none" stroke="${p.ink}" stroke-width="${line}">${framePath}</g>`);

  /* Graticule en coordonnées locales, coupée à la forme d'emprise. */
  if (layers.grid) {
    const step = Number(options.gridInterval) > 0 ? Number(options.gridInterval) : niceStep(R / 4);
    const minor = `<g fill="none" stroke="${p.grid}" stroke-width=".55" opacity=".72" clip-path="url(#fm-map-clip)">`;
    parts.push(minor);
    for (let x = Math.ceil(-R / step) * step; x <= R; x += step) {
      const a = xy([x, -R]), b = xy([x, R]);
      parts.push(`<path d="M${fmt(a[0])},${fmt(a[1])}L${fmt(b[0])},${fmt(b[1])}"/>`);
    }
    for (let y = Math.ceil(-R / step) * step; y <= R; y += step) {
      const a = xy([-R, y]), b = xy([R, y]);
      parts.push(`<path d="M${fmt(a[0])},${fmt(a[1])}L${fmt(b[0])},${fmt(b[1])}"/>`);
    }
    parts.push('</g>');
  }

  /* Flèche nord et barre d'échelle. */
  if (options.northArrow !== false) {
    const x = mapRight - 25, y = mapTop + 25;
    parts.push(`<g stroke="${p.ink}" fill="${p.ink}" font-family="sans-serif"><path d="M${x},${y + 32}L${x},${y}M${x},${y}l-6,11h12Z"/><text x="${x}" y="${y - 5}" text-anchor="middle" font-size="12">N</text></g>`);
  }
  if (options.scaleBar !== false) {
    const meters = niceStep(150 / scale), px = meters * scale, x = mapLeft + 20, y = mapBottom - 18;
    parts.push(`<g stroke="${p.ink}" fill="${p.ink}" font-family="sans-serif"><path d="M${x},${y}h${fmt(px)}M${x},${y - 4}v8M${fmt(x + px)},${y - 4}v8" stroke-width="2"/><text x="${fmt(x + px / 2)}" y="${y - 7}" text-anchor="middle" font-size="10">${meters >= 1000 ? `${meters / 1000} km` : `${meters} m`}</text></g>`);
  }
  if (options.grid && Number(options.gridInterval) > 0) {
    const step = Number(options.gridInterval);
    parts.push(`<text x="${mapLeft + 4}" y="${mapBottom + 15}" font-family="sans-serif" font-size="8" fill="${p.ink}">Grille locale · ${step} m</text>`);
  }
  if (options.outline !== false) parts.push(`<rect x="${mapLeft}" y="${mapTop}" width="${mapW}" height="${mapH}" fill="none" stroke="${p.ink}" stroke-width="${line}" opacity=".65"/>`);

  const classes = byType ? Object.entries(MAP_CLASSES).map(([key, c], i) => {
    const x = mapLeft + i * Math.min(165, mapW / 6), y = H - pad + 15;
    const color = options.classColors?.[key] || c.color;
    return `<g><rect x="${fmt(x)}" y="${fmt(y)}" width="8" height="8" fill="${color}"/><text x="${fmt(x + 12)}" y="${fmt(y + 8)}" font-family="sans-serif" font-size="8" fill="${p.ink}">${esc(label(c.fr, c.en))}</text></g>`;
  }).join('') : '';
  if (classes) parts.push(classes);
  const buildings = (d.build || []).length, trees = (d.trees || []).length;
  const roadsKm = (d.roads || []).reduce((sum, r) => {
    let length = 0; const pts = r.g || [];
    for (let i = 1; i < pts.length; i++) {
      const a = enLocal(pts[i - 1][0], pts[i - 1][1], ctx.sLat, ctx.sLng), b = enLocal(pts[i][0], pts[i][1], ctx.sLat, ctx.sLng);
      length += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    return sum + length;
  }, 0) / 1000;
  const stats = `${buildings.toLocaleString(options.lang === 'en' ? 'en-GB' : 'fr-FR')} ${label('bâtiments', 'buildings')} · ${roadsKm.toFixed(1)} km ${label('de voies', 'of roads')} · ${trees.toLocaleString(options.lang === 'en' ? 'en-GB' : 'fr-FR')} ${label('arbres OSM', 'OSM trees')}`;
  parts.push(`<text x="${pad}" y="${H - 9}" font-family="sans-serif" font-size="8" fill="${p.ink}" opacity=".8">${esc(stats)}</text>`);
  parts.push(`<text x="${W - pad}" y="${H - 9}" text-anchor="end" font-family="sans-serif" font-size="8" fill="${p.ink}" opacity=".72">© OpenStreetMap contributors (ODbL) · relief Terrarium · limites de projet fournies par l’utilisateur</text>`);
  parts.push('</svg>');

  const footprintWidth = 2 * R * scale, footprintHeight = 2 * R * scale;
  return {
    svg: parts.join(''), preset, shape, scale: selectedScale || Math.round(3779.52756 / Math.max(scale, .001)),
    fitsPage: footprintWidth <= mapW && footprintHeight <= mapH, stats: { buildings, trees, roadsKm, contours: contourCount }
  };
}
