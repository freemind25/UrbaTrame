/* Export GeoPackage 1.3 local, vecteur EPSG:4326; aucun raster ni réseau. */
import { extentOfFeatures, countFeaturePositions, MAX_TOTAL_FEATURES, MAX_TOTAL_POSITIONS } from './local-layers.mjs';
import { GEOPACKAGE_APPLICATION_ID } from './geopackage.mjs';

export const MAX_GPKG_EXPORT_BYTES = 50 * 1024 * 1024;
const MAX_GPKG_EXPORT_FIELDS = 200;

function fail(code) { const error = new Error(code); error.code = code; throw error; }
function quoteIdentifier(value) { return `"${String(value).replaceAll('"', '""')}"`; }
function sqlString(value) { return `'${String(value).replaceAll("'", "''")}'`; }

function positionsInGeometry(geometry, out = []) {
  if (!geometry) return out;
  if (geometry.type === 'GeometryCollection') {
    for (const child of geometry.geometries || []) positionsInGeometry(child, out);
    return out;
  }
  const visit = value => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') out.push(value);
    else value.forEach(visit);
  };
  visit(geometry.coordinates);
  return out;
}

function hasZ(geometry) {
  const positions = positionsInGeometry(geometry);
  return positions.length > 0 && positions.every(position => position.length >= 3 && Number.isFinite(Number(position[2])));
}

function wkbGeometryLength(geometry, z) {
  if (!geometry) return 0;
  const dim = z ? 3 : 2, header = 5;
  switch (geometry.type) {
    case 'Point': return header + dim * 8;
    case 'LineString': return header + 4 + geometry.coordinates.length * dim * 8;
    case 'Polygon': return header + 4 + geometry.coordinates.reduce((sum, ring) => sum + 4 + ring.length * dim * 8, 0);
    case 'MultiPoint': return header + 4 + geometry.coordinates.reduce((sum, coordinates) => sum + wkbGeometryLength({ type: 'Point', coordinates }, z), 0);
    case 'MultiLineString': return header + 4 + geometry.coordinates.reduce((sum, coordinates) => sum + wkbGeometryLength({ type: 'LineString', coordinates }, z), 0);
    case 'MultiPolygon': return header + 4 + geometry.coordinates.reduce((sum, coordinates) => sum + wkbGeometryLength({ type: 'Polygon', coordinates }, z), 0);
    case 'GeometryCollection': return header + 4 + geometry.geometries.reduce((sum, child) => sum + wkbGeometryLength(child, hasZ(child)), 0);
    default: fail('GPKG_EXPORT_GEOMETRY_UNSUPPORTED');
  }
}

function writeWkb(view, start, geometry, z) {
  if (!geometry) return start;
  const typeCodes = { Point: 1, LineString: 2, Polygon: 3, MultiPoint: 4, MultiLineString: 5, MultiPolygon: 6, GeometryCollection: 7 };
  const type = typeCodes[geometry.type];
  if (!type) fail('GPKG_EXPORT_GEOMETRY_UNSUPPORTED');
  let cursor = start;
  view.setUint8(cursor++, 1);
  view.setUint32(cursor, type + (z ? 1000 : 0), true); cursor += 4;
  const writePosition = position => {
    view.setFloat64(cursor, Number(position[0]), true); cursor += 8;
    view.setFloat64(cursor, Number(position[1]), true); cursor += 8;
    if (z) { view.setFloat64(cursor, Number(position[2]), true); cursor += 8; }
  };
  const writeCount = count => { view.setUint32(cursor, count, true); cursor += 4; };
  const writeLine = line => { writeCount(line.length); for (const position of line) writePosition(position); };
  const writePolygon = rings => { writeCount(rings.length); for (const ring of rings) writeLine(ring); };
  switch (geometry.type) {
    case 'Point': writePosition(geometry.coordinates); break;
    case 'LineString': writeLine(geometry.coordinates); break;
    case 'Polygon': writePolygon(geometry.coordinates); break;
    case 'MultiPoint': writeCount(geometry.coordinates.length); for (const coordinates of geometry.coordinates) cursor = writeWkb(view, cursor, { type: 'Point', coordinates }, z); break;
    case 'MultiLineString': writeCount(geometry.coordinates.length); for (const coordinates of geometry.coordinates) cursor = writeWkb(view, cursor, { type: 'LineString', coordinates }, z); break;
    case 'MultiPolygon': writeCount(geometry.coordinates.length); for (const coordinates of geometry.coordinates) cursor = writeWkb(view, cursor, { type: 'Polygon', coordinates }, z); break;
    case 'GeometryCollection': writeCount(geometry.geometries.length); for (const child of geometry.geometries) cursor = writeWkb(view, cursor, child, hasZ(child)); break;
  }
  return cursor;
}

export function encodeGeoPackageGeometry(geometry, srsId = 4326) {
  if (!geometry) return null;
  const z = hasZ(geometry);
  const wkbLength = wkbGeometryLength(geometry, z);
  const bytes = new Uint8Array(8 + wkbLength);
  bytes[0] = 0x47; bytes[1] = 0x50; bytes[2] = 0; bytes[3] = 1;
  const view = new DataView(bytes.buffer);
  view.setInt32(4, srsId, true);
  const end = writeWkb(view, 8, geometry, z);
  if (end !== bytes.length) fail('GPKG_EXPORT_GEOMETRY_INVALID');
  return bytes;
}

function fieldType(features, key) {
  const values = features.map(feature => feature.properties?.[key]).filter(value => value !== null && value !== undefined);
  if (values.length && values.every(value => typeof value === 'number' && Number.isFinite(value))) return 'REAL';
  if (values.length && values.every(value => typeof value === 'boolean')) return 'INTEGER';
  return 'TEXT';
}

function sqliteValue(value, type) {
  if (value === null || value === undefined) return null;
  if (type === 'REAL') return Number(value);
  if (type === 'INTEGER') return value ? 1 : 0;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function uniqueColumn(key, index, used) {
  const clean = String(key || '').slice(0, 240) || `attribute_${index + 1}`;
  const normalized = clean.toLocaleLowerCase('en-US');
  if (['fid', 'geom', 'gpkg_contents', 'gpkg_geometry_columns'].includes(normalized) || used.has(normalized)) {
    const candidate = `attribute_${index + 1}`;
    used.add(candidate.toLocaleLowerCase('en-US'));
    return candidate;
  }
  used.add(normalized);
  return clean;
}

function safeLayerTitle(value, index, used) {
  let title = String(value || `Couche ${index + 1}`).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 100) || `Couche ${index + 1}`;
  const base = title;
  let suffix = 2;
  while (used.has(title.toLocaleLowerCase('fr-FR'))) title = `${base.slice(0, 92)} (${suffix++})`;
  used.add(title.toLocaleLowerCase('fr-FR'));
  return title;
}

const WGS84_WKT = 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433],AXIS["Longitude",EAST],AXIS["Latitude",NORTH],AUTHORITY["EPSG","4326"]]';

export function createGeoPackage(layers, SQL, { now = new Date(), maxBytes = MAX_GPKG_EXPORT_BYTES } = {}) {
  if (!SQL || typeof SQL.Database !== 'function') fail('GPKG_READER_UNAVAILABLE');
  const visible = (layers || []).filter(layer => layer.visible !== false && layer.kind !== 'raster');
  if (!visible.length) fail('GPKG_EXPORT_NO_VECTOR_LAYERS');
  if (visible.length > 12) fail('GPKG_EXPORT_TOO_MANY_LAYERS');
  let totalFeatures = 0, totalPositions = 0;
  for (const layer of visible) {
    const features = layer.geojson?.features || [];
    totalFeatures += features.length;
    totalPositions += countFeaturePositions(features);
  }
  if (totalFeatures > MAX_TOTAL_FEATURES) fail('GPKG_EXPORT_TOO_MANY_FEATURES');
  if (totalPositions > MAX_TOTAL_POSITIONS) fail('GPKG_EXPORT_TOO_MANY_POSITIONS');

  const db = new SQL.Database();
  try {
    db.run(`PRAGMA application_id = ${GEOPACKAGE_APPLICATION_ID}; PRAGMA user_version = 10300;`);
    db.run('BEGIN;');
    db.run(`CREATE TABLE gpkg_spatial_ref_sys (
      srs_name TEXT NOT NULL, srs_id INTEGER NOT NULL PRIMARY KEY,
      organization TEXT NOT NULL, organization_coordsys_id INTEGER NOT NULL,
      definition TEXT NOT NULL, description TEXT
    );`);
    const srs = db.prepare('INSERT INTO gpkg_spatial_ref_sys (srs_name,srs_id,organization,organization_coordsys_id,definition,description) VALUES (?,?,?,?,?,?)');
    srs.run(['Undefined Cartesian', -1, 'NONE', -1, 'undefined', 'undefined Cartesian coordinate reference system']);
    srs.run(['Undefined Geographic', 0, 'NONE', 0, 'undefined', 'undefined geographic coordinate reference system']);
    srs.run(['WGS 84 geodetic', 4326, 'EPSG', 4326, WGS84_WKT, 'longitude and latitude in decimal degrees']);
    srs.free();
    db.run(`CREATE TABLE gpkg_contents (
      table_name TEXT NOT NULL PRIMARY KEY, data_type TEXT NOT NULL, identifier TEXT UNIQUE,
      description TEXT DEFAULT '', last_change DATETIME NOT NULL,
      min_x DOUBLE, min_y DOUBLE, max_x DOUBLE, max_y DOUBLE, srs_id INTEGER,
      CONSTRAINT fk_gc_r_srs_id FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id)
    );`);
    db.run(`CREATE TABLE gpkg_geometry_columns (
      table_name TEXT NOT NULL, column_name TEXT NOT NULL, geometry_type_name TEXT NOT NULL,
      srs_id INTEGER NOT NULL, z TINYINT NOT NULL, m TINYINT NOT NULL,
      PRIMARY KEY (table_name,column_name),
      CONSTRAINT fk_geom_cols_table_name FOREIGN KEY (table_name) REFERENCES gpkg_contents(table_name),
      CONSTRAINT fk_geom_cols_srs FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id)
    );`);
    db.run(`CREATE TABLE gpkg_data_columns (
      table_name TEXT NOT NULL, column_name TEXT NOT NULL, name TEXT, title TEXT,
      description TEXT, mime_type TEXT, constraint_name TEXT,
      PRIMARY KEY (table_name,column_name),
      CONSTRAINT fk_data_cols_table_name FOREIGN KEY (table_name) REFERENCES gpkg_contents(table_name)
    );`);

    const usedTitles = new Set(), timestamp = now.toISOString();
    for (const [index, layer] of visible.entries()) {
      const tableName = `ut_layer_${String(index + 1).padStart(3, '0')}`;
      const title = safeLayerTitle(layer.name, index, usedTitles);
      const features = layer.geojson?.features || [];
      const propertyKeys = [...new Set(features.flatMap(feature => Object.keys(feature.properties || {})))].slice(0, MAX_GPKG_EXPORT_FIELDS);
      const usedColumns = new Set(['fid', 'geom']);
      const columns = propertyKeys.map((key, fieldIndex) => ({
        key, column: uniqueColumn(key, fieldIndex, usedColumns), type: fieldType(features, key)
      }));
      const extent = extentOfFeatures(features);
      const bounds = extent ? [extent.west, extent.south, extent.east, extent.north] : [null, null, null, null];
      const contentStmt = db.prepare('INSERT INTO gpkg_contents (table_name,data_type,identifier,description,last_change,min_x,min_y,max_x,max_y,srs_id) VALUES (?,?,?,?,?,?,?,?,?,4326)');
      contentStmt.run([tableName, 'features', title, String(layer.source || '').slice(0, 1000), timestamp, ...bounds]);
      contentStmt.free();
      const geomStmt = db.prepare('INSERT INTO gpkg_geometry_columns (table_name,column_name,geometry_type_name,srs_id,z,m) VALUES (?,\'geom\',\'GEOMETRY\',4326,2,0)');
      geomStmt.run([tableName]); geomStmt.free();
      const definitions = ['"fid" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL', '"geom" BLOB'];
      for (const item of columns) definitions.push(`${quoteIdentifier(item.column)} ${item.type}`);
      db.run(`CREATE TABLE ${quoteIdentifier(tableName)} (${definitions.join(',')});`);
      const dataColumnStmt = db.prepare('INSERT INTO gpkg_data_columns (table_name,column_name,name,title,description) VALUES (?,?,?,?,?)');
      for (const item of columns) dataColumnStmt.run([tableName, item.column, item.key, item.key, 'Attribut importé ou relevé localement dans UrbaTrame']);
      dataColumnStmt.free();

      const insert = db.prepare(`INSERT INTO ${quoteIdentifier(tableName)} (${['"geom"', ...columns.map(item => quoteIdentifier(item.column))].join(',')}) VALUES (${Array(columns.length + 1).fill('?').join(',')})`);
      for (const feature of features) {
        const geometry = encodeGeoPackageGeometry(feature.geometry, 4326);
        const values = [geometry, ...columns.map(item => sqliteValue(feature.properties?.[item.key], item.type))];
        insert.run(values);
      }
      insert.free();
    }
    db.run('COMMIT;');
    const bytes = db.export();
    if (bytes.byteLength > maxBytes) fail('GPKG_EXPORT_TOO_LARGE');
    if (new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(68, false) !== GEOPACKAGE_APPLICATION_ID) fail('GPKG_EXPORT_INVALID');
    return bytes;
  } catch (error) {
    try { db.run('ROLLBACK;'); } catch { /* transaction may have committed */ }
    if (error?.code) throw error;
    fail('GPKG_EXPORT_FAILED');
  } finally {
    try { db.close(); } catch { /* ignored */ }
  }
}
