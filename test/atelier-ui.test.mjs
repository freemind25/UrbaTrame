import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(ROOT, 'public/atelier-cartographique.html'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'public/js/atelier/local-layers-ui.mjs'), 'utf8');

describe('UrbaTrame · contrôles d’interface de l’atelier cartographique', () => {
  test('tous les contrôles référencés existent et aucun identifiant HTML n’est dupliqué', () => {
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(new Set(ids).size, ids.length, 'IDs HTML uniques');
    const idSet = new Set(ids);
    const selectors = [...js.matchAll(/\$\('#([A-Za-z][\w-]*)'\)/g)].map(match => match[1]);
    assert.deepEqual([...new Set(selectors)].filter(id => !idSet.has(id)), []);
  });

  test('l’import SHP, les projets, les recettes, les services et l’édition sont exposés', () => {
    for (const id of ['shapefileFiles', 'shapeCrs', 'addShapefile', 'exportProjectJson', 'projectFile', 'automationRecipe', 'runAutomation', 'externalServiceType', 'wfsTypeName', 'importRemoteGeoJSON', 'wmtsMatrixSet', 'wmtsFields', 'undoEdit', 'redoEdit', 'editVertexIndex', 'editPointLon', 'editPointLat', 'moveSelectedVertex', 'insertSelectedVertex', 'deleteSelectedVertex', 'deleteSelectedFeature', 'editAttributeName', 'editAttributeOptions', 'editAttributeValue', 'saveFeatureAttribute', 'deleteFeatureAttribute'])
      assert.match(html, new RegExp(`id="${id}"`));
    assert.match(js, /from '\.\/editing\.mjs'/);
    assert.match(js, /addEventListener\('click', deleteSelectedFeature\)/);
    assert.match(js, /addEventListener\('click', moveSelectedVertex\)/);
    assert.match(js, /addEventListener\('click', insertSelectedVertex\)/);
    assert.match(js, /addEventListener\('click', deleteSelectedVertex\)/);
    assert.match(js, /addEventListener\('click', saveSelectedAttribute\)/);
    assert.match(js, /addEventListener\('click', removeSelectedAttribute\)/);
    assert.match(js, /state\.selectedFeature = \{ layerId: layer\.id, index \};\s*renderLayerList\(\);\s*renderLayerTools\(\)/, 'la sélection actualise les contrôles d’édition');
    assert.match(html, /value="arcgis-map"/);
    assert.match(html, /"op": "buffer-lines"/);
    assert.match(html, /within-distance/);
    assert.match(js, /Import distant plafonné/);
    assert.doesNotMatch(html, /pas encore de fond externe/i, 'aucune mention obsolète de l’absence de fond externe');
  });

  test('l’IA est inactive par défaut et la clé n’est pas préremplie ni persistée', () => {
    assert.match(html, /<option value="">Choisir — IA inactive<\/option>/);
    assert.match(html, /id="aiApiKey" type="password" maxlength="500" autocomplete="new-password" spellcheck="false"/);
    assert.doesNotMatch(html, /id="aiApiKey"[^>]*value=/i);
    assert.match(js, /\$\('#aiApiKey'\)\.value = ''/);
    assert.match(js, /window\.confirm\(disclosure\)/);
    assert.doesNotMatch(js, /localStorage|sessionStorage/);
    assert.match(js, /zdr: true, data_collection: 'deny'/);
  });

  test('les requêtes externes sont explicites, sans cookies, et le plan exporté retire les images externes', () => {
    assert.match(html, /Désactivés par défaut/);
    assert.match(js, /credentials: 'omit', redirect: 'error'/);
    assert.match(js, /clone\.querySelectorAll\('\.external-basemap-image'\)\.forEach\(image => image\.remove\(\)\)/);
    assert.match(js, /class: 'raster-overlay'/, 'le plan local conserve les images GeoTIFF embarquées');
    assert.match(html, /© OpenStreetMap contributors/);
    assert.match(js, /OpenBuildingMap.*GFZ.*OpenStreetMap/);
  });
});
