/* Overpass API (OpenStreetMap, ODbL 1.0).
   Le serveur n'exécute QUE des requêtes qu'il a lui-même planifiées avec
   public/js/mtn-2d-plan.mjs : ce n'est pas un proxy Overpass ouvert. */
import { SOURCES, UA, TIMEOUTS } from '../config.mjs';
import { log } from '../http.mjs';

export function fetchT(url, opt = {}, budget = 60_000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), budget);
  return fetch(url, { ...opt, signal: ac.signal, redirect: 'follow' })
    .finally(() => clearTimeout(t));
}

export async function overpass(query) {
  let last;
  for (const endpoint of SOURCES.overpass) {
    try {
      const r = await fetchT(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': UA,
          Accept: 'application/json'          // sans ces deux en-têtes : 406 Apache
        },
        body: 'data=' + encodeURIComponent(query)
      }, TIMEOUTS.overpass);
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
      return d;
    } catch (e) {
      last = e;
      log('overpass ' + new URL(endpoint).host + ' → ' + e.message);
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
