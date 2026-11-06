/* API du module Altiplan intégré à Freemap.
   Ces routes publiques servent uniquement le relevé topographique; elles ne
   passent ni par le système de licence ni par les quotas des analyses Freemap. */
import {
  CADRAGE_DATASET_IDS, DATASET_IDS, MAX_CADRAGE_RADIUS, MAX_RADIUS, MIN_RADIUS,
  queryFor, queryForCadrage, withoutContactTags
} from './atelier-data.mjs';
import { geocode as searchPlace, overpass as requestOverpass } from './sources/overpass.mjs';
import { latToY, lonToX, terrain as requestTerrain, terrainZoom } from './sources/terrain.mjs';
import { glo30 as requestGlo30, GLO30_SOURCE_LABEL } from './sources/glo30.mjs';
import { log, readBody, send } from './http.mjs';
import { createGadmHandler } from './gadm.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function terrainTileFootprint(lat, lon, radius) {
  const zoom = terrainZoom(radius);
  const dy = radius / 111320;
  const dx = dy / Math.max(0.08, Math.cos(lat * Math.PI / 180));
  const minX = Math.floor(lonToX(lon - dx, zoom)), maxX = Math.floor(lonToX(lon + dx, zoom));
  const minY = Math.floor(latToY(lat + dy, zoom)), maxY = Math.floor(latToY(lat - dy, zoom));
  return { zoom, tiles: (maxX - minX + 1) * (maxY - minY + 1) };
}

export function createAtelierHandlers(deps = {}) {
  const geocodeSource = deps.geocode || searchPlace;
  const overpassSource = deps.overpass || requestOverpass;
  const terrainSource = deps.terrain || requestTerrain;
  const glo30Source = deps.glo30 || requestGlo30;
  /* Source de relief demandée : 'terrarium' (défaut) ou 'glo30' (phase D). */
  const sourceRelief = body => (body?.terrainSource === 'glo30' || body?.source === 'glo30' ? glo30Source : terrainSource);
  const labelRelief = topo => !topo ? null
    : topo.source === 'glo30' ? GLO30_SOURCE_LABEL
    : 'Terrarium / public elevation tiles';
  const clock = deps.now || Date.now;
  const logger = deps.log || log;
  const gadm = createGadmHandler({ fetch: deps.gadmFetch, now: clock, log: logger });
  let lastSearch = 0;
  let searchQueue = Promise.resolve();
  const placeCache = new Map();

  function reserveNominatimSlot() {
    const slot = searchQueue.then(async () => {
      const wait = Math.max(0, 1100 - (clock() - lastSearch));
      if (wait) await pause(wait);
      lastSearch = clock();
    });
    searchQueue = slot.catch(() => {});
    return slot;
  }

  async function readJSON(req, res) {
    try {
      const raw = await readBody(req, 2_000_000);
      return JSON.parse(raw.toString('utf8') || '{}');
    } catch (error) {
      const tooLarge = error.message === 'TOO_LARGE';
      send(res, tooLarge ? 413 : 400, { ok: false, error: tooLarge ? 'BODY_TOO_LARGE' : 'BAD_JSON' });
      return null;
    }
  }

  function health(req, res) {
    if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'GET_ONLY' });
    return send(res, 200, {
      ok: true, name: 'UrbaTrame', feature: 'atelier-topographique', version: '0.1.0',
      datasets: DATASET_IDS, radius: { min: MIN_RADIUS, max: MAX_RADIUS },
      sources: ['OpenStreetMap / Overpass', 'Terrarium elevation tiles', 'Copernicus GLO-30 (AWS Open Data)', 'GADM administrative boundaries']
    });
  }

  async function geocode(req, res) {
    if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'POST_ONLY' });
    const body = await readJSON(req, res);
    if (body === null) return;
    const q = String(body.q || '').trim().slice(0, 180);
    if (q.length < 2) return send(res, 400, { ok: false, error: 'QUERY_TOO_SHORT' });
    const key = q.toLocaleLowerCase();
    if (placeCache.has(key)) return send(res, 200, { ok: true, results: placeCache.get(key), cached: true });
    await reserveNominatimSlot();
    try {
      const raw = await geocodeSource(q);
      const results = (Array.isArray(raw) ? raw : []).map(item => ({
        name: String(item.display_name || '').slice(0, 240),
        lat: Number(item.lat), lon: Number(item.lon), type: String(item.type || '')
      })).filter(item => Number.isFinite(item.lat) && Number.isFinite(item.lon));
      placeCache.set(key, results);
      if (placeCache.size > 120) placeCache.delete(placeCache.keys().next().value);
      logger('atelier search', results.length, 'result(s)');
      return send(res, 200, { ok: true, results });
    } catch (error) {
      logger('atelier search failed', error.message);
      return send(res, 502, { ok: false, error: 'GEOCODER_UNAVAILABLE', detail: error.message });
    }
  }

  async function extract(req, res, { cadrage = false } = {}) {
    if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'POST_ONLY' });
    const body = await readJSON(req, res);
    if (body === null) return;
    const lat = Number(body.lat), lon = Number(body.lon), radius = Number(body.radius);
    const availableIds = cadrage ? CADRAGE_DATASET_IDS : DATASET_IDS;
    const requested = Array.isArray(body.include) ? body.include : availableIds;
    const include = [...new Set(requested.filter(id => availableIds.includes(id)))];
    let query;
    try {
      if (cadrage && radius > MAX_CADRAGE_RADIUS)
        throw new Error('CADRAGE_RADIUS_OUT_OF_RANGE');
      query = cadrage
        ? queryForCadrage({ lat, lon, radius, include })
        : queryFor({ lat, lon, radius, include });
    } catch (error) {
      return send(res, 400, {
        ok: false, error: error.message,
        ...(cadrage ? { maxRadius: MAX_CADRAGE_RADIUS } : {})
      });
    }

    const n = Math.min(40, Math.max(12, Number(body.terrainN) || 24));
    const t0 = clock();
    const [osm, ground] = await Promise.allSettled([
      overpassSource(query),
      body.terrain === false ? Promise.resolve(null) : sourceRelief(body)(lat, lon, radius, n)
    ]);
    if (osm.status === 'rejected') {
      const error = osm.reason;
      const retryAfter = Math.max(0, Math.ceil(Number(error?.retryAfter) || 0));
      logger(cadrage ? 'cadrage extract failed' : 'atelier extract failed', error?.message || 'OVERPASS');
      return send(res, 502, {
        ok: false, error: 'MAP_DATA_UNAVAILABLE', detail: String(error?.message || ''),
        ...(retryAfter ? { retryAfter } : {})
      }, 'application/json; charset=utf-8', retryAfter ? { 'Retry-After': String(retryAfter) } : {});
    }

    const warnings = [];
    const topo = ground.status === 'fulfilled' ? ground.value : null;
    if (!topo && body.terrain !== false) {
      warnings.push('RELIEF_UNAVAILABLE');
      logger(cadrage ? 'cadrage terrain unavailable' : 'atelier terrain unavailable', ground.reason?.message || 'TERRAIN');
    }
    const elements = withoutContactTags(osm.value.elements);
    if (cadrage) {
      const positionCount = elements.reduce((sum, element) => sum +
        (Array.isArray(element?.geometry) ? element.geometry.length : 0) +
        (Array.isArray(element?.members) ? element.members.reduce((nMembers, member) =>
          nMembers + (Array.isArray(member?.geometry) ? member.geometry.length : 0), 0) : 0), 0);
      const payload = {
        ok: true, lat, lon, radius, maxRadius: MAX_CADRAGE_RADIUS, include, elements, terrain: topo, warnings,
        source: { osm: 'OpenStreetMap contributors (ODbL)', elevation: labelRelief(topo) },
        extractedAt: new Date(clock()).toISOString()
      };
      if (elements.length > 12000 || positionCount > 240000 || Buffer.byteLength(JSON.stringify(payload), 'utf8') > 12_000_000) {
        logger('cadrage extract exceeds local-render limit', elements.length, 'elements', positionCount, 'positions');
        return send(res, 413, {
          ok: false, error: 'CADRAGE_DATA_LIMIT',
          message: 'La zone contient trop d’objets pour un cadrage fluide. Réduisez le rayon ou désactivez des couches, puis réessayez.',
          maxElements: 12000, maxPositions: 240000
        });
      }
      logger('cadrage extract', elements.length, 'OSM elements,', topo ? `${topo.n}×${topo.n} terrain` : 'no terrain', `${clock() - t0} ms`);
      return send(res, 200, payload);
    }
    logger('atelier extract', elements.length, 'OSM elements,', topo ? `${topo.n}×${topo.n} terrain` : 'no terrain', `${clock() - t0} ms`);
    return send(res, 200, {
      ok: true, lat, lon, radius, include, elements, terrain: topo, warnings,
      source: { osm: 'OpenStreetMap contributors (ODbL)', elevation: labelRelief(topo) },
      extractedAt: new Date(clock()).toISOString()
    });
  }

  async function terrain(req, res) {
    if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'POST_ONLY' });
    const body = await readJSON(req, res);
    if (body === null) return;
    const lat = Number(body.lat), lon = Number(body.lon), radius = Number(body.radius);
    const n = Math.min(40, Math.max(12, Number(body.n) || 24));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180 ||
        !Number.isFinite(radius) || radius < 50)
      return send(res, 400, { ok: false, error: 'INVALID_TERRAIN_REQUEST' });
    const dy = radius / 111320;
    const dx = dy / Math.max(0.08, Math.cos(lat * Math.PI / 180));
    if (lat - dy < -85 || lat + dy > 85 || lon - dx < -180 || lon + dx > 180)
      return send(res, 400, { ok: false, error: 'TERRAIN_OUTSIDE_MAP' });
    const tileCount = terrainTileFootprint(lat, lon, radius).tiles;
    if (!Number.isSafeInteger(tileCount) || tileCount > 64)
      return send(res, 413, { ok: false, error: 'TERRAIN_TILE_BUDGET', maxTiles: 64 });
    try {
      const grid = await sourceRelief(body)(lat, lon, radius, n);
      return send(res, 200, {
        ok: true, terrain: grid,
        source: { elevation: grid?.source === 'glo30' ? GLO30_SOURCE_LABEL : 'Terrarium · tuiles d’altitude publiques AWS' },
        extractedAt: new Date(clock()).toISOString()
      });
    } catch (error) {
      logger('atelier terrain unavailable', error?.message || 'TERRAIN');
      return send(res, 502, { ok: false, error: 'TERRAIN_UNAVAILABLE' });
    }
  }

  const extractCadrage = (req, res) => extract(req, res, { cadrage: true });
  return { health, geocode, extract, extractCadrage, gadm, terrain };
}

const handlers = createAtelierHandlers();
export const handleAtelierHealth = handlers.health;
export const handleAtelierGeocode = handlers.geocode;
export const handleAtelierExtract = handlers.extract;
export const handleAtelierCadrageExtract = handlers.extractCadrage;
export const handleAtelierGadm = handlers.gadm;
export const handleAtelierTerrain = handlers.terrain;
