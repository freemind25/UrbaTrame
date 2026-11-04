import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeGeocodeResults, parseCoordinateQuery } from '../public/js/site-search.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('recherche du lieu d’étude', () => {
  test('la page affiche les choix et la sélection efface les données d’un autre site', () => {
    const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
    const app = fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8');
    assert.match(html, /id="searchStatus"[^>]*role="status"/);
    assert.match(html, /id="searchResults"[^>]*hidden/);
    assert.match(app, /button\.addEventListener\('click', \(\) => selectSearchedPlace\(place\)\)/);
    assert.match(app, /clearWorkspaceResults\(\);\s*S\.poly = null/);
    assert.match(app, /requestId !== siteSearchRevision/);
  });

  test('normalise les résultats Nominatim et accepte le format enveloppé', () => {
    const rows = [
      { lat: '36.2642', lon: '6.6969', display_name: 'El Khroub, Constantine, Algérie' },
      { lat: 36.365, lon: 6.614, name: 'Constantine' }
    ];
    assert.deepEqual(normalizeGeocodeResults(rows), [
      { lat: 36.2642, lon: 6.6969, name: 'El Khroub, Constantine, Algérie' },
      { lat: 36.365, lon: 6.614, name: 'Constantine' }
    ]);
    assert.deepEqual(normalizeGeocodeResults({ results: rows }), normalizeGeocodeResults(rows));
  });

  test('ignore les coordonnées invalides et limite le nombre de choix', () => {
    const rows = [
      { lat: '', lon: '2', display_name: 'Coordonnée vide' },
      { lat: '91', lon: '2', display_name: 'Latitude invalide' },
      { lat: '36', lon: '181', display_name: 'Longitude invalide' },
      ...Array.from({ length: 10 }, (_, index) => ({ lat: '36', lon: String(index), display_name: `Lieu ${index}` }))
    ];
    const results = normalizeGeocodeResults(rows, 3);
    assert.equal(results.length, 3);
    assert.deepEqual(results.map(result => result.name), ['Lieu 0', 'Lieu 1', 'Lieu 2']);
  });

  test('reconnaît les coordonnées saisies et refuse les valeurs hors projection', () => {
    assert.deepEqual(parseCoordinateQuery('36.2642, 6.6969'), {
      matched: true, valid: true, lat: 36.2642, lon: 6.6969
    });
    assert.deepEqual(parseCoordinateQuery('-36.2; -6.7'), {
      matched: true, valid: true, lat: -36.2, lon: -6.7
    });
    assert.equal(parseCoordinateQuery('91, 6').valid, false);
    assert.equal(parseCoordinateQuery('Constantine').matched, false);
  });
});
