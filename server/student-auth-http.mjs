/* HTTP/cookie layer for student and owner sessions. Cookies are host-only,
   HttpOnly and Secure behind HTTPS; the owner cookie is SameSite=Strict.
   No session token is returned to JavaScript. */
import { readBody } from './http.mjs';
import { classifyDatabaseError } from './student-auth-diagnostics.mjs';

export const STUDENT_SESSION_COOKIE = 'ut_student_session';
export const OWNER_SESSION_COOKIE = 'ut_owner_session';
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function sendStudentAuth(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Pragma': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'Cookie, Origin',
    ...headers
  });
  res.end(JSON.stringify(body));
}

export function getStudentSessionCookie(req) {
  const raw = String(req.headers?.cookie || '');
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index < 0 || part.slice(0, index).trim() !== STUDENT_SESSION_COOKIE) continue;
    try { return decodeURIComponent(part.slice(index + 1).trim()); }
    catch { return ''; }
  }
  return '';
}

export function getOwnerSessionCookie(req) {
  const raw = String(req.headers?.cookie || '');
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index < 0 || part.slice(0, index).trim() !== OWNER_SESSION_COOKIE) continue;
    try { return decodeURIComponent(part.slice(index + 1).trim()); }
    catch { return ''; }
  }
  return '';
}

export function isSameOriginRequest(req) {
  const origin = String(req.headers?.origin || '');
  const host = String(req.headers?.['x-forwarded-host'] || req.headers?.host || '').split(',')[0].trim().toLowerCase();
  if (!origin || !host) return process.env.NODE_ENV !== 'production' && !origin;
  try {
    const parsed = new URL(origin);
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.host.toLowerCase() === host;
  } catch { return false; }
}

function publicStudentUser(user) {
  return user ? {
    ...(user.email ? { email: user.email } : {}),
    role: user.role,
    tier: user.tier,
    emailVerified: Boolean(user.emailVerified),
    ...(user.isOwner ? { isOwner: true } : {}),
    entitlements: { pro: true, max: true }
  } : null;
}

function secureRequest(req) {
  const proto = String(req.headers?.['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return proto === 'https' || Boolean(req.socket?.encrypted);
}

function cookieHeader(req, token, maxAge) {
  const secure = secureRequest(req) ? '; Secure' : '';
  const value = token ? encodeURIComponent(token) : '';
  return `${STUDENT_SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAge))}${secure}`;
}

function ownerCookieHeader(req, token, maxAge) {
  const secure = secureRequest(req) ? '; Secure' : '';
  const value = token ? encodeURIComponent(token) : '';
  return `${OWNER_SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0, Math.floor(maxAge))}${secure}`;
}

function clearedAuthCookies(req) {
  return [cookieHeader(req, '', 0), ownerCookieHeader(req, '', 0)];
}

async function readJson(req) {
  try {
    const body = JSON.parse((await readBody(req, 16_384)).toString('utf8') || '{}');
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch { return null; }
}

/* Sonde de disponibilité de la base avant chaque accès. Le détail n'est
   renvoyé au client qu'en aperçu (auth.debug), jamais en production. */
async function ensureDatabase(res, auth) {
  if (typeof auth?.checkDatabase !== 'function') return true;
  const probe = await auth.checkDatabase();
  if (probe.ok) return true;
  /* Étape et code uniquement : jamais l'URL, l'identifiant ou le mot de passe. */
  console.error('UT_AUTH_DB_UNAVAILABLE', probe.stage, probe.code, probe.latencyMs);
  sendStudentAuth(res, 503, {
    error: 'STUDENT_AUTH_UNAVAILABLE',
    ...(auth.debug ? { debug: { stage: probe.stage, code: probe.code, latencyMs: probe.latencyMs } } : {})
  }, { 'Retry-After': '10' });
  return false;
}

export function createStudentAuthHandlers(auth) {
  async function requestOtp(req, res, ip) {
    if (!auth?.required) return sendStudentAuth(res, 404, { error: 'NOT_FOUND' });
    if (!auth.ready) return sendStudentAuth(res, 503, { error: 'STUDENT_AUTH_UNAVAILABLE' });
    if (req.method !== 'POST') return sendStudentAuth(res, 405, { error: 'POST_ONLY' });
    if (!isSameOriginRequest(req)) return sendStudentAuth(res, 403, { error: 'ORIGIN_NOT_ALLOWED' });
    const body = await readJson(req);
    if (!body) return sendStudentAuth(res, 400, { error: 'BAD_JSON' });
    if (!(await ensureDatabase(res, auth))) return;
    try {
      const response = await auth.requestOtp({ email: body.email, ip });
      return sendStudentAuth(res, 202, response);
    } catch (error) {
      /* Code/name uniquement : ne jamais journaliser l'URL DB, l'adresse ou le code OTP. */
      const diagnosticCode = String(error?.code || error?.cause?.code || error?.name || 'UNKNOWN').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
      const { stage } = classifyDatabaseError(error);
      console.error('UT_AUTH_REQUEST_OTP_FAILED', stage, diagnosticCode);
      return sendStudentAuth(res, 503, {
        error: 'STUDENT_AUTH_UNAVAILABLE',
        ...(auth.debug ? { debug: { stage, code: diagnosticCode } } : {})
      }, { 'Retry-After': '10' });
    }
  }

  async function verifyOtp(req, res) {
    if (!auth?.required) return sendStudentAuth(res, 404, { error: 'NOT_FOUND' });
    if (!auth.ready) return sendStudentAuth(res, 503, { error: 'STUDENT_AUTH_UNAVAILABLE' });
    if (req.method !== 'POST') return sendStudentAuth(res, 405, { error: 'POST_ONLY' });
    if (!isSameOriginRequest(req)) return sendStudentAuth(res, 403, { error: 'ORIGIN_NOT_ALLOWED' });
    const body = await readJson(req);
    if (!body) return sendStudentAuth(res, 400, { error: 'BAD_JSON' });
    if (!(await ensureDatabase(res, auth))) return;
    try {
      const result = await auth.verifyOtp({ email: body.email, code: body.code });
      if (!result.ok) return sendStudentAuth(res, 400, { error: 'INVALID_OR_EXPIRED_CODE' });
      const maxAge = Math.floor(auth.sessionTtlMs / 1000);
      return sendStudentAuth(res, 200, { ok: true, user: result.user }, {
        'Set-Cookie': cookieHeader(req, result.sessionToken, maxAge)
      });
    } catch (error) {
      const { stage, code } = classifyDatabaseError(error);
      console.error('UT_AUTH_VERIFY_OTP_FAILED', stage, code);
      return sendStudentAuth(res, 503, {
        error: 'STUDENT_AUTH_UNAVAILABLE',
        ...(auth.debug ? { debug: { stage, code } } : {})
      }, { 'Retry-After': '10' });
    }
  }

  async function ownerLogin(req, res, ip) {
    const ownerAuth = auth?.ownerAuth;
    if (!ownerAuth?.required) return sendStudentAuth(res, 404, { error: 'NOT_FOUND' });
    if (!ownerAuth.ready) return sendStudentAuth(res, 503, { error: 'OWNER_AUTH_UNAVAILABLE' });
    if (req.method !== 'POST') return sendStudentAuth(res, 405, { error: 'POST_ONLY' });
    if (!isSameOriginRequest(req)) return sendStudentAuth(res, 403, { error: 'ORIGIN_NOT_ALLOWED' });
    const body = await readJson(req);
    if (!body) return sendStudentAuth(res, 400, { error: 'BAD_JSON' });
    try {
      const result = await ownerAuth.authenticate({ password: body.password, ip });
      if (result.unavailable) return sendStudentAuth(res, 503, { error: 'OWNER_AUTH_UNAVAILABLE' });
      if (result.rateLimited) return sendStudentAuth(res, 429, { error: 'RATE_LIMITED' }, { 'Retry-After': '900' });
      if (!result.ok) return sendStudentAuth(res, 401, { error: 'INVALID_CREDENTIALS' });
      return sendStudentAuth(res, 200, {
        ok: true,
        user: publicStudentUser(result.user)
      }, {
        'Set-Cookie': ownerCookieHeader(req, result.sessionToken, Math.floor(ownerAuth.sessionTtlMs / 1000))
      });
    } catch {
      return sendStudentAuth(res, 503, { error: 'OWNER_AUTH_UNAVAILABLE' }, { 'Retry-After': '10' });
    }
  }

  async function session(req, res) {
    if (req.method !== 'GET') return sendStudentAuth(res, 405, { error: 'GET_ONLY' });
    const ownerAuth = auth?.ownerAuth;
    const owner = ownerAuth?.required && ownerAuth.ready
      ? ownerAuth.getSession(getOwnerSessionCookie(req))
      : null;
    if (owner) return sendStudentAuth(res, 200, {
      required: Boolean(auth?.required), ready: auth?.ready !== false,
      authenticated: true, user: publicStudentUser(owner)
    });
    if (!auth?.required) return sendStudentAuth(res, 200, { required: false, ready: true, authenticated: false });
    if (!auth.ready) return sendStudentAuth(res, 503, { required: true, ready: false, authenticated: false });
    if (!(await ensureDatabase(res, auth))) return;
    try {
      const user = await auth.getSession(getStudentSessionCookie(req));
      return sendStudentAuth(res, 200, { required: true, ready: true, authenticated: Boolean(user), user: publicStudentUser(user) });
    } catch (error) {
      const { stage, code } = classifyDatabaseError(error);
      console.error('UT_AUTH_SESSION_FAILED', stage, code);
      return sendStudentAuth(res, 503, {
        error: 'STUDENT_AUTH_UNAVAILABLE',
        ...(auth.debug ? { debug: { stage, code } } : {})
      }, { 'Retry-After': '10' });
    }
  }

  async function logout(req, res) {
    const cookies = clearedAuthCookies(req);
    if (req.method !== 'POST') return sendStudentAuth(res, 405, { error: 'POST_ONLY' });
    if (!isSameOriginRequest(req)) return sendStudentAuth(res, 403, { error: 'ORIGIN_NOT_ALLOWED' });
    if (!auth?.required) return sendStudentAuth(res, 200, { ok: true }, { 'Set-Cookie': cookies });
    if (!auth.ready) return sendStudentAuth(res, 503, { error: 'STUDENT_AUTH_UNAVAILABLE' }, { 'Set-Cookie': cookies });
    try {
      await auth.logout(getStudentSessionCookie(req));
      return sendStudentAuth(res, 200, { ok: true }, { 'Set-Cookie': cookies });
    } catch {
      return sendStudentAuth(res, 503, { error: 'STUDENT_AUTH_UNAVAILABLE' }, { 'Set-Cookie': cookies });
    }
  }

  return Object.freeze({ requestOtp, verifyOtp, ownerLogin, session, logout });
}

/** Protects app/API actions, while leaving login/status routes public. */
export async function requireStudentSession(req, res, auth) {
  if (auth?.required && WRITE_METHODS.has(String(req.method || '').toUpperCase()) && !isSameOriginRequest(req)) {
    sendStudentAuth(res, 403, { error: 'ORIGIN_NOT_ALLOWED' });
    return { ok: false, user: null };
  }
  const ownerAuth = auth?.ownerAuth;
  if (ownerAuth?.required && ownerAuth.ready) {
    const owner = ownerAuth.getSession(getOwnerSessionCookie(req));
    if (owner) return { ok: true, user: owner };
  }
  if (!auth?.required) return { ok: true, user: null };
  if (!auth.ready) {
    sendStudentAuth(res, 503, { error: 'STUDENT_AUTH_UNAVAILABLE' });
    return { ok: false, user: null };
  }
  if (typeof auth.checkDatabase === 'function') {
    const probe = await auth.checkDatabase();
    if (!probe.ok) {
      console.error('UT_AUTH_DB_UNAVAILABLE', probe.stage, probe.code, probe.latencyMs);
      sendStudentAuth(res, 503, {
        error: 'STUDENT_AUTH_UNAVAILABLE',
        ...(auth.debug ? { debug: { stage: probe.stage, code: probe.code, latencyMs: probe.latencyMs } } : {})
      }, { 'Retry-After': '10' });
      return { ok: false, user: null };
    }
  }
  try {
    const user = await auth.getSession(getStudentSessionCookie(req));
    if (!user) {
      sendStudentAuth(res, 401, { error: 'STUDENT_AUTH_REQUIRED' });
      return { ok: false, user: null };
    }
    return { ok: true, user };
  } catch (error) {
    const { stage, code } = classifyDatabaseError(error);
    console.error('UT_AUTH_SESSION_FAILED', stage, code);
    sendStudentAuth(res, 503, {
      error: 'STUDENT_AUTH_UNAVAILABLE',
      ...(auth.debug ? { debug: { stage, code } } : {})
    }, { 'Retry-After': '10' });
    return { ok: false, user: null };
  }
}
