/* Adaptateur PostgreSQL pour l'authentification étudiante.
   En production, utiliser une URL PostgreSQL TLS/poolée avec un rôle applicatif
   en lecture seule sur la liste blanche. La gestion de cette liste est séparée. */
import crypto from 'node:crypto';
import { Pool } from 'pg';

function sameMac(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !/^[a-f0-9]{64}$/i.test(a) || !/^[a-f0-9]{64}$/i.test(b))
    return false;
  const left = Buffer.from(a, 'hex'), right = Buffer.from(b, 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function createStudentAuthPool({ connectionString, max = 1, ssl = true } = {}) {
  if (!connectionString) throw new TypeError('FM_AUTH_DATABASE_URL_REQUIRED');
  /* Si l'URL porte déjà sslmode=, pg s'en sert seul : lui superposer un objet
     ssl contradictoire crée une configuration ambiguë (brianc/node-postgres
     #3355). On ne construit donc un objet ssl que sans sslmode explicite. */
  let urlSslMode = null;
  try { urlSslMode = new URL(connectionString).searchParams.get('sslmode'); } catch { /* URL relative ou vide */ }
  const sslOption = !ssl ? false : (urlSslMode ? undefined : { rejectUnauthorized: true });
  return new Pool({
    connectionString,
    enableChannelBinding: true,
    max,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
    allowExitOnIdle: true,
    ...(sslOption === undefined ? {} : { ssl: sslOption }),
    application_name: 'UrbaTrame-student-auth'
  });
}

export function createPostgresStudentAuthRepository(pool) {
  if (!pool || typeof pool.connect !== 'function') throw new TypeError('POSTGRES_POOL_REQUIRED');

  async function transaction(callback) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* connexion déjà fermée */ }
      throw error;
    } finally { client.release(); }
  }

  async function issueOtpChallenge({
    challengeId, email, codeMac, ipHash, now, expiresAt,
    cooldownMs, maxEmailsPerHour, maxIpRequestsPerHour
  }) {
    return transaction(async client => {
      /* Sérialise les demandes concurrentes pour une adresse et une IP. */
      const lockKeys = [`email:${email}`, `ip:${ipHash}`].sort();
      for (const key of lockKeys)
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);

      /* Les verrous advisory par email et par IP sérialisent déjà les demandes.
         Pas de FOR SHARE ici : PostgreSQL refuse les verrous de ligne sans
         privilège d'écriture, et le rôle applicatif n'en a — volontairement —
         aucun sur la liste blanche (voir docs/ACCES-ETUDIANTS-OTP.md). */
      const allowed = await client.query(
        'SELECT is_active FROM whitelisted_students WHERE email = $1 LIMIT 1', [email]);
      if (!allowed.rows[0]?.is_active) return { status: 'not_allowed' };

      const cutoff = new Date(now.getTime() - 60 * 60_000);
      const [emailStats, ipStats] = await Promise.all([
        client.query(
          'SELECT COUNT(*)::int AS count, MAX(created_at) AS last_sent FROM otp_send_events WHERE email = $1 AND created_at > $2',
          [email, cutoff]),
        client.query(
          'SELECT COUNT(*)::int AS count FROM otp_send_events WHERE ip_hash = $1 AND created_at > $2',
          [ipHash, cutoff])
      ]);
      const emailCount = Number(emailStats.rows[0]?.count || 0);
      const ipCount = Number(ipStats.rows[0]?.count || 0);
      const lastSent = emailStats.rows[0]?.last_sent ? new Date(emailStats.rows[0].last_sent).getTime() : 0;
      if (emailCount >= maxEmailsPerHour || ipCount >= maxIpRequestsPerHour ||
          (lastSent && now.getTime() - lastSent < cooldownMs)) return { status: 'rate_limited' };

      await client.query(
        `UPDATE otp_verifications
         SET invalidated_at = $2
         WHERE email = $1 AND consumed_at IS NULL AND invalidated_at IS NULL`,
        [email, now]);
      await client.query(
        `INSERT INTO otp_verifications
          (id, email, code_mac, created_at, expires_at, attempts_count)
         VALUES ($1, $2, $3, $4, $5, 0)`,
        [challengeId, email, codeMac, now, expiresAt]);
      await client.query(
        'INSERT INTO otp_send_events (email, ip_hash, created_at) VALUES ($1, $2, $3)',
        [email, ipHash, now]);
      /* Bornes de rétention : les défis ne servent plus après une journée; les
         événements ne sont gardés que pour calculer les limites d'envoi. */
      await client.query('DELETE FROM otp_verifications WHERE created_at < $1', [new Date(now.getTime() - 24 * 60 * 60_000)]);
      await client.query('DELETE FROM otp_send_events WHERE created_at < $1', [new Date(now.getTime() - 48 * 60 * 60_000)]);
      return { status: 'issued', challengeId };
    });
  }

  async function invalidateOtpChallenge(challengeId, now) {
    await pool.query(
      `UPDATE otp_verifications
       SET invalidated_at = $2
       WHERE id = $1 AND consumed_at IS NULL AND invalidated_at IS NULL`,
      [challengeId, now]);
  }

  async function consumeOtpChallenge({
    email, codeMac, now, maxAttempts,
    userId, sessionId, sessionHash, sessionExpiresAt
  }) {
    return transaction(async client => {
      /* Même raisonnement que dans issueOtpChallenge : SELECT seul, pas de
         FOR SHARE (refusé sans privilège d'écriture sur cette table). */
      const allowed = await client.query(
        'SELECT is_active FROM whitelisted_students WHERE email = $1 LIMIT 1', [email]);
      if (!allowed.rows[0]?.is_active) return { ok: false };

      const selected = await client.query(
        `SELECT id, code_mac, expires_at, attempts_count, consumed_at, invalidated_at
         FROM otp_verifications
         WHERE email = $1
         ORDER BY created_at DESC
         LIMIT 1
         FOR UPDATE`,
        [email]);
      const challenge = selected.rows[0];
      if (!challenge || challenge.consumed_at || challenge.invalidated_at ||
          new Date(challenge.expires_at).getTime() <= now.getTime() ||
          Number(challenge.attempts_count) >= maxAttempts) return { ok: false };

      if (!sameMac(challenge.code_mac, codeMac)) {
        const nextAttempts = Number(challenge.attempts_count) + 1;
        await client.query(
          `UPDATE otp_verifications
           SET attempts_count = $2,
               invalidated_at = CASE WHEN $2 >= $3 THEN $4 ELSE invalidated_at END
           WHERE id = $1`,
          [challenge.id, nextAttempts, maxAttempts, now]);
        return { ok: false };
      }

      await client.query('UPDATE otp_verifications SET consumed_at = $2 WHERE id = $1', [challenge.id, now]);
      const userResult = await client.query(
        `INSERT INTO student_users
          (id, email, role, tier, email_verified_at, created_at, last_login_at, is_active)
         VALUES ($1, $2, 'student', 'max', $3, $3, $3, TRUE)
         ON CONFLICT (email) DO UPDATE
         SET email_verified_at = COALESCE(student_users.email_verified_at, EXCLUDED.email_verified_at),
             last_login_at = EXCLUDED.last_login_at
         WHERE student_users.is_active = TRUE
         RETURNING id, email, role, tier, email_verified_at`,
        [userId, email, now]);
      const user = userResult.rows[0];
      if (!user) return { ok: false };

      await client.query(
        `INSERT INTO student_sessions
          (id, user_id, token_hash, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [sessionId, user.id, sessionHash, now, sessionExpiresAt]);
      return { ok: true, user };
    });
  }

  async function getActiveSession(sessionHash, now) {
    const result = await pool.query(
      `SELECT u.id, u.email, u.role, u.tier, u.email_verified_at AS "emailVerifiedAt",
              s.expires_at AS "expiresAt"
       FROM student_sessions s
       JOIN student_users u ON u.id = s.user_id
       JOIN whitelisted_students w ON w.email = u.email
       WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > $2
         AND u.is_active = TRUE AND w.is_active = TRUE
       LIMIT 1`,
      [sessionHash, now]);
    return result.rows[0] || null;
  }

  async function revokeSession(sessionHash, now) {
    const result = await pool.query(
      `UPDATE student_sessions SET revoked_at = $2
       WHERE token_hash = $1 AND revoked_at IS NULL`,
      [sessionHash, now]);
    return result.rowCount > 0;
  }

  return Object.freeze({
    issueOtpChallenge,
    invalidateOtpChallenge,
    consumeOtpChallenge,
    getActiveSession,
    revokeSession,
    close: () => pool.end(),
    ping: async () => { await pool.query('SELECT 1'); return true; }
  });
}
