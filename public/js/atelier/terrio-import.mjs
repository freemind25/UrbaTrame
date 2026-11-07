/* Import de fichiers SIG locaux via terrio-js/core (Rust compilé en WebAssembly,
   auto-hébergé sous /vendor/terrio/ — aucun CDN, conforme RGPD).
   Le module WASM (~15 Mo) n'est téléchargé qu'à la première utilisation, puis mis
   en cache par le navigateur. Si le moteur terrio ne parvient pas à lire un fichier
   (code TERRIO_PARSE_FAILED / TERRIO_ENGINE_UNAVAILABLE), l'appelant retombe sur
   les lecteurs historiques (sql.js, geotiff.js, parseurs maison). */

import {
  MAX_LAYERS, normalizeCrs, toWgs84, parseGeoJSONText
} from './local-layers.mjs';
import { MAX_RASTER_PIXELS, rasterRange } from './geotiff-raster.mjs';

export const TERRIO_VECTOR_EXTENSIONS = new Set(['gpkg', 'fgb', 'geojson', 'json', 'kml', 'kmz', 'gml', 'gpx']);
export const TERRIO_RASTER_EXTENSIONS = new Set(['tif', 'tiff']);

export function extensionOf(fileName) {
  return String(fileName || '').split('.').pop()?.toLowerCase() || '';
}

export function terrioSupported(extension) {
  return TERRIO_VECTOR_EXTENSIONS.has(extension) || TERRIO_RASTER_EXTENSIONS.has(extension);
}

function coded(code, detail = '') {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  return error;
}

let terrioModulePromise = null;

export function terrioModuleUrl() {
  return globalThis.__TERRIO_CORE_URL__ || '/vendor/terrio/core/terrio.js';
}

export async function loadTerrio() {
  if (!terrioModulePromise) {
    terrioModulePromise = (async () => {
      let mod;
      try {
        mod = await import(terrioModuleUrl());
      } catch (error) {
        throw coded('TERRIO_ENGINE_UNAVAILABLE', error?.message || '');
      }
      try {
        if (globalThis.__TERRIO_WASM_PATH__) {
          // Node.js (tests) : fetch() ne suit pas les URL file:, on passe les octets.
          const { readFileSync } = await import('node:fs');
          await mod.default({ module_or_path: readFileSync(globalThis.__TERRIO_WASM_PATH__) });
        } else {
          // Navigateur : le glue wasm-bindgen charge terrio_bg.wasm à côté du .js.
          await mod.default();
        }
      } catch (error) {
        throw coded('TERRIO_ENGINE_UNAVAILABLE', error?.message || '');
      }
      return mod;
    })();
    terrioModulePromise.catch(() => { terrioModulePromise = null; });
  }
  return terrioModulePromise;
}

function openDataset(terrio, bytes, fileName) {
  try {
    return terrio.open(bytes, fileName);
  } catch (error) {
    throw coded('TERRIO_PARSE_FAILED', error?.message || String(error));
  }
}

function safeSourceCrs(raw) {
  const value = String(raw || '').trim();
  if (!value) return 'EPSG:4326';
  try { return normalizeCrs(value); } catch { return value; }
}

function formatLabel(fileName) {
  const labels = {
    gpkg: 'GeoPackage', fgb: 'FlatGeobuf', geojson: 'GeoJSON', json: 'GeoJSON',
    kml: 'KML', kmz: 'KMZ', gml: 'GML', gpx: 'GPX', tif: 'GeoTIFF', tiff: 'GeoTIFF'
  };
  const ext = extensionOf(fileName);
  return labels[ext] || ext.toUpperCase();
}

/* Vecteur : chaque couche est réexportée en WGS 84 par le moteur PROJ de terrio
   (toBytes + tSrs, donc tout CRS supporté, pas seulement UTM/3857), puis passée
   dans parseGeoJSONText pour la validation/normalisation habituelle d'UrbaTrame. */
export function importVectorWithTerrio(bytes, fileName, terrio) {
  const ds = openDataset(terrio, bytes, fileName);
  try {
    if (ds.kind !== 'vector') throw coded('TERRIO_PARSE_FAILED', 'jeu de données non vectoriel');
    const names = ds.layerNames();
    if (!names.length) throw coded('TERRIO_NO_VECTOR_LAYERS');
    if (names.length > MAX_LAYERS) throw coded('TERRIO_TOO_MANY_LAYERS', `${names.length}`);
    const rawCrs = ds.crs ? String(ds.crs) : 'EPSG:4326';
    const sourceCrs = safeSourceCrs(rawCrs);
    const stem = String(fileName).replace(/\.[^.]+$/, '') || 'couche';
    return names.map((name, index) => {
      const layerName = String(name);
      let parsed;
      try {
        const out = ds.toBytes(`${stem}-${index}.geojson`, { tSrs: 'EPSG:4326', layers: [layerName] });
        parsed = JSON.parse(new TextDecoder().decode(out));
        parsed.crs = { type: 'name', properties: { name: 'EPSG:4326' } };
      } catch {
        // Repli : couche telle quelle, dans son CRS d'origine.
        parsed = ds.toGeoJSON(index);
        parsed.crs = { type: 'name', properties: { name: rawCrs } };
      }
      const geojson = parseGeoJSONText(JSON.stringify(parsed), { fileName: `${fileName} · ${layerName}` });
      geojson.sourceCrs = sourceCrs;
      geojson.urbatrame = { format: formatLabel(fileName), layer: layerName.slice(0, 240), engine: 'terrio-js' };
      return {
        name: layerName.slice(0, 100) || String(fileName),
        fileName: `${String(fileName).slice(0, 200)} · ${layerName.slice(0, 100)}`,
        sourceCrs,
        geojson
      };
    });
  } finally {
    try { ds.free(); } catch { /* déjà libéré */ }
  }
}

function cornersToWgs84(corners, rawCrs, terrio, normalizedCrs) {
  if (rawCrs) {
    try {
      const xs = new Float64Array(corners.map(([x]) => x));
      const ys = new Float64Array(corners.map(([, y]) => y));
      const [xsOut, ysOut] = terrio.transformPoints(xs, ys, String(rawCrs), 'EPSG:4326', null, {});
      const points = corners.map((_, i) => [Number(xsOut[i]), Number(ysOut[i])]);
      if (points.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))) return points;
    } catch { /* repli sur toWgs84 ci-dessous */ }
  }
  return corners.map(([x, y]) => toWgs84(x, y, normalizedCrs));
}

/* Raster : bandes entrelacées comme parseGeoTiff (readRasters interleave), mêmes
   codes d'erreur et mêmes statistiques (rasterRange réutilisé). */
export function importRasterWithTerrio(bytes, fileName, terrio) {
  const ds = openDataset(terrio, bytes, fileName);
  try {
    if (ds.kind !== 'raster') throw coded('TERRIO_PARSE_FAILED', 'jeu de données non raster');
    const width = Number(ds.width), height = Number(ds.height), count = Number(ds.count);
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1)
      throw coded('RASTER_INVALID', String(fileName));
    const pixelCount = width * height;
    if (!Number.isSafeInteger(pixelCount) || pixelCount > MAX_RASTER_PIXELS) throw coded('RASTER_TOO_MANY_PIXELS');
    if (![1, 3, 4].includes(count)) throw coded('RASTER_BANDS_UNSUPPORTED');
    const transform = Array.from(ds.transform || [], Number);
    if (transform.length < 6 || transform.some(value => !Number.isFinite(value))) throw coded('RASTER_NO_GEOREFERENCE');
    const [originX, resX, rotX, originY, rotY, resY] = transform;
    if (rotX !== 0 || rotY !== 0) throw coded('RASTER_ROTATED_UNSUPPORTED');
    if (resX === 0 || resY === 0) throw coded('RASTER_NO_GEOREFERENCE');
    if (resY > 0) throw coded('RASTER_ORIENTATION_UNSUPPORTED');
    const rawCrs = ds.crs ? String(ds.crs) : '';
    const sourceCrs = safeSourceCrs(rawCrs);
    const origin = [originX, originY];
    const resolution = [resX, resY];
    const west = originX, east = originX + width * resX;
    const north = originY, south = originY + height * resY;
    if (!(east > west) || !(north > south)) throw coded('RASTER_NO_GEOREFERENCE');
    const cornersSource = [[west, north], [east, north], [east, south], [west, south]];
    const cornersWgs84 = cornersToWgs84(cornersSource, rawCrs, terrio, sourceCrs);
    const longitudes = cornersWgs84.map(([x]) => x);
    const latitudes = cornersWgs84.map(([, y]) => y);
    if (Math.max(...longitudes) - Math.min(...longitudes) > 180) throw coded('RASTER_ANTIMERIDIAN_UNSUPPORTED');
    const boundsWgs84 = {
      west: Math.min(...longitudes), south: Math.min(...latitudes),
      east: Math.max(...longitudes), north: Math.max(...latitudes)
    };
    const bands = [];
    for (let band = 1; band <= count; band++) {
      let values;
      try { values = ds.readBand(band); }
      catch (error) { throw coded('RASTER_DECODE_FAILED', String(fileName)); }
      if (!ArrayBuffer.isView(values) || values.length !== pixelCount) throw coded('RASTER_INVALID', String(fileName));
      bands.push(values);
    }
    const Ctor = bands[0].constructor;
    const values = new Ctor(pixelCount * count);
    for (let pixel = 0; pixel < pixelCount; pixel++)
      for (let band = 0; band < count; band++)
        values[pixel * count + band] = bands[band][pixel];
    const noData = typeof ds.nodata === 'number' && Number.isFinite(ds.nodata) ? ds.nodata : null;
    const statistics = rasterRange(values, width, height, count, noData);
    return {
      format: 'GeoTIFF', fileName: String(fileName).slice(0, 240),
      sourceCrs, crs: 'EPSG:4326', width, height, pixelCount, samplesPerPixel: count,
      dataType: Ctor.name, noData,
      origin, resolution, pixelSize: [Math.abs(resX), Math.abs(resY)],
      sourceBounds: [west, south, east, north], cornersWgs84, boundsWgs84,
      validPixels: statistics.validPixels, bands: statistics.bands, values,
      engine: 'terrio-js'
    };
  } finally {
    try { ds.free(); } catch { /* déjà libéré */ }
  }
}

export async function importFileWithTerrio(bytes, fileName) {
  const terrio = await loadTerrio();
  const ext = extensionOf(fileName);
  if (TERRIO_VECTOR_EXTENSIONS.has(ext))
    return { kind: 'vector', layers: importVectorWithTerrio(bytes, fileName, terrio) };
  if (TERRIO_RASTER_EXTENSIONS.has(ext))
    return { kind: 'raster', raster: importRasterWithTerrio(bytes, fileName, terrio) };
  throw coded('TERRIO_UNSUPPORTED_EXTENSION', ext);
}
