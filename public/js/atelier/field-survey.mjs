/* Modèles de fiches et attributs pour les relevés terrain UrbaTrame.
   Aucune donnée n'est téléversée : les valeurs restent dans le projet local. */

export const FIELD_TEMPLATE_FORMAT = 'UrbaTrameFieldTemplate';
export const FIELD_TEMPLATE_VERSION = 1;
export const MAX_FIELD_TEMPLATE_BYTES = 128 * 1024;
export const MAX_SURVEY_FIELDS = 40;
export const MAX_SELECT_OPTIONS = 60;

const FIELD_TYPES = new Set(['text', 'number', 'date', 'boolean', 'select']);
const FIELD_KEY = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const RESERVED_KEYS = new Set(['id', 'fid', 'geom', 'geometry', 'type', '_urbatrame', '__proto__', 'constructor', 'prototype']);
const GEOMETRY_TYPES = new Set(['Point', 'LineString', 'Polygon']);

function fail(code, detail = '') {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  throw error;
}

function cleanText(value, maximum = 100) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

export function defaultFieldTemplate() {
  return {
    format: FIELD_TEMPLATE_FORMAT,
    version: FIELD_TEMPLATE_VERSION,
    name: 'Relevé urbain',
    geometryTypes: ['Point', 'LineString', 'Polygon'],
    fields: [
      { key: 'categorie', label: 'Catégorie', type: 'select', required: true, options: ['Bâtiment', 'Voirie', 'Végétation', 'Mobilier', 'Eau', 'Accès', 'Autre'] },
      { key: 'observation', label: 'Observation', type: 'text', required: false, options: [] },
      { key: 'date_releve', label: 'Date du relevé', type: 'date', required: true, options: [] }
    ]
  };
}

export function normalizeFieldTemplate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('FIELD_TEMPLATE_INVALID');
  const name = cleanText(input.name, 80);
  if (!name) fail('FIELD_TEMPLATE_NAME_REQUIRED');
  const geometryTypes = Array.isArray(input.geometryTypes)
    ? [...new Set(input.geometryTypes.filter(value => GEOMETRY_TYPES.has(value)))]
    : ['Point', 'LineString', 'Polygon'];
  if (!geometryTypes.length) fail('FIELD_TEMPLATE_GEOMETRY_REQUIRED');
  if (!Array.isArray(input.fields) || input.fields.length > MAX_SURVEY_FIELDS) fail('FIELD_TEMPLATE_FIELDS_INVALID');
  const seen = new Set();
  const fields = input.fields.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('FIELD_TEMPLATE_FIELD_INVALID', String(index + 1));
    const key = String(raw.key || '').trim();
    const label = cleanText(raw.label, 80);
    const type = String(raw.type || 'text');
    const normalizedKey = key.toLocaleLowerCase('en-US');
    if (!FIELD_KEY.test(key) || RESERVED_KEYS.has(normalizedKey) || normalizedKey.startsWith('_urba') || ['gps_', 'height_', 'geoid_'].some(prefix => normalizedKey.startsWith(prefix)))
      fail('FIELD_TEMPLATE_KEY_INVALID', String(index + 1));
    if (seen.has(normalizedKey)) fail('FIELD_TEMPLATE_KEY_DUPLICATE', key);
    seen.add(normalizedKey);
    if (!label) fail('FIELD_TEMPLATE_LABEL_REQUIRED', key);
    if (!FIELD_TYPES.has(type)) fail('FIELD_TEMPLATE_TYPE_INVALID', key);
    let options = [];
    if (type === 'select') {
      if (!Array.isArray(raw.options)) fail('FIELD_TEMPLATE_OPTIONS_INVALID', key);
      options = [...new Set(raw.options.map(value => cleanText(value, 100)).filter(Boolean))];
      if (!options.length || options.length > MAX_SELECT_OPTIONS) fail('FIELD_TEMPLATE_OPTIONS_INVALID', key);
    }
    return { key, label, type, required: raw.required === true, options };
  });
  return {
    format: FIELD_TEMPLATE_FORMAT,
    version: FIELD_TEMPLATE_VERSION,
    name,
    geometryTypes,
    fields
  };
}

export function serializeFieldTemplate(input, now = new Date()) {
  const template = normalizeFieldTemplate(input);
  return {
    ...template,
    exportedAt: now.toISOString()
  };
}

export function parseFieldTemplate(text) {
  if (typeof text !== 'string' || text.length > MAX_FIELD_TEMPLATE_BYTES) fail('FIELD_TEMPLATE_TOO_LARGE');
  let raw;
  try { raw = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { fail('FIELD_TEMPLATE_INVALID'); }
  if (raw?.format !== FIELD_TEMPLATE_FORMAT || raw.version !== FIELD_TEMPLATE_VERSION) fail('FIELD_TEMPLATE_FORMAT');
  return normalizeFieldTemplate(raw);
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function buildSurveyProperties(templateInput, values = {}) {
  const template = normalizeFieldTemplate(templateInput);
  const properties = Object.create(null);
  for (const field of template.fields) {
    const raw = values[field.key];
    const text = typeof raw === 'string' ? raw.trim() : raw;
    const empty = text === undefined || text === null || text === '';
    if (empty) {
      if (field.required) return { ok: false, error: 'FIELD_VALUE_REQUIRED', field: field.key, label: field.label };
      properties[field.key] = null;
      continue;
    }
    if (field.type === 'text') {
      if (typeof text !== 'string' || text.length > 2000) return { ok: false, error: 'FIELD_VALUE_INVALID', field: field.key, label: field.label };
      properties[field.key] = text;
    } else if (field.type === 'number') {
      const number = typeof text === 'number' ? text : Number(text);
      if (!Number.isFinite(number) || Math.abs(number) > 1e12) return { ok: false, error: 'FIELD_VALUE_INVALID', field: field.key, label: field.label };
      properties[field.key] = number;
    } else if (field.type === 'date') {
      const date = String(text);
      if (!validDate(date)) return { ok: false, error: 'FIELD_VALUE_INVALID', field: field.key, label: field.label };
      properties[field.key] = date;
    } else if (field.type === 'boolean') {
      if (typeof text === 'boolean') properties[field.key] = text;
      else if (text === 'true' || text === '1' || text === 'on') properties[field.key] = true;
      else if (text === 'false' || text === '0' || text === 'off') properties[field.key] = false;
      else return { ok: false, error: 'FIELD_VALUE_INVALID', field: field.key, label: field.label };
    } else if (field.type === 'select') {
      if (typeof text !== 'string' || !field.options.includes(text)) return { ok: false, error: 'FIELD_VALUE_INVALID', field: field.key, label: field.label };
      properties[field.key] = text;
    }
  }
  return { ok: true, properties };
}

export function escapeCsvCell(value, { spreadsheetSafe = true } = {}) {
  const isText = typeof value === 'string';
  let text;
  if (value === null || value === undefined) text = '';
  else if (typeof value === 'object') text = JSON.stringify(value);
  else text = String(value);
  if (spreadsheetSafe && isText && /^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function coordinateText(position) {
  return position.map(value => Number(value).toString()).join(' ');
}

export function geometryToWkt(geometry) {
  if (!geometry || typeof geometry !== 'object') return '';
  const positions = [];
  const collect = value => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') positions.push(value);
    else value.forEach(collect);
  };
  if (geometry.type === 'GeometryCollection') geometry.geometries?.forEach(child => collect(child.coordinates));
  else collect(geometry.coordinates);
  const hasZ = positions.length > 0 && positions.every(position => position.length >= 3 && Number.isFinite(Number(position[2])));
  const point = position => coordinateText(hasZ ? position.slice(0, 3) : position.slice(0, 2));
  const line = coordinates => `(${coordinates.map(point).join(', ')})`;
  const polygon = rings => `(${rings.map(line).join(', ')})`;
  const suffix = hasZ ? ' Z' : '';
  switch (geometry.type) {
    case 'Point': return `POINT${suffix} (${point(geometry.coordinates)})`;
    case 'MultiPoint': return `MULTIPOINT${suffix} (${geometry.coordinates.map(value => `(${point(value)})`).join(', ')})`;
    case 'LineString': return `LINESTRING${suffix} ${line(geometry.coordinates)}`;
    case 'MultiLineString': return `MULTILINESTRING${suffix} (${geometry.coordinates.map(line).join(', ')})`;
    case 'Polygon': return `POLYGON${suffix} ${polygon(geometry.coordinates)}`;
    case 'MultiPolygon': return `MULTIPOLYGON${suffix} (${geometry.coordinates.map(polygon).join(', ')})`;
    case 'GeometryCollection': return `GEOMETRYCOLLECTION (${(geometry.geometries || []).map(geometryToWkt).join(', ')})`;
    default: return '';
  }
}

export function exportVisibleCsv(layers, { now = new Date(), spreadsheetSafe = true } = {}) {
  const visible = (layers || []).filter(layer => layer.visible !== false && layer.kind !== 'raster');
  const fields = [...new Set(visible.flatMap(layer => (layer.geojson?.features || []).flatMap(feature => Object.keys(feature.properties || {}))))];
  const exportedAt = now.toISOString();
  const columns = ['layer', 'source', 'exported_at', 'feature_id', 'geometry_type', 'wkt', ...fields];
  const rows = [columns.map(value => escapeCsvCell(value, { spreadsheetSafe: false })).join(',')];
  for (const layer of visible) {
    for (const feature of layer.geojson?.features || []) {
      const values = [layer.name || '', layer.source || '', exportedAt, feature.id ?? feature.properties?.id ?? '', feature.geometry?.type || '', geometryToWkt(feature.geometry)];
      for (const field of fields) values.push(feature.properties?.[field] ?? '');
      rows.push(values.map(value => escapeCsvCell(value, { spreadsheetSafe })).join(','));
    }
  }
  return `\uFEFF${rows.join('\r\n')}\r\n`;
}
