import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGadmHandler, gadmGeoJsonUrl, makeGadmPreview, validateGadmQuery } from '../server/gadm.mjs';

function response() {
  return {
    statusCode: 0, headers: {}, body: '',
    writeHead(code, headers) { this.statusCode = code; this.headers = headers; },
    end(body = '') { this.body = String(body); }
  };
}
async function callGadm(handler, url, method = 'GET') {
  const req = { method, url, headers: {}, socket: { remoteAddress: '127.0.0.1' } };
  const res = response();
  await handler(req, res);
  return { ...res, json: res.body ? JSON.parse(res.body) : null };
}
function polygonFeature({ gid, parent = 'DZA', name = 'Unité', radius = 0.01 }) {
  const ring = [];
  for (let index = 0; index < 40; index++) {
    const angle = 2 * Math.PI * index / 39;
    ring.push([6 + Math.cos(angle) * radius, 36 + Math.sin(angle) * radius]);
  }
  ring[ring.length - 1] = ring[0];
  return {
    type: 'Feature',
    properties: { GID_0: 'DZA', GID_1: gid, NAME_0: 'Algeria', NAME_1: name, GID_PARENT: parent, ENGTYPE_1: 'Province' },
    geometry: { type: 'Polygon', coordinates: [ring] }
  };
}

describe('UrbaTrame · atlas administratif GADM', () => {
  test('la liste pays conserve les niveaux réellement disponibles par version', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const countries = JSON.parse(fs.readFileSync(path.join(root, 'public/data/gadm-countries.json'), 'utf8'));
    assert.equal(countries.countriesByVersion['4.1'].length, 254);
    assert.equal(countries.countriesByVersion['4.0'].length, 205);
    assert.equal(countries.countriesByVersion['3.6'].length, 254);
    assert.equal(countries.countriesByVersion['4.1'].find(item => item.code === 'DZA').maxLevel, 2);
  });

  test('les paramètres et URL ne permettent pas de sortir du catalogue GADM', () => {
    assert.equal(gadmGeoJsonUrl({ country: 'DZA', level: 1, version: '4.1' }),
      'https://geodata.ucdavis.edu/gadm/gadm4.1/json/gadm41_DZA_1.json');
    assert.equal(gadmGeoJsonUrl({ country: 'DZA', level: 0, version: '4.0' }),
      'https://geodata.ucdavis.edu/gadm/gadm4.0/json/gadm40_DZA_0.json');
    assert.throws(() => gadmGeoJsonUrl({ country: '../DZA', level: 1, version: '4.1' }), /INVALID_GADM_URL/);
    assert.throws(() => validateGadmQuery(new URLSearchParams('country=DZA&level=1&parent=https://evil.test')),
      /INVALID_PARENT/);
    assert.throws(() => validateGadmQuery(new URLSearchParams('country=../../x&level=1')), /INVALID_COUNTRY/);
    assert.deepEqual(validateGadmQuery(new URLSearchParams('country=DZA&level=1&parent=DZA&parentLevel=0')),
      { country: 'DZA', level: 1, version: '4.1', parent: 'DZA', parentLevel: 0 });
  });

  test('l’aperçu filtre les enfants et généralise les coordonnées tout en gardant les attributs', () => {
    const child = polygonFeature({ gid: 'DZA.1_1', name: 'Adrar', radius: 0.001 });
    const unrelated = polygonFeature({ gid: 'TUN.2_1', name: 'Tunis', parent: 'TUN' });
    unrelated.properties.GID_0 = 'TUN';
    const source = { type: 'FeatureCollection', name: 'gadm41_DZA_1', features: [child, unrelated] };
    const preview = makeGadmPreview(source, {
      country: 'DZA', level: 1, version: '4.1', parent: 'DZA', parentLevel: 0,
      originalBytes: 20_000
    });
    const json = JSON.parse(preview.body);
    assert.equal(json.features.length, 1);
    assert.equal(json.features[0].properties.NAME_1, 'Adrar');
    assert.equal(json.gadm.previewGeneralized, true);
    assert.ok(json.features[0].geometry.coordinates[0].length < child.geometry.coordinates[0].length);
    assert.deepEqual(json.features[0].geometry.coordinates[0][0],
      json.features[0].geometry.coordinates[0].at(-1));
  });

  test('l’API GADM valide l’entrée avant réseau et met en cache l’aperçu', async () => {
    const source = {
      type: 'FeatureCollection',
      features: [polygonFeature({ gid: 'DZA.1_1', name: 'Adrar' })]
    };
    let calls = 0;
    const handler = createGadmHandler({
      fetch: async url => {
        calls++;
        assert.equal(url, 'https://geodata.ucdavis.edu/gadm/gadm4.1/json/gadm41_DZA_1.json');
        return new Response(JSON.stringify(source), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
      now: () => 1_700_000_000_000,
      log: () => {}
    });
    const bad = await callGadm(handler, '/api/atelier/gadm?country=../DZA&level=1');
    assert.equal(bad.statusCode, 400);
    assert.equal(calls, 0);
    const first = await callGadm(handler, '/api/atelier/gadm?country=DZA&level=1');
    const second = await callGadm(handler, '/api/atelier/gadm?country=DZA&level=1');
    assert.equal(first.statusCode, 200);
    assert.equal(first.json.features[0].properties.NAME_1, 'Adrar');
    assert.equal(first.headers['X-GADM-Preview'], 'generalized');
    assert.equal(second.statusCode, 200);
    assert.equal(calls, 1);
  });

  test('une navigation enfant ne révèle que le parent choisi', async () => {
    const source = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { GID_0: 'DZA', GID_1: 'DZA.1_1', GID_2: 'DZA.1_1.1_1', NAME_2: 'Reggane' }, geometry: null },
        { type: 'Feature', properties: { GID_0: 'DZA', GID_1: 'DZA.2_1', GID_2: 'DZA.2_1.1_1', NAME_2: 'Chlef' }, geometry: null }
      ]
    };
    const handler = createGadmHandler({
      fetch: async () => new Response(JSON.stringify(source), { status: 200 }),
      log: () => {}
    });
    const result = await callGadm(handler,
      '/api/atelier/gadm?country=DZA&level=2&parent=DZA.1_1&parentLevel=1');
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.json.features.map(feature => feature.properties.NAME_2), ['Reggane']);
  });
});
