/* Constantes de déploiement : chemins, sources externes, quotas.
   Toutes les valeurs peuvent être remplacées par des variables
   d'environnement, ce qui permet de faire tourner plusieurs instances
   (ou les bancs d'essai) isolées les unes des autres. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const PUBLIC_DIR = process.env.MTN_PUBLIC_DIR || path.join(ROOT, 'public');
export const DATA_DIR = process.env.MTN_DATA_DIR || path.join(ROOT, 'data');

export const DEFAULT_PORT = Number(process.env.PORT) || 4173;
export const DEFAULT_HOST = process.env.MTN_HOST || '0.0.0.0';

/* Sources de données — plusieurs miroirs pour les services qui en offrent. */
export const SOURCES = {
  overpass: ['https://overpass-api.de/api/interpreter',
             'https://maps.mail.ru/osm/tools/overpass/api/interpreter'],
  nominatim: 'https://nominatim.openstreetmap.org/search',
  nasa: 'https://power.larc.nasa.gov/api/temporal/daily/point',
  terrain: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/',
            'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/']
};

export const UA = 'MapToNap-clone/0.1 (étude technique ; données © OpenStreetMap ODbL)';

/* Quota : une génération en vol par IP, puis temps de refroidissement. */
export const COOLDOWN_MS = 20_000;
export const RUN_TTL_MS = 5 * 60_000;

/* Délais des appels sortants, en millisecondes. */
export const TIMEOUTS = { overpass: 60_000, nominatim: 15_000, climate: 30_000, tile: 20_000 };
