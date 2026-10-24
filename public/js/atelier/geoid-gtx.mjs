/* Lecture locale de grilles binaires GTX NOAA/NGS et interpolation bilinéaire.
   Le fichier de modèle n'est jamais envoyé ni incorporé automatiquement au projet. */
export const MAX_GTX_BYTES = 100 * 1024 * 1024;
export const MAX_GTX_GRID_CELLS = 25_000_000;

function fail(code, detail = '') {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  throw error;
}

function asBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  fail('GTX_INVALID');
}

function headerCandidate(view, littleEndian, headerBytes) {
  if (view.byteLength < headerBytes) return null;
  const south = view.getFloat64(0, littleEndian), west = view.getFloat64(8, littleEndian);
  const deltaLat = view.getFloat64(16, littleEndian), deltaLon = view.getFloat64(24, littleEndian);
  const rows = view.getInt32(32, littleEndian), columns = view.getInt32(36, littleEndian);
  const ikind = headerBytes === 44 ? view.getInt32(40, littleEndian) : 1;
  const cells = rows * columns;
  if (!Number.isFinite(south) || south < -90 || south > 90 || !Number.isFinite(west) || west < -360 || west > 360 ||
      !Number.isFinite(deltaLat) || deltaLat <= 0 || deltaLat > 5 || !Number.isFinite(deltaLon) || deltaLon <= 0 || deltaLon > 5 ||
      rows < 2 || columns < 2 || !Number.isSafeInteger(cells) || cells > MAX_GTX_GRID_CELLS || ikind !== 1 ||
      headerBytes + cells * 4 !== view.byteLength) return null;
  const north = south + (rows - 1) * deltaLat, east = west + (columns - 1) * deltaLon;
  if (north > 90.01 || north < south || east > 720 || east < west) return null;
  let plausible = 0;
  const sampleCount = Math.min(cells, 64);
  for (let index = 0; index < sampleCount; index++) {
    const value = view.getFloat32(headerBytes + index * 4, littleEndian);
    if (Number.isFinite(value) && Math.abs(value) < 1000) plausible++;
  }
  if (plausible < Math.max(1, Math.floor(sampleCount * 0.8))) return null;
  return { littleEndian, headerBytes, south, west, deltaLat, deltaLon, rows, columns, cells, north, east, plausible };
}

export function parseGtxGrid(input, { fileName = 'modele.gtx', maxBytes = MAX_GTX_BYTES } = {}) {
  const bytes = asBytes(input);
  if (bytes.byteLength < 48 || bytes.byteLength > maxBytes) fail(bytes.byteLength > maxBytes ? 'GTX_TOO_LARGE' : 'GTX_INVALID');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const candidates = [];
  for (const headerBytes of [40, 44]) for (const littleEndian of [false, true]) {
    const candidate = headerCandidate(view, littleEndian, headerBytes);
    if (candidate) candidates.push(candidate);
  }
  if (!candidates.length) fail('GTX_INVALID');
  candidates.sort((a, b) => b.plausible - a.plausible || Number(a.littleEndian) - Number(b.littleEndian) || a.headerBytes - b.headerBytes);
  const header = candidates[0];
  const values = new Float32Array(header.cells);
  for (let index = 0; index < header.cells; index++) {
    const value = view.getFloat32(header.headerBytes + index * 4, header.littleEndian);
    values[index] = value;
  }
  return Object.freeze({
    fileName: String(fileName).slice(0, 240), byteLength: bytes.byteLength,
    south: header.south, west: header.west, north: header.north, east: header.east,
    deltaLat: header.deltaLat, deltaLon: header.deltaLon, rows: header.rows, columns: header.columns,
    byteOrder: header.littleEndian ? 'little-endian' : 'big-endian', headerBytes: header.headerBytes,
    values
  });
}

function longitudeForGrid(longitude, grid) {
  let lon = Number(longitude);
  if (grid.west >= 0 && grid.east > 180 && lon < 0) lon += 360;
  else if (grid.west < 0 && grid.east <= 180 && lon > 180) lon -= 360;
  return lon;
}

export function interpolateGeoidUndulation(grid, longitude, latitude) {
  const lon = longitudeForGrid(longitude, grid), lat = Number(latitude);
  if (!grid || !Number.isFinite(lon) || !Number.isFinite(lat) || lat < grid.south - 1e-9 || lat > grid.north + 1e-9 ||
      lon < grid.west - 1e-9 || lon > grid.east + 1e-9) return null;
  const x = Math.max(0, Math.min(grid.columns - 1, (lon - grid.west) / grid.deltaLon));
  const y = Math.max(0, Math.min(grid.rows - 1, (lat - grid.south) / grid.deltaLat));
  const x0 = Math.min(grid.columns - 2, Math.floor(x)), y0 = Math.min(grid.rows - 2, Math.floor(y));
  const tx = x - x0, ty = y - y0;
  const at = (row, column) => Number(grid.values[row * grid.columns + column]);
  const v00 = at(y0, x0), v10 = at(y0, x0 + 1), v01 = at(y0 + 1, x0), v11 = at(y0 + 1, x0 + 1);
  const values = [v00, v10, v01, v11];
  if (values.some(value => !Number.isFinite(value) || Math.abs(value) >= 1e20)) return null;
  const lower = v00 * (1 - tx) + v10 * tx;
  const upper = v01 * (1 - tx) + v11 * tx;
  return lower * (1 - ty) + upper * ty;
}

export function orthometricHeight(ellipsoidalHeight, geoidUndulation) {
  if (ellipsoidalHeight === null || ellipsoidalHeight === undefined || ellipsoidalHeight === '' ||
      geoidUndulation === null || geoidUndulation === undefined || geoidUndulation === '') return null;
  const height = Number(ellipsoidalHeight), undulation = Number(geoidUndulation);
  if (!Number.isFinite(height) || !Number.isFinite(undulation)) return null;
  return height - undulation;
}
