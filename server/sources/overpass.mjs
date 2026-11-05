/* Overpass API (OpenStreetMap, ODbL 1.0).
   Le serveur n'exécute QUE des requêtes qu'il a lui-même planifiées avec
   public/js/plan-2d.mjs : ce n'est pas un proxy Overpass ouvert. */
import { SOURCES, UA, TIMEOUTS } from '../config.mjs';
import { log } from '../http.mjs';
import { OverpassRotation } from '../../public/js/overpass-rotation.mjs';

export function fetchT(url, opt = {}, budget = 60_000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), budget);
  return fetch(url, { ...opt, signal: ac.signal, redirect: 'follow' })
    .finally(() => clearTimeout(t));
}

/* État de rotation local au processus. Une saturation ou une limite de
   requêtes met le miroir en pause; les autres restent immédiatement essayés. */
const rotation = new OverpassRotation();

export function orderedEndpoints(list = SOURCES.overpass, now = Date.now(), state = rotation) {
  return state.order(list, now);
}

function attemptError(message, details = {}) {
  return Object.assign(new Error(message), details);
}

export async function overpass(query, opt = {}) {
  const configured = [...new Set(opt.endpoints || SOURCES.overpass)];
  /* Les listes injectées sont un outil de test; leur état reste isolé à moins
     que le test fournisse explicitement une rotation à conserver. En service,
     tous les appels d'une instance partagent le même état. */
  const state = opt.rotation || (opt.endpoints ? new OverpassRotation() : rotation);
  const list = state.order(configured);
  const skipped = configured.length - list.length;
  const budget = opt.budget ?? TIMEOUTS.overpass;
  const perAttempt = opt.perAttempt ?? 25_000;  // le plan Overpass peut lui-même demander jusqu'à 25 s
  const minAttempt = opt.minAttempt ?? 1_500;   // en dessous : inutile d'essayer
  const minSlice = opt.minSlice ?? 1_500;       // part réservée à chaque miroir restant
  const reserve = opt.reserve ?? 3_000;         // temps gardé pour répondre proprement
  const started = Date.now();
  let last;
  let failures = 0;
  let empty = null;

  if (!list.length) {
    const wait = state.retryAfterMs(configured);
    last = attemptError('ALL_OVERPASS_MIRRORS_COOLING', {
      retryAfter: wait ? Math.max(1, Math.ceil(wait / 1000)) : undefined
    });
    log('overpass · tous les miroirs publics sont en pause; aucune requête répétée');
    throw last;
  }

  for (let i = 0; i < list.length; i++) {
    const endpoint = list[i];
    const left = budget - (Date.now() - started) - reserve;
    /* Budget épuisé : mieux vaut rendre MAP_SOURCE_UNAVAILABLE tout de suite
       que d'être coupé en plein vol (60 s de coupure côté Vercel). */
    if (left < minAttempt) { last = last || new Error('BUDGET_EXHAUSTED'); break; }

    /* Chaque miroir restant garde une part (minSlice) : ainsi un premier
       essai lent ne consomme pas tout. Un échec rapide laisse plus de temps
       au suivant. */
    const restants = list.length - i - 1;
    const garde = Math.min(minSlice * restants, Math.max(0, left - minAttempt));
    /* Partage équitable du temps restant : si les premiers répondent vite,
       un miroir lent placé plus loin peut recevoir plus de temps (jusqu'au
       timeout de la requête Overpass), sans dépasser le budget global. */
    const partage = left / (restants + 1);
    const slice = Math.min(left, Math.max(minAttempt,
      Math.min(perAttempt, partage, left - garde)));

    try {
      const r = await fetchT(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': UA,
          Accept: 'application/json'
        },
        body: 'data=' + encodeURIComponent(query)
      }, slice);
      if (!r.ok) {
        const detail = await r.text().catch(() => '');
        throw attemptError('HTTP ' + r.status, { status: r.status, detail, headers: r.headers });
      }

      let d;
      try { d = await r.json(); }
      catch (e) {
        throw attemptError('INVALID_MAP_DATA', {
          status: r.status, detail: e.message, headers: r.headers, providerFault: true
        });
      }
      if (d && typeof d.remark === 'string' && d.remark.trim()) {
        throw attemptError('OVERPASS_REMARK', {
          status: r.status, detail: d.remark, headers: r.headers, providerFault: true
        });
      }
      if (!Array.isArray(d?.elements)) {
        throw attemptError('INVALID_MAP_DATA', {
          status: r.status, detail: 'Réponse sans tableau elements', headers: r.headers, providerFault: true
        });
      }

      /* Un 200 vide reste un résultat possible, mais on interroge les autres
         miroirs avant de le retenir. Un en-tête de quota à zéro met quand
         même ce serveur en pause pour les requêtes suivantes. */
      if (!d.elements.length) {
        const health = state.noteSuccess(endpoint, r.headers, { prefer: false });
        if (health.quotaExhausted)
          log('overpass ' + new URL(endpoint).host + ' · réponse vide valide, quota épuisé; miroir en pause ' +
              Math.ceil(health.cooldownMs / 1000) + ' s');
        if (!empty) empty = { endpoint, data: d };
        log('overpass ' + new URL(endpoint).host + ' · 0 éléments' +
            (i + 1 < list.length ? ' (essai du miroir suivant)' : ''));
        continue;
      }

      const health = state.noteSuccess(endpoint, r.headers);
      if (health.quotaExhausted)
        log('overpass ' + new URL(endpoint).host + ' · résultat valide; quota épuisé, miroir en pause ' +
            Math.ceil(health.cooldownMs / 1000) + ' s');
      log('overpass ' + new URL(endpoint).host + ' · ' + d.elements.length +
          ' éléments en ' + (Math.round((Date.now() - started) / 100) / 10) + ' s');
      return d;
    } catch (e) {
      last = e;
      failures++;
      const status = Number(e.status) || 0;
      const policy = state.noteFailure(endpoint, {
        status, detail: e.detail || e.message, headers: e.headers,
        network: !status, providerFault: e.providerFault
      });
      const elapsed = Math.round((Date.now() - started) / 100) / 10;
      const attempt = Math.round(slice / 100) / 10;
      const pause = policy.retry ? '; rotation, pause ' + Math.ceil(policy.cooldownMs / 1000) + ' s' : '; erreur de requête, pas de repli';
      log('overpass ' + new URL(endpoint).host + ' → ' + (status >= 400 ? 'HTTP ' + status : e.message) +
          ' (' + elapsed + ' s, essai de ' + attempt + ' s' + pause + ')');
      if (!policy.retry) break;
    }
  }
  if (empty && failures === 0 && skipped === 0) {
    log('overpass ' + new URL(empty.endpoint).host +
        ' · aucun miroir n’a fourni d’éléments; réponse vide conservée');
    return empty.data;
  }
  if (empty && (failures > 0 || skipped > 0)) {
    log('overpass · réponse vide mêlée à des miroirs indisponibles; source déclarée indisponible');
  }
  if (!last) {
    const wait = state.retryAfterMs(configured);
    last = attemptError(skipped ? 'OVERPASS_MIRRORS_COOLING' : 'MAP_SOURCE_UNAVAILABLE', {
      retryAfter: wait ? Math.max(1, Math.ceil(wait / 1000)) : undefined
    });
  } else if (failures && state.order(configured).length === 0) {
    const wait = state.retryAfterMs(configured);
    if (wait) last.retryAfter = Math.max(1, Math.ceil(wait / 1000));
  }
  throw last;
}

/* Nominatim (recherche de lieu). */
export async function geocode(q) {
  const url = SOURCES.nominatim + '?format=json&limit=3&q=' + encodeURIComponent(q);
  const r = await fetchT(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } },
    TIMEOUTS.nominatim);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return await r.json();
}
