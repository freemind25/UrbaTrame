/* Local vector-data helpers for UrbaTrame's integrated cartography workshop.
   Phase 1 is deliberately browser-only: GeoJSON (RFC 7946 / WGS 84) and CSV
   point layers with explicitly selected longitude/latitude columns. No fetch,
   server upload, reprojection or geometry is silently invented here. */

export const MAX_IMPORT_BYTES = 15 * 1024 * 1024;
export const MAX_FEATURES = 20_000;
export const MAX_CSV_ROWS = 20_000;
export const MAX_COORDINATE_POSITIONS = 100_000;
export const MAX_LAYERS = 12;
export const MAX_TOTAL_FEATURES = 60_000;
export const MAX_TOTAL_POSITIONS = 300_000;

const GEOMETRY_TYPES = new Set([
  'Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon',
  'MultiPolygon', 'GeometryCollection'
]);

function fail(code, detail = '') {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  throw error;
}

export function normalizeCrs(value) {
  const raw = String(value || '').trim();
  if (!raw || /CRS\s*:?\s*84|WGS\s*[-_]?\s*84/i.test(raw) && !/3857/.test(raw)) return 'EPSG:4326';
  const direct = raw.match(/(?:EPSG\s*[:/]{1,2}\s*|EPSG\D+)(\d{4,5})/i) || raw.match(/(?:AUTHORITY|ID)\s*\[\s*["']EPSG["']\s*,\s*["']?(\d{4,5})/i);
  const code = direct ? Number(direct[1]) : (/^\d{4,5}$/.test(raw) ? Number(raw) : NaN);
  if (code === 4326 || code === 3857 || code >= 32601 && code <= 32660 || code >= 32701 && code <= 32760)
    return `EPSG:${code}`;
  fail('UNSUPPORTED_CRS', raw || 'unknown');
}

function sourceCrs(root) {
  if (!root?.crs) return 'EPSG:4326';
  const crs = root.crs;
  if (typeof crs === 'string') return normalizeCrs(crs);
  return normalizeCrs(crs?.properties?.name || crs?.properties?.href || crs?.name || '');
}

export function toWgs84(x, y, source = 'EPSG:4326') {
  const crs = normalizeCrs(source);
  if (!Number.isFinite(x) || !Number.isFinite(y)) fail('INVALID_COORDINATES');
  if (crs === 'EPSG:4326') {
    if (x < -180 || x > 180 || y < -90 || y > 90) fail('COORDINATE_OUT_OF_RANGE');
    return [x, y];
  }
  if (crs === 'EPSG:3857') {
    const radius = 6378137;
    if (Math.abs(x) > Math.PI * radius + 1 || Math.abs(y) > Math.PI * radius + 1) fail('COORDINATE_OUT_OF_RANGE');
    const lon = x / radius * 180 / Math.PI;
    const lat = (2 * Math.atan(Math.exp(y / radius)) - Math.PI / 2) * 180 / Math.PI;
    return [lon, lat];
  }
  const code = Number(crs.slice(5));
  const zone = code % 100;
  if (zone < 1 || zone > 60) fail('UNSUPPORTED_CRS', crs);
  const southern = code >= 32700;
  return inverseUtm(x, y, zone, southern);
}

function inverseUtm(easting, northing, zone, southern = false) {
  const a = 6378137, f = 1 / 298.257223563;
  const e2 = f * (2 - f), ep2 = e2 / (1 - e2), k0 = 0.9996;
  if (easting < 100_000 || easting > 900_000 || northing < 0 || northing > 10_000_000)
    fail('COORDINATE_OUT_OF_RANGE');
  const x = easting - 500_000;
  const y = northing - (southern ? 10_000_000 : 0);
  const m = y / k0;
  const mu = m / (a * (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const j1 = 3 * e1 / 2 - 27 * e1 ** 3 / 32;
  const j2 = 21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32;
  const j3 = 151 * e1 ** 3 / 96;
  const j4 = 1097 * e1 ** 4 / 512;
  const fp = mu + j1 * Math.sin(2 * mu) + j2 * Math.sin(4 * mu) + j3 * Math.sin(6 * mu) + j4 * Math.sin(8 * mu);
  const sin = Math.sin(fp), cos = Math.cos(fp), tan = Math.tan(fp);
  const c1 = ep2 * cos ** 2, t1 = tan ** 2;
  const n1 = a / Math.sqrt(1 - e2 * sin ** 2);
  const r1 = a * (1 - e2) / (1 - e2 * sin ** 2) ** 1.5;
  const d = x / (n1 * k0);
  const lat = fp - n1 * tan / r1 * (d ** 2 / 2 - (5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * ep2) * d ** 4 / 24
    + (61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * ep2 - 3 * c1 ** 2) * d ** 6 / 720);
  const lon0 = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180;
  const lon = lon0 + (d - (1 + 2 * t1 + c1) * d ** 3 / 6
    + (5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * ep2 + 24 * t1 ** 2) * d ** 5 / 120) / cos;
  const result = [lon * 180 / Math.PI, lat * 180 / Math.PI];
  if (result[1] < (southern ? -80 : 0) - 0.5 || result[1] > (southern ? 0 : 84) + 0.5) fail('COORDINATE_OUT_OF_RANGE');
  return result;
}

function transformCoordinateTree(value, crs, index) {
  if (!Array.isArray(value)) fail('INVALID_COORDINATES', String(index));
  if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
    const [lon, lat] = toWgs84(value[0], value[1], crs);
    return [lon, lat, ...value.slice(2)];
  }
  return value.map(child => transformCoordinateTree(child, crs, index));
}

function transformGeometry(geometry, crs, index) {
  if (!geometry || crs === 'EPSG:4326') return geometry;
  if (geometry.type === 'GeometryCollection')
    return { ...geometry, geometries: geometry.geometries.map((child, i) => transformGeometry(child, crs, `${index}.${i}`)) };
  return { ...geometry, coordinates: transformCoordinateTree(geometry.coordinates, crs, index) };
}

function visitPositions(value, callback, index) {
  if (!Array.isArray(value)) fail('INVALID_COORDINATES', String(index));
  if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
    const [lon, lat] = value;
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90)
      fail('COORDINATE_OUT_OF_RANGE', String(index));
    callback(value);
    return;
  }
  for (const child of value) visitPositions(child, callback, index);
}

function validatePosition(position, index) {
  if (!Array.isArray(position) || position.length < 2 || typeof position[0] !== 'number' || typeof position[1] !== 'number')
    fail('INVALID_COORDINATES', String(index));
  const [lon, lat] = position;
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90)
    fail('COORDINATE_OUT_OF_RANGE', String(index));
  return 1;
}

function validateLine(line, index, minimum = 2) {
  if (!Array.isArray(line) || line.length < minimum) fail('INVALID_COORDINATES', String(index));
  return line.reduce((sum, position) => sum + validatePosition(position, index), 0);
}

function validatePolygon(rings, index) {
  if (!Array.isArray(rings) || !rings.length) fail('EMPTY_GEOMETRY', String(index));
  return rings.reduce((sum, ring) => sum + validateLine(ring, index, 3), 0);
}

function validateGeometry(geometry, index) {
  if (geometry === null) return 0;
  if (!geometry || !GEOMETRY_TYPES.has(geometry.type))
    fail('UNSUPPORTED_GEOMETRY', `${index}:${geometry?.type || 'unknown'}`);
  if (geometry.type === 'GeometryCollection') {
    if (!Array.isArray(geometry.geometries)) fail('INVALID_GEOMETRY', String(index));
    return geometry.geometries.reduce((sum, child, i) => {
      if (child === null) fail('INVALID_GEOMETRY', `${index}.${i}`);
      return sum + validateGeometry(child, `${index}.${i}`);
    }, 0);
  }
  const coordinates = geometry.coordinates;
  let count = 0;
  switch (geometry.type) {
    case 'Point': count = validatePosition(coordinates, index); break;
    case 'MultiPoint':
      if (!Array.isArray(coordinates)) fail('INVALID_COORDINATES', String(index));
      count = coordinates.reduce((sum, position) => sum + validatePosition(position, index), 0);
      break;
    case 'LineString': count = validateLine(coordinates, index); break;
    case 'MultiLineString':
      if (!Array.isArray(coordinates)) fail('INVALID_COORDINATES', String(index));
      count = coordinates.reduce((sum, line) => sum + validateLine(line, index), 0);
      break;
    case 'Polygon': count = validatePolygon(coordinates, index); break;
    case 'MultiPolygon':
      if (!Array.isArray(coordinates)) fail('INVALID_COORDINATES', String(index));
      count = coordinates.reduce((sum, polygon) => sum + validatePolygon(polygon, index), 0);
      break;
  }
  if (!count) fail('EMPTY_GEOMETRY', String(index));
  return count;
}

function asFeatureCollection(root, fileName) {
  if (root?.type === 'FeatureCollection' && Array.isArray(root.features))
    return { name: root.name || fileName, features: root.features };
  if (root?.type === 'Feature') return { name: root.name || fileName, features: [root] };
  if (GEOMETRY_TYPES.has(root?.type))
    return { name: fileName, features: [{ type: 'Feature', properties: {}, geometry: root }] };
  fail('NOT_GEOJSON');
}

function copyBoundedMetadata(value, maximumChars) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length > maximumChars) return null;
    const copy = JSON.parse(serialized);
    return copy && typeof copy === 'object' && !Array.isArray(copy) ? copy : null;
  } catch { return null; }
}

export function parseGeoJSONText(text, { fileName = 'couche.geojson', maxFeatures = MAX_FEATURES } = {}) {
  if (typeof text !== 'string') fail('EMPTY_FILE');
  if (text.length > MAX_IMPORT_BYTES) fail('FILE_TOO_LARGE');
  if (!text.trim()) fail('EMPTY_FILE');
  let root;
  try { root = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { fail('INVALID_JSON'); }
  const inputCrs = sourceCrs(root);
  const collection = asFeatureCollection(root, fileName);
  if (collection.features.length > maxFeatures) fail('TOO_MANY_FEATURES');
  let totalPositions = 0;
  const features = collection.features.map((feature, index) => {
    if (!feature || feature.type !== 'Feature') fail('INVALID_FEATURE', String(index + 1));
    if (feature.properties === undefined) feature.properties = {};
    if (feature.properties !== null && (typeof feature.properties !== 'object' || Array.isArray(feature.properties)))
      fail('INVALID_PROPERTIES', String(index + 1));
    feature.geometry = transformGeometry(feature.geometry, inputCrs, index + 1);
    totalPositions += validateGeometry(feature.geometry, index + 1) || 0;
    if (totalPositions > MAX_COORDINATE_POSITIONS) fail('TOO_MANY_COORDINATES');
    return feature;
  });
  const output = { type: 'FeatureCollection', name: String(collection.name || fileName), crs: 'EPSG:4326', sourceCrs: inputCrs, features };
  if (Number.isSafeInteger(root?.remotePages) && root.remotePages >= 1 && root.remotePages <= 100) output.remotePages = root.remotePages;
  if (typeof root?.remoteTruncated === 'boolean') output.remoteTruncated = root.remoteTruncated;
  if (root?.remoteTruncated === true && ['FEATURE_LIMIT', 'PAGE_LIMIT'].includes(root.remoteTruncationReason)) output.remoteTruncationReason = root.remoteTruncationReason;
  for (const [key, maximum] of [['urbatrameDerivation', 16_000], ['urbatrameAi', 16_000], ['urbatrame', 64_000]]) {
    const metadata = copyBoundedMetadata(root?.[key], maximum);
    if (metadata) output[key] = metadata;
  }
  return output;
}

function countDelimiters(line) {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (!quoted && Object.hasOwn(counts, ch)) counts[ch]++;
  }
  return counts;
}

function chooseDelimiter(text) {
  const first = text.split(/\r?\n/, 1)[0] || '';
  const counts = countDelimiters(first);
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[1] > 0
    ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
    : ',';
}

function parseRows(text, delimiter) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
      continue;
    }
    if (ch === '"' && field === '') { quoted = true; continue; }
    if (ch === delimiter) { row.push(field); field = ''; continue; }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(value => String(value).trim() !== '')) rows.push(row);
      row = [];
      continue;
    }
    field += ch;
  }
  if (quoted) fail('CSV_UNCLOSED_QUOTE');
  row.push(field);
  if (row.some(value => String(value).trim() !== '')) rows.push(row);
  return rows;
}

export function parseDelimitedText(text, { maxRows = MAX_CSV_ROWS } = {}) {
  if (typeof text !== 'string') fail('EMPTY_FILE');
  if (text.length > MAX_IMPORT_BYTES) fail('FILE_TOO_LARGE');
  if (!text.trim()) fail('EMPTY_FILE');
  const delimiter = chooseDelimiter(text.replace(/^\uFEFF/, ''));
  const rows = parseRows(text.replace(/^\uFEFF/, ''), delimiter);
  if (rows.length < 2) fail('CSV_NEEDS_HEADER_AND_ROWS');
  const rawHeaders = rows.shift().map(value => String(value).trim());
  const seen = new Map();
  const headers = rawHeaders.map((header, index) => {
    const base = header || `field_${index + 1}`;
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}_${count}`;
  });
  const sourceRows = rows.filter(row => row.some(value => String(value).trim() !== ''));
  if (sourceRows.length > maxRows) fail('TOO_MANY_FEATURES');
  const records = sourceRows.map((row, index) => {
    if (row.length > headers.length && row.slice(headers.length).some(value => String(value).trim() !== ''))
      fail('CSV_COLUMN_COUNT_MISMATCH', String(index + 2));
    return Object.fromEntries(headers.map((header, column) => [header, String(row[column] ?? '').trim()]));
  });
  return { headers, rows: records, delimiter };
}

function normalizedHeader(header) {
  return String(header).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[\s_-]+/g, '');
}

export function detectCoordinateFields(headers) {
  const names = headers.map(normalizedHeader);
  const find = aliases => {
    const index = names.findIndex(name => aliases.includes(name));
    return index < 0 ? '' : headers[index];
  };
  return {
    longitude: find(['longitude', 'lon', 'lng', 'long', 'x']),
    latitude: find(['latitude', 'lat', 'y'])
  };
}

function parseCoordinate(value, axis, rowNumber) {
  let raw = String(value ?? '').trim();
  if (/^[-+]?\d+,\d+(?:e[-+]?\d+)?$/i.test(raw)) raw = raw.replace(',', '.');
  const number = Number(raw);
  if (!raw || !Number.isFinite(number)) fail('CSV_COORDINATE_INVALID', `${axis}:row ${rowNumber}`);
  return number;
}

export function csvToGeoJSON(table, { longitude, latitude, fileName = 'couche.csv', sourceCrs: crsInput = 'EPSG:4326' } = {}) {
  if (!table || !Array.isArray(table.headers) || !Array.isArray(table.rows)) fail('INVALID_CSV_TABLE');
  if (!longitude || !latitude || longitude === latitude ||
      !table.headers.includes(longitude) || !table.headers.includes(latitude)) fail('CSV_COORD_FIELDS_REQUIRED');
  if (table.rows.length > MAX_CSV_ROWS) fail('TOO_MANY_FEATURES');
  const source = normalizeCrs(crsInput);
  const features = table.rows.map((row, index) => {
    const rowNumber = index + 2;
    const x = parseCoordinate(row[longitude], 'X/longitude', rowNumber);
    const y = parseCoordinate(row[latitude], 'Y/latitude', rowNumber);
    let coordinates;
    try { coordinates = toWgs84(x, y, source); }
    catch { fail('CSV_COORDINATE_INVALID', `source ${source}:row ${rowNumber}`); }
    return {
      type: 'Feature',
      id: row.id || index + 1,
      properties: { ...row },
      geometry: { type: 'Point', coordinates }
    };
  });
  return { type: 'FeatureCollection', name: fileName, crs: 'EPSG:4326', sourceCrs: source, features };
}

function countCoordinateTree(value) {
  if (!Array.isArray(value)) return 0;
  if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') return 1;
  return value.reduce((sum, child) => sum + countCoordinateTree(child), 0);
}
export function countFeaturePositions(features) {
  const countGeometry = geometry => !geometry ? 0 : geometry.type === 'GeometryCollection'
    ? (geometry.geometries || []).reduce((sum, child) => sum + countGeometry(child), 0)
    : countCoordinateTree(geometry.coordinates);
  return (features || []).reduce((sum, feature) => sum + countGeometry(feature?.geometry), 0);
}

export function positionsInGeometry(geometry, out = []) {
  if (!geometry) return out;
  if (geometry.type === 'GeometryCollection') {
    for (const child of geometry.geometries || []) positionsInGeometry(child, out);
    return out;
  }
  visitPositions(geometry.coordinates || [], position => out.push(position), 0);
  return out;
}

export function extentOfFeatures(features) {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const feature of features || []) {
    for (const [lon, lat] of positionsInGeometry(feature?.geometry)) {
      west = Math.min(west, lon); east = Math.max(east, lon);
      south = Math.min(south, lat); north = Math.max(north, lat);
    }
  }
  return Number.isFinite(west) ? { west, south, east, north } : null;
}

export function exportVisibleGeoJSON(layers, { now = new Date() } = {}) {
  const visible = (layers || []).filter(layer => layer.visible !== false);
  return {
    type: 'FeatureCollection',
    name: 'UrbaTrame',
    features: visible.flatMap(layer => layer.geojson.features),
    urbatrame: {
      exportedAt: now.toISOString(),
      coordinateSystem: 'EPSG:4326 (WGS 84 longitude, latitude)',
      sources: visible.map(layer => ({
        name: layer.name,
        fileName: layer.fileName || layer.name,
        source: layer.source,
        crs: layer.crs || 'EPSG:4326',
        sourceCrs: layer.sourceCrs || layer.geojson.sourceCrs || 'EPSG:4326',
        importedAt: layer.importedAt,
        ...(layer.lastEditedAt ? { lastEditedAt: layer.lastEditedAt } : {}),
        featureCount: layer.geojson.features.length,
        ...(Number.isSafeInteger(layer.geojson.remotePages) ? { remoteImport: {
          pages: layer.geojson.remotePages, truncated: layer.geojson.remoteTruncated === true,
          ...(layer.geojson.remoteTruncationReason ? { limit: layer.geojson.remoteTruncationReason } : {})
        } } : {}),
        ...(layer.geojson.urbatrameDerivation ? { derivation: layer.geojson.urbatrameDerivation } : {}),
        ...(layer.geojson.urbatrameAi ? { aiAssistance: layer.geojson.urbatrameAi } : {})
      }))
    }
  };
}


/* ─────────── phase C : références DXF / OBJ / GLB (sous-couches) ───────────
   Lecture locale de fichiers vectoriels ou de maillage, référencement manuel
   (CRS source, échelle, rotation, décalage est/nord en mètres du CRS source),
   puis conversion en WGS 84. L'empreinte du maillage est affichée ; le maillage
   brut reste dans les propriétés de la couche. Aucune donnée n'est envoyée. */

/* Applique échelle + rotation autour du centroïde, puis décalage est/nord.
   pts : [[x, y], ...] en unités du CRS source. */
export function transformXY(pts, { scale = 1, rotationDeg = 0, offsetEN = [0, 0] } = {}) {
  if (!Array.isArray(pts) || !pts.length) return [];
  const k = Number(scale) > 0 ? Number(scale) : 1;
  const th = (Number(rotationDeg) || 0) * Math.PI / 180;
  const cos = Math.cos(th), sin = Math.sin(th);
  const ox = Array.isArray(offsetEN) ? Number(offsetEN[0]) || 0 : 0;
  const oy = Array.isArray(offsetEN) ? Number(offsetEN[1]) || 0 : 0;
  let cx = 0, cy = 0;
  for (const p of pts) { cx += Number(p[0]); cy += Number(p[1]); }
  cx /= pts.length; cy /= pts.length;
  return pts.map(p => {
    const dx = (Number(p[0]) - cx) * k, dy = (Number(p[1]) - cy) * k;
    return [cx + dx * cos - dy * sin + ox, cy + dx * sin + dy * cos + oy];
  });
}

/* Enveloppe convexe 2D (chaîne monotone), sans point de fermeture répété. */
export function convexHull2D(pts) {
  const p = (Array.isArray(pts) ? pts : [])
    .filter(q => Array.isArray(q) && Number.isFinite(Number(q[0])) && Number.isFinite(Number(q[1])))
    .map(q => [Number(q[0]), Number(q[1])])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const bas = [], haut = [];
  for (const q of p) {
    while (bas.length >= 2 && cross(bas[bas.length - 2], bas[bas.length - 1], q) <= 0) bas.pop();
    bas.push(q);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (haut.length >= 2 && cross(haut[haut.length - 2], haut[haut.length - 1], q) <= 0) haut.pop();
    haut.push(q);
  }
  bas.pop(); haut.pop();
  return bas.concat(haut);
}

/* DXF ASCII (R12+) : lecture en flux de couples (code, valeur). Entités
   retenues : LINE, LWPOLYLINE (fermée ou non), POLYLINE + VERTEX/SEQEND, POINT.
   Chaque entité : { kind: 'line'|'poly'|'point', layer, pts?, ferme?, pos? }. */
export function parseDxfText(text, { fileName = 'reference.dxf' } = {}) {
  if (typeof text !== 'string' || !text.trim()) fail('EMPTY_FILE');
  if (text.length > MAX_IMPORT_BYTES) fail('FILE_TOO_LARGE');
  const lignes = text.split(/\r?\n/);
  const paires = [];
  for (let i = 0; i + 1 < lignes.length; i += 2) {
    const code = parseInt(lignes[i].trim(), 10);
    if (Number.isFinite(code)) paires.push([code, lignes[i + 1].trim()]);
  }
  const entities = [];
  let courant = null, groupes = [], polyOuvert = null;
  const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  const groupesDe = () => {
    const g = {};
    for (const [c, v] of groupes) {
      if (c === 8) g.layer = v;
      else if (c === 70) g.f70 = num(v);
      else if (c === 90) g.count = num(v);
      else if (c === 10 || c === 11) (g.x = g.x || []).push(num(v));
      else if (c === 20 || c === 21) (g.y = g.y || []).push(num(v));
    }
    return g;
  };
  const fermer = () => {
    if (!courant) return;
    const g = groupesDe();
    const layer = g.layer || '0';
    if (courant === 'LINE' && g.x?.length >= 2 && g.y?.length >= 2)
      entities.push({ kind: 'line', layer, pts: [[g.x[0], g.y[0]], [g.x[1], g.y[1]]] });
    else if (courant === 'LWPOLYLINE' && g.x?.length >= 2) {
      const pts = g.x.map((x, i) => [x, g.y[i] ?? 0]);
      const ferme = (g.f70 & 1) === 1;
      entities.push({ kind: ferme ? 'poly' : 'line', layer, pts, ferme });
    } else if (courant === 'POLYLINE') {
      polyOuvert = { kind: (g.f70 & 1) === 1 ? 'poly' : 'line', layer, pts: [], ferme: (g.f70 & 1) === 1 };
    } else if (courant === 'VERTEX' && polyOuvert && g.x?.length) {
      polyOuvert.pts.push([g.x[0], g.y[0] ?? 0]);
    } else if (courant === 'SEQEND' && polyOuvert) {
      if (polyOuvert.pts.length >= 2) entities.push(polyOuvert);
      polyOuvert = null;
    } else if (courant === 'POINT' && g.x?.length)
      entities.push({ kind: 'point', layer, pos: [g.x[0], g.y[0] ?? 0] });
    groupes = [];
  };
  for (const [code, valeur] of paires) {
    if (code === 0) { fermer(); courant = valeur; }
    else if (courant) groupes.push([code, valeur]);
  }
  fermer();
  if (polyOuvert && polyOuvert.pts.length >= 2) entities.push(polyOuvert);
  return { fileName, entities, layers: [...new Set(entities.map(e => e.layer))] };
}

/* DXF → GeoJSON WGS 84 : transformation (échelle/rotation/décalage) appliquée
   dans le CRS source, puis reprojection. LWPOLYLINE fermée → Polygon. */
export function dxfToGeoJSON(dxf, { sourceCrs = 'EPSG:4326', scale, rotationDeg, offsetEN } = {}) {
  const crs = normalizeCrs(sourceCrs);
  const tr = { scale, rotationDeg, offsetEN };
  const features = [];
  for (const e of dxf.entities || []) {
    if (e.kind === 'point') {
      const [x, y] = transformXY([e.pos], tr)[0];
      features.push({
        type: 'Feature',
        properties: { layer: e.layer, kind: 'point', source: 'dxf' },
        geometry: { type: 'Point', coordinates: toWgs84(x, y, crs) }
      });
    } else {
      const pts = transformXY(e.pts, tr).map(([x, y]) => toWgs84(x, y, crs));
      if (e.kind === 'poly' && e.ferme && pts.length >= 3) {
        const ring = pts.concat([pts[0]]);
        features.push({
          type: 'Feature',
          properties: { layer: e.layer, kind: 'poly', source: 'dxf' },
          geometry: { type: 'Polygon', coordinates: [ring] }
        });
      } else if (pts.length >= 2) {
        features.push({
          type: 'Feature',
          properties: { layer: e.layer, kind: 'line', source: 'dxf' },
          geometry: { type: 'LineString', coordinates: pts }
        });
      }
    }
  }
  return {
    type: 'FeatureCollection',
    name: dxf.fileName,
    sourceCrs: crs,
    features
  };
}

/* OBJ texte : sommets `v x y z` et faces `f i j k ...` (index 1, gérer i/j/k). */
export function parseObjText(text, { fileName = 'modele.obj' } = {}) {
  if (typeof text !== 'string' || !text.trim()) fail('EMPTY_FILE');
  if (text.length > MAX_IMPORT_BYTES) fail('FILE_TOO_LARGE');
  const vertices = [], faces = [];
  for (const ligne of text.split(/\r?\n/)) {
    const m = /^\s*(\S+)\s*(.*)$/.exec(ligne);
    if (!m) continue;
    const [, mot, reste] = m;
    if (mot === 'v') {
      const [x, y, z] = reste.trim().split(/\s+/).map(Number);
      if ([x, y, z].every(Number.isFinite)) vertices.push([x, y, z]);
    } else if (mot === 'f') {
      const idx = reste.trim().split(/\s+/)
        .map(t => parseInt(String(t).split('/')[0], 10) - 1)
        .filter(i => Number.isInteger(i) && i >= 0);
      if (idx.length >= 3) faces.push(idx);
    }
  }
  if (!vertices.length) fail('OBJ_NO_VERTICES');
  return { fileName, vertices, faces };
}

/* GLB (glTF binaire) : chunk JSON + chunk BIN, accessor POSITION float32/VEC3. */
export function parseGlb(u8) {
  if (!(u8 instanceof Uint8Array) || u8.length < 12) fail('INVALID_GLB');
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint32(0, true) !== 0x20544C46) fail('INVALID_GLB');           // 'glTF'
  const version = dv.getUint32(4, true);
  if (version !== 2) fail('INVALID_GLB');
  const total = dv.getUint32(8, true);
  if (total > u8.length) fail('INVALID_GLB');
  let offset = 12, json = null, bin = null;
  while (offset + 8 <= total) {
    const clen = dv.getUint32(offset, true);
    const ctype = dv.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + clen > u8.length) fail('INVALID_GLB');
    if (ctype === 0x4E4F534A) json = new TextDecoder().decode(u8.subarray(start, start + clen));
    else if (ctype === 0x004E4942) bin = u8.subarray(start, start + clen);
    offset = start + clen;
  }
  if (!json || !bin) fail('INVALID_GLB');
  let doc;
  try { doc = JSON.parse(json); } catch { fail('INVALID_GLB'); }
  const prim = doc.meshes?.[0]?.primitives?.[0];
  const accIdx = prim?.attributes?.POSITION;
  const accessor = Number.isInteger(accIdx) ? doc.accessors?.[accIdx] : null;
  if (!accessor || accessor.componentType !== 5126 || accessor.type !== 'VEC3') fail('GLB_NO_POSITION');
  const view = doc.bufferViews?.[accessor.bufferView || 0];
  if (!view) fail('INVALID_GLB');
  const base = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const count = accessor.count;
  const bdv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const vertices = [];
  for (let i = 0; i < count; i++) {
    const o = base + i * 12;
    if (o + 12 > bin.length) fail('INVALID_GLB');
    vertices.push([bdv.getFloat32(o, true), bdv.getFloat32(o + 4, true), bdv.getFloat32(o + 8, true)]);
  }
  return { vertices, faces: [], json: doc };
}

/* OBJ/GLB → GeoJSON : empreinte convexe (Polygon) + centroïde (Point),
   après transformation dans le CRS source puis reprojection WGS 84. */
export function meshToGeoJSON(mesh, { sourceCrs = 'EPSG:4326', scale, rotationDeg, offsetEN, fileName = 'modele' } = {}) {
  const crs = normalizeCrs(sourceCrs);
  const tr = { scale, rotationDeg, offsetEN };
  const plats = (mesh.vertices || []).map(v => [Number(v[0]), Number(v[1])]);
  if (!plats.length) fail('MESH_NO_VERTICES');
  const transformes = transformXY(plats, tr);
  const hull = convexHull2D(transformes);
  let cx = 0, cy = 0;
  for (const p of transformes) { cx += p[0]; cy += p[1]; }
  cx /= transformes.length; cy /= transformes.length;
  const toLl = ([x, y]) => toWgs84(x, y, crs);
  const ring = hull.length >= 3 ? hull.concat([hull[0]]) : transformes.concat([transformes[0]]);
  return {
    type: 'FeatureCollection',
    name: fileName,
    sourceCrs: crs,
    features: [
      {
        type: 'Feature',
        properties: { kind: 'mesh-reference', vertices: mesh.vertices.length, faces: (mesh.faces || []).length, fileName, source: fileName.endsWith('.glb') ? 'glb' : 'obj' },
        geometry: { type: 'Polygon', coordinates: [ring.map(toLl)] }
      },
      {
        type: 'Feature',
        properties: { kind: 'mesh-centroid', fileName },
        geometry: { type: 'Point', coordinates: toLl([cx, cy]) }
      }
    ]
  };
}
