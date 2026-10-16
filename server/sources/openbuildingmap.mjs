/* OpenBuildingMap public occupancy vector tiles.
   Data stays separate from the application's OSM/Overpass layers. The public
   tile schema inspected for this source exposes osm_id and occupancy only;
   this reader deliberately does not invent heights, floorspace or provenance. */
import {
  OBM_ATTRIBUTION,
  OBM_MAX_RETURNED_FEATURES,
  OBM_MAX_RETURNED_VERTICES,
  OBM_MAX_TILE_BYTES,
  OBM_TILE_ROOT,
  getObmTilePlan,
  decodeMvt,
  obmCategory,
  tilePointToLonLat
} from '../../public/js/openbuildingmap.mjs';

const TILE_CACHE_TTL_MS = 5 * 60_000;
const TILE_CACHE_LIMIT = 128;
const TILE_CONCURRENCY = 6;
const REQUEST_TIMEOUT_MS = 8_000;
const tileCache = new Map();

function trimCache() {
  while (tileCache.size > TILE_CACHE_LIMIT) tileCache.delete(tileCache.keys().next().value);
}

async function fetchTile(tile, fetchImpl, cache) {
  const key = `${tile.z}/${tile.x}/${tile.y}`;
  if (cache) {
    const hit = tileCache.get(key);
    if (hit && hit.expiresAt > Date.now()) {
      tileCache.delete(key);
      tileCache.set(key, hit);
      return hit.promise;
    }
    if (hit) tileCache.delete(key);
  }

  const promise = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetchImpl(`${OBM_TILE_ROOT}/occupancy/${tile.z}/${tile.x}/${tile.y}.pbf`, {
        headers: {
          Accept: 'application/x-protobuf, application/octet-stream;q=0.9',
          'User-Agent': 'UrbaTrame/0.1 (OpenBuildingMap occupancy; freemind25@tutamail.com)'
        },
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`OBM_HTTP_${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > OBM_MAX_TILE_BYTES) throw new Error('OBM_TILE_TOO_LARGE');
      return bytes;
    } finally {
      clearTimeout(timer);
    }
  })();

  if (cache) {
    const entry = { expiresAt: Date.now() + TILE_CACHE_TTL_MS, promise };
    tileCache.set(key, entry);
    trimCache();
    try { return await promise; }
    catch (error) {
      if (tileCache.get(key) === entry) tileCache.delete(key);
      throw error;
    }
  }
  return promise;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      try { out[index] = { value: await fn(items[index]) }; }
      catch (error) { out[index] = { error }; }
    }
  }));
  return out;
}

function polygonCentroid(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  let twiceArea = 0, x = 0, y = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const cross = a[0] * b[1] - b[0] * a[1];
    twiceArea += cross;
    x += (a[0] + b[0]) * cross;
    y += (a[1] + b[1]) * cross;
  }
  if (Math.abs(twiceArea) < 1e-8) {
    return [
      ring.reduce((sum, point) => sum + point[0], 0) / ring.length,
      ring.reduce((sum, point) => sum + point[1], 0) / ring.length
    ];
  }
  return [x / (3 * twiceArea), y / (3 * twiceArea)];
}

function withinExtent(lat, lon, site, shape) {
  const x = (lon - site.lon) * 111320 * Math.cos(site.lat * Math.PI / 180);
  const y = (lat - site.lat) * 111320;
  if (shape === 'square' || shape === 'rect') return Math.abs(x) <= site.radius && Math.abs(y) <= site.radius;
  return Math.hypot(x, y) <= site.radius;
}

function edgePenalty(rings, extent) {
  const ring = rings?.[0] || [];
  if (!ring.length) return 4;
  let penalty = 0;
  if (ring.some(([x]) => x <= 2 || x >= extent - 2)) penalty++;
  if (ring.some(([, y]) => y <= 2 || y >= extent - 2)) penalty++;
  return penalty;
}

function featureKey(id, lat, lon, code) {
  if (id != null && String(id).trim()) return `osm:${String(id).slice(0, 80)}`;
  return `xy:${lat.toFixed(5)}:${lon.toFixed(5)}:${code}`;
}

function toLonLatRings(rings, tile, extent) {
  return (rings || []).map(ring => ring
    .map(point => tilePointToLonLat(tile, point, extent))
    .filter(point => point.every(Number.isFinite)))
    .filter(ring => ring.length >= 3);
}

function returnedFeature(feature) {
  return {
    id: feature.id == null ? null : String(feature.id).slice(0, 80),
    occupancy: feature.occupancy,
    category: feature.category,
    rings: feature.rings
  };
}

export function clearObmTileCache() { tileCache.clear(); }

/** Fetches, clips by building-centroid, deduplicates and summarizes OBM tiles. */
export async function fetchOpenBuildingMap({ lat, lon, radius, shape = 'circle' } = {}, {
  fetchImpl = globalThis.fetch,
  cache = true
} = {}) {
  if (!['circle', 'square', 'rect'].includes(shape)) throw new Error('INVALID_SHAPE');
  if (typeof fetchImpl !== 'function') throw new Error('OBM_SOURCE_UNAVAILABLE');
  const tilePlan = getObmTilePlan(lat, lon, radius);
  const site = { lat, lon, radius };
  const tileResults = await mapLimit(tilePlan.tiles, TILE_CONCURRENCY,
    tile => fetchTile(tile, fetchImpl, cache));
  const httpLoaded = tileResults.filter(result => !result.error).length;
  if (!httpLoaded) throw new Error('OBM_SOURCE_UNAVAILABLE');
  const decodedTiles = new Array(tileResults.length);
  let decodeFailures = 0;
  for (let i = 0; i < tileResults.length; i++) {
    if (tileResults[i].error) continue;
    try { decodedTiles[i] = decodeMvt(tileResults[i].value); }
    catch { decodeFailures++; }
  }
  const tilesLoaded = httpLoaded - decodeFailures;
  const tilesFailed = tileResults.length - tilesLoaded;
  if (!tilesLoaded) throw new Error('OBM_SOURCE_UNAVAILABLE');

  const unique = new Map();
  for (let i = 0; i < tileResults.length; i++) {
    if (!decodedTiles[i]) continue;
    const tile = tilePlan.tiles[i];
    const layer = decodedTiles[i].find(item => item.name === 'buildings_occupancy');
    if (!layer) continue;

    for (const feature of layer.features) {
      if (feature.type !== 3 || !feature.geometry?.[0] || feature.geometry[0].length < 3) continue;
      const localCentroid = polygonCentroid(feature.geometry[0]);
      if (!localCentroid) continue;
      const center = tilePointToLonLat(tile, localCentroid, layer.extent);
      if (!center.every(Number.isFinite) || !withinExtent(center[0], center[1], site, shape)) continue;

      const rawCode = String(feature.properties?.occupancy ?? '').trim().slice(0, 32);
      const category = obmCategory(rawCode);
      const id = feature.properties?.osm_id ?? feature.id;
      const key = featureKey(id, center[0], center[1], rawCode);
      const candidate = {
        id: id == null ? null : String(id),
        occupancy: rawCode,
        category,
        rings: feature.geometry,
        tile,
        extent: layer.extent,
        center,
        edgePenalty: edgePenalty(feature.geometry, layer.extent)
      };
      const previous = unique.get(key);
      if (!previous || candidate.edgePenalty < previous.edgePenalty ||
          (candidate.edgePenalty === previous.edgePenalty &&
           candidate.rings[0].length > previous.rings[0].length)) unique.set(key, candidate);
    }
  }

  const all = [...unique.values()];
  const occupancyCounts = {
    RES: 0, COM: 0, MIX: 0, IND: 0, AGR: 0, CIV: 0, OTHER: 0, UNK: 0
  };
  for (const feature of all) occupancyCounts[feature.category] = (occupancyCounts[feature.category] || 0) + 1;
  const featureCount = all.length;
  const unknownOccupancyCount = occupancyCounts.UNK;
  const knownOccupancyCount = featureCount - unknownOccupancyCount;
  const classifiedOccupancyPct = featureCount
    ? knownOccupancyCount / featureCount * 100
    : null;

  const features = [];
  let vertices = 0, truncated = false;
  for (const feature of all) {
    const rings = toLonLatRings(feature.rings, feature.tile, feature.extent);
    const count = rings.reduce((sum, ring) => sum + ring.length, 0);
    if (!rings.length || features.length >= OBM_MAX_RETURNED_FEATURES ||
        vertices + count > OBM_MAX_RETURNED_VERTICES) {
      truncated = true;
      continue;
    }
    features.push(returnedFeature({ ...feature, rings }));
    vertices += count;
  }

  return {
    ok: true,
    source: 'OpenBuildingMap public occupancy vector tiles',
    sourceUrl: 'https://www.openbuildingmap.org/',
    datasetUrl: 'https://doi.org/10.5880/GFZ.LKUT.2025.002',
    license: 'ODbL 1.0',
    attribution: OBM_ATTRIBUTION,
    site: { lat, lon, radius, shape },
    tileZoom: tilePlan.z,
    tilesRequested: tilePlan.tiles.length,
    tilesLoaded,
    tilesFailed,
    partial: tilesFailed > 0,
    featureCount,
    returnedFeatureCount: features.length,
    featuresTruncated: truncated,
    knownOccupancyCount,
    unknownOccupancyCount,
    classifiedOccupancyPct,
    occupancyCounts,
    features,
    capturedAt: new Date().toISOString()
  };
}
