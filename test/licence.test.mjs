/* Licences : clés persistantes, codes, titre signé, vérification hors ligne. */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createLicence, validDevice, DAY } from '../server/licence.mjs';

const DEVICE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freemap-lic-'));
const licence = createLicence({ dataDir: dir });

/* Vérification indépendante du titre, comme le fait le navigateur. */
function verifyEnt(ent, pubB64) {
  const [body, sig] = ent.split('.');
  const key = crypto.createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(pubB64, 'base64').toString('base64url') },
    format: 'jwk'
  });
  const ok = crypto.verify(null, Buffer.from(body), key, Buffer.from(sig, 'base64url'));
  return { ok, payload: JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) };
}

describe('clés', () => {
  test('une paire est créée au premier démarrage, en 0600', () => {
    const f = path.join(dir, 'keys.json');
    assert.ok(fs.existsSync(f));
    assert.equal(fs.statSync(f).mode & 0o777, 0o600, 'droits du fichier de clés');
  });

  test('la clé publique survit au redémarrage (sinon les licences tombent)', () => {
    const again = createLicence({ dataDir: dir });
    assert.equal(again.pubB64, licence.pubB64);
  });

  test('la clé publique est un point Ed25519 de 32 octets', () => {
    assert.equal(Buffer.from(licence.pubB64, 'base64').length, 32);
  });
});

describe('activation', () => {
  test('code inconnu refusé', () => {
    assert.deepEqual(licence.activate('cs_faux', DEVICE), { error: 'INVALID_CODE', status: 400 });
  });

  test('appareil invalide refusé', () => {
    assert.equal(licence.activate('cs_demo_pro', 'coucou').error, 'INVALID_DEVICE');
    /* l'ancien identifiant factice du client ne doit plus passer */
    assert.equal(licence.activate('cs_demo_pro', '0000-api-0000').error, 'INVALID_DEVICE');
  });

  test('code de démonstration Pro', () => {
    const r = licence.activate('cs_demo_pro', DEVICE);
    assert.equal(r.ok, true);
    assert.equal(r.tier, 'pro');
    assert.equal(r.plan, 'pro');
    assert.match(r.account, /^acc_[0-9a-f]{12}$/);
    assert.match(r.ref, /^MTN-[A-Z0-9]{5}$/);
    assert.ok(r.expiresAt > Date.now() && r.expiresAt <= Date.now() + 31 * DAY);
  });

  test('code à vie : pas de date d\'expiration', () => {
    const r = licence.activate('cs_demo_lifetime', DEVICE);
    assert.equal(r.tier, 'max');
    assert.equal(r.expiresAt, null);
  });

  test('le code de parrainage reste stable pour un même code', () => {
    const a = licence.activate('cs_demo_max', DEVICE);
    const b = licence.activate('cs_demo_max', DEVICE);
    assert.equal(a.ref, b.ref);
  });
});

describe('titre signé', () => {
  test('la signature est vérifiable hors ligne et porte l\'appareil', () => {
    const r = licence.activate('cs_etude_2026', DEVICE);
    const { ok, payload } = verifyEnt(r.ent, licence.pubB64);
    assert.ok(ok, 'signature Ed25519');
    assert.deepEqual({ v: payload.v, t: payload.t, d: payload.d }, { v: 1, t: 'max', d: DEVICE });
    assert.ok(payload.x > Date.now());
  });

  test('un titre modifié ne passe plus', () => {
    const r = licence.activate('cs_demo_pro', DEVICE);
    const [body] = r.ent.split('.');
    const forged = Buffer.from(JSON.stringify({ v: 1, t: 'max', d: DEVICE, x: Date.now() + 1e12 }));
    const ent = forged.toString('base64url') + '.' + r.ent.split('.')[1];
    assert.equal(verifyEnt(ent, licence.pubB64).ok, false);
    assert.notEqual(body, forged.toString('base64url'));
  });

  test('une autre paire de clés ne valide pas le titre', () => {
    const other = createLicence({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'freemap-lic2-')) });
    const r = licence.activate('cs_demo_pro', DEVICE);
    assert.equal(verifyEnt(r.ent, other.pubB64).ok, false);
  });
});

describe('session', () => {
  test('sans identifiants : palier gratuit', () => {
    assert.deepEqual(licence.check({}), { ok: true, tier: 'free' });
  });

  test('session valide', () => {
    const r = licence.activate('cs_demo_max', DEVICE);
    const s = licence.check({ account: r.account, token: r.token, device: DEVICE });
    assert.equal(s.ok, true);
    assert.equal(s.tier, 'max');
    assert.ok(verifyEnt(s.ent, licence.pubB64).ok, 'le titre renvoyé est signé');
  });

  test('compte étranger refusé', () => {
    const r = licence.activate('cs_demo_max', DEVICE);
    const s = licence.check({ account: 'acc_000000000000', token: r.token, device: DEVICE });
    assert.deepEqual(s, { error: 'DEVICE_REVOKED', status: 403 });
  });

  test('jeton inconnu refusé', () => {
    assert.equal(licence.check({ account: 'acc_x', token: 'zzz', device: DEVICE }).error, 'DEVICE_REVOKED');
  });

  test('session expirée', () => {
    const r = licence.activate('cs_demo_pro', DEVICE);
    const s = licence.check({ account: r.account, token: r.token, device: DEVICE },
      Date.now() + 31 * DAY);
    assert.equal(s.error, 'EXPIRED');
    assert.equal(s.expired, true);
  });
});

describe('identifiants d\'appareil', () => {
  test('formats acceptés et refusés', () => {
    assert.ok(validDevice(DEVICE));
    assert.ok(validDevice('0123456789abcdef'));
    for (const bad of ['', 'court', 'AZERTYUIOPAZERTYUIOP', '0000-api-0000', null, 42])
      assert.ok(!validDevice(bad), String(bad));
  });
});
