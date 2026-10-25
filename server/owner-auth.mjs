/* Authentification du propriétaire, distincte des comptes étudiants.
   Le mot de passe n'est jamais conservé en clair : Vercel ne reçoit qu'un
   vérificateur scrypt. Les sessions sont signées, courtes et host-only. */
import crypto from 'node:crypto';

export const OWNER_SESSION_TTL_MS = 8 * 60 * 60_000;
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_BYTES = 32;
const MAX_ATTEMPTS_PER_WINDOW = 5;
const ATTEMPT_WINDOW_MS = 15 * 60_000;
const MAX_TRACKED_IPS = 2_048;

function decodeSecret(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const secret = Buffer.from(value.trim(), 'base64');
  return secret.length >= 32 ? secret : null;
}

function parsePasswordVerifier(value) {
  if (typeof value !== 'string') return null;
  const parts = value.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [, nText, rText, pText, saltText, hashText] = parts;
  const n = Number(nText), r = Number(rText), p = Number(pText);
  /* Paramètres fixes : l'environnement ne peut pas demander un scrypt coûteux. */
  if (n !== SCRYPT_N || r !== SCRYPT_R || p !== SCRYPT_P) return null;
  let salt, hash;
  try {
    salt = Buffer.from(saltText, 'base64url');
    hash = Buffer.from(hashText, 'base64url');
  } catch { return null; }
  if (salt.length !== 16 || hash.length !== SCRYPT_BYTES) return null;
  return { n, r, p, salt, hash };
}

function hmac(secret, value) {
  return crypto.createHmac('sha256', secret).update(value, 'utf8').digest();
}

function ownerUser(expiresAt) {
  return Object.freeze({
    id: 'owner',
    role: 'admin',
    tier: 'max',
    emailVerified: false,
    isOwner: true,
    expiresAt: new Date(expiresAt),
    entitlements: Object.freeze({ pro: true, max: true })
  });
}

function deriveScrypt(password, verifier) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, verifier.salt, verifier.hash.length, {
      N: verifier.n, r: verifier.r, p: verifier.p, maxmem: 64 * 1024 * 1024
    }, (error, derived) => error ? reject(error) : resolve(derived));
  });
}

export function createOwnerAuthRuntime({
  env = process.env,
  now = () => Date.now(),
  randomBytes = crypto.randomBytes,
  sessionTtlMs = OWNER_SESSION_TTL_MS
} = {}) {
  const required = String(env.FM_OWNER_AUTH || '').trim().toLowerCase() === 'required';
  if (!required) return Object.freeze({ required: false, ready: false, disabled: true });

  const verifier = parsePasswordVerifier(env.FM_OWNER_PASSWORD_HASH);
  const otpSecret = decodeSecret(env.FM_AUTH_OTP_KEY);
  if (!verifier || !otpSecret) return Object.freeze({
    required: true,
    ready: false,
    disabled: false,
    missing: [
      ...(!verifier ? ['FM_OWNER_PASSWORD_HASH'] : []),
      ...(!otpSecret ? ['FM_AUTH_OTP_KEY'] : [])
    ]
  });

  /* Domain separation; changing the password verifier or OTP key invalidates
     all existing owner cookies without a database write. */
  const sessionKey = hmac(otpSecret, `urba-owner-session-v1\0${env.FM_OWNER_PASSWORD_HASH}`);
  const failures = new Map();

  function ipKey(ip) {
    return hmac(otpSecret, `urba-owner-login-ip\0${String(ip || 'unknown').slice(0, 128)}`).toString('hex');
  }

  function reserveAttempt(key, timestamp) {
    let record = failures.get(key);
    if (!record || record.resetAt <= timestamp) record = { count: 0, resetAt: timestamp + ATTEMPT_WINDOW_MS };
    if (record.count >= MAX_ATTEMPTS_PER_WINDOW) {
      failures.set(key, record);
      return false;
    }
    record.count += 1;
    failures.delete(key);
    failures.set(key, record);
    while (failures.size > MAX_TRACKED_IPS) failures.delete(failures.keys().next().value);
    return true;
  }

  function makeSessionToken(expiresAt) {
    const nonce = randomBytes(16).toString('base64url');
    const payload = Buffer.from(`${expiresAt}\0${nonce}`, 'utf8').toString('base64url');
    const signature = crypto.createHmac('sha256', sessionKey).update(payload, 'utf8').digest('base64url');
    return `${payload}.${signature}`;
  }

  function getSession(token) {
    if (typeof token !== 'string' || token.length > 512) return null;
    const parts = token.split('.');
    if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return null;
    const expected = crypto.createHmac('sha256', sessionKey).update(parts[0], 'utf8').digest();
    const supplied = Buffer.from(parts[1], 'base64url');
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
    let payload;
    try { payload = Buffer.from(parts[0], 'base64url').toString('utf8'); }
    catch { return null; }
    const split = payload.indexOf('\0');
    if (split < 1) return null;
    const expiresAt = Number(payload.slice(0, split));
    const nonce = payload.slice(split + 1);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now() || !/^[A-Za-z0-9_-]{20,30}$/.test(nonce)) return null;
    return ownerUser(expiresAt);
  }

  async function authenticate({ password, ip = 'unknown' } = {}) {
    const timestamp = now();
    const key = ipKey(ip);
    if (!reserveAttempt(key, timestamp)) return { ok: false, rateLimited: true };

    const validInput = typeof password === 'string' &&
      Array.from(password).length >= 16 && Buffer.byteLength(password, 'utf8') <= 512;
    const candidate = validInput ? password : '\0invalid-owner-password';
    let derived;
    try { derived = await deriveScrypt(candidate, verifier); }
    catch { return { ok: false, unavailable: true }; }
    const matches = crypto.timingSafeEqual(derived, verifier.hash) && validInput && password.length > 0;
    if (!matches) return { ok: false };

    failures.delete(key);
    const expiresAt = timestamp + sessionTtlMs;
    return { ok: true, sessionToken: makeSessionToken(expiresAt), user: ownerUser(expiresAt) };
  }

  return Object.freeze({
    required: true,
    ready: true,
    disabled: false,
    authenticate,
    getSession,
    sessionTtlMs
  });
}
