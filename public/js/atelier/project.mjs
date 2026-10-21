import { parseGeoJSONText, normalizeCrs, countFeaturePositions, MAX_TOTAL_POSITIONS } from './local-layers.mjs';
import {
  MAX_RASTER_BYTES, MAX_RASTER_PIXELS, MAX_TOTAL_RASTER_BYTES, MAX_TOTAL_RASTER_PIXELS
} from './geotiff-raster.mjs';
import { normalizeFieldTemplate } from './field-survey.mjs';

export const PROJECT_FORMAT = 'UrbaTrameProject';
export const PROJECT_VERSION = 1;
export const MAX_PROJECT_BYTES = 30 * 1024 * 1024;
export const MAX_PROJECT_LAYERS = 12;
export const MAX_PROJECT_FEATURES = 60_000;
const COLORS = ['#28734f', '#b7603e', '#3976a8', '#8761a6', '#b08a30', '#388b89'];

function fail(code) { const error = new Error(code); error.code = code; throw error; }

function bytesToBase64(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function base64ByteLength(value) {
  if (typeof value !== 'string' || !value || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
    fail('PROJECT_RASTER_INVALID');
  return value.length * 3 / 4 - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0);
}

function rasterBytes(layer) {
  if (typeof layer.raster?.sourceDataBase64 === 'string') return layer.raster.sourceDataBase64;
  if (layer.raster?.sourceBytes instanceof Uint8Array || layer.raster?.sourceBytes instanceof ArrayBuffer)
    return bytesToBase64(layer.raster.sourceBytes);
  fail('PROJECT_RASTER_SOURCE_MISSING');
}

export function serializeLocalProject(layers, now = new Date(), { surveyTemplate = null } = {}) {
  const project = {
    format: PROJECT_FORMAT, version: PROJECT_VERSION, exportedAt: now.toISOString(),
    coordinateSystem: 'EPSG:4326',
    layers: (layers || []).map(layer => ({
      name: layer.name, fileName: layer.fileName, source: layer.source, importedAt: layer.importedAt, lastEditedAt: layer.lastEditedAt || null,
      crs: layer.crs || 'EPSG:4326', sourceCrs: layer.sourceCrs || layer.geojson?.sourceCrs || 'EPSG:4326',
      color: layer.color, visible: layer.visible !== false,
      categoryField: layer.categoryField || '', categoryColors: [...(layer.categoryColors || new Map()).entries()],
      labelField: layer.labelField || '', filter: layer.filter || null,
      ...(layer.kind === 'raster' ? { kind: 'raster', raster: {
        sourceDataBase64: rasterBytes(layer), pixelCount: layer.raster.pixelCount,
        opacity: Number.isFinite(layer.raster?.opacity) ? layer.raster.opacity : 0.85
      } } : { kind: 'vector', geojson: layer.geojson })
    }))
  };
  if (surveyTemplate) {
    try { project.surveyTemplate = normalizeFieldTemplate(surveyTemplate); }
    catch { fail('PROJECT_TEMPLATE_INVALID'); }
  }
  return project;
}

function safeLayerStyle(item, index, fileName) {
  const color = /^#[\da-f]{6}$/i.test(item.color || '') ? item.color : COLORS[index % COLORS.length];
  const categoryColors = new Map(Array.isArray(item.categoryColors)
    ? item.categoryColors.filter(pair => Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string' && /^#[\da-f]{6}$/i.test(pair[1]))
      .slice(0, 60).map(([key, value]) => [key.slice(0, 240), value])
    : []);
  const date = Date.parse(item.importedAt), editDate = Date.parse(item.lastEditedAt);
  return {
    name: String(item.name || fileName.replace(/\.[^.]+$/, '')).slice(0, 100), fileName,
    source: String(item.source || fileName).slice(0, 240),
    importedAt: Number.isFinite(date) ? new Date(date).toISOString() : new Date().toISOString(),
    lastEditedAt: Number.isFinite(editDate) ? new Date(editDate).toISOString() : null,
    color, visible: item.visible !== false,
    categoryField: typeof item.categoryField === 'string' ? item.categoryField.slice(0, 240) : '',
    categoryColors, labelField: typeof item.labelField === 'string' ? item.labelField.slice(0, 240) : '',
    filter: item.filter && typeof item.filter.field === 'string' && typeof item.filter.value === 'string'
      ? { field: item.filter.field.slice(0, 240), value: item.filter.value.slice(0, 120) } : null
  };
}

function safeLayer(item, index) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) fail('PROJECT_LAYER_INVALID');
  const fileName = String(item.fileName || `couche-${index + 1}.geojson`).slice(0, 240);
  const style = safeLayerStyle(item, index, fileName);
  if (item.kind === 'raster') {
    const encoded = item.raster?.sourceDataBase64;
    const byteLength = base64ByteLength(encoded);
    if (byteLength < 1 || byteLength > MAX_RASTER_BYTES) fail('PROJECT_RASTER_INVALID');
    const pixelCount = Number(item.raster?.pixelCount);
    if (!Number.isSafeInteger(pixelCount) || pixelCount < 1 || pixelCount > MAX_RASTER_PIXELS) fail('PROJECT_RASTER_INVALID');
    let sourceCrs;
    try { sourceCrs = normalizeCrs(item.sourceCrs || item.raster?.sourceCrs || 'EPSG:4326'); }
    catch { fail('PROJECT_RASTER_INVALID'); }
    return {
      ...style, kind: 'raster', crs: 'EPSG:4326', sourceCrs,
      raster: {
        sourceDataBase64: encoded, pixelCount,
        opacity: Number.isFinite(Number(item.raster.opacity)) ? Math.max(0, Math.min(1, Number(item.raster.opacity))) : 0.85
      },
      editHistory: { undo: [], redo: [] }, positionCount: 0,
      geojson: { type: 'FeatureCollection', name: style.name, crs: 'EPSG:4326', sourceCrs, features: [] }
    };
  }
  if (!item.geojson) fail('PROJECT_LAYER_INVALID');
  const geojson = parseGeoJSONText(JSON.stringify(item.geojson), { fileName });
  const sourceCrs = normalizeCrs(item.sourceCrs || geojson.sourceCrs || 'EPSG:4326');
  return {
    ...style, kind: 'vector', crs: 'EPSG:4326', sourceCrs,
    editHistory: { undo: [], redo: [] }, positionCount: countFeaturePositions(geojson.features), geojson
  };
}

export function parseLocalProject(text, { includeMetadata = false } = {}) {
  if (typeof text !== 'string') fail('PROJECT_INVALID');
  if (text.length > MAX_PROJECT_BYTES) fail('PROJECT_TOO_LARGE');
  let raw;
  try { raw = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { fail('PROJECT_INVALID'); }
  if (raw?.format !== PROJECT_FORMAT || raw.version !== PROJECT_VERSION || !Array.isArray(raw.layers)) fail('PROJECT_FORMAT');
  if (raw.layers.length > MAX_PROJECT_LAYERS) fail('PROJECT_TOO_MANY_LAYERS');
  const layers = raw.layers.map(safeLayer);
  if (layers.reduce((sum, layer) => sum + layer.geojson.features.length, 0) > MAX_PROJECT_FEATURES) fail('PROJECT_TOO_MANY_FEATURES');
  if (layers.reduce((sum, layer) => sum + layer.positionCount, 0) > MAX_TOTAL_POSITIONS) fail('PROJECT_TOO_MANY_POSITIONS');
  const rasterLayers = layers.filter(layer => layer.kind === 'raster');
  const rasterBytesTotal = rasterLayers.reduce((sum, layer) => sum + base64ByteLength(layer.raster.sourceDataBase64), 0);
  if (rasterBytesTotal > MAX_TOTAL_RASTER_BYTES) fail('PROJECT_TOO_MANY_RASTER_BYTES');
  if (rasterLayers.length > MAX_PROJECT_LAYERS || rasterLayers.reduce((sum, layer) => sum + (layer.raster.pixelCount || 0), 0) > MAX_TOTAL_RASTER_PIXELS)
    fail('PROJECT_TOO_MANY_RASTER_PIXELS');
  let surveyTemplate = null;
  if (raw.surveyTemplate !== undefined && raw.surveyTemplate !== null) {
    try { surveyTemplate = normalizeFieldTemplate(raw.surveyTemplate); }
    catch { fail('PROJECT_TEMPLATE_INVALID'); }
  }
  return includeMetadata ? { layers, surveyTemplate } : layers;
}
