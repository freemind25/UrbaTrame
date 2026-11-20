import test from 'node:test';
import assert from 'node:assert/strict';
import { listGalleryExamples, createGalleryExample, GALLERY_SOURCE } from '../public/js/atelier/planning-gallery.mjs';
import { parseGeoJSONText, exportVisibleGeoJSON } from '../public/js/atelier/local-layers.mjs';
import { serializeLocalProject, parseLocalProject } from '../public/js/atelier/project.mjs';

test('galerie : exemples distincts et jeux fictifs valides et attribués', () => {
 const entries = listGalleryExamples();
 assert.equal(entries.length, 4); assert.equal(new Set(entries.map(x=>x.id)).size, entries.length);
 assert.equal(new Set(entries.map(x=>x.category)).size, 4);
 for (const entry of entries) {
  const layers = createGalleryExample(entry.id);
  assert.equal(layers.length, entry.layerCount);
  assert.equal(layers.reduce((n,layer)=>n+layer.geojson.features.length,0), entry.featureCount);
  for (const layer of layers) {
   assert.equal(layer.source, GALLERY_SOURCE);
   assert.match(layer.source,/fictif/);
   const parsed = parseGeoJSONText(JSON.stringify(layer.geojson));
   assert.equal(parsed.urbatrame.galleryExample.example,entry.id);
   assert.ok(parsed.features.every(feature=>feature.properties.nature_donnee==='démonstration fictive'));
  }
 }
 assert.throws(()=>createGalleryExample('inconnu'),/GALLERY_EXAMPLE_UNKNOWN/);
});
test('galerie : ouvertures indépendantes, sources gardées en projet et à l’export', () => {
 const layers = createGalleryExample('parcelles');
 const pristine = JSON.stringify(createGalleryExample('parcelles'));
 layers[0].geojson.features[0].properties.parcelle='modifiée';
 assert.equal(JSON.stringify(createGalleryExample('parcelles')),pristine);
 const ready = layers.map(l=>({...l,kind:'vector',visible:true,categoryColors:new Map(),crs:'EPSG:4326',sourceCrs:'EPSG:4326'}));
 const raw = serializeLocalProject(ready);
 const restored = parseLocalProject(JSON.stringify(raw));
 assert.equal(restored.length,2);
 assert.match(restored[0].source,/fictif/);
 assert.equal(restored[0].geojson.urbatrame.galleryExample.example,'parcelles');
 const exported = exportVisibleGeoJSON(restored);
 assert.match(exported.urbatrame.sources[0].source,/fictif/);
 assert.equal(exported.features[0].properties.nature_donnee,'démonstration fictive');
});
