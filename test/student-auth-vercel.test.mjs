/* Les fonctions Vercel doivent échouer fermées si l'auth est demandée mais
   que la base, le secret ou le relais ne sont pas configurés. */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

process.env.FM_STUDENT_AUTH = 'required';
delete process.env.FM_AUTH_DATABASE_URL;
delete process.env.FM_AUTH_OTP_KEY;
delete process.env.FM_AUTH_SMTP_HOST;
delete process.env.FM_AUTH_SMTP_USER;
delete process.env.FM_AUTH_SMTP_PASSWORD;
delete process.env.FM_AUTH_EMAIL_FROM;

function fakeRes() {
  return {
    statusCode: 200, headers: {}, body: '',
    setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
    writeHead(code, headers) { this.statusCode = code; for (const [key, value] of Object.entries(headers || {})) this.setHeader(key, value); },
    end(chunk) { this.body = chunk ?? ''; },
    get json() { try { return JSON.parse(this.body); } catch { return null; } }
  };
}
function fakeReq(method = 'POST', url = '/', body = {}) {
  return { method, url, body, headers: { host: 'urbatrame.example', 'content-type': 'application/json' }, socket: {} };
}

describe('auth étudiante sur les fonctions Vercel', () => {
  let status, session, analysis, atelier;
  before(async () => {
    status = (await import('../api/status.js')).default;
    session = (await import('../api/auth/session.js')).default;
    analysis = (await import('../api/analysis/2d.js')).default;
    atelier = (await import('../api/atelier/health.js')).default;
  });

  test('le statut public indique la configuration manquante sans en révéler les valeurs', async () => {
    const res = fakeRes();
    await status(fakeReq('GET', '/api/status'), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json.auth, { required: true, ready: false });
    assert.equal(JSON.stringify(res.json).includes('FM_AUTH_OTP_KEY'), false);
  });

  test('session, analyses et ateliers sont refusés quand l’auth requise n’est pas prête', async () => {
    const sessionRes = fakeRes();
    await session(fakeReq('GET', '/api/auth/session'), sessionRes);
    assert.equal(sessionRes.statusCode, 503);
    assert.deepEqual(sessionRes.json, { required: true, ready: false, authenticated: false });

    for (const [name, handler] of [['analysis', analysis], ['atelier', atelier]]) {
      const res = fakeRes();
      await handler(fakeReq('POST', '/api/test', { action: 'check' }), res);
      assert.equal(res.statusCode, 503, name);
      assert.equal(res.json.error, 'STUDENT_AUTH_UNAVAILABLE', name);
    }
  });
});
