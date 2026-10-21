/* POST /api/atelier/geocode — recherche de lieu réservée au module Atelier. */
import { handleAtelierGeocode } from '../../server/atelier-api.mjs';
import { runtime } from '../../server/vercel.mjs';
import { requireStudentSession } from '../../server/student-auth-http.mjs';

export default async function handler(req, res) {
  if (!runtime.studentAuth.required) res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.statusCode = 200; return res.end(''); }
  const access = runtime.studentAuth.required
    ? await requireStudentSession(req, res, runtime.studentAuth)
    : { ok: true, user: null };
  if (!access.ok) return;
  return handleAtelierGeocode(req, res);
}
