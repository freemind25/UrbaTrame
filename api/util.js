/* POST /api/util — recherche de lieu (Nominatim) et parrainage.
   Le client poste ici plutôt qu'à la racine : sur Vercel, « / » sert l'interface. */
import { createUtilityHandler } from '../server/api.mjs';
import { runtime } from '../server/vercel.mjs';
import { requireStudentSession } from '../server/student-auth-http.mjs';

const handle = createUtilityHandler(runtime);

export default async function handler(req, res) {
  if (!runtime.studentAuth.required) res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.statusCode = 200; return res.end(''); }
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: 'POST_ONLY' }));
  }
  const access = runtime.studentAuth.required
    ? await requireStudentSession(req, res, runtime.studentAuth)
    : { ok: true, user: null };
  if (!access.ok) return;
  return handle(req, res);
}
