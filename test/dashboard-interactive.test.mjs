import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dashboardCategory, dashboardCategoryCounts, matchesDashboardCategory } from '../public/js/atelier/dashboard.mjs';
const f = value => ({ type:'Feature', properties: value === undefined ? {} : { classe: value }, geometry: {type:'Point',coordinates:[0,0]} });
test('catégories typées exactes et nulles explicites', () => {
 const features = [f(1),f('1'),f(null),f(undefined),f(''),f(false),f('false')];
 const counts = dashboardCategoryCounts(features,'classe');
 assert.equal(counts.length,6); assert.equal(counts.find(x=>x.key==='null').count,2);
 assert.notEqual(dashboardCategory(1).key,dashboardCategory('1').key);
 assert.notEqual(dashboardCategory(false).key,dashboardCategory('false').key);
 assert.notEqual(dashboardCategory(null).key,dashboardCategory('').key);
 const selection = {field:'classe',key:dashboardCategory('1').key};
 assert.deepEqual(features.filter(x => matchesDashboardCategory(x,selection)),[features[1]]);
 assert.equal(matchesDashboardCategory(f('École'),{field:'classe',key:dashboardCategory('école').key}),false);
});
test('les longues valeurs restent distinctes même si elles partagent un préfixe', () => {
 const a='x'.repeat(140)+'A',b='x'.repeat(140)+'B';
 const data=[f(a),f(b)]; const items=dashboardCategoryCounts(data,'classe');
 assert.equal(items.length,2);assert.notEqual(items[0].key,items[1].key);
 assert.deepEqual(data.filter(x=>matchesDashboardCategory(x,{field:'classe',key:dashboardCategory(a).key})),[data[0]]);
});
test('valeurs complexes et autres classes ne sont pas des filtres sélectionnables',()=>{
 const data=[f({a:1}),f([2]),...Array.from({length:10},(_,i)=>f('x'+i))];
 const counts=dashboardCategoryCounts(data,'classe',4);
 assert.equal(counts.find(x=>x.key==='complex').count,2);
 assert.equal(counts.find(x=>x.key==='complex').selectable,false);
 assert.equal(counts.at(-1).selectable,false);
 assert.equal(counts.reduce((n,x)=>n+x.count,0),12);
});
test('l’absence de filtre ne modifie pas les résultats',()=>{
 assert.equal(matchesDashboardCategory(f('a'),null),true);
 assert.deepEqual(dashboardCategoryCounts([], 'classe'),[]);
});
