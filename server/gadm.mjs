/* GADM boundaries are proxied for the in-app preview because the official
   geodata host does not expose browser CORS headers. Full-resolution files
   remain direct downloads from UC Davis; this endpoint only returns a
   generalized display copy of one country/administrative level. */
import { log, send } from './http.mjs';

export const GADM_PREVIEW_VERSIONS = Object.freeze(['4.1', '4.0']);
const GADM_HOST = 'https://geodata.ucdavis.edu/gadm';
const MAX_UPSTREAM_BYTES = 64 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 3_700_000;
const CACHE_TTL = 60 * 60 * 1000;
const CACHE_BUDGET = 16 * 1024 * 1024;
const TOLERANCE_BY_LEVEL = [0.00008, 0.00006, 0.00004, 0.000025, 0.000015, 0.00001];

function validParentGid(gid, country) {
  if (gid === country) return true;
  return new RegExp(`^${country}\\.\\d+(?:\\.\\d+)*_\\d+$`).test(gid);
}

export function validateGadmQuery(searchParams) {
  const country = String(searchParams.get('country') || '').trim().toUpperCase();
  const levelText = String(searchParams.get('level') ?? '0');
  const version = String(searchParams.get('version') || '4.1');
  const parent = String(searchParams.get('parent') || '').trim();
  const parentLevelText = String(searchParams.get('parentLevel') ?? '');

  if (!/^[A-Z0-9]{3}$/.test(country)) throw new Error('INVALID_COUNTRY');
  if (!GADM_PREVIEW_VERSIONS.includes(version)) throw new Error('INVALID_VERSION');
  if (!/^[0-5]$/.test(levelText)) throw new Error('INVALID_LEVEL');
  const level = Number(levelText);
  if (parent || parentLevelText) {
    if (!parent || !/^[0-4]$/.test(parentLevelText)) throw new Error('INVALID_PARENT');
    const parentLevel = Number(parentLevelText);
    if (parentLevel !== level - 1 || !validParentGid(parent, country)) throw new Error('INVALID_PARENT');
    return { country, level, version, parent, parentLevel };
  }
  return { country, level, version, parent: null, parentLevel: null };
}

export function gadmGeoJsonUrl({ country, level, version = '4.1' }) {
  if (!/^[A-Z0-9]{3}$/.test(country) || !GADM_PREVIEW_VERSIONS.includes(version) ||
      !Number.isInteger(level) || level < 0 || level > 5) throw new Error('INVALID_GADM_URL');
  const fileVersion = `gadm${version.replace('.', '')}`;
  return `${GADM_HOST}/gadm${version}/json/${fileVersion}_${country}_${level}.json`;
}

function sameCoordinate(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a[0] === b[0] && a[1] === b[1];
}

function pointSegmentDistanceSquared(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) {
    const px = point[0] - start[0], py = point[1] - start[1];
    return px * px + py * py;
  }
  const t = Math.max(0, Math.min(1,
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)));
  const px = point[0] - (start[0] + t * dx);
  const py = point[1] - (start[1] + t * dy);
  return px * px + py * py;
}

function simplifyOpenLine(points, tolerance) {
  if (!Array.isArray(points) || points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  const toleranceSquared = tolerance * tolerance;
  while (stack.length) {
    const [first, last] = stack.pop();
    let farthest = -1;
    let distance = toleranceSquared;
    for (let index = first + 1; index < last; index++) {
      const candidate = pointSegmentDistanceSquared(points[index], points[first], points[last]);
      if (candidate > distance) { distance = candidate; farthest = index; }
    }
    if (farthest !== -1) {
      keep[farthest] = 1;
      stack.push([first, farthest], [farthest, last]);
    }
  }
  const result = [];
  for (let index = 0; index < points.length; index++) if (keep[index]) result.push(points[index]);
  return result;
}

function simplifyRing(ring, tolerance) {
  if (!Array.isArray(ring) || ring.length <= 4) return ring;
  const closed = sameCoordinate(ring[0], ring[ring.length - 1]);
  const points = closed ? ring.slice(0, -1) : ring.slice();
  if (points.length < 4) return ring;

  /* A closed ring has identical endpoints, so ordinary RDP would collapse it.
     Split it at a point farthest from the first vertex, simplify both arcs,
     and reconnect them into a closed ring. */
  const first = points[0];
  let split = 1;
  let farthestDistance = -1;
  for (let index = 1; index < points.length; index++) {
    const dx = points[index][0] - first[0];
    const dy = points[index][1] - first[1];
    const distance = dx * dx + dy * dy;
    if (distance > farthestDistance) { farthestDistance = distance; split = index; }
  }
  if (split <= 1 || split >= points.length - 1) return ring;
  const firstArc = simplifyOpenLine(points.slice(0, split + 1), tolerance);
  const secondArc = simplifyOpenLine([...points.slice(split), first], tolerance);
  let result = [...firstArc, ...secondArc.slice(1)];
  if (result.length < 4) return ring;
  if (!sameCoordinate(result[0], result[result.length - 1])) result.push(result[0]);
  return result.length >= 4 ? result : ring;
}

function countGeometryPositions(geometry) {
  if (!geometry || typeof geometry !== 'object') return 0;
  if (geometry.type === 'GeometryCollection')
    return (geometry.geometries || []).reduce((total, item) => total + countGeometryPositions(item), 0);
  let count = 0;
  const visit = value => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])) { count++; return; }
    for (const child of value) visit(child);
  };
  visit(geometry.coordinates);
  return count;
}

function simplifyGeometry(geometry, tolerance) {
  if (!geometry || typeof geometry !== 'object') return geometry;
  const simplifyLine = line => simplifyOpenLine(line, tolerance);
  switch (geometry.type) {
    case 'LineString':
      return { ...geometry, coordinates: simplifyLine(geometry.coordinates) };
    case 'MultiLineString':
      return { ...geometry, coordinates: geometry.coordinates.map(simplifyLine) };
    case 'Polygon':
      return { ...geometry, coordinates: geometry.coordinates.map(ring => simplifyRing(ring, tolerance)) };
    case 'MultiPolygon':
      return { ...geometry, coordinates: geometry.coordinates.map(polygon =>
        polygon.map(ring => simplifyRing(ring, tolerance))) };
    case 'GeometryCollection':
      return { ...geometry, geometries: (geometry.geometries || []).map(item => simplifyGeometry(item, tolerance)) };
    default:
      return geometry;
  }
}

export function makeGadmPreview(collection, { country, level, version = '4.1', parent = null,
  parentLevel = null, originalBytes = 0 } = {}) {
  if (!collection || collection.type !== 'FeatureCollection' || !Array.isArray(collection.features))
    throw new Error('INVALID_GADM_GEOJSON');

  const sourceFeatures = parent
    ? collection.features.filter(feature => String(feature?.properties?.[`GID_${parentLevel}`] || '') === parent)
    : collection.features;
  if (!sourceFeatures.length) throw new Error('GADM_NO_FEATURES');
  if (sourceFeatures.length > 100_000) throw new Error('GADM_TOO_MANY_FEATURES');

  const originalPositions = sourceFeatures.reduce((total, feature) =>
    total + countGeometryPositions(feature.geometry), 0);
  const baseTolerance = TOLERANCE_BY_LEVEL[level] ?? TOLERANCE_BY_LEVEL[5];
  let tolerance = baseTolerance;
  let result = null;
  let resultText = '';
  let resultBytes = 0;
  for (let attempt = 0; attempt < 11; attempt++) {
    const features = sourceFeatures.map(feature => ({
      type: 'Feature',
      ...(feature.id === undefined ? {} : { id: feature.id }),
      properties: feature.properties && typeof feature.properties === 'object' ? feature.properties : {},
      geometry: simplifyGeometry(feature.geometry, tolerance)
    }));
    const previewPositions = features.reduce((total, feature) =>
      total + countGeometryPositions(feature.geometry), 0);
    result = {
      type: 'FeatureCollection',
      ...(collection.name ? { name: collection.name } : {}),
      features,
      gadm: {
        source: 'GADM', version, country, level, parent, parentLevel,
        previewGeneralized: previewPositions < originalPositions, toleranceDegrees: tolerance,
        featureCount: features.length, originalPositions, previewPositions, originalBytes
      }
    };
    resultText = JSON.stringify(result);
    resultBytes = Buffer.byteLength(resultText);
    if (resultBytes <= MAX_PREVIEW_BYTES) return { body: resultText, bytes: resultBytes, payload: result };
    tolerance *= 2;
  }
  const error = new Error('GADM_PREVIEW_TOO_LARGE');
  error.previewBytes = resultBytes;
  throw error;
}

async function readResponseLimited(response, limit) {
  const announced = Number(response.headers?.get?.('content-length') || 0);
  if (announced > limit) throw new Error('GADM_SOURCE_TOO_LARGE');
  if (!response.body?.getReader) {
    const raw = await response.text();
    const buffer = Buffer.from(raw, 'utf8');
    if (buffer.length > limit) throw new Error('GADM_SOURCE_TOO_LARGE');
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      throw new Error('GADM_SOURCE_TOO_LARGE');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

export function createGadmHandler(deps = {}) {
  const fetchSource = deps.fetch || globalThis.fetch;
  const logger = deps.log || log;
  const clock = deps.now || Date.now;
  const cache = new Map();
  let cachedBytes = 0;

  function getCached(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= clock()) {
      cachedBytes -= entry.bytes;
      cache.delete(key);
      return null;
    }
    cache.delete(key);
    cache.set(key, entry);
    return entry;
  }

  function storeCache(key, entry) {
    if (entry.bytes > CACHE_BUDGET / 2) return;
    while (cachedBytes + entry.bytes > CACHE_BUDGET && cache.size) {
      const oldestKey = cache.keys().next().value;
      const oldest = cache.get(oldestKey);
      cachedBytes -= oldest.bytes;
      cache.delete(oldestKey);
    }
    cache.set(key, entry);
    cachedBytes += entry.bytes;
  }

  return async function gadm(req, res) {
    if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'GET_ONLY' });
    let args;
    try { args = validateGadmQuery(new URL(req.url || '/', 'http://urba.local').searchParams); }
    catch (error) { return send(res, 400, { ok: false, error: error.message }); }

    const key = [args.version, args.country, args.level, args.parent || 'all'].join(':');
    const headers = {
      'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
      'X-GADM-Preview': 'generalized'
    };
    const cached = getCached(key);
    if (cached) return send(res, 200, cached.body, 'application/geo+json; charset=utf-8', headers);

    const sourceUrl = gadmGeoJsonUrl(args);
    try {
      const upstream = await fetchSource(sourceUrl, { signal: AbortSignal.timeout(35_000) });
      if (upstream.status === 404) return send(res, 404, {
        ok: false, error: 'GADM_LEVEL_UNAVAILABLE', message: 'Ce niveau n’existe pas dans cette version pour ce pays.'
      });
      if (!upstream.ok) throw new Error(`GADM_UPSTREAM_${upstream.status}`);
      const rawBuffer = await readResponseLimited(upstream, MAX_UPSTREAM_BYTES);
      let source;
      try { source = JSON.parse(rawBuffer.toString('utf8')); }
      catch { throw new Error('GADM_INVALID_JSON'); }
      const preview = makeGadmPreview(source, { ...args, originalBytes: rawBuffer.length });
      const entry = { body: preview.body, bytes: preview.bytes, expiresAt: clock() + CACHE_TTL };
      storeCache(key, entry);
      logger('gadm preview', args.country, `level ${args.level}`, preview.payload.features.length, 'features', `${preview.bytes} bytes`);
      return send(res, 200, entry.body, 'application/geo+json; charset=utf-8', headers);
    } catch (error) {
      const reason = String(error?.message || 'GADM_UNAVAILABLE');
      logger('gadm preview failed', args.country, `level ${args.level}`, reason);
      if (reason === 'GADM_NO_FEATURES') return send(res, 404, { ok: false, error: reason });
      if (reason === 'GADM_SOURCE_TOO_LARGE' || reason === 'GADM_TOO_MANY_FEATURES' || reason === 'GADM_PREVIEW_TOO_LARGE')
        return send(res, 413, {
          ok: false, error: reason,
          message: 'Aperçu trop volumineux. Choisissez une subdivision parentale, un niveau inférieur ou téléchargez le fichier officiel.'
        });
      if (reason.includes('Timeout') || reason.includes('timeout') || reason.includes('ABORT'))
        return send(res, 504, { ok: false, error: 'GADM_TIMEOUT' });
      return send(res, 502, { ok: false, error: 'GADM_UNAVAILABLE', detail: reason });
    }
  };
}
