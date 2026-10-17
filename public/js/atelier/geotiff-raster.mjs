import { MAX_IMPORT_BYTES, normalizeCrs, toWgs84 } from './local-layers.mjs';

export const MAX_RASTER_BYTES = MAX_IMPORT_BYTES;
export const MAX_RASTER_PIXELS = 1_000_000;
export const MAX_TOTAL_RASTER_PIXELS = 4_000_000;
export const MAX_TOTAL_RASTER_BYTES = 15 * 1024 * 1024;
export const MAX_RASTER_BANDS = 4;

function fail(code, detail = '') {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  throw error;
}

function asArrayBuffer(input) {
  if (input instanceof ArrayBuffer) return input;
  if (ArrayBuffer.isView(input)) return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  fail('RASTER_INVALID');
}

function rasterCrs(geoKeys) {
  const rawCode = geoKeys?.ProjectedCSTypeGeoKey !== undefined
    ? geoKeys.ProjectedCSTypeGeoKey : geoKeys?.GeographicTypeGeoKey;
  const code = Number(rawCode ?? 0);
  if (!Number.isSafeInteger(code) || code <= 0) fail('RASTER_CRS_REQUIRED');
  try { return normalizeCrs(code); }
  catch { fail('RASTER_CRS_UNSUPPORTED', String(code)); }
}

function checkNorthUp(image) {
  const directory = image.getFileDirectory?.() || {};
  const orientation = Number(Array.isArray(directory.Orientation) ? directory.Orientation[0] : directory.Orientation || 1);
  if (orientation !== 1) fail('RASTER_ORIENTATION_UNSUPPORTED');
  const matrix = directory.ModelTransformation;
  if (Array.isArray(matrix) && matrix.length >= 16 && (Math.abs(Number(matrix[1]) || 0) > 1e-12 || Math.abs(Number(matrix[4]) || 0) > 1e-12))
    fail('RASTER_ROTATED_UNSUPPORTED');
}

function rasterRange(values, width, height, samples, noData) {
  const min = Array(samples).fill(Infinity), max = Array(samples).fill(-Infinity);
  const counts = Array(samples).fill(0);
  let validPixels = 0;
  for (let pixel = 0; pixel < width * height; pixel++) {
    const offset = pixel * samples;
    const first = Number(values[offset]);
    const noDataPixel = noData !== null && first === noData;
    const transparentPixel = samples === 4 && Number(values[offset + 3]) === 0;
    if (noDataPixel || transparentPixel || !Number.isFinite(first)) continue;
    validPixels++;
    for (let band = 0; band < samples; band++) {
      const value = Number(values[offset + band]);
      if (!Number.isFinite(value)) continue;
      min[band] = Math.min(min[band], value);
      max[band] = Math.max(max[band], value);
      counts[band]++;
    }
  }
  if (!validPixels || !Number.isFinite(min[0]) || !Number.isFinite(max[0])) fail('RASTER_NO_VALID_PIXELS');
  return {
    validPixels,
    bands: min.map((minimum, index) => ({
      min: Number.isFinite(minimum) ? minimum : null,
      max: Number.isFinite(max[index]) ? max[index] : null,
      validPixels: counts[index]
    }))
  };
}

function transformBounds(bounds, crs) {
  if (!Array.isArray(bounds) || bounds.length !== 4 || bounds.some(value => !Number.isFinite(Number(value))))
    fail('RASTER_NO_GEOREFERENCE');
  const [west, south, east, north] = bounds.map(Number);
  if (!(east > west) || !(north > south)) fail('RASTER_NO_GEOREFERENCE');
  const cornersSource = [[west, north], [east, north], [east, south], [west, south]];
  const cornersWgs84 = cornersSource.map(([x, y]) => toWgs84(x, y, crs));
  const longitudes = cornersWgs84.map(point => point[0]);
  const latitudes = cornersWgs84.map(point => point[1]);
  if (Math.max(...longitudes) - Math.min(...longitudes) > 180) fail('RASTER_ANTIMERIDIAN_UNSUPPORTED');
  return {
    cornersWgs84,
    boundsWgs84: {
      west: Math.min(...longitudes), south: Math.min(...latitudes),
      east: Math.max(...longitudes), north: Math.max(...latitudes)
    }
  };
}

export async function parseGeoTiff(input, GeoTIFFApi = globalThis.GeoTIFF, { fileName = 'couche.tif' } = {}) {
  let arrayBuffer;
  try { arrayBuffer = asArrayBuffer(input); }
  catch (error) { throw error; }
  if (arrayBuffer.byteLength > MAX_RASTER_BYTES) fail('FILE_TOO_LARGE');
  if (!GeoTIFFApi || typeof GeoTIFFApi.fromArrayBuffer !== 'function') fail('RASTER_READER_UNAVAILABLE');

  let tiff, image;
  try {
    tiff = await GeoTIFFApi.fromArrayBuffer(arrayBuffer);
    image = await tiff.getImage();
  } catch { fail('RASTER_INVALID', fileName); }
  if (!image) fail('RASTER_INVALID', fileName);

  const width = Number(image.getWidth()), height = Number(image.getHeight());
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) fail('RASTER_INVALID');
  const pixelCount = width * height;
  if (!Number.isSafeInteger(pixelCount) || pixelCount > MAX_RASTER_PIXELS) fail('RASTER_TOO_MANY_PIXELS');
  const samplesPerPixel = Number(image.getSamplesPerPixel());
  if (![1, 3, 4].includes(samplesPerPixel) || samplesPerPixel > MAX_RASTER_BANDS) fail('RASTER_BANDS_UNSUPPORTED');

  const sourceCrs = rasterCrs(image.getGeoKeys?.());
  checkNorthUp(image);
  let bounds, resolution, origin;
  try {
    bounds = image.getBoundingBox();
    resolution = image.getResolution();
    origin = image.getOrigin();
  } catch { fail('RASTER_NO_GEOREFERENCE'); }
  const spatial = transformBounds(bounds, sourceCrs);
  if (!Array.isArray(resolution) || !Number.isFinite(Number(resolution[0])) || !Number.isFinite(Number(resolution[1])) ||
      Number(resolution[0]) === 0 || Number(resolution[1]) === 0) fail('RASTER_NO_GEOREFERENCE');

  let values;
  try { values = await image.readRasters({ interleave: true }); }
  catch { fail('RASTER_DECODE_FAILED', fileName); }
  if (!ArrayBuffer.isView(values) || values.length !== pixelCount * samplesPerPixel) fail('RASTER_INVALID');
  const noDataValue = image.getGDALNoData?.();
  const hasNoData = noDataValue !== null && noDataValue !== undefined && String(noDataValue).trim() !== '';
  const noData = hasNoData && Number.isFinite(Number(noDataValue)) ? Number(noDataValue) : null;
  const statistics = rasterRange(values, width, height, samplesPerPixel, noData);
  const pixelSize = [Math.abs(Number(resolution[0])), Math.abs(Number(resolution[1]))];
  return {
    format: 'GeoTIFF', fileName: String(fileName).slice(0, 240),
    sourceCrs, crs: 'EPSG:4326', width, height, pixelCount, samplesPerPixel,
    dataType: values.constructor.name, noData,
    origin: origin.map(Number), resolution: resolution.map(Number), pixelSize,
    sourceBounds: bounds.map(Number), cornersWgs84: spatial.cornersWgs84,
    boundsWgs84: spatial.boundsWgs84, validPixels: statistics.validPixels,
    bands: statistics.bands, values
  };
}
