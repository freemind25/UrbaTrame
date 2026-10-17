/* Repli entre miroirs Overpass — entièrement hors ligne : les « miroirs » sont
   de petits serveurs locaux qui jouent les pannes (504, réponse vide avec
   « remark », serveur muet). On vérifie le comportement qui compte pour
   l'utilisateur :

   - un miroir en panne ne doit pas condamner l'analyse ;
   - le dernier miroir qui a répondu est réessayé en premier ;
   - une réponse 200 + remark d'erreur est un échec, pas un plan vide ;
   - une réponse vide tente les miroirs suivants, sans invalider un résultat
     réellement vide si aucun n'a de données ;
   - le budget total est respecté : on rend la main avant la coupure de la
     plateforme (60 s sur Vercel) au lieu d'être interrompu en plein vol. */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { overpass, orderedEndpoints } from '../server/sources/overpass.mjs';

const QUERY = '[out:json][timeout:25];way(around:300,36.2642,6.6969)["highway"];out count;';

/* Un miroir jouet : `behaviour` décide de la réponse. */
function mirror(behaviour) {
  const seen = { requests: 0, body: '', headers: {} };
  const server = http.createServer((req, res) => {
    seen.requests++;
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      seen.body = raw;
      seen.headers = req.headers;
      const mode = typeof behaviour === 'function' ? behaviour(seen) : behaviour;
      if (mode === 'hang') return;                       // ne répond jamais
      if (mode === '504') { res.writeHead(504).end('Gateway Timeout'); return; }
      if (mode === 'remark') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ elements: [], remark: 'runtime error: Query timed out' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(mode));
    });
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}/api/interpreter`, seen, close: () => new Promise(r => server.close(r)) });
    });
  });
}

describe('repli entre miroirs Overpass', () => {
  const opened = [];
  const open = async (b) => { const m = await mirror(b); opened.push(m); return m; };
  after(async () => { for (const m of opened) await m.close(); });

  test('un premier miroir en 504 n’empêche pas l’analyse', async () => {
    const bad = await open('504');
    const good = await open({ elements: [{ type: 'way', id: 42 }] });
    const d = await overpass(QUERY, { endpoints: [bad.url, good.url], budget: 8_000, perAttempt: 800, minSlice: 200, minAttempt: 200, reserve: 200 });
    assert.equal(d.elements[0].id, 42);
    assert.equal(bad.seen.requests, 1);
    assert.equal(good.seen.requests, 1);
    /* le miroir qui a répondu passe en tête pour la requête suivante */
    assert.equal(orderedEndpoints([bad.url, good.url])[0], good.url);
  });

  test('la requête part bien en formulaire, avec l’en-tête User-Agent', async () => {
    const m = await open({ elements: [{ id: 7 }] });
    await overpass(QUERY, { endpoints: [m.url], budget: 8_000, perAttempt: 800, minSlice: 200, minAttempt: 200, reserve: 200 });
    assert.match(m.seen.headers['content-type'], /application\/x-www-form-urlencoded/);
    assert.match(m.seen.headers['user-agent'], /UrbaTrame/);
    assert.match(m.seen.headers.accept, /application\/json/);
    assert.equal(m.seen.body, 'data=' + encodeURIComponent(QUERY));
  });

  test('200 + remark d’erreur = échec, on tente le miroir suivant', async () => {
    const liar = await open('remark');
    const good = await open({ elements: [{ id: 9 }] });
    const d = await overpass(QUERY, { endpoints: [liar.url, good.url], budget: 8_000, perAttempt: 800, minSlice: 200, minAttempt: 200, reserve: 200 });
    assert.equal(d.elements[0].id, 9);
    assert.equal(liar.seen.requests, 1);
  });

  test('réponse vide SANS remark = résultat légitime (pas d’erreur)', async () => {
    const empty = await open({ elements: [] });
    const d = await overpass(QUERY, { endpoints: [empty.url], budget: 8_000, perAttempt: 800, minSlice: 200, minAttempt: 200, reserve: 200 });
    assert.deepEqual(d.elements, []);
  });

  test('un miroir vide est essayé puis les données du suivant sont préférées', async () => {
    const empty = await open({ elements: [] });
    const good = await open({ elements: [{ id: 73 }] });
    const d = await overpass(QUERY, { endpoints: [empty.url, good.url], budget: 8_000, perAttempt: 800, minSlice: 200, minAttempt: 200, reserve: 200 });
    assert.equal(d.elements[0].id, 73);
    assert.equal(empty.seen.requests, 1);
    assert.equal(good.seen.requests, 1);
  });

  test('si tous les miroirs sont vides, la réponse vide reste légitime', async () => {
    const a = await open({ elements: [] });
    const b = await open({ elements: [] });
    const d = await overpass(QUERY, { endpoints: [a.url, b.url], budget: 8_000, perAttempt: 800, minSlice: 200, minAttempt: 200, reserve: 200 });
    assert.deepEqual(d.elements, []);
    assert.equal(a.seen.requests, 1);
    assert.equal(b.seen.requests, 1);
  });

  test('tous les miroirs en panne → MAP_SOURCE_UNAVAILABLE, jamais un plan vide', async () => {
    const a = await open('504');
    const b = await open('504');
    await assert.rejects(
      () => overpass(QUERY, { endpoints: [a.url, b.url], budget: 8_000 }),
      /HTTP 504/
    );
  });

  test('serveur muet : le budget est respecté (pas de coupure en plein vol)', async () => {
    const mute = await open('hang');
    const t0 = Date.now();
    await assert.rejects(
      () => overpass(QUERY, {
        endpoints: [mute.url], budget: 1_500, perAttempt: 200, minSlice: 200, minAttempt: 200, reserve: 200
      }),
      /BUDGET_EXHAUSTED|abort/i
    );
    const spent = Date.now() - t0;
    assert.ok(spent < 3_000, `rendu la main en ${spent} ms, attendu < 3000`);
  });

  test('un miroir muet ne bloque pas les suivants', async () => {
    const mute = await open('hang');
    const good = await open({ elements: [{ id: 11 }] });
    const d = await overpass(QUERY, {
      endpoints: [mute.url, good.url], budget: 6_000, perAttempt: 800, minAttempt: 200, reserve: 200
    });
    assert.equal(d.elements[0].id, 11);
  });
});
