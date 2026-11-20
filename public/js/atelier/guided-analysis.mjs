/* Outils guidés locaux : adaptation déterministe de capacités SIG génériques.
   Aucun appel IA ou réseau. Les identifiants sélectionnent des couches sans
   ambiguïté ; les données et les hypothèses restent explicites. */
import { runLocalRecipe } from './automation.mjs';

function fail(code) { const e = new Error(code); e.code = code; throw e; }
function getLayer(layers, id) {
  const matches = layers.filter(l => l.id === id && l.kind !== 'raster');
  if (matches.length !== 1) fail('GUIDED_LAYER_REQUIRED');
  return matches[0];
}
function meta(layer) {
  return { name: layer.name, source: layer.source || 'Source non renseignée', fileName: layer.fileName || null,
    sourceCrs: layer.sourceCrs || 'EPSG:4326', importedAt: layer.importedAt || null };
}
function numeric(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) return null;
  const n = Number(value); return Number.isFinite(n) ? n : null;
}
export function guidedAnalysis(layers, options) {
  if (!Array.isArray(layers) || !options || typeof options !== 'object') fail('GUIDED_INVALID');
  const target = getLayer(layers, options.targetId), op = options.operation;
  const reference = ['within-distance', 'within-polygon'].includes(op) ? getLayer(layers, options.referenceId) : null;
  const targetAlias = { ...target, name: 'Couche cible' };
  const referenceAlias = reference ? { ...reference, name: 'Couche de référence' } : null;
  let collection, report, parameters = {};
  if (op === 'filter-number') {
    const field = typeof options.field === 'string' ? options.field.trim() : '';
    if (!field || field.length > 120 || ['__proto__', 'prototype', 'constructor'].includes(field)) fail('GUIDED_FIELD_REQUIRED');
    const threshold = numeric(options.threshold);
    if (threshold === null || !['gt','gte','lt','lte','eq'].includes(options.comparison)) fail('GUIDED_NUMBER_INVALID');
    const predicate = { gt: (a,b) => a>b, gte: (a,b) => a>=b, lt: (a,b) => a<b, lte: (a,b) => a<=b, eq: (a,b) => a===b }[options.comparison];
    let missing = 0;
    const features = target.geojson.features.filter(f => {
      const n = numeric(Object.hasOwn(f.properties || {}, field) ? f.properties[field] : null);
      if (n === null) { missing++; return false; }
      return predicate(n, threshold);
    });
    collection = { type: 'FeatureCollection', crs: 'EPSG:4326', sourceCrs: target.sourceCrs || 'EPSG:4326', features };
    parameters = { field, comparison: options.comparison, threshold };
    report = { matched: features.length, total: target.geojson.features.length, nonNumericOrMissing: missing,
      note: 'Les valeurs manquantes, vides et non numériques sont exclues. Les chaînes décimales utilisent un point.' };
  } else {
    let step;
    if (op === 'buffer-points' || op === 'buffer-lines') {
      parameters = { radiusMeters: options.distanceMeters, segments: 32 };
      step = { op, layer: targetAlias.name, ...parameters };
    } else if (op === 'within-distance') {
      parameters = { distanceMeters: options.distanceMeters };
      step = { op, layer: targetAlias.name, referenceLayer: referenceAlias.name, ...parameters };
    } else if (op === 'within-polygon') {
      const polygonFeature = options.polygonFeature;
      if (!Number.isInteger(polygonFeature) || polygonFeature < 0) fail('GUIDED_POLYGON_INDEX');
      parameters = { polygonFeature };
      step = { op, layer: targetAlias.name, polygonLayer: referenceAlias.name, polygonFeature };
    } else fail('GUIDED_OPERATION_INVALID');
    const result = runLocalRecipe(referenceAlias ? [targetAlias, referenceAlias] : [targetAlias], { version: 1, steps: [step] });
    collection = result.artifacts[0].collection; report = result.reports[0];
  }
  // Les objets du résultat ne doivent jamais partager de références modifiables
  // avec les couches sources, notamment après une sélection ou un filtre.
  collection.features = structuredClone(collection.features);
  if (op === 'buffer-points' || op === 'buffer-lines') {
    for (const feature of collection.features) {
      if (feature.properties?._urbaTrameDerivation) feature.properties._urbaTrameDerivation.sourceLayer = target.name;
    }
  }
  collection.name = `${target.name} · ${({ 'buffer-points':'tampons points', 'buffer-lines':'tampons lignes', 'within-distance':'proximité', 'within-polygon':'points dans zone', 'filter-number':'filtre numérique' })[op]}`;
  const sources = [meta(target), ...(reference ? [meta(reference)] : [])];
  collection.urbatrame = { coordinateSystem: 'EPSG:4326 (WGS 84 longitude, latitude)', sources };
  collection.urbatrameDerivation = { operation: op, parameters, sources, generatedAt: new Date().toISOString(),
    note: report.note || 'Résultat indicatif à vérifier; ne constitue pas une donnée réglementaire ou cadastrale.' };
  return { collection, report, sourceDescription: `Analyse locale ${op} · ${sources.map(s => `${s.name} (${s.source})`).join(' ; ')} · ${JSON.stringify(parameters)}` };
}
