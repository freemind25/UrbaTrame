/* Assemblage paresseux du service d'authentification. L'accès reste désactivé
   tant que FM_STUDENT_AUTH=required n'est pas explicitement défini. Si ce mode
   est demandé sans secrets/base/mail, les routes protégées échouent fermées. */
import { createStudentAuth } from './student-auth.mjs';
import { createStudentAuthPool, createPostgresStudentAuthRepository } from './student-auth-postgres.mjs';
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
    const service = createStudentAuth({
      repository,
      sendOtpEmail,
      otpSecret,
      ...(dependencies.serviceOptions || {})
    });
    return Object.freeze({ ...service, required: true, ready: true, disabled: false, pool });
  } catch (error) {
    if (pool) pool.end().catch(() => {});
    return Object.freeze({
      required: true, ready: false, disabled: false,
      missing: ['AUTH_RUNTIME_INITIALIZATION_FAILED'],
      initError: String(error?.code || error?.name || 'AUTH_RUNTIME_INITIALIZATION_FAILED')
    });
  }
}
