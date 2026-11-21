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

test('composition : sélection, ordre bas-haut, intervalle et légende du SVG', () => {
  const config={order:['poi','bati','occupation','voirie'],visible:['poi','occupation'],gap:30};
  const svg=render('axoexploded',{axoExploded:config,isPro:true,watermark:false});
  assert.deepEqual([...svg.matchAll(/data-layer="([^"]+)"/g)].map(x=>x[1]),['poi','occupation']);
  assert.equal((svg.match(/<clipPath id="utb-exploded-/g)||[]).length,2);
  assert.match(svg,/01 · REPÈRES/);assert.match(svg,/02 · SOL/);
  assert.doesNotMatch(svg,/03 · RÉSEAUX|data-layer="bati"|data-layer="voirie"/);
  assert.match(svg,/2 couche\(s\) alignée\(s\)/);assert.match(svg,/© OpenStreetMap contributors/);
  assert.doesNotMatch(svg,/NaN|Infinity/);
  const layer=(name)=>svg.slice(svg.indexOf(`data-layer="${name}"`),svg.indexOf('</g>',svg.indexOf(`data-layer="${name}"`)));
  assert.match(layer('poi'),/56\.00,169\.00/);assert.match(layer('occupation'),/56\.00,139\.00/);
  assert.deepEqual(config,{order:['poi','bati','occupation','voirie'],visible:['poi','occupation'],gap:30});
});

test('configuration fermée, valeurs invalides et tous sous-ensembles non vides', () => {
  loadKernel();const normalize=globalThis.FMAxoLayout.normalize;
  const x=normalize({order:['poi','poi','<script>'],visible:['poi','bad'],gap:1});
  assert.deepEqual(x,{order:['poi','occupation','voirie','bati'],visible:['poi'],gap:54});
  assert.deepEqual(normalize({visible:[]}).visible,['occupation','voirie','bati','poi']);
  const keys=['occupation','voirie','bati','poi'];
  for(let mask=1;mask<16;mask++) for(const gap of [30,42,54]) {
    const selected=keys.filter((_,i)=>mask&(1<<i));
    const svg=render('axoexploded',{axoExploded:{order:[...keys].reverse(),visible:selected,gap}});
    assert.deepEqual([...svg.matchAll(/data-layer="([^"]+)"/g)].map(x=>x[1]),[...selected].reverse());
    assert.doesNotMatch(svg,/NaN|Infinity|<script>/);
  }
});
