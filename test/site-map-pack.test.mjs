import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROAD_GROUPS, filterRoads, roadGroup } from '../public/js/atelier/road-groups.mjs';
import { buildSiteMapPack } from '../public/js/atelier/site-map-pack.mjs';
import { vectorMapSVG } from '../public/js/atelier/vector-map.mjs';

const shape = [[0, 0], [0, .0002], [.0002, .0002], [.0002, 0], [0, 0]];
const ctx = { sLat: 0, sLng: 0, curR: 150, shape: 'circle', siteName: 'Test & site', D: {
  build: [ { g: shape, themeHeightM: 12.4, themeLevels: 4, themeHeightSource: 'levels-estimate' }, { g: shape } ],
  roads: [{ h: 'primary', g: [[0,0], [0,.001]] }, { h: 'footway', g: [[0,0], [.001,0]] }, { h: 'unmapped', g: [[0,0],[.0005,.0005]] }]
} };
const opts = { width: 900, height: 650, preset: 'classic', printScale: 'fit', roadGroups: ['primary'],
  layers: { buildings: true, roads: true }, shadowStrength: 0, lang: 'fr' };

function readStoredZip(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), decoder = new TextDecoder();
  const entries = {}; let p = 0;
  while (v.getUint32(p, true) === 0x04034b50) {
    assert.equal(v.getUint16(p + 8, true), 0, 'archive stored');
    const n = v.getUint16(p + 26, true), e = v.getUint16(p + 28, true), len = v.getUint32(p + 18, true);
    const name = decoder.decode(bytes.subarray(p + 30, p + 30 + n));
    const start = p + 30 + n + e; entries[name] = decoder.decode(bytes.subarray(start, start + len));
    p = start + len;
  }
  return entries;
}

test('chaque catégorie de voie est assignée exactement une fois et les inconnues restent sélectionnables', () => {
  assert.equal(new Set(ROAD_GROUPS.flatMap(g => g.values)).size, ROAD_GROUPS.flatMap(g => g.values).length);
  assert.equal(roadGroup('primary_link'), 'primary');
  assert.equal(roadGroup('cycleway'), 'paths');
  assert.equal(roadGroup(''), 'other');
  assert.equal(roadGroup('new-road-type'), 'other');
  assert.deepEqual(filterRoads(ctx.D.roads, []).map(r => r.h), []);
  assert.deepEqual(filterRoads(ctx.D.roads, ['other']).map(r => r.h), ['unmapped']);
  assert.equal(filterRoads(ctx.D.roads).length, 3);
});

test('les filtres agissent sur la carte, les métriques et la légende — pas seulement l’interface', () => {
  const all = vectorMapSVG(ctx, { ...opts, roadGroups: undefined, preset: 'contexte-urbain' });
  const filtered = vectorMapSVG(ctx, { ...opts, roadGroups: ['primary'], preset: 'contexte-urbain' });
  const none = vectorMapSVG(ctx, { ...opts, roadGroups: [] });
  const hidden = vectorMapSVG(ctx, { ...opts, layers: { ...opts.layers, roads: false } });
  assert.ok(all.stats.roadsKm > filtered.stats.roadsKm);
  assert.ok(filtered.stats.roadsKm > 0);
  assert.equal(none.stats.roadsKm, 0); assert.equal(hidden.stats.roadsKm, 0);
  assert.match(filtered.svg, /Primaire/); assert.doesNotMatch(filtered.svg, /Sentier/);
  assert.doesNotMatch(hidden.svg, /Primaire/);
});

test('pack local : quatre SVG distincts, métadonnées de réglage, attribution et coordonnées explicites', () => {
  const pack = buildSiteMapPack(ctx, opts, { generatedAt: '2026-01-01T00:00:00.000Z' });
  const entries = readStoredZip(pack.bytes);
  assert.deepEqual(Object.keys(entries), ['01-type-et-style.svg', '02-hauteur.svg', '03-niveaux.svg', '04-emprise.svg', 'metadata.json', 'LISEZMOI.txt']);
  assert.match(entries['02-hauteur.svg'], /Hauteur du bâti/);
  assert.match(entries['03-niveaux.svg'], /Nombre de niveaux/);
  assert.match(entries['04-emprise.svg'], /pas surface de plancher/);
  for (const filename of Object.keys(entries).filter(f => f.endsWith('.svg'))) assert.match(entries[filename], /OpenStreetMap contributors/);
  const m = JSON.parse(entries['metadata.json']);
  assert.equal(m.generatedAt, '2026-01-01T00:00:00.000Z'); assert.deepEqual(m.settings.roadGroups, ['primary']);
  assert.equal(m.site.latitude, 0); assert.equal(m.maps[1].stats.theme.estimated, 1); assert.equal(m.maps[1].stats.theme.unknown, 1);
  assert.match(entries['LISEZMOI.txt'], /coordonnées du site/);
});

test('refus explicite si bâtiments absents ou masqués, échelle débordante ou pack trop lourd', () => {
  assert.throws(() => buildSiteMapPack(ctx, { ...opts, layers: { buildings: false } }), { code: 'PACK_BUILDINGS_REQUIRED' });
  assert.throws(() => buildSiteMapPack({ ...ctx, D: { build: [] } }, opts), { code: 'PACK_BUILDINGS_REQUIRED' });
  assert.throws(() => buildSiteMapPack(ctx, { ...opts, printScale: 200 }), { code: 'PACK_SCALE_OVERFLOW' });
  assert.throws(() => buildSiteMapPack(ctx, opts, { maxBytes: 100 }), { code: 'ZIP_WRITE_TOO_LARGE' });
});
