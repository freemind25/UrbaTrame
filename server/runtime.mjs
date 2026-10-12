/* Assemblage des services (licences, quota, sessions) selon la plateforme.
   ───────────────────────────────────────────────────────────────────────────
   Un seul endroit décide de la façon dont l'état est conservé, pour que les
   deux points d'entrée — le serveur Node et les fonctions Vercel — partagent
   exactement le même code métier :

     mode 'node'    (défaut)  clé dans data/keys.json · sessions en mémoire
     mode 'vercel'            clé dans FM_SIGNING_KEY · sessions sans état

   Dans les deux cas le quota par IP vit en mémoire : sur Vercel il est donc
   « au mieux » (une instance par région), ce qui est documenté comme limite.
   ─────────────────────────────────────────────────────────────────────────── */
import { createLicence, keysFromEnv } from './licence.mjs';
import { createQuota } from './quota.mjs';
import { createRunStore } from './runs.mjs';
import { COOLDOWN_MS } from './config.mjs';

export function createRuntime({ mode = 'node', dataDir, cooldownMs } = {}) {
  const quotaOpts = typeof cooldownMs === 'number' ? { cooldownMs } : {};

  if (mode === 'vercel')
    return {
      mode,
      licence: createLicence({ keys: keysFromEnv(), stateless: true }),
      quota: createQuota(quotaOpts),
      runs: createRunStore(),
      storage: 'aucun (sessions signées, quota en mémoire)'
    };

  return {
    mode: 'node',
    licence: createLicence({ dataDir }),
    quota: createQuota(quotaOpts),
    runs: createRunStore(),
    storage: 'data/keys.json + mémoire (' + (COOLDOWN_MS / 1000) + ' s de refroidissement)'
  };
}
