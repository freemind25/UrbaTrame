/* Repli entre miroirs Overpass — entièrement hors ligne : les « miroirs » sont
   de petits serveurs locaux qui jouent les pannes (504, réponse vide avec
   « remark », serveur muet). On vérifie le comportement qui compte pour
   l'utilisateur :

   - un miroir en panne ne doit pas condamner l'analyse ;
   - le dernier miroir qui a répondu est réessayé en premier ;
   - une réponse 200 + remark d'erreur est un échec, pas un plan vide ;
   - une réponse vide tente les miroirs suivants et n'est considérée valide
     que si tous les miroirs ont répondu sans erreur ;
   - un miroir vide mêlé à des erreurs ne masque pas une indisponibilité ;
   - le budget total est respecté : on rend la main avant la coupure de la
     plateforme (60 s sur Vercel) au lieu d'être interrompu en plein vol. */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { overpass, orderedEndpoints } from '../server/sources/overpass.mjs';
import { OverpassRotation } from '../public/js/overpass-rotation.mjs';

const QUERY = '[out:json][timeout:25];way(around:300,36.2642,6.6969)["highway"];out count;';

test('les listes par défaut n’utilisent que des miroirs Overpass à couverture globale', () => {
  const serverConfig = fs.readFileSync(new URL('../server/config.mjs', import.meta.url), 'utf8');
  const browserRoutes = fs.readFileSync(new URL('../public/js/routes.mjs', import.meta.url), 'utf8');
  assert.equal(serverConfig.includes('https://overpass.osm.ch/'), false);
  assert.equal(browserRoutes.includes('https://overpass.osm.ch/'), false);
  assert.ok(serverConfig.includes('https://z.overpass-api.de/api/interpreter'));
  assert.ok(browserRoutes.includes('https://z.overpass-api.de/api/interpreter'));
  assert.ok(serverConfig.includes('https://lz4.overpass-api.de/api/interpreter'));
  assert.ok(browserRoutes.includes('https://lz4.overpass-api.de/api/interpreter'));
  assert.ok(serverConfig.includes('https://overpass.private.coffee/'));
  assert.ok(browserRoutes.includes('https://overpass.private.coffee/'));
  assert.ok(browserRoutes.includes('this.log(`overpass direct · ${new URL(ep).host} · 0 éléments (essai d’un autre miroir)`);\n          continue;'));
});

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
      if (mode && typeof mode === 'object' && Number.isFinite(mode.delayMs)) {
        setTimeout(() => {
          if (res.destroyed) return;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(mode.json));
        }, mode.delayMs);
        return;
      }
      if (mode === 'remark' || mode === 'partial-remark') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          elements: mode === 'partial-remark' ? [{ type: 'way', id: 1 }] : [],
          remark: 'runtime error: Query timed out'
        }));
        return;
      }
      if (mode && typeof mode === 'object' && Number.isInteger(mode.status)) {
        res.writeHead(mode.status, mode.headers || {});
        res.end(mode.body ?? (mode.json === undefined ? '' : JSON.stringify(mode.json)));
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
    const state = new OverpassRotation();
    const d = await overpass(QUERY, { endpoints: [bad.url, good.url], rotation: state, budget: 8_000, perAttempt: 800, minSlice: 200, minAttempt: 200, reserve: 200 });
    assert.equal(d.elements[0].id, 42);
    assert.equal(bad.seen.requests, 1);
    assert.equal(good.seen.requests, 1);
    /* le miroir qui a répondu passe en tête pour la requête suivante */
    assert.equal(orderedEndpoints([bad.url, good.url], Date.now(), state)[0], good.url);
  });

  test('un miroir lent peut répondre après 8 s sans être annulé par le relais', async () => {
    const busy = await open('504');
    const slow = await open({ delayMs: 9_000, json: { elements: [{ type: 'way', id: 43 }] } });
    const d = await overpass(QUERY, {
      endpoints: [busy.url, slow.url], budget: 14_000, minSlice: 200,
      minAttempt: 200, reserve: 500
    });
    assert.equal(d.elements[0].id, 43);
    assert.equal(busy.seen.requests, 1);
    assert.equal(slow.seen.requests, 1);
  });

  test('un 429 consomme le quota du miroir: repli immédiat et pause aux appels suivants', async () => {
    const limited = await open({
      status: 429,
      headers: { 'Content-Type': 'text/plain', 'Retry-After': '120' },
      body: 'Too Many Requests'
    });
    const good = await open({ elements: [{ type: 'way', id: 84 }] });
    const state = new OverpassRotation();
    const d = await overpass(QUERY, {
      endpoints: [limited.url, good.url], rotation: state, budget: 8_000, perAttempt: 800,
      minSlice: 200, minAttempt: 200, reserve: 200
    });
    assert.equal(d.elements[0].id, 84);
    assert.equal(limited.seen.requests, 1);
    assert.equal(good.seen.requests, 1);
    assert.deepEqual(orderedEndpoints([limited.url, good.url], Date.now(), state), [good.url]);

    const again = await overpass(QUERY + ' ', {
      endpoints: [limited.url, good.url], rotation: state, budget: 8_000, perAttempt: 800,
      minSlice: 200, minAttempt: 200, reserve: 200
    });
    assert.equal(again.elements[0].id, 84);
    assert.equal(limited.seen.requests, 1, 'un miroir en pause ne reçoit pas de nouvelle requête');
    assert.equal(good.seen.requests, 2);
    const coolingError = await overpass(QUERY + '  ', {
      endpoints: [limited.url], rotation: state, budget: 3_000
    }).then(() => null, error => error);
    assert.match(coolingError.message, /ALL_OVERPASS_MIRRORS_COOLING/);
    assert.equal(coolingError.retryAfter, 120, 'le délai Retry-After du fournisseur est remonté');
    assert.equal(limited.seen.requests, 1, 'si tous les miroirs fournis sont en pause, on échoue sans les marteler');

    const empty = await open({ elements: [] });
    await assert.rejects(
      () => overpass(QUERY + ' empty', {
        endpoints: [limited.url, empty.url], rotation: state, budget: 5_000
      }),
      /OVERPASS_MIRRORS_COOLING/
    );
    assert.equal(empty.seen.requests, 1);
    assert.equal(limited.seen.requests, 1, 'un résultat vide ne masque pas un miroir encore en pause');
  });

  test('un en-tête quota à zéro met en pause le miroir même si sa réponse est bonne', async () => {
    const depleted = await open({
      status: 200,
      headers: { 'Content-Type': 'application/json', 'X-RateLimit-Remaining': '0', 'Retry-After': '120' },
      json: { elements: [{ type: 'way', id: 85 }] }
    });
    const other = await open({ elements: [{ type: 'way', id: 86 }] });
    const state = new OverpassRotation();
    const first = await overpass(QUERY, { endpoints: [depleted.url], rotation: state, budget: 3_000, minAttempt: 200, reserve: 200 });
    assert.equal(first.elements[0].id, 85, 'la réponse déjà acquise reste exploitable');
    const second = await overpass(QUERY + ' ', { endpoints: [depleted.url, other.url], rotation: state, budget: 5_000 });
    assert.equal(second.elements[0].id, 86);
    assert.equal(depleted.seen.requests, 1);
    assert.equal(other.seen.requests, 1);
  });

  test('un échec HTTP de requête ne provoque pas cinq appels identiques', async () => {
    const invalid = await open({ status: 400, headers: { 'Content-Type': 'text/plain' }, body: 'parse error' });
    const unused = await open({ elements: [{ id: 87 }] });
    await assert.rejects(
      () => overpass(QUERY, { endpoints: [invalid.url, unused.url], budget: 5_000 }),
      /HTTP 400/
    );
    assert.equal(invalid.seen.requests, 1);
    assert.equal(unused.seen.requests, 0);
  });

  test('un remark d’erreur invalide aussi une réponse partielle avec éléments', async () => {
    const partial = await open('partial-remark');
    const good = await open({ elements: [{ type: 'way', id: 88 }] });
    const d = await overpass(QUERY, { endpoints: [partial.url, good.url], budget: 5_000 });
    assert.equal(d.elements[0].id, 88);
    assert.equal(partial.seen.requests, 1);
    assert.equal(good.seen.requests, 1);
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

  test('un résultat vide ne masque pas l’échec des autres miroirs', async () => {
    const empty = await open({ elements: [] });
    const failed = await open('504');
    await assert.rejects(
      () => overpass(QUERY, { endpoints: [empty.url, failed.url], budget: 8_000, perAttempt: 800, minSlice: 200, minAttempt: 200, reserve: 200 }),
      /HTTP 504/
    );
    assert.equal(empty.seen.requests, 1);
    assert.equal(failed.seen.requests, 1);
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
