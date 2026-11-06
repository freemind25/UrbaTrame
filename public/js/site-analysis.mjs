/* UrbaTrame · analyse de site (cadrage spatial)
   ─────────────────────────────────────────────────────────────────────────
   Calculs 100 % locaux, dans le navigateur, à partir des couches déjà chargées
   (OSM via /api, couches locales, relief Terrarium) et du périmètre dessiné :

     • ratios de surface par catégorie (bâti, voirie, eau, vert, équipements…),
       taux d'occupation du sol, ventilation des usages du bâti, export CSV ;
     • coupe A→B (ou polyligne quelconque) sur le relief, exagération ×1/×2/×5,
       export SVG ;
     • indicateurs complémentaires (phase A, inspirés d'urban:SCAN/ildar.space) :
       Spacematrix (GSI/OSR/FSI/N), canyons de rue, règle 3-30-300, isochrones
       piétonnes sur le graphe des voies, sky view factor, position du soleil ;
     • rapport de site PDF A4 (4 pages) avec sources et limites d'usage.

   Tout est approximatif et affiché comme tel : ni relevé cadastral, ni limite
   juridique, ni modèle certifié. Aucune requête externe : aucune fetch ici.
   ───────────────────────────────────────────────────────────────────────── */
import {
  normalizeCenter, validCoordinate, distanceMeters, toLocalMeters,
  perimeterCoordinates, perimeterStats
} from './spatial-framing-core.mjs';
import { sampleTerrain } from './terrain/topographic.mjs';

export const REPORT_LIMITS = Object.freeze({
  maxFeatures: 20000,
  maxPerimeterRadiusM: 3000,
  maxSectionPoints: 500,
  maxIsochroneMinutes: 30,
  pedestrianSpeedKmh: 5
});

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const norm360 = a => ((a % 360) + 360) % 360;

/* Catégories du rapport : un layerId OSM retombe dans exactement une catégorie. */
const CATEGORIES = [
  { key: 'buildings', label: 'Bâtiments', match: id => id === 'buildings' },
  { key: 'roads', label: 'Voirie (toutes voies)', match: id => /^(roads|pedestrian)/.test(id) },
  { key: 'green', label: 'Espaces verts', match: id => id === 'green' },
  { key: 'water', label: 'Eau', match: id => id === 'water' },
  { key: 'rail', label: 'Voies ferrées', match: id => id === 'rail' },
  { key: 'equipment', label: 'Équipements et services', match: id => id === 'equipment' },
  { key: 'transport', label: 'Transports', match: id => id === 'transport' },
  { key: 'places', label: 'Centralités et quartiers', match: id => /^(centralities|neighborhoods)/.test(id) },
  { key: 'local', label: 'Couche locale', match: id => id === 'local' }
];

const categoryOf = layerId => CATEGORIES.find(c => c.match(String(layerId || ''))) || null;

/* ─────────────── géométrie locale ─────────────── */

const ringAreaM2 = ringLocal => {
  let a = 0;
  for (let i = 0, j = ringLocal.length - 1; i < ringLocal.length; j = i++)
    a += ringLocal[j][0] * ringLocal[i][1] - ringLocal[i][0] * ringLocal[j][1];
  return Math.abs(a / 2);
};

const lineLengthM = (coords, center) => {
  if (!center) return 0;
  const local = coords.map(p => toLocalMeters(p, center));
  let total = 0;
  for (let i = 1; i < local.length; i++) total += Math.hypot(local[i][0] - local[i - 1][0], local[i][1] - local[i - 1][1]);
  return total;
};

const centroidOf = geometry => {
  if (!geometry) return null;
  if (geometry.type === 'Point') return geometry.coordinates;
  const coords = geometry.type === 'LineString' ? geometry.coordinates
    : geometry.type === 'Polygon' ? geometry.coordinates[0]
    : geometry.type === 'MultiPolygon' ? geometry.coordinates[0][0]
    : geometry.type === 'MultiLineString' ? geometry.coordinates[0] : null;
  if (!Array.isArray(coords) || !coords.length) return null;
  let lon = 0, lat = 0;
  for (const c of coords) { lon += Number(c[0]); lat += Number(c[1]); }
  return [lon / coords.length, lat / coords.length];
};

function pointInPerimeter(point, perimeter, center) {
  if (!point || !perimeter) return false;
  if (perimeter.type === 'circle') {
    const base = validCoordinate(perimeter.center) ? perimeter.center : [center.lon, center.lat];
    return distanceMeters([base[0], base[1]], point) <= Number(perimeter.radiusMeters);
  }
  const ring = perimeterCoordinates(perimeter).map(p => toLocalMeters(p, center));
  const [x, y] = toLocalMeters(point, center);
  if (ring.length < 3 || ![x, y].every(Number.isFinite)) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* Polygone (en mètres locaux) découpé par un cercle de rayon r centré à l'origine
   (Sutherland–Hodgman contre un polygone régulier à 64 segments). */
function clipPolygonToCircleLocal(points, r) {
  const cercle = [];
  for (let k = 0; k < 64; k++) {
    const a = 2 * Math.PI * k / 64;
    cercle.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  let poly = points;
  for (let k = 0; k < cercle.length; k++) {
    const [ax, ay] = cercle[k], [bx, by] = cercle[(k + 1) % cercle.length];
    const side = p => (bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax);
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const sp = side(p), sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
    poly = out;
    if (!poly.length) break;
  }
  return poly;
}

/* ─────────────── ratios de surface ─────────────── */

export function computeSiteRatios({ features = [], perimeter = null, center = null, viewRadiusM = 0 } = {}) {
  const c = normalizeCenter(center);
  if (!c) return null;
  const perimetre = perimeter || (viewRadiusM > 0
    ? { type: 'circle', center: [c.lon, c.lat], radiusMeters: viewRadiusM } : null);
  const stats = perimetre ? perimeterStats(perimetre, c) : { areaM2: 0 };
  const studyAreaM2 = stats.areaM2 || 0;

  const rows = CATEGORIES.map(cat => ({ key: cat.key, label: cat.label, count: 0, areaM2: 0, lengthM: 0, share: 0 }));
  const byKey = Object.fromEntries(rows.map(r => [r.key, r]));
  const usage = [];
  const usageIndex = new Map();
  let points = 0, featureCount = 0, totalArea = 0, totalLength = 0;

  for (const f of features.slice(0, REPORT_LIMITS.maxFeatures)) {
    const geom = f && f.geometry;
    if (!geom) continue;
    const layerId = f.properties?.layerId;
    const cat = categoryOf(layerId);
    if (!cat) continue;
    const centroid = centroidOf(geom);
    if (!centroid || (perimetre && !pointInPerimeter(centroid, perimetre, c))) continue;
    featureCount++;
    const row = byKey[cat.key];
    row.count++;
    if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') {
      const rings = geom.type === 'Polygon' ? geom.coordinates : geom.coordinates.flat();
      let area = 0;
      for (const ring of rings) {
        const local = ring.map(p => toLocalMeters(p, c));
        if (local.some(p => !p.every(Number.isFinite))) continue;
        area += ringAreaM2(local);
      }
      row.areaM2 += area;
      totalArea += area;
      if (cat.key === 'buildings') {
        const tags = f.properties || {};
        const label = tags.amenity ? `Équipement : ${tags.amenity}`
          : tags.building && tags.building !== 'yes' ? `Bâtiment : ${tags.building}`
          : 'Bâtiment (usage non précisé)';
        if (!usageIndex.has(label)) { usageIndex.set(label, { label, count: 0, areaM2: 0 }); usage.push(usageIndex.get(label)); }
        const u = usageIndex.get(label);
        u.count++;
        u.areaM2 += area;
      }
    } else if (geom.type === 'LineString' || geom.type === 'MultiLineString') {
      const lines = geom.type === 'LineString' ? [geom.coordinates] : geom.coordinates;
      let len = 0;
      for (const line of lines) len += lineLengthM(line, c);
      row.lengthM += len;
      totalLength += len;
    } else if (geom.type === 'Point' || geom.type === 'MultiPoint') {
      points += geom.type === 'Point' ? 1 : geom.coordinates.length;
    }
  }

  for (const row of rows) row.share = studyAreaM2 > 0 ? row.areaM2 / studyAreaM2 : 0;
  const builtRow = byKey.buildings;
  return {
    center: c,
    perimeterType: perimetre ? perimetre.type : null,
    studyAreaM2,
    rows,
    totals: { areaM2: totalArea, lengthM: totalLength, points, features: featureCount },
    builtCoverage: studyAreaM2 > 0 ? builtRow.areaM2 / studyAreaM2 : 0,
    featureCount,
    usage
  };
}

const fmtN = v => String(Number(Number(v).toFixed(1)));

export function ratiosToCsv(report) {
  if (!report) return '';
  const lignes = ['categorie;surface_m2;longueur_m;nombre;part_de_la_surface_pct'];
  for (const row of report.rows)
    lignes.push(`${row.label};${fmtN(row.areaM2)};${fmtN(row.lengthM)};${row.count};${(row.share * 100).toFixed(1)}`);
  lignes.push(`TOTAL;${fmtN(report.totals.areaM2)};${fmtN(report.totals.lengthM)};${report.totals.features + report.totals.points};`);
  const taux = Math.round(report.builtCoverage * 1000) / 10;
  lignes.push(`Taux d’occupation du sol (bâti / surface d’étude);${fmtN(report.totals.areaM2)};;${taux}`);
  return lignes.join('\r\n') + '\r\n';
}

export function ratiosChartSvg(report) {
  if (!report) return '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
  const W = 560, rowH = 26, top = 40;
  const surfaceRows = report.rows.filter(r => r.areaM2 > 0);
  const H = top + surfaceRows.length * rowH + 24 * Math.max(1, report.rows.filter(r => r.areaM2 === 0 && r.count > 0).length) + 30;
  const maxArea = Math.max(1, ...surfaceRows.map(r => r.areaM2));
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="sans-serif">`;
  svg += `<rect width="${W}" height="${H}" fill="#fbfcf9"/>`;
  svg += `<text x="14" y="24" font-size="14" font-weight="bold">Ratios de surface — ${fmtN(report.studyAreaM2)} m² d’emprise</text>`;
  let y = top;
  for (const row of surfaceRows) {
    const w = Math.max(2, (W - 220) * row.areaM2 / maxArea);
    svg += `<text x="14" y="${y - 6}" font-size="12">${row.label}</text>`;
    svg += `<rect x="180" y="${y - rowH + 4}" width="${w}" height="${rowH - 8}" fill="#85817b"/>`;
    svg += `<text x="${186 + w}" y="${y - 6}" font-size="11" fill="#555">${fmtN(row.areaM2)} m² · ${(row.share * 100).toFixed(1)} %</text>`;
    y += rowH;
  }
  for (const row of report.rows.filter(r => r.areaM2 === 0 && r.count > 0)) {
    svg += `<text x="14" y="${y - 6}" font-size="12" fill="#444">${row.label} : ${row.count}</text>`;
    y += 24;
  }
  svg += `<text x="14" y="${H - 10}" font-size="10" fill="#777">Taux d’occupation du sol : ${fmtN(report.builtCoverage * 100)} % · ${report.featureCount} entités dans le périmètre · approximations pédagogiques</text>`;
  svg += '</svg>';
  return svg;
}

/* ─────────────── coupe sur le relief ─────────────── */

function sampleProfile(terrain, ptsLonLat) {
  /* ptsLonLat : liste de [lon, lat] ; échantillonnage ~ tous les 10 m. */
  let lengthM = 0;
  const segLens = [];
  for (let i = 1; i < ptsLonLat.length; i++) {
    const l = distanceMeters(ptsLonLat[i - 1], ptsLonLat[i]);
    segLens.push(l);
    lengthM += l;
  }
  const nb = Math.max(2, Math.round(lengthM / 10));
  const points = [];
  for (let k = 0; k < nb; k++) {
    const target = lengthM * k / (nb - 1);
    let acc = 0, seg = 0;
    while (seg < segLens.length - 1 && acc + segLens[seg] < target) { acc += segLens[seg]; seg++; }
    const t = segLens[seg] > 0 ? (target - acc) / segLens[seg] : 0;
    const a = ptsLonLat[seg], b = ptsLonLat[seg + 1];
    const pos = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const s = sampleTerrain(terrain, pos[1], pos[0]);
    points.push({
      distanceM: target,
      elevationM: s.status === 'ok' ? s.elevation : null
    });
  }
  const vals = points.filter(p => p.elevationM !== null).map(p => p.elevationM);
  let riseM = 0, maxSlopePct = 0;
  if (vals.length >= 2) {
    riseM = vals[vals.length - 1] - vals[0];
    for (let i = 1; i < points.length; i++) {
      const p = points[i - 1], q = points[i];
      if (p.elevationM === null || q.elevationM === null) continue;
      const dd = q.distanceM - p.distanceM;
      if (dd > 0) maxSlopePct = Math.max(maxSlopePct, Math.abs(q.elevationM - p.elevationM) / dd * 100);
    }
  }
  return {
    ok: true, lengthM, points,
    samples: points.length,
    vertices: ptsLonLat,
    riseM,
    maxSlopePct,
    minElevation: vals.length ? Math.min(...vals) : null,
    maxElevation: vals.length ? Math.max(...vals) : null
  };
}

export function sectionProfile(terrain, a, b) {
  if (!terrain || !Array.isArray(terrain.grid) || !terrain.grid.length)
    return { ok: false, reason: 'terrain-not-loaded' };
  if (!validCoordinate(a) || !validCoordinate(b) || distanceMeters(a, b) < 1)
    return { ok: false, reason: 'invalid-line' };
  const r = sampleProfile(terrain, [a, b]);
  r.a = a;
  r.b = b;
  return r;
}

export function polylineProfile(terrain, points) {
  if (!terrain || !Array.isArray(terrain.grid) || !terrain.grid.length)
    return { ok: false, reason: 'terrain-not-loaded' };
  const pts = (Array.isArray(points) ? points : []).filter(validCoordinate);
  if (pts.length < 2) return { ok: false, reason: 'invalid-line' };
  return sampleProfile(terrain, pts);
}

export function profileToSvg(profile, o = {}) {
  if (!profile || !profile.ok) return '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
  const exag = Number(o.exaggeration) > 0 ? Number(o.exaggeration) : 1;
  const W = 720, H = 300, ml = 56, mr = 20, mt = 34, mb = 40;
  const pts = profile.points.filter(p => p.elevationM !== null);
  const zMin = profile.minElevation ?? 0, zMax = profile.maxElevation ?? 1;
  const span = Math.max(1e-6, zMax - zMin);
  const x = d => ml + (W - ml - mr) * d / Math.max(1e-6, profile.lengthM);
  const y = z => mt + (H - mt - mb) * (1 - (z - zMin) / span / exag * 1 - (1 - 1 / (1 + (exag - 1)))) * 1 || 0;
  /* échelle verticale exagérée : on étire la plage d'affichage d'un facteur exag */
  const yScale = (H - mt - mb) / (span * Math.max(1, exag) * 1.15);
  const py = z => H - mb - (z - zMin) * yScale * 1;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="sans-serif">`;
  svg += `<rect width="${W}" height="${H}" fill="#fbfcf9"/>`;
  svg += `<text x="${ml}" y="22" font-size="14" font-weight="bold">COUPE · A→B · ${fmtN(profile.lengthM)} m · pente max ${profile.maxSlopePct.toFixed(1)} %</text>`;
  /* cadre et graduations */
  svg += `<rect x="${ml}" y="${mt}" width="${W - ml - mr}" height="${H - mt - mb}" fill="#ffffff" stroke="#c9d2c9"/>`;
  for (let k = 0; k <= 4; k++) {
    const d = profile.lengthM * k / 4;
    svg += `<line x1="${x(d)}" y1="${H - mb}" x2="${x(d)}" y2="${H - mb + 5}" stroke="#8a948a"/>`;
    svg += `<text x="${x(d)}" y="${H - mb + 17}" font-size="10" text-anchor="middle" fill="#667">${fmtN(d)} m</text>`;
  }
  for (let k = 0; k <= 3; k++) {
    const z = zMin + span * k / 3;
    svg += `<line x1="${ml}" y1="${py(z)}" x2="${ml - 5}" y2="${py(z)}" stroke="#8a948a"/>`;
    svg += `<text x="${ml - 8}" y="${py(z) + 3}" font-size="10" text-anchor="end" fill="#667">${fmtN(z)} m</text>`;
  }
  const line = pts.map(p => `${x(p.distanceM).toFixed(1)},${py(p.elevationM).toFixed(1)}`).join(' ');
  svg += `<polyline points="${line}" fill="none" stroke="#153e3d" stroke-width="2"/>`;
  svg += `<text x="${ml}" y="${H - 8}" font-size="10" fill="#777">Relief Terrarium indicatif · ${pts.length} échantillons${exag > 1 ? '' : ' · échelle verticale ×1'}</text>`;
  if (exag > 1) svg += `<text x="${W - mr}" y="22" font-size="11" text-anchor="end" fill="#8a5a00">Exagération verticale ×${exag}</text>`;
  svg += '</svg>';
  return svg;
}

/* ─────────────── indicateurs complémentaires (phase A) ─────────────── */

export function estimateHeightM(tags = {}) {
  const h = parseFloat(String(tags.height || '').replace(/m$/i, '').trim());
  if (Number.isFinite(h) && h > 0) return h;
  const lv = parseFloat(tags['building:levels']);
  if (Number.isFinite(lv) && lv > 0) return lv * 3;
  return null;
}

export function estimateLevels(tags = {}) {
  const lv = parseFloat(tags['building:levels']);
  if (Number.isFinite(lv) && lv > 0) return Math.round(lv);
  const h = parseFloat(String(tags.height || '').replace(/m$/i, '').trim());
  if (Number.isFinite(h) && h > 0) return Math.max(1, Math.round(h / 3));
  return null;
}

export function computeSpacematrix({ features = [], center = null, studyAreaM2 = 0, roadLengthM = 0, perimeter = null } = {}) {
  const c = normalizeCenter(center);
  if (!c || !(studyAreaM2 > 0)) return null;
  let buildings = 0, builtAreaM2 = 0, floorAreaM2 = 0;
  for (const f of features) {
    if (categoryOf(f.properties?.layerId)?.key !== 'buildings') continue;
    const geom = f.geometry;
    if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) continue;
    const centroid = centroidOf(geom);
    if (perimeter && centroid && !pointInPerimeter(centroid, perimeter, c)) continue;
    const rings = geom.type === 'Polygon' ? geom.coordinates : geom.coordinates.flat();
    let area = 0;
    for (const ring of rings) {
      const local = ring.map(p => toLocalMeters(p, c));
      if (local.some(p => !p.every(Number.isFinite))) continue;
      area += ringAreaM2(local);
    }
    buildings++;
    builtAreaM2 += area;
    floorAreaM2 += area * (estimateLevels(f.properties || {}) || 1);
  }
  floorAreaM2 = Math.round(floorAreaM2 * 1e6) / 1e6;
  builtAreaM2 = Math.round(builtAreaM2 * 1e6) / 1e6;
  const gsi = builtAreaM2 / studyAreaM2;
  return {
    buildings, builtAreaM2, floorAreaM2,
    gsi,
    osr: 1 - gsi,
    fsi: floorAreaM2 / studyAreaM2,
    networkDensityKmPerKm2: studyAreaM2 > 0 ? (roadLengthM / 1000) / (studyAreaM2 / 1e6) : 0,
    studyAreaM2
  };
}

const ROAD_WIDTH_M = {
  motorway: 24, trunk: 20, primary: 16, secondary: 12, tertiary: 10,
  residential: 8, living_street: 6, unclassified: 8, service: 6,
  pedestrian: 6, footway: 4, cycleway: 4, path: 3
};

function distancePointToSegmentM(p, a, b) {
  const [px, py] = p, [ax, ay] = a, [bx, by] = b;
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

export function streetCanyons({ features = [], center = null, perimeter = null } = {}) {
  const c = normalizeCenter(center);
  if (!c) return [];
  const roads = [], buildings = [];
  for (const f of features) {
    const cat = categoryOf(f.properties?.layerId);
    if (!cat) continue;
    const geom = f.geometry;
    if (!geom) continue;
    const centroid = centroidOf(geom);
    if (perimeter && centroid && !pointInPerimeter(centroid, perimeter, c)) continue;
    if (cat.key === 'roads' && geom.type === 'LineString')
      roads.push({ feature: f, local: geom.coordinates.map(p => toLocalMeters(p, c)) });
    else if (cat.key === 'buildings' && (geom.type === 'Polygon' || geom.type === 'MultiPolygon'))
      buildings.push({ feature: f, centroid: toLocalMeters(centroid, c) });
  }
  const out = [];
  for (const road of roads) {
    const tags = road.feature.properties || {};
    const wTag = parseFloat(String(tags.width || '').replace(/m$/i, '').trim());
    const widthM = Number.isFinite(wTag) && wTag > 0 ? wTag : (ROAD_WIDTH_M[tags.highway] || 8);
    const adjacents = buildings.filter(b => {
      if (!b.centroid.every(Number.isFinite)) return false;
      let min = Infinity;
      const line = road.local;
      for (let i = 1; i < line.length; i++)
        min = Math.min(min, distancePointToSegmentM(b.centroid, line[i - 1], line[i]));
      return min <= 30;
    });
    if (!adjacents.length) continue;
    const heights = adjacents.map(b => estimateHeightM(b.feature.properties || {}) ?? 6);
    const avgHeightM = heights.reduce((a, h) => a + h, 0) / heights.length;
    const ratio = avgHeightM / widthM;
    out.push({
      layerId: road.feature.properties?.layerId,
      name: tags.name || '',
      highway: tags.highway || '',
      widthM,
      avgHeightM,
      ratio,
      class: ratio >= 2 ? 'canyon étroit' : ratio >= 1 ? 'rue encaissée' : 'rue large',
      buildings: adjacents.length
    });
  }
  return out;
}

export function threeThirtyThreeHundred({ features = [], center = null } = {}) {
  const c = normalizeCenter(center);
  if (!c) return { trees: 0, canopyPct: 0, parkDistanceM: null, checks: { trees3: false, canopy30: false, park300: false } };
  const R = 300;
  let trees = 0, canopyM2 = 0, parkDistanceM = null;
  for (const f of features) {
    const geom = f.geometry;
    if (!geom) continue;
    const tags = f.properties || {};
    if (geom.type === 'Point' && tags.natural === 'tree') {
      if (distanceMeters([c.lon, c.lat], geom.coordinates) <= R) trees++;
      continue;
    }
    if (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon') continue;
    const isCanopy = tags.natural === 'wood' || tags.natural === 'forest' || tags.natural === 'scrub' ||
      tags.leisure === 'park' || tags.leisure === 'garden' || tags.landuse === 'forest';
    const isPark = tags.leisure === 'park' || tags.leisure === 'garden' || tags.natural === 'wood';
    const rings = geom.type === 'Polygon' ? geom.coordinates : geom.coordinates.flat();
    const local = rings[0]?.map(p => toLocalMeters(p, c));
    if (!local || local.some(p => !p.every(Number.isFinite))) continue;
    if (isCanopy) {
      const clipped = clipPolygonToCircleLocal(local, R);
      if (clipped.length >= 3) canopyM2 += ringAreaM2(clipped);
    }
    if (isPark) {
      const centroid = centroidOf(geom);
      const d = centroid ? distanceMeters([c.lon, c.lat], centroid) : Infinity;
      if (d < (parkDistanceM ?? Infinity)) parkDistanceM = d;
    }
  }
  const canopyPct = (canopyM2 / (Math.PI * R * R)) * 100;
  return {
    trees,
    canopyPct,
    parkDistanceM,
    checks: { trees3: trees >= 3, canopy30: canopyPct >= 30, park300: parkDistanceM !== null && parkDistanceM <= R }
  };
}

export function pedestrianIsochrones({ features = [], center = null } = {}) {
  const c = normalizeCenter(center);
  if (!c) return { ok: false, reason: 'invalid-center' };
  const speed = REPORT_LIMITS.pedestrianSpeedKmh * 1000 / 3600;   // m/s
  const edges = [];
  const nodeIndex = new Map();
  const nodePos = [];
  const node = p => {
    const key = `${Number(p[0]).toFixed(6)},${Number(p[1]).toFixed(6)}`;
    if (!nodeIndex.has(key)) {
      nodeIndex.set(key, nodePos.length);
      nodePos.push(p);
    }
    return nodeIndex.get(key);
  };
  for (const f of features) {
    const cat = categoryOf(f.properties?.layerId);
    if (cat?.key !== 'roads' || f.geometry?.type !== 'LineString') continue;
    const coords = f.geometry.coordinates;
    for (let i = 1; i < coords.length; i++) {
      const u = node(coords[i - 1]), v = node(coords[i]);
      const len = distanceMeters(coords[i - 1], coords[i]);
      if (u !== v && len > 0) edges.push({ u, v, len });
    }
  }
  if (!edges.length) return { ok: false, reason: 'no-roads' };
  /* départ : le nœud le plus proche du centre */
  let start = 0, best = Infinity;
  nodePos.forEach((p, k) => {
    const d = distanceMeters([c.lon, c.lat], p);
    if (d < best) { best = d; start = k; }
  });
  /* Dijkstra (graphe petit : O(n²) suffit) */
  const n = nodePos.length;
  const dist = new Array(n).fill(Infinity);
  dist[start] = 0;
  const vu = new Array(n).fill(false);
  for (let it = 0; it < n; it++) {
    let u = -1, du = Infinity;
    for (let k = 0; k < n; k++) if (!vu[k] && dist[k] < du) { du = dist[k]; u = k; }
    if (u < 0) break;
    vu[u] = true;
    for (const e of edges)
      if (e.u === u && dist[e.v] > du + e.len) dist[e.v] = du + e.len;
      else if (e.v === u && dist[e.u] > du + e.len) dist[e.u] = du + e.len;
  }
  const pois = features.filter(f => {
    const cat = categoryOf(f.properties?.layerId);
    return cat && cat.key !== 'roads' && cat.key !== 'buildings' && f.geometry?.type === 'Point';
  });
  const times = [5, 10, 15].map(minutes => {
    const budget = minutes * 60 * speed;
    let reachableLengthM = 0;
    for (const e of edges) {
      const ru = Math.max(0, Math.min(e.len, budget - dist[e.u]));
      const rv = Math.max(0, Math.min(e.len, budget - dist[e.v]));
      reachableLengthM += Math.min(e.len, ru + rv);
    }
    const count = pois.filter(f => {
      let bestNode = 0, bestD = Infinity;
      nodePos.forEach((p, k) => {
        const d = dist[k] + distanceMeters(p, f.geometry.coordinates);
        if (d < bestD) { bestD = d; bestNode = k; }
      });
      return bestD / speed <= minutes * 60;
    }).length;
    return { minutes, reachableLengthM, pois: count };
  });
  const highlight = edges.map(e => ({
    u: e.u, v: e.v, len: e.len,
    reachMin: Math.min(dist[e.u], dist[e.v]) / speed / 60
  }));
  return { ok: true, nodes: n, edges, times, highlight, speedKmh: REPORT_LIMITS.pedestrianSpeedKmh, start };
}

export function skyViewFactor(terrain, lat, lon) {
  if (!terrain || !Array.isArray(terrain.grid) || terrain.grid.length < 2)
    return { ok: false, reason: 'terrain-not-loaded' };
  const n = terrain.grid.length;
  const radius = Number(terrain.radius) || 600;
  const mPerCell = 2 * radius / (n - 1);
  const dy = radius / 111320;
  const dx = dy / Math.cos(Number(terrain.lat) * D2R);
  const latTop = Number(terrain.lat) + dy, lonLeft = Number(terrain.lon) - dx;
  const at = (i, j) => terrain.grid[Math.max(0, Math.min(n - 1, Math.round(j)))][Math.max(0, Math.min(n - 1, Math.round(i)))];
  const colOf = lo => Math.max(0, Math.min(n - 1, (lo - lonLeft) / (2 * dx) * (n - 1)));
  const rowOf = la => Math.max(0, Math.min(n - 1, (latTop - la) / (2 * dy) * (n - 1)));
  const i0 = colOf(lon), j0 = rowOf(lat);
  const z0 = at(i0, j0);
  let svf = 0;
  const NB_RAYS = 16;
  for (let k = 0; k < NB_RAYS; k++) {
    const az = 2 * Math.PI * k / NB_RAYS;
    const ex = Math.sin(az), ey = Math.cos(az);      // composante est / nord
    let horizon = 0;
    for (let step = 0.5; step < n; step += 0.5) {
      const i = i0 + ex * step, j = j0 - ey * step;   // j croît vers le sud
      if (i < 0 || j < 0 || i >= n || j >= n) break;
      const z = at(i, j);
      const distM = step * mPerCell;
      horizon = Math.max(horizon, (z - z0) / distM);
    }
    const angle = Math.atan(Math.max(0, horizon));
    svf += Math.cos(angle) * Math.cos(angle);
  }
  svf /= NB_RAYS;
  return { ok: true, svf, lat, lon, cells: n };
}

/* Position du soleil (éphéméride abrégée, même modèle que la vue 3D). */
export function sunPosition(lat, lon, date) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = norm360(280.460 + 0.9856474 * n);
  const g = norm360(357.528 + 0.9856003 * n) * D2R;
  const lambda = norm360(L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * D2R;
  const eps = (23.439 - 4e-7 * n) * D2R;
  const decl = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const alpha = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const gmst = norm360(280.46061837 + 360.98564736629 * n) * D2R;
  let H = gmst + lon * D2R - alpha;
  H = ((H + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  const phi = lat * D2R;
  const up = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(H);
  const east = -Math.cos(decl) * Math.sin(H);
  const north = Math.cos(phi) * Math.sin(decl) - Math.sin(phi) * Math.cos(decl) * Math.cos(H);
  return {
    elevationDeg: Math.asin(Math.max(-1, Math.min(1, up))) * R2D,
    azimuthDeg: norm360(Math.atan2(east, north) * R2D)
  };
}

/* ─────────────── rapport PDF A4 (4 pages, écrit à la main, sans dépendance) ─────────────── */

const pdfSanitize = s => String(s)
  .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
  .replace(/\u2014|\u2013/g, '-').replace(/[^\x00-\xff]/g, '?');

const pdfEscape = s => pdfSanitize(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

function pdfTextStream(lines) {
  const out = ['BT', '/F1 10 Tf', '14 TL'];
  for (const line of lines) {
    if (line === null) { out.push('ET', 'BT', '/F1 10 Tf', '14 TL'); continue; }
    const [size, x, y, text, bold] = line;
    out.push(`/F${bold ? 2 : 1} ${size} Tf`, `${x} ${y} Td`, `(${pdfEscape(text)}) Tj`);
  }
  out.push('ET');
  return out.join('\n');
}

/* Construit un PDF 1.4 valide (xref + startxref) à 4 pages A4 portrait. */
export function buildSiteReportPdf(report) {
  if (!report || !Array.isArray(report.rows)) {
    const e = new Error('REPORT_REQUIRED');
    e.code = 'REPORT_REQUIRED';
    throw e;
  }
  const pct = v => `${(v * 100).toFixed(1)} %`;
  const page1 = [
    [22, 40, 800, report.title || 'Rapport de site', true],
    [11, 40, 776, `Projet : ${report.projectName || '-'}`, false],
    [11, 40, 762, `Centre : ${report.centerName || '-'} (${Number(report.center?.lat).toFixed(5)}, ${Number(report.center?.lon).toFixed(5)})`, false],
    [11, 40, 748, `Date : ${report.dateText || '-'}`, false],
    [11, 40, 734, `Périmètre : ${report.perimeterLabel || '-'}${report.perimeterType ? ' (' + report.perimeterType + ')' : ''}`, false],
    [13, 40, 700, 'Cadrage', true],
    [11, 40, 680, `Surface d'étude : ${fmtN(report.studyAreaM2)} m² (${(report.studyAreaM2 / 10000).toFixed(2)} ha)`, false],
    [11, 40, 666, `Entités retenues dans le périmètre : ${report.featureCount}`, false],
    [11, 40, 652, `Taux d'occupation du sol (bâti / surface d'étude) : ${pct(report.builtCoverage)}`, false],
    [11, 40, 630, `Sources : OpenStreetMap (ODbL) via /api, couches locales, ${/glo-?30/i.test(report.reliefSource || '') ? 'relief Copernicus GLO-30 (AWS Open Data, ~30 m)' : 'relief Terrarium (SRTM/USGS/EU-DEM)'}.`, false],
    [11, 40, 616, 'Analyse calculée localement dans le navigateur ; aucune donnée transmise.', false]
  ];
  const page2 = [
    [13, 40, 800, 'Ratios de surface par catégorie', true]
  ];
  let y = 776;
  for (const row of report.rows) {
    page2.push([10, 40, y, `${row.label} : ${fmtN(row.areaM2)} m² · ${fmtN(row.lengthM)} m · ${row.count} entité(s) · ${pct(row.share)}`]);
    y -= 16;
  }
  page2.push([10, 40, y - 6, `TOTAL : ${fmtN(report.totals?.areaM2 || 0)} m² · ${fmtN(report.totals?.lengthM || 0)} m · ${report.totals?.points || 0} point(s)`]);
  y -= 34;
  page2.push([13, 40, y, 'Usages du bâti', true]);
  y -= 20;
  for (const u of report.usage || []) {
    page2.push([10, 40, y, `${u.label} : ${u.count} bâtiment(s) · ${fmtN(u.areaM2)} m²`]);
    y -= 16;
  }
  const page3 = [
    [13, 40, 800, 'Coupe et indicateurs complémentaires', true]
  ];
  y = 778;
  if (report.profile && report.profile.ok) {
    page3.push([10, 40, y, `Coupe A→B : ${fmtN(report.profile.lengthM)} m · montée ${fmtN(report.profile.riseM)} m · pente max ${report.profile.maxSlopePct.toFixed(1)} % · ${report.profile.samples} échantillons`]);
    y -= 16;
  } else {
    page3.push([10, 40, y, 'Coupe A→B : non tracée (relief non chargé ou ligne invalide).']);
    y -= 16;
  }
  const ind = report.indicators || {};
  if (ind.spacematrix) {
    const sm = ind.spacematrix;
    page3.push([10, 40, y, `Spacematrix : GSI ${pct(sm.gsi)} · OSR ${pct(sm.osr)} · FSI ${sm.fsi.toFixed(2)} · N ${sm.networkDensityKmPerKm2.toFixed(2)} km/km² · ${sm.buildings} bâtiments`]);
    y -= 16;
  }
  if (ind.canyons && ind.canyons.length) {
    for (const c of ind.canyons.slice(0, 6)) {
      page3.push([10, 40, y, `Canyon de rue (${c.highway || c.layerId}) : largeur ${fmtN(c.widthM)} m · hauteur moy. ${fmtN(c.avgHeightM)} m · ratio ${c.ratio.toFixed(2)} · ${c.class}`]);
      y -= 16;
    }
  }
  if (ind.threeThirtyThreeHundred) {
    const t = ind.threeThirtyThreeHundred;
    page3.push([10, 40, y, `Règle 3-30-300 : ${t.trees} arbre(s) à 300 m · canopée ${t.canopyPct.toFixed(1)} % · parc à ${t.parkDistanceM === null ? '—' : fmtN(t.parkDistanceM) + ' m'}`]);
    y -= 16;
  }
  if (ind.isochrones && ind.isochrones.ok) {
    for (const t of ind.isochrones.times)
      page3.push([10, 40, y, `Isochrone piéton ${t.minutes} min (5 km/h) : ${fmtN(t.reachableLengthM)} m de voirie atteignables · ${t.pois} équipement(s)`]);
    y -= 16;
  } else if (ind.isochrones) {
    page3.push([10, 40, y, `Isochrones : ${ind.isochrones.reason || 'indisponible'}`]);
    y -= 16;
  }
  if (ind.skyView) page3.push([10, 40, y, `Sky view factor au centre : ${ind.skyView.ok ? ind.skyView.svf.toFixed(2) : 'n/a'} (approximation DEM)`]), y -= 16;
  if (ind.sun) page3.push([10, 40, y, `Soleil : élévation ${ind.sun.elevationDeg.toFixed(1)}° · azimut ${ind.sun.azimuthDeg.toFixed(0)}°`]), y -= 16;
  if (ind.spaceSyntax) {
    if (ind.spaceSyntax.ok) {
      const sx = ind.spaceSyntax;
      page3.push([10, 40, y, `Space syntax simplifié (approximation pédagogique) : ${sx.nodes} nœuds, ${sx.edges} tronçons, RA moyen ${sx.meanRA}, intégration moyenne ${sx.meanIntegration}.`]);
      y -= 16;
      for (const e of sx.topEdges.slice(0, 3)) {
        page3.push([10, 40, y, `  axe le plus intégré : « ${e.name || e.highway || 'sans nom'} » · ${fmtN(e.lenM)} m · score ${e.score}`]);
        y -= 16;
      }
    } else {
      page3.push([10, 40, y, `Space syntax simplifié : non calculé (${ind.spaceSyntax.reason}).`]);
      y -= 16;
    }
  }
  const page4 = [
    [13, 40, 800, 'Sources et limites d’usage', true],
    [10, 40, 776, `Données : OpenStreetMap (© contributeurs OSM, ODbL), relief ${/glo-?30/i.test(report.reliefSource || '') ? 'Copernicus GLO-30/AWS Open Data (~30 m)' : 'Terrarium/AWS (SRTM/USGS/EU-DEM selon couverture)'},`, false],
    [10, 40, 762, 'couches locales importées par l’utilisateur. Toutes les analyses sont calculées localement, hors ligne.', false],
    [11, 40, 736, 'Limites', true],
    [10, 40, 716, '- Les mesures sont des approximations pédagogiques : ni relevé cadastral, ni limite juridique.', false],
    [10, 40, 702, '- Le relief Terrarium est indicatif (« computed, not surveyed ») ; pente, TWI, hydrologie D8 et', false],
    [10, 40, 688, '  isochrones et space syntax simplifié sont des simulations/approximations, non certifiées.', false],
    [10, 40, 674, '- Hauteurs de bâti : tag OSM height, sinon building:levels × 3 m, sinon valeur par défaut.', false],
    [10, 40, 660, '- Aucune donnée personnelle transmise ; aucun appel réseau externe depuis cette page.', false],
    [10, 40, 640, 'Généré par UrbaTrame — page Cadrage spatial.' ]
  ];
  const contents = [pdfTextStream(page1), pdfTextStream(page2), pdfTextStream(page3), pdfTextStream(page4)];

  const objets = [];
  objets[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objets[2] = '<< /Type /Pages /Kids [4 0 R 5 0 R 6 0 R 7 0 R] /Count 4 >>';
  objets[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  objets[8] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';
  for (let p = 0; p < 4; p++) {
    const pageObj = 4 + p, contentObj = 9 + p;
    objets[pageObj] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 8 0 R >> >> /Contents ${contentObj} 0 R >>`;
    const stream = contents[p];
    objets[contentObj] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
  }

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 1; i < objets.length; i++) {
    offsets[i] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${i} 0 obj\n${objets[i]}\nendobj\n`;
  }
  const xrefPos = Buffer.byteLength(pdf, 'latin1');
  let xref = `xref\n0 ${objets.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objets.length; i++)
    xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  pdf += xref + `trailer\n<< /Size ${objets.length} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
