/* Point d'entrée unique des API Vercel.
   Le rewrite de vercel.json transmet le chemin demandé dans __path, car les
   fonctions Vercel ne prennent pas en charge les jokers imbriqués de façon
   uniforme. Le routeur métier partagé reste server/api.mjs. */
import path from 'node:path';
import { createApi } from '../server/api.mjs';
import { runtime } from '../server/vercel.mjs';
import { send } from '../server/http.mjs';

const api = createApi({
  ...runtime,
  publicDir: path.resolve(process.cwd(), 'public')
});

const API_PATHS = new Set([
  '/api/status',
  '/api/auth/request-otp',
  '/api/auth/verify-otp',
  '/api/auth/session',
  '/api/auth/logout',
  '/api/atelier/health',
  '/api/atelier/geocode',
  '/api/atelier/extract',
  '/api/atelier/cadrage-extract',
  '/api/atelier/gadm',
  '/api/util',
  '/analysis/2d'
]);

function queryValue(req, url, name) {
  const fromUrl = url.searchParams.get(name);
  if (fromUrl !== null) return fromUrl;
  const fromQuery = req.query?.[name];
  return Array.isArray(fromQuery) ? fromQuery[0] : fromQuery;
}

function requestSearchParams(req, url) {
  const params = new URLSearchParams(url.searchParams);
  /* Vercel's parsed query is normally also present in req.url. Merge it only
     when absent there, for runtimes that expose the two representations
     separately. */
  if (req.query && typeof req.query === 'object') {
    for (const [key, value] of Object.entries(req.query)) {
      if (key === '__path' || params.has(key)) continue;
      for (const item of Array.isArray(value) ? value : [value]) {
        if (item !== undefined && item !== null) params.append(key, String(item));
      }
    }
  }
  return params;
}

function normalizeRoutedPath(value) {
  let route = String(value || '').trim();
  if (!route.startsWith('/')) route = `/${route}`;
  if (route === '/analysis/2d' || route === '/api/analysis/2d') return '/analysis/2d';
  if (route === '/api' || route.startsWith('/api/')) return route;
  return `/api${route === '/' ? '' : route}`;
}

function restoreRequestPath(req) {
  const url = new URL(req.url || '/api', 'http://vercel.local');
  const isEntryPoint = url.pathname === '/api' || url.pathname === '/api/' || url.pathname === '/api/index';
  if (isEntryPoint) {
    const capturedPath = queryValue(req, url, '__path');
    if (capturedPath) {
      const route = normalizeRoutedPath(capturedPath);
      const search = requestSearchParams(req, url);
      search.delete('__path');
      req.url = route + (search.size ? `?${search.toString()}` : '');
      return route;
    }
  }

  if (url.pathname === '/api/analysis/2d') {
    url.pathname = '/analysis/2d';
    req.url = url.pathname + url.search;
    return url.pathname;
  }
  return url.pathname;
}

function isKnownPath(route) {
  return API_PATHS.has(route) || route.startsWith('/api/util/codecraft');
}

export default async function handler(req, res) {
  const route = restoreRequestPath(req);
  if (!isKnownPath(route)) return send(res, 404, { error: 'NOT_FOUND' });

  if (req.method !== 'OPTIONS' &&
      (route === '/api/util' || route.startsWith('/api/util/codecraft') || route === '/analysis/2d') &&
      req.method !== 'POST') {
    return send(res, 405, { error: 'POST_ONLY' });
  }

  return api(req, res);
}
