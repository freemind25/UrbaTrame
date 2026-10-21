import { extentOfFeatures, positionsInGeometry } from './local-layers.mjs';

const EARTH_RADIUS_METRES = 6_371_008.8;
const RADIANS = Math.PI / 180;

function haversine(a, b) {
  const lat1 = a[1] * RADIANS, lat2 = b[1] * RADIANS;
  const dLat = lat2 - lat1, dLon = (b[0] - a[0]) * RADIANS;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function greatCircleDistanceMeters(a, b) {
  return haversine(a, b);
}

function lineLength(line) {
  let length = 0;
  for (let i = 1; i < line.length; i++) length += haversine(line[i - 1], line[i]);
  return length;
}

function ringArea(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return 0;
  const lat0 = ring.reduce((sum, point) => sum + point[1], 0) / ring.length * RADIANS;
  const lon0 = ring[0][0] * RADIANS, latOrigin = ring[0][1] * RADIANS;
  const xy = ring.map(([lon, lat]) => [
    (lon * RADIANS - lon0) * Math.cos(lat0) * EARTH_RADIUS_METRES,
    (lat * RADIANS - latOrigin) * EARTH_RADIUS_METRES
  ]);
  let twiceArea = 0;
  for (let i = 0; i < xy.length; i++) {
    const next = xy[(i + 1) % xy.length];
    twiceArea += xy[i][0] * next[1] - next[0] * xy[i][1];
  }
  return Math.abs(twiceArea / 2);
}

export function geometryMetrics(geometry) {
  if (!geometry) return { lengthMeters: 0, areaSqMeters: 0 };
  switch (geometry.type) {
    case 'Point': return { lengthMeters: 0, areaSqMeters: 0 };
    case 'MultiPoint': return { lengthMeters: 0, areaSqMeters: 0 };
    case 'LineString': return { lengthMeters: lineLength(geometry.coordinates), areaSqMeters: 0 };
    case 'MultiLineString': return { lengthMeters: geometry.coordinates.reduce((sum, line) => sum + lineLength(line), 0), areaSqMeters: 0 };
    case 'Polygon': {
      const rings = geometry.coordinates || [];
      const perimeter = rings.reduce((sum, ring) => sum + lineLength(ring), 0);
      const area = Math.max(0, rings.reduce((sum, ring, index) => sum + (index === 0 ? ringArea(ring) : -ringArea(ring)), 0));
      return { lengthMeters: perimeter, areaSqMeters: area };
    }
    case 'MultiPolygon': {
      const metrics = geometry.coordinates.map(polygon => geometryMetrics({ type: 'Polygon', coordinates: polygon }));
      return metrics.reduce((sum, item) => ({ lengthMeters: sum.lengthMeters + item.lengthMeters, areaSqMeters: sum.areaSqMeters + item.areaSqMeters }), { lengthMeters: 0, areaSqMeters: 0 });
    }
    case 'GeometryCollection':
      return (geometry.geometries || []).reduce((sum, child) => {
        const next = geometryMetrics(child);
        return { lengthMeters: sum.lengthMeters + next.lengthMeters, areaSqMeters: sum.areaSqMeters + next.areaSqMeters };
      }, { lengthMeters: 0, areaSqMeters: 0 });
    default: return { lengthMeters: 0, areaSqMeters: 0 };
  }
}

export function summarizeFeatures(features = []) {
  const types = Object.create(null);
  let lengthMeters = 0, areaSqMeters = 0;
  for (const feature of features) {
    const type = feature?.geometry?.type || 'Sans géométrie';
    types[type] = (types[type] || 0) + 1;
    const metrics = geometryMetrics(feature?.geometry);
    lengthMeters += metrics.lengthMeters;
    areaSqMeters += metrics.areaSqMeters;
  }
  return {
    featureCount: features.length,
    types,
    extent: extentOfFeatures(features),
    lengthMeters,
    areaSqMeters,
    coordinateCount: features.reduce((sum, feature) => sum + positionsInGeometry(feature?.geometry).length, 0)
  };
}
