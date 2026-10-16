/* GET /api/atelier/gadm — aperçu vectoriel GADM, filtré et généralisé côté serveur. */
import { handleAtelierGadm } from '../../server/atelier-api.mjs';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.statusCode = 200; return res.end(''); }
  return handleAtelierGadm(req, res);
}
