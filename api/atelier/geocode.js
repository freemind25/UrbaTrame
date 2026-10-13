/* POST /api/atelier/geocode — recherche de lieu réservée au module Atelier. */
import { handleAtelierGeocode } from '../../server/atelier-api.mjs';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.statusCode = 200; return res.end(''); }
  return handleAtelierGeocode(req, res);
}
