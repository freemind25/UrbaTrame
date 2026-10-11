/* Sessions de génération : `begin` ouvre un run, `query` exécute un lot déjà
   planifié, `end` ferme. Un run ne contient aucune requête écrite par le
   client — seulement celles que le planificateur partagé a produites. */
import crypto from 'node:crypto';
import { RUN_TTL_MS } from './config.mjs';

export function createRunStore({ ttlMs = RUN_TTL_MS } = {}) {
  const runs = new Map();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of runs) if (now - v.created > ttlMs) runs.delete(k);
  }, 30_000);
  sweep.unref?.();                        // ne retient pas le processus en vie

  return {
    open({ groups, tier, device, ip, radius, lat, lon, slot }) {
      const run = crypto.randomUUID();
      runs.set(run, { groups, tier, device, ip, radius, lat, lon, slot, created: Date.now() });
      return run;
    },
    get: run => runs.get(run),
    close(run) { const r = runs.get(run); runs.delete(run); return r; },
    size: () => runs.size,
    stop() { clearInterval(sweep); }
  };
}
