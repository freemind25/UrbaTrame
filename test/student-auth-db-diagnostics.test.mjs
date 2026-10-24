/* Diagnostics de connexion PostgreSQL : classification des échecs, sonde
   SELECT 1 bornée, et comportement des routes quand la base est injoignable.
   Aucun réseau ni PostgreSQL réel n'est utilisé : uniquement des adaptateurs
   factices. */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { classifyDatabaseError, probeDatabase } from '../server/student-auth-diagnostics.mjs';
import { createStudentAuthHandlers, requireStudentSession } from '../server/student-auth-http.mjs';
import { createStudentAuthRuntime } from '../server/student-auth-runtime.mjs';
import { createStatusHandler } from '../server/api.mjs';

function fakeRes() {
  return {
    statusCode: 200, headers: {}, body: '',
    setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
    writeHead(code, headers) { this.statusCode = code; for (const [k, v] of Object.entries(headers || {})) this.setHeader(k, v); },
    end(chunk) { this.body = chunk ?? ''; },
    get json() { try { return JSON.parse(this.body); } catch { return null; } }
  };
}

function fakeReq(method = 'POST', body = { email: 'test@univ-constantine3.dz' }) {
  return {
    method, body,
    headers: { host: 'urbatrame.example', origin: 'https://urbatrame.example', 'content-type': 'application/json' },
    socket: {}
  };
}

const FAKE_SECRET = Buffer.alloc(32, 0x5a);
const failingProbe = async () => ({ ok: false, latencyMs: 12, stage: 'auth', code: '28P01' });
const okProbe = async () => ({ ok: true, latencyMs: 3, stage: 'ready', code: null });

describe('classification des erreurs de connexion', () => {
  test('classe le code PostgreSQL 42P08 comme une erreur de requête', () => {
    assert.deepEqual(classifyDatabaseError({ code: '42P08' }), { stage: 'query', code: '42P08' });
  });

  test('range chaque échec connu sous une étape exploitable', () => {
    assert.deepEqual(classifyDatabaseError({ code: 'ENOTFOUND' }), { stage: 'dns', code: 'ENOTFOUND' });
    assert.deepEqual(classifyDatabaseError({ code: 'ECONNREFUSED' }), { stage: 'tcp', code: 'ECONNREFUSED' });
    assert.deepEqual(classifyDatabaseError({ code: 'ETIMEDOUT' }), { stage: 'tcp', code: 'ETIMEDOUT' });
    assert.deepEqual(classifyDatabaseError({ message: 'timeout exceeded when trying to connect' }),
      { stage: 'tcp', code: 'CONNECT_TIMEOUT' });
    assert.deepEqual(classifyDatabaseError({ code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }),
      { stage: 'tls', code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
    assert.deepEqual(classifyDatabaseError({ code: '28P01', message: 'password authentication failed' }),
      { stage: 'auth', code: '28P01' });
    assert.deepEqual(classifyDatabaseError({ code: '3D000' }), { stage: 'database', code: '3D000' });
    assert.deepEqual(classifyDatabaseError({ code: '42501' }), { stage: 'privilege', code: '42501' });
    assert.deepEqual(classifyDatabaseError({ code: '53300' }), { stage: 'capacity', code: '53300' });
    assert.deepEqual(classifyDatabaseError({ code: '08P01' }), { stage: 'connection', code: '08P01' });
    assert.deepEqual(classifyDatabaseError(new Error('boom')), { stage: 'query', code: 'UNKNOWN' });
  });

  test('classe les échecs client sans SQLSTATE sous des jetons fixes', () => {
    /* Mot de passe absent de la chaîne : pg lève une erreur SASL sans code. */
    assert.deepEqual(
      classifyDatabaseError(new Error('SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string')),
      { stage: 'auth', code: 'SASL_PASSWORD_MISSING' });
    assert.deepEqual(
      classifyDatabaseError(new Error('SASL channel binding: unknown OID when parsing public certificate AAAA')),
      { stage: 'auth', code: 'SASL_CHANNEL_BINDING' });
    assert.deepEqual(
      classifyDatabaseError(new Error('SASL: SCRAM-SERVER-FIRST-MESSAGE: server nonce does not start with client nonce')),
      { stage: 'auth', code: 'SASL_ERROR' });
    assert.deepEqual(classifyDatabaseError(new Error('Connection terminated unexpectedly')),
      { stage: 'connection', code: 'CONNECTION_TERMINATED' });
    assert.deepEqual(classifyDatabaseError(new Error('Client has encountered a connection error and cannot query')),
      { stage: 'connection', code: 'CLIENT_ERROR' });
    /* Fermeture TLS pendant l'amorçage (sslmode exigé par le pooler). */
    assert.deepEqual(classifyDatabaseError(new Error('The server does not support SSL connections')),
      { stage: 'tls', code: 'TLS_ERROR' });
    /* Un SQLSTATE reste prioritaire sur le message. */
    assert.equal(classifyDatabaseError({ code: '42501', message: 'Connection terminated' }).stage, 'privilege');
  });

  test('remonte le code d’une chaîne de causes et encode la classe au repli', () => {
    const root = Object.assign(new Error('échec encastré'), { code: 'ENOTFOUND' });
    const outer = new Error('échec enveloppé', { cause: root });
    assert.deepEqual(classifyDatabaseError(outer), { stage: 'dns', code: 'ENOTFOUND' });
    /* Sans jeton ni SQLSTATE, la classe d’erreur évite un UNKNOWN nu. */
    assert.deepEqual(classifyDatabaseError(new TypeError('boom')), { stage: 'query', code: 'UNKNOWN_TYPEERROR' });
  });

  test('ne propage ni le message complet ni une chaîne qui ressemblerait à une URL', () => {
    const { code, stage } = classifyDatabaseError({
      code: '28P01',
      message: 'password authentication failed for user "ut_auth_app" at postgresql://secret@ep-1.neon.tech/neondb'
    });
    assert.equal(stage, 'auth');
    assert.equal(code, '28P01');
  });
});

describe('sonde SELECT 1 bornée', () => {
  test('renvoie ready quand la requête aboutit', async () => {
    const pool = { query: async () => ({ rows: [{ disponibilite: 1 }] }) };
    const probe = await probeDatabase(pool);
    assert.equal(probe.ok, true);
    assert.equal(probe.stage, 'ready');
    assert.equal(probe.code, null);
    assert.ok(probe.latencyMs >= 0);
  });

  test('classe un refus de connexion sans lever d’exception', async () => {
    const error = new Error('connect ECONNREFUSED 127.0.0.1:5432');
    error.code = 'ECONNREFUSED';
    const pool = { query: async () => { throw error; } };
    const probe = await probeDatabase(pool);
    assert.equal(probe.ok, false);
    assert.equal(probe.stage, 'tcp');
    assert.equal(probe.code, 'ECONNREFUSED');
  });

  test('borne une requête qui ne répond jamais', async () => {
    const pool = { query: () => new Promise(() => {}) };
    const probe = await probeDatabase(pool, { timeoutMs: 30 });
    assert.equal(probe.ok, false);
    assert.equal(probe.code, 'CONNECT_TIMEOUT');
    assert.equal(probe.stage, 'tcp');
  });
});

describe('runtime : sonde de disponibilité et drapeau de débogage', () => {
  function runtimeWith(probe, env = {}) {
    let calls = 0;
    const repository = {
      async issueOtpChallenge() { return { status: 'issued' }; },
      async consumeOtpChallenge() { return { ok: false }; },
      async getActiveSession() { return null; },
      async revokeSession() { return false; },
      probe: async payload => { calls += 1; return probe(payload); }
    };
    const service = createStudentAuthRuntime({
      env: {
        FM_STUDENT_AUTH: 'required',
        FM_AUTH_DATABASE_URL: 'postgresql://user:pass@ep-test.neon.tech/neondb',
        ...env
      },
      dependencies: { repository, otpSecret: FAKE_SECRET, sendOtpEmail: async () => {} }
    });
    return { service, calls: () => calls };
  }

  test('met en cache un succès et force un rafraîchissement sur demande', async () => {
    const { service, calls } = runtimeWith(okProbe);
    assert.equal(service.ready, true);
    assert.equal(typeof service.checkDatabase, 'function');
    assert.equal((await service.checkDatabase()).ok, true);
    assert.equal((await service.checkDatabase()).ok, true);
    assert.equal(calls(), 1, 'le succès est mis en cache');
    await service.checkDatabase({ fresh: true });
    assert.equal(calls(), 2, 'fresh force une nouvelle sonde');
  });

  test('met en cache un échec sur une fenêtre courte, jamais longue', async () => {
    const { service, calls } = runtimeWith(failingProbe);
    assert.equal((await service.checkDatabase()).stage, 'auth');
    await service.checkDatabase();
    assert.equal(calls(), 1, 'l’échec est aussi mis en cache, brièvement');
  });

  test('n’expose le détail de débogage qu’en aperçu (VERCEL_ENV=preview)', () => {
    assert.equal(runtimeWith(okProbe).service.debug, false);
    assert.equal(runtimeWith(okProbe, { VERCEL_ENV: 'preview' }).service.debug, true);
    assert.equal(runtimeWith(okProbe, { VERCEL_ENV: 'production' }).service.debug, false);
  });
});

describe('routes HTTP face à une base injoignable', () => {
  function authWith({ debug, probe, requestOtp } = {}) {
    return {
      required: true, ready: true, debug, sessionTtlMs: 8 * 3600_000,
      checkDatabase: probe,
      requestOtp: requestOtp || (async () => { throw new Error('ne doit pas être appelé'); }),
      getSession: async () => null,
      verifyOtp: async () => ({ ok: false }),
      logout: async () => true
    };
  }

  test('request-otp renvoie 503, le détail et Retry-After en aperçu', async () => {
    const handlers = createStudentAuthHandlers(authWith({ debug: true, probe: failingProbe }));
    const res = fakeRes();
    await handlers.requestOtp(fakeReq(), res, '1.2.3.4');
    assert.equal(res.statusCode, 503);
    assert.equal(res.json.error, 'STUDENT_AUTH_UNAVAILABLE');
    assert.deepEqual(res.json.debug, { stage: 'auth', code: '28P01', latencyMs: 12 });
    assert.equal(res.headers['retry-after'], '10');
    assert.equal(res.headers['cache-control'], 'no-store');
  });

  test('en production, le même échec reste générique', async () => {
    const handlers = createStudentAuthHandlers(authWith({ debug: false, probe: failingProbe }));
    const res = fakeRes();
    await handlers.requestOtp(fakeReq(), res, '1.2.3.4');
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.json, { error: 'STUDENT_AUTH_UNAVAILABLE' });
  });

  test('session et protection des actions signalent aussi la base indisponible', async () => {
    const auth = authWith({ debug: true, probe: failingProbe });
    const handlers = createStudentAuthHandlers(auth);

    const sessionRes = fakeRes();
    await handlers.session(fakeReq('GET', undefined), sessionRes);
    assert.equal(sessionRes.statusCode, 503);
    assert.equal(sessionRes.json.debug.stage, 'auth');

    const actionRes = fakeRes();
    const outcome = await requireStudentSession(fakeReq('POST'), actionRes, auth);
    assert.equal(outcome.ok, false);
    assert.equal(actionRes.statusCode, 503);
    assert.equal(actionRes.json.error, 'STUDENT_AUTH_UNAVAILABLE');
  });

  test('une erreur SQL levée pendant le traitement est journalisée sous forme de stage', async () => {
    const error = Object.assign(new Error('SASL authentication failed'), { code: '28P01' });
    const handlers = createStudentAuthHandlers(authWith({
      debug: true,
      probe: okProbe,
      requestOtp: async () => { throw error; }
    }));
    const res = fakeRes();
    await handlers.requestOtp(fakeReq(), res, '1.2.3.4');
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.json.debug, { stage: 'auth', code: '28P01' });
  });
});

describe('route /api/status et diagnostic de disponibilité', () => {
  const licence = { pubB64: 'cle-factice' };

  test('sans base configurée, le statut indique ready:false et ne sonde rien', async () => {
    const res = fakeRes();
    await createStatusHandler({ licence, studentAuth: { required: true, ready: false } })(fakeReq('GET'), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json.auth.required, true);
    assert.equal(res.json.auth.ready, false);
    assert.equal('db' in res.json.auth, false);
  });

  test('en aperçu, le statut expose l’étape et le code d’un échec de connexion', async () => {
    const studentAuth = {
      required: true, ready: true, debug: true,
      checkDatabase: async () => ({ ok: false, latencyMs: 12, stage: 'auth', code: '28P01' })
    };
    const res = fakeRes();
    await createStatusHandler({ licence, studentAuth })(fakeReq('GET'), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json.auth.db, { ok: false, latencyMs: 12, stage: 'auth', code: '28P01' });
    assert.equal(JSON.stringify(res.json).includes('FM_AUTH_'), false);
  });

  test('en aperçu, un échec client sans SQLSTATE transmet son jeton via auth.db', async () => {
    const studentAuth = {
      required: true, ready: true, debug: true,
      checkDatabase: async () => ({
        ok: false, latencyMs: 9, stage: 'auth', code: 'SASL_PASSWORD_MISSING'
      })
    };
    const res = fakeRes();
    await createStatusHandler({ licence, studentAuth })(fakeReq('GET'), res);
    assert.deepEqual(res.json.auth.db, {
      ok: false, latencyMs: 9, stage: 'auth', code: 'SASL_PASSWORD_MISSING'
    });
  });

  test('hors aperçu, le statut reste minimal et ne sonde pas la base', async () => {
    const studentAuth = {
      required: true, ready: true, debug: false,
      checkDatabase: async () => { throw new Error('ne doit pas être appelé'); }
    };
    const res = fakeRes();
    await createStatusHandler({ licence, studentAuth })(fakeReq('GET'), res);
    assert.equal(res.statusCode, 200);
    assert.equal('db' in res.json.auth, false);
  });
});
