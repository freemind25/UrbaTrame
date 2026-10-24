/* Parcours HTTP local d’activation d’un .utlic : aucun appel externe. */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.mjs';
import { createLicenseArtifact } from '../tools/licence-manager.mjs';

const DEVICE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const pair = crypto.generateKeyPairSync('ed25519');
const privateJwk = pair.privateKey.export({ format: 'jwk' });
const publicJwk = pair.publicKey.export({ format: 'jwk' });
const publicRaw = Buffer.from(publicJwk.x, 'base64url');
const previous = {
  FM_LICENSE_PUB: process.env.FM_LICENSE_PUB,
  FM_ACCESS: process.env.FM_ACCESS,
  VERCEL: process.env.VERCEL
};
let app, base, tempDir, artifact;

before(async () => {
  process.env.FM_LICENSE_PUB = publicRaw.toString('base64');
  process.env.FM_ACCESS = 'licence';
  delete process.env.VERCEL;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'urbatrame-licence-api-'));
  app = createApp({ dataDir: tempDir, cooldownMs: 0 });
  artifact = createLicenseArtifact({ tier: 'pro', days: 30, privateKey: pair.privateKey });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + app.server.address().port;
});

after(() => {
  app?.server.close();
  app?.runs.stop();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

async function post(body) {
  const response = await fetch(base + '/analysis/2d', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

describe('activation .utlic par l’API locale', () => {
  test('le statut indique que l’émetteur est configuré sans publier de codes', async () => {
    const status = await (await fetch(base + '/api/status')).json();
    assert.equal(status.licenses.signedFileActivation, true);
    assert.equal(status.licenses.publicKey, publicRaw.toString('base64'));
    assert.equal('codes' in status, false);
  });

  test('le serveur vérifie le .utlic importé localement puis autorise une analyse Pro', async () => {
    const account = 'license_' + artifact.licenseId;
    const checked = await post({ action: 'check', device: DEVICE, account, token: artifact.token });
    assert.equal(checked.status, 200, JSON.stringify(checked.body));
    assert.equal(checked.body.tier, 'pro');
    assert.ok(checked.body.ent, 'attestation de session signée renvoyée au navigateur');
    const begun = await post({
      action: 'begin', device: DEVICE, account, token: artifact.token,
      ids: ['density'], radius: 600, lat: 36.2642, lon: 6.6969
    });
    assert.equal(begun.status, 200, JSON.stringify(begun.body));
    assert.equal(begun.body.tier, 'pro');
    await post({ action: 'end', device: DEVICE, account, token: artifact.token, run: begun.body.run });
  });

  test('l’endpoint d’activation en ligne peut aussi échanger le titre contre une session', async () => {
    const activated = await post({ action: 'activateLicense', device: DEVICE, license: artifact.token });
    assert.equal(activated.status, 200, JSON.stringify(activated.body));
    assert.equal(activated.body.tier, 'pro');
    assert.ok(activated.body.ent);
  });

  test('fichier altéré refusé avec une réponse de validation', async () => {
    const response = await post({ action: 'activateLicense', device: DEVICE, license: artifact.token + 'x' });
    assert.equal(response.status, 400);
    assert.equal(response.body.error, 'INVALID_LICENSE');
  });
});
