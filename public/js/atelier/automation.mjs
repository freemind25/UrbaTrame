import { countFeaturePositions, exportVisibleGeoJSON } from './local-layers.mjs';
import { summarizeFeatures, greatCircleDistanceMeters } from './local-analysis.mjs';
import { bufferPointFeatures, bufferLineFeatures, DEFAULT_BUFFER_SEGMENTS } from './local-buffer.mjs';

export const MAX_RECIPE_STEPS = 20;
export const MAX_RECIPE_ARTIFACTS = 10;
export const MAX_SPATIAL_PAIR_COMPARISONS = 5_000_000;
export const MAX_PROXIMITY_DISTANCE_METERS = 100_000;

function fail(code, detail = '') { const error = new Error(detail ? `${code}:${detail}` : code); error.code = code; throw error; }

function resolveLayer(layers, name) {
  if (typeof name !== 'string' || !name.trim()) fail('RECIPE_LAYER_REQUIRED');
  const matches = layers.filter(layer => layer.name === name.trim());
  if (matches.length !== 1) fail(matches.length ? 'RECIPE_LAYER_AMBIGUOUS' : 'RECIPE_LAYER_NOT_FOUND', name);
  return matches[0];
}

function pointInRing(point, ring) {
  if (!Array.isArray(ring) || ring.length < 4) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    const cross = (point[0] - xi) * (yj - yi) - (point[1] - yi) * (xj - xi);
    if (Math.abs(cross) < 1e-12 && point[0] >= Math.min(xi, xj) && point[0] <= Math.max(xi, xj) && point[1] >= Math.min(yi, yj) && point[1] <= Math.max(yi, yj)) return true;
    const intersects = ((yi > point[1]) !== (yj > point[1])) && point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point, coordinates) {
  if (!coordinates?.length || !pointInRing(point, coordinates[0])) return false;
  return !coordinates.slice(1).some(hole => pointInRing(point, hole));
}

function pointInGeometry(point, geometry) {
  if (!geometry) return false;
  if (geometry.type === 'Polygon') return pointInPolygon(point, geometry.coordinates);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.some(polygon => pointInPolygon(point, polygon));
  if (geometry.type === 'GeometryCollection') return geometry.geometries.some(child => pointInGeometry(point, child));
  return false;
}

function containsPoint(feature, polygon) {
  const geometry = feature?.geometry;
  if (geometry?.type === 'Point') return pointInGeometry(geometry.coordinates, polygon);
  if (geometry?.type === 'MultiPoint') return geometry.coordinates.some(point => pointInGeometry(point, polygon));
  return false;
}
function pointCoordinates(geometry) {
  if (geometry?.type === 'Point') return Array.isArray(geometry.coordinates) ? [geometry.coordinates] : [];
  if (geometry?.type === 'MultiPoint') return Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
  return [];
}
function polygonPositionCount(geometry) {
  if (!geometry) return 0;
  if (geometry.type === 'Polygon') return geometry.coordinates.reduce((sum, ring) => sum + ring.length, 0);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.reduce((sum, polygon) => sum + polygonPositionCount({ type: 'Polygon', coordinates: polygon }), 0);
  if (geometry.type === 'GeometryCollection') return geometry.geometries.reduce((sum, child) => sum + polygonPositionCount(child), 0);
  return 0;
}
function containsPolygon(geometry) {
  if (!geometry) return false;
  if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') return true;
  return geometry.type === 'GeometryCollection' && geometry.geometries.some(containsPolygon);
}

function sourceCollection(layer, features = layer.geojson.features, name = layer.name) {
  return {
    type: 'FeatureCollection', name,
    crs: 'EPSG:4326', sourceCrs: layer.sourceCrs || layer.geojson.sourceCrs || 'EPSG:4326',
    features,
    urbatrame: {
      exportedAt: new Date().toISOString(),
      coordinateSystem: 'EPSG:4326 (WGS 84 longitude, latitude)',
      sources: [{
        name: layer.name, fileName: layer.fileName || layer.name, source: layer.source || 'Source utilisateur',
        sourceCrs: layer.sourceCrs || layer.geojson.sourceCrs || 'EPSG:4326', importedAt: layer.importedAt || null,
        sourceFeatureCount: layer.geojson.features.length, outputFeatureCount: features.length
      }]
    }
  };
}

function filename(value) { return String(value || 'resultat').normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'resultat'; }

export function runLocalRecipe(layers, recipe) {
  if (!Array.isArray(layers)) fail('RECIPE_INVALID');
  if (!recipe || typeof recipe !== 'object' || recipe.version !== 1 || !Array.isArray(recipe.steps)) fail('RECIPE_INVALID');
  if (recipe.steps.length > MAX_RECIPE_STEPS) fail('RECIPE_TOO_MANY_STEPS');
  const reports = [], artifacts = [];
  for (let index = 0; index < recipe.steps.length; index++) {
    const step = recipe.steps[index];
    if (!step || typeof step !== 'object' || Array.isArray(step)) fail('RECIPE_INVALID_STEP', String(index + 1));
    if (step.op === 'measure') {
      const layer = resolveLayer(layers, step.layer);
      const summary = summarizeFeatures(layer.geojson.features);
      reports.push({ operation: 'measure', layer: layer.name, summary });
    } else if (step.op === 'filter') {
      const layer = resolveLayer(layers, step.layer);
      if (typeof step.field !== 'string' || !step.field.trim() || ['__proto__', 'constructor', 'prototype'].includes(step.field.trim()) || !['equals', 'contains', 'not-equals'].includes(step.match) || typeof step.value !== 'string') fail('RECIPE_FILTER_INVALID');
      const field = step.field.trim(), expected = step.value.trim().toLocaleLowerCase('fr-FR');
      const features = layer.geojson.features.filter(feature => {
        const value = Object.hasOwn(feature.properties || {}, field) ? feature.properties[field] : undefined;
        const actual = value == null ? '' : String(value).trim().toLocaleLowerCase('fr-FR');
        if (step.match === 'equals') return actual === expected;
        if (step.match === 'not-equals') return actual !== expected;
        return actual.includes(expected);
      });
      const collection = sourceCollection(layer, features, `${layer.name} · filtre ${step.field}`);
      artifacts.push({ fileName: `${filename(layer.name)}-filtre-${filename(step.field)}.geojson`, collection });
      reports.push({ operation: 'filter', layer: layer.name, field: step.field, matched: features.length, total: layer.geojson.features.length });
    } else if (step.op === 'within-polygon') {
      const layer = resolveLayer(layers, step.layer), polygonLayer = resolveLayer(layers, step.polygonLayer);
      const featureIndex = Number.isInteger(step.polygonFeature) ? step.polygonFeature : 0;
      const polygonFeature = polygonLayer.geojson.features[featureIndex];
      if (!polygonFeature || !containsPolygon(polygonFeature.geometry)) fail('RECIPE_POLYGON_REQUIRED');
      const targetPoints = layer.geojson.features.filter(feature => ['Point', 'MultiPoint'].includes(feature.geometry?.type));
      if (countFeaturePositions(targetPoints) * polygonPositionCount(polygonFeature.geometry) > 5_000_000) fail('RECIPE_SPATIAL_COMPLEXITY');
      const features = targetPoints.filter(feature => containsPoint(feature, polygonFeature.geometry));
      const collection = sourceCollection(layer, features, `${layer.name} · points dans ${polygonLayer.name}`);
      artifacts.push({ fileName: `${filename(layer.name)}-dans-${filename(polygonLayer.name)}.geojson`, collection });
      reports.push({ operation: 'within-polygon', layer: layer.name, polygonLayer: polygonLayer.name, matched: features.length, total: layer.geojson.features.length, note: 'Seuls les points et multipoints sont retenus; les anneaux intérieurs du polygone sont exclus.' });
    } else if (step.op === 'within-distance') {
      const layer = resolveLayer(layers, step.layer), referenceLayer = resolveLayer(layers, step.referenceLayer);
      const distanceMeters = step.distanceMeters;
      if (!Number.isFinite(distanceMeters) || distanceMeters < 0 || distanceMeters > MAX_PROXIMITY_DISTANCE_METERS) fail('RECIPE_DISTANCE_INVALID');
      const targetPoints = layer.geojson.features.filter(feature => ['Point', 'MultiPoint'].includes(feature.geometry?.type));
      const referencePoints = referenceLayer.geojson.features.filter(feature => ['Point', 'MultiPoint'].includes(feature.geometry?.type));
      if (!targetPoints.length) fail('RECIPE_TARGET_POINTS_REQUIRED');
      if (!referencePoints.length) fail('RECIPE_REFERENCE_POINTS_REQUIRED');
      const targetCoordinates = targetPoints.map(feature => pointCoordinates(feature.geometry));
      const referenceCoordinates = referencePoints.flatMap(feature => pointCoordinates(feature.geometry));
      const targetPositionCount = targetCoordinates.reduce((sum, points) => sum + points.length, 0);
      if (!targetPositionCount || !referenceCoordinates.length) fail('RECIPE_DISTANCE_COORDINATES_REQUIRED');
      if (targetPositionCount * referenceCoordinates.length > MAX_SPATIAL_PAIR_COMPARISONS) fail('RECIPE_SPATIAL_COMPLEXITY');
      const validCoordinate = point => Array.isArray(point) && point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]) && point[0] >= -180 && point[0] <= 180 && point[1] >= -90 && point[1] <= 90;
      if ([...targetCoordinates.flat(), ...referenceCoordinates].some(point => !validCoordinate(point))) fail('RECIPE_DISTANCE_COORDINATE_INVALID');
      const features = [];
      let comparisons = 0;
      for (let featureIndex = 0; featureIndex < targetPoints.length; featureIndex++) {
        let matched = false;
        for (const target of targetCoordinates[featureIndex]) {
          for (const reference of referenceCoordinates) {
            comparisons++;
            if (greatCircleDistanceMeters(target, reference) <= distanceMeters) { matched = true; break; }
          }
          if (matched) break;
        }
        if (matched) features.push(targetPoints[featureIndex]);
      }
      const collection = sourceCollection(layer, features, `${layer.name} · à ${distanceMeters} m de ${referenceLayer.name}`);
      collection.urbatrameDerivation = {
        operation: 'within-distance', distanceMeters, method: 'distance de grand cercle approximée sur une sphère',
        generatedAt: new Date().toISOString(),
        source: { targetLayer: layer.name, targetSource: layer.source, targetImportedAt: layer.importedAt, referenceLayer: referenceLayer.name, referenceSource: referenceLayer.source, referenceImportedAt: referenceLayer.importedAt },
        note: 'Sélection indicative des entités Point/MultiPoint ayant au moins un sommet dans le rayon; géométries sources conservées sans modification.'
      };
      artifacts.push({ fileName: `${filename(layer.name)}-a-${filename(String(distanceMeters))}m-de-${filename(referenceLayer.name)}.geojson`, collection });
      reports.push({ operation: 'within-distance', layer: layer.name, referenceLayer: referenceLayer.name, matched: features.length, total: targetPoints.length, distanceMeters, comparisons, note: collection.urbatrameDerivation.note });
    } else if (step.op === 'buffer-points') {
      const layer = resolveLayer(layers, step.layer);
      const result = bufferPointFeatures(layer.geojson.features, {
        radiusMeters: step.radiusMeters,
        segments: step.segments === undefined ? DEFAULT_BUFFER_SEGMENTS : step.segments,
        sourceLayer: layer.name, source: layer.source, importedAt: layer.importedAt
      });
      const collection = sourceCollection(layer, result.features, `${layer.name} · tampons ponctuels ${result.radiusMeters} m`);
      collection.urbatrameDerivation = {
        operation: 'buffer-points', method: 'approximation géodésique sphérique', radiusMeters: result.radiusMeters,
        segments: result.segments, dissolved: false, generatedAt: result.generatedAt,
        source: { layer: layer.name, source: layer.source, importedAt: layer.importedAt },
        note: 'Résultat indicatif non dissous; ne représente aucune limite cadastrale, juridique ou réglementaire.'
      };
      artifacts.push({ fileName: `${filename(layer.name)}-tampons-points-${filename(String(result.radiusMeters))}m.geojson`, collection });
      reports.push({ operation: 'buffer-points', layer: layer.name, points: result.pointCount, buffers: result.features.length, radiusMeters: result.radiusMeters, segments: result.segments, dissolved: false, note: collection.urbatrameDerivation.note });
    } else if (step.op === 'buffer-lines') {
      const layer = resolveLayer(layers, step.layer);
      const result = bufferLineFeatures(layer.geojson.features, {
        radiusMeters: step.radiusMeters,
        segments: step.segments === undefined ? DEFAULT_BUFFER_SEGMENTS : step.segments,
        sourceLayer: layer.name, source: layer.source, importedAt: layer.importedAt
      });
      const collection = sourceCollection(layer, result.features, `${layer.name} · capsules de ligne ${result.radiusMeters} m`);
      collection.urbatrameDerivation = {
        operation: 'buffer-lines', method: 'capsules géodésiques sphériques approximatives par segment',
        radiusMeters: result.radiusMeters, segments: result.segments, dissolved: false, generatedAt: result.generatedAt,
        source: { layer: layer.name, source: layer.source, importedAt: layer.importedAt },
        note: 'Pièces indicatives non dissoutes : elles se chevauchent aux sommets; les limites et surfaces résultantes peuvent se recouvrir. Segments de ligne de 100 km maximum; aucun usage cadastral ou juridique.'
      };
      artifacts.push({ fileName: `${filename(layer.name)}-tampons-lignes-${filename(String(result.radiusMeters))}m.geojson`, collection });
      reports.push({ operation: 'buffer-lines', layer: layer.name, segmentsBuffered: result.segmentCount, buffers: result.features.length, radiusMeters: result.radiusMeters, segments: result.segments, dissolved: false, outputPositions: result.outputPositions, note: collection.urbatrameDerivation.note });
    } else if (step.op === 'export-layer') {
      const layer = resolveLayer(layers, step.layer);
      artifacts.push({ fileName: `${filename(layer.name)}.geojson`, collection: sourceCollection(layer) });
      reports.push({ operation: 'export-layer', layer: layer.name, features: layer.geojson.features.length });
    } else if (step.op === 'export-visible') {
      const collection = exportVisibleGeoJSON(layers);
      artifacts.push({ fileName: 'urbatrame-couches-visibles.geojson', collection });
      reports.push({ operation: 'export-visible', layers: layers.filter(layer => layer.visible !== false).length, features: collection.features.length });
    } else fail('RECIPE_OPERATION_UNSUPPORTED', String(step.op || 'unknown'));
    if (artifacts.length > MAX_RECIPE_ARTIFACTS) fail('RECIPE_TOO_MANY_ARTIFACTS');
  }
  return { reports, artifacts };
}
