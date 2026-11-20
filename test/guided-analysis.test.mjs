import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guidedAnalysis } from '../public/js/atelier/guided-analysis.mjs';
import { serializeLocalProject, parseLocalProject } from '../public/js/atelier/project.mjs';
const point = (id, xy, properties = {}) => ({ type:'Feature', id, geometry:{type:'Point', coordinates:xy}, properties });
const layer = (id, name, features) => ({ id, name, kind:'vector', fileName:`${id}.geojson`, source:`source-${id}`, sourceCrs:'EPSG:4326', crs:'EPSG:4326', importedAt:'2026-01-01T00:00:00Z', visible:true, geojson:{type:'FeatureCollection',features} });
const points = layer('p','Même nom',[point('a',[0,0],{levels:4}),point('b',[0.001,0],{levels:'3.5'}),point('c',[1,1],{levels:''})]);
const refs = layer('r','Même nom',[point('s',[0,0])]);
const zone = layer('z','Zone',[{type:'Feature',geometry:{type:'Polygon',coordinates:[[[ -0.01,-0.01],[0.01,-0.01],[0.01,0.01],[-0.01,0.01],[-0.01,-0.01]]]},properties:{}}]);
const roads = layer('l','Voies',[{type:'Feature',geometry:{type:'LineString',coordinates:[[0,0],[0.001,0]]},properties:{}}]);

test('filtre numérique strict, valeurs absentes exclues et source intacte', () => {
 const r=guidedAnalysis([points],{targetId:'p',operation:'filter-number',field:'levels',comparison:'gt',threshold:'3'});
 assert.deepEqual(r.collection.features.map(f=>f.id),['a','b']); assert.equal(r.report.nonNumericOrMissing,1);
 r.collection.features[0].properties.levels=99; assert.equal(points.geojson.features[0].properties.levels,4);
 assert.equal(r.collection.urbatrameDerivation.sources[0].source,'source-p');
 assert.throws(()=>guidedAnalysis([points],{targetId:'p',operation:'filter-number',field:'levels',comparison:'gt',threshold:''}),{code:'GUIDED_NUMBER_INVALID'});
});
test('proximité par identifiants malgré les noms identiques ; provenance des deux sources',()=>{
 const r=guidedAnalysis([points,refs],{targetId:'p',referenceId:'r',operation:'within-distance',distanceMeters:120});
 assert.deepEqual(r.collection.features.map(f=>f.id),['a','b']);
 assert.deepEqual(r.collection.urbatrameDerivation.sources.map(s=>s.source),['source-p','source-r']);
 r.collection.features[0].geometry.coordinates[0]=99; assert.equal(points.geojson.features[0].geometry.coordinates[0],0);
});
test('sélection dans un polygone et numéro invalide',()=>{
 const opts={targetId:'p',referenceId:'z',operation:'within-polygon',polygonFeature:0};
 assert.deepEqual(guidedAnalysis([points,zone],opts).collection.features.map(f=>f.id),['a','b']);
 assert.throws(()=>guidedAnalysis([points,zone],{...opts,polygonFeature:-1}),{code:'GUIDED_POLYGON_INDEX'});
 assert.throws(()=>guidedAnalysis([points,zone],{...opts,polygonFeature:2}),{code:'RECIPE_POLYGON_REQUIRED'});
});
test('tampons points et lignes, provenance réelle, validation des rayons',()=>{
 for (const [l,operation] of [[refs,'buffer-points'],[roads,'buffer-lines']]) {
  const r=guidedAnalysis([l],{targetId:l.id,operation,distanceMeters:50});
  assert.ok(r.collection.features.length); assert.equal(r.collection.features[0].properties._urbaTrameDerivation.sourceLayer,l.name);
  assert.equal(r.collection.urbatrameDerivation.parameters.radiusMeters,50);
  assert.throws(()=>guidedAnalysis([l],{targetId:l.id,operation,distanceMeters:0}),{code:'RECIPE_BUFFER_RADIUS_INVALID'});
 }
});
test('contrôles de couche et opération',()=>{
 assert.throws(()=>guidedAnalysis([points],{targetId:'absent',operation:'buffer-points'}),{code:'GUIDED_LAYER_REQUIRED'});
 assert.throws(()=>guidedAnalysis([points],{targetId:'p',operation:'code'}),{code:'GUIDED_OPERATION_INVALID'});
});
test('sauvegarde et restauration d’un projet : couche, provenance et paramètres',()=>{
 const r=guidedAnalysis([points,refs],{targetId:'p',referenceId:'r',operation:'within-distance',distanceMeters:120});
 const resultLayer={...layer('out',r.collection.name,r.collection.features),geojson:r.collection,source:r.sourceDescription};
 const restored=parseLocalProject(JSON.stringify(serializeLocalProject([resultLayer])), {includeMetadata:true});
 assert.equal(restored.layers[0].geojson.urbatrameDerivation.operation,'within-distance');
 assert.equal(restored.layers[0].geojson.urbatrameDerivation.sources[1].source,'source-r');
});
