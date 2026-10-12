/* GET /api/status — état du service et clé publique Ed25519. */
import { createStatusHandler } from '../server/api.mjs';
import { runtime } from './_lib/runtime.mjs';

const handle = createStatusHandler(runtime);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  return handle(req, res);
}
