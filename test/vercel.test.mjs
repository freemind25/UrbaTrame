/* Mode Vercel : sessions sans état et fonctions serverless.
   Les fonctions sont appelées directement, avec des objets req/res minimaux :
   cela vérifie le contrat HTTP sans lancer de serveur ni toucher au réseau. */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../tools/kernel.mjs';
import { createLicence, keysFromEnv } from '../server/licence.mjs';

const DEVICE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const AUTRE = '11111111-2222-3333-4444-555555555555';

/* Jeu de clés identifiable : on le place dans l'environnement le temps du test
   pour que les fonctions serverless s'en servent au chargement. */
const { privateKey } = crypto.generateKeyPairSync('ed25519');
const JWK = privateKey.export({ format: 'jwk' });

/* ── faux req/res, juste ce que nos gestionnaires utilisent ── */
function fakeRes() {
  return {
    statusCode: 200, headers: {}, body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    writeHead(code, h) { this.statusCode = code; if (h) for (const [k, v] of Object.entries(h)) this.setHeader(k, v); },
    end(chunk) { this.body = chunk ?? ''; },
    get json() { try { return JSON.parse(this.body); } catch { return null; } }
  };
}
function fakeReq({ method = 'POST', url = '/analysis/2d', body = {}, form = null, headers = {} } = {}) {
  const payload = form ? new URLSearchParams(form).toString() : JSON.stringify(body);
  const listeners = {};
  const req = {
    method, url, headers: { 'x-forwarded-for': '203.0.113.9', ...headers },
    on(ev, fn) { listeners[ev] = fn; return req; },
    destroy() {}
  };
  /* Les gestionnaires lisent le corps de façon asynchrone : on émettra après
     que le gestionnaire se soit abonné. */
  queueMicrotask(() => {
    listeners.data?.(Buffer.from(payload));
    listeners.end?.();
  });
  return req;
}

const load = async (env) => {
  /* Import frais : les modules serverless figent leur runtime au chargement. */
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  const stamp = crypto.randomBytes(4).toString('hex');
  const copy = (rel) => path.join('/tmp', 'fm-vercel-' + stamp + '-' + rel.replace(/\//g, '_'));
  const files = ['api/_lib/runtime.mjs', 'api/status.js', 'api/util.js', 'api/analysis/2d.js'];
  for (const f of files) fs.copyFileSync(path.join(ROOT, f), copy(f));
  /* Les copies importent « ../../server/… » : on les laisse dans l'arborescence
     du projet, à côté d'un dossier temporaire, pour que les chemins résolvent. */
  const dir = path.join(ROOT, '.vercel-test-' + stamp);
  fs.mkdirSync(path.join(dir, 'api/_lib'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'api/analysis'), { recursive: true });
  for (const f of files) fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
};

describe('licence sans état (mode Vercel)', () => {
  const keys = (() => {
    const publicRaw = Buffer.from(JWK.x, 'base64url');
    return {
      privateKey: crypto.createPrivateKey({ key: JWK, format: 'jwk' }),
      publicKey: crypto.createPublicKey({ key: JWK, format: 'jwk' }),
      publicRaw
    };
  })();
  const lic = createLicence({ keys, stateless: true });

  test('aucun fichier n\'est écrit sur le disque', () => {
    const before = fs.readdirSync(ROOT).length;
    const l2 = createLicence({ keys, stateless: true });
    l2.activate('cs_demo_max', DEVICE);
    assert.equal(fs.readdirSync(ROOT).length, before, 'le dossier du projet reste inchangé');
  });

  test('l\'activation renvoie un jeton qui est le titre signé', () => {
    const r = lic.activate('cs_demo_max', DEVICE);
    assert.equal(r.ok, true);
    assert.equal(r.token, r.ent, 'le jeton est le titre : rien à stocker');
    assert.equal(r.token.split('.').length, 2);
  });

  test('le serveur revérifie le jeton sans mémoire', () => {
    const r = lic.activate('cs_etude_2026', DEVICE);
    const s = lic.check({ token: r.token, device: DEVICE });
    assert.equal(s.ok, true);
    assert.equal(s.tier, 'max');
    assert.ok(s.ent && s.ent.split('.').length === 2, 'titre rafraîchi renvoyé');
  });

  test('jeton d\'un autre appareil refusé', () => {
    const r = lic.activate('cs_demo_pro', DEVICE);
    assert.equal(lic.check({ token: r.token, device: AUTRE }).error, 'DEVICE_REVOKED');
  });

  test('jeton falsifié refusé', () => {
    const r = lic.activate('cs_demo_pro', DEVICE);
    const [body, sig] = r.token.split('.');
    const forge = Buffer.from(JSON.stringify({ v: 1, t: 'max', d: DEVICE, x: Date.now() + 1e11 })).toString('base64url');
    assert.equal(lic.check({ token: forge + '.' + sig, device: DEVICE }).error, 'DEVICE_REVOKED');
    assert.equal(lic.check({ token: body + '.AAAA', device: DEVICE }).error, 'DEVICE_REVOKED');
    assert.equal(lic.check({ token: 'n\'importe quoi', device: DEVICE }).error, 'INVALID_TOKEN');
  });

  test('titre expiré refusé', () => {
    const r = lic.activate('cs_demo_pro', DEVICE);
    const s = lic.check({ token: r.token, device: DEVICE }, Date.now() + 31 * 864e5);
    assert.equal(s.error, 'EXPIRED');
    assert.equal(s.expired, true);
  });

  test('sans clé : activation refusée, essai gratuit conservé', () => {
    const sansCle = createLicence({ keys: null, stateless: true });
    assert.equal(sansCle.disabled, true);
    assert.equal(sansCle.pubB64, '');
    assert.equal(sansCle.activate('cs_demo_max', DEVICE).error, 'NO_SIGNING_KEY');
    assert.deepEqual(sansCle.check({ token: 'x', device: DEVICE }).ok, undefined, 'aucune vérification possible');
    assert.deepEqual(sansCle.check({}), { ok: true, tier: 'free' });
  });

  test('une clé illisible ne fait pas tomber le service', () => {
    const l = keysFromEnv({ FM_SIGNING_KEY: 'pas-du-json' });
    assert.equal(l, null);
  });

  test('la clé d\'environnement est bien relue', () => {
    const l = keysFromEnv({ FM_SIGNING_KEY: Buffer.from(JSON.stringify(JWK)).toString('base64') });
    assert.ok(l && l.publicRaw.length === 32);
  });
});

describe('catalogue de licences', async () => {
  test('FM_CODES remplace les codes de démonstration', () => {
    const l = createLicence({
      keys: null, stateless: true,
      codes: new Map(Object.entries(JSON.parse('{"mon_code":{"plan":"pro","tier":"pro","days":7}}')))
    });
    assert.deepEqual(l.knownCodes(), ['mon_code']);
  });
});

describe('fonctions serverless', () => {
  let mods, cleanupEnv;

  before(async () => {
    process.env.FM_SIGNING_KEY = Buffer.from(JSON.stringify(JWK)).toString('base64');
    mods = {
      status: (await import('../api/status.js')).default,
      util: (await import('../api/util.js')).default,
      analysis: (await import('../api/analysis/2d.js')).default
    };
    cleanupEnv = () => { delete process.env.FM_SIGNING_KEY; };
  });

  test('GET /api/status expose la clé publique et les paliers', async () => {
    const res = fakeRes();
    await mods.status(fakeReq({ method: 'GET', url: '/api/status' }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json.ok, true);
    assert.equal(Buffer.from(res.json.pub, 'base64').length, 32);
    assert.deepEqual(res.json.free, ['roads', 'landuse', 'gw', 'fabric']);
  });

  test('POST /analysis/2d : check sans identifiants → essai', async () => {
    const res = fakeRes();
    await mods.analysis(fakeReq({ body: { action: 'check', device: DEVICE } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json.tier, 'free');
  });

  test('POST /analysis/2d : activation puis génération licenciée', async () => {
    const res1 = fakeRes();
    await mods.analysis(fakeReq({ body: { action: 'activate', device: DEVICE, code: 'cs_demo_max' } }), res1);
    assert.equal(res1.json.ok, true);
    const { account, token } = res1.json;

    const res2 = fakeRes();
    await mods.analysis(fakeReq({
      body: {
        action: 'begin', device: DEVICE, account, token,
        ids: ['roads', 'density'], radius: 600, lat: 36.26, lon: 6.69
      }
    }), res2);
    assert.equal(res2.statusCode, 200, 'begin licencié : ' + JSON.stringify(res2.json));
    assert.equal(res2.json.tier, 'max');
    assert.ok(res2.json.groups.length >= 1);
  });

  test('POST /analysis/2d : refus des analyses payantes sans licence', async () => {
    const res = fakeRes();
    await mods.analysis(fakeReq({
      body: { action: 'begin', device: DEVICE, ids: ['density'], radius: 600, lat: 36.26, lon: 6.69 }
    }), res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.json.error, 'LICENCE_REQUIRED');
  });

  test('POST /analysis/2d : entrées invalides', async () => {
    const r1 = fakeRes();
    await mods.analysis(fakeReq({ body: { action: 'check', device: 'court' } }), r1);
    assert.equal(r1.json.error, 'INVALID_DEVICE');

    const r2 = fakeRes();
    await mods.analysis(fakeReq({ body: { action: 'begin', device: DEVICE, ids: ['nope'], radius: 600, lat: 36, lon: 6 } }), r2);
    assert.equal(r2.json.error, 'INVALID_ANALYSES');

    const r3 = fakeRes();
    await mods.analysis(fakeReq({ body: { action: 'begin', device: DEVICE, ids: ['roads'], radius: 10, lat: 36, lon: 6 } }), r3);
    assert.equal(r3.json.error, 'RADIUS_200_3000');
  });

  test('les en-têtes CORS sont posés (appel depuis un autre domaine)', async () => {
    const res = fakeRes();
    await mods.analysis(fakeReq({ body: { action: 'check', device: DEVICE } }), res);
    assert.equal(res.headers['access-control-allow-origin'], '*');
  });

  test('OPTIONS et méthodes refusées', async () => {
    const opt = fakeRes();
    await mods.analysis(fakeReq({ method: 'OPTIONS' }), opt);
    assert.equal(opt.statusCode, 200);

    const get = fakeRes();
    await mods.analysis(fakeReq({ method: 'GET' }), get);
    assert.equal(get.statusCode, 405);

    const utilGet = fakeRes();
    await mods.util(fakeReq({ method: 'GET', url: '/api/util' }), utilGet);
    assert.equal(utilGet.statusCode, 405);
  });

  test('POST /api/util : utilitaire inconnu et recherche vide, sans réseau', async () => {
    const r1 = fakeRes();
    await mods.util(fakeReq({ url: '/api/util', form: { truc: '1' } }), r1);
    assert.equal(r1.json.error, 'UNKNOWN_UTILITY');

    const r2 = fakeRes();
    await mods.util(fakeReq({ url: '/api/util', form: { geocode: '   ' } }), r2);
    assert.equal(r2.json.error, 'EMPTY_QUERY');
  });
});
