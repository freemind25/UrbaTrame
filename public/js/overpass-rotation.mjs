/* Politique commune au navigateur et au serveur pour les miroirs Overpass.
   Un 429 ou un en-tête de quota épuisé met l'instance en pause, puis la
   requête courante passe immédiatement au miroir suivant. Les pauses sont
   locales à l'onglet ou au processus serveur : aucun compteur partagé ni
   service payant n'est ajouté. */

const SECOND = 1000;
const DEFAULTS = Object.freeze({
  busy: 30 * SECOND,
  quota: 5 * 60 * SECOND,
  access: 15 * 60 * SECOND,
  network: 30 * SECOND,
  maximum: 24 * 60 * 60 * SECOND
});

function header(headers, names) {
  if (!headers) return '';
  for (const name of names) {
    let value;
    if (typeof headers.get === 'function') value = headers.get(name);
    else {
      const key = Object.keys(headers).find(k => k.toLowerCase() === name.toLowerCase());
      if (key) value = headers[key];
    }
    if (value !== undefined && value !== null && String(value).trim())
      return String(value).trim();
  }
  return '';
}

export function rateLimitRemaining(headers) {
  const value = header(headers, [
    'ratelimit-remaining', 'x-ratelimit-remaining', 'x-rate-limit-remaining'
  ]);
  if (!value) return null;
  const match = value.match(/^-?\d+/);
  return match ? Number(match[0]) : null;
}

function durationFromReset(value, now) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    if (seconds > 1_000_000_000_000) return seconds - now;
    if (seconds > 1_000_000_000) return seconds * SECOND - now;
    return seconds * SECOND;
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? date - now : null;
}

function cooldownFromHeaders(headers, now, fallback, maximum) {
  const retryAfter = header(headers, ['retry-after']);
  let delay = durationFromReset(retryAfter, now);
  if (delay === null) {
    const reset = header(headers, ['x-ratelimit-reset', 'ratelimit-reset', 'rate-limit-reset']);
    delay = durationFromReset(reset, now);
  }
  if (delay === null) delay = fallback;
  return Math.min(maximum, Math.max(SECOND, delay));
}

const QUERY_ERROR = /\b(parse error|syntax error|invalid query|unknown token|bad query|query is invalid)\b/i;
const QUOTA_ERROR = /\b(rate[\s_-]?limit(?:ed|ing)?|too many requests|quota (?:exceeded|exhausted)|limit (?:exceeded|reached)|requests? remaining\s*[:=]?\s*0)\b/i;
const BUSY_ERROR = /\b(timeout|timed\s*out|out of memory|overload(?:ed)?|overloaded|server.{0,30}(?:busy|capacity)|(?:busy|capacity).{0,30}server|temporarily unavailable|try again later|dispatcher|gateway|upstream error)\b/i;
const TRANSIENT_STATUS = new Set([408, 425, 500, 502, 503, 504, 507, 509, 520, 521, 522, 523, 524]);
const ENDPOINT_STATUS = new Set([401, 402, 403, 404, 405, 406, 407, 410, 451]);

export function classifyOverpassFailure({
  status = 0, detail = '', headers = null, network = false, providerFault = false
} = {}) {
  const text = String(detail || '');
  if (QUERY_ERROR.test(text)) return { retry: false, kind: 'query' };
  if (status === 429 || QUOTA_ERROR.test(text) || rateLimitRemaining(headers) === 0)
    return { retry: true, kind: 'quota' };
  if (ENDPOINT_STATUS.has(Number(status))) return { retry: true, kind: 'access' };
  if (network || !status || TRANSIENT_STATUS.has(Number(status)) || Number(status) >= 500 || BUSY_ERROR.test(text))
    return { retry: true, kind: 'busy' };
  if (providerFault) return { retry: true, kind: 'provider' };
  return { retry: false, kind: 'query' };
}

export class OverpassRotation {
  constructor({
    busyCooldownMs = DEFAULTS.busy,
    quotaCooldownMs = DEFAULTS.quota,
    accessCooldownMs = DEFAULTS.access,
    networkCooldownMs = DEFAULTS.network,
    maxCooldownMs = DEFAULTS.maximum
  } = {}) {
    this.cooldowns = new Map();
    this.preferred = null;
    this.cursor = 0;
    this.busyCooldownMs = busyCooldownMs;
    this.quotaCooldownMs = quotaCooldownMs;
    this.accessCooldownMs = accessCooldownMs;
    this.networkCooldownMs = networkCooldownMs;
    this.maxCooldownMs = maxCooldownMs;
  }

  order(list, now = Date.now()) {
    const endpoints = [...new Set((list || []).filter(Boolean))];
    for (const [endpoint, until] of this.cooldowns)
      if (until <= now) this.cooldowns.delete(endpoint);
    const ready = endpoints.filter(endpoint => !this.cooldowns.has(endpoint));
    if (!ready.length) return [];

    if (this.preferred && ready.includes(this.preferred))
      return [this.preferred, ...ready.filter(endpoint => endpoint !== this.preferred)];

    const start = this.cursor % endpoints.length;
    this.cursor = (start + 1) % endpoints.length;
    const ordered = [];
    for (let step = 0; step < endpoints.length; step++) {
      const endpoint = endpoints[(start + step) % endpoints.length];
      if (ready.includes(endpoint)) ordered.push(endpoint);
    }
    return ordered;
  }

  noteSuccess(endpoint, headers, { now = Date.now(), prefer = true } = {}) {
    if (rateLimitRemaining(headers) === 0) {
      const cooldownMs = cooldownFromHeaders(headers, now, this.quotaCooldownMs, this.maxCooldownMs);
      this.cooldowns.set(endpoint, now + cooldownMs);
      if (this.preferred === endpoint) this.preferred = null;
      return { quotaExhausted: true, cooldownMs, kind: 'quota' };
    }
    this.cooldowns.delete(endpoint);
    if (prefer) this.preferred = endpoint;
    return { quotaExhausted: false, cooldownMs: 0, kind: 'success' };
  }

  noteFailure(endpoint, {
    status = 0, detail = '', headers = null, network = false, providerFault = false, now = Date.now()
  } = {}) {
    const result = classifyOverpassFailure({ status, detail, headers, network, providerFault });
    if (!result.retry) return { ...result, cooldownMs: 0 };

    const fallback = result.kind === 'quota' ? this.quotaCooldownMs :
      result.kind === 'access' ? this.accessCooldownMs :
      result.kind === 'busy' && network ? this.networkCooldownMs : this.busyCooldownMs;
    const cooldownMs = cooldownFromHeaders(headers, now, fallback, this.maxCooldownMs);
    this.cooldowns.set(endpoint, now + cooldownMs);
    if (this.preferred === endpoint) this.preferred = null;
    return { ...result, cooldownMs };
  }

  retryAfterMs(list, now = Date.now()) {
    const times = [...new Set((list || []).filter(Boolean))]
      .map(endpoint => this.cooldowns.get(endpoint))
      .filter(until => Number.isFinite(until) && until > now);
    return times.length ? Math.min(...times) - now : 0;
  }
}
