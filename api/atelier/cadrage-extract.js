/* POST /api/atelier/cadrage-extract — données cartographiques pour le module
   Cadrage spatial. Son rayon est plafonné séparément à 3 000 m; l'extraction
   Altiplan conserve sa limite existante. */
import { handleAtelierCadrageExtract } from '../../server/atelier-api.mjs';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.statusCode = 200; return res.end(''); }
  return handleAtelierCadrageExtract(req, res);
}
