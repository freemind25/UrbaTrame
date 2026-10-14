/* API HTTP : le serveur est lancé sur un port éphémère, avec un dossier de
   données temporaire. Tout ce qui est testé ici est hors ligne ; les chemins
   qui interrogent Overpass, NASA POWER ou Terrarium ne s'exécutent qu'avec
   FM_NET=1 (voir test:net). */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createApp } from '../server/index.mjs';

const DEVICE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const NET = !!process.env.FM_NET;

/* Ce banc éprouve le parcours SOUS LICENCE (4 gratuites, Pro/Max, quota).
   L'accès libre — le mode par défaut depuis la période d'essai — a son propre
   banc : test/acces.test.mjs. La variable est lue à chaque requête, donc la
   poser ici suffit. */
process.env.FM_ACCESS = 'licence';

let app, base, guarded, guardedBase;

before(async () => {
  /* Instance principale : sans temps de refroidissement, pour que les suites
     ne se bloquent pas mutuellement (le quota est indexé sur l'IP, identique
     dans toute la campagne de tests). */
  app = createApp({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'freemap-api-')), cooldownMs: 0 });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + app.server.address().port;

  /* Seconde instance : réglage de production, pour le test de refroidissement. */
  guarded = createApp({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'freemap-api-g-')) });
  await new Promise(r => guarded.server.listen(0, '127.0.0.1', r));
  guardedBase = 'http://127.0.0.1:' + guarded.server.address().port;
});
after(() => { app.server.close(); app.runs.stop(); guarded.server.close(); guarded.runs.stop(); });

const postTo = async (origin, url, body, form = false) => {
  const r = await fetch(origin + url, {
    method: 'POST',
    headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
    body: form ? new URLSearchParams(body).toString() : JSON.stringify(body)
  });
  let parsed = null;
  try { parsed = await r.json(); } catch { /* réponse non JSON */ }
  return { status: r.status, body: parsed, headers: r.headers };
};
const post = (url, body, form = false) => postTo(base, url, body, form);
const analyse = body => post('/analysis/2d', body);
const analyseTo = (origin, body) => postTo(origin, '/analysis/2d', body);

describe('service', () => {
  test('GET /api/status expose paliers, limites et clé publique', async () => {
    const r = await fetch(base + '/api/status');
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.ok, true);
    assert.match(j.version, /^\d+\.\d+\.\d+$/);
    assert.deepEqual(j.free, ['roads', 'landuse', 'gw', 'fabric']);
    assert.equal(j.max.length, 8);
    assert.equal(Buffer.from(j.pub, 'base64').length, 32);
    assert.equal(j.trace, r.headers.get('x-em-trace'), 'trace renvoyée en en-tête');
    assert.ok(j.codes.includes('cs_demo_pro'));
  });

  test('les fichiers statiques sont servis, la traversée ne l\'est pas', async () => {
    const home = await fetch(base + '/');
    assert.equal(home.status, 200);
    const homeHtml = await home.text();
    assert.ok(homeHtml.includes('<title>UrbaTrame — analyse des sites urbains</title>'));
    assert.match(homeHtml, /Analyse des sites urbains/);
    assert.equal((await fetch(base + '/urbatrame-emblem.png')).status, 200);
    assert.equal((await fetch(base + '/urbatrame-favicon.png')).status, 200);
    assert.equal((await fetch(base + '/favicon.svg')).status, 200);
    assert.equal((await fetch(base + '/js/osm.mjs')).status, 200);
    assert.equal((await fetch(base + '/js/osm.mjs')).headers.get('content-type'),
      'text/javascript; charset=utf-8');
    assert.equal((await fetch(base + '/data/sample-elkhroub.json')).status, 200);
    assert.equal((await fetch(base + '/../server/config.mjs')).status, 404);
    assert.equal((await fetch(base + '/js/inexistant.js')).status, 404);
  });

  test('l’atelier Altiplan est intégré à UrbaTrame, sans compte ni quota', async () => {
    const page = await fetch(base + '/atelier.html');
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /UrbaTrame — Atelier topographique Altiplan/);
    assert.match(html, /Analyse des sites urbains/);
    assert.match(html, /intégrée à UrbaTrame/);
    assert.match(html, /urbatrame-emblem\.png/);
    assert.doesNotMatch(html, /github\.com\/freemind25\/altiplan/);
    assert.equal((await fetch(base + '/js/atelier/app.mjs')).status, 200);

    const health = await fetch(base + '/api/atelier/health');
    assert.equal(health.status, 200);
    const info = await health.json();
    assert.equal(info.name, 'UrbaTrame');
    assert.equal(info.feature, 'atelier-topographique');
    assert.ok(info.datasets.includes('trees') && info.datasets.includes('parcels'));

    const invalid = await post('/api/atelier/extract', {
      lat: 36.2642, lon: 6.6969, radius: 100, include: ['trees']
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error, 'RADIUS_OUT_OF_RANGE');
  });
});

describe('robustesse des entrées', () => {
  test('JSON illisible', async () => {
    const r = await fetch(base + '/analysis/2d', { method: 'POST', body: '{oups' });
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error, 'BAD_JSON');
  });

  test('appareil absent ou mal formé', async () => {
    for (const device of [undefined, '', 'xyz', '0000-api-0000', 7])
      assert.equal((await analyse({ action: 'check', device })).body.error, 'INVALID_DEVICE', String(device));
  });

  test('action inconnue', async () => {
    assert.equal((await analyse({ action: 'explode', device: DEVICE })).body.error, 'UNKNOWN_ACTION');
  });

  test('analyse inconnue', async () => {
    const r = await analyse({ action: 'begin', device: DEVICE, ids: ['nope'], radius: 600, lat: 36.26, lon: 6.69 });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'INVALID_ANALYSES');
  });

  test('rayon hors bornes', async () => {
    const r = await analyse({ action: 'begin', device: DEVICE, ids: ['roads'], radius: 50, lat: 36.26, lon: 6.69 });
    assert.equal(r.body.error, 'RADIUS_200_3000');
  });
});

describe('paliers', () => {
  test('les quatre analyses gratuites passent sans licence', async () => {
    const r = await analyse({
      action: 'begin', device: DEVICE, public: true,
      ids: ['roads', 'landuse', 'gw', 'fabric'], radius: 600, lat: 36.2642, lon: 6.6969
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.tier, 'free');
    assert.ok(r.body.run && r.body.groups.length >= 1);
    await analyse({ action: 'end', device: DEVICE, run: r.body.run });
  });

  test('une analyse sous licence est refusée sans licence', async () => {
    const r = await analyse({ action: 'begin', device: DEVICE, ids: ['density'], radius: 600, lat: 36.26, lon: 6.69 });
    assert.equal(r.status, 401);
    assert.equal(r.body.error, 'LICENCE_REQUIRED');
  });

  test('check annonce le palier gratuit sans identifiants', async () => {
    const r = await analyse({ action: 'check', device: DEVICE });
    assert.equal(r.status, 200);
    assert.equal(r.body.tier, 'free');
    assert.ok(r.body.pub);
  });
});

describe('activation et quota', () => {
  let account, token;

  test('activation d\'un code de démonstration', async () => {
    const r = await analyse({ action: 'activate', device: DEVICE, code: 'cs_demo_max' });
    assert.equal(r.status, 200);
    assert.equal(r.body.tier, 'max');
    ({ account, token } = r.body);
    /* le titre doit être vérifiable avec la clé publique publiée */
    const pub = (await (await fetch(base + '/api/status')).json()).pub;
    const [body, sig] = r.body.ent.split('.');
    const ok = crypto.verify(null, Buffer.from(body),
      crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(pub, 'base64').toString('base64url') }, format: 'jwk' }),
      Buffer.from(sig, 'base64url'));
    assert.ok(ok, 'titre signé par le serveur');
  });

  test('code inconnu', async () => {
    const r = await analyse({ action: 'activate', device: DEVICE, code: 'cs_faux' });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'INVALID_CODE');
  });

  test('check confirme la licence', async () => {
    const r = await analyse({ action: 'check', device: DEVICE, account, token });
    assert.equal(r.body.tier, 'max');
    assert.ok(r.body.ent);
  });

  test('une génération en vol ferme le quota de l\'IP', async () => {
    const first = await analyse({
      action: 'begin', device: DEVICE, account, token,
      ids: ['roads', 'density'], radius: 600, lat: 36.2642, lon: 6.6969
    });
    assert.equal(first.status, 200);
    assert.equal(first.body.tier, 'max');

    const second = await analyse({
      action: 'begin', device: DEVICE, account, token,
      ids: ['roads'], radius: 600, lat: 36.2642, lon: 6.6969
    });
    assert.equal(second.status, 429);
    assert.equal(second.body.error, 'GENERATION_IN_PROGRESS');
    assert.ok(Number(second.headers.get('retry-after')) > 0, 'Retry-After annoncé');

    assert.equal((await analyse({ action: 'end', device: DEVICE, run: first.body.run })).body.ok, true);
  });

  test('lot inconnu et run inconnu', async () => {
    const b = await analyse({
      action: 'begin', device: DEVICE, account, token,
      ids: ['roads'], radius: 600, lat: 36.2642, lon: 6.6969
    });
    assert.equal((await analyse({ action: 'query', device: DEVICE, account, token, run: b.body.run, group: 'nope' })).status, 400);
    assert.equal((await analyse({ action: 'query', device: DEVICE, account, token, run: 'inconnu', group: 'base' })).status, 409);
    await analyse({ action: 'end', device: DEVICE, run: b.body.run });
  });

  test('après une génération, l\'IP est mise au repos (instance de production)', async () => {
    const act = await analyseTo(guardedBase, { action: 'activate', device: DEVICE, code: 'cs_etude_2026' });
    const creds = { account: act.body.account, token: act.body.token };

    const b = await analyseTo(guardedBase, {
      action: 'begin', device: DEVICE, ...creds, ids: ['roads'], radius: 600, lat: 36.2642, lon: 6.6969
    });
    assert.equal(b.status, 200);
    await analyseTo(guardedBase, { action: 'end', device: DEVICE, run: b.body.run });

    const again = await analyseTo(guardedBase, {
      action: 'begin', device: DEVICE, ...creds, ids: ['roads'], radius: 600, lat: 36.2642, lon: 6.6969
    });
    assert.equal(again.body.error, 'RATE_LIMITED', 'refroidissement de 20 s');
    const wait = Number(again.headers.get('retry-after'));
    assert.ok(wait > 0 && wait <= 20, 'Retry-After : ' + wait);
  });
});

describe('utilitaires', () => {
  test('parrainage : format et inconnu', async () => {
    assert.equal((await post('/', { refcheck: 'MTN-ABCDE' }, true)).body.ok, true);
    assert.equal((await post('/', { refcheck: 'n\'importe quoi' }, true)).body.ok, false);
    assert.equal((await post('/', { refcode: 'cs_inconnu' }, true)).body.ok, false);
    const r = await post('/', { refcode: 'cs_demo_max' }, true);
    assert.equal(r.body.ok, true);
    assert.match(r.body.ref, /^MTN-/);
  });

  test('utilitaire inconnu', async () => {
    assert.equal((await post('/', { truc: '1' }, true)).body.error, 'UNKNOWN_UTILITY');
  });

  test('recherche de lieu vide', async () => {
    assert.equal((await post('/', { geocode: '   ' }, true)).body.error, 'EMPTY_QUERY');
  });
});

describe('sources en réseau', { skip: NET ? false : 'FM_NET=1 pour interroger les sources' }, () => {
  test('recherche de lieu (Nominatim)', async () => {
    const r = await post('/', { geocode: 'El Khroub' }, true);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body) && r.body.length >= 1);
  });

  test('génération complète d\'un plan gratuit (Overpass)', async () => {
    const dev = crypto.randomUUID();
    const b = await analyse({ action: 'begin', device: dev, public: true, ids: ['roads', 'gw'], radius: 600, lat: 36.2642, lon: 6.6969 });
    assert.equal(b.status, 200);
    for (const g of b.body.groups) {
      const q = await analyse({ action: 'query', device: dev, run: b.body.run, group: g.id });
      assert.equal(q.status, 200, 'lot ' + g.id);
      assert.ok(q.body.elements.length > 0, 'lot ' + g.id + ' non vide');
    }
    assert.equal((await analyse({ action: 'end', device: dev, run: b.body.run })).body.ok, true);
  });

  test('altimétrie (tuiles Terrarium)', async () => {
    const r = await analyse({ action: 'terrain', device: DEVICE, lat: 36.2642, lon: 6.6969, radius: 600, n: 16 });
    assert.equal(r.status, 200);
    assert.equal(r.body.n, 16);
    assert.equal(r.body.grid.length, 16);
    assert.ok(r.body.grid.flat().every(v => Number.isFinite(v)));
    assert.ok(r.body.grid.flat().some(v => v !== r.body.grid[0][0]), 'relief non plat');
  });

  test('climat (NASA POWER)', async () => {
    const r = await analyse({ action: 'climate', device: DEVICE, lat: 36.2642, lon: 6.6969 });
    assert.equal(r.status, 200);
    assert.ok(r.body.params.T2M_MAX);
    assert.ok(Object.keys(r.body.params.T2M_MAX).length > 300);
  });
});
