import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('Cadrage spatial · interface et explicabilité', () => {
  test('la page est reliée à la navigation principale et conserve la marque UrbaTrame', () => {
    const page = fs.readFileSync(path.join(ROOT, 'public/cadrage-spatial.html'), 'utf8');
    const home = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
    assert.match(page, /UrbaTrame/);
    assert.match(page, /Analyse des sites urbains/);
    assert.match(page, /Designed by M\.SADI/);
    assert.match(page, /href="\/cadrage-spatial-notice\.html"/);
    assert.match(home, /href="\/cadrage-spatial\.html"/);
    assert.match(page, /name="level" value="wilaya-country"/);
    assert.match(page, /name="level" value="city-wilaya"/);
    assert.match(page, /name="level" value="neighborhood-city"/);
    assert.match(page, /name="level" value="neighborhood-environment"/);
  });

  test('la limite de 3 000 m et la distinction des niveaux schématiques sont visibles', () => {
    const html = fs.readFileSync(path.join(ROOT, 'public/cadrage-spatial.html'), 'utf8');
    const core = fs.readFileSync(path.join(ROOT, 'public/js/spatial-framing-core.mjs'), 'utf8');
    assert.match(html, /3 000 m/);
    assert.match(html, /niveaux 1–2/);
    assert.match(html, /aucune limite cadastrale ou juridique n’est créée/i);
    assert.match(core, /MAX_STUDY_RADIUS_M = 3000/);
  });

  test('recherche, GADM, OSM et relief nécessitent chacun une action explicite', () => {
    const html = fs.readFileSync(path.join(ROOT, 'public/cadrage-spatial.html'), 'utf8');
    const js = fs.readFileSync(path.join(ROOT, 'public/js/spatial-framing.mjs'), 'utf8');
    assert.match(html, /Recherche non automatique/);
    assert.match(html, /Le bouton interroge GADM/);
    assert.match(html, /ne sont demandées qu’au clic/);
    assert.match(html, /ni les annotations ni les fichiers locaux ne sont transmis/);
    assert.match(js, /searchForm'\)\.addEventListener\('submit', searchPlace\)/);
    assert.match(js, /loadAdmin'\)\.addEventListener\('click', loadAdministrative\)/);
    assert.match(js, /loadOsm'\)\.addEventListener\('click', loadOsmAndRelief\)/);
    assert.match(js, /fetch\('\/data\/gadm-countries\.json'/);
    assert.equal(js.includes('fetch("https://'), false);
    assert.equal(js.includes("fetch('https://"), false);
  });

  test('les exports restent bornés, l’emprise détaillée est circulaire et les erreurs GADM détaillées ne sont pas masquées', () => {
    const js = fs.readFileSync(path.join(ROOT, 'public/js/spatial-framing.mjs'), 'utf8');
    assert.match(js, /MAX_CADRAGE_PROJECT_BYTES/);
    assert.match(js, /projection\.scale \* state\.viewRadius/);
    assert.match(js, /let detailedLevelError = ''/);
    assert.match(js, /if \(detailedLevelError\) setStatus/);
  });

  test('dessin, annotations, stockage local, import/export et formats papier sont exposés', () => {
    const html = fs.readFileSync(path.join(ROOT, 'public/cadrage-spatial.html'), 'utf8');
    for (const token of ['data-draw="polygon"', 'data-draw="rectangle"', 'data-draw="circle"', 'id="editShape"', 'id="annotationType"', 'id="savedFramings"', 'id="exportProject"', 'id="exportSvg"', 'id="exportPng"', 'id="exportJpeg"', 'id="printMap"', '<option>A2</option>']) assert.ok(html.includes(token), token);
    const js = fs.readFileSync(path.join(ROOT, 'public/js/spatial-framing.mjs'), 'utf8');
    assert.match(js, /localStorage\.setItem\(STORAGE_KEY/);
    assert.match(js, /parseGeoPackage/);
    assert.match(js, /window\.print\(\)/);
  });
});
