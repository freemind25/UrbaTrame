import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  TERRAIN_PROVENANCE, contourInterval, formatElevation, sampleTerrain,
  terrainColor, terrainExtent, terrainStats, updateElevationReadout
} from '../public/js/terrain/topographic.mjs';

const fixture = {
  lat: 0, lon: 0, radius: 111320,
  grid: [[100, 200], [300, 400]]
};

describe('relief topographique Terrarium', () => {
  test('calcule l’emprise et interpole bilinéairement les altitudes', () => {
    const extent = terrainExtent(fixture);
    assert.equal(extent.north, 1);
    assert.equal(extent.south, -1);
    assert.equal(extent.west, -1);
    assert.equal(extent.east, 1);
    assert.equal(sampleTerrain(fixture, 1, -1).elevation, 100);
    assert.equal(sampleTerrain(fixture, 0, 0).elevation, 250);
    assert.equal(sampleTerrain(fixture, -1, 1).elevation, 400);
  });

  test('distingue relief non chargé, point hors emprise et case sans donnée', () => {
    assert.equal(sampleTerrain(null, 0, 0).status, 'not-loaded');
    assert.equal(sampleTerrain(fixture, 1.01, 0).status, 'outside');
    assert.equal(sampleTerrain(fixture, NaN, 0).status, 'invalid-point');
    assert.equal(sampleTerrain({ ...fixture, lat: NaN }, 0, 0).status, 'invalid-terrain');
    const sparse = { ...fixture, grid: [[100, null], [null, null]] };
    assert.equal(sampleTerrain(sparse, -1, 1).status, 'no-data');
  });

  test('le texte de lecture explique explicitement les états non chargés et hors emprise', () => {
    const output = { dataset: {}, textContent: '' };
    updateElevationReadout(output, null, NaN, NaN);
    assert.equal(output.dataset.elevationStatus, 'not-loaded');
    assert.match(output.textContent, /relief non chargé/i);
    updateElevationReadout(output, fixture, 1.01, 0);
    assert.equal(output.dataset.elevationStatus, 'outside');
    assert.match(output.textContent, /hors de l’emprise/i);
    updateElevationReadout(output, fixture, 0, 0);
    assert.match(output.textContent, /250,0 m/);
  });

  test('échelle, couleurs et unités restent cohérentes en mètres', () => {
    assert.deepEqual(terrainStats(fixture), { min: 100, max: 400, count: 4, rows: 2, columns: 2 });
    assert.equal(contourInterval(100, 400), 50);
    assert.equal(contourInterval(5, 5), 0);
    assert.match(terrainColor(250, 100, 400), /^#[0-9a-f]{6}$/i);
    assert.equal(formatElevation(1234.5), '1\u202f234,5 m');
    assert.match(TERRAIN_PROVENANCE, /Terrarium.*AWS/i);
  });
});

describe('raccordement aux trois interfaces cartographiques', () => {
  test('les trois cartes utilisent le moteur topographique partagé et la lecture au clic', () => {
    const app = fs.readFileSync(new URL('../public/js/atelier/app.mjs', import.meta.url), 'utf8');
    const map = fs.readFileSync(new URL('../public/js/atelier/map.mjs', import.meta.url), 'utf8');
    const framing = fs.readFileSync(new URL('../public/js/spatial-framing.mjs', import.meta.url), 'utf8');
    const localUi = fs.readFileSync(new URL('../public/js/atelier/local-layers-ui.mjs', import.meta.url), 'utf8');
    const pages = [
      fs.readFileSync(new URL('../public/atelier.html', import.meta.url), 'utf8'),
      fs.readFileSync(new URL('../public/cadrage-spatial.html', import.meta.url), 'utf8'),
      fs.readFileSync(new URL('../public/atelier-cartographique.html', import.meta.url), 'utf8')
    ];
    assert.match(app, /terrain\/topographic\.mjs/);
    assert.match(app, /updateElevationReadout/);
    assert.match(map, /appendTopographicLayer/);
    assert.match(map, /setTerrain\(terrain\)/);
    assert.match(map, /onMapClick\?\./);
    assert.match(framing, /terrain\/topographic\.mjs/);
    assert.match(framing, /updateElevationReadout/);
    assert.match(localUi, /terrain\/topographic\.mjs/);
    assert.match(localUi, /\/api\/atelier\/terrain/);
    for (const page of pages) {
      assert.match(page, /id="terrainLegend"/);
      assert.match(page, /id="terrainAltitude"/);
      assert.match(page, /Terrarium|relief topographique/i);
    }
  });

  test('l’attribution nomme OSM et AWS Terrarium, sans réutiliser un service payant', () => {
    const paths = [
      '../public/atelier.html', '../public/cadrage-spatial.html',
      '../public/atelier-cartographique.html', '../public/js/terrain/topographic.mjs',
      '../server/atelier-api.mjs', '../server/sources/terrain.mjs'
    ];
    const contents = paths.map(path => fs.readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n');
    assert.match(contents, /Terrarium/);
    assert.match(contents, /AWS/);
    assert.match(contents, /OpenStreetMap|OSM/);
    assert.doesNotMatch(contents, /topographic-map\.com|tessadem\.com|topoexport\.com/i);
  });

  test('le badge étudiant reste dans l’en-tête et la navigation peut se replier', () => {
    const authUi = fs.readFileSync(new URL('../public/js/student-auth-ui.mjs', import.meta.url), 'utf8');
    assert.match(authUi, /\.ut-student-user\{position:static/);
    assert.match(authUi, /\.ut-auth-header>nav\{min-width:0;flex-wrap:wrap/);
    assert.doesNotMatch(authUi, /\.ut-student-user\{position:fixed/);
  });
});
