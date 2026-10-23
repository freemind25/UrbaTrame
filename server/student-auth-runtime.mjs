/* Assemblage paresseux du service d'authentification. L'accès reste désactivé
   tant que FM_STUDENT_AUTH=required n'est pas explicitement défini. Si ce mode
   est demandé sans secrets/base/mail, les routes protégées échouent fermées. */
import { createStudentAuth } from './student-auth.mjs';
import { createStudentAuthPool, createPostgresStudentAuthRepository } from './student-auth-postgres.mjs';
import { probeDatabase } from './student-auth-diagnostics.mjs';
import { createStudentOtpMailer, studentMailConfiguration } from './student-auth-mail.mjs';

function decodeOtpSecret(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const secret = Buffer.from(value.trim(), 'base64');
    return secret.length >= 32 ? secret : null;
  } catch { return null; }
}

export function createStudentAuthRuntime({ env = process.env, mode = 'node', dependencies = {} } = {}) {
  const required = String(env.FM_STUDENT_AUTH || '').trim().toLowerCase() === 'required';
  if (!required) return Object.freeze({ required: false, ready: true, disabled: true });

  const otpSecret = dependencies.otpSecret || decodeOtpSecret(env.FM_AUTH_OTP_KEY);
  const mailConfig = dependencies.sendOtpEmail ? { configured: true, missing: [] } : studentMailConfiguration(env);
  const missing = [];
  if (!env.FM_AUTH_DATABASE_URL && !dependencies.repository) missing.push('FM_AUTH_DATABASE_URL');
  if (!otpSecret) missing.push('FM_AUTH_OTP_KEY');
  if (!mailConfig.configured) missing.push(...mailConfig.missing);
  if (missing.length) return Object.freeze({
    required: true, ready: false, disabled: false,
    missing: [...new Set(missing)]
  });

  let pool = null;
  try {
    const repository = dependencies.repository || (() => {
      pool = createStudentAuthPool({
        connectionString: env.FM_AUTH_DATABASE_URL,
        max: mode === 'vercel' ? 1 : 5,
        ssl: String(env.FM_AUTH_DB_SSL || 'true').toLowerCase() !== 'false'
      });
      return createPostgresStudentAuthRepository(pool);
    })();
    const sendOtpEmail = dependencies.sendOtpEmail || createStudentOtpMailer({ env });
    /* Sonde de disponibilité : un SELECT 1 réel, résultat mis en cache quelques
       secondes pour ne pas doubler le coût sur chaque appel. Le détail (étape,
       code) n'est exposé qu'en aperçu, jamais en production. */
    const probeSource = dependencies.repository?.probe
      || (pool ? payload => probeDatabase(pool, payload) : null);
    const probeCache = { result: null, at: 0 };
    async function checkDatabase({ fresh = false } = {}) {
      if (!probeSource) return { ok: true, latencyMs: 0, stage: 'embedded', code: null };
      const ttl = probeCache.result?.ok ? 15_000 : 3_000;
      if (!fresh && probeCache.result && Date.now() - probeCache.at < ttl) return probeCache.result;
      const result = await probeSource({ timeoutMs: 4_000 });
      probeCache.result = result;
      probeCache.at = Date.now();
      return result;
    }
    const debug = String(env.VERCEL_ENV || '').trim().toLowerCase() === 'preview';
    const service = createStudentAuth({
      repository,
      sendOtpEmail,
      otpSecret,
      ...(dependencies.serviceOptions || {})
    });
    return Object.freeze({ ...service, required: true, ready: true, disabled: false, pool, debug, checkDatabase });
  } catch (error) {
    if (pool) pool.end().catch(() => {});
    return Object.freeze({
      required: true, ready: false, disabled: false,
      missing: ['AUTH_RUNTIME_INITIALIZATION_FAILED'],
      initError: String(error?.code || error?.name || 'AUTH_RUNTIME_INITIALIZATION_FAILED')
    });
  }
}
