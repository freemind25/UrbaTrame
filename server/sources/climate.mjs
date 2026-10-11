/* Climat : séries journalières NASA POWER (domaine public).
   Cinq paramètres suffisent aux cinq analyses climatiques :
     T2M_MAX, T2M_MIN, PRECTOTCORR, ALLSKY_SFC_SW_DWN, WS10M
   Les valeurs sont des totaux/moyennes JOURNALIERS — que les renderers ne
   doivent pas confondre avec des cumuls mensuels. */
import { SOURCES, UA, TIMEOUTS } from '../config.mjs';
import { fetchT } from './overpass.mjs';

export const CLIMATE_DAYS = 3 * 365;

export async function climate(lat, lon) {
  const end = new Date();
  const start = new Date(end.getTime() - CLIMATE_DAYS * 864e5);
  const fmt = d => d.toISOString().slice(0, 10).replace(/-/g, '');
  const url = SOURCES.nasa +
    '?parameters=T2M_MAX,T2M_MIN,PRECTOTCORR,ALLSKY_SFC_SW_DWN,WS10M&community=RE' +
    '&latitude=' + lat.toFixed(4) + '&longitude=' + lon.toFixed(4) +
    '&start=' + fmt(start) + '&end=' + fmt(end) + '&format=JSON';
  const r = await fetchT(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } },
    TIMEOUTS.climate);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  const p = j?.properties?.parameter;
  if (!p) throw new Error('NO_CLIMATE');
  return { source: 'NASA POWER', params: p };
}
