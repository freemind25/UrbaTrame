import {
  MAX_FEATURES, MAX_TOTAL_FEATURES, MAX_COORDINATE_POSITIONS, MAX_TOTAL_POSITIONS,
  MAX_IMPORT_BYTES, normalizeCrs, parseGeoJSONText, countFeaturePositions
} from './local-layers.mjs';

export const GEOPACKAGE_APPLICATION_ID = 0x47504b47;
export const MAX_GEOPACKAGE_LAYERS = 12;
const MAX_WKB_DEPTH = 32;
const MAX_BINARY_ATTRIBUTE_BYTES = 4096;

function fail(code, detail = '') {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  throw error;
}

function asBytes(input) {
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  fail('GPKG_INVALID');
}

function queryRows(db, sql) {
  const result = db.exec(sql);
  return result.flatMap(table => table.values.map(values => Object.fromEntries(table.columns.map((name, index) => [name, values[index]]))));
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function readCount(view, cursor, littleEndian, maximum, code = 'GPKG_GEOMETRY_INVALID') {
  if (cursor.offset + 4 > view.byteLength) fail(code);
  const count = view.getUint32(cursor.offset, littleEndian);
  cursor.offset += 4;
  if (count > maximum) fail(code);
  return count;
}

function readWkbGeometry(view, cursor, budget, expectedSrsId, depth = 0) {
  if (depth > MAX_WKB_DEPTH) fail('GPKG_GEOMETRY_INVALID');
  if (cursor.offset + 5 > view.byteLength) fail('GPKG_GEOMETRY_INVALID');
  const byteOrder = view.getUint8(cursor.offset++);
  if (byteOrder !== 0 && byteOrder !== 1) fail('GPKG_GEOMETRY_INVALID');
  const littleEndian = byteOrder === 1;
  const rawType = view.getUint32(cursor.offset, littleEndian);
  cursor.offset += 4;

  let baseType, hasZ = false, hasM = false, hasSrid = false;
  const ewkb = (rawType & 0xe0000000) !== 0;
  if (ewkb) {
    hasZ = (rawType & 0x80000000) !== 0;
    hasM = (rawType & 0x40000000) !== 0;
    hasSrid = (rawType & 0x20000000) !== 0;
    baseType = rawType & 0x1fffffff;
  } else {
    const dimension = Math.floor(rawType / 1000);
    baseType = rawType % 1000;
    if (dimension === 1) hasZ = true;
    else if (dimension === 2) hasM = true;
    else if (dimension === 3) { hasZ = true; hasM = true; }
    else if (dimension !== 0) fail('GPKG_GEOMETRY_UNSUPPORTED', String(rawType));
  }
  if (hasSrid) {
    if (cursor.offset + 4 > view.byteLength) fail('GPKG_GEOMETRY_INVALID');
    const embeddedSrsId = view.getInt32(cursor.offset, littleEndian);
    cursor.offset += 4;
    if (Number.isSafeInteger(expectedSrsId) && embeddedSrsId !== expectedSrsId) fail('GPKG_SRS_MISMATCH');
  }
  const dimensions = 2 + Number(hasZ) + Number(hasM);
  const readCoordinate = () => {
    if (cursor.offset + dimensions * 8 > view.byteLength) fail('GPKG_GEOMETRY_INVALID');
    const coordinate = [];
    for (let axis = 0; axis < dimensions; axis++) {
      coordinate.push(view.getFloat64(cursor.offset, littleEndian));
      cursor.offset += 8;
    }
    if (Number.isNaN(coordinate[0]) && Number.isNaN(coordinate[1])) return null;
    if (!Number.isFinite(coordinate[0]) || !Number.isFinite(coordinate[1]) || coordinate.slice(2).some(value => !Number.isFinite(value)))
      fail('GPKG_GEOMETRY_INVALID');
    budget.positions++;
    if (budget.positions > MAX_COORDINATE_POSITIONS) fail('TOO_MANY_COORDINATES');
    return coordinate;
  };
  const readLine = () => {
    const count = readCount(view, cursor, littleEndian, MAX_COORDINATE_POSITIONS);
    const line = [];
    for (let i = 0; i < count; i++) {
      const coordinate = readCoordinate();
      if (!coordinate) fail('GPKG_GEOMETRY_INVALID');
      line.push(coordinate);
    }
    return line;
  };
  const readPolygon = () => {
    const count = readCount(view, cursor, littleEndian, MAX_COORDINATE_POSITIONS);
    const rings = [];
    for (let i = 0; i < count; i++) rings.push(readLine());
    return rings;
  };
  const readChildren = (expectedType, convert) => {
    const count = readCount(view, cursor, littleEndian, MAX_COORDINATE_POSITIONS);
    const children = [];
    for (let i = 0; i < count; i++) {
      const child = readWkbGeometry(view, cursor, budget, expectedSrsId, depth + 1);
      if (child.type !== expectedType) fail('GPKG_GEOMETRY_INVALID');
      children.push(convert(child));
    }
    return children;
  };

  switch (baseType) {
    case 1: {
      const coordinates = readCoordinate();
      return { type: 'Point', coordinates };
    }
    case 2: return { type: 'LineString', coordinates: readLine() };
    case 3: return { type: 'Polygon', coordinates: readPolygon() };
    case 4: return { type: 'MultiPoint', coordinates: readChildren('Point', child => child.coordinates) };
    case 5: return { type: 'MultiLineString', coordinates: readChildren('LineString', child => child.coordinates) };
    case 6: return { type: 'MultiPolygon', coordinates: readChildren('Polygon', child => child.coordinates) };
    case 7: {
      const count = readCount(view, cursor, littleEndian, MAX_COORDINATE_POSITIONS);
      const geometries = [];
      for (let i = 0; i < count; i++) geometries.push(readWkbGeometry(view, cursor, budget, expectedSrsId, depth + 1));
      if (geometries.some(geometry => geometry.coordinates === null)) fail('GPKG_GEOMETRY_INVALID');
      return { type: 'GeometryCollection', geometries };
    }
    default: fail('GPKG_GEOMETRY_UNSUPPORTED', String(rawType));
  }
}

export function decodeGeoPackageGeometry(input, expectedSrsId, { maxPositions = MAX_COORDINATE_POSITIONS } = {}) {
  const bytes = asBytes(input);
  if (bytes.byteLength < 8 || bytes[0] !== 0x47 || bytes[1] !== 0x50 || bytes[2] !== 0)
    fail('GPKG_GEOMETRY_INVALID');
  const flags = bytes[3];
  if (flags & 0xc0) fail('GPKG_GEOMETRY_INVALID');
  if (flags & 0x20) fail('GPKG_EXTENDED_GEOMETRY_UNSUPPORTED');
  const littleEndian = (flags & 1) !== 0;
  const envelopeIndicator = (flags >> 1) & 7;
  const envelopeDoubles = [0, 4, 6, 6, 8][envelopeIndicator];
  if (envelopeDoubles === undefined) fail('GPKG_GEOMETRY_INVALID');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const srsId = view.getInt32(4, littleEndian);
  if (Number.isSafeInteger(expectedSrsId) && srsId !== expectedSrsId) fail('GPKG_SRS_MISMATCH');
  const offset = 8 + envelopeDoubles * 8;
  if (offset > view.byteLength) fail('GPKG_GEOMETRY_INVALID');
  if (flags & 0x10) return null;
  const cursor = { offset };
  const budget = { positions: 0 };
  const geometry = readWkbGeometry(view, cursor, budget, srsId);
  if (cursor.offset !== view.byteLength) fail('GPKG_GEOMETRY_INVALID');
  if (budget.positions > maxPositions) fail('TOO_MANY_COORDINATES');
  if (geometry.type === 'Point' && geometry.coordinates === null) return null;
  return geometry;
}

function sourceCrsForSrs(db, srsId) {
  if (!Number.isSafeInteger(srsId)) fail('GPKG_SRS_UNSUPPORTED');
  const rows = queryRows(db, `SELECT organization, organization_coordsys_id FROM gpkg_spatial_ref_sys WHERE srs_id = ${srsId} LIMIT 1`);
  if (!rows.length) fail('GPKG_SRS_UNSUPPORTED', String(srsId));
  const authority = String(rows[0].organization || '').toUpperCase();
  const authorityCode = Number(rows[0].organization_coordsys_id);
  if (authority !== 'EPSG' || !Number.isSafeInteger(authorityCode)) fail('GPKG_SRS_UNSUPPORTED', `${authority || 'unknown'}:${srsId}`);
  try { return normalizeCrs(authorityCode); }
  catch { fail('GPKG_SRS_UNSUPPORTED', `${authority}:${authorityCode}`); }
}

function propertyValue(value) {
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    const length = value.byteLength;
    if (length <= MAX_BINARY_ATTRIBUTE_BYTES) {
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x4000)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x4000));
      return `base64:${btoa(binary)}`;
    }
    return `[BLOB · ${length} octets]`;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  if (typeof value === 'bigint') return String(value);
  return value ?? null;
}

function tableFeatures(db, tableName, geometryColumn, sourceCrs, srsId, fileName) {
  const rows = queryRows(db, `SELECT * FROM ${quoteIdentifier(tableName)} LIMIT ${MAX_FEATURES + 1}`);
  if (!rows.length) {
    // A valid empty layer still needs its schema to be discoverable.
    const columns = queryRows(db, `PRAGMA table_info(${quoteIdentifier(tableName)})`);
    if (!columns.some(column => column.name === geometryColumn)) fail('GPKG_SCHEMA_INVALID', tableName);
    return parseGeoJSONText(JSON.stringify({
      type: 'FeatureCollection', name: tableName, crs: `EPSG:${sourceCrs.slice(5)}`, features: []
    }), { fileName });
  }
  const columnNames = Object.keys(rows[0]);
  const geometryIndex = columnNames.indexOf(geometryColumn);
  if (geometryIndex < 0) fail('GPKG_SCHEMA_INVALID', tableName);
  if (rows.length > MAX_FEATURES) fail('GPKG_TOO_MANY_FEATURES', tableName);
  const idIndex = columnNames.findIndex(name => name.toLowerCase() === 'fid');
  const features = rows.map((row, rowIndex) => {
    const geometryBlob = row[geometryColumn];
    let geometry = null;
    if (geometryBlob !== null && geometryBlob !== undefined) {
      try { geometry = decodeGeoPackageGeometry(geometryBlob, srsId); }
      catch (error) {
        if (error?.code) error.message = `${error.code}:${tableName} · entité ${rowIndex + 1}${error.message.includes(':') ? ` · ${error.message.split(':').slice(1).join(':')}` : ''}`;
        throw error;
      }
    }
    const properties = {};
    for (const column of columnNames) {
      if (column === geometryColumn || column.toLowerCase() === 'fid') continue;
      properties[column] = propertyValue(row[column]);
    }
    const feature = { type: 'Feature', properties, geometry };
    if (idIndex >= 0 && row[columnNames[idIndex]] !== null && row[columnNames[idIndex]] !== undefined)
      feature.id = propertyValue(row[columnNames[idIndex]]);
    else feature.id = rowIndex + 1;
    return feature;
  });
  const result = parseGeoJSONText(JSON.stringify({
    type: 'FeatureCollection', name: tableName,
    crs: { type: 'name', properties: { name: sourceCrs } }, features
  }), { fileName });
  result.urbatrame = {
    format: 'GeoPackage', tableName, geometryColumn, sourceSrsId: srsId
  };
  return result;
}

export function parseGeoPackage(input, SQL, { fileName = 'couche.gpkg' } = {}) {
  const bytes = asBytes(input);
  if (bytes.byteLength > MAX_IMPORT_BYTES) fail('FILE_TOO_LARGE');
  if (!SQL || typeof SQL.Database !== 'function') fail('GPKG_READER_UNAVAILABLE');
  let db;
  try { db = new SQL.Database(bytes); }
  catch { fail('GPKG_INVALID'); }
  try {
    const applicationId = Number(queryRows(db, 'PRAGMA application_id')[0]?.application_id);
    if (applicationId !== GEOPACKAGE_APPLICATION_ID) fail('GPKG_NOT_VALID');
    const tables = queryRows(db, "SELECT name FROM sqlite_master WHERE type='table'");
    const tableNames = new Set(tables.map(row => String(row.name)));
    if (!tableNames.has('gpkg_contents') || !tableNames.has('gpkg_geometry_columns') || !tableNames.has('gpkg_spatial_ref_sys'))
      fail('GPKG_SCHEMA_INVALID');
    const contents = queryRows(db, "SELECT table_name, data_type, srs_id, identifier FROM gpkg_contents WHERE data_type = 'features' ORDER BY table_name");
    const geometries = queryRows(db, 'SELECT table_name, column_name, geometry_type_name, srs_id FROM gpkg_geometry_columns');
    const geometryByTable = new Map(geometries.map(row => [String(row.table_name), row]));
    const featureContents = contents.filter(row => geometryByTable.has(String(row.table_name)));
    if (!featureContents.length) fail('GPKG_NO_VECTOR_LAYERS');
    if (featureContents.length > MAX_GEOPACKAGE_LAYERS) fail('GPKG_TOO_MANY_LAYERS');

    let totalFeatures = 0, totalPositions = 0;
    const layers = featureContents.map(content => {
      const tableName = String(content.table_name || '');
      if (!tableNames.has(tableName) || !tableName || tableName.length > 240) fail('GPKG_SCHEMA_INVALID');
      const geometryInfo = geometryByTable.get(tableName);
      const geometryColumn = String(geometryInfo.column_name || '');
      if (!geometryColumn || geometryColumn.length > 240 || Number(content.srs_id) !== Number(geometryInfo.srs_id))
        fail('GPKG_SCHEMA_INVALID', tableName);
      const srsId = Number(geometryInfo.srs_id);
      const crs = sourceCrsForSrs(db, srsId);
      const displayName = String(content.identifier || tableName).slice(0, 100);
      const fileLabel = `${fileName} · ${displayName}`;
      const geojson = tableFeatures(db, tableName, geometryColumn, crs, srsId, fileLabel);
      geojson.name = displayName;
      const positions = countFeaturePositions(geojson.features);
      totalFeatures += geojson.features.length;
      totalPositions += positions;
      if (totalFeatures > MAX_TOTAL_FEATURES) fail('GPKG_TOO_MANY_TOTAL_FEATURES');
      if (totalPositions > MAX_TOTAL_POSITIONS) fail('GPKG_TOO_MANY_TOTAL_POSITIONS');
      return {
        name: displayName, fileName: fileLabel, sourceCrs: crs,
        geometryType: String(geometryInfo.geometry_type_name || 'GEOMETRY').toUpperCase(), geojson
      };
    });
    return layers;
  } catch (error) {
    if (error?.code) throw error;
    fail('GPKG_INVALID');
  } finally {
    try { db.close(); } catch { /* The database may already have been closed by the decoder. */ }
  }
}
