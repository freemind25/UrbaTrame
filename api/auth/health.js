/* GET /api/auth/health — sonde de disponibilité de l'authentification étudiante.
   Exécute un SELECT 1 réel (pas seulement la présence des variables).
   En aperçu (VERCEL_ENV=preview) le corps précise l'étape de l'échec (dns, tcp,
   tls, auth…) et son code — jamais l'URL ni les identifiants. En production la
   réponse reste minimale, et l'échec est signalé par le seul code HTTP. */
import { runtime } from '../../server/vercel.mjs';
import { sendStudentAuth } from '../../server/student-auth-http.mjs';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return sendStudentAuth(res, 405, { error: 'GET_ONLY' });
  const auth = runtime.studentAuth;
  if (!auth?.required) return sendStudentAuth(res, 200, { ok: true, required: false });
  if (!auth.ready) return sendStudentAuth(res, 503, { ok: false, required: true, ready: false });
  const probe = await auth.checkDatabase({ fresh: true });
  if (!auth.debug)
    return sendStudentAuth(res, probe.ok ? 200 : 503, { ok: probe.ok, required: true, ready: true });
  return sendStudentAuth(res, probe.ok ? 200 : 503, {
    ok: probe.ok,
    required: true,
    ready: true,
    db: { ok: probe.ok, latencyMs: probe.latencyMs, stage: probe.stage, code: probe.code }
  }, probe.ok ? {} : { 'Retry-After': '10' });
}
