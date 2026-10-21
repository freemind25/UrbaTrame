/* Authentification universitaire UrbaTrame.
   Le code métier est séparé du transport Postgres/SMTP afin de pouvoir être
   testé avec des adaptateurs en mémoire. Aucun OTP, mot de passe ou jeton de
   session n'est persisté en clair. */
import crypto from 'node:crypto';

export const STUDENT_DOMAIN = 'univ-constantine3.dz';
export const OTP_TTL_MS = 10 * 60_000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 60_000;
export const OTP_MAX_EMAILS_PER_HOUR = 3;
export const OTP_MAX_IP_REQUESTS_PER_HOUR = 20;
export const STUDENT_SESSION_TTL_MS = 8 * 60 * 60_000;

export const GENERIC_OTP_RESPONSE = Object.freeze({
  accepted: true,
  message: 'Si cette adresse est autorisée, un code lui sera envoyé.'
});

export function normalizeStudentEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@univ-constantine3\.dz$/.test(email)) return null;
  const local = email.slice(0, email.lastIndexOf('@'));
  if (!local || local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return null;
  return email;
}

const b64url = value => Buffer.from(value).toString('base64url');
const hashToken = value => crypto.createHash('sha256').update(value).digest('hex');

function hmac(secret, value) {
  return crypto.createHmac('sha256', secret).update(value, 'utf8').digest('hex');
}

export function createStudentAuth({
  repository,
  sendOtpEmail,
  otpSecret,
  now = () => Date.now(),
  randomInt = crypto.randomInt,
  randomBytes = crypto.randomBytes,
  uuid = crypto.randomUUID,
  otpTtlMs = OTP_TTL_MS,
  maxAttempts = OTP_MAX_ATTEMPTS,
  resendCooldownMs = OTP_RESEND_COOLDOWN_MS,
  maxEmailsPerHour = OTP_MAX_EMAILS_PER_HOUR,
  maxIpRequestsPerHour = OTP_MAX_IP_REQUESTS_PER_HOUR,
  sessionTtlMs = STUDENT_SESSION_TTL_MS
} = {}) {
  if (!repository || typeof repository.issueOtpChallenge !== 'function' ||
      typeof repository.consumeOtpChallenge !== 'function' ||
      typeof repository.getActiveSession !== 'function' ||
      typeof repository.revokeSession !== 'function')
    throw new TypeError('STUDENT_AUTH_REPOSITORY_REQUIRED');
  if (typeof sendOtpEmail !== 'function') throw new TypeError('STUDENT_AUTH_MAILER_REQUIRED');
  if (!Buffer.isBuffer(otpSecret) || otpSecret.length < 32) throw new TypeError('STUDENT_AUTH_OTP_SECRET_MUST_BE_32_BYTES');

  async function requestOtp({ email: input, ip = 'unknown' } = {}) {
    const email = normalizeStudentEmail(input);
    if (!email) return { ...GENERIC_OTP_RESPONSE };

    const timestamp = now();
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const challengeId = uuid();
    const expiresAt = new Date(timestamp + otpTtlMs);
    const codeMac = hmac(otpSecret, `${email}\0${code}`);
    const ipHash = hmac(otpSecret, `ip\0${String(ip).slice(0, 128)}`);

    const issued = await repository.issueOtpChallenge({
      challengeId, email, codeMac, ipHash,
      now: new Date(timestamp), expiresAt,
      cooldownMs: resendCooldownMs,
      maxEmailsPerHour,
      maxIpRequestsPerHour
    });
    if (issued?.status !== 'issued') return { ...GENERIC_OTP_RESPONSE };

    try {
      await sendOtpEmail({ to: email, code, expiresAt });
    } catch (error) {
      try { await repository.invalidateOtpChallenge(challengeId, new Date(now())); } catch { /* fail closed */ }
      /* Ne jamais journaliser l'adresse ni le code OTP. */
      console.error('UT_AUTH_EMAIL_DELIVERY_FAILED', String(error?.code || error?.name || 'EMAIL_ERROR').slice(0, 64));
    }
    return { ...GENERIC_OTP_RESPONSE };
  }

  async function verifyOtp({ email: input, code: submitted } = {}) {
    const email = normalizeStudentEmail(input);
    if (!email) return { ok: false, error: 'INVALID_OR_EXPIRED_CODE' };
    const code = typeof submitted === 'string' ? submitted.slice(0, 32) : '';
    const codeMac = hmac(otpSecret, `${email}\0${code}`);
    const timestamp = now();
    const sessionToken = b64url(randomBytes(32));
    const userId = uuid();
    const sessionId = uuid();
    const sessionHash = hashToken(sessionToken);
    const sessionExpiresAt = new Date(timestamp + sessionTtlMs);

    const result = await repository.consumeOtpChallenge({
      email, codeMac, now: new Date(timestamp), maxAttempts,
      userId, sessionId, sessionHash, sessionExpiresAt
    });
    if (!result?.ok) return { ok: false, error: 'INVALID_OR_EXPIRED_CODE' };
    return {
      ok: true,
      sessionToken,
      expiresAt: sessionExpiresAt,
      user: {
        email: result.user.email,
        role: result.user.role || 'student',
        tier: 'max',
        emailVerified: true,
        entitlements: { pro: true, max: true }
      }
    };
  }

  async function getSession(sessionToken) {
    if (typeof sessionToken !== 'string' || !/^[A-Za-z0-9_-]{40,64}$/.test(sessionToken)) return null;
    const session = await repository.getActiveSession(hashToken(sessionToken), new Date(now()));
    if (!session) return null;
    return {
      id: session.id,
      email: session.email,
      role: session.role || 'student',
      tier: 'max',
      emailVerified: Boolean(session.emailVerifiedAt),
      expiresAt: session.expiresAt,
      entitlements: { pro: true, max: true }
    };
  }

  async function logout(sessionToken) {
    if (typeof sessionToken !== 'string' || !/^[A-Za-z0-9_-]{40,64}$/.test(sessionToken)) return false;
    return repository.revokeSession(hashToken(sessionToken), new Date(now()));
  }

  return Object.freeze({
    requestOtp,
    verifyOtp,
    getSession,
    logout,
    sessionTtlMs,
    ready: true
  });
}
