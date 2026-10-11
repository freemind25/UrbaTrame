/* Quota par IP : une génération en vol à la fois, puis refroidissement.
   Reproche assumé — l'état vit en mémoire : derrière plusieurs instances, il
   faut un magasin partagé (Redis, table) pour que le quota soit global. */
import { COOLDOWN_MS } from './config.mjs';

export function createQuota({ cooldownMs = COOLDOWN_MS, retryWindowMs = 8_000 } = {}) {
  const state = new Map();   // ip -> {inflight:Set<device>, cooldownUntil}

  function slotFor(ip) {
    let st = state.get(ip);
    if (!st) { st = { inflight: new Set(), cooldownUntil: 0 }; state.set(ip, st); }
    return st;
  }

  return {
    /* Renvoie {ok, st} ou {error, status, retryAfter}. */
    gate(ip, now = Date.now()) {
      const st = slotFor(ip);
      const wait = Math.max(0, Math.ceil((st.cooldownUntil - now) / 1000));
      if (st.inflight.size) return { error: 'GENERATION_IN_PROGRESS', status: 429, retryAfter: wait || 5 };
      if (wait > 0 && now < st.cooldownUntil - (cooldownMs - retryWindowMs))
        return { error: 'RATE_LIMITED', status: 429, retryAfter: wait, rl: true };
      return { ok: true, st };
    },
    hold(st, device) { st.inflight.add(device); },
    release(st, device, now = Date.now()) {
      st.inflight.delete(device);
      st.cooldownUntil = now + cooldownMs;
    },
    size: () => state.size
  };
}
