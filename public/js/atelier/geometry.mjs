/* Utilitaires géométriques autonomes de l'atelier Freemap.
   Ils servent aux limites de projet, aux emprises carrées et aux largeurs de
   voirie; aucune géométrie de limite cadastrale n'est créée ici. */
const M_LAT = 111320;
const D2R = Math.PI / 180;

export const BUILDING_CLASSES = Object.freeze([
  'residential', 'public', 'commercial', 'industrial', 'utility', 'other'
]);

export function classifyBuilding(tags = {}) {
  const building = String(tags.building || tags['building:part'] || '').toLowerCase();
  const use = [tags.amenity, tags.healthcare, tags.education, tags.office, tags.shop, tags.landuse]
    .filter(Boolean).join(' ').toLowerCase();
  if (/industrial|warehouse|factory|manufactur|hangar/.test(`${building} ${use}`)) return 'industrial';
  if (/school|college|university|hospital|clinic|civic|public|government|fire_station|police|place_of_worship|church|mosque|temple|library|museum/.test(`${building} ${use}`)) return 'public';
  if (/commercial|retail|office|shop|hotel|restaurant|bank|market/.test(`${building} ${use}`)) return 'commercial';
  if (/garage|garages|carport|shed|hut|roof|service|utility|farm_auxiliary/.test(building)) return 'utility';
  if (/house|residential|apartments|detached|semidetached_house|terrace|dormitory|bungalow/.test(building)) return 'residential';
  return 'other';
}

function parseMetres(value) {
  if (value == null || value === '') return null;
  const raw = String(value).trim().replace(',', '.');
  const match = raw.match(/^([0-9]+(?:\.[0-9]+)?)\s*(m|meter|metre|ft|feet|')?$/i);
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return /^(ft|feet|')$/i.test(match[2] || '') ? n * 0.3048 : n;
}

const ROAD_DEFAULTS = Object.freeze({
  motorway: 8.5, motorway_link: 6, trunk: 7.5, trunk_link: 5.5,
  primary: 7, primary_link: 5, secondary: 6.5, secondary_link: 4.8,
  tertiary: 6, tertiary_link: 4.5, unclassified: 5, residential: 5,
  living_street: 4, service: 3.5, pedestrian: 3, cycleway: 2,
  footway: 1.8, path: 1.8, steps: 1.5, track: 2.5
});

/* La largeur explicitement cartographiée est prioritaire. Sinon, le calcul
   utilise les voies (3 m/voie) ou une valeur indicative par classe OSM. */
export function roadWidth(tags = {}) {
  const explicit = parseMetres(tags.width || tags['width:carriageway'] || tags.est_width);
  if (explicit) return { metres: Math.max(0.8, Math.min(40, explicit)), source: 'osm-width' };
  const lanes = Number.parseFloat(tags.lanes || tags['lanes:forward'] || tags['lanes:both_ways']);
  if (Number.isFinite(lanes) && lanes > 0) return {
    metres: Math.max(1.2, Math.min(24, lanes * 3)), source: 'osm-lanes'
  };
  const highway = String(tags.highway || '').toLowerCase();
  return { metres: ROAD_DEFAULTS[highway] || 4, source: 'class-estimate' };
}

/* Géométrie `[latitude, longitude]` → mètres locaux `[est, nord]`. */
export function toLocal(point, origin) {
  const [lat, lon] = point;
  return [(lon - origin.lon) * M_LAT * Math.cos(origin.lat * D2R), (lat - origin.lat) * M_LAT];
}

export function polygonArea(points) {
  const pts = (points || []).filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (pts.length < 3) return 0;
  let twice = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    twice += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(twice) / 2;
}

export function normalizeBoundary(points, origin, options = {}) {
  const maxPoints = Math.max(3, Math.min(300, options.maxPoints || 100));
  const source = Array.isArray(points) ? points : [];
  if (source.length > maxPoints) throw new Error('BOUNDARY_TOO_MANY_POINTS');
  const clean = [];
  for (const p of source) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const lat = Number(p[0]), lon = Number(p[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180)
      throw new Error('BOUNDARY_INVALID_COORDINATE');
    const q = [lat, lon];
    const prev = clean.at(-1);
    if (!prev || Math.hypot(...toLocal(q, origin).map((v, i) => v - toLocal(prev, origin)[i])) > 0.25) clean.push(q);
  }
  if (clean.length > 2 && Math.hypot(...toLocal(clean[0], origin).map((v, i) => v - toLocal(clean.at(-1), origin)[i])) < 0.25) clean.pop();
  if (clean.length < 3) throw new Error('BOUNDARY_NEEDS_THREE_POINTS');
  const local = clean.map(p => toLocal(p, origin));
  if (selfIntersects(local)) throw new Error('BOUNDARY_SELF_INTERSECTS');
  if (polygonArea(local) < (options.minArea ?? 25)) throw new Error('BOUNDARY_TOO_SMALL');
  return clean;
}

function orient(a, b, c) { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); }
function onSegment(a, b, p) {
  return Math.min(a[0], b[0]) - 1e-8 <= p[0] && p[0] <= Math.max(a[0], b[0]) + 1e-8 &&
    Math.min(a[1], b[1]) - 1e-8 <= p[1] && p[1] <= Math.max(a[1], b[1]) + 1e-8;
}
function intersects(a, b, c, d) {
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  if ((o1 > 1e-8 && o2 < -1e-8 || o1 < -1e-8 && o2 > 1e-8) &&
      (o3 > 1e-8 && o4 < -1e-8 || o3 < -1e-8 && o4 > 1e-8)) return true;
  return Math.abs(o1) <= 1e-8 && onSegment(a, b, c) || Math.abs(o2) <= 1e-8 && onSegment(a, b, d) ||
    Math.abs(o3) <= 1e-8 && onSegment(c, d, a) || Math.abs(o4) <= 1e-8 && onSegment(c, d, b);
}
function selfIntersects(points) {
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i], b = points[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (j === i || j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (intersects(a, b, points[j], points[(j + 1) % n])) return true;
    }
  }
  return false;
}

export function footprint(shape, radius, steps = 64) {
  const r = Number(radius);
  if (!Number.isFinite(r) || r <= 0) return [];
  if (shape === 'square') return [[-r, -r], [r, -r], [r, r], [-r, r]];
  const n = Math.max(8, Math.min(256, Math.floor(steps)));
  return Array.from({ length: n }, (_, i) => {
    const a = 2 * Math.PI * i / n;
    return [r * Math.cos(a), r * Math.sin(a)];
  });
}

export function areaForShape(shape, radius) {
  const r = Number(radius);
  if (!Number.isFinite(r) || r < 0) return 0;
  return shape === 'square' ? 4 * r * r : Math.PI * r * r;
}

export function insideShape(x, y, radius, shape = 'circle') {
  return shape === 'square' ? Math.abs(x) <= radius && Math.abs(y) <= radius
    : x * x + y * y <= radius * radius;
}

/* Découpage d'un segment par une boîte carrée centrée sur l'origine
   (algorithme de Liang–Barsky); renvoie null hors emprise. */
export function clipSegmentToSquare(a, b, radius) {
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const tests = [[-dx, a[0] + radius], [dx, radius - a[0]], [-dy, a[1] + radius], [dy, radius - a[1]]];
  for (const [p, q] of tests) {
    if (Math.abs(p) < 1e-12) { if (q < 0) return null; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return null; if (t > t0) t0 = t; }
    else { if (t < t0) return null; if (t < t1) t1 = t; }
  }
  return [[a[0] + t0 * dx, a[1] + t0 * dy], [a[0] + t1 * dx, a[1] + t1 * dy]];
}

export function clipPolylineToSquare(points, radius) {
  const out = [];
  let current = [];
  for (let i = 0; i + 1 < (points || []).length; i++) {
    const segment = clipSegmentToSquare(points[i], points[i + 1], radius);
    if (!segment) { if (current.length > 1) out.push(current); current = []; continue; }
    if (!current.length) current = segment;
    else if (Math.hypot(current.at(-1)[0] - segment[0][0], current.at(-1)[1] - segment[0][1]) < 1e-6) current.push(segment[1]);
    else { if (current.length > 1) out.push(current); current = segment; }
    if (Math.hypot(points[i + 1][0], points[i + 1][1]) > radius + 1e-8) { if (current.length > 1) out.push(current); current = []; }
  }
  if (current.length > 1) out.push(current);
  return out;
}

/* Sutherland–Hodgman pour anneaux contre le carré convexe de l'emprise. */
export function clipPolygonToSquare(points, radius) {
  let out = (points || []).filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (out.length > 3 && Math.hypot(out[0][0] - out.at(-1)[0], out[0][1] - out.at(-1)[1]) < 1e-8) out.pop();
  if (out.length < 3) return [];
  const edges = [
    { inside: p => p[0] >= -radius, hit: (a, b) => [ -radius, a[1] + (b[1] - a[1]) * (-radius - a[0]) / (b[0] - a[0]) ] },
    { inside: p => p[0] <= radius, hit: (a, b) => [ radius, a[1] + (b[1] - a[1]) * (radius - a[0]) / (b[0] - a[0]) ] },
    { inside: p => p[1] >= -radius, hit: (a, b) => [ a[0] + (b[0] - a[0]) * (-radius - a[1]) / (b[1] - a[1]), -radius ] },
    { inside: p => p[1] <= radius, hit: (a, b) => [ a[0] + (b[0] - a[0]) * (radius - a[1]) / (b[1] - a[1]), radius ] }
  ];
  for (const edge of edges) {
    const input = out; out = [];
    for (let i = 0; i < input.length; i++) {
      const a = input[i], b = input[(i + 1) % input.length], ai = edge.inside(a), bi = edge.inside(b);
      if (ai && bi) out.push(b);
      else if (ai && !bi) out.push(edge.hit(a, b));
      else if (!ai && bi) out.push(edge.hit(a, b), b);
    }
    if (!out.length) break;
  }
  const clean = [];
  for (const p of out) if (!clean.length || Math.hypot(p[0] - clean.at(-1)[0], p[1] - clean.at(-1)[1]) > 1e-8) clean.push(p);
  if (clean.length > 2 && Math.hypot(clean[0][0] - clean.at(-1)[0], clean[0][1] - clean.at(-1)[1]) < 1e-8) clean.pop();
  return clean.length >= 3 ? clean : [];
}

/* Découpage d'un polygone contre un disque, approché par un polygone convexe.
   Les anneaux de données gardent ainsi leur portion dans l'emprise circulaire. */
export function clipPolygonToCircle(points, radius, sides = 96) {
  let out = (points || []).filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (out.length > 3 && Math.hypot(out[0][0] - out.at(-1)[0], out[0][1] - out.at(-1)[1]) < 1e-8) out.pop();
  if (out.length < 3 || !(radius > 0)) return [];
  if (out.every(p => p[0] * p[0] + p[1] * p[1] <= radius * radius)) return out;
  const clip = Array.from({ length: Math.max(16, sides) }, (_, i) => {
    const a = 2 * Math.PI * i / Math.max(16, sides);
    return [radius * Math.cos(a), radius * Math.sin(a)];
  });
  const cross = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  for (let edge = 0; edge < clip.length && out.length; edge++) {
    const a = clip[edge], b = clip[(edge + 1) % clip.length], input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const p = input[i], q = input[(i + 1) % input.length];
      const cp = cross(a, b, p), cq = cross(a, b, q);
      const pin = cp >= -1e-8, qin = cq >= -1e-8;
      if (pin && qin) out.push(q);
      else if (pin && !qin) { const t = cp / (cp - cq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
      else if (!pin && qin) { const t = cp / (cp - cq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t], q); }
    }
  }
  const clean = [];
  for (const p of out) if (!clean.length || Math.hypot(p[0] - clean.at(-1)[0], p[1] - clean.at(-1)[1]) > 1e-6) clean.push(p);
  if (clean.length > 2 && Math.hypot(clean[0][0] - clean.at(-1)[0], clean[0][1] - clean.at(-1)[1]) < 1e-6) clean.pop();
  return clean.length >= 3 ? clean : [];
}

/* Ruban de chaussée indicatif, construit depuis l'axe OSM. Il restitue la
   largeur, mais ne fusionne pas les intersections en un seul polygone. */
export function roadSurface(points, width) {
  const line = (points || []).filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (line.length < 2 || !(Number(width) > 0)) return [];
  const half = Number(width) / 2;
  const left = [], right = [];
  for (let i = 0; i < line.length; i++) {
    const prev = line[Math.max(0, i - 1)], next = line[Math.min(line.length - 1, i + 1)];
    let dx = next[0] - prev[0], dy = next[1] - prev[1], len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const nx = -dy / len, ny = dx / len;
    let miter = half;
    if (i > 0 && i < line.length - 1) {
      const d1 = [line[i][0] - prev[0], line[i][1] - prev[1]], d2 = [next[0] - line[i][0], next[1] - line[i][1]];
      const l1 = Math.hypot(...d1) || 1, l2 = Math.hypot(...d2) || 1;
      const n1 = [-d1[1] / l1, d1[0] / l1], n2 = [-d2[1] / l2, d2[0] / l2];
      const mx = n1[0] + n2[0], my = n1[1] + n2[1], ml = Math.hypot(mx, my);
      if (ml > 1e-8) {
        const dot = Math.max(.25, Math.abs((mx / ml) * n2[0] + (my / ml) * n2[1]));
        miter = Math.min(half / dot, half * 4);
      }
    }
    left.push([line[i][0] + nx * miter, line[i][1] + ny * miter]);
    right.push([line[i][0] - nx * miter, line[i][1] - ny * miter]);
  }
  return left.length >= 2 ? [...left, ...right.reverse()] : [];
}
