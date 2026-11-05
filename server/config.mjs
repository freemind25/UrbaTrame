/* Constantes de déploiement : chemins, sources externes, quotas.
   Toutes les valeurs peuvent être remplacées par des variables
   d'environnement, ce qui permet de faire tourner plusieurs instances
   (ou les bancs d'essai) isolées les unes des autres. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Nom du produit : sert au journal de démarrage et à la signature envoyée
    aux sources externes (OpenStreetMap demande un contact joignable). */
export const PRODUCT = 'UrbaTrame';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const PUBLIC_DIR = process.env.FM_PUBLIC_DIR || path.join(ROOT, 'public');
export const DATA_DIR = process.env.FM_DATA_DIR || path.join(ROOT, 'data');

export const DEFAULT_PORT = Number(process.env.PORT) || 4173;
export const DEFAULT_HOST = process.env.FM_HOST || '0.0.0.0';

/* Accès aux analyses.
     open    (défaut) : TOUT est ouvert à tout le monde — ni licence, ni
                        quota, ni filigrane. C'est la période d'essai.
     licence          : découpage 5 analyses gratuites / Pro / Max, quota par
                        IP et filigrane d'essai (comportement commercial).
   Lue à chaque appel : le mode change au redémarrage, sans reconstruire. */
export const accessMode = () =>
  String(process.env.FM_ACCESS || 'open').trim().toLowerCase() === 'licence'
    ? 'licence' : 'open';

export const isOpenAccess = () => accessMode() === 'open';

/* Miroirs publics Overpass sans clé, utilisés directement par le navigateur
   et par le relais serveur. */
export const PUBLIC_OVERPASS_ENDPOINTS = Object.freeze([
  'https://z.overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
]);

/* Les éventuels services à clé restent exclusivement côté serveur. Ils passent
   en tête du relais après l'échec du navigateur, puis les miroirs publics
   demeurent disponibles comme secours. Ne jamais sérialiser ces URL côté client. */
export function buildOverpassEndpoints({
  endpoints = process.env.FM_OVERPASS_ENDPOINTS,
  nextgisKey = process.env.FM_NEXTGIS_API_KEY,
  overpassChKey = process.env.FM_OVERPASS_CH_API_KEY
} = {}) {
  const publicEndpoints = String(endpoints || PUBLIC_OVERPASS_ENDPOINTS.join(','))
    .split(',').map(x => x.trim()).filter(Boolean);
  const keyedEndpoints = [];
  const nextgis = String(nextgisKey || '').trim();
  const overpassCh = String(overpassChKey || '').trim();
  if (nextgis)
    keyedEndpoints.push('https://overpass.nextgis.com/' + encodeURIComponent(nextgis) + '/api/interpreter');
  if (overpassCh)
    keyedEndpoints.push('https://api.overpass.ch/v1/' + encodeURIComponent(overpassCh) + '/interpreter');
  return [...new Set([...keyedEndpoints, ...publicEndpoints])];
}

/* Sources de données — les clés n'existent que dans la configuration serveur. */
export const SOURCES = {
  /* Les clés sont facultatives : sans elles, le comportement reste celui des
     cinq miroirs publics. Surchargeable par FM_OVERPASS_ENDPOINTS. */
  overpass: buildOverpassEndpoints(),
  nominatim: 'https://nominatim.openstreetmap.org/search',
  nasa: 'https://power.larc.nasa.gov/api/temporal/daily/point',
  windrose: 'https://power.larc.nasa.gov/api/application/windrose/point',
  terrain: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/',
            'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/']
};

export const UA = PRODUCT + '/0.1.0 (https://github.com/freemind25/UrbaTrame ; freemind25@tutamail.com)';

/* Quota : une génération en vol par IP, puis temps de refroidissement. */
export const COOLDOWN_MS = 20_000;
export const RUN_TTL_MS = 5 * 60_000;

/* Délais des appels sortants, en millisecondes.
   Sur Vercel, une fonction est interrompue à 60 s (offre gratuite) : on rend
   la main un peu avant, pour répondre MAP_SOURCE_UNAVAILABLE au lieu d'un
   délai d'attente côté navigateur. */
const OVERPASS_BUDGET = Number(process.env.FM_OVERPASS_TIMEOUT) ||
  (process.env.VERCEL ? 45_000 : 60_000);

export const TIMEOUTS = {
  overpass: OVERPASS_BUDGET,
  nominatim: 15_000,
  climate: 30_000,
  windrose: 30_000,
  tile: 20_000
};
