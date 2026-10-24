/* Envoi d'OTP par SMTP configurable (institution, Resend, Mailgun, SendGrid,
   ou autre relais SMTP). Aucun repli console : sans secrets de messagerie,
   l'authentification reste non configurée et n'envoie aucun code. */
import nodemailer from 'nodemailer';

const required = ['FM_AUTH_SMTP_HOST', 'FM_AUTH_SMTP_USER', 'FM_AUTH_SMTP_PASSWORD', 'FM_AUTH_EMAIL_FROM'];

export function studentMailConfiguration(env = process.env) {
  const missing = required.filter(key => !String(env[key] || '').trim());
  const port = Number(env.FM_AUTH_SMTP_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) missing.push('FM_AUTH_SMTP_PORT');
  return { configured: missing.length === 0, missing, port };
}

export function createStudentOtpMailer({ env = process.env } = {}) {
  const config = studentMailConfiguration(env);
  if (!config.configured) throw new Error('STUDENT_AUTH_MAIL_NOT_CONFIGURED');
  const secure = String(env.FM_AUTH_SMTP_SECURE || '').toLowerCase() === 'true' || config.port === 465;
  const transport = nodemailer.createTransport({
    host: String(env.FM_AUTH_SMTP_HOST).trim(),
    port: config.port,
    secure,
    auth: {
      user: String(env.FM_AUTH_SMTP_USER),
      pass: String(env.FM_AUTH_SMTP_PASSWORD)
    },
    requireTLS: !secure,
    tls: { minVersion: 'TLSv1.2' },
    connectionTimeout: 8_000,
    greetingTimeout: 8_000,
    socketTimeout: 12_000,
    pool: false
  });
  const from = String(env.FM_AUTH_EMAIL_FROM).trim();
  const fromName = String(env.FM_AUTH_EMAIL_NAME || 'UrbaTrame').trim().slice(0, 80);

  return async function sendOtpEmail({ to, code, expiresAt }) {
    if (!/^\d{6}$/.test(String(code))) throw new TypeError('INVALID_OTP_FORMAT');
    const expiration = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
    if (!Number.isFinite(expiration.getTime())) throw new TypeError('INVALID_OTP_EXPIRY');
    const localeDate = expiration.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
    return transport.sendMail({
      from: { name: fromName, address: from },
      to,
      subject: 'Votre code de connexion UrbaTrame',
      text: `Votre code de vérification UrbaTrame est : ${code}\n\nIl expire dans 10 minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#1b342c"><h2>UrbaTrame</h2><p>Votre code de vérification est :</p><p style="font:700 30px monospace;letter-spacing:.18em;padding:16px;background:#f2f5ef;border-radius:12px;text-align:center">${code}</p><p>Il expire dans 10 minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.</p><hr><small>Si possible, saisissez le code avant ${localeDate} UTC.</small></div>`,
      headers: { 'X-Auto-Response-Suppress': 'All' }
    });
  };
}
