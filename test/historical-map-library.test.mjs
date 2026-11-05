import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HISTORICAL_MAP_RESOURCES, filterHistoricalMapResources } from '../public/js/historical-map-library.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('Bibliothèque de cartes anciennes', () => {
  test('référence les collections historiques, les archives et le lien partagé', () => {
    assert.ok(HISTORICAL_MAP_RESOURCES.length >= 7);
    for (const resource of HISTORICAL_MAP_RESOURCES) {
      assert.ok(resource.id && resource.title && resource.description && resource.source && resource.actionLabel);
      assert.equal(new URL(resource.url).protocol, 'https:');
      assert.ok(['catalogue', 'images', 'archive'].includes(resource.formatGroup));
    }
    assert.ok(HISTORICAL_MAP_RESOURCES.some(resource => resource.id === 'senatus-algeria'));
    assert.ok(HISTORICAL_MAP_RESOURCES.some(resource => resource.id === 'mediafire-topographic-archive'));
    assert.ok(HISTORICAL_MAP_RESOURCES.some(resource => resource.id === 'ams-algeria-50k'));
  });

  test('la recherche ignore la casse et les accents et trouve les cartes de Constantine', () => {
    const results = filterHistoricalMapResources(HISTORICAL_MAP_RESOURCES, { query: 'CONSTANTINE' });
    assert.ok(results.some(resource => resource.id === 'senatus-algeria'));
    assert.ok(results.some(resource => resource.id === 'ams-algeria-50k'));
    assert.ok(results.some(resource => resource.id === 'ams-algeria-200k'));
    assert.deepEqual(filterHistoricalMapResources(HISTORICAL_MAP_RESOURCES, { query: 'defense', region: 'world' }).map(resource => resource.id), ['mediafire-topographic-archive']);
  });

  test('les filtres de région et de type limitent la liste sans requête externe', () => {
    const constantine = filterHistoricalMapResources(HISTORICAL_MAP_RESOURCES, { region: 'constantine' });
    assert.ok(constantine.length >= 3);
    assert.ok(constantine.every(resource => resource.regions.includes('constantine')));
    const archives = filterHistoricalMapResources(HISTORICAL_MAP_RESOURCES, { format: 'archive' });
    assert.deepEqual(archives.map(resource => resource.id), ['mediafire-topographic-archive']);
  });

  test('la page charge la navigation partagée, les filtres et ouvre les sources de façon sûre', () => {
    const html = fs.readFileSync(path.join(ROOT, 'public/bibliotheque-cartes.html'), 'utf8');
    const js = fs.readFileSync(path.join(ROOT, 'public/js/historical-map-library.mjs'), 'utf8');
    assert.match(html, /student-auth-ui\.mjs/);
    assert.match(html, /id="resourceSearch"/);
    assert.match(html, /id="regionFilter"/);
    assert.match(html, /id="formatFilter"/);
    assert.match(html, /Bibliothèque de cartes anciennes/);
    assert.match(js, /link\.target = '_blank'/);
    assert.match(js, /link\.rel = 'noopener noreferrer'/);
    assert.doesNotMatch(js, /l\.facebook\.com/);
  });

  test('la bibliothèque est accessible depuis les principales pages UrbaTrame', () => {
    for (const file of [
      'public/index.html', 'public/atelier.html', 'public/atelier-analyse.html',
      'public/atelier-cartographique.html', 'public/atelier-s5.html', 'public/cadrage-spatial.html'
    ]) {
      const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
      assert.match(html, /href="\/bibliotheque-cartes\.html"/, file);
    }
  });
});
