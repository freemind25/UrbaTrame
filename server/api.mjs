/* Routes de l'API — contrat décrit dans docs/API.md.
     POST /analysis/2d   JSON   check · begin · query · end · activate · terrain · climate
     POST /            form    geocode= · refcheck= · refcode=
     GET  /api/status           état du service + clé publique Ed25519
   Les autres GET servent les fichiers de public/.                              */
import { plan, FREE_IDS, MAX_IDS, LIMITS, VERSION } from '../public/js/mtn-2d-plan.mjs';
import { SOURCES } from './config.mjs';
import {
  send, readBody, clientIp, serveStatic, TRACE, log
} from './http.mjs';
import { validDevice } from './licence.mjs';
import { overpass, geocode } from './sources/overpass.mjs';
import { climate } from './sources/climate.mjs';
import { terrain } from './sources/terrain.mjs';

export function createApi({ licence, quota, runs, publicDir }) {
  async function status(res) {
    return send(res, 200, {
      ok: true,
      version: VERSION,
      trace: TRACE,
      pub: licence.pubB64,
      free: FREE_IDS,
      max: MAX_IDS,
      limits: LIMITS,
      sources: {
        overpass: SOURCES.overpass.length + ' miroirs',
        nominatim: true, nasa: true, terrain: true
      },
      codes: licence.knownCodes()
    });
  }

  /* ── utilitaires (recherche de lieu, parrainage) ── */
  async function utility(req, res) {
    try {
      const p = new URLSearchParams((await readBody(req)).toString('utf8'));

      if (p.has('geocode')) {
        const q = String(p.get('geocode')).slice(0, 200);
        if (!q.trim()) return send(res, 400, { error: 'EMPTY_QUERY' });
        const d = await geocode(q);
        log('geocode', JSON.stringify(q), '→', d.length, 'résultat(s)');
        return send(res, 200, d);
      }
      if (p.has('refcheck')) {
        const ref = String(p.get('refcheck')).trim().toUpperCase();
        const ok = /^MTN-[A-Z0-9]{5,8}$/.test(ref);
        return send(res, 200, { ok, ref: ok ? ref : '', percent: 20 });
      }
      if (p.has('refcode')) {
        const code = String(p.get('refcode')).trim();
        const s = licence.sessionFor(code);
        if (!s) return send(res, 200, { ok: false });
        return send(res, 200, {
          ok: true, ref: licence.refFor(code), plan: s.tier, tier: s.tier,
          expiresAt: s.expiresAt, count: 0
        });
      }
      return send(res, 200, { error: 'UNKNOWN_UTILITY' });
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  }

  /* ── POST /analysis/2d ── */
  async function analysis(req, res, ip) {
    let body;
    try { body = JSON.parse((await readBody(req)).toString('utf8') || '{}'); }
    catch { return send(res, 400, { error: 'BAD_JSON' }); }

    const { action, device } = body;
    if (!validDevice(device)) return send(res, 400, { error: 'INVALID_DEVICE' });

    /* Vérification de session : publique, ne consomme pas de quota. */
    if (action === 'check')
      return send(res, 200, { ...licence.check(body), pub: licence.pubB64 });

    if (action === 'activate') {
      const r = licence.activate(body.code, device);
      log('activate', String(body.code), '→', r.error || r.tier);
      return send(res, r.status || 200, { ...r, pub: licence.pubB64 });
    }

    /* ── begin : planification + ouverture de session ── */
    if (action === 'begin') {
      const ids = Array.isArray(body.ids) ? body.ids : [];
      let p;
      try { p = plan(ids, Number(body.radius), Number(body.lat), Number(body.lon)); }
      catch (e) { return send(res, 400, { error: e.message }); }

      /* Paliers : la licence décide, `public:true` force l'essai gratuit. */
      let tier = 'free', slot = null;
      if (!body.public && body.account && body.token) {
        const s = licence.check(body);
        if (s.error) return send(res, s.status, s);
        tier = s.tier;
      }
      if (tier === 'free') {
        if (!p.selected.every(id => FREE_IDS.includes(id)))
          return send(res, 401, {
            error: 'LICENCE_REQUIRED',
            message: 'Les analyses hors essai nécessitent une licence.'
          });
      } else {
        const g = quota.gate(ip);
        if (g.error) {
          log('quota', ip, g.error);
          return send(res, g.status, g, 'application/json; charset=utf-8',
            { 'Retry-After': String(g.retryAfter || 5) });
        }
        slot = g.st;
        quota.hold(slot, device);
      }

      const run = runs.open({
        groups: p.groups.map(g => ({ id: g.id, query: g.query, keys: g.keys })),
        tier, device, ip, slot, radius: body.radius, lat: body.lat, lon: body.lon
      });
      log('begin', run.slice(0, 8), tier, p.selected.length + ' analyse(s)', p.groups.length + ' requête(s)');
      return send(res, 200, {
        ok: true, run, tier,
        groups: p.groups.map(g => ({ id: g.id, fr: g.fr, en: g.en }))
      });
    }

    /* ── query : exécution d'un lot déjà planifié ── */
    if (action === 'query') {
      const r = runs.get(body.run);
      if (!r) return send(res, 409, { error: 'RUN_EXPIRED', status: 409 });
      const g = r.groups.find(x => x.id === body.group);
      if (!g) return send(res, 400, { error: 'UNKNOWN_GROUP' });
      if (!g.query || g.query.length < 60) return send(res, 500, { error: 'EMPTY_PLAN' });
      try {
        const t0 = Date.now();
        const d = await overpass(g.query);
        log('query', body.run.slice(0, 8), g.id, d.elements.length + ' éléments', (Date.now() - t0) + ' ms');
        return send(res, 200, { ok: true, group: g.id, elements: d.elements });
      } catch (e) {
        log('query échec', g.id, e.message);
        return send(res, 502, { error: 'MAP_SOURCE_UNAVAILABLE', detail: e.message });
      }
    }

    /* ── end : fermeture ── */
    if (action === 'end') {
      const r = runs.close(body.run);
      if (r?.slot) quota.release(r.slot, r.device);
      return send(res, 200, { ok: true });
    }

    /* ── terrain : grille d'altitude ── */
    if (action === 'terrain') {
      try {
        const n = Math.min(40, Math.max(12, Number(body.n) || 24));
        const t = await terrain(Number(body.lat), Number(body.lon), Number(body.radius) || 600, n);
        log('terrain', n + '×' + n, 'zoom', t.zoom);
        return send(res, 200, { ok: true, ...t });
      } catch (e) {
        return send(res, 502, { error: 'TERRAIN_UNAVAILABLE', detail: e.message });
      }
    }

    /* ── climate : séries NASA POWER ── */
    if (action === 'climate') {
      try {
        const c = await climate(Number(body.lat), Number(body.lon));
        log('climate', Object.keys(c.params).join(','));
        return send(res, 200, { ok: true, ...c });
      } catch (e) {
        return send(res, 502, { error: 'NO_CLIMATE', detail: e.message });
      }
    }

    return send(res, 200, { error: 'UNKNOWN_ACTION' });
  }

  return async function handler(req, res) {
    const url = new URL(req.url, 'http://x');
    const ip = clientIp(req);
    if (req.method === 'OPTIONS') return send(res, 200, '');

    if (url.pathname === '/api/status') return status(res);
    if (req.method === 'POST' && (url.pathname === '/' || url.pathname === '/api/util'))
      return utility(req, res);
    if (req.method === 'POST' && url.pathname === '/analysis/2d') return analysis(req, res, ip);
    if (req.method === 'GET') return serveStatic(req, res, url.pathname, publicDir);

    send(res, 405, 'POST only', 'text/plain');
  };
}
