import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, loadKernel, sampleBuckets } from '../tools/kernel.mjs';
import { DEPS, MAX_IDS } from '../public/js/plan-2d.mjs';

test('planche éclatée au catalogue, niveau Max et dépendances déclarées', () => {
  const meta=loadKernel().catalog.find(x=>x.id==='axoexploded');
  assert.equal(meta?.tier,'max');
  assert.ok(meta.impl && MAX_IDS.includes(meta.id));
  for (const layer of ['roads','buildings','landuse','green','poi','transit','rail']) assert.ok(DEPS.axoexploded.includes(layer));
});
test('quatre couches alignées et découpées, sans invention des interprétations', () => {
  const svg=render('axoexploded',{isPro:true,watermark:false});
  assert.match(svg,/^<svg viewBox="0 0 420 297"/);
  for (const layer of ['occupation','voirie','bati','poi']) assert.match(svg,new RegExp('data-layer="'+layer+'"'));
  assert.equal((svg.match(/<clipPath id="utb-exploded-/g)||[]).length,4);
  assert.match(svg,/non déduits/);
  assert.match(svg,/écart entre couches purement graphique/i);
  assert.match(svg,/© OpenStreetMap contributors/);
  assert.doesNotMatch(svg,/NaN|Infinity/);
  assert.notEqual(svg,render('axoexploded',{D:{roads:[],build:[],green:[],pois:[],rail:[]},isPro:true,watermark:false}));
});
test('emprise personnalisée et texte du site échappé', () => {
  const svg=render('axoexploded',{siteName:'<script>alert(1)</script>',sitePolygon:[[36.263,6.695],[36.263,6.697],[36.265,6.697],[36.265,6.695]],D:sampleBuckets()});
  assert.doesNotMatch(svg,/<script>/);
  assert.match(svg,/&lt;script&gt;/);
  assert.doesNotMatch(svg,/NaN|Infinity/);
  assert.match(svg,/data-fm-watermark="true"/);
});
