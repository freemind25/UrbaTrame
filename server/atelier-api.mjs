/* API du module Altiplan intégré à Freemap.
   Ces routes publiques servent uniquement le relevé topographique; elles ne
   passent ni par le système de licence ni par les quotas des analyses Freemap. */
import { DATASET_IDS, MAX_RADIUS, MIN_RADIUS, queryFor, withoutContactTags } from './atelier-data.mjs';
import { geocode as searchPlace, overpass as requestOverpass } from './sources/overpass.mjs';
import { terrain as requestTerrain } from './sources/terrain.mjs';
import { log, readBody, send } from './http.mjs';
import { createGadmHandler } from './gadm.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export function createAtelierHandlers(deps = {}) {
  const geocodeSource = deps.geocode || searchPlace;
  const overpassSource = deps.overpass || requestOverpass;
  const terrainSource = deps.terrain || requestTerrain;
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
      sources: ['OpenStreetMap / Overpass', 'Terrarium elevation tiles', 'GADM administrative boundaries']
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

  async function extract(req, res) {
    if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'POST_ONLY' });
    const body = await readJSON(req, res);
    if (body === null) return;
    const lat = Number(body.lat), lon = Number(body.lon), radius = Number(body.radius);
    let query;
    try { query = queryFor({ lat, lon, radius, include: body.include ?? DATASET_IDS }); }
    catch (error) { return send(res, 400, { ok: false, error: error.message }); }

    const include = [...new Set((Array.isArray(body.include) ? body.include : DATASET_IDS)
      .filter(id => DATASET_IDS.includes(id)))];
    const n = Math.min(40, Math.max(12, Number(body.terrainN) || 24));
    const t0 = clock();
    const [osm, ground] = await Promise.allSettled([
      overpassSource(query),
      body.terrain === false ? Promise.resolve(null) : terrainSource(lat, lon, radius, n)
    ]);
    if (osm.status === 'rejected') {
      logger('atelier extract failed', osm.reason?.message || 'OVERPASS');
      return send(res, 502, { ok: false, error: 'MAP_DATA_UNAVAILABLE', detail: String(osm.reason?.message || '') });
    }

    const warnings = [];
    const topo = ground.status === 'fulfilled' ? ground.value : null;
    if (!topo && body.terrain !== false) {
      warnings.push('RELIEF_UNAVAILABLE');
      logger('atelier terrain unavailable', ground.reason?.message || 'TERRAIN');
    }
    const elements = withoutContactTags(osm.value.elements);
    logger('atelier extract', elements.length, 'OSM elements,', topo ? `${topo.n}×${topo.n} terrain` : 'no terrain', `${clock() - t0} ms`);
    return send(res, 200, {
      ok: true, lat, lon, radius, include, elements, terrain: topo, warnings,
      source: { osm: 'OpenStreetMap contributors (ODbL)', elevation: topo ? 'Terrarium / public elevation tiles' : null },
      extractedAt: new Date(clock()).toISOString()
    });
  }

  return { health, geocode, extract, gadm };
}

const handlers = createAtelierHandlers();
export const handleAtelierHealth = handlers.health;
export const handleAtelierGeocode = handlers.geocode;
export const handleAtelierExtract = handlers.extract;
export const handleAtelierGadm = handlers.gadm;
