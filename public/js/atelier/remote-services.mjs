import { MAX_IMPORT_BYTES, MAX_COORDINATE_POSITIONS, parseGeoJSONText, countFeaturePositions } from './local-layers.mjs';

export const REMOTE_PAGE_SIZE = 1_000;
export const MAX_REMOTE_FEATURES = 5_000;
export const MAX_REMOTE_PAGES = 10;
export const MAX_REMOTE_TOTAL_BYTES = 30 * 1024 * 1024;
export const REMOTE_REQUEST_TIMEOUT_MS = 30_000;

export function buildWmtsTileUrl({ url: rawUrl, layer, matrixSet = 'GoogleMapsCompatible', style = 'default', format = 'image/png' }, zoom, row, column) {
  let url;
  try { url = new URL(rawUrl); } catch { throw Object.assign(new Error('SERVICE_URL_INVALID'), { code: 'SERVICE_URL_INVALID' }); }
  if (url.protocol !== 'https:' || !layer || !matrixSet || !Number.isInteger(zoom) || !Number.isInteger(row) || !Number.isInteger(column) || zoom < 0 || zoom > 30)
    throw Object.assign(new Error('WMTS_PARAMETERS_INVALID'), { code: 'WMTS_PARAMETERS_INVALID' });
  if (!['GoogleMapsCompatible', 'WebMercatorQuad'].includes(matrixSet))
    throw Object.assign(new Error('WMTS_MATRIXSET_UNSUPPORTED'), { code: 'WMTS_MATRIXSET_UNSUPPORTED' });
  const matrixSize = 2 ** zoom;
  if (row < 0 || row >= matrixSize || column < 0 || column >= matrixSize)
    throw Object.assign(new Error('WMTS_PARAMETERS_INVALID'), { code: 'WMTS_PARAMETERS_INVALID' });
  for (const [key, value] of Object.entries({ SERVICE: 'WMTS', REQUEST: 'GetTile', VERSION: '1.0.0', LAYER: layer, STYLE: style, FORMAT: format, TILEMATRIXSET: matrixSet, TILEMATRIX: String(zoom), TILEROW: String(row), TILECOL: String(column) })) url.searchParams.set(key, value);
  return url.href;
}

export function buildVectorRequestUrl(type, rawUrl, typeName = '', offset = 0) {
  let url;
  try { url = new URL(rawUrl); } catch { throw Object.assign(new Error('SERVICE_URL_INVALID'), { code: 'SERVICE_URL_INVALID' }); }
  if (url.protocol !== 'https:') throw Object.assign(new Error('SERVICE_HTTPS_REQUIRED'), { code: 'SERVICE_HTTPS_REQUIRED' });
  if (!Number.isSafeInteger(offset) || offset < 0) throw Object.assign(new Error('SERVICE_OFFSET_INVALID'), { code: 'SERVICE_OFFSET_INVALID' });
  if (type === 'geojson') {
    if (offset !== 0) throw Object.assign(new Error('SERVICE_PAGINATION_UNSUPPORTED'), { code: 'SERVICE_PAGINATION_UNSUPPORTED' });
    return url;
  }
  if (type === 'wfs') {
    if (!String(typeName || '').trim()) throw Object.assign(new Error('WFS_TYPE_REQUIRED'), { code: 'WFS_TYPE_REQUIRED' });
    for (const [key, value] of Object.entries({ SERVICE: 'WFS', VERSION: '2.0.0', REQUEST: 'GetFeature', TYPENAMES: typeName.trim(), OUTPUTFORMAT: 'application/json', SRSNAME: 'urn:ogc:def:crs:OGC:1.3:CRS84', COUNT: String(REMOTE_PAGE_SIZE), STARTINDEX: String(offset) })) url.searchParams.set(key, value);
    return url;
  }
  if (type === 'arcgis' || type === 'arcgis-map') {
    const serviceType = type === 'arcgis-map' ? 'MapServer' : 'FeatureServer';
    const path = url.pathname.replace(/\/+$/, '');
    const layerPath = new RegExp(`/${serviceType}/\\d+$`, 'i');
    const queryPath = new RegExp(`/${serviceType}/\\d+/query$`, 'i');
    if (layerPath.test(path)) url.pathname = `${path}/query`;
    else if (!queryPath.test(path)) {
      const code = type === 'arcgis-map' ? 'ARCGIS_MAP_LAYER_REQUIRED' : 'ARCGIS_FEATURE_LAYER_REQUIRED';
      throw Object.assign(new Error(code), { code });
    }
    for (const [key, value] of Object.entries({ where: '1=1', outFields: '*', returnGeometry: 'true', outSR: '4326', f: 'geojson', resultRecordCount: String(REMOTE_PAGE_SIZE), resultOffset: String(offset) })) url.searchParams.set(key, value);
    return url;
  }
  throw Object.assign(new Error('SERVICE_TYPE_UNSUPPORTED'), { code: 'SERVICE_TYPE_UNSUPPORTED' });
}

function fingerprintFeatures(features) {
  let a = 0x811c9dc5, b = 0x9e3779b9;
  for (const feature of features) {
    const text = JSON.stringify(feature);
    for (let index = 0; index < text.length; index++) {
      const value = text.charCodeAt(index);
      a = Math.imul(a ^ value, 0x01000193);
      b = Math.imul(b ^ value, 0x85ebca6b);
    }
    a = Math.imul(a ^ 255, 0x01000193);
    b = Math.imul(b ^ 255, 0x85ebca6b);
  }
  return `${features.length}:${a >>> 0}:${b >>> 0}`;
}

async function readRemoteText(response, maxBytes) {
  const declared = Number(response.headers?.get?.('content-length') || 0);
  if (declared > maxBytes) throw Object.assign(new Error('FILE_TOO_LARGE'), { code: 'FILE_TOO_LARGE' });
  if (!response.body?.getReader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw Object.assign(new Error('FILE_TOO_LARGE'), { code: 'FILE_TOO_LARGE' });
    return text;
  }
  const reader = response.body.getReader(), chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw Object.assign(new Error('FILE_TOO_LARGE'), { code: 'FILE_TOO_LARGE' });
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) { bytes.set(chunk, cursor); cursor += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

/** Fetches one GeoJSON response or bounded WFS/ArcGIS pages after explicit user action. */
export async function fetchPaginatedVectorService({
  type, rawUrl, typeName = '', fetcher = globalThis.fetch,
  maxPageBytes = MAX_IMPORT_BYTES, maxTotalBytes = MAX_REMOTE_TOTAL_BYTES,
  maxFeatures = MAX_REMOTE_FEATURES, maxPositions = MAX_COORDINATE_POSITIONS,
  timeoutMs = REMOTE_REQUEST_TIMEOUT_MS
} = {}) {
  if (typeof fetcher !== 'function') throw new TypeError('A fetch implementation is required.');
  if (!Number.isSafeInteger(maxFeatures) || maxFeatures < 1) throw new TypeError('maxFeatures must be a positive safe integer.');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new TypeError('timeoutMs must be a positive safe integer.');
  const features = [];
  let pages = 0, totalBytes = 0, positions = 0, truncated = false, truncationReason = null, firstPage = null, offset = 0;
  const seenPageFingerprints = new Set();
  const canPaginate = type === 'wfs' || type === 'arcgis' || type === 'arcgis-map';
  while (true) {
    const url = buildVectorRequestUrl(type, rawUrl, typeName, offset);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response, text;
    try {
      response = await fetcher(url.href, {
        mode: 'cors', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal,
        headers: { Accept: 'application/geo+json, application/json' }
      });
      if (!response.ok) throw new Error(`Le service répond HTTP ${response.status}.`);
      text = await readRemoteText(response, maxPageBytes);
    } catch (error) {
      if (controller.signal.aborted) throw Object.assign(new Error('SERVICE_TIMEOUT'), { code: 'SERVICE_TIMEOUT' });
      throw error;
    } finally { clearTimeout(timeout); }
    totalBytes += new TextEncoder().encode(text).byteLength;
    if (totalBytes > maxTotalBytes) throw Object.assign(new Error('REMOTE_TOTAL_TOO_LARGE'), { code: 'REMOTE_TOTAL_TOO_LARGE' });
    let body;
    try { body = JSON.parse(text); } catch { body = null; }
    const page = parseGeoJSONText(text, { fileName: `service-${type}.geojson` });
    if (!firstPage) firstPage = page;
    if (canPaginate && page.features.length > REMOTE_PAGE_SIZE) throw Object.assign(new Error('REMOTE_PAGE_FEATURE_LIMIT'), { code: 'REMOTE_PAGE_FEATURE_LIMIT' });
    if (canPaginate && page.features.length) {
      const fingerprint = fingerprintFeatures(page.features);
      if (seenPageFingerprints.has(fingerprint)) throw Object.assign(new Error('REMOTE_PAGINATION_REPEATED'), { code: 'REMOTE_PAGINATION_REPEATED' });
      seenPageFingerprints.add(fingerprint);
    }
    const remaining = canPaginate ? Math.max(0, maxFeatures - features.length) : page.features.length;
    const acceptedFeatures = canPaginate ? page.features.slice(0, remaining) : page.features;
    const pagePositions = countFeaturePositions(acceptedFeatures);
    if (positions + pagePositions > maxPositions) throw Object.assign(new Error('TOO_MANY_COORDINATES'), { code: 'TOO_MANY_COORDINATES' });
    positions += pagePositions;
    features.push(...acceptedFeatures);
    pages++;
    if (!canPaginate) break;
    const reportedTotal = Number(body?.numberMatched);
    const hasReportedTotal = body?.numberMatched !== undefined && Number.isSafeInteger(reportedTotal) && reportedTotal >= 0;
    const pageEnd = offset + page.features.length;
    const knownComplete = hasReportedTotal && pageEnd >= reportedTotal;
    const serverHasMore = body?.exceededTransferLimit === true || hasReportedTotal && pageEnd < reportedTotal;
    const pageMayContinue = serverHasMore || page.features.length === REMOTE_PAGE_SIZE && !knownComplete;
    if (!page.features.length) {
      if (serverHasMore) throw Object.assign(new Error('REMOTE_PAGINATION_STALLED'), { code: 'REMOTE_PAGINATION_STALLED' });
      break;
    }
    if (features.length >= maxFeatures) {
      truncated = page.features.length > acceptedFeatures.length || serverHasMore || page.features.length === REMOTE_PAGE_SIZE && !knownComplete;
      truncationReason = truncated ? 'FEATURE_LIMIT' : null;
      break;
    }
    if (!pageMayContinue) break;
    if (pages >= MAX_REMOTE_PAGES) { truncated = true; truncationReason = 'PAGE_LIMIT'; break; }
    offset += page.features.length;
  }
  const geojson = firstPage ? {
    ...firstPage, features, remotePages: pages, remoteTruncated: truncated,
    ...(truncationReason ? { remoteTruncationReason: truncationReason } : {})
  } : null;
  return { geojson, pages, features: features.length, truncated, truncationReason, totalBytes, positions };
}
