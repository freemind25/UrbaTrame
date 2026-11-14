import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const map = readFileSync(new URL('../public/js/atelier/map.mjs', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');

test('fonds de carte : OSM, Esri satellite, OpenTopoMap et GHLC déclarés', () => {
  for (const url of [
    'https://tile.openstreetmap.org/',
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/',
    'https://tile.opentopomap.org/'
  ]) assert.ok(map.includes(url), `map.mjs contient ${url}`);
  assert.match(map, /setBasemap\(name\)[\s\S]*BASEMAP_URLS\[name\]/);
  for (const v of ['osm', 'esri', 'topo', 'ghlc'])
    assert.ok(html.includes(`value="${v}"`), `option ${v} présente dans le sélecteur`);
  assert.match(app, /Esri World Imagery/);
  assert.match(app, /OpenTopoMap/);
});
