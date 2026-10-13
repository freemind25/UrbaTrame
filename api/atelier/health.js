/* GET /api/atelier/health — état des sources et des couches du module Freemap. */
import { handleAtelierHealth } from '../../server/atelier-api.mjs';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.statusCode = 200; return res.end(''); }
  return handleAtelierHealth(req, res);
}
