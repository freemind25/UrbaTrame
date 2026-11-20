import test from 'node:test';
import assert from 'node:assert/strict';
import { numericValue, buildNumericHistogram, validateNumericRange, matchesNumericRange } from '../public/js/atelier/numeric-histogram.mjs';
import {crossKey,crossKeySet,crossMatches} from '../public/js/atelier/attribute-cross-filter.mjs';
import {validateVisualRecipe} from '../public/js/atelier/recipe-composer.mjs';
const f=v=>({type:'Feature',properties:v===undefined?{}:{n:v}});
test('histogramme : bornes, manquants et invalides séparés',()=>{
 const features=[f(1),f(2),f('3.5'),f(''),f(null),f(undefined),f(false),f('abc'),f(0)];
 const h=buildNumericHistogram(features,'n',2);
 assert.deepEqual([h.numeric,h.missing,h.invalid],[4,3,2]);assert.equal(h.min,0);assert.equal(h.max,3.5);assert.equal(h.bins.reduce((a,b)=>a+b.count,0),4);
 const filter=validateNumericRange('n','1','2');assert.deepEqual(features.filter(x=>matchesNumericRange(x,filter)).map(x=>x.properties.n),[1,2]);
 assert.equal(matchesNumericRange(f(''),filter),false);assert.throws(()=>validateNumericRange('n','5','2'));assert.throws(()=>validateNumericRange('n','',''));
 const extreme=buildNumericHistogram([f(-1e308),f(1e308)],'n',8);assert.equal(extreme.bins.reduce((n,b)=>n+b.count,0),2);
 const tiny=buildNumericHistogram([f(0),f(Number.MIN_VALUE)],'n',8);assert.equal(tiny.bins.reduce((n,b)=>n+b.count,0),2);
});
test('correspondances : types exacts, absents et objets exclus',()=>{
 const keys=crossKeySet([f(1),f('1'),f(null),f(''),f(false),f({})],'n');
 assert.notEqual(crossKey(1),crossKey('1'));assert.equal(crossKey(''),null);assert.equal(keys.size,3);
 assert.equal(crossMatches(f(1),'n',keys),true);assert.equal(crossMatches(f('1'),'n',keys),true);assert.equal(crossMatches(f(null),'n',keys),false);assert.equal(crossMatches(f(true),'n',keys),false);
});
test('compositeur : autorisations fermées, limites, noms ambigus',()=>{
 const layer={name:'A',kind:'vector',geojson:{features:[]}};
 const recipe={version:1,steps:[{op:'measure',layer:'A'},{op:'buffer-points',layer:'A',radiusMeters:50,segments:32}]};
 assert.equal(validateVisualRecipe(recipe,[layer]).steps,2);
 assert.throws(()=>validateVisualRecipe({version:1,steps:[{op:'eval',code:'1'}]}));
 assert.throws(()=>validateVisualRecipe({version:1,steps:[{op:'buffer-points',layer:'A',radiusMeters:0,segments:32}]}));
 assert.throws(()=>validateVisualRecipe(recipe,[layer,layer]),/ambigu/);
 assert.throws(()=>validateVisualRecipe({version:1,steps:Array(11).fill({op:'export-layer',layer:'A'})}));
});
