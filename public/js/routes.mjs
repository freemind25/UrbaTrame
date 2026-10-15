/* Freemap · couche réseau
   Réplique la stratégie du client d'origine :
     • essai gratuit → Overpass PUBLIC interrogé directement par le navigateur
       (l'IP du visiteur passe mieux que celle d'un proxy partagé) ;
     • licence → le serveur comme canal garanti, avec repli public ;
     • cache IndexedDB par requête, réutilisé si le réseau échoue ;
     • messages d'erreur typés, traduits. */
import { cacheGet, cachePut } from './persist.mjs';

const PUBLIC_OPS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
];

export const ERR = {
  INVALID_DEVICE: ['Appareil non identifié.', 'Unknown device.'],
  INVALID_CODE: ['Code de licence inconnu.', 'Invalid licence code.'],
  DEVICE_IN_USE: ['Licence active sur un autre appareil.', 'Licence active on another device.'],
  DEVICE_REVOKED: ['Licence déplacée vers un autre appareil.', 'Licence moved to another device.'],
  EXPIRED: ['Le pass a expiré.', 'The pass has ended.'],
  RATE_LIMITED: ['Trop de générations récentes, patientez.', 'Too many recent runs, please wait.'],
  GENERATION_IN_PROGRESS: ['Une génération est déjà en cours.', 'A generation is already running.'],
  LICENCE_REQUIRED: ['Cette analyse nécessite une licence.', 'This analysis needs a licence.'],
  RUN_EXPIRED: ['Session de génération expirée.', 'Generation session expired.'],
  MAP_SOURCE_UNAVAILABLE: ['Source cartographique injoignable.', 'Map source unreachable.'],
  RADIUS_200_3000: ['Le rayon doit être compris entre 200 et 3000 m.', 'Radius must be 200–3000 m.'],
  INVALID_LOCATION: ['Coordonnées invalides.', 'Invalid coordinates.'],
  SITE_CROSSES_DATELINE: ['Le site traverse l\'antiméridien.', 'Site crosses the dateline.'],
  NO_WINDROSE: ['Rose des vents NASA POWER indisponible.', 'NASA POWER wind rose unavailable.'],
  INVALID_ANALYSES: ['Sélection d\'analyses invalide.', 'Invalid analysis selection.']
};
export const errText = (code, lang) => (ERR[code] || [code, code])[lang === 'en' ? 1 : 0];

export class Routes {
  constructor(base = '', onLog = () => {}) { this.base = base; this.log = onLog; }

  async post2d(body, { timeout = 15_000, publicCall = false } = {}) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeout);
    try {
      const r = await fetch(this.base + '/analysis/2d', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
        signal: ac.signal
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(d.error || 'HTTP_' + r.status), { error: d.error, status: r.status, retryAfter: d.retryAfter, body: d });
      return d;
    } finally { clearTimeout(t); }
  }

  async util(params, timeout = 15_000) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeout);
    try {
      /* /api/util plutôt que la racine : le serveur Node accepte les deux, et
         sur Vercel « / » doit rester l'interface. */
      const r = await fetch(this.base + '/api/util', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params).toString(),
        signal: ac.signal
      });
      return await r.json();
    } finally { clearTimeout(t); }
  }

  check(device, session) { return this.post2d({ action: 'check', device, ...(session || {}) }); }
  activate(code, device) { return this.post2d({ action: 'activate', code, device, public: true }); }
  terrain(lat, lon, radius, n, device) { return this.post2d({ action: 'terrain', device, lat, lon, radius, n }, { timeout: 45_000 }); }
  climate(lat, lon, device) { return this.post2d({ action: 'climate', device, lat, lon }, { timeout: 45_000 }); }
  windrose(lat, lon, device) { return this.post2d({ action: 'windrose', device, lat, lon }, { timeout: 45_000 }); }
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
  async overpassDirect(query, budget = 60_000, force = false) {
    if (!force) {
      const hit = await cacheGet(query);
      if (hit) {
        this.log(`cache · ${hit.d.elements.length} éléments (${Math.round((Date.now() - hit.t) / 60000)} min)`);
        return { ...hit.d, _cache: true, _age: hit.t };
      }
    }
    let last;
    for (const ep of PUBLIC_OPS) {
      try {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), budget);
        this.log(`overpass direct · ${new URL(ep).host}…`);
        const r = await fetch(ep, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: 'data=' + encodeURIComponent(query),
          signal: ac.signal
        });
        clearTimeout(t);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const d = await r.json();
        if (!Array.isArray(d.elements)) throw new Error('INVALID_MAP_DATA');
        if (!d.elements.length && d.remark && /runtime error|timed out|out of memory|rate_limited|parse error/i.test(d.remark))
          throw new Error('OVERPASS_REMARK');
        await cachePut(query, d);
        return d;
      } catch (e) { last = e; }
    }
    const hit = await cacheGet(query);
    if (hit) { this.log('réseau en échec · cache réutilisé'); return { ...hit.d, _cache: true, _age: hit.t }; }
    throw Object.assign(new Error('MAP_SOURCE_UNAVAILABLE'), { error: 'MAP_SOURCE_UNAVAILABLE', cause: last });
  }
}
