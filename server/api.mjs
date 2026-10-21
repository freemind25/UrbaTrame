/* Routes de l'API — contrat décrit dans docs/API.md.
     POST /analysis/2d   JSON   check · begin · query · end · activate · terrain · climate · windrose
     POST /            form    geocode= · refcheck= · refcode=
     GET  /api/status           état du service + clé publique Ed25519
   Les autres GET servent les fichiers de public/.                              */
import { plan, buildingsQuery, FREE_IDS, MAX_IDS, LIMITS, VERSION } from '../public/js/plan-2d.mjs';
import { SOURCES, accessMode, isOpenAccess } from './config.mjs';
import {
  send, readBody, clientIp, serveStatic, TRACE, log
} from './http.mjs';
import { validDevice } from './licence.mjs';
import { overpass, geocode } from './sources/overpass.mjs';
import { climate } from './sources/climate.mjs';
import { windrose } from './sources/windrose.mjs';
import { terrain } from './sources/terrain.mjs';
import { fetchOpenBuildingMap } from './sources/openbuildingmap.mjs';
import { createAtelierHandlers } from './atelier-api.mjs';
import { createStudentAuthHandlers, requireStudentSession } from './student-auth-http.mjs';

/* Chaque route est exportée séparément : le serveur Node les compose,
   les fonctions Vercel en exposent une chacune. */
export function createStatusHandler({ licence, studentAuth = null }) {
  return async function status(_req, res) {
    return send(res, 200, {
      ok: true,
      version: VERSION,
      trace: TRACE,
      pub: licence.pubB64,
      access: accessMode(),
      auth: {
        required: Boolean(studentAuth?.required),
        ready: studentAuth?.ready !== false
      },
      free: FREE_IDS,
      max: MAX_IDS,
      limits: LIMITS,
      licenses: {
        signedFileActivation: Boolean(licence.issuerReady),
        publicKey: licence.licensePubB64 || ''
      },
      sources: {
        overpass: SOURCES.overpass.length + ' miroirs',
        nominatim: true, nasa: true, windrose: true, terrain: true, openBuildingMap: true
      }
    });
  };
}

export function createUtilityHandler({ licence }) {
  return async function utility(req, res) {
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
  };
}

export function createAnalysisHandler({ licence, quota, runs }) {
  return async function analysis(req, res, ip, studentUser = null) {
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
      log('activate', r.error || r.tier);
      return send(res, r.status || 200, { ...r, pub: licence.pubB64 });
    }

    if (action === 'activateLicense') {
      const r = licence.activateLicense(body.license, device);
      log('activate signed license', r.licenseId || r.error || 'rejected');
      return send(res, r.status || 200, { ...r, pub: licence.pubB64 });
    }

    /* ── begin : planification + ouverture de session ── */
    if (action === 'begin') {
      const ids = Array.isArray(body.ids) ? body.ids : [];
      let p;
      try { p = plan(ids, Number(body.radius), Number(body.lat), Number(body.lon)); }
      catch (e) { return send(res, 400, { error: e.message }); }

      /* Toute adresse active de la liste reçoit automatiquement Max, lequel
         inclut Pro. L'identité est déjà vérifiée par le cookie serveur; aucun
         code ou fichier .utlic individuel n'est demandé aux étudiants. */
      if (studentUser) {
        /* Quota par compte (et non par IP) : les étudiants partagent souvent
           le NAT du campus; un quota IP les bloquerait mutuellement. */
        const g = quota.gate(studentUser.id || ip);
        if (g.error) {
          log('quota étudiant', String(studentUser.id || 'account').slice(0, 8), g.error);
          return send(res, g.status, g, 'application/json; charset=utf-8',
            { 'Retry-After': String(g.retryAfter || 5) });
        }
        const slot = g.st;
        quota.hold(slot, device);
        const run = runs.open({
          groups: p.groups.map(group => ({ id: group.id, query: group.query, keys: group.keys })),
          tier: 'max', device, ip, slot,
          radius: body.radius, lat: body.lat, lon: body.lon
        });
        log('begin étudiant', run.slice(0, 8), 'max', p.selected.length + ' analyse(s)');
        return send(res, 200, {
          ok: true, run, tier: 'max', access: 'student',
          groups: p.groups.map(group => ({ id: group.id, fr: group.fr, en: group.en }))
        });
      }

      /* Accès libre (période d'essai) : toutes les analyses, sans licence,
         sans quota, sans filigrane. Voir docs/ACCES.md. */
      if (isOpenAccess()) {
        const libre = runs.open({
          groups: p.groups.map(g => ({ id: g.id, query: g.query, keys: g.keys })),
          tier: 'open', device, ip, slot: null,
          radius: body.radius, lat: body.lat, lon: body.lon
        });
        log('begin', libre.slice(0, 8), 'open', p.selected.length + ' analyse(s)',
            p.groups.length + ' requête(s)');
        return send(res, 200, {
          ok: true, run: libre, tier: 'open', access: 'open',
          groups: p.groups.map(g => ({ id: g.id, fr: g.fr, en: g.en }))
        });
      }

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

    /* ── buildings : emprises + hauteurs pour la vue 3D ──
       Comme le reste : la requête est composée par le planificateur, jamais
       transmise par le client. Hors accès libre, elle exige une licence. */
    if (action === 'buildings') {
      if (!studentUser && !isOpenAccess()) {
        const s = licence.check(body);
        if (s.error) return send(res, s.status, s);
      }
      let q;
      try { q = buildingsQuery(Number(body.lat), Number(body.lon), Number(body.radius)); }
      catch (e) { return send(res, 400, { error: e.message }); }
      try {
        const t0 = Date.now();
        const d = await overpass(q);
        log('buildings', d.elements.length + ' emprises', (Date.now() - t0) + ' ms');
        return send(res, 200, { ok: true, elements: d.elements, source: 'overpass' });
      } catch (e) {
        log('buildings échec', e.message);
        return send(res, 502, { error: 'MAP_SOURCE_UNAVAILABLE', detail: e.message });
      }
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

    /* ── windrose : climatologie régionale MERRA-2 à 10 m ── */
    if (action === 'windrose') {
      try {
        const w = await windrose(Number(body.lat), Number(body.lon));
        log('windrose', w.sectors.length + ' secteurs', w.period.start, '→', w.period.end);
        return send(res, 200, w);
      } catch (e) {
        const invalid = e.message === 'INVALID_LOCATION';
        if (!invalid) log('windrose indisponible', e.message);
        return send(res, invalid ? 400 : 502, {
          error: invalid ? 'INVALID_LOCATION' : 'NO_WINDROSE', detail: e.message
        });
      }
    }

    /* ── OpenBuildingMap : couche d'occupation séparée des données OSM ── */
    if (action === 'obmoccupancy') {
      const lat = Number(body.lat), lon = Number(body.lon), radius = Number(body.radius);
      const shape = body.shape || 'circle';
      if (!['circle', 'square', 'rect'].includes(shape))
        return send(res, 400, { error: 'INVALID_SHAPE' });
      try { plan(['obmoccupancy'], radius, lat, lon); }
      catch (e) { return send(res, 400, { error: e.message }); }
      try {
        const t0 = Date.now();
        const obm = await fetchOpenBuildingMap({ lat, lon, radius, shape });
        log('OpenBuildingMap', obm.featureCount + ' empreintes', obm.tilesLoaded + '/' + obm.tilesRequested + ' tuiles', (Date.now() - t0) + ' ms');
        return send(res, 200, obm);
      } catch (e) {
        const invalid = ['INVALID_LOCATION', 'SITE_CROSSES_DATELINE', 'OBM_TILE_LIMIT', 'INVALID_SHAPE'].includes(e.message);
        if (!invalid) log('OpenBuildingMap indisponible', e.message);
        return send(res, invalid ? 400 : 502, {
          error: invalid ? e.message : 'OBM_SOURCE_UNAVAILABLE', detail: e.message
        });
      }
    }

    return send(res, 200, { error: 'UNKNOWN_ACTION' });
  };
}

export function createApi({ licence, quota, runs, publicDir, studentAuth = null }) {
  const status = createStatusHandler({ licence, studentAuth });
  const utility = createUtilityHandler({ licence });
  const analysis = createAnalysisHandler({ licence, quota, runs });
  const atelier = createAtelierHandlers();
  const authHandlers = createStudentAuthHandlers(studentAuth);
  const protectedPaths = new Set([
    '/api/util', '/analysis/2d',
    '/api/atelier/health', '/api/atelier/geocode', '/api/atelier/extract',
    '/api/atelier/cadrage-extract', '/api/atelier/gadm'
  ]);

  return async function handler(req, res) {
    const url = new URL(req.url, 'http://x');
    const ip = clientIp(req);
    if (req.method === 'OPTIONS') return send(res, 200, '');

    if (url.pathname === '/api/status') return status(req, res);
    if (url.pathname === '/api/auth/request-otp') return authHandlers.requestOtp(req, res, ip);
    if (url.pathname === '/api/auth/verify-otp') return authHandlers.verifyOtp(req, res);
    if (url.pathname === '/api/auth/session') return authHandlers.session(req, res);
    if (url.pathname === '/api/auth/logout') return authHandlers.logout(req, res);

    let studentUser = null;
    if ((protectedPaths.has(url.pathname) || (url.pathname === '/' && req.method === 'POST')) && studentAuth?.required) {
      const access = await requireStudentSession(req, res, studentAuth);
      if (!access.ok) return;
      studentUser = access.user;
    }

    if (url.pathname === '/api/atelier/health') return atelier.health(req, res);
    if (url.pathname === '/api/atelier/geocode') return atelier.geocode(req, res);
    if (url.pathname === '/api/atelier/extract') return atelier.extract(req, res);
    if (url.pathname === '/api/atelier/cadrage-extract') return atelier.extractCadrage(req, res);
    if (url.pathname === '/api/atelier/gadm') return atelier.gadm(req, res);
    if (req.method === 'POST' && (url.pathname === '/' || url.pathname === '/api/util'))
      return utility(req, res);
    if (req.method === 'POST' && url.pathname === '/analysis/2d') return analysis(req, res, ip, studentUser);
    if (req.method === 'GET') return serveStatic(req, res, url.pathname, publicDir);

    send(res, 405, 'POST only', 'text/plain');
  };
}
