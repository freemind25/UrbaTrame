/* UrbaTrame · indicateurs de site et scénario de faisabilité
   Calculs locaux à partir des couches OSM déjà chargées et des séries
   NASA POWER / Terrarium déjà utilisées par l'application. Le scénario de
   capacité ne déduit aucun règlement : toutes ses hypothèses sont saisies
   explicitement par l'utilisateur. */

const EARTH_METERS_PER_DEGREE = 111320;

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function geoPoint(point) {
  if (Array.isArray(point)) return { lat: finite(point[0], NaN), lon: finite(point[1], NaN) };
  return {
    lat: finite(point?.lat, NaN),
    lon: finite(point?.lon ?? point?.lng, NaN)
  };
}

function localPoint(point, center) {
  const p = geoPoint(point);
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return null;
  return {
    x: (p.lon - center.lon) * EARTH_METERS_PER_DEGREE * center.cosLat,
    y: (p.lat - center.lat) * EARTH_METERS_PER_DEGREE
  };
}

function openRing(geometry, center) {
  if (!Array.isArray(geometry)) return [];
  const points = geometry.map(p => localPoint(p, center)).filter(Boolean);
  if (points.length > 1) {
    const a = points[0], b = points.at(-1);
    if (Math.hypot(a.x - b.x, a.y - b.y) < 0.01) points.pop();
  }
  return points;
}

function ringStats(points) {
  if (!Array.isArray(points) || points.length < 3) return { area: 0, x: 0, y: 0 };
  let twiceArea = 0, cx = 0, cy = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const cross = a.x * b.y - b.x * a.y;
    twiceArea += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  if (Math.abs(twiceArea) < 1e-8) {
    return {
      area: 0,
      x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
      y: points.reduce((sum, p) => sum + p.y, 0) / points.length
    };
  }
  return { area: Math.abs(twiceArea) / 2, x: cx / (3 * twiceArea), y: cy / (3 * twiceArea) };
}

function pointInRing(point, ring) {
  if (ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    const crosses = (a.y > point.y) !== (b.y > point.y) &&
      point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function makeExtent({ center, radius, shape, polygon }) {
  const custom = openRing(polygon, center);
  const hasPolygon = custom.length >= 3;
  let areaM2;
  if (hasPolygon) areaM2 = ringStats(custom).area;
  else if (shape === 'square' || shape === 'rect') areaM2 = (radius * 2) ** 2;
  else areaM2 = Math.PI * radius ** 2;

  function contains(point) {
    if (hasPolygon) return pointInRing(point, custom);
    if (shape === 'square' || shape === 'rect') return Math.abs(point.x) <= radius && Math.abs(point.y) <= radius;
    return Math.hypot(point.x, point.y) <= radius;
  }
  return { areaM2, contains, custom, hasPolygon };
}

function segmentLengthInCircle(a, b, radius) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const A = dx * dx + dy * dy;
  if (A < 1e-12) return 0;
  const B = 2 * (a.x * dx + a.y * dy);
  const C = a.x * a.x + a.y * a.y - radius * radius;
  const discriminant = B * B - 4 * A * C;
  if (discriminant < 0) return C <= 0 ? Math.sqrt(A) : 0;
  const root = Math.sqrt(discriminant);
  const lo = Math.max(0, (-B - root) / (2 * A));
  const hi = Math.min(1, (-B + root) / (2 * A));
  return hi > lo ? Math.sqrt(A) * (hi - lo) : 0;
}

function segmentLengthInSquare(a, b, radius) {
  const dx = b.x - a.x, dy = b.y - a.y;
  let lo = 0, hi = 1;
  for (const [p, q] of [
    [-dx, a.x + radius], [dx, radius - a.x],
    [-dy, a.y + radius], [dy, radius - a.y]
  ]) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return 0;
      continue;
    }
    const t = q / p;
    if (p < 0) lo = Math.max(lo, t);
    else hi = Math.min(hi, t);
    if (hi <= lo) return 0;
  }
  return Math.hypot(dx, dy) * (hi - lo);
}

function lineLengthInExtent(geometry, center, extent, radius, shape) {
  const points = (Array.isArray(geometry) ? geometry : []).map(p => localPoint(p, center)).filter(Boolean);
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (!extent.hasPolygon && (shape === 'square' || shape === 'rect')) {
      length += segmentLengthInSquare(a, b, radius);
    } else if (!extent.hasPolygon) {
      length += segmentLengthInCircle(a, b, radius);
    } else {
      const segment = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.max(1, Math.ceil(segment / 10));
      for (let j = 0; j < steps; j++) {
        const f = (j + 0.5) / steps;
        const sample = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
        if (extent.contains(sample)) length += segment / steps;
      }
    }
  }
  return length;
}

function seriesValues(series) {
  const values = Array.isArray(series) ? series : Object.values(series || {});
  return values.filter(v => v != null && v !== '' && Number.isFinite(Number(v)))
    .map(Number).filter(v => v > -900);
}

function mean(values) {
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
}

function climateSummary(climate) {
  const p = climate?.params || {};
  const tmax = seriesValues(p.T2M_MAX);
  const tmin = seriesValues(p.T2M_MIN);
  const rain = seriesValues(p.PRECTOTCORR);
  const wind = seriesValues(p.WS10M);
  const solar = seriesValues(p.ALLSKY_SFC_SW_DWN);
  const rainDaily = mean(rain);
  return {
    source: climate?.source || (climate ? 'NASA POWER' : ''),
    days: Math.max(tmax.length, tmin.length, rain.length, wind.length, solar.length),
    meanMaxC: mean(tmax),
    meanMinC: mean(tmin),
    estimatedAnnualRainMm: rainDaily == null ? null : rainDaily * 365,
    meanWind10mMs: mean(wind),
    meanSolarKwhM2Day: mean(solar)
  };
}

function terrainSummary(terrain) {
  const values = (terrain?.grid || []).flat()
    .filter(v => v != null && v !== '' && Number.isFinite(Number(v))).map(Number);
  if (!values.length) return { source: '', minM: null, maxM: null, reliefM: null, samples: 0 };
  const minM = Math.min(...values), maxM = Math.max(...values);
  return {
    source: 'Terrarium · SRTM/USGS', minM, maxM,
    reliefM: maxM - minM, samples: values.length
  };
}

function countCategories(points) {
  const counts = new Map();
  for (const p of points) {
    const category = String(p.a || p.s || p.l || p.to || '').trim();
    if (category) counts.set(category, (counts.get(category) || 0) + 1);
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 8);
}

/** Calcule des métriques transparentes, à l'échelle de l'emprise d'analyse. */
export function summarizeSite({
  D = {}, terrain = null, climate = null, lat = 0, lon = 0,
  radius = 600, shape = 'circle', polygon = null
} = {}) {
  const centerLat = finite(lat), centerLon = finite(lon);
  const r = Math.max(1, finite(radius, 600));
  const center = {
    lat: centerLat,
    lon: centerLon,
    cosLat: Math.max(1e-6, Math.cos(centerLat * Math.PI / 180))
  };
  const extent = makeExtent({ center, radius: r, shape, polygon });

  let buildingCount = 0, buildingAreaM2 = 0, knownHeightCount = 0;
  let knownHeightTotalM = 0, knownHeightMaxM = null, knownVolumeM3 = 0;
  for (const building of D.build || []) {
    const ring = openRing(building.g, center), stats = ringStats(ring);
    if (!stats.area || !extent.contains({ x: stats.x, y: stats.y })) continue;
    buildingCount++;
    buildingAreaM2 += stats.area;
    const h = finite(building.h);
    if (h > 0) {
      knownHeightCount++;
      knownHeightTotalM += h;
      knownHeightMaxM = knownHeightMaxM == null ? h : Math.max(knownHeightMaxM, h);
      knownVolumeM3 += stats.area * h;
    }
  }

  let greenCount = 0, greenAreaM2 = 0, waterCount = 0, waterAreaM2 = 0, landuseCount = 0;
  for (const feature of D.green || []) {
    const ring = openRing(feature.g, center), stats = ringStats(ring);
    if (!stats.area || !extent.contains({ x: stats.x, y: stats.y })) continue;
    if (feature.k === 'g') { greenCount++; greenAreaM2 += stats.area; }
    else if (feature.k === 'w') { waterCount++; waterAreaM2 += stats.area; }
    else if (feature.k === 'l') landuseCount++;
  }

  const points = (D.pois || []).filter(p => {
    const point = localPoint([p.y, p.x], center);
    return point && extent.contains(point);
  });
  const transitCount = points.filter(p => p.k === 'transit').length;
  const amenityCount = points.filter(p => p.k !== 'transit').length;
  let roadLengthM = 0, roadCount = 0;
  for (const road of D.roads || []) {
    const lengthM = lineLengthInExtent(road.g, center, extent, r, shape);
    if (lengthM > 0) roadCount++;
    roadLengthM += lengthM;
  }

  return {
    areaM2: extent.areaM2,
    shape: extent.hasPolygon ? 'polygon' : (shape === 'square' || shape === 'rect' ? 'square' : 'circle'),
    buildings: {
      count: buildingCount,
      footprintM2: buildingAreaM2,
      coveragePct: extent.areaM2 ? buildingAreaM2 / extent.areaM2 * 100 : 0,
      heightsKnown: knownHeightCount,
      heightsKnownPct: buildingCount ? knownHeightCount / buildingCount * 100 : 0,
      meanKnownHeightM: knownHeightCount ? knownHeightTotalM / knownHeightCount : null,
      maxKnownHeightM: knownHeightMaxM,
      knownVolumeM3
    },
    green: {
      count: greenCount,
      areaM2: greenAreaM2,
      coveragePct: extent.areaM2 ? greenAreaM2 / extent.areaM2 * 100 : 0
    },
    water: {
      count: waterCount,
      areaM2: waterAreaM2,
      coveragePct: extent.areaM2 ? waterAreaM2 / extent.areaM2 * 100 : 0
    },
    landuseCount,
    roads: { count: roadCount, lengthM: roadLengthM },
    points: { total: points.length, amenities: amenityCount, transit: transitCount, categories: countCategories(points) },
    terrain: terrainSummary(terrain),
    climate: climateSummary(climate)
  };
}

/** Scénario de capacité indicatif : aucune règle n'est fournie ou déduite. */
export function calculateFeasibility({
  siteAreaM2, far, coveragePct, floors, costPerM2 = null
} = {}) {
  const area = Number(siteAreaM2), ratio = Number(far), coverage = Number(coveragePct), levels = Number(floors);
  if (![area, ratio, coverage, levels].every(Number.isFinite) || area <= 0 || area > 1e9 || ratio < 0 || ratio > 100 || coverage < 0 || coverage > 100 || levels <= 0 || levels > 300)
    return null;
  const areaByFarM2 = area * ratio;
  const footprintLimitM2 = area * coverage / 100;
  const areaByCoverageM2 = footprintLimitM2 * levels;
  const floorAreaM2 = Math.min(areaByFarM2, areaByCoverageM2);
  const footprintM2 = Math.min(footprintLimitM2, floorAreaM2 / levels);
  const cost = costPerM2 == null || costPerM2 === '' ? null : Number(costPerM2);
  if (cost != null && (!Number.isFinite(cost) || cost < 0 || cost > 1e12)) return null;
  return {
    areaByFarM2,
    footprintLimitM2,
    areaByCoverageM2,
    floorAreaM2,
    footprintM2,
    bindingConstraint: areaByFarM2 <= areaByCoverageM2 ? 'far' : 'coverage',
    costEstimate: cost == null ? null : floorAreaM2 * cost
  };
}
