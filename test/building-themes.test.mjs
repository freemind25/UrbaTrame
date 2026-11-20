import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildingThemeAttributes, buildingFootprintArea, buildingThemeClass, UNKNOWN_COLOR } from '../public/js/atelier/building-themes.mjs';
import { normaliser } from '../public/js/atelier/osm-data.mjs';
import { vectorMapSVG } from '../public/js/atelier/vector-map.mjs';

const poly = (x, y, size) => [[y, x], [y, x + size], [y + size, x + size], [y + size, x], [y, x]];
const geom = poly(6, 36, 0.0001).map(([lat, lon]) => ({ lat, lon }));

test('hauteurs et niveaux conservent leur provenance sans supposer de niveaux inconnus', () => {
  assert.deepEqual(buildingThemeAttributes({ height: '12 m', 'building:levels': '3' }), { themeLevels: 3, themeHeightM: 12, themeHeightSource: 'osm-height' });
  assert.deepEqual(buildingThemeAttributes({ 'building:levels': '3' }), { themeLevels: 3, themeHeightM: 9.3, themeHeightSource: 'levels-estimate' });
  for (const height of ['20 ft', '7-9', 'unknown', '-5', '0']) {
    assert.equal(buildingThemeAttributes({ height }).themeHeightM, null);
  }
  for (const levels of ['2;3', '2.5', '0', '-1', 'unknown']) assert.equal(buildingThemeAttributes({ 'building:levels': levels }).themeLevels, null);
});

test('classes aux bornes et couleur inconnue ; le 9 m de rendu 3D ne devient jamais une valeur cartographique', () => {
  assert.equal(buildingThemeClass({ h: 9 }, 'height', 36, 6).color, UNKNOWN_COLOR);
  assert.equal(buildingThemeClass({ themeHeightM: 6 }, 'height', 36, 6).index, 1);
  assert.equal(buildingThemeClass({ themeHeightM: 45 }, 'height', 36, 6).index, 4);
  assert.equal(buildingThemeClass({ themeLevels: 1 }, 'floors', 36, 6).index, 0);
  assert.equal(buildingThemeClass({ themeLevels: 2 }, 'floors', 36, 6).index, 1);
});

test('surface planimétrique approximative soustrait les cours sans surface de plancher', () => {
  const g = poly(0, 0, 10 / 111320), hole = poly(2 / 111320, 2 / 111320, 2 / 111320);
  const area = buildingFootprintArea({ g, trous: [hole] }, 0, 0);
  assert.ok(Math.abs(area - 96) < 0.1);
  assert.equal(buildingFootprintArea({ g: [[0, 0], [0, 0], [0, 0]] }, 0, 0), null);
  assert.equal(buildingFootprintArea({ g, trous: [[[1, 1]]] }, 0, 0), null);
});

test('normalisation et rendu des cartes thématiques sans substitution silencieuse', () => {
  const data = normaliser([
    { type: 'way', id: 1, geometry: geom, tags: { building: 'yes', height: '12 m' } },
    { type: 'way', id: 2, geometry: geom, tags: { building: 'yes', 'building:levels': '3' } },
    { type: 'way', id: 3, geometry: geom, tags: { building: 'yes' } }
  ]);
  assert.equal(data.build[1].themeHeightSource, 'levels-estimate');
  const ctx = { sLat: 36, sLng: 6, curR: 200, D: data, siteName: 'Exemple' };
  const height = vectorMapSVG(ctx, { buildingTheme: 'height', width: 900, height: 650, shadowStrength: 0 });
  assert.deepEqual(height.stats.theme, { known: 2, unknown: 1, estimated: 1 });
  assert.match(height.svg, /Hauteur du bâti/);
  assert.match(height.svg, /estimation niveaux × 3,1 m/);
  assert.match(height.svg, /Inconnu/);
  assert.match(height.svg, /#C7C9C8/);
  const floors = vectorMapSVG(ctx, { buildingTheme: 'floors', width: 900, height: 650, shadowStrength: 0 });
  assert.deepEqual(floors.stats.theme, { known: 1, unknown: 2, estimated: 0 });
  const area = vectorMapSVG(ctx, { buildingTheme: 'area', width: 900, height: 650, shadowStrength: 0 });
  assert.equal(area.stats.theme.known, 3);
  assert.match(area.svg, /pas surface de plancher/);
  const hidden = vectorMapSVG(ctx, { buildingTheme: 'height', layers: { buildings: false } });
  assert.doesNotMatch(hidden.svg, /estimation niveaux × 3,1 m/);
});

test('les cours sont évidées dans le SVG', () => {
  const result = vectorMapSVG({ sLat: 0, sLng: 0, curR: 200, D: { build: [{ g: poly(0, 0, .0001), trous: [poly(.00002, .00002, .00002)] }] } }, { buildingTheme: 'area', shadowStrength: 0 });
  assert.match(result.svg, /fill-rule="evenodd"/);
  assert.equal(result.stats.theme.known, 1);
});
