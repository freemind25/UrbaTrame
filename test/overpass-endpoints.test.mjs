import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildOverpassEndpoints, PUBLIC_OVERPASS_ENDPOINTS } from '../server/config.mjs';

test('sans clés, le relais garde exactement les cinq miroirs publics actuels', () => {
  assert.deepEqual(buildOverpassEndpoints({
    endpoints: '', nextgisKey: '', overpassChKey: ''
  }), [...PUBLIC_OVERPASS_ENDPOINTS]);
});

test('NextGIS et Overpass.ch restent côté serveur et passent avant les miroirs publics', () => {
  const endpoints = buildOverpassEndpoints({
    endpoints: 'https://public.example/interpreter, https://public.example/interpreter',
    nextgisKey: 'ng/key?token',
    overpassChKey: 'ch:key/token'
  });
  assert.deepEqual(endpoints, [
    'https://overpass.nextgis.com/ng%2Fkey%3Ftoken/api/interpreter',
    'https://api.overpass.ch/v1/ch%3Akey%2Ftoken/interpreter',
    'https://public.example/interpreter'
  ]);
});

test('le navigateur ne reçoit ni les domaines à clé ni leurs variables', () => {
  const browserRoutes = fs.readFileSync(new URL('../public/js/routes.mjs', import.meta.url), 'utf8');
  assert.equal(browserRoutes.includes('overpass.nextgis.com'), false);
  assert.equal(browserRoutes.includes('api.overpass.ch'), false);
  assert.equal(browserRoutes.includes('FM_NEXTGIS_API_KEY'), false);
  assert.equal(browserRoutes.includes('FM_OVERPASS_CH_API_KEY'), false);
});
