/* Couche HTTP : envoi de réponses, lecture du corps, IP cliente, fichiers
   statiques. Aucune dépendance externe — le projet tient en Node standard. */
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

/* Identifiant de trace commun à toutes les réponses d'une instance : il permet
   de rattacher un incident signalé par un utilisateur à un journal serveur. */
export const TRACE = crypto.randomBytes(4).toString('hex');

export function log(...a) {
  console.log(new Date().toISOString().slice(11, 19), ...a);
}

export function send(res, code, body, type = 'application/json; charset=utf-8', extra = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': type,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Expose-Headers': 'X-EM-Trace, Retry-After',
    'X-EM-Trace': TRACE,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    ...extra
  });
  res.end(payload);
}

export function readBody(req, limit = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const chunks = [];
    req.on('data', c => {
      n += c.length;
      if (n > limit) { reject(new Error('TOO_LARGE')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/* Derrière un proxy, la vraie IP est la première de X-Forwarded-For. */
export const clientIp = req =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
  req.socket.remoteAddress || '0.0.0.0';

export async function serveStatic(req, res, urlPath, publicDir) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const full = path.join(publicDir, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!full.startsWith(publicDir)) return send(res, 403, 'Forbidden', 'text/plain');
  try {
    const st = await fsp.stat(full);
    if (st.isDirectory()) return serveStatic(req, res, path.join(rel, 'index.html'), publicDir);
    const ext = path.extname(full).toLowerCase();
    const data = await fsp.readFile(full);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'X-EM-Trace': TRACE,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=300'
    });
    res.end(data);
  } catch {
    send(res, 404, 'Not found', 'text/plain');
  }
}
