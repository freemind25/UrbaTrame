/* Contrat statique du parcours de licence : le rendu interactif doit encore
   être confirmé dans un navigateur avant activation publique. */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const read = file => fs.readFileSync(new URL(file, root), 'utf8');

/* L'objet URL sert directement d'identifiant d'import : transmettre son
   `pathname` (préfixé d'un `/` sous Windows) produisait `file:///C:/C:/…`. */
await import(new URL('../public/js/catalog.js', import.meta.url));
const catalog = globalThis.FMCatalog;

describe('matrice Pro/Max', () => {
  test('les paliers codés correspondent à 5 gratuites, 33 Pro et 8 Max', () => {
    assert.equal(catalog.length, 46);
    assert.equal(catalog.filter(item => item.tier === 'free').length, 5);
    assert.equal(catalog.filter(item => item.tier === 'pro').length, 33);
    assert.equal(catalog.filter(item => item.tier === 'max').length, 8);
  });
});

describe('interface d’activation', () => {
  test('l’application importe un .utlic et vérifie la signature avec WebCrypto', () => {
    const app = read('public/js/app.js');
    assert.match(app, /accept="\.utlic,application\/json"/);
    assert.match(app, /verifyIssuedLicenseToken/);
    assert.match(read('public/js/licence-client.mjs'), /subtle\.verify\(/);
    assert.match(app, /licenseToken: store\.get\('licenseToken'/);
  });

  test('les codes de démonstration ne sont plus affichés dans l’interface publique', () => {
    const app = read('public/js/app.js');
    const home = read('public/index.html');
    assert.doesNotMatch(app, /cs_demo_(?:pro|max|lifetime)/);
    assert.doesNotMatch(home, /cs_demo_(?:pro|max|lifetime)/);
  });
});
