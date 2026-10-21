import { MAX_COORDINATE_POSITIONS, MAX_FEATURES, MAX_IMPORT_BYTES, normalizeCrs, toWgs84 } from './local-layers.mjs';

function fail(code, detail = '') {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  throw error;
}

function asView(value) {
  if (value instanceof DataView) return value;
  if (value instanceof ArrayBuffer) return new DataView(value);
  if (ArrayBuffer.isView(value)) return new DataView(value.buffer, value.byteOffset, value.byteLength);
  fail('SHP_INVALID_BUFFER');
}

function ringSignedArea(ring) {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const next = ring[(i + 1) % ring.length];
    area += ring[i][0] * next[1] - next[0] * ring[i][1];
  }
  return area / 2;
}

function ringContains(ring, point) {
  let inside = false;
  const [x, y] = point;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    const crosses = (yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / ((yj - yi) || Number.EPSILON) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function polygonFromRings(rings) {
  const outer = rings.filter(ring => ringSignedArea(ring) < 0);
  const inner = rings.filter(ring => ringSignedArea(ring) >= 0);
  const shells = outer.length ? outer : rings;
  const polygons = shells.map(ring => [ring]);
  if (outer.length) {
    for (const hole of inner) {
      let target = -1, smallest = Infinity;
      for (let i = 0; i < shells.length; i++) {
        const area = Math.abs(ringSignedArea(shells[i]));
        if (area < smallest && ringContains(shells[i], hole[0])) { target = i; smallest = area; }
      }
      if (target >= 0) polygons[target].push(hole);
      else polygons.push([hole]);
    }
  }
  return polygons.length === 1
    ? { type: 'Polygon', coordinates: polygons[0] }
    : { type: 'MultiPolygon', coordinates: polygons };
}

function readShp(view) {
  if (view.byteLength > MAX_IMPORT_BYTES || view.byteLength < 100) fail('SHP_FILE_SIZE');
  if (view.getInt32(0, false) !== 9994 || view.getInt32(28, true) !== 1000 || view.getInt32(24, false) * 2 !== view.byteLength) fail('SHP_INVALID_HEADER');
  const headerType = view.getInt32(32, true);
  let offset = 100;
  const records = [];
  while (offset + 8 <= view.byteLength) {
    const recordNumber = view.getInt32(offset, false);
    const contentLength = view.getInt32(offset + 4, false) * 2;
    const start = offset + 8, end = start + contentLength;
    if (!Number.isSafeInteger(contentLength) || contentLength < 4 || end > view.byteLength) fail('SHP_INVALID_RECORD', String(recordNumber));
    const type = view.getInt32(start, true);
    let geometry = null;
    if (type === 0) geometry = null;
    else if ([1, 11, 21].includes(type)) {
      if (contentLength < 20) fail('SHP_INVALID_RECORD', String(recordNumber));
      geometry = { type: 'Point', coordinates: [view.getFloat64(start + 4, true), view.getFloat64(start + 12, true)] };
    } else if ([8, 18, 28].includes(type)) {
      if (contentLength < 40) fail('SHP_INVALID_RECORD', String(recordNumber));
      const count = view.getInt32(start + 36, true), first = start + 40;
      if (count < 0 || count > MAX_COORDINATE_POSITIONS || first + count * 16 > end) fail('SHP_INVALID_RECORD', String(recordNumber));
      const points = Array.from({ length: count }, (_, i) => [view.getFloat64(first + i * 16, true), view.getFloat64(first + i * 16 + 8, true)]);
      if (!points.length) fail('SHP_INVALID_RECORD', String(recordNumber));
      geometry = { type: 'MultiPoint', coordinates: points };
    } else if ([3, 13, 23, 5, 15, 25].includes(type)) {
      if (contentLength < 44) fail('SHP_INVALID_RECORD', String(recordNumber));
      const partCount = view.getInt32(start + 36, true), pointCount = view.getInt32(start + 40, true);
      const partsStart = start + 44, pointsStart = partsStart + partCount * 4;
      if (partCount < 1 || pointCount < 2 || partCount > pointCount || pointCount > MAX_COORDINATE_POSITIONS || pointsStart + pointCount * 16 > end)
        fail('SHP_INVALID_RECORD', String(recordNumber));
      const starts = Array.from({ length: partCount }, (_, i) => view.getInt32(partsStart + i * 4, true));
      if (starts[0] !== 0 || starts.some((value, i) => value < 0 || value >= pointCount || i && value <= starts[i - 1]))
        fail('SHP_INVALID_RECORD', String(recordNumber));
      const points = Array.from({ length: pointCount }, (_, i) => [view.getFloat64(pointsStart + i * 16, true), view.getFloat64(pointsStart + i * 16 + 8, true)]);
      const parts = starts.map((value, i) => points.slice(value, starts[i + 1] ?? pointCount));
      if ([3, 13, 23].includes(type)) geometry = parts.length === 1 ? { type: 'LineString', coordinates: parts[0] } : { type: 'MultiLineString', coordinates: parts };
      else geometry = polygonFromRings(parts);
    } else {
      fail('SHP_UNSUPPORTED_TYPE', String(type || headerType));
    }
    records.push({ id: recordNumber, geometry });
    if (records.length > MAX_FEATURES) fail('TOO_MANY_FEATURES');
    offset = end;
  }
  if (offset !== view.byteLength) fail('SHP_INVALID_RECORD');
  return records;
}

function decoderFor(codePage) {
  const raw = String(codePage || 'utf-8').trim().toLowerCase();
  const encoding = raw === '1252' || raw === 'ansi 1252' ? 'windows-1252'
    : raw === '65001' ? 'utf-8' : raw;
  try { return new TextDecoder(encoding); } catch { return new TextDecoder('windows-1252'); }
}

function parseDbf(view, codePage = 'utf-8') {
  if (view.byteLength > MAX_IMPORT_BYTES || view.byteLength < 33) fail('DBF_INVALID');
  const count = view.getUint32(4, true), headerLength = view.getUint16(8, true), recordLength = view.getUint16(10, true);
  if (count > MAX_FEATURES || headerLength < 33 || headerLength > view.byteLength || recordLength < 1 || headerLength + count * recordLength > view.byteLength)
    fail('DBF_INVALID');
  const decoder = decoderFor(codePage);
  const fields = [];
  for (let offset = 32; offset + 32 <= headerLength; offset += 32) {
    if (view.getUint8(offset) === 0x0d) break;
    const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, 11);
    const name = decoder.decode(bytes).replace(/\0/g, '').trim();
    const type = String.fromCharCode(view.getUint8(offset + 11));
    const length = view.getUint8(offset + 16), decimals = view.getUint8(offset + 17);
    if (!name || !length) fail('DBF_INVALID');
    fields.push({ name, type, length, decimals });
  }
  if (fields.reduce((sum, field) => sum + field.length, 1) > recordLength) fail('DBF_INVALID');
  const rows = [];
  for (let rowIndex = 0; rowIndex < count; rowIndex++) {
    const start = headerLength + rowIndex * recordLength;
    let position = start + 1;
    const deleted = view.getUint8(start) === 0x2a;
    const properties = Object.create(null);
    for (const field of fields) {
      const fieldStart = position;
      const bytes = new Uint8Array(view.buffer, view.byteOffset + fieldStart, field.length);
      const raw = decoder.decode(bytes).replace(/\0/g, '').trim();
      position += field.length;
      let value = raw;
      if (['N', 'F'].includes(field.type)) {
        const numeric = raw ? Number(raw) : null;
        value = numeric === null || Number.isFinite(numeric) ? numeric : raw;
      } else if (field.type === 'I') {
        if (field.length !== 4) fail('DBF_INVALID');
        value = view.getInt32(fieldStart, true);
      } else if (field.type === 'B') {
        if (field.length !== 8) fail('DBF_INVALID');
        value = view.getFloat64(fieldStart, true);
      } else if (field.type === 'Y') {
        if (field.length !== 8) fail('DBF_INVALID');
        value = Number(view.getBigInt64(fieldStart, true)) / 10_000;
      } else if (field.type === 'L') value = /^(?:Y|T|1)$/i.test(raw) ? true : /^(?:N|F|0)$/i.test(raw) ? false : null;
      else if (field.type === 'D' && /^\d{8}$/.test(raw)) value = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
      properties[field.name] = value;
    }
    if (deleted) properties._dbfDeleted = true;
    rows.push(properties);
  }
  return rows;
}

export function detectShapefileCrs(prjText) {
  const text = String(prjText || '').trim();
  if (!text) return '';
  try {
    const match = text.match(/(?:AUTHORITY|ID)\s*\[\s*["']EPSG["']\s*,\s*["']?(\d{4,5})/i) || text.match(/EPSG\s*[:/]{1,2}\s*(\d{4,5})/i);
    if (match) return normalizeCrs(`EPSG:${match[1]}`);
  } catch { /* Continue with common WKT names below. */ }
  if (/WGS[_\s-]*1984|WGS\s*84/i.test(text) && !/PROJECTION\s*\[/i.test(text)) return 'EPSG:4326';
  if (/WGS[_\s-]*1984|WGS\s*84/i.test(text) && /TRANSVERSE_MERCATOR/i.test(text)) {
    const central = text.match(/Central_Meridian"?\s*,\s*([-+\d.]+)/i);
    const falseNorthing = text.match(/False_Northing"?\s*,\s*([-+\d.]+)/i);
    const falseEasting = text.match(/False_Easting"?\s*,\s*([-+\d.]+)/i);
    const scale = text.match(/Scale_Factor"?\s*,\s*([-+\d.]+)/i);
    if (central && Number(falseEasting?.[1] || 0) === 500000 && Math.abs(Number(scale?.[1] || 0.9996) - 0.9996) < 0.00001) {
      const zone = Math.round((Number(central[1]) + 183) / 6);
      if (zone >= 1 && zone <= 60) return `EPSG:${Number(falseNorthing?.[1] || 0) >= 5_000_000 ? 32700 + zone : 32600 + zone}`;
    }
  }
  return '';
}

export function parseShapefileBundle({ shp, dbf = null, sourceCrs, fileName = 'couche.shp', codePage = 'utf-8' } = {}) {
  if (!String(sourceCrs || '').trim()) fail('SHP_CRS_REQUIRED');
  const crs = normalizeCrs(sourceCrs);
  const shpView = asView(shp);
  const records = readShp(shpView);
  const dbfRows = dbf ? parseDbf(asView(dbf), codePage) : [];
  if (dbf != null && dbfRows.length !== records.length) fail('SHP_DBF_COUNT_MISMATCH');
  let positions = 0;
  const features = records.map((record, index) => {
    let geometry = record.geometry;
    if (geometry) {
      const convertPosition = position => {
        const [lon, lat] = toWgs84(position[0], position[1], crs);
        return [lon, lat, ...position.slice(2)];
      };
      if (geometry.type === 'Point') geometry = { ...geometry, coordinates: convertPosition(geometry.coordinates) };
      else if (geometry.type === 'MultiPoint' || geometry.type === 'LineString') geometry = { ...geometry, coordinates: geometry.coordinates.map(convertPosition) };
      else if (geometry.type === 'MultiLineString' || geometry.type === 'Polygon') geometry = { ...geometry, coordinates: geometry.coordinates.map(line => line.map(convertPosition)) };
      else if (geometry.type === 'MultiPolygon') geometry = { ...geometry, coordinates: geometry.coordinates.map(polygon => polygon.map(line => line.map(convertPosition))) };
    }
    if (geometry) {
      const countPositions = geometry.type === 'Point' ? 1 : geometry.type === 'MultiPoint' ? geometry.coordinates.length
        : geometry.type === 'LineString' ? geometry.coordinates.length
        : geometry.type === 'MultiLineString' || geometry.type === 'Polygon' ? geometry.coordinates.reduce((sum, part) => sum + part.length, 0)
        : geometry.type === 'MultiPolygon' ? geometry.coordinates.reduce((sum, polygon) => sum + polygon.reduce((partSum, part) => partSum + part.length, 0), 0) : 0;
      positions += countPositions;
      if (positions > MAX_COORDINATE_POSITIONS) fail('TOO_MANY_COORDINATES');
    }
    return { type: 'Feature', id: record.id, properties: dbfRows[index] || {}, geometry };
  });
  return { type: 'FeatureCollection', name: fileName, crs: 'EPSG:4326', sourceCrs: crs, features };
}
