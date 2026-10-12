/* POST /analysis/2d — contrat complet dans docs/API.md.
   Vercel expose les fichiers de api/ sous /api/ : la réécriture déclarée dans
   vercel.json fait arriver cette fonction à l'adresse attendue par le client. */
import { createAnalysisHandler } from '../../server/api.mjs';
import { clientIp } from '../../server/http.mjs';
import { runtime } from '../../server/vercel.mjs';

const handle = createAnalysisHandler(runtime);
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Expose-Headers': 'X-EM-Trace, Retry-After'
};

export default async function handler(req, res) {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
  if (req.method === 'OPTIONS') { res.statusCode = 200; return res.end(''); }
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: 'POST_ONLY' }));
  }
  req.url = req.url || '/analysis/2d';
  return handle(req, res, clientIp(req));
}
