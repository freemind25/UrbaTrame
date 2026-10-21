/* HTTP/cookie layer for student sessions. Cookies are host-only, HttpOnly,
   SameSite=Lax, and Secure behind HTTPS. No token is returned to JavaScript. */
import { readBody } from './http.mjs';

export const STUDENT_SESSION_COOKIE = 'ut_student_session';
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
    email: user.email,
    role: user.role,
    tier: user.tier,
    emailVerified: Boolean(user.emailVerified),
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

async function readJson(req) {
  try {
    const body = JSON.parse((await readBody(req, 16_384)).toString('utf8') || '{}');
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch { return null; }
}

export function createStudentAuthHandlers(auth) {
  async function requestOtp(req, res, ip) {
    if (!auth?.required) return sendStudentAuth(res, 404, { error: 'NOT_FOUND' });
    if (!auth.ready) return sendStudentAuth(res, 503, { error: 'STUDENT_AUTH_UNAVAILABLE' });
    if (req.method !== 'POST') return sendStudentAuth(res, 405, { error: 'POST_ONLY' });
    if (!isSameOriginRequest(req)) return sendStudentAuth(res, 403, { error: 'ORIGIN_NOT_ALLOWED' });
    const body = await readJson(req);
    if (!body) return sendStudentAuth(res, 400, { error: 'BAD_JSON' });
    try {
      const response = await auth.requestOtp({ email: body.email, ip });
      return sendStudentAuth(res, 202, response);
    } catch {
      return sendStudentAuth(res, 503, { error: 'STUDENT_AUTH_UNAVAILABLE' });
    }
  }

  async function verifyOtp(req, res) {
    if (!auth?.required) return sendStudentAuth(res, 404, { error: 'NOT_FOUND' });
    if (!auth.ready) return sendStudentAuth(res, 503, { error: 'STUDENT_AUTH_UNAVAILABLE' });
    if (req.method !== 'POST') return sendStudentAuth(res, 405, { error: 'POST_ONLY' });
    if (!isSameOriginRequest(req)) return sendStudentAuth(res, 403, { error: 'ORIGIN_NOT_ALLOWED' });
    const body = await readJson(req);
    if (!body) return sendStudentAuth(res, 400, { error: 'BAD_JSON' });
    try {
      const result = await auth.verifyOtp({ email: body.email, code: body.code });
      if (!result.ok) return sendStudentAuth(res, 400, { error: 'INVALID_OR_EXPIRED_CODE' });
      const maxAge = Math.floor(auth.sessionTtlMs / 1000);
      return sendStudentAuth(res, 200, { ok: true, user: result.user }, {
        'Set-Cookie': cookieHeader(req, result.sessionToken, maxAge)
      });
    } catch {
      return sendStudentAuth(res, 503, { error: 'STUDENT_AUTH_UNAVAILABLE' });
    }
  }

  async function session(req, res) {
    if (!auth?.required) return sendStudentAuth(res, 200, { required: false, ready: true, authenticated: false });
    if (!auth.ready) return sendStudentAuth(res, 503, { required: true, ready: false, authenticated: false });
    if (req.method !== 'GET') return sendStudentAuth(res, 405, { error: 'GET_ONLY' });
    try {
      const user = await auth.getSession(getStudentSessionCookie(req));
      return sendStudentAuth(res, 200, { required: true, ready: true, authenticated: Boolean(user), user: publicStudentUser(user) });
    } catch {
      return sendStudentAuth(res, 503, { error: 'STUDENT_AUTH_UNAVAILABLE' });
    }
  }

  async function logout(req, res) {
    if (!auth?.required) return sendStudentAuth(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(req, '', 0) });
    if (!auth.ready) return sendStudentAuth(res, 503, { error: 'STUDENT_AUTH_UNAVAILABLE' }, { 'Set-Cookie': cookieHeader(req, '', 0) });
    if (req.method !== 'POST') return sendStudentAuth(res, 405, { error: 'POST_ONLY' });
    if (!isSameOriginRequest(req)) return sendStudentAuth(res, 403, { error: 'ORIGIN_NOT_ALLOWED' });
    try {
      await auth.logout(getStudentSessionCookie(req));
      return sendStudentAuth(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(req, '', 0) });
    } catch {
      return sendStudentAuth(res, 503, { error: 'STUDENT_AUTH_UNAVAILABLE' }, { 'Set-Cookie': cookieHeader(req, '', 0) });
    }
  }

  return Object.freeze({ requestOtp, verifyOtp, session, logout });
}

/** Protects app/API actions, while leaving login/status routes public. */
export async function requireStudentSession(req, res, auth) {
  if (!auth?.required) return { ok: true, user: null };
  if (!auth.ready) {
    sendStudentAuth(res, 503, { error: 'STUDENT_AUTH_UNAVAILABLE' });
    return { ok: false, user: null };
  }
  if (WRITE_METHODS.has(String(req.method || '').toUpperCase()) && !isSameOriginRequest(req)) {
    sendStudentAuth(res, 403, { error: 'ORIGIN_NOT_ALLOWED' });
    return { ok: false, user: null };
  }
  try {
    const user = await auth.getSession(getStudentSessionCookie(req));
    if (!user) {
      sendStudentAuth(res, 401, { error: 'STUDENT_AUTH_REQUIRED' });
      return { ok: false, user: null };
    }
    return { ok: true, user };
  } catch {
    sendStudentAuth(res, 503, { error: 'STUDENT_AUTH_UNAVAILABLE' });
    return { ok: false, user: null };
  }
}
