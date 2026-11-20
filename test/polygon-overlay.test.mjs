import test from 'node:test';
import assert from 'node:assert/strict';
import { runPolygonOverlay } from '../public/js/atelier/polygon-overlay.mjs';
import { parseGeoJSONText } from '../public/js/atelier/local-layers.mjs';
import {utm} from '../public/js/atelier/exports.mjs';
const ring=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]];
const poly=(x,y,w,h,props={})=>({type:'Feature',properties:props,geometry:{type:'Polygon',coordinates:[ring(x,y,w,h)]}});
const layer=(name,features,indices=features.map((_,i)=>i))=>({name,fileName:`${name}.geojson`,source:`source-${name}`,sourceCrs:'EPSG:4326',importedAt:'2026-01-01T00:00:00Z',publicScope:{layer:name,scope:'filtered',usedCount:features.length,originalCount:10},scopeInfo:{originalIndices:indices},geojson:{type:'FeatureCollection',features}});
const run=(a,b,operation='intersection',crs='EPSG:32632')=>runPolygonOverlay(a,b,{operation,crs});
test('intersection polygonale : une surface par paire, attributs imbriqués et sources non mutées',()=>{
 const a=layer('cible',[poly(6.7,36.26,.01,.01,{nom:'A'})],[7]);
 const b=layer('masque',[poly(6.705,36.265,.01,.01,{nom:'B'})],[5]);const before=JSON.stringify([a,b]);
 const result=run(a,b);assert.equal(result.collection.features.length,1);
 const f=result.collection.features[0];assert.equal(f.geometry.type,'Polygon');
 const r=f.geometry.coordinates[0], signed=r.slice(0,-1).reduce((sum,p,i)=>sum+(p[0]-r[0][0])*(r[i+1][1]-r[0][1])-(r[i+1][0]-r[0][0])*(p[1]-r[0][1]),0);assert.ok(signed>0);assert.equal(f.properties.cible.nom,'A');assert.equal(f.properties.reference.nom,'B');assert.equal(f.properties.origine_cible.index,7);assert.equal(f.properties.origine_reference.index,5);
 assert.equal(result.collection.urbatrameDerivation.computationCrs,'EPSG:32632');
 assert.equal(parseGeoJSONText(JSON.stringify(result.collection)).urbatrameDerivation.engine,'JSTS 2.12.1');
 f.properties.cible.nom='changé';assert.equal(JSON.stringify([a,b]),before);
});
test('découpage par union des masques : une sortie par cible, sans duplication des zones superposées',()=>{
 const a=layer('A',[poly(6.70,36.26,.02,.02)]);
 const b=layer('B',[poly(6.703,36.263,.01,.01,{nom:'un'}),poly(6.707,36.263,.01,.01,{nom:'deux'})],[3,9]);
 const i=run(a,b),c=run(a,b,'clip');assert.equal(i.collection.features.length,2);assert.equal(c.collection.features.length,1);
 assert.equal(c.collection.features[0].properties.reference,undefined);
 assert.deepEqual(c.collection.urbatrameDerivation.referenceFeatures.map(x=>x.index),[3,9]);assert.match(c.collection.urbatrameDerivation.mask,/union/);
});
test('trous conservés, multipolygones et limites sans surface',()=>{
 const donut=poly(6.70,36.26,.02,.02);donut.geometry.coordinates.push(ring(6.705,36.265,.004,.004).reverse());
 const enclosing=layer('A',[poly(6.699,36.259,.022,.022)]),mask=layer('B',[donut]);
 const result=run(enclosing,mask,'clip');assert.equal(result.collection.features.length,1);assert.equal(result.collection.features[0].geometry.coordinates.length,2);
 const multipoly={type:'Feature',properties:{},geometry:{type:'MultiPolygon',coordinates:[[ring(6.70,36.26,.003,.003)],[ring(6.71,36.27,.003,.003)]]}};
 assert.equal(run(enclosing,layer('M',[multipoly]),'clip').collection.features[0].geometry.type,'MultiPolygon');
 const x=6.71;const touching=run(layer('a',[poly(6.7,36.26,.01,.01)]),layer('b',[poly(x,36.26,.01,.01)]));
 assert.equal(touching.report.outputFeatures,0);assert.equal(touching.report.boundaryOnly,1);
});
test('rejet atomique des géométries invalides, Z, CRS et fuseaux incohérents',()=>{
 const a=layer('a',[poly(6.7,36.26,.01,.01)]),b=layer('b',[poly(6.705,36.265,.01,.01)]);const before=JSON.stringify([a,b]);
 const bow={type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[[[6.7,36.26],[6.71,36.27],[6.7,36.27],[6.71,36.26],[6.7,36.26]]]}};
 assert.throws(()=>run(a,layer('bad',[bow])),{code:'OVERLAY_INVALID'});
 const z=poly(6.7,36.26,.01,.01);z.geometry.coordinates[0]=z.geometry.coordinates[0].map(p=>[...p,12]);assert.throws(()=>run(a,layer('z',[z])),{code:'OVERLAY_2D'});
 assert.throws(()=>run(a,b,'clip','EPSG:4326'),{code:'OVERLAY_CRS'});
 assert.throws(()=>run(a,b,'clip','EPSG:32631'),{code:'OVERLAY_CRS_DOMAIN'});
 assert.throws(()=>run(a,layer('vide',[])),{code:'OVERLAY_EMPTY'});
 const lat=-35,lon=-73, projected=utm(lat,lon);assert.equal(projected.zone,18);
 assert.equal(run(layer('s',[poly(lon,lat,.01,.01)]),layer('m',[poly(lon+.005,lat+.005,.01,.01)]),'intersection','EPSG:32718').report.outputFeatures,1);
 assert.equal(JSON.stringify([a,b]),before);
});
test('limites de taille et entrée de type non polygonal',()=>{
 const a=layer('a',[poly(6.7,36.26,.01,.01)]),b=layer('b',[poly(6.705,36.265,.01,.01)]);
 assert.throws(()=>run(layer('large',Array.from({length:101},()=>a.geojson.features[0])),b),{code:'OVERLAY_LIMIT'});
 assert.throws(()=>run(a,layer('point',[{type:'Feature',properties:{},geometry:{type:'Point',coordinates:[6.7,36.26]}}])),{code:'OVERLAY_POLYGON_REQUIRED'});
});
