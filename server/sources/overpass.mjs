/* Overpass API (OpenStreetMap, ODbL 1.0).
   Le serveur n'exécute QUE des requêtes qu'il a lui-même planifiées avec
   public/js/plan-2d.mjs : ce n'est pas un proxy Overpass ouvert. */
import { SOURCES, UA, TIMEOUTS } from '../config.mjs';
import { log } from '../http.mjs';

export function fetchT(url, opt = {}, budget = 60_000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), budget);
  return fetch(url, { ...opt, signal: ac.signal, redirect: 'follow' })
    .finally(() => clearTimeout(t));
}

/* Dernier point d'accès qui a répondu : on le remet en tête la fois suivante.
   Les pannes des instances publiques durent des heures : inutile de repayer
   l'échec à chaque requête. */
let prefer = null;

export function orderedEndpoints(list = SOURCES.overpass) {
  if (!prefer || !list.includes(prefer)) return list.slice();
  return [prefer, ...list.filter(e => e !== prefer)];
}

export async function overpass(query, opt = {}) {
  const list = opt.endpoints || orderedEndpoints();
  const budget = opt.budget ?? TIMEOUTS.overpass;
  const perAttempt = opt.perAttempt ?? 20_000;  // temps maximal pour un essai
  const minAttempt = opt.minAttempt ?? 1_500;   // en dessous : inutile d'essayer
  const minSlice = opt.minSlice ?? 4_000;       // part réservée à chaque miroir restant
  const reserve = opt.reserve ?? 3_000;         // temps gardé pour répondre proprement
  const started = Date.now();
  let last;

  for (let i = 0; i < list.length; i++) {
    const endpoint = list[i];
    const left = budget - (Date.now() - started) - reserve;
    /* Budget épuisé : mieux vaut rendre MAP_SOURCE_UNAVAILABLE tout de suite
       que d'être coupé en plein vol (60 s de coupure côté Vercel). */
    if (left < minAttempt) { last = last || new Error('BUDGET_EXHAUSTED'); break; }

    /* Chaque miroir restant garde une part (minSlice) : ainsi un premier
       essai lent ne consomme pas tout. Un échec rapide (504 en 1 s) laisse au
       contraire le temps plein (perAttempt) aux suivants. */
    const restants = list.length - i - 1;
    const garde = Math.min(minSlice * restants, Math.max(0, left - minAttempt));
    const slice = Math.min(left, Math.max(minAttempt, Math.min(perAttempt, left - garde)));

    try {
      const r = await fetchT(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': UA,
          Accept: 'application/json'          // sans ces deux en-têtes : 406 Apache
        },
        body: 'data=' + encodeURIComponent(query)
      }, slice);
      if (!r.ok) throw new Error('HTTP ' + r.status);

      const d = await r.json();
      if (!Array.isArray(d.elements)) throw new Error('INVALID_MAP_DATA');
      /* Une réponse vide accompagnée d'un « remark » est une erreur, pas un
         résultat : Overpass renvoie 200 + tableau vide sur dépassement de
         temps, surcharge ou requête invalide. Sans ce contrôle, l'application
         affiche un plan vide en croyant avoir réussi. */
      if (!d.elements.length && d.remark &&
          /runtime error|timed out|out of memory|rate_limited|parse error/i.test(d.remark))
        throw new Error('OVERPASS_REMARK: ' + d.remark);
      prefer = endpoint;
      log('overpass ' + new URL(endpoint).host + ' · ' + d.elements.length +
          ' éléments en ' + (Math.round((Date.now() - started) / 100) / 10) + ' s');
      return d;
    } catch (e) {
      last = e;
      log('overpass ' + new URL(endpoint).host + ' → ' + e.message +
          ' (' + (Math.round((Date.now() - started) / 100) / 10) + ' s, essai de ' +
          Math.round(slice / 100) / 10 + ' s)');
    }
  }
  throw last || new Error('MAP_SOURCE_UNAVAILABLE');
}

/* Nominatim (recherche de lieu). */
export async function geocode(q) {
  const url = SOURCES.nominatim + '?format=json&limit=3&q=' + encodeURIComponent(q);
  const r = await fetchT(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } },
    TIMEOUTS.nominatim);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return await r.json();
}
