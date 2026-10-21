import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIME } from '../server/http.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

describe('UrbaTrame · prise en charge GeoPackage/GeoTIFF dans l’interface', () => {
  test('déclare les formats, limites et avertissements du traitement raster local', () => {
    const html = read('public/atelier-cartographique.html');
    const ui = read('public/js/atelier/local-layers-ui.mjs');
    assert.match(html, /\.gpkg/);
    assert.match(html, /\.tif/);
    assert.match(html, /1 million de pixels\/fichier/);
    assert.match(html, /aperçu affine approximatif/);
    assert.match(html, /aucun rééchantillonnage ni traitement raster pixel par pixel/);
    assert.match(html, /Les fichiers locaux ne sont jamais téléversés/);
    assert.match(ui, /parseGeoPackage\(bytes, SQL/);
    assert.match(ui, /parseGeoTiff\(sourceBytes, GeoTIFFApi/);
    assert.match(ui, /\/vendor\/sql\.js\/sql-wasm-browser\.js/);
    assert.match(ui, /\/vendor\/geotiff\/geotiff\.js/);
    assert.match(ui, /sourceDataBase64/);
    assert.match(ui, /class: 'raster-overlay'/);
    assert.match(ui, /\.external-basemap-image/);
  });

  test('sert le WebAssembly avec son type MIME et inclut les avis de licences nécessaires', () => {
    assert.equal(MIME['.wasm'], 'application/wasm');
    for (const file of [
      'public/vendor/sql.js/sql-wasm-browser.js', 'public/vendor/sql.js/sql-wasm-browser.wasm',
      'public/vendor/sql.js/LICENSE', 'public/vendor/geotiff/geotiff.js', 'public/vendor/geotiff/LICENSE',
      'public/vendor/geotiff/licenses/lerc-Apache-2.0.txt', 'THIRD-PARTY-NOTICES.md'
    ]) assert.ok(fs.statSync(path.join(ROOT, file)).size > 0, `${file} manquant`);
    const notices = read('THIRD-PARTY-NOTICES.md');
    assert.match(notices, /sql\.js 1\.15\.0/);
    assert.match(notices, /geotiff\.js 3\.0\.5/);
    assert.match(notices, /Apache-2\.0/);
    const packageJson = JSON.parse(read('package.json'));
    assert.equal(packageJson.devDependencies['sql.js'], '1.15.0');
    assert.equal(packageJson.devDependencies.geotiff, '3.0.5');
  });
});
