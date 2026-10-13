/* POST /api/atelier/extract — couches OSM + relief, sans compte ni quota. */
import { handleAtelierExtract } from '../../server/atelier-api.mjs';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.statusCode = 200; return res.end(''); }
  return handleAtelierExtract(req, res);
}
