/* Intégration HTTP locale : le vrai routeur utilise le service étudiant,
   mais un repository mémoire et un expéditeur factice remplacent les services réels. */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createApp } from '../server/index.mjs';
import { createStudentAuthMemoryRepository } from './helpers/student-auth-memory-repository.mjs';

const DEVICE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const ALLOWED = '202600000001@univ-constantine3.dz';
const OTHER = '202600000002@univ-constantine3.dz';
const FAKE_SECRET = Buffer.alloc(32, 0x5a);
const OWNER_PASSWORD = 'owner-integration-test-password-not-a-real-secret';
const OWNER_SALT = Buffer.alloc(16, 0x33);
const OWNER_HASH = crypto.scryptSync(OWNER_PASSWORD, OWNER_SALT, 32, {
  N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024
});
const OWNER_VERIFIER = `scrypt$16384$8$1$${OWNER_SALT.toString('base64url')}$${OWNER_HASH.toString('base64url')}`;
let app, base, mail, repository;

before(async () => {
  mail = { messages: [], send: async message => { mail.messages.push({ ...message }); } };
  repository = createStudentAuthMemoryRepository({ whitelist: [ALLOWED] });
  app = createApp({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'urbatrame-student-auth-')),
    cooldownMs: 0,
    studentAuthOptions: {
      env: {
        FM_STUDENT_AUTH: 'required',
        FM_AUTH_OTP_KEY: FAKE_SECRET.toString('base64'),
        FM_OWNER_AUTH: 'required',
        FM_OWNER_PASSWORD_HASH: OWNER_VERIFIER
      },
      dependencies: {
        repository,
        sendOtpEmail: mail.send,
        otpSecret: FAKE_SECRET,
        serviceOptions: { randomInt: () => 123456 }
      }
    }
  });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${app.server.address().port}`;
});

after(() => {
  app.server.close(); app.runs.stop();
});

async function post(pathname, body, { cookie = '', origin = base } = {}) {
  const headers = { 'Content-Type': 'application/json', Origin: origin };
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(base + pathname, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json(), headers: response.headers };
}
async function get(pathname, { cookie = '', origin } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (origin) headers.Origin = origin;
  const response = await fetch(base + pathname, { headers });
  return { status: response.status, body: await response.json(), headers: response.headers };
}

let sessionCookie = '';
let ownerSessionCookie = '';

describe('authentification étudiante — API locale isolée', () => {
  test('le statut indique que l’auth est requise et prête, sans divulguer de secrets', async () => {
    const { body, status } = await get('/api/status');
    assert.equal(status, 200);
    assert.deepEqual(body.auth, { required: true, ready: true, ownerLoginReady: true });
    assert.equal(JSON.stringify(body).includes(FAKE_SECRET.toString('base64')), false);
    assert.equal(JSON.stringify(body).includes(OWNER_VERIFIER), false);
  });

  test('une requête d’analyse anonyme est bloquée avant tout traitement', async () => {
    const result = await post('/analysis/2d', {
      action: 'begin', device: DEVICE, ids: ['density'], radius: 600, lat: 36.26, lon: 6.69
    });
    assert.equal(result.status, 401);
    assert.equal(result.body.error, 'STUDENT_AUTH_REQUIRED');
  });

  test('une origine web étrangère ne peut pas demander un code', async () => {
    const result = await post('/api/auth/request-otp', { email: ALLOWED }, { origin: 'https://attacker.example' });
    assert.equal(result.status, 403);
    assert.equal(mail.messages.length, 0);
  });

  test('adresse listée/non listée : réponse identique; seul le test synthétique listé reçoit un message factice', async () => {
    const allowed = await post('/api/auth/request-otp', { email: ALLOWED });
    const denied = await post('/api/auth/request-otp', { email: OTHER });
    assert.equal(allowed.status, 202);
    assert.deepEqual(allowed.body, denied.body);
    assert.equal('code' in allowed.body, false);
    assert.equal(mail.messages.length, 1);
    assert.equal(mail.messages[0].to, ALLOWED);
    assert.equal(mail.messages[0].code, '123456');
  });

  test('OTP valide pose un cookie HttpOnly et ne renvoie pas le jeton au JavaScript', async () => {
    const result = await post('/api/auth/verify-otp', { email: ALLOWED, code: mail.messages[0].code });
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.user.tier, 'max');
    assert.deepEqual(result.body.user.entitlements, { pro: true, max: true });
    assert.equal('sessionToken' in result.body, false);
    const cookie = result.headers.get('set-cookie');
    assert.match(cookie, /ut_student_session=/);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    sessionCookie = cookie.split(';')[0];
  });

  test('la session est valide et les identifiants internes ne sont pas exposés', async () => {
    const result = await get('/api/auth/session', { cookie: sessionCookie });
    assert.equal(result.status, 200);
    assert.equal(result.body.authenticated, true);
    assert.equal(result.body.user.tier, 'max');
    assert.equal('id' in result.body.user, false);
  });

  test('le propriétaire se connecte par mot de passe seul avec rôle admin distinct', async () => {
    const messagesBefore = mail.messages.length;
    const wrong = await post('/api/auth/session', { password: 'definitely-not-the-owner-password' });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.error, 'INVALID_CREDENTIALS');
    assert.equal(wrong.headers.get('set-cookie'), null);

    const result = await post('/api/auth/session', { password: OWNER_PASSWORD });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.ok, true);
    assert.equal(result.body.user.role, 'admin');
    assert.equal(result.body.user.isOwner, true);
    assert.equal(result.body.user.tier, 'max');
    assert.equal('email' in result.body.user, false);
    assert.equal('sessionToken' in result.body, false);
    const cookie = result.headers.get('set-cookie');
    assert.match(cookie, /ut_owner_session=/);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Strict/i);
    ownerSessionCookie = cookie.split(';')[0];
    assert.equal(mail.messages.length, messagesBefore, 'owner password login does not send OTP mail');

    const session = await get('/api/auth/session', { cookie: ownerSessionCookie });
    assert.equal(session.status, 200);
    assert.equal(session.body.authenticated, true);
    assert.equal(session.body.user.role, 'admin');
    assert.equal(session.body.user.isOwner, true);
    assert.equal('email' in session.body.user, false);
  });

  test('la session propriétaire garde le rôle admin et le niveau Max sur une API protégée', async () => {
    const begin = await post('/analysis/2d', {
      action: 'begin', device: DEVICE, ids: ['density'], radius: 600, lat: 36.26, lon: 6.69
    }, { cookie: ownerSessionCookie });
    assert.equal(begin.status, 200, JSON.stringify(begin.body));
    assert.equal(begin.body.tier, 'max');
    assert.equal(begin.body.access, 'owner');
    const end = await post('/analysis/2d', { action: 'end', device: DEVICE, run: begin.body.run }, { cookie: ownerSessionCookie });
    assert.equal(end.status, 200);
  });

  test('un étudiant connecté est bien Max même si le régime historique FM_ACCESS est ouvert', async () => {
    const begin = await post('/analysis/2d', {
      action: 'begin', device: DEVICE, ids: ['density'], radius: 600, lat: 36.26, lon: 6.69
    }, { cookie: sessionCookie });
    assert.equal(begin.status, 200, JSON.stringify(begin.body));
    assert.equal(begin.body.tier, 'max');
    assert.equal(begin.body.access, 'student');
    const end = await post('/analysis/2d', { action: 'end', device: DEVICE, run: begin.body.run }, { cookie: sessionCookie });
    assert.equal(end.status, 200);
  });

  test('les API des ateliers intégrés refusent aussi les visiteurs anonymes', async () => {
    const result = await get('/api/atelier/health');
    assert.equal(result.status, 401);
    assert.equal(result.body.error, 'STUDENT_AUTH_REQUIRED');
  });

  test('la déconnexion révoque la session et efface le cookie', async () => {
    const result = await post('/api/auth/logout', {}, { cookie: sessionCookie });
    assert.equal(result.status, 200);
    assert.match(result.headers.get('set-cookie'), /Max-Age=0/);
    assert.match(result.headers.get('set-cookie'), /ut_student_session=/);
    assert.match(result.headers.get('set-cookie'), /ut_owner_session=/);
    const after = await get('/api/auth/session', { cookie: sessionCookie });
    assert.equal(after.body.authenticated, false);
  });
});
