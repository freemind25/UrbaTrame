/* Adaptateur en mémoire réservé aux tests de server/student-auth.mjs.
   Il n'est jamais utilisé par l'application ni par le serveur local. */
import crypto from 'node:crypto';
import { normalizeStudentEmail } from '../../server/student-auth.mjs';

function matchesMac(a, b) {
  if (!/^[a-f0-9]{64}$/i.test(String(a)) || !/^[a-f0-9]{64}$/i.test(String(b))) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

export function createStudentAuthMemoryRepository({ whitelist = [] } = {}) {
  const allowed = new Set(whitelist.map(normalizeStudentEmail).filter(Boolean));
  const challenges = new Map();
  const sends = [];
  const users = new Map();
  const sessions = new Map();

  return {
    async issueOtpChallenge(args) {
      const { email, ipHash, now, challengeId, codeMac, expiresAt,
        cooldownMs, maxEmailsPerHour, maxIpRequestsPerHour } = args;
      if (!allowed.has(email)) return { status: 'not_allowed' };
      const cutoff = now.getTime() - 60 * 60_000;
      const recent = sends.filter(x => x.at.getTime() > cutoff);
      const perEmail = recent.filter(x => x.email === email);
      const perIp = recent.filter(x => x.ipHash === ipHash);
      const last = perEmail.at(-1)?.at.getTime();
      if (perEmail.length >= maxEmailsPerHour || perIp.length >= maxIpRequestsPerHour ||
          (last !== undefined && now.getTime() - last < cooldownMs)) return { status: 'rate_limited' };
      const old = challenges.get(email);
      if (old && !old.consumedAt) old.invalidatedAt = now;
      challenges.set(email, {
        id: challengeId, email, codeMac, createdAt: now, expiresAt,
        attemptsCount: 0, consumedAt: null, invalidatedAt: null
      });
      sends.push({ email, ipHash, at: now });
      return { status: 'issued', challengeId };
    },

    async invalidateOtpChallenge(challengeId, now) {
      const c = [...challenges.values()].find(x => x.id === challengeId);
      if (c && !c.consumedAt) c.invalidatedAt = now;
    },

    async consumeOtpChallenge({ email, codeMac, now, maxAttempts, userId, sessionId, sessionHash, sessionExpiresAt }) {
      if (!allowed.has(email)) return { ok: false };
      const c = challenges.get(email);
      if (!c || c.consumedAt || c.invalidatedAt || c.expiresAt.getTime() <= now.getTime() || c.attemptsCount >= maxAttempts)
        return { ok: false };
      if (!matchesMac(c.codeMac, codeMac)) {
        c.attemptsCount += 1;
        if (c.attemptsCount >= maxAttempts) c.invalidatedAt = now;
        return { ok: false };
      }
      c.consumedAt = now;
      let user = users.get(email);
      if (!user) {
        user = {
          id: userId, email, role: 'student', tier: 'max', isActive: true,
          emailVerifiedAt: now, createdAt: now
        };
        users.set(email, user);
      } else if (!user.isActive) return { ok: false };
      sessions.set(sessionHash, { id: sessionId, email, expiresAt: sessionExpiresAt, revokedAt: null });
      return { ok: true, user };
    },

    async getActiveSession(sessionHash, now) {
      const session = sessions.get(sessionHash);
      if (!session || session.revokedAt || session.expiresAt <= now || !allowed.has(session.email)) return null;
      const user = users.get(session.email);
      if (!user?.isActive) return null;
      return {
        id: user.id, email: user.email, role: user.role, tier: user.tier,
        emailVerifiedAt: user.emailVerifiedAt, expiresAt: session.expiresAt
      };
    },

    async revokeSession(sessionHash, now) {
      const session = sessions.get(sessionHash);
      if (!session || session.revokedAt) return false;
      session.revokedAt = now;
      return true;
    },

    setWhitelistForTest(input, isAllowed) {
      const email = normalizeStudentEmail(input);
      if (isAllowed) allowed.add(email); else allowed.delete(email);
    },

    testState: Object.freeze({
      userCount: () => users.size,
      challengeFor: input => {
        const email = normalizeStudentEmail(input);
        const challenge = email ? challenges.get(email) : null;
        return challenge ? { ...challenge } : null;
      }
    })
  };
}
