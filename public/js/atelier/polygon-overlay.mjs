/* Intersection et découpage polygonaux 2D locaux. JSTS est chargé depuis une
   copie figée et accompagnée de ses licences ; jamais de réparation silencieuse. */
import '../../vendor/jsts/jsts-2.12.1.min.js';
import { utm } from './exports.mjs';
import { toWgs84 } from './local-layers.mjs';

export const OVERLAY_LIMITS = Object.freeze({ featuresPerLayer:100, inputPositions:20000, pairs:10000, outputFeatures:1000, outputPositions:30000, outputPropertyBytes:8*1024*1024, derivationBytes:16000 });
function fail(code, detail='') { const e=new Error(detail ? `${code}: ${detail}` : code); e.code=code; throw e; }
function crsParts(crs) {
  const match=typeof crs==='string' && crs.match(/^EPSG:(326|327)(\d{2})$/);
  const zone=match ? Number(match[2]) : 0;
  if (!match || zone<1 || zone>60) fail('OVERLAY_CRS','Choisissez un CRS UTM WGS 84 explicite (EPSG:32601–32660 ou 32701–32760).');
  return {zone,hemisphere:match[1]==='326'?'N':'S'};
}
function projectPosition(position, parts) {
  if (!Array.isArray(position) || position.length!==2 || !position.every(Number.isFinite)) fail('OVERLAY_2D','Coordonnées strictement 2D et finies requises.');
  const [lon,lat]=position;
  if (lon < -180 || lon >= 180 || lat < -80 || lat > 84 || (parts.hemisphere==='S' ? lat>=0 : lat<0)) fail('OVERLAY_CRS_DOMAIN','Latitude ou hémisphère hors du domaine UTM choisi.');
  const projected=utm(lat,lon);
  if (projected.zone!==parts.zone || projected.hemisphere!==parts.hemisphere) fail('OVERLAY_CRS_DOMAIN','Les deux couches doivent tenir entièrement dans le fuseau UTM et l’hémisphère choisis, sans antéméridien.');
  if (![projected.easting,projected.northing].every(Number.isFinite) || projected.easting<100000 || projected.easting>900000 || projected.northing<0 || projected.northing>10000000) fail('OVERLAY_CRS_DOMAIN','Coordonnées projetées hors domaine pris en charge.');
  return [projected.easting,projected.northing];
}
function mapPolygon(geometry, mapPosition) {
  if (!geometry || !['Polygon','MultiPolygon'].includes(geometry.type) || !Array.isArray(geometry.coordinates)) fail('OVERLAY_POLYGON_REQUIRED','Toutes les géométries doivent être des polygones ou multipolygones 2D non vides.');
  const polygons=geometry.type==='Polygon' ? [geometry.coordinates] : geometry.coordinates;
  if (!polygons.length) fail('OVERLAY_POLYGON_REQUIRED','Géométrie vide.');
  const mapped=polygons.map(poly=>{
    if (!Array.isArray(poly) || !poly.length) fail('OVERLAY_POLYGON_REQUIRED','Polygone sans anneau.');
    return poly.map(ring=>{
      if (!Array.isArray(ring) || ring.length<4 || !Array.isArray(ring[0]) || !Array.isArray(ring.at(-1)) || ring[0][0]!==ring.at(-1)[0] || ring[0][1]!==ring.at(-1)[1]) fail('OVERLAY_RING','Anneau non fermé ou insuffisant.');
      return ring.map(mapPosition);
    });
  });
  return {type:geometry.type,coordinates:geometry.type==='Polygon'?mapped[0]:mapped};
}
function polygonComponents(json) {
  if (!json) return [];
  if (json.type==='Polygon') return [json.coordinates];
  if (json.type==='MultiPolygon') return json.coordinates;
  if (json.type==='GeometryCollection') return (json.geometries||[]).flatMap(polygonComponents);
  return [];
}
// GeoJSON RFC 7946 : extérieur antihoraire, trous horaires. On soustrait
// l'origine de l'anneau pour limiter l'annulation numérique de la somme.
function orientGeoJSON(geometry) {
  const polygons=geometry.type==='Polygon' ? [geometry.coordinates] : geometry.coordinates;
  for (const polygon of polygons) for (let index=0;index<polygon.length;index++) {
    const ring=polygon[index], [ox,oy]=ring[0];let twiceArea=0;
    for (let i=0;i<ring.length-1;i++) twiceArea+=(ring[i][0]-ox)*(ring[i+1][1]-oy)-(ring[i+1][0]-ox)*(ring[i][1]-oy);
    if ((index===0 && twiceArea<0) || (index>0 && twiceArea>0)) ring.reverse();
  }
  return geometry;
}
function metadata(layer) { return { name:layer.name, fileName:layer.fileName || null, source:layer.source || 'Source non renseignée', sourceCrs:layer.sourceCrs || 'EPSG:4326', importedAt:layer.importedAt || null, scope:layer.publicScope || null }; }
function originalIndex(layer,index) { const values=layer.scopeInfo?.originalIndices; return Array.isArray(values) && Number.isInteger(values[index]) ? values[index] : index; }
function ref(layer,feature,index) { return {index:originalIndex(layer,index), id: (typeof feature.id==='string' && feature.id.length<=120) || (typeof feature.id==='number' && Number.isFinite(feature.id)) ? feature.id : null}; }
export function runPolygonOverlay(target, reference, options) {
  const j=globalThis.jsts;
  if (!j || j.version!=='2.12.1') fail('OVERLAY_ENGINE','Moteur local JSTS 2.12.1 absent.');
  if (!target?.geojson || !reference?.geojson || !Array.isArray(target.geojson.features) || !Array.isArray(reference.geojson.features)) fail('OVERLAY_LAYERS','Deux couches vectorielles sont nécessaires.');
  if (!options || !['intersection','clip'].includes(options.operation)) fail('OVERLAY_OPERATION','Opération non prise en charge.');
  const {zone,hemisphere}=crsParts(options.crs); const parts={zone,hemisphere};
  const a=target.geojson.features,b=reference.geojson.features;
  if (!a.length || !b.length) fail('OVERLAY_EMPTY','Les deux périmètres doivent contenir au moins une entité.');
  if (a.length>OVERLAY_LIMITS.featuresPerLayer || b.length>OVERLAY_LIMITS.featuresPerLayer) fail('OVERLAY_LIMIT','100 entités maximum par couche après filtrage.');
  if (a.length*b.length>OVERLAY_LIMITS.pairs) fail('OVERLAY_LIMIT','Trop de paires potentielles.');
  const reader=new j.io.GeoJSONReader(),writer=new j.io.GeoJSONWriter();let positions=0;
  function prepare(layer,label) {
    return layer.geojson.features.map((feature,index)=>{
      const projected=mapPolygon(feature?.geometry,position=>{if (++positions>OVERLAY_LIMITS.inputPositions) fail('OVERLAY_LIMIT','20 000 positions maximum en entrée.');return projectPosition(position,parts);});
      let geom; try {geom=reader.read(projected);} catch {fail('OVERLAY_INVALID',`${label}, entité ${originalIndex(layer,index)+1} : géométrie illisible.`);}
      if (geom.isEmpty() || !geom.isValid()) fail('OVERLAY_INVALID',`${label}, entité ${originalIndex(layer,index)+1} : géométrie topologiquement invalide ; aucune réparation automatique.`);
      return {geom,feature,index};
    });
  }
  const targets=prepare(target,'Cible'), masks=prepare(reference,'Référence');
  let maskUnion=null, outputPositions=0, outputPropertyBytes=0, pairsChecked=0, boundaryOnly=0; const features=[];
  const unproject = p=>{
    if (++outputPositions>OVERLAY_LIMITS.outputPositions) fail('OVERLAY_LIMIT','30 000 positions maximum en sortie.');
    let coord;try {coord=toWgs84(p[0],p[1],options.crs);} catch {fail('OVERLAY_OUTPUT_CRS','Résultat hors du domaine inverse du CRS.');}
    if (!coord.every(Number.isFinite)) fail('OVERLAY_OUTPUT_CRS','Coordonnée de sortie invalide.');
    return coord;
  };
  function appendGeometry(g, item, other) {
    if (g.isEmpty()) return;
    const raw=writer.write(g), polys=polygonComponents(raw);
    if (!polys.length) {boundaryOnly++;return;}
    const geoProjected=polys.length===1 ? {type:'Polygon',coordinates:polys[0]} : {type:'MultiPolygon',coordinates:polys};
    const projectedCheck=reader.read(geoProjected);
    if (!projectedCheck.isValid() || projectedCheck.isEmpty() || !(projectedCheck.getArea()>0)) fail('OVERLAY_OUTPUT_INVALID','Résultat polygonal invalide ou dégénéré.');
    const geo=orientGeoJSON(mapPolygon(geoProjected,unproject));
    if (!reader.read(geo).isValid()) fail('OVERLAY_OUTPUT_INVALID','Résultat invalide après transformation en WGS 84.');
    const properties={ cible:item.feature.properties || {}, origine_cible:ref(target,item.feature,item.index) };
    if (other) { properties.reference=other.feature.properties || {};properties.origine_reference=ref(reference,other.feature,other.index); }
    outputPropertyBytes += new TextEncoder().encode(JSON.stringify(properties)).length;
    if (outputPropertyBytes>OVERLAY_LIMITS.outputPropertyBytes) fail('OVERLAY_LIMIT','Attributs de sortie supérieurs à 8 Mo.');
    properties.cible=structuredClone(properties.cible);
    if (other) properties.reference=structuredClone(properties.reference);
    features.push({type:'Feature',geometry:geo,properties});
    if (features.length>OVERLAY_LIMITS.outputFeatures) fail('OVERLAY_LIMIT','1 000 entités maximum en sortie.');
  }
  try {
    if (options.operation==='clip') {
      maskUnion=masks[0].geom;
      for (const item of masks.slice(1)) {
        maskUnion=maskUnion.union(item.geom);
        if (maskUnion.isEmpty() || !maskUnion.isValid()) fail('OVERLAY_OUTPUT_INVALID','Union du masque invalide.');
      }
      for (const item of targets) {
        pairsChecked++;
        if (item.geom.getEnvelopeInternal().intersects(maskUnion.getEnvelopeInternal())) appendGeometry(item.geom.intersection(maskUnion),item,null);
      }
    } else {
      for (const item of targets) for (const other of masks) {
        pairsChecked++;
        if (item.geom.getEnvelopeInternal().intersects(other.geom.getEnvelopeInternal())) appendGeometry(item.geom.intersection(other.geom),item,other);
      }
    }
  } catch (error) { if (error?.code) throw error; fail('OVERLAY_TOPOLOGY','Échec du moteur topologique ; aucune couche ajoutée. Vérifiez les géométries et leur précision.'); }
  const sources=[metadata(target),metadata(reference)], generatedAt=new Date().toISOString();
  const note='Résultat polygonal 2D indicatif ; intersections de limites seules exclues, calcul plan en UTM, sans réparation automatique ni valeur cadastrale.';
  const collection={type:'FeatureCollection', name:`${target.name} · ${options.operation==='clip'?'découpage':'intersection'}`,crs:'EPSG:4326',sourceCrs:'EPSG:4326',features,
    urbatrame:{coordinateSystem:'EPSG:4326 (WGS 84 longitude, latitude)',sources},
    urbatrameDerivation:{operation:options.operation,engine:'JSTS 2.12.1',computationCrs:options.crs,outputCrs:'EPSG:4326',precision:'double flottant, sans grille ni réparation automatique',generatedAt,sources,
      referenceFeatures:masks.map(m=>ref(reference,m.feature,m.index)),mask:options.operation==='clip'?'union polygonale des entités de référence':'intersection par paires',note}};
  if (new TextEncoder().encode(JSON.stringify(collection.urbatrameDerivation)).length>OVERLAY_LIMITS.derivationBytes) fail('OVERLAY_LIMIT','Provenance supérieure à 16 000 octets ; réduisez les métadonnées ou le périmètre.');
  return {collection,report:{targetCount:a.length,referenceCount:b.length,pairsChecked,inputPositions:positions,outputPositions,outputFeatures:features.length,boundaryOnly,note}};
}
