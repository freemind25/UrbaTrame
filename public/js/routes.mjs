/* Freemap · couche réseau
   Réplique la stratégie du client d'origine :
     • essai gratuit → Overpass PUBLIC interrogé directement par le navigateur
       (l'IP du visiteur passe mieux que celle d'un proxy partagé) ;
     • licence → le serveur comme canal garanti, avec repli public ;
     • cache IndexedDB par requête, réutilisé si le réseau échoue ;
     • messages d'erreur typés, traduits. */
import { cacheGet, cachePut } from './persist.mjs';
import { OverpassRotation } from './overpass-rotation.mjs';

const PUBLIC_OPS = [
  'https://z.overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
];
const publicOverpassRotation = new OverpassRotation();

export const ERR = {
  INVALID_DEVICE: ['Appareil non identifié.', 'Unknown device.'],
  STUDENT_AUTH_REQUIRED: ['Connexion universitaire requise.', 'University sign-in required.'],
  STUDENT_AUTH_UNAVAILABLE: ['Service d’authentification momentanément indisponible.', 'Authentication service temporarily unavailable.'],
  INVALID_OR_EXPIRED_CODE: ['Code incorrect ou expiré.', 'The code is incorrect or expired.'],
  INVALID_CODE: ['Code de licence inconnu.', 'Invalid licence code.'],
  INVALID_LICENSE: ['Fichier de licence invalide ou non authentique.', 'Invalid or unauthenticated licence file.'],
  LICENSE_ISSUER_UNCONFIGURED: ['Les licences Pro/Max ne sont pas encore configurées sur le serveur.', 'Pro/Max licences are not configured on the server yet.'],
  LICENSE_NOT_YET_VALID: ['Cette licence n’est pas encore valide.', 'This licence is not valid yet.'],
  INVALID_LICENSE_FILE: ['Fichier .utlic invalide. Sélectionnez un fichier émis par UrbaTrame.', 'Invalid .utlic file. Select a file issued by UrbaTrame.'],
  DEVICE_IN_USE: ['Licence active sur un autre appareil.', 'Licence active on another device.'],
  DEVICE_REVOKED: ['Licence déplacée vers un autre appareil.', 'Licence moved to another device.'],
  EXPIRED: ['Le pass a expiré.', 'The pass has ended.'],
  RATE_LIMITED: ['Trop de générations récentes, patientez.', 'Too many recent runs, please wait.'],
  GENERATION_IN_PROGRESS: ['Une génération est déjà en cours.', 'A generation is already running.'],
  LICENCE_REQUIRED: ['Cette analyse nécessite une licence.', 'This analysis needs a licence.'],
  RUN_EXPIRED: ['Session de génération expirée.', 'Generation session expired.'],
  MAP_SOURCE_UNAVAILABLE: [
    'Sources OSM/Overpass temporairement injoignables. Aucune analyse OSM n’a été chargée; réessayez dans quelques minutes.',
    'OSM/Overpass sources are temporarily unreachable. No OSM analysis was loaded; please retry in a few minutes.'
  ],
  RADIUS_200_3000: ['Le rayon doit être compris entre 200 et 3000 m.', 'Radius must be 200–3000 m.'],
  INVALID_LOCATION: ['Coordonnées invalides.', 'Invalid coordinates.'],
  SITE_CROSSES_DATELINE: ['Le site traverse l\'antiméridien.', 'Site crosses the dateline.'],
  NO_WINDROSE: ['Rose des vents NASA POWER indisponible.', 'NASA POWER wind rose unavailable.'],
  OBM_SOURCE_UNAVAILABLE: ['Tuiles OpenBuildingMap momentanément indisponibles.', 'OpenBuildingMap tiles are temporarily unavailable.'],
  OBM_TILE_LIMIT: ['Emprise OBM trop grande pour le plafond de tuiles.', 'OBM extent exceeds the tile limit.'],
  INVALID_SHAPE: ['Forme d’emprise invalide.', 'Invalid study shape.'],
  INVALID_ANALYSES: ['Sélection d\'analyses invalide.', 'Invalid analysis selection.']
};
export const errText = (code, lang) => (ERR[code] || [code, code])[lang === 'en' ? 1 : 0];

export class Routes {
  constructor(base = '', onLog = () => {}, { overpassEndpoints = PUBLIC_OPS, overpassRotation = publicOverpassRotation } = {}) {
    this.base = base;
    this.log = onLog;
    this.overpassEndpoints = overpassEndpoints;
    this.overpassRotation = overpassRotation;
    /* Règle perf 3 : requêtes identiques en vol partagées (un seul appel réseau). */
    this.inflight = new Map();
  }

  _dedup(key, make) {
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const p = Promise.resolve()
      .then(make)
      .finally(() => { this.inflight.delete(key); });
    this.inflight.set(key, p);
    return p;
  }

  post2d(body, opts = {}) {
    return this._dedup('2d:' + JSON.stringify(body), () => this._post2d(body, opts));
  }

  async _post2d(body, { timeout = 15_000, publicCall = false } = {}) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeout);
    try {
      const r = await fetch(this.base + '/analysis/2d', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'same-origin',
        cache: 'no-store',
        signal: ac.signal
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(d.error || 'HTTP_' + r.status), { error: d.error, status: r.status, retryAfter: d.retryAfter, body: d });
      return d;
    } finally { clearTimeout(t); }
  }

  util(params, timeout = 15_000) {
    return this._dedup('util:' + new URLSearchParams(params).toString(), () => this._util(params, timeout));
  }

  async _util(params, timeout = 15_000) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeout);
    try {
      /* /api/util plutôt que la racine : le serveur Node accepte les deux, et
         sur Vercel « / » doit rester l'interface. */
      const r = await fetch(this.base + '/api/util', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params).toString(),
        credentials: 'same-origin',
        signal: ac.signal
      });
      return await r.json();
    } finally { clearTimeout(t); }
  }

  check(device, session) { return this.post2d({ action: 'check', device, ...(session || {}) }); }
  activate(code, device) { return this.post2d({ action: 'activate', code, device, public: true }); }
  activateLicense(license, device) { return this.post2d({ action: 'activateLicense', license, device, public: true }); }
  terrain(lat, lon, radius, n, device) { return this.post2d({ action: 'terrain', device, lat, lon, radius, n }, { timeout: 45_000 }); }
  climate(lat, lon, device) { return this.post2d({ action: 'climate', device, lat, lon }, { timeout: 45_000 }); }
  windrose(lat, lon, device) { return this.post2d({ action: 'windrose', device, lat, lon }, { timeout: 45_000 }); }
  obmOccupancy(lat, lon, radius, shape, device) {
    return this.post2d({ action: 'obmoccupancy', device, lat, lon, radius, shape }, { timeout: 45_000 });
  }
  geocode(q) { return this.util({ geocode: q }, 20_000); }
  refcheck(ref) { return this.util({ refcheck: ref }); }
  refcode(code) { return this.util({ refcode: code }); }

  begin(ids, radius, lat, lon, { device, session, free }) {
    return this.post2d({
      action: 'begin', device, ids, radius, lat, lon,
      public: !!free, ...(session || {})
    }, { timeout: 20_000 });
  }
  query(run, group, { device, session }) {
    return this.post2d({ action: 'query', device, run, group, ...(session || {}) }, { timeout: 75_000 });
  }
  end(run, { device, session }) {
    return this.post2d({ action: 'end', device, run, ...(session || {}) }, { timeout: 8_000 }).catch(() => null);
  }

  /* ── Overpass public, directement depuis le navigateur (essai gratuit) ── */
  async overpassDirect(query, budget = 18_000, force = false) {
    if (!force) {
      const hit = await cacheGet(query);
      if (hit && Array.isArray(hit.d?.elements) && hit.d.elements.length > 0) {
        this.log(`cache · ${hit.d.elements.length} éléments (${Math.round((Date.now() - hit.t) / 60000)} min)`);
        return { ...hit.d, _cache: true, _age: hit.t };
      }
    }
    const configured = [...new Set(this.overpassEndpoints || PUBLIC_OPS)];
    const endpoints = this.overpassRotation.order(configured);
    const skipped = configured.length - endpoints.length;
    const deadline = Date.now() + Math.max(0, Number(budget) || 0);
    let last;
    let failures = 0;
    let empty = null;

    if (!endpoints.length) {
      last = new Error('ALL_OVERPASS_MIRRORS_COOLING');
      const wait = this.overpassRotation.retryAfterMs(configured);
      if (wait) last.retryAfter = Math.max(1, Math.ceil(wait / 1000));
      this.log('overpass direct · tous les miroirs publics sont en pause; aucune requête répétée');
    }

    for (let i = 0; i < endpoints.length; i++) {
      const ep = endpoints[i];
      const remaining = deadline - Date.now();
      if (remaining < 1_000) {
        last ||= new Error('OVERPASS_BUDGET_EXHAUSTED');
        failures++;
        break;
      }
      const mirrorsRemaining = endpoints.length - i;
      const attemptBudget = Math.min(8_000, Math.max(1_000, Math.floor(remaining / mirrorsRemaining)));
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), attemptBudget);
      try {
        this.log(`overpass direct · miroir ${i + 1}/${endpoints.length} · ${new URL(ep).host}…`);
        const r = await fetch(ep, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: 'data=' + encodeURIComponent(query),
          signal: ac.signal
        });
        if (!r.ok) {
          const detail = await r.text().catch(() => '');
          throw Object.assign(new Error('HTTP ' + r.status), {
            status: r.status, detail, headers: r.headers
          });
        }
        let d;
        try { d = await r.json(); }
        catch (e) {
          throw Object.assign(new Error('INVALID_MAP_DATA'), {
            status: r.status, detail: e.message, headers: r.headers, providerFault: true
          });
        }
        if (d && typeof d.remark === 'string' && d.remark.trim()) {
          throw Object.assign(new Error('OVERPASS_REMARK'), {
            status: r.status, detail: d.remark, headers: r.headers, providerFault: true
          });
        }
        if (!Array.isArray(d?.elements)) {
          throw Object.assign(new Error('INVALID_MAP_DATA'), {
            status: r.status, detail: 'Réponse sans tableau elements', headers: r.headers, providerFault: true
          });
        }
        if (!d.elements.length) {
          const health = this.overpassRotation.noteSuccess(ep, r.headers, { prefer: false });
          if (health.quotaExhausted)
            this.log(`overpass direct · ${new URL(ep).host} · réponse vide valide, quota épuisé; pause ${Math.ceil(health.cooldownMs / 1000)} s`);
          if (!empty) empty = d;
          this.log(`overpass direct · ${new URL(ep).host} · 0 éléments (essai d’un autre miroir)`);
          continue;
        }
        const health = this.overpassRotation.noteSuccess(ep, r.headers);
        if (health.quotaExhausted)
          this.log(`overpass direct · ${new URL(ep).host} · résultat valide; quota épuisé, pause ${Math.ceil(health.cooldownMs / 1000)} s`);
        await cachePut(query, d);
        return d;
      } catch (e) {
        last = e;
        failures++;
        const status = Number(e.status) || 0;
        const policy = this.overpassRotation.noteFailure(ep, {
          status, detail: e.detail || e.message, headers: e.headers,
          network: !status, providerFault: e.providerFault
        });
        const reason = status >= 400 ? 'HTTP ' + status : e.name === 'AbortError' ? 'délai dépassé' : e.message;
        const pause = policy.retry ? `; rotation, pause ${Math.ceil(policy.cooldownMs / 1000)} s` : '; requête non réessayable';
        this.log(`overpass direct · ${new URL(ep).host} indisponible (${reason}${pause})`);
        if (!policy.retry) break;
      } finally { clearTimeout(timer); }
    }
    const hit = await cacheGet(query);
    if (hit && Array.isArray(hit.d?.elements) && hit.d.elements.length > 0) {
      this.log('réseau en échec · cache réutilisé');
      return { ...hit.d, _cache: true, _age: hit.t };
    }
    if (empty && failures === 0 && skipped === 0) {
      this.log('overpass direct · tous les miroirs valides sont vides');
      return empty;
    }
    if (empty && (failures > 0 || skipped > 0))
      this.log('overpass direct · réponse vide mêlée à des miroirs indisponibles; aucune donnée partielle affichée');
    const error = Object.assign(new Error('MAP_SOURCE_UNAVAILABLE'), {
      error: 'MAP_SOURCE_UNAVAILABLE', cause: last
    });
    const wait = this.overpassRotation.order(configured).length === 0
      ? this.overpassRotation.retryAfterMs(configured) : 0;
    if (wait) error.retryAfter = Math.max(1, Math.ceil(wait / 1000));
    throw error;
  }
}
