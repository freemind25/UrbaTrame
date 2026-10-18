export const MAX_STUDY_RADIUS_M = 3000;
export const MIN_VIEW_RADIUS_M = 100;
export const MAX_CADRAGES = 40;
export const MAX_ANNOTATIONS = 300;
export const MAX_CADRAGE_PROJECT_BYTES = 15 * 1024 * 1024;
export const CADRAGE_PROJECT_TYPE = 'urbatrame-spatial-framing-project';
export const CADRAGE_PROJECT_VERSION = 1;

export const LEVELS = Object.freeze([
  { id: 'wilaya-country', label: 'Wilaya / pays', title: 'Situation de la wilaya de {wilaya} par rapport au territoire national', schematic: true, defaultRadius: 3000, defaultScale: null },
  { id: 'city-wilaya', label: 'Ville / wilaya', title: 'Situation de la ville de {city} dans la wilaya de {wilaya}', schematic: true, defaultRadius: 3000, defaultScale: null },
  { id: 'neighborhood-city', label: 'Quartier / ville', title: 'Situation du quartier {study} dans la ville de {city}', schematic: false, defaultRadius: 1000, defaultScale: 8000 },
  { id: 'neighborhood-environment', label: 'Quartier / environnement proche', title: 'Quartier {study} et son environnement proche', schematic: false, defaultRadius: 500, defaultScale: 4000 }
]);

export const LAYERS = Object.freeze([
  { id: 'country', label: 'Limite nationale · GADM', color: '#526275', line: true, defaultOn: true, source: 'GADM' },
  { id: 'wilaya', label: 'Limites de wilaya · GADM', color: '#76649b', line: true, defaultOn: true, source: 'GADM' },
  { id: 'commune', label: 'Unités administratives · GADM', color: '#b3945f', line: true, defaultOn: true, source: 'GADM' },
  { id: 'study', label: 'Périmètre étudié', color: '#e34e32', line: true, defaultOn: true, source: 'Utilisateur' },
  { id: 'roadsMain', label: 'Axes principaux', color: '#b94d3a', line: true, defaultOn: true, source: 'OpenStreetMap' },
  { id: 'roadsSecondary', label: 'Voies importantes', color: '#da8a44', line: true, defaultOn: true, source: 'OpenStreetMap' },
  { id: 'roadsLocal', label: 'Rues locales', color: '#c8b58c', line: true, defaultOn: true, source: 'OpenStreetMap' },
  { id: 'pedestrian', label: 'Parcours piétons / vélos', color: '#568c71', line: true, defaultOn: true, source: 'OpenStreetMap' },
  { id: 'buildings', label: 'Bâtiments cartographiés', color: '#85817b', line: false, defaultOn: true, source: 'OpenStreetMap' },
  { id: 'centralities', label: 'Centralités cartographiées', color: '#c05b2b', line: false, defaultOn: true, source: 'OpenStreetMap' },
  { id: 'neighborhoods', label: 'Quartiers nommés / voisins', color: '#b2703f', line: true, defaultOn: true, source: 'OpenStreetMap' },
  { id: 'equipment', label: 'Équipements et services', color: '#7b5ba6', line: false, defaultOn: true, source: 'OpenStreetMap' },
  { id: 'transport', label: 'Arrêts / points de transport', color: '#226b81', line: false, defaultOn: true, source: 'OpenStreetMap' },
  { id: 'green', label: 'Espaces verts', color: '#5c9a5f', line: false, defaultOn: true, source: 'OpenStreetMap' },
  { id: 'water', label: 'Cours d’eau et plans d’eau', color: '#4a93c6', line: true, defaultOn: true, source: 'OpenStreetMap' },
  { id: 'rail', label: 'Voies ferrées', color: '#4b4a55', line: true, defaultOn: true, source: 'OpenStreetMap' },
  { id: 'barriers', label: 'Murs / barrières cartographiés', color: '#705942', line: true, defaultOn: false, source: 'OpenStreetMap' },
  { id: 'relief', label: 'Relief disponible', color: '#8b9869', line: false, defaultOn: false, source: 'Terrarium' },
  { id: 'local', label: 'Couche locale importée', color: '#167e83', line: true, defaultOn: true, source: 'Utilisateur' },
  { id: 'annotations', label: 'Annotations', color: '#b24d3b', line: false, defaultOn: true, source: 'Utilisateur' }
]);

const LEVEL_IDS = new Set(LEVELS.map(level => level.id));
const LAYER_IDS = new Set(LAYERS.map(layer => layer.id));
const ANNOTATION_TYPES = new Set(['point', 'line', 'arrow', 'zone', 'text']);
const SAFE_ID = /^[\w.-]{1,100}$/;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function cleanText(value, max = 160) {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
    : '';
}

export function validCoordinate(point) {
  return Array.isArray(point) && point.length >= 2 && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])) &&
    Math.abs(Number(point[0])) <= 180 && Math.abs(Number(point[1])) <= 85;
}

export function normalizeCenter(value) {
  const lat = Number(value?.lat), lon = Number(value?.lon);
  if (!Number.isFinite(lat) || Math.abs(lat) > 85 || !Number.isFinite(lon) || Math.abs(lon) > 180) return null;
  return { lat, lon, name: cleanText(value?.name || '', 180) };
}

export function distanceMeters(a, b) {
  const p1 = Array.isArray(a) ? [Number(a[1]), Number(a[0])] : [Number(a?.lat), Number(a?.lon)];
  const p2 = Array.isArray(b) ? [Number(b[1]), Number(b[0])] : [Number(b?.lat), Number(b?.lon)];
  if (![...p1, ...p2].every(Number.isFinite)) return Infinity;
  const rad = Math.PI / 180, dLat = (p2[0] - p1[0]) * rad, dLon = (p2[1] - p1[1]) * rad;
  const sinLat = Math.sin(dLat / 2), sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(p1[0] * rad) * Math.cos(p2[0] * rad) * sinLon * sinLon;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(Math.max(0, h)), Math.sqrt(Math.max(0, 1 - h)));
}

/* GeoJSON positions are [longitude, latitude]. */
export function toLocalMeters(position, center) {
  if (!validCoordinate(position) || !center) return [NaN, NaN];
  const lon0 = Number(center.lon), lat0 = Number(center.lat), rad = Math.PI / 180;
  return [
    (Number(position[0]) - lon0) * 111320 * Math.cos(lat0 * rad),
    (Number(position[1]) - lat0) * 111320
  ];
}

export function fromLocalMeters(x, y, center) {
  const lat0 = Number(center?.lat), lon0 = Number(center?.lon);
  if (!Number.isFinite(lat0) || !Number.isFinite(lon0) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const cos = Math.max(0.01, Math.cos(lat0 * Math.PI / 180));
  return [lon0 + x / (111320 * cos), lat0 + y / 111320];
}

function openRing(points) {
  if (!Array.isArray(points)) return [];
  const valid = points.filter(validCoordinate).map(point => [Number(point[0]), Number(point[1])]);
  if (valid.length > 1 && valid[0][0] === valid.at(-1)[0] && valid[0][1] === valid.at(-1)[1]) valid.pop();
  return valid;
}

export function perimeterCoordinates(perimeter) {
  if (!perimeter || typeof perimeter !== 'object') return [];
  if (perimeter.type === 'circle') {
    const center = perimeter.center;
    const radius = Number(perimeter.radiusMeters);
    if (!validCoordinate(center) || !Number.isFinite(radius) || radius <= 0) return [];
    const lat0 = Number(center[1]), lon0 = Number(center[0]);
    const ring = [];
    for (let index = 0; index < 64; index++) {
      const angle = 2 * Math.PI * index / 64;
      const point = fromLocalMeters(Math.cos(angle) * radius, Math.sin(angle) * radius, { lat: lat0, lon: lon0 });
      if (point) ring.push(point);
    }
    if (ring.length) ring.push([...ring[0]]);
    return ring;
  }
  return openRing(perimeter.coordinates);
}

export function perimeterStats(perimeter, center) {
  if (!perimeter) return { areaM2: 0, perimeterM: 0, widthM: 0, heightM: 0, maxDistanceM: 0 };
  if (perimeter.type === 'circle') {
    const radius = Number(perimeter.radiusMeters);
    const base = validCoordinate(perimeter.center) ? perimeter.center : [center?.lon, center?.lat];
    const offset = center ? distanceMeters([center.lon, center.lat], base) : 0;
    return {
      areaM2: Math.PI * radius * radius,
      perimeterM: 2 * Math.PI * radius,
      widthM: 2 * radius,
      heightM: 2 * radius,
      maxDistanceM: offset + radius
    };
  }
  const points = openRing(perimeter.coordinates);
  const local = points.map(point => toLocalMeters(point, center));
  if (local.length < 3 || local.some(point => !point.every(Number.isFinite)))
    return { areaM2: 0, perimeterM: 0, widthM: 0, heightM: 0, maxDistanceM: Infinity };
  let twiceArea = 0, length = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, maxDistanceM = 0;
  for (let index = 0; index < local.length; index++) {
    const a = local[index], b = local[(index + 1) % local.length];
    twiceArea += a[0] * b[1] - b[0] * a[1];
    length += Math.hypot(b[0] - a[0], b[1] - a[1]);
    minX = Math.min(minX, a[0]); maxX = Math.max(maxX, a[0]);
    minY = Math.min(minY, a[1]); maxY = Math.max(maxY, a[1]);
    maxDistanceM = Math.max(maxDistanceM, Math.hypot(a[0], a[1]));
  }
  return { areaM2: Math.abs(twiceArea) / 2, perimeterM: length, widthM: maxX - minX, heightM: maxY - minY, maxDistanceM };
}

export function validatePerimeter(perimeter, center, { required = true, maxRadius = MAX_STUDY_RADIUS_M } = {}) {
  if (!perimeter) return required ? { ok: false, code: 'PERIMETER_REQUIRED', stats: perimeterStats(null, center) } : { ok: true, code: '', stats: perimeterStats(null, center) };
  const c = normalizeCenter(center);
  if (!c) return { ok: false, code: 'INVALID_CENTER', stats: perimeterStats(perimeter, center) };
  if (perimeter.type === 'circle') {
    const radius = Number(perimeter.radiusMeters);
    if (!validCoordinate(perimeter.center) || !Number.isFinite(radius) || radius < 1)
      return { ok: false, code: 'INVALID_PERIMETER', stats: perimeterStats(perimeter, center) };
  } else if (perimeter.type === 'polygon' || perimeter.type === 'rectangle') {
    const points = openRing(perimeter.coordinates);
    if (points.length < 3 || points.length > 1000)
      return { ok: false, code: 'INVALID_PERIMETER', stats: perimeterStats(perimeter, center) };
  } else {
    return { ok: false, code: 'INVALID_PERIMETER', stats: perimeterStats(perimeter, center) };
  }
  const stats = perimeterStats(perimeter, c);
  if (!(stats.areaM2 > 0) || !Number.isFinite(stats.maxDistanceM))
    return { ok: false, code: 'INVALID_PERIMETER', stats };
  if (stats.maxDistanceM > maxRadius + 0.5)
    return { ok: false, code: 'PERIMETER_TOO_LARGE', stats };
  return { ok: true, code: '', stats };
}

export function scaleDenominator(viewRadiusM, mapWidthMm) {
  const radius = Number(viewRadiusM), width = Number(mapWidthMm);
  if (!Number.isFinite(radius) || radius <= 0 || !Number.isFinite(width) || width <= 0) return null;
  return Math.round(2000 * radius / width);
}

export function radiusForScale(scale, mapWidthMm) {
  const denominator = Number(scale), width = Number(mapWidthMm);
  if (!Number.isFinite(denominator) || denominator <= 0 || !Number.isFinite(width) || width <= 0) return null;
  return denominator * width / 2000;
}

export function defaultTitle(levelId, values = {}) {
  const level = LEVELS.find(item => item.id === levelId) || LEVELS[0];
  const names = {
    wilaya: cleanText(values.wilaya || 'à sélectionner', 100),
    city: cleanText(values.city || values.commune || 'à sélectionner', 100),
    study: cleanText(values.study || 'à définir', 100)
  };
  return level.title.replace(/\{(wilaya|city|study)\}/g, (_match, key) => names[key]);
}

export function defaultLayerVisibility() {
  return Object.fromEntries(LAYERS.map(layer => [layer.id, layer.defaultOn]));
}

export function normalizeAnnotation(raw, index = 0) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !ANNOTATION_TYPES.has(raw.type)) return null;
  const id = typeof raw.id === 'string' && SAFE_ID.test(raw.id) ? raw.id : `annotation-${index + 1}`;
  const color = typeof raw.color === 'string' && HEX_COLOR.test(raw.color) ? raw.color : '#b24d3b';
  const width = Math.min(12, Math.max(1, Number(raw.width) || 3));
  const text = cleanText(raw.text || raw.category || '', 160);
  if (raw.type === 'point' || raw.type === 'text') {
    if (!validCoordinate(raw.position)) return null;
    return { id, type: raw.type, position: [Number(raw.position[0]), Number(raw.position[1])], text, category: cleanText(raw.category || '', 40), color, width };
  }
  const points = openRing(raw.coordinates);
  const minimum = raw.type === 'zone' ? 3 : 2;
  if (points.length < minimum || points.length > 1000) return null;
  return { id, type: raw.type, coordinates: points, text, category: cleanText(raw.category || '', 40), color, width };
}

export function normalizeAnnotations(value) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeAnnotation).filter(Boolean).slice(0, MAX_ANNOTATIONS);
}

function safeLayerVisibility(value) {
  const defaults = defaultLayerVisibility();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults;
  for (const key of Object.keys(defaults)) defaults[key] = value[key] !== false;
  return defaults;
}

function validTimestamp(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && Number.isFinite(new Date(number).getTime()) ? number : fallback;
}

export function normalizeFramingRecord(raw, { requirePerimeter = undefined, now = Date.now() } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.version !== CADRAGE_PROJECT_VERSION) return null;
  const level = String(raw.level || '');
  if (!LEVEL_IDS.has(level)) return null;
  const schematic = LEVELS.find(item => item.id === level)?.schematic;
  const center = normalizeCenter(raw.center);
  const name = cleanText(raw.name || '', 100);
  if (!center || !name) return null;
  const perimeter = raw.perimeter && typeof raw.perimeter === 'object' ? raw.perimeter : null;
  const needsPerimeter = requirePerimeter ?? !schematic;
  const validation = validatePerimeter(perimeter, center, { required: needsPerimeter });
  if (!validation.ok) return null;
  const viewRadius = Number(raw.viewRadius);
  if (!Number.isFinite(viewRadius) || viewRadius < MIN_VIEW_RADIUS_M || viewRadius > MAX_STUDY_RADIUS_M) return null;
  const scale = Number(raw.scaleDenominator);
  if (scale !== 0 && (!Number.isFinite(scale) || scale < 500 || scale > 200_000)) return null;
  const createdAt = validTimestamp(raw.createdAt, now), updatedAt = validTimestamp(raw.updatedAt, now);
  const id = typeof raw.id === 'string' && SAFE_ID.test(raw.id) ? raw.id : `cadrage-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const areaName = cleanText(raw.projectName || '', 100);
  const studyName = cleanText(raw.studyName || '', 100);
  const countryCode = /^[A-Z0-9]{3}$/.test(String(raw.countryCode || 'DZA')) ? String(raw.countryCode || 'DZA') : 'DZA';
  const wilayaGid = typeof raw.wilayaGid === 'string' && /^[A-Z0-9]{3}(?:\.\d+_\d+)?$/.test(raw.wilayaGid) ? raw.wilayaGid : '';
  const communeGid = typeof raw.communeGid === 'string' && /^[A-Z0-9]{3}(?:\.\d+\.\d+_\d+)?$/.test(raw.communeGid) ? raw.communeGid : '';
  const annotations = normalizeAnnotations(raw.annotations);
  const layout = raw.layout && typeof raw.layout === 'object' ? raw.layout : {};
  let localSnapshot = null;
  if (raw.localSnapshot?.type === 'FeatureCollection' && Array.isArray(raw.localSnapshot.features) && raw.localSnapshot.features.length <= 5000) {
    try {
      const text = JSON.stringify({ type: 'FeatureCollection', features: raw.localSnapshot.features });
      if (text.length <= 1_300_000) localSnapshot = JSON.parse(text);
    } catch { /* Invalid local snapshots are omitted; the framing metadata remains usable. */ }
  }
  const pageSize = ['A4', 'A3', 'A2'].includes(layout.pageSize) ? layout.pageSize : 'A4';
  const orientation = layout.orientation === 'portrait' ? 'portrait' : 'landscape';
  const dpi = [72, 150, 300].includes(Number(layout.dpi)) ? Number(layout.dpi) : 150;
  return {
    type: 'urbatrame-spatial-framing', version: CADRAGE_PROJECT_VERSION, id, name,
    createdAt, updatedAt, level, center, projectName: areaName, studyName,
    countryCode, wilayaGid, wilayaName: cleanText(raw.wilayaName || '', 100),
    communeGid, communeName: cleanText(raw.communeName || '', 100),
    perimeter: perimeter ? (perimeter.type === 'circle'
      ? { type: 'circle', center: perimeter.center.map(Number), radiusMeters: Number(perimeter.radiusMeters) }
      : { type: perimeter.type, coordinates: openRing(perimeter.coordinates) }) : null,
    layerVisibility: safeLayerVisibility(raw.layerVisibility), annotations,
    viewRadius, scaleDenominator: scale || 0,
    layout: { pageSize, orientation, dpi }, localSnapshot,
    title: cleanText(raw.title || defaultTitle(level, { wilaya: raw.wilayaName, city: raw.communeName || raw.center?.name, study: studyName }), 180),
    comments: cleanText(raw.comments || '', 500),
    sourceAttribution: cleanText(raw.sourceAttribution || 'GADM 4.1 · © GADM · © OpenStreetMap contributors, ODbL', 240)
  };
}

export function createDefaultFramingRecord(level = 'wilaya-country', now = Date.now()) {
  const found = LEVELS.find(item => item.id === level) || LEVELS[0];
  return normalizeFramingRecord({
    type: 'urbatrame-spatial-framing', version: CADRAGE_PROJECT_VERSION,
    id: `cadrage-${now.toString(36)}`, name: found.label,
    createdAt: now, updatedAt: now, level: found.id,
    center: { lat: 36.7538, lon: 3.0588, name: 'Alger, Algérie' },
    viewRadius: found.defaultRadius, scaleDenominator: found.defaultScale || 0,
    countryCode: 'DZA', layerVisibility: defaultLayerVisibility(), annotations: [], perimeter: null,
    layout: { pageSize: 'A4', orientation: 'landscape', dpi: 150 }
  }, { requirePerimeter: false, now });
}

export function normalizeFramingProject(raw, { now = Date.now() } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.type !== CADRAGE_PROJECT_TYPE || raw.version !== CADRAGE_PROJECT_VERSION) return null;
  if (!Array.isArray(raw.cadrages) || raw.cadrages.length > MAX_CADRAGES) return null;
  const cadrages = raw.cadrages.map(item => normalizeFramingRecord(item, { now })).filter(Boolean);
  if (cadrages.length !== raw.cadrages.length) return null;
  return { type: CADRAGE_PROJECT_TYPE, version: CADRAGE_PROJECT_VERSION, exportedAt: validTimestamp(raw.exportedAt, now), cadrages };
}

export function parseFramingProject(text, options = {}) {
  if (typeof text !== 'string' || text.length > MAX_CADRAGE_PROJECT_BYTES) return null;
  try { return normalizeFramingProject(JSON.parse(text), options); }
  catch { return null; }
}

export function serializeFramingProject(records, now = Date.now()) {
  const cadrages = Array.isArray(records) ? records.map(item => normalizeFramingRecord(item)).filter(Boolean).slice(0, MAX_CADRAGES) : [];
  return JSON.stringify({ type: CADRAGE_PROJECT_TYPE, version: CADRAGE_PROJECT_VERSION, exportedAt: now, cadrages }, null, 2);
}

export function scaleRangeForLevel(levelId, pageSize = 'A4', orientation = 'landscape') {
  const base = pageSize === 'A2' ? 594 : pageSize === 'A3' ? 420 : 297;
  const short = pageSize === 'A2' ? 420 : pageSize === 'A3' ? 297 : 210;
  const pageWidthMm = orientation === 'portrait' ? short : base;
  const printableMapWidthMm = Math.max(100, pageWidthMm - 82);
  if (levelId === 'neighborhood-city') return {
    minScale: 5000, maxScale: 10000,
    minRadius: radiusForScale(5000, printableMapWidthMm), maxRadius: radiusForScale(10000, printableMapWidthMm)
  };
  if (levelId === 'neighborhood-environment') return {
    minScale: 2000, maxScale: 5000,
    minRadius: radiusForScale(2000, printableMapWidthMm), maxRadius: radiusForScale(5000, printableMapWidthMm)
  };
  return { minScale: 0, maxScale: 0, minRadius: MIN_VIEW_RADIUS_M, maxRadius: MAX_STUDY_RADIUS_M };
}
