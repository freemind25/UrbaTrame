import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCES, TIMEOUTS } from '../server/config.mjs';
import { provenanceRelief, GLO30_PROVENANCE, TERRAIN_PROVENANCE } from '../public/js/terrain/topographic.mjs';
import { buildSiteReportPdf } from '../public/js/site-analysis.mjs';
import { spaceSyntaxRapport } from '../public/js/space-syntax.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('phase D — câblage (volets 17 GLO-30, 18 space syntax, 19 GLB)', () => {
  test('config serveur : bucket GLO-30 AWS Open Data déclaré, Terrarium inchangé', () => {
    assert.ok(Array.isArray(SOURCES.glo30) && SOURCES.glo30.some(u => u.includes('copernicus-dem-30m')));
    assert.ok(SOURCES.terrain.some(u => u.includes('elevation-tiles-prod')));
    assert.ok(Number.isFinite(TIMEOUTS.glo30));
  });

  test('cadrage-spatial.html : sélecteur de source du relief (Terrarium défaut / GLO-30)', () => {
    const html = read('public/cadrage-spatial.html');
    assert.match(html, /id="terrainSource"/);
    assert.match(html, /value="terrarium" selected/);
    assert.match(html, /value="glo30"/);
    assert.match(html, /Copernicus GLO-30/);
  });

  test('spatial-framing.mjs : envoie terrainSource, calcule le space syntax, dessine l’overlay, aucun fetch externe', () => {
    const js = read('public/js/spatial-framing.mjs');
    assert.match(js, /terrainSource: \$\('terrainSource'\)\?\.value \|\| 'terrarium'/);
    assert.match(js, /spaceSyntaxRapport\(\{ features: state\.osmFeatures, center: state\.center \}\)/);
    assert.match(js, /function drawSpaceSyntax\(group, project\)/);
    assert.match(js, /drawSpaceSyntax\(group, projection\.project\)/);
    assert.match(js, /reliefSource: state\.terrainSource/);
    assert.match(js, /Copernicus GLO-30 \/ AWS Open Data/);
    assert.equal(js.includes('fetch("https://'), false);
    assert.equal(js.includes("fetch('https://"), false);
  });

  test('vue3d-ui.mjs : bouton GLB câblé sur buildGlb + scene3dVersMeshes', () => {
    const js = read('public/js/vue3d-ui.mjs');
    assert.match(js, /id="v3d-glb"/);
    assert.match(js, /import \{ buildGlb, scene3dVersMeshes \} from '\.\/glb-writer\.mjs'/);
    assert.match(js, /scene3dVersMeshes\(dernier\.sc, \{ zRef: dernier\.sc\.terrainRef \|\| 0 \}\)/);
    assert.match(js, /model\/gltf-binary/);
    assert.match(js, /urbatrame-vue3d\.glb/);
  });

  test('topographic.mjs : provenance GLO-30 vs Terrarium selon la source chargée', () => {
    assert.match(TERRAIN_PROVENANCE, /Terrarium.*AWS/i);
    assert.match(GLO30_PROVENANCE, /GLO-30/);
    assert.equal(provenanceRelief({ source: 'glo30' }), GLO30_PROVENANCE);
    assert.equal(provenanceRelief({}), TERRAIN_PROVENANCE);
    assert.equal(provenanceRelief(null), TERRAIN_PROVENANCE);
  });

  test('rapport PDF : section space syntax (approximation) et source du relief GLO-30', () => {
    const ss = spaceSyntaxRapport({
      features: [
        { type: 'Feature', geometry: { type: 'LineString', coordinates: [[3, 36], [3.001, 36], [3.001, 36.001]] }, properties: { highway: 'primary', name: 'Rue Test', layerId: 'roads' } },
        { type: 'Feature', geometry: { type: 'LineString', coordinates: [[3, 36.001], [3.001, 36.001]] }, properties: { highway: 'residential', layerId: 'roads' } }
      ],
      center: { lat: 36, lon: 3 }
    });
    assert.equal(ss.ok, true);
    const pdf = buildSiteReportPdf({
      title: 'Rapport test', projectName: 'Phase D', centerName: 'Test',
      center: { lat: 36, lon: 3 }, dateText: '06/11/2026', perimeterLabel: 'cercle 500 m',
      studyAreaM2: 785398, rows: [{ label: 'Voirie', areaM2: 0, lengthM: 300, count: 2, share: 0 }],
      totals: { areaM2: 0, lengthM: 300, points: 0 }, builtCoverage: 0, featureCount: 2, usage: [],
      reliefSource: 'Copernicus GLO-30 · tuiles COG publiques AWS Open Data',
      indicators: { spaceSyntax: ss, sun: { elevationDeg: 40, azimuthDeg: 180 } }
    });
    const texte = pdf.toString('latin1');
    assert.match(texte, /Space syntax simplifi/);
    assert.match(texte, /approximation p/);       // « approximation pédagogique »
    assert.match(texte, /Rue Test/);
    assert.match(texte, /GLO-30/);
    assert.equal((texte.match(/\/Type \/Page[^s]/g) || []).length, 4, 'PDF toujours 4 pages');
    assert.ok(texte.startsWith('%PDF-1.4'));
  });

  test('rapport PDF : sans volet D, le texte Terrarium par défaut est conservé', () => {
    const pdf = buildSiteReportPdf({
      title: 'Rapport test', center: { lat: 36, lon: 3 },
      studyAreaM2: 1000, rows: [], totals: {}, builtCoverage: 0, featureCount: 0, usage: [],
      indicators: {}
    });
    const texte = pdf.toString('latin1');
    assert.match(texte, /Terrarium/);
    assert.doesNotMatch(texte, /Space syntax/);
  });
});
