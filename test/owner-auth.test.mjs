import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createOwnerAuthRuntime, OWNER_SESSION_TTL_MS } from '../server/owner-auth.mjs';

const PASSWORD = 'owner-test-password-never-used-outside-this-test';
const SALT = Buffer.alloc(16, 0x41);
const OTP_SECRET = Buffer.alloc(32, 0x5b);
const HASH = crypto.scryptSync(PASSWORD, SALT, 32, {
  N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024
});
const ENV = {
  FM_OWNER_AUTH: 'required',
  FM_OWNER_PASSWORD_HASH: `scrypt$16384$8$1$${SALT.toString('base64url')}$${HASH.toString('base64url')}`,
  FM_AUTH_OTP_KEY: OTP_SECRET.toString('base64')
};

describe('authentification propriétaire distincte de l’OTP étudiant', () => {
  test('est désactivée par défaut', () => {
    const runtime = createOwnerAuthRuntime({ env: {} });
    assert.equal(runtime.required, false);
    assert.equal(runtime.ready, false);
    assert.equal(runtime.disabled, true);
  });

  test('échoue fermé si le vérificateur ou le secret de signature manque', () => {
    const runtime = createOwnerAuthRuntime({ env: { FM_OWNER_AUTH: 'required' } });
    assert.equal(runtime.required, true);
    assert.equal(runtime.ready, false);
    assert.deepEqual(runtime.missing.sort(), ['FM_AUTH_OTP_KEY', 'FM_OWNER_PASSWORD_HASH']);
  });

  test('mot de passe exact → rôle admin et cookie signé; mot de passe erroné refusé', async () => {
    const runtime = createOwnerAuthRuntime({ env: ENV });
    assert.equal(runtime.ready, true);
    assert.equal(runtime.sessionTtlMs, OWNER_SESSION_TTL_MS);

    const wrong = await runtime.authenticate({ password: 'incorrect-password-long-enough', ip: '198.51.100.8' });
    assert.deepEqual(wrong, { ok: false });

    const signedIn = await runtime.authenticate({ password: PASSWORD, ip: '198.51.100.8' });
    assert.equal(signedIn.ok, true);
    assert.equal(signedIn.user.role, 'admin');
    assert.equal(signedIn.user.isOwner, true);
    assert.equal(signedIn.user.tier, 'max');
    assert.equal(typeof signedIn.sessionToken, 'string');
    const session = runtime.getSession(signedIn.sessionToken);
    assert.equal(session.role, 'admin');
    assert.equal(session.id, 'owner');
    assert.equal(runtime.getSession(`${signedIn.sessionToken}x`), null);
  });

  test('limite les essais à cinq par IP et laisse une autre IP continuer', async () => {
    const runtime = createOwnerAuthRuntime({ env: ENV });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await runtime.authenticate({ password: 'incorrect-owner-password', ip: '198.51.100.10' });
      assert.deepEqual(result, { ok: false });
    }
    assert.deepEqual(
      await runtime.authenticate({ password: PASSWORD, ip: '198.51.100.10' }),
      { ok: false, rateLimited: true }
    );
    const otherIp = await runtime.authenticate({ password: PASSWORD, ip: '198.51.100.11' });
    assert.equal(otherIp.ok, true);
  });

  test('session expirée invalidée côté serveur sans accès à la base étudiante', async () => {
    let now = 10_000;
    const runtime = createOwnerAuthRuntime({ env: ENV, now: () => now, sessionTtlMs: 1_000 });
    const signedIn = await runtime.authenticate({ password: PASSWORD, ip: '198.51.100.9' });
    assert.ok(runtime.getSession(signedIn.sessionToken));
    now += 1_001;
    assert.equal(runtime.getSession(signedIn.sessionToken), null);
  });
});
