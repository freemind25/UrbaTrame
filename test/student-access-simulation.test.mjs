/* Essai local du service réel d'authentification : données synthétiques,
   repository mémoire et transport e-mail factice; aucun compte ou service réel. */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createStudentAuth, GENERIC_OTP_RESPONSE,
  OTP_MAX_ATTEMPTS, OTP_TTL_MS, OTP_RESEND_COOLDOWN_MS
} from '../server/student-auth.mjs';
import { createStudentAuthMemoryRepository } from './helpers/student-auth-memory-repository.mjs';

const ALLOWED = '202600000001@univ-constantine3.dz';
const OTHER = '202600000002@univ-constantine3.dz';
const FAKE_SECRET = Buffer.alloc(32, 0x5a);

function setup(overrides = {}) {
  let clock = 1_800_000_000_000;
  const mail = { messages: [], send: async message => { mail.messages.push({ ...message }); } };
  const repository = createStudentAuthMemoryRepository({ whitelist: [ALLOWED] });
  let codeIndex = 0, idIndex = 0;
  const codes = [482901, 730164, 5217, 914603];
  const auth = createStudentAuth({
    repository,
    sendOtpEmail: mail.send,
    otpSecret: FAKE_SECRET,
    now: () => clock,
    randomInt: () => codes[codeIndex++ % codes.length],
    uuid: () => `00000000-0000-4000-8000-${String(++idIndex).padStart(12, '0')}`,
    ...overrides
  });
  return { auth, mail, repository, now: () => clock, advance: ms => { clock += ms; } };
}

describe('essai local synthétique : liste blanche + OTP étudiant', () => {
  test('une adresse autorisée reçoit un OTP factice; une autre reçoit la même réponse mais aucun mail', async () => {
    const { auth, mail } = setup();
    const allowedResponse = await auth.requestOtp({ email: `  ${ALLOWED.toUpperCase()} `, ip: '127.0.0.1' });
    const deniedResponse = await auth.requestOtp({ email: OTHER, ip: '127.0.0.1' });
    assert.deepEqual(allowedResponse, GENERIC_OTP_RESPONSE);
    assert.deepEqual(deniedResponse, GENERIC_OTP_RESPONSE);
    assert.deepEqual(allowedResponse, deniedResponse);
    assert.equal(mail.messages.length, 1);
    assert.equal(mail.messages[0].to, ALLOWED);
    assert.match(mail.messages[0].code, /^\d{6}$/);
    assert.equal(mail.messages[0].code, '482901');
    assert.equal(auth.requestOtp instanceof Function, true);
    assert.equal((await auth.verifyOtp({ email: OTHER, code: mail.messages[0].code })).ok, false);
  });

  test('le suffixe seul ne suffit pas : domaine trompeur et adresse non listée ne reçoivent pas de mail', async () => {
    const { auth, mail } = setup();
    const impostor = '202600000001@univ-constantine3.dz.attacker.example';
    assert.deepEqual(await auth.requestOtp({ email: impostor, ip: '127.0.0.1' }), GENERIC_OTP_RESPONSE);
    assert.deepEqual(await auth.requestOtp({ email: '202600000001@autre-universite.dz', ip: '127.0.0.1' }), GENERIC_OTP_RESPONSE);
    assert.equal(mail.messages.length, 0);
  });

  test('OTP correct : compte Max créé, droits Pro inclus; le code stocké est un HMAC', async () => {
    const { auth, mail, repository } = setup();
    await auth.requestOtp({ email: ALLOWED, ip: '127.0.0.1' });
    const storedChallenge = repository.testState.challengeFor(ALLOWED);
    assert.match(storedChallenge.codeMac, /^[a-f0-9]{64}$/);
    assert.equal('code' in storedChallenge, false);
    assert.notEqual(storedChallenge.codeMac, mail.messages[0].code);
    const result = await auth.verifyOtp({ email: ALLOWED, code: mail.messages[0].code });
    assert.equal(result.ok, true);
    assert.equal(result.user.email, ALLOWED);
    assert.equal(result.user.emailVerified, true);
    assert.equal(result.user.role, 'student');
    assert.equal(result.user.tier, 'max');
    assert.deepEqual(result.user.entitlements, { pro: true, max: true });
    assert.equal(repository.testState.userCount(), 1);
    assert.equal((await auth.getSession(result.sessionToken)).tier, 'max');
  });

  test('code erroné n’ouvre pas de compte; après cinq essais, le bon code est bloqué', async () => {
    const { auth, mail, repository } = setup();
    await auth.requestOtp({ email: ALLOWED, ip: '127.0.0.1' });
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      assert.deepEqual(await auth.verifyOtp({ email: ALLOWED, code: '000000' }), {
        ok: false, error: 'INVALID_OR_EXPIRED_CODE'
      });
    }
    assert.deepEqual(await auth.verifyOtp({ email: ALLOWED, code: mail.messages[0].code }), {
      ok: false, error: 'INVALID_OR_EXPIRED_CODE'
    });
    assert.equal(repository.testState.userCount(), 0);
  });

  test('OTP expiré après dix minutes', async () => {
    const { auth, mail, repository, advance } = setup();
    await auth.requestOtp({ email: ALLOWED, ip: '127.0.0.1' });
    advance(OTP_TTL_MS + 1);
    assert.deepEqual(await auth.verifyOtp({ email: ALLOWED, code: mail.messages[0].code }), {
      ok: false, error: 'INVALID_OR_EXPIRED_CODE'
    });
    assert.equal(repository.testState.userCount(), 0);
  });

  test('OTP à usage unique : une réutilisation ne crée pas une seconde session', async () => {
    const { auth, mail, repository } = setup();
    await auth.requestOtp({ email: ALLOWED, ip: '127.0.0.1' });
    const first = await auth.verifyOtp({ email: ALLOWED, code: mail.messages[0].code });
    const replay = await auth.verifyOtp({ email: ALLOWED, code: mail.messages[0].code });
    assert.equal(first.ok, true);
    assert.deepEqual(replay, { ok: false, error: 'INVALID_OR_EXPIRED_CODE' });
    assert.equal(repository.testState.userCount(), 1);
  });

  test('renvoi soumis à un délai et remplace l’ancien OTP', async () => {
    const { auth, mail, advance } = setup();
    await auth.requestOtp({ email: ALLOWED, ip: '127.0.0.1' });
    await auth.requestOtp({ email: ALLOWED, ip: '127.0.0.1' }); // bloqué par le délai
    assert.equal(mail.messages.length, 1);
    advance(OTP_RESEND_COOLDOWN_MS);
    await auth.requestOtp({ email: ALLOWED, ip: '127.0.0.1' });
    assert.equal(mail.messages.length, 2);
    assert.deepEqual(await auth.verifyOtp({ email: ALLOWED, code: mail.messages[0].code }), {
      ok: false, error: 'INVALID_OR_EXPIRED_CODE'
    });
    assert.equal((await auth.verifyOtp({ email: ALLOWED, code: mail.messages[1].code })).ok, true);
  });

  test('trois envois par heure au maximum, sans réponse révélant la présence dans la liste', async () => {
    const { auth, mail, advance } = setup();
    const responses = [];
    for (let i = 0; i < 4; i++) {
      if (i) advance(OTP_RESEND_COOLDOWN_MS);
      responses.push(await auth.requestOtp({ email: ALLOWED, ip: '127.0.0.1' }));
    }
    assert.equal(mail.messages.length, 3);
    assert.ok(responses.every(r => JSON.stringify(r) === JSON.stringify(GENERIC_OTP_RESPONSE)));
  });

  test('retirer l’adresse de la liste bloque immédiatement une session existante', async () => {
    const { auth, mail, repository } = setup();
    await auth.requestOtp({ email: ALLOWED, ip: '127.0.0.1' });
    const login = await auth.verifyOtp({ email: ALLOWED, code: mail.messages[0].code });
    assert.equal((await auth.getSession(login.sessionToken)).email, ALLOWED);
    repository.setWhitelistForTest(ALLOWED, false);
    assert.equal(await auth.getSession(login.sessionToken), null);
  });
});
