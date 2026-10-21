/* Générateur et activation des fichiers .utlic : aucun secret n’est écrit
   dans le dépôt pendant ces tests. Les paires sont temporaires et en mémoire. */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  LICENSE_FILE_FORMAT, issuerPublicKeyFromRaw, makeLicenseClaims,
  signLicenseToken, verifyLicenseToken
} from '../server/licence-token.mjs';
import { createLicence, resolveCodes } from '../server/licence.mjs';
import { verifyIssuedLicenseToken } from '../public/js/licence-client.mjs';
import {
  createLicenseArtifact, decryptIssuerVault, encryptIssuerVault
} from '../tools/licence-manager.mjs';

const DEVICE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const NOW = Date.UTC(2026, 9, 18, 12, 0, 0);

describe('catalogue historique', () => {
  test('aucun code de démonstration n’est chargé en production ou sur Vercel', () => {
    assert.equal(resolveCodes({ env: { NODE_ENV: 'production' } }).size, 0);
    assert.equal(resolveCodes({ env: { VERCEL: '1' } }).size, 0);
  });

  test('les codes de démonstration ne restent disponibles qu’en développement', () => {
    assert.ok(resolveCodes({ env: { NODE_ENV: 'development' } }).has('cs_demo_pro'));
  });
});

function keyPair() {
  const pair = crypto.generateKeyPairSync('ed25519');
  const publicJwk = pair.publicKey.export({ format: 'jwk' });
  const publicRaw = Buffer.from(publicJwk.x, 'base64url');
  return { ...pair, publicRaw, issuer: issuerPublicKeyFromRaw(publicRaw) };
}

describe('coffre privé du générateur', () => {
  test('la clé privée est chiffrée puis déchiffrable avec le mot de passe', () => {
    const pair = keyPair();
    const privateJwk = pair.privateKey.export({ format: 'jwk' });
    const vault = encryptIssuerVault(privateJwk, pair.publicRaw, 'mot-de-passe-assez-long');
    assert.equal(vault.format, 'UrbaTrame-License-Issuer-Key');
    assert.equal(JSON.stringify(vault).includes(privateJwk.d), false);
    assert.deepEqual(decryptIssuerVault(vault, 'mot-de-passe-assez-long'), privateJwk);
    const changedPublic = { ...vault, publicKey: Buffer.alloc(32, 7).toString('base64') };
    assert.throws(() => decryptIssuerVault(changedPublic, 'mot-de-passe-assez-long'), /WRONG_PASSPHRASE_OR_DAMAGED_VAULT/);
  });

  test('un mot de passe erroné ne déchiffre pas le coffre', () => {
    const pair = keyPair();
    const vault = encryptIssuerVault(pair.privateKey.export({ format: 'jwk' }), pair.publicRaw, 'un-autre-mot-de-passe');
    assert.throws(() => decryptIssuerVault(vault, 'mauvais-mot-de-passe-123'), /WRONG_PASSPHRASE_OR_DAMAGED_VAULT/);
  });
});

describe('fichiers de licence signés', () => {
  test('un fichier Pro daté est signé et vérifié avec la clé publique', () => {
    const pair = keyPair();
    const artifact = createLicenseArtifact({ tier: 'pro', days: 30, privateKey: pair.privateKey, now: NOW });
    assert.equal(artifact.format, LICENSE_FILE_FORMAT);
    assert.equal(artifact.tier, 'pro');
    assert.equal(artifact.expiresAt, new Date(NOW + 30 * 86_400_000).toISOString());
    const check = verifyLicenseToken(artifact.token, pair.issuer.publicKey, NOW);
    assert.equal(check.ok, true);
    assert.equal(check.claims.licenseId, artifact.licenseId);
    assert.equal(check.claims.tier, 'pro');
  });

  test('un fichier Max à vie n’a pas d’expiration', () => {
    const pair = keyPair();
    const artifact = createLicenseArtifact({ tier: 'max', lifetime: true, privateKey: pair.privateKey, now: NOW });
    assert.equal(artifact.expiresAt, null);
    assert.equal(verifyLicenseToken(artifact.token, pair.issuer.publicKey, NOW + 50 * 365 * 86_400_000).ok, true);
  });

  test('modification, signature d’une autre paire et expiration sont rejetées', () => {
    const pair = keyPair(), other = keyPair();
    const artifact = createLicenseArtifact({ tier: 'max', days: 1, privateKey: pair.privateKey, now: NOW });
    const [body, signature] = artifact.token.split('.');
    const changedSignature = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
    assert.equal(verifyLicenseToken(body + '.' + changedSignature, pair.issuer.publicKey, NOW).error, 'INVALID_LICENSE');
    assert.equal(verifyLicenseToken(artifact.token, other.issuer.publicKey, NOW).error, 'INVALID_LICENSE');
    assert.equal(verifyLicenseToken(artifact.token, pair.issuer.publicKey, NOW + 86_400_001).error, 'EXPIRED');
  });

  test('les claims de produit, palier et identifiant sont strictement validés', () => {
    assert.throws(() => makeLicenseClaims({ tier: 'enterprise', licenseId: 'UTL-0123456789ABCDEF', issuedAt: NOW }), /INVALID_LICENSE/);
    assert.throws(() => makeLicenseClaims({ tier: 'pro', licenseId: 'BAD-ID', issuedAt: NOW }), /INVALID_LICENSE/);
    const pair = keyPair();
    const claims = { v: 1, product: 'Autre', licenseId: 'UTL-0123456789ABCDEF', tier: 'pro', issuedAt: NOW, expiresAt: null };
    assert.throws(() => signLicenseToken(claims, pair.privateKey), /INVALID_LICENSE/);
  });
});

describe('vérification WebCrypto côté navigateur', () => {
  test('le même titre est validé côté client; altération et expiration sont refusées', async () => {
    const pair = keyPair();
    const artifact = createLicenseArtifact({ tier: 'pro', days: 30, privateKey: pair.privateKey, now: NOW });
    const webKey = await crypto.webcrypto.subtle.importKey(
      'raw', pair.publicRaw, { name: 'Ed25519' }, false, ['verify']);
    const valid = await verifyIssuedLicenseToken(artifact.token, webKey, NOW, crypto.webcrypto.subtle);
    assert.equal(valid?.licenseId, artifact.licenseId);
    assert.equal(await verifyIssuedLicenseToken(artifact.token + 'x', webKey, NOW, crypto.webcrypto.subtle), null);
    assert.equal(await verifyIssuedLicenseToken(artifact.token, webKey, NOW + 31 * 86_400_000, crypto.webcrypto.subtle), null);
  });
});

describe('activation serveur d’un fichier .utlic', () => {
  test('l’activation produit un droit lié à l’appareil et vérifiable sans état', () => {
    const pair = keyPair();
    const artifact = createLicenseArtifact({ tier: 'max', days: 90, privateKey: pair.privateKey, now: NOW });
    const app = createLicence({
      keys: pair,
      issuerPublicKey: pair.issuer,
      codes: new Map(),
      stateless: true
    });
    const activated = app.activateLicense(artifact.token, DEVICE, NOW);
    assert.equal(activated.ok, true);
    assert.equal(activated.tier, 'max');
    assert.equal(activated.token, activated.ent);
    assert.equal(app.check({ token: activated.token, device: DEVICE }, NOW).tier, 'max');
    assert.equal(app.check({ token: activated.token, device: '11111111-2222-3333-4444-555555555555' }, NOW).error, 'DEVICE_REVOKED');
  });

  test('fichier expiré, altéré ou émetteur absent refusé', () => {
    const pair = keyPair();
    const artifact = createLicenseArtifact({ tier: 'pro', days: 1, privateKey: pair.privateKey, now: NOW });
    const app = createLicence({ keys: pair, issuerPublicKey: pair.issuer, codes: new Map(), stateless: true });
    assert.equal(app.activateLicense(artifact.token, DEVICE, NOW + 86_400_001).error, 'EXPIRED');
    assert.equal(app.activateLicense(artifact.token + 'x', DEVICE, NOW).error, 'INVALID_LICENSE');
    const noIssuer = createLicence({ keys: pair, issuerPublicKey: null, codes: new Map(), stateless: true });
    assert.equal(noIssuer.activateLicense(artifact.token, DEVICE, NOW).error, 'LICENSE_ISSUER_UNCONFIGURED');
  });

  test('un droit à vie reste sans date d’expiration après activation et renouvellement', () => {
    const pair = keyPair();
    const artifact = createLicenseArtifact({ tier: 'pro', lifetime: true, privateKey: pair.privateKey, now: NOW });
    const app = createLicence({ keys: pair, issuerPublicKey: pair.issuer, codes: new Map(), stateless: true });
    const activated = app.activateLicense(artifact.token, DEVICE, NOW);
    assert.equal(activated.expiresAt, null);
    const checked = app.check({ token: activated.token, device: DEVICE }, NOW + 100 * 365 * 86_400_000);
    assert.equal(checked.ok, true);
    assert.equal(checked.expiresAt, null);
  });
});
