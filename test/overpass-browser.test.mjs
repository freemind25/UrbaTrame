/* Le repli Overpass utilisé par l'essai gratuit est aussi testé hors ligne:
   un 429 doit faire passer au miroir suivant puis être mémorisé pour les
   requêtes suivantes du même onglet. */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Routes } from '../public/js/routes.mjs';
import { OverpassRotation } from '../public/js/overpass-rotation.mjs';

const QUERY = '[out:json][timeout:20];way["building"](around:250,36.2642,6.6969);out geom;';
const opened = [];

function mirror(status, headers, body) {
  const seen = { requests: 0 };
  const server = http.createServer((req, res) => {
    seen.requests++;
    req.resume();
    req.on('end', () => {
      res.writeHead(status, headers || {});
      res.end(body);
    });
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const endpoint = `http://127.0.0.1:${port}/api/interpreter`;
      const close = () => new Promise(done => server.close(done));
      const result = { endpoint, seen, close };
      opened.push(result);
      resolve(result);
    });
  });
}

after(async () => { for (const m of opened) await m.close(); });

test('le navigateur passe après un 429 et évite le miroir limité au prochain appel', async () => {
  const limited = await mirror(429, { 'Content-Type': 'text/plain', 'Retry-After': '120' }, 'Too Many Requests');
  const healthy = await mirror(200, { 'Content-Type': 'application/json' }, JSON.stringify({ elements: [{ type: 'way', id: 91 }] }));
  const logs = [];
  const routes = new Routes('', line => logs.push(line), {
    overpassEndpoints: [limited.endpoint, healthy.endpoint],
    overpassRotation: new OverpassRotation()
  });

  const first = await routes.overpassDirect(QUERY, 5_000, true);
  assert.equal(first.elements[0].id, 91);
  assert.equal(limited.seen.requests, 1);
  assert.equal(healthy.seen.requests, 1);
  assert.ok(logs.some(line => line.includes('rotation') && line.includes('pause')));

  const second = await routes.overpassDirect(QUERY + ' ', 5_000, true);
  assert.equal(second.elements[0].id, 91);
  assert.equal(limited.seen.requests, 1, 'le 429 reste en pause');
  assert.equal(healthy.seen.requests, 2);
});

test('un quota annoncé à zéro sur HTTP 200 fait tourner la requête suivante', async () => {
  const exhausted = await mirror(200, {
    'Content-Type': 'application/json', 'X-RateLimit-Remaining': '0', 'Retry-After': '120'
  }, JSON.stringify({ elements: [{ type: 'way', id: 92 }] }));
  const healthy = await mirror(200, { 'Content-Type': 'application/json' }, JSON.stringify({ elements: [{ type: 'way', id: 93 }] }));
  const routes = new Routes('', () => {}, {
    overpassEndpoints: [exhausted.endpoint, healthy.endpoint],
    overpassRotation: new OverpassRotation()
  });

  const first = await routes.overpassDirect(QUERY + ' [a]', 5_000, true);
  assert.equal(first.elements[0].id, 92, 'la réponse valide déjà reçue est conservée');
  const second = await routes.overpassDirect(QUERY + ' [b]', 5_000, true);
  assert.equal(second.elements[0].id, 93);
  assert.equal(exhausted.seen.requests, 1);
  assert.equal(healthy.seen.requests, 1);
});
