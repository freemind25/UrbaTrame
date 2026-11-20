/* Exemples intégralement fictifs. Aucun relevé, aucune donnée Felt ni OSM. */
const ORIGIN = [6.6969, 36.2642];
const coord = ([x, y]) => [Number((ORIGIN[0] + x * 0.0001).toFixed(6)), Number((ORIGIN[1] + y * 0.0001).toFixed(6))];
const feature = (geometry, properties) => ({ type: 'Feature', geometry, properties: { ...properties, nature_donnee: 'démonstration fictive' } });
const point = (x, y, properties) => feature({ type: 'Point', coordinates: coord([x, y]) }, properties);
const line = (coords, properties) => feature({ type: 'LineString', coordinates: coords.map(coord) }, properties);
const polygon = (coords, properties) => feature({ type: 'Polygon', coordinates: [[...coords, coords[0]].map(coord)] }, properties);
const rect = (x, y, w, h, properties) => polygon([[x,y],[x+w,y],[x+w,y+h],[x,y+h]], properties);
const layer = (name, color, features) => ({ name, color, features });
export const GALLERY_SOURCE = 'UrbaTrame · jeu de démonstration fictif · géométries et attributs inventés, non cadastraux';
const DEMOS = [
  { id:'occupation', category:'Occupation du sol', title:'Quartier et usages du sol',
    description:'Comparez des îlots résidentiels, des espaces verts et des équipements imaginaires.',
    layers:[
      layer('Espaces ouverts fictifs','#78a66b',[rect(0,0,22,14,{usage:'Espace ouvert fictif'}), rect(27,15,11,7,{usage:'Jardin fictif'})]),
      layer('Îlots fictifs','#c58760',[rect(3,2,6,4,{usage:'Résidentiel'}),rect(12,2,7,4,{usage:'Résidentiel'}),rect(3,8,7,4,{usage:'Mixte'}),rect(13,8,6,4,{usage:'Équipement'})]),
      layer('Voirie fictive','#566b70',[line([[-1,7],[24,7],[40,17]],{type:'Voie fictive'}),line([[11,-1],[11,16]],{type:'Voie fictive'})]) ] },
  { id:'mobilite', category:'Mobilités', title:'Chemins et accès',
    description:'Explorez un réseau piéton fictif et quelques destinations imaginaires.',
    layers:[
      layer('Parc fictif','#a6c68f',[rect(0,0,30,20,{usage:'Parc fictif'})]),
      layer('Cheminements fictifs','#487f75',[line([[2,4],[10,7],[17,6],[27,15]],{type:'Chemin piéton'}),line([[10,7],[12,16],[23,18]],{type:'Chemin piéton'}),line([[17,6],[23,3],[29,4]],{type:'Chemin piéton'})]),
      layer('Destinations fictives','#bc6749',[point(2,4,{destination:'Entrée'}),point(12,16,{destination:'Équipement'}),point(27,15,{destination:'Arrêt'}),point(23,3,{destination:'Place'})]) ] },
  { id:'equipements', category:'Équipements', title:'Services de proximité',
    description:'Visualisez des équipements imaginaires et entraînez-vous aux analyses de proximité.',
    layers:[
      layer('Secteur fictif','#c8d7ba',[rect(0,0,32,20,{secteur:'Secteur fictif'})]),
      layer('Rues fictives','#7b8d81',[line([[0,5],[32,5]],{type:'Rue'}),line([[0,14],[32,14]],{type:'Rue'}),line([[8,0],[8,20]],{type:'Rue'}),line([[22,0],[22,20]],{type:'Rue'})]),
      layer('Équipements fictifs','#c06c50',[point(5,4,{service:'École'}),point(15,11,{service:'Santé'}),point(26,16,{service:'Culture'}),point(26,5,{service:'Commerce'})]) ] },
  { id:'parcelles', category:'Parcelles', title:'Étude parcellaire fictive',
    description:'Inspectez des parcelles et emprises bâties imaginaires, sans portée foncière.',
    layers:[
      layer('Parcelles fictives','#a2c29c',[rect(0,0,9,10,{parcelle:'A',statut:'Fictif'}),rect(10,0,9,10,{parcelle:'B',statut:'Fictif'}),rect(20,0,9,10,{parcelle:'C',statut:'Fictif'}),rect(0,11,14,9,{parcelle:'D',statut:'Fictif'}),rect(15,11,14,9,{parcelle:'E',statut:'Fictif'})]),
      layer('Bâtiments fictifs','#b87555',[rect(2,2,5,5,{usage:'Habitat'}),rect(12,2,5,5,{usage:'Habitat'}),rect(22,2,5,5,{usage:'Activité'}),rect(3,13,7,5,{usage:'Service'}),rect(18,13,8,5,{usage:'Habitat'})]) ] }
];
export function listGalleryExamples() {
  return DEMOS.map(({ id, category, title, description, layers }) => ({ id, category, title, description, layerCount: layers.length, featureCount: layers.reduce((n, l) => n + l.features.length, 0) }));
}
export function createGalleryExample(id) {
  const demo = DEMOS.find(item => item.id === id);
  if (!demo) throw new Error('GALLERY_EXAMPLE_UNKNOWN');
  return demo.layers.map(l => ({ name:l.name, fileName:`${id}-fictif.geojson`, source:GALLERY_SOURCE, color:l.color,
    geojson:{ type:'FeatureCollection', name:l.name, crs:'EPSG:4326', sourceCrs:'EPSG:4326', features:structuredClone(l.features),
      urbatrame:{ galleryExample:{ example:id, title:demo.title, source:GALLERY_SOURCE, note:'Données et positions fictives. Ne pas utiliser comme situation réelle.' } } } }));
}
