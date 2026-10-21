/* Accès : période d'essai ouverte (FM_ACCESS=open, le défaut) et retour au
   régime sous licence (FM_ACCESS=licence).

   Ce que ce banc protège : le mode ouvert doit vraiment tout ouvrir (aucune
   analyse refusée, aucun quota), et le basculement en mode licence doit
   rétablir exactement le comportement commercial — sans qu'on ait à modifier
   le code. Hors ligne : seules les actions `status`, `begin` et `end` sont
   exercées, jamais Overpass. */
import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.mjs';

const DEVICE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const AUTRE = '11111111-2222-3333-4444-555555555555';

let app, base;
let envAvant;

before(async () => {
  envAvant = process.env.FM_ACCESS;
  app = createApp({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'freemap-acces-')), cooldownMs: 0 });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + app.server.address().port;
});
after(() => {
  app.server.close(); app.runs.stop();
  if (envAvant === undefined) delete process.env.FM_ACCESS; else process.env.FM_ACCESS = envAvant;
});

const post = async (body) => {
  const r = await fetch(base + '/analysis/2d', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  return { status: r.status, body: await r.json() };
};
const statut = async () => (await fetch(base + '/api/status')).json();

/* Une analyse Pro : hors essai gratuit dans le régime sous licence. */
const ANALYSE_PRO = { ids: ['density'], radius: 600, lat: 36.2642, lon: 6.6969 };

describe('accès libre (période d’essai, le défaut)', () => {
  beforeEach(() => { delete process.env.FM_ACCESS; });

  test('/api/status annonce l’accès libre', async () => {
    const s = await statut();
    assert.equal(s.access, 'open');
    assert.ok(s.ok);
  });

  test('une analyse Pro passe sans licence ni code', async () => {
    const r = await post({ action: 'begin', device: DEVICE, ...ANALYSE_PRO });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.ok, true);
    assert.equal(r.body.tier, 'open');
    assert.equal(r.body.access, 'open');
    assert.ok(r.body.run);
    await post({ action: 'end', device: DEVICE, run: r.body.run });
  });

  test('la rose régionale ouvre un run sans lot Overpass local', async () => {
    const r = await post({ action: 'begin', device: DEVICE, ids: ['wind'], radius: 600, lat: 36.2642, lon: 6.6969 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.groups, []);
    await post({ action: 'end', device: DEVICE, run: r.body.run });
  });

  test('plusieurs analyses en parallèle ne sont pas refusées (aucun quota)', async () => {
    const [a, b, c] = await Promise.all([
      post({ action: 'begin', device: DEVICE, ...ANALYSE_PRO }),
      post({ action: 'begin', device: AUTRE, ...ANALYSE_PRO }),
      post({ action: 'begin', device: AUTRE, ids: ['roads', 'landuse'], radius: 900, lat: 36.26, lon: 6.69 })
    ]);
    for (const r of [a, b, c]) assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(a.body.tier, 'open');
    for (const r of [a, b, c]) await post({ action: 'end', device: DEVICE, run: r.body.run });
  });

  test('l’appareil reste obligatoire (ce n’est pas une licence, c’est le contrat)', async () => {
    const r = await post({ action: 'begin', device: 'pas-un-uuid', ...ANALYSE_PRO });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'INVALID_DEVICE');
  });

  test('le plan reste borné par les limites techniques de chaque analyse', async () => {
    /* Rayon hors limites : refusé dans tous les modes (validité des données,
       ce n’est pas une limitation commerciale). */
    const r = await post({ action: 'begin', device: DEVICE, ids: ['roads'], radius: 99_000, lat: 36.26, lon: 6.69 });
    assert.ok(r.status >= 400, JSON.stringify(r.body));
  });

  test('toutes les analyses du catalogue sont acceptées, une par une', async () => {
    const { MAX_IDS } = await import('../public/js/plan-2d.mjs');
    for (const id of MAX_IDS) {
      const r = await post({ action: 'begin', device: DEVICE, ids: [id], radius: 500, lat: 36.2642, lon: 6.6969 });
      assert.equal(r.status, 200, `${id} refusée : ${JSON.stringify(r.body)}`);
      assert.equal(r.body.tier, 'open');
      await post({ action: 'end', device: DEVICE, run: r.body.run });
    }
  });
});

describe('bascule en régime sous licence (FM_ACCESS=licence)', () => {
  beforeEach(() => { process.env.FM_ACCESS = 'licence'; });
  afterEach(() => { delete process.env.FM_ACCESS; });

  test('/api/status annonce le régime sous licence', async () => {
    const s = await statut();
    assert.equal(s.access, 'licence');
  });

  test('une analyse Pro redevient refusée sans licence', async () => {
    const r = await post({ action: 'begin', device: DEVICE, ...ANALYSE_PRO });
    assert.equal(r.status, 401);
    assert.equal(r.body.error, 'LICENCE_REQUIRED');
  });

  test('les cinq analyses gratuites repassent en essai', async () => {
    const r = await post({
      action: 'begin', device: DEVICE, public: true,
      ids: ['roads', 'landuse', 'gw', 'fabric', 'obmoccupancy'], radius: 600, lat: 36.2642, lon: 6.6969
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.tier, 'free');
    await post({ action: 'end', device: DEVICE, run: r.body.run });
  });

  test('le quota d’une génération à la fois redevient actif', async () => {
    const code = 'cs_demo_max';
    const act = await post({ action: 'activate', device: DEVICE, code });
    assert.equal(act.status, 200, JSON.stringify(act.body));
    const premier = await post({
      action: 'begin', device: DEVICE, account: act.body.account, token: act.body.token, ...ANALYSE_PRO
    });
    assert.equal(premier.status, 200, JSON.stringify(premier.body));
    assert.equal(premier.body.tier, 'max');

    const second = await post({
      action: 'begin', device: DEVICE, account: act.body.account, token: act.body.token, ids: ['roads'], radius: 600, lat: 36.26, lon: 6.69
    });
    assert.equal(second.status, 429);
    assert.equal(second.body.error, 'GENERATION_IN_PROGRESS');
    await post({ action: 'end', device: DEVICE, run: premier.body.run });
  });
});

describe('le client suit le mode annoncé par le serveur', () => {
  /* Contrôles statiques : ils ne prouvent pas le rendu, mais ils empêchent de
     casser le lien entre le mode serveur et le comportement du navigateur
     (catalogue déverrouillé, filigrane retiré) lors d’une modification. */
  const app = fs.readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');

  test('le client lit le champ `access` de /api/status', () => {
    assert.match(app, /status\.access\s*===\s*'open'/);
    assert.match(app, /fetch\('\/api\/status'\)/);
  });

  test('le catalogue est déverrouillé et le filigrane retiré en accès libre', () => {
    assert.match(app, /const unlocked = id => \{\s*\n\s*if \(isOpenAccess\(\)\) return true;/);
    assert.match(app, /watermark: !isOpenAccess\(\)/);
  });

  test('l’échec du serveur n’est jamais bloquant en accès libre', () => {
    assert.match(app, /const softTrial = !S\.studentAuthRequired && \(freeRun \|\| isOpenAccess\(\)\);/);
  });
});
