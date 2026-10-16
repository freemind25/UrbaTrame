/* Shared, dependency-free helpers for OpenBuildingMap's public vector tiles.
   This module is used by the browser's local workload preview and by the
   server-side tile reader. It contains no copied provider code or assets. */

export const OBM_TILE_ROOT = 'https://vectortiles.openbuildingmap.org';
export const OBM_SOURCE_URL = 'https://www.openbuildingmap.org/';
export const OBM_DATA_URL = 'https://doi.org/10.5880/GFZ.LKUT.2025.002';
export const OBM_ATTRIBUTION = 'OpenBuildingMap · GFZ Data Services · © OpenStreetMap contributors · ODbL 1.0';
export const OBM_DEFAULT_ZOOM = 14;
export const OBM_MIN_ZOOM = 12;
export const OBM_MAX_TILES = 16;
export const OBM_MAX_RETURNED_FEATURES = 6000;
export const OBM_MAX_RETURNED_VERTICES = 40000;
export const OBM_MAX_TILE_BYTES = 512 * 1024;

export const OBM_CATEGORIES = [
  { key: 'RES', fr: 'Résidentiel', en: 'Residential', shortFr: 'RES', shortEn: 'RES', color: '#C85D50' },
  { key: 'COM', fr: 'Commerce et services', en: 'Commercial and services', shortFr: 'COM', shortEn: 'COM', color: '#E0A43B' },
  { key: 'MIX', fr: 'Usage mixte', en: 'Mixed use', shortFr: 'MIX', shortEn: 'MIX', color: '#9A69B5' },
  { key: 'IND', fr: 'Industrie', en: 'Industrial', shortFr: 'IND', shortEn: 'IND', color: '#54769D' },
  { key: 'AGR', fr: 'Agriculture', en: 'Agricultural', shortFr: 'AGR', shortEn: 'AGR', color: '#68A66D' },
  { key: 'CIV', fr: 'Éducation, gouvernement et assemblée', en: 'Education, government and assembly', shortFr: 'CIV', shortEn: 'CIV', color: '#35A19A' },
  { key: 'OTHER', fr: 'Autre / non classé', en: 'Other / unclassified', shortFr: 'AUT', shortEn: 'OTH', color: '#8B8B87' },
  { key: 'UNK', fr: 'Occupation non renseignée', en: 'Occupancy unknown', shortFr: 'UNK', shortEn: 'UNK', color: '#C8C8C3' }
];

const CATEGORY_KEYS = new Set(OBM_CATEGORIES.map(item => item.key));
const CIVIC_PREFIXES = new Set(['EDU', 'GOV', 'ASS']);
const OTHER_PREFIXES = new Set(['OCO', 'OTH', 'OTHER']);
const UNKNOWN_CODES = new Set(['', 'UNK', 'UNKNOWN', 'NULL', 'N/A', 'NONE', 'OC99']);

export function obmCategory(code) {
  const value = String(code ?? '').trim().toUpperCase();
  if (UNKNOWN_CODES.has(value)) return 'UNK';
  const prefix = value.match(/^[A-Z]+/)?.[0] || '';
  if (CIVIC_PREFIXES.has(prefix)) return 'CIV';
  if (OTHER_PREFIXES.has(prefix)) return 'OTHER';
  return CATEGORY_KEYS.has(prefix) ? prefix : 'UNK';
}

export function obmCategoryInfo(key) {
  return OBM_CATEGORIES.find(item => item.key === key) || OBM_CATEGORIES.find(item => item.key === 'OTHER');
}

export function obmCategoryLabel(key, lang = 'fr', short = false) {
  const item = obmCategoryInfo(key);
  return short ? item[lang === 'en' ? 'shortEn' : 'shortFr'] : item[lang === 'en' ? 'en' : 'fr'];
}

function safeInteger(value) {
  if (typeof value === 'bigint') {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER))
      return value.toString();
    return Number(value);
  }
  return value;
}

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const lonToX = (lon, z) => (lon + 180) / 360 * (2 ** z);
const MAX_MERCATOR_LAT = 85.0511287798066;
const latToY = (lat, z) => {
  const rad = clamp(lat, -MAX_MERCATOR_LAT, MAX_MERCATOR_LAT) * Math.PI / 180;
  return (1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2 * (2 ** z);
};

function tileRange(lat, lon, radius, z) {
  const n = 2 ** z;
  const dy = radius / 111320;
  const dx = radius / (111320 * Math.cos(lat * Math.PI / 180));
  const minLon = clamp(lon - dx, -180, 180);
  const maxLon = clamp(lon + dx, -180, 180);
  const minLat = clamp(lat - dy, -MAX_MERCATOR_LAT, MAX_MERCATOR_LAT);
  const maxLat = clamp(lat + dy, -MAX_MERCATOR_LAT, MAX_MERCATOR_LAT);
  const x0 = clamp(Math.floor(lonToX(minLon, z)), 0, n - 1);
  const x1 = clamp(Math.floor(lonToX(maxLon, z)), 0, n - 1);
  const y0 = clamp(Math.floor(latToY(maxLat, z)), 0, n - 1);
  const y1 = clamp(Math.floor(latToY(minLat, z)), 0, n - 1);
  const tiles = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tiles.push({ z, x, y });
  return { z, x0, x1, y0, y1, tiles };
}

/** Selects the highest-resolution zoom whose extent is at most maxTiles wide. */
export function getObmTilePlan(lat, lon, radius, {
  zoom = OBM_DEFAULT_ZOOM,
  minZoom = OBM_MIN_ZOOM,
  maxTiles = OBM_MAX_TILES
} = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(radius) ||
      Math.abs(lat) > 85 || Math.abs(lon) > 180 || radius < 1 ||
      !Number.isInteger(zoom) || !Number.isInteger(minZoom) || minZoom > zoom ||
      !Number.isInteger(maxTiles) || maxTiles < 1)
    throw new Error('INVALID_LOCATION');
  const dy = radius / 111320;
  const dx = radius / (111320 * Math.cos(lat * Math.PI / 180));
  if (lon - dx < -180 || lon + dx > 180) throw new Error('SITE_CROSSES_DATELINE');

  let chosen;
  for (let z = zoom; z >= minZoom; z--) {
    chosen = tileRange(lat, lon, radius, z);
    if (chosen.tiles.length <= maxTiles) break;
  }
  if (!chosen || chosen.tiles.length > maxTiles) throw new Error('OBM_TILE_LIMIT');
  return { ...chosen, maxTiles, requestedZoom: zoom };
}

export function obmTileUrl({ z, x, y }, layer = 'occupancy') {
  if (!['occupancy', 'completeness'].includes(layer)) throw new Error('INVALID_OBM_LAYER');
  return `${OBM_TILE_ROOT}/${layer}/${z}/${x}/${y}.pbf`;
}

/** Decodes a tile-local MVT coordinate into [latitude, longitude]. */
export function tilePointToLonLat({ z, x, y }, point, extent = 4096) {
  const n = 2 ** z;
  const worldX = (x + point[0] / extent) / n;
  const worldY = (y + point[1] / extent) / n;
  const lon = worldX * 360 - 180;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * worldY))) * 180 / Math.PI;
  return [lat, lon];
}

function readVarint(bytes, cursor) {
  let value = 0n;
  let shift = 0n;
  for (let i = 0; i < 10; i++) {
    if (cursor.pos >= bytes.length) throw new Error('INVALID_MVT');
    const byte = bytes[cursor.pos++];
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return safeInteger(value);
    shift += 7n;
  }
  throw new Error('INVALID_MVT');
}

function asNumber(value) {
  if (typeof value === 'bigint') {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER))
      throw new Error('INVALID_MVT');
    return Number(value);
  }
  if (!Number.isFinite(value)) throw new Error('INVALID_MVT');
  return value;
}

function readFields(bytes) {
  const cursor = { pos: 0 };
  const fields = [];
  while (cursor.pos < bytes.length) {
    const key = asNumber(readVarint(bytes, cursor));
    if (!key) throw new Error('INVALID_MVT');
    const number = Math.floor(key / 8), wire = key & 7;
    if (number < 1) throw new Error('INVALID_MVT');
    if (wire === 0) {
      fields.push({ number, wire, value: readVarint(bytes, cursor) });
    } else if (wire === 1) {
      if (cursor.pos + 8 > bytes.length) throw new Error('INVALID_MVT');
      fields.push({ number, wire, value: bytes.subarray(cursor.pos, cursor.pos + 8) });
      cursor.pos += 8;
    } else if (wire === 2) {
      const length = asNumber(readVarint(bytes, cursor));
      if (!Number.isSafeInteger(length) || length < 0 || cursor.pos + length > bytes.length)
        throw new Error('INVALID_MVT');
      fields.push({ number, wire, value: bytes.subarray(cursor.pos, cursor.pos + length) });
      cursor.pos += length;
    } else if (wire === 5) {
      if (cursor.pos + 4 > bytes.length) throw new Error('INVALID_MVT');
      fields.push({ number, wire, value: bytes.subarray(cursor.pos, cursor.pos + 4) });
      cursor.pos += 4;
    } else {
      throw new Error('INVALID_MVT');
    }
  }
  return fields;
}

function packedVarints(bytes) {
  const cursor = { pos: 0 }, out = [];
  while (cursor.pos < bytes.length) out.push(readVarint(bytes, cursor));
  return out;
}

function decodeValue(bytes) {
  for (const field of readFields(bytes)) {
    if (field.number === 1 && field.wire === 2) return new TextDecoder().decode(field.value);
    if (field.number === 2 && field.wire === 5)
      return new DataView(field.value.buffer, field.value.byteOffset, 4).getFloat32(0, true);
    if (field.number === 3 && field.wire === 1)
      return new DataView(field.value.buffer, field.value.byteOffset, 8).getFloat64(0, true);
    if (field.number === 4 && field.wire === 0) return safeInteger(field.value);
    if (field.number === 5 && field.wire === 0) return safeInteger(field.value);
    if (field.number === 6 && field.wire === 0) {
      const n = asNumber(field.value);
      return (n >>> 1) ^ -(n & 1);
    }
    if (field.number === 7 && field.wire === 0) return !!field.value;
  }
  return null;
}

function decodeGeometry(commands, type) {
  const rings = [];
  const paths = [];
  let current = null, x = 0, y = 0, i = 0;
  while (i < commands.length) {
    const command = asNumber(commands[i++]);
    const id = command & 7;
    const count = Math.floor(command / 8);
    if (!count) throw new Error('INVALID_MVT');
    if (id === 1 || id === 2) {
      for (let n = 0; n < count; n++) {
        if (i + 1 >= commands.length) throw new Error('INVALID_MVT');
        const dx = asNumber(commands[i++]), dy = asNumber(commands[i++]);
        x += (dx >>> 1) ^ -(dx & 1);
        y += (dy >>> 1) ^ -(dy & 1);
        if (id === 1) {
          current = [];
          if (type === 3) rings.push(current); else paths.push(current);
        }
        if (!current) throw new Error('INVALID_MVT');
        current.push([x, y]);
      }
    } else if (id === 7) {
      if (type !== 3 || !current) throw new Error('INVALID_MVT');
      for (let n = 0; n < count; n++) {
        if (current.length < 3) throw new Error('INVALID_MVT');
        current = null;
      }
    } else {
      throw new Error('INVALID_MVT');
    }
  }
  return type === 3 ? rings : paths;
}

function decodeFeature(bytes, keys, values) {
  let id = null, type = 0, tags = [], commands = [];
  for (const field of readFields(bytes)) {
    if (field.number === 1 && field.wire === 0) id = safeInteger(field.value);
    else if (field.number === 2 && field.wire === 2) tags = packedVarints(field.value);
    else if (field.number === 2 && field.wire === 0) tags.push(field.value);
    else if (field.number === 3 && field.wire === 0) type = asNumber(field.value);
    else if (field.number === 4 && field.wire === 2) commands = packedVarints(field.value);
  }
  const properties = {};
  for (let i = 0; i + 1 < tags.length; i += 2) {
    const key = keys[asNumber(tags[i])];
    const value = values[asNumber(tags[i + 1])];
    if (typeof key === 'string' && value !== undefined) properties[key] = value;
  }
  return { id, type, properties, geometry: decodeGeometry(commands, type) };
}

function decodeLayer(bytes) {
  let name = '', extent = 4096;
  const featureMessages = [], keys = [], values = [];
  for (const field of readFields(bytes)) {
    if (field.number === 1 && field.wire === 2) name = new TextDecoder().decode(field.value);
    else if (field.number === 2 && field.wire === 2) featureMessages.push(field.value);
    else if (field.number === 3 && field.wire === 2) keys.push(new TextDecoder().decode(field.value));
    else if (field.number === 4 && field.wire === 2) values.push(decodeValue(field.value));
    else if (field.number === 5 && field.wire === 0) extent = asNumber(field.value);
  }
  if (!name || !Number.isSafeInteger(extent) || extent < 1) throw new Error('INVALID_MVT');
  return { name, extent, features: featureMessages.map(message => decodeFeature(message, keys, values)) };
}

/** Minimal Mapbox Vector Tile (MVT) protobuf decoder for public vector-tile data. */
export function decodeMvt(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || 0);
  if (!bytes.length) return [];
  const layers = [];
  for (const field of readFields(bytes)) {
    if (field.number === 3 && field.wire === 2) layers.push(decodeLayer(field.value));
  }
  return layers;
}
