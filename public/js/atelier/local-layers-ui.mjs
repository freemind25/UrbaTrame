import {
  MAX_IMPORT_BYTES, MAX_FEATURES, MAX_COORDINATE_POSITIONS, MAX_LAYERS, MAX_TOTAL_FEATURES, MAX_TOTAL_POSITIONS,
  parseGeoJSONText, parseDelimitedText, countFeaturePositions,
  detectCoordinateFields, csvToGeoJSON, extentOfFeatures,
  exportVisibleGeoJSON
} from './local-layers.mjs';
import { summarizeFeatures } from './local-analysis.mjs';
import { buildDashboardSummary } from './dashboard.mjs';
import { layersTopFirst, moveLayerStack } from './layer-stack.mjs';
import { parseShapefileBundle, detectShapefileCrs } from './shapefile.mjs';
import { extractShapefileZip, extractKmlFromZip } from './zip-reader.mjs';
import { MAX_PROJECT_BYTES, parseLocalProject, serializeLocalProject } from './project.mjs';
import { runLocalRecipe } from './automation.mjs';
import { buildVectorRequestUrl, buildWmtsTileUrl, fetchPaginatedVectorService, MAX_REMOTE_FEATURES, MAX_REMOTE_PAGES } from './remote-services.mjs';
import { deleteFeature, moveVertex, insertVertex, deleteVertex, setFeatureAttribute, deleteFeatureAttribute, getVertex, canDeleteVertex, canInsertVertex, recordLayerEdit, undoLayerEdit, redoLayerEdit } from './editing.mjs';
import { parseGeoPackage } from './geopackage.mjs';
import { parseGeoTiff, MAX_RASTER_BYTES, MAX_RASTER_PIXELS, MAX_TOTAL_RASTER_BYTES, MAX_TOTAL_RASTER_PIXELS } from './geotiff-raster.mjs';
import { parseKmlText, layersToKml } from './kml.mjs';
import { createStoredZip } from './zip-writer.mjs';
import { exportVisibleCsv, normalizeFieldTemplate, defaultFieldTemplate, parseFieldTemplate, serializeFieldTemplate, buildSurveyProperties, MAX_FIELD_TEMPLATE_BYTES, MAX_SURVEY_FIELDS } from './field-survey.mjs';
import { createGeoPackage } from './geopackage-export.mjs';
import { parseGtxGrid, interpolateGeoidUndulation, orthometricHeight, MAX_GTX_BYTES } from './geoid-gtx.mjs';

const $ = selector => document.querySelector(selector);
const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_RENDERED_FEATURES = 8_000;
const MAX_RENDERED_SHAPES = 20_000;
const PALETTE = ['#28734f', '#b7603e', '#3976a8', '#8761a6', '#b08a30', '#388b89'];
const state = { layers: [], selectedLayerId: null, selectedFeature: null, pendingCsv: null, pendingCsvFileName: '', pendingShapeFiles: null, importRequest: 0, drawMode: null, pendingCoordinates: [], basemap: null, aiPrice: null, pendingAiGeoJSON: null, surveyTemplate: defaultFieldTemplate(), surveyViewEnabled: false, surveyView: { lat: 36.2642, lon: 6.6969, spanMeters: 2000 }, gpsFix: null, geoidGrid: null };
const FIELD_TEMPLATES_KEY = 'urbatrame:field-templates:v1';
const MAX_SAVED_SURVEY_TEMPLATES = 20;
function readSavedSurveyTemplates() {
  try {
    const raw = JSON.parse(localStorage.getItem(FIELD_TEMPLATES_KEY) || '[]');
    return Array.isArray(raw) ? raw.slice(0, MAX_SAVED_SURVEY_TEMPLATES).flatMap(value => {
      try { return [normalizeFieldTemplate(value)]; } catch { return []; }
    }) : [];
  } catch { return []; }
}
let savedSurveyTemplates = readSavedSurveyTemplates();
let lastSurveyTemplateStorageSucceeded = true;
const readerRuntime = { sql: null, sqlPromise: null, geotiff: null, geotiffPromise: null };
let currentProjector = null;
const fileInput = $('#fileInput');
const shapeFilesInput = $('#shapefileFiles');
const shapeMapping = $('#shapeMapping');
const dropZone = $('#dropZone');
const importStatus = $('#importStatus');
const layerList = $('#layerList');
const svg = $('#localMap');
const mapEmpty = $('#mapEmpty');
const csvMapping = $('#csvMapping');
const csvLongitude = $('#csvLongitude');
const csvLatitude = $('#csvLatitude');

function id() {
  return globalThis.crypto?.randomUUID?.() || `layer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadClassicScript(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error('READER_ASSET_LOAD_FAILED'));
    document.head.append(script);
  });
}

async function loadSqlRuntime() {
  if (readerRuntime.sql) return readerRuntime.sql;
  if (!readerRuntime.sqlPromise) readerRuntime.sqlPromise = (async () => {
    if (typeof window.initSqlJs !== 'function') await loadClassicScript('/vendor/sql.js/sql-wasm-browser.js');
    if (typeof window.initSqlJs !== 'function') throw Object.assign(new Error(), { code: 'GPKG_READER_UNAVAILABLE' });
    return window.initSqlJs({ locateFile: file => `/vendor/sql.js/${file}` });
  })().then(SQL => (readerRuntime.sql = SQL)).catch(error => { readerRuntime.sqlPromise = null; throw error; });
  return readerRuntime.sqlPromise;
}

async function loadGeoTiffRuntime() {
  if (readerRuntime.geotiff) return readerRuntime.geotiff;
  if (!readerRuntime.geotiffPromise) readerRuntime.geotiffPromise = (async () => {
    if (!window.GeoTIFF?.fromArrayBuffer) await loadClassicScript('/vendor/geotiff/geotiff.js');
    if (!window.GeoTIFF?.fromArrayBuffer) throw Object.assign(new Error(), { code: 'RASTER_READER_UNAVAILABLE' });
    return window.GeoTIFF;
  })().then(api => (readerRuntime.geotiff = api)).catch(error => { readerRuntime.geotiffPromise = null; throw error; });
  return readerRuntime.geotiffPromise;
}

const TERRAIN_STOPS = [
  [0, [38, 73, 116]], [0.22, [48, 136, 124]], [0.45, [130, 174, 97]],
  [0.68, [213, 186, 100]], [0.86, [160, 111, 80]], [1, [248, 244, 222]]
];

function rasterPreviewDataUrl(raster) {
  const canvas = document.createElement('canvas');
  canvas.width = raster.width; canvas.height = raster.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw Object.assign(new Error(), { code: 'RASTER_PREVIEW_UNAVAILABLE' });
  const image = context.createImageData(raster.width, raster.height);
  const pixels = image.data, values = raster.values, samples = raster.samplesPerPixel;
  const normalized = (value, band) => {
    const stats = raster.bands[band];
    if (!stats || !Number.isFinite(stats.min) || !Number.isFinite(stats.max)) return 0;
    if (stats.max === stats.min) return Math.max(0, Math.min(1, value / (raster.dataType.startsWith('Uint8') ? 255 : 1)));
    return Math.max(0, Math.min(1, (value - stats.min) / (stats.max - stats.min)));
  };
  const colorAt = value => {
    for (let i = 1; i < TERRAIN_STOPS.length; i++) {
      const [end, endColor] = TERRAIN_STOPS[i], [start, startColor] = TERRAIN_STOPS[i - 1];
      if (value <= end) {
        const t = (value - start) / (end - start);
        return startColor.map((channel, index) => Math.round(channel + (endColor[index] - channel) * t));
      }
    }
    return TERRAIN_STOPS.at(-1)[1];
  };
  for (let pixel = 0; pixel < raster.pixelCount; pixel++) {
    const source = pixel * samples, target = pixel * 4;
    const first = Number(values[source]);
    if (!Number.isFinite(first) || raster.noData !== null && first === raster.noData || samples === 4 && Number(values[source + 3]) === 0) {
      pixels[target + 3] = 0;
      continue;
    }
    if (samples === 1) {
      const color = colorAt(normalized(first, 0));
      pixels[target] = color[0]; pixels[target + 1] = color[1]; pixels[target + 2] = color[2];
    } else {
      for (let band = 0; band < 3; band++) pixels[target + band] = Math.round(normalized(Number(values[source + band]), band) * 255);
    }
    pixels[target + 3] = samples === 4 ? Math.round(normalized(Number(values[source + 3]), 3) * 255) : 255;
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

function base64ToBytes(encoded) {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let start = 0; start < binary.length; start += 0x8000) {
    const end = Math.min(binary.length, start + 0x8000);
    for (let index = start; index < end; index++) bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function status(message, kind = '') {
  importStatus.textContent = message;
  importStatus.dataset.state = kind;
}

function errorMessage(error) {
  const code = error?.code || 'IMPORT_FAILED';
  if (code === 'FILE_TOO_LARGE') return 'Fichier trop volumineux. La limite est de 15 Mo.';
  if (code === 'GPKG_READER_UNAVAILABLE' || code === 'RASTER_READER_UNAVAILABLE' || code === 'READER_ASSET_LOAD_FAILED') return 'Le lecteur local du format n’a pas pu être chargé. Vérifiez la connexion à UrbaTrame puis réessayez.';
  if (code === 'GPKG_INVALID' || code === 'GPKG_NOT_VALID' || code === 'GPKG_SCHEMA_INVALID') return 'GeoPackage invalide ou schéma SQLite incomplet.';
  if (code === 'GPKG_NO_VECTOR_LAYERS') return 'Ce GeoPackage ne contient aucune couche d’entités vectorielles prise en charge.';
  if (code === 'GPKG_TOO_MANY_LAYERS') return 'Ce GeoPackage contient plus de 12 couches vectorielles; importez un fichier plus ciblé.';
  if (code === 'GPKG_TOO_MANY_FEATURES') return 'Une couche du GeoPackage dépasse 20 000 entités.';
  if (code === 'GPKG_TOO_MANY_TOTAL_FEATURES') return 'Le GeoPackage dépasse la limite totale de 60 000 entités.';
  if (code === 'GPKG_TOO_MANY_TOTAL_POSITIONS') return 'Le GeoPackage dépasse la limite totale de 300 000 positions.';
  if (code === 'GPKG_SRS_UNSUPPORTED' || code === 'GPKG_SRS_MISMATCH') return `CRS GeoPackage non pris en charge ou incohérent (${error.message.split(':').slice(1).join(':')}). Seuls EPSG:4326, EPSG:3857 et UTM WGS 84 sont convertis.`;
  if (code === 'GPKG_GEOMETRY_UNSUPPORTED' || code === 'GPKG_EXTENDED_GEOMETRY_UNSUPPORTED') return 'Type de géométrie GeoPackage non pris en charge (courbes et géométries étendues exclues).';
  if (code === 'GPKG_GEOMETRY_INVALID') return 'Une géométrie binaire du GeoPackage est invalide ou tronquée.';
  if (code === 'RASTER_INVALID') return 'Fichier TIFF/GeoTIFF invalide ou illisible.';
  if (code === 'RASTER_NO_GEOREFERENCE' || code === 'RASTER_CRS_REQUIRED') return 'Le GeoTIFF doit contenir un géoréférencement et un CRS EPSG dans ses métadonnées.';
  if (code === 'RASTER_CRS_UNSUPPORTED') return `CRS GeoTIFF non pris en charge (${error.message.split(':').slice(1).join(':')}). Seuls EPSG:4326, EPSG:3857 et UTM WGS 84 sont convertis.`;
  if (code === 'RASTER_ROTATED_UNSUPPORTED' || code === 'RASTER_ORIENTATION_UNSUPPORTED') return 'GeoTIFF refusé : la rotation ou l’orientation des pixels n’est pas prise en charge; utilisez un raster nord en haut, aligné sur les axes.';
  if (code === 'RASTER_ANTIMERIDIAN_UNSUPPORTED') return 'GeoTIFF refusé : son emprise traverse l’antiméridien.';
  if (code === 'RASTER_BANDS_UNSUPPORTED') return 'Bandes non prises en charge : importez un GeoTIFF à 1 bande ou une image RGB/RGBA (3 ou 4 bandes).';
  if (code === 'RASTER_TOO_MANY_PIXELS') return `GeoTIFF trop détaillé; limite de ${MAX_RASTER_PIXELS.toLocaleString('fr-FR')} pixels par fichier.`;
  if (code === 'RASTER_TOO_MANY_TOTAL_PIXELS') return `Limite cumulée de ${MAX_TOTAL_RASTER_PIXELS.toLocaleString('fr-FR')} pixels raster atteinte dans l’atelier.`;
  if (code === 'RASTER_TOO_MANY_TOTAL_BYTES') return `Limite cumulée de ${(MAX_TOTAL_RASTER_BYTES / (1024 * 1024)).toLocaleString('fr-FR')} Mo de GeoTIFF atteinte dans l’atelier.`;
  if (code === 'RASTER_NO_VALID_PIXELS') return 'Le GeoTIFF ne contient aucune valeur raster valide hors NoData.';
  if (code === 'RASTER_DECODE_FAILED') return 'Impossible de décompresser les pixels du GeoTIFF (compression ou prédicteur non pris en charge).';
  if (code === 'RASTER_PREVIEW_UNAVAILABLE') return 'Le navigateur ne peut pas créer l’aperçu raster. Essayez un navigateur récent.';
  if (code === 'EMPTY_FILE') return 'Le fichier est vide.';
  if (code === 'INVALID_JSON') return 'Le JSON n’est pas lisible.';
  if (code === 'NOT_GEOJSON') return 'Ce JSON ne contient pas de géométrie GeoJSON reconnue.';
  if (code === 'UNSUPPORTED_CRS') return 'CRS non pris en charge. Choisissez EPSG:4326, EPSG:3857 ou un EPSG UTM WGS 84 (326xx/327xx).';
  if (code === 'TOO_MANY_FEATURES') return 'La couche dépasse 20 000 entités.';
  if (code === 'TOO_MANY_COORDINATES') return 'La couche dépasse 100 000 positions; réduisez sa complexité avant import.';
  if (code === 'UNSUPPORTED_GEOMETRY') return `Type de géométrie non pris en charge (${error.message.split(':').slice(1).join(':')}).`;
  if (code === 'COORDINATE_OUT_OF_RANGE') return 'Une coordonnée sort des plages longitude −180…180 ou latitude −90…90.';
  if (code === 'INVALID_COORDINATES' || code === 'INVALID_GEOMETRY') return 'La géométrie contient des coordonnées invalides.';
  if (code === 'EMPTY_GEOMETRY') return 'Une géométrie ne contient aucun sommet.';
  if (code === 'INVALID_FEATURE' || code === 'INVALID_PROPERTIES') return 'Une entité GeoJSON est mal formée.';
  if (code === 'CSV_NEEDS_HEADER_AND_ROWS') return 'Le CSV doit comporter une ligne d’en-tête et au moins une ligne de données.';
  if (code === 'CSV_UNCLOSED_QUOTE') return 'Le CSV contient un guillemet non refermé.';
  if (code === 'CSV_COORD_FIELDS_REQUIRED') return 'Choisissez deux colonnes différentes pour la longitude et la latitude.';
  if (code === 'CSV_COORDINATE_INVALID') return `Coordonnée CSV invalide (${error.message.split(':').slice(1).join(':')}). Vérifiez le CRS, les colonnes X/Y et les unités.`;
  if (code === 'SHP_FILE_SIZE') return 'Shapefile incomplet ou fichier supérieur à 15 Mo.';
  if (code === 'SHP_INVALID_HEADER' || code === 'SHP_INVALID_RECORD' || code === 'SHP_INVALID_BUFFER') return 'Shapefile mal formé ou tronqué.';
  if (code === 'SHP_UNSUPPORTED_TYPE') return `Type de forme non pris en charge (${error.message.split(':').pop()}).`;
  if (code === 'SHP_DBF_COUNT_MISMATCH') return 'Le nombre d’enregistrements DBF ne correspond pas aux formes SHP.';
  if (code === 'SHP_CRS_REQUIRED') return 'CRS source obligatoire. Vérifiez le .prj ou saisissez explicitement un EPSG pris en charge.';
  if (code === 'DBF_INVALID') return 'Table DBF invalide ou trop volumineuse.';
  if (code === 'ZIP_INVALID') return 'Archive ZIP invalide ou tronquée.';
  if (code === 'ZIP_NO_SHP') return 'Aucun Shapefile .shp trouvé dans l’archive.';
  if (code === 'ZIP_NO_KML') return 'Aucun fichier .kml trouvé dans l’archive KMZ.';
  if (code === 'KML_XML_UNSAFE') return 'KML refusé : les DTD et entités externes sont désactivés pour protéger les fichiers locaux.';
  if (code === 'KML_NO_PLACEMARKS' || code === 'KML_NO_GEOMETRIES') return 'Le KML ne contient aucune géométrie Placemark prise en charge.';
  if (code.startsWith('KML_')) return 'KML invalide ou incomplet. Vérifiez les géométries, coordonnées et le XML.';
  if (code.startsWith('GPKG_EXPORT_')) return `Export GeoPackage impossible (${code.replace('GPKG_EXPORT_', '').replaceAll('_', ' ').toLowerCase()}).`;
  if (code === 'ZIP_ENCRYPTED') return 'Les archives ZIP chiffrées ne sont pas prises en charge.';
  if (code === 'ZIP_COMPRESSION_UNSUPPORTED') return 'Compression ZIP non prise en charge; choisissez ZIP standard (deflate) ou les fichiers séparés.';
  if (code === 'ZIP_ENTRY_TOO_LARGE') return 'Une entrée de l’archive dépasse 15 Mo.';
  if (code === 'PROJECT_INVALID' || code === 'PROJECT_FORMAT' || code === 'PROJECT_LAYER_INVALID') return 'Fichier de projet UrbaTrame invalide ou non pris en charge.';
  if (code === 'PROJECT_TOO_LARGE') return 'Projet trop volumineux; limite de 30 Mo.';
  if (code === 'PROJECT_TOO_MANY_LAYERS') return 'Un projet peut contenir au plus 12 couches.';
  if (code === 'PROJECT_TOO_MANY_FEATURES') return 'Le projet dépasse 60 000 entités au total.';
  if (code === 'PROJECT_TOO_MANY_POSITIONS') return 'Le projet dépasse 300 000 positions au total.';
  if (code === 'PROJECT_TEMPLATE_INVALID') return 'Le gabarit de relevé intégré au projet est invalide.';
  if (code === 'PROJECT_RASTER_INVALID') return 'Le GeoTIFF intégré au projet est invalide, trop volumineux ou mal encodé.';
  if (code === 'PROJECT_RASTER_SOURCE_MISSING') return 'Le projet ne contient plus les données source de ce GeoTIFF; réimportez le fichier original.';
  if (code === 'PROJECT_TOO_MANY_RASTER_BYTES') return 'Les GeoTIFF du projet dépassent la limite cumulée de 15 Mo.';
  if (code === 'PROJECT_TOO_MANY_RASTER_PIXELS') return 'Les GeoTIFF du projet dépassent la limite cumulée de 4 millions de pixels.';
  if (code === 'RECIPE_SPATIAL_COMPLEXITY') return 'Analyse spatiale trop complexe; simplifiez les géométries ou réduisez le nombre de points comparés.';
  if (code === 'RECIPE_DISTANCE_INVALID') return 'Distance de sélection invalide : utilisez une valeur de 0 à 100 000 m.';
  if (code === 'RECIPE_TARGET_POINTS_REQUIRED') return 'La couche cible ne contient pas de Point/MultiPoint exploitable.';
  if (code === 'RECIPE_REFERENCE_POINTS_REQUIRED') return 'La couche de référence ne contient pas de Point/MultiPoint exploitable.';
  if (code === 'RECIPE_DISTANCE_COORDINATES_REQUIRED') return 'Les couches de points ne contiennent aucune coordonnée exploitable.';
  if (code === 'RECIPE_DISTANCE_COORDINATE_INVALID') return 'Une coordonnée de point est invalide; vérifiez longitude et latitude.';
  if (code === 'RECIPE_BUFFER_RADIUS_INVALID') return 'Tampon invalide : le rayon doit être compris entre 1 et 5 000 m.';
  if (code === 'RECIPE_BUFFER_SEGMENTS_INVALID') return 'Résolution de tampon invalide : utilisez entre 12 et 64 segments.';
  if (code === 'RECIPE_BUFFER_COMPLEXITY') return 'Tampon trop volumineux; limitez-le à 2 000 points et 100 000 positions de sortie.';
  if (code === 'RECIPE_BUFFER_LINE_COMPLEXITY') return 'Tampon de ligne trop volumineux; limitez-le à 2 000 segments et 100 000 positions de sortie.';
  if (code === 'RECIPE_BUFFER_LINE_SEGMENT_INVALID') return 'Un segment de ligne a une longueur nulle; nettoyez la géométrie avant le tampon.';
  if (code === 'RECIPE_BUFFER_LINE_SEGMENT_TOO_LONG') return 'Tampon refusé : chaque segment de ligne doit mesurer au plus 100 km; densifiez ou découpez les données.';
  if (code === 'RECIPE_BUFFER_COORDINATE_INVALID') return 'Coordonnée de tampon invalide; vérifiez la longitude et la latitude.';
  if (code === 'RECIPE_BUFFER_LINES_REQUIRED') return 'Le tampon de ligne requiert au moins un segment LineString ou MultiLineString.';
  if (code === 'RECIPE_BUFFER_ANTIMERIDIAN_UNSUPPORTED') return 'Tampon refusé près de l’antiméridien pour éviter un polygone qui traverserait toute la carte.';
  if (code === 'RECIPE_BUFFER_POINTS_REQUIRED') return 'Le tampon ponctuel requiert au moins une entité Point ou MultiPoint.';
  if (code.startsWith('RECIPE_')) return `Recette non exécutée : ${error.message.split(':').slice(1).join(':') || code.replace('RECIPE_', '').replaceAll('_', ' ').toLowerCase()}. Vérifiez les noms de couches et les opérations autorisées.`;
  if (code === 'WFS_TYPE_REQUIRED') return 'Saisissez le nom exact du WFS typeNames.';
  if (code === 'ARCGIS_FEATURE_LAYER_REQUIRED') return 'Pour ArcGIS, fournissez l’URL d’une couche /FeatureServer/{index}.';
  if (code === 'ARCGIS_MAP_LAYER_REQUIRED') return 'Pour MapServer, fournissez l’URL d’une couche /MapServer/{index} (queryable).';
  if (code === 'SERVICE_URL_INVALID' || code === 'SERVICE_HTTPS_REQUIRED') return 'URL de service invalide; HTTPS est obligatoire.';
  if (code === 'SERVICE_TYPE_UNSUPPORTED') return 'Type de service vectoriel non pris en charge.';
  if (code === 'REMOTE_TOTAL_TOO_LARGE') return 'Réponses cumulées trop volumineuses; la limite de 30 Mo a été atteinte.';
  if (code === 'REMOTE_PAGE_FEATURE_LIMIT') return 'Le service a renvoyé plus de 1 000 entités sur une page; import arrêté.';
  if (code === 'REMOTE_PAGINATION_REPEATED') return 'Le service répète la même page malgré l’offset; import arrêté pour éviter les doublons.';
  if (code === 'REMOTE_PAGINATION_STALLED') return 'Le service annonce des résultats supplémentaires mais renvoie une page vide; import arrêté.';
  if (code === 'SERVICE_TIMEOUT') return 'Le service distant n’a pas répondu dans les 30 secondes; réessayez ou choisissez une réponse plus légère.';
  if (code === 'CSV_COLUMN_COUNT_MISMATCH') return `Le nombre de colonnes ne correspond pas à l’en-tête (ligne ${error.message.split(':').pop()}).`;
  if (code === 'UNSUPPORTED_FILE') return 'Format non pris en charge. Choisissez GeoJSON, CSV/TSV, Shapefile, GeoPackage, GeoTIFF ou KML/KMZ.';
  return 'Import impossible. Vérifiez le fichier puis réessayez.';
}

function layerTitle(fileName) {
  return String(fileName || 'Couche locale').replace(/\.[^.]+$/, '').slice(0, 100) || 'Couche locale';
}

function visibleFeatures(layer) {
  return layer.geojson.features.map((feature, index) => ({ feature, index })).filter(({ feature }) => {
    if (!layer.filter?.field || !String(layer.filter.value || '').trim()) return true;
    return formatCell(feature.properties?.[layer.filter.field]).toLocaleLowerCase('fr-FR')
      .includes(String(layer.filter.value).trim().toLocaleLowerCase('fr-FR'));
  });
}

function featureColor(layer, feature) {
  if (!layer.categoryField) return layer.color;
  const key = formatCell(feature.properties?.[layer.categoryField]);
  return layer.categoryColors.get(key) || layer.color;
}

function clearPendingImportUi() {
  $('#sourceReference').value = '';
  csvMapping.hidden = true;
  shapeMapping.hidden = true;
  state.pendingCsv = null; state.pendingCsvFileName = ''; state.pendingShapeFiles = null;
  fileInput.value = ''; shapeFilesInput.value = '';
}

function addLayers(imports, sourceReference = '') {
  if (!Array.isArray(imports) || !imports.length) return false;
  const totalFeatures = state.layers.reduce((sum, layer) => sum + layer.geojson.features.length, 0);
  const totalPositions = state.layers.reduce((sum, layer) => sum + (layer.positionCount ?? countFeaturePositions(layer.geojson.features)), 0);
  const incomingFeatures = imports.reduce((sum, item) => sum + item.geojson.features.length, 0);
  const incomingPositions = imports.reduce((sum, item) => sum + countFeaturePositions(item.geojson.features), 0);
  if (state.layers.length + imports.length > MAX_LAYERS) { status(`Limite de ${MAX_LAYERS} couches dans cet atelier.`, 'error'); return false; }
  if (imports.some(item => item.geojson.features.length > MAX_FEATURES) || totalFeatures + incomingFeatures > MAX_TOTAL_FEATURES) {
    status(`Limite atteinte : ${MAX_FEATURES} entités par couche et ${MAX_TOTAL_FEATURES} au total.`, 'error'); return false;
  }
  if (totalPositions + incomingPositions > MAX_TOTAL_POSITIONS) { status(`Limite de ${MAX_TOTAL_POSITIONS} positions dans l’atelier. Simplifiez les couches avant import.`, 'error'); return false; }
  const importedAt = new Date().toISOString();
  const layers = imports.map((item, index) => {
    const geojson = item.geojson;
    const fileName = String(item.fileName || geojson.name || 'fichier local');
    return {
      id: id(), kind: 'vector',
      name: layerTitle(item.name || geojson.name || fileName), fileName,
      source: String(sourceReference || item.source || fileName || 'Fichier importé').trim(),
      importedAt, crs: 'EPSG:4326', sourceCrs: geojson.sourceCrs || item.sourceCrs || 'EPSG:4326',
      color: PALETTE[(state.layers.length + index) % PALETTE.length],
      categoryField: '', categoryColors: new Map(), labelField: '', filter: null,
      editHistory: { undo: [], redo: [] }, visible: true,
      positionCount: countFeaturePositions(geojson.features), geojson
    };
  });
  state.layers.push(...layers);
  state.selectedLayerId = layers.at(-1).id;
  state.selectedFeature = null;
  clearPendingImportUi();
  const countLabel = layers.length === 1 ? `${layers[0].geojson.features.length.toLocaleString('fr-FR')} entité(s) ajoutée(s) · ${layers[0].name}`
    : `${layers.length} couche(s) ajoutée(s) · ${incomingFeatures.toLocaleString('fr-FR')} entité(s)`;
  status(countLabel, 'success');
  renderAll();
  return true;
}

function addLayer(geojson, fileName, sourceReference = '') {
  return addLayers([{ geojson, fileName, name: geojson.name || fileName }], sourceReference);
}

function createSurveyLayer() {
  const lat = Number($('#surveyCenterLat').value), lon = Number($('#surveyCenterLon').value), spanMeters = Number($('#surveyViewSpan').value);
  if (!Number.isFinite(lat) || Math.abs(lat) > 85 || !Number.isFinite(lon) || Math.abs(lon) > 180 || !Number.isFinite(spanMeters) || spanMeters < 100 || spanMeters > 3_000) {
    surveyStatus('Centre invalide : latitude −85…85, longitude −180…180 et largeur 100…3 000 m.', 'error'); return false;
  }
  state.surveyView = { lat, lon, spanMeters };
  const fileName = 'releve-terrain.geojson';
  state.surveyViewEnabled = true;
  const geojson = { type: 'FeatureCollection', name: 'Relevé terrain', crs: 'EPSG:4326', sourceCrs: 'EPSG:4326', features: [] };
  const added = addLayers([{ geojson, fileName, name: 'Relevé terrain' }], 'Saisie locale UrbaTrame · utilisateur');
  if (added) status('Couche terrain vide créée. Ajoutez un point GNSS, ou activez un fond XYZ/WMS et dessinez des points, lignes et polygones.', 'success');
  return added;
}

function addRasterLayer(raster, sourceBytes, sourceReference = '') {
  const bytes = sourceBytes instanceof Uint8Array ? sourceBytes : new Uint8Array(sourceBytes);
  const rasterLayers = state.layers.filter(layer => layer.kind === 'raster');
  const totalBytes = rasterLayers.reduce((sum, layer) => sum + (layer.raster.sourceBytes?.byteLength || 0), 0);
  const totalPixels = rasterLayers.reduce((sum, layer) => sum + (layer.raster.pixelCount || 0), 0);
  if (state.layers.length >= MAX_LAYERS) { status(`Limite de ${MAX_LAYERS} couches dans cet atelier.`, 'error'); return false; }
  if (bytes.byteLength > MAX_RASTER_BYTES || totalBytes + bytes.byteLength > MAX_TOTAL_RASTER_BYTES) {
    status(errorMessage(Object.assign(new Error(), { code: bytes.byteLength > MAX_RASTER_BYTES ? 'FILE_TOO_LARGE' : 'RASTER_TOO_MANY_TOTAL_BYTES' })), 'error'); return false;
  }
  if (raster.pixelCount > MAX_RASTER_PIXELS || totalPixels + raster.pixelCount > MAX_TOTAL_RASTER_PIXELS) {
    status(errorMessage(Object.assign(new Error(), { code: raster.pixelCount > MAX_RASTER_PIXELS ? 'RASTER_TOO_MANY_PIXELS' : 'RASTER_TOO_MANY_TOTAL_PIXELS' })), 'error'); return false;
  }
  const fileName = raster.fileName || 'couche.tif';
  const layer = {
    id: id(), kind: 'raster', name: layerTitle(fileName), fileName,
    source: String(sourceReference || fileName).trim(), importedAt: new Date().toISOString(),
    crs: 'EPSG:4326', sourceCrs: raster.sourceCrs, color: PALETTE[state.layers.length % PALETTE.length],
    categoryField: '', categoryColors: new Map(), labelField: '', filter: null,
    editHistory: { undo: [], redo: [] }, visible: true, positionCount: 0,
    geojson: { type: 'FeatureCollection', name: fileName, crs: 'EPSG:4326', sourceCrs: raster.sourceCrs, features: [] },
    raster: { ...raster, sourceBytes: bytes, opacity: 0.85, previewDataUrl: rasterPreviewDataUrl(raster) }
  };
  state.layers.push(layer); state.selectedLayerId = layer.id; state.selectedFeature = null;
  clearPendingImportUi();
  status(`GeoTIFF ${raster.width} × ${raster.height} · ${raster.sourceCrs} → EPSG:4326 · ${raster.validPixels.toLocaleString('fr-FR')} pixels valides ajouté${sourceReference ? ` · ${sourceReference}` : ''}.`, 'success');
  renderAll();
  return true;
}

function createSvgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

function mercator(lon, lat) {
  const rad = Math.PI / 180;
  const safeLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  return [lon * rad, Math.log(Math.tan(Math.PI / 4 + safeLat * rad / 2))];
}

function buildProjector(features, { minPadding = 0.006 } = {}) {
  const extent = extentOfFeatures(features);
  if (!extent) return null;
  const a = mercator(extent.west, extent.south);
  const b = mercator(extent.east, extent.north);
  let minX = Math.min(a[0], b[0]), maxX = Math.max(a[0], b[0]);
  let minY = Math.min(a[1], b[1]), maxY = Math.max(a[1], b[1]);
  const padX = Math.max((maxX - minX) * 0.06, minPadding);
  const padY = Math.max((maxY - minY) * 0.06, minPadding);
  minX -= padX; maxX += padX; minY -= padY; maxY += padY;
  const width = 1000, height = 600, margin = 30;
  const dx = maxX - minX, dy = maxY - minY;
  const scale = Math.min((width - margin * 2) / dx, (height - margin * 2) / dy);
  const drawnWidth = dx * scale, drawnHeight = dy * scale;
  const left = (width - drawnWidth) / 2;
  const top = (height - drawnHeight) / 2;
  const project = position => {
    const [x, y] = mercator(position[0], position[1]);
    return [left + (x - minX) * scale, height - (top + (y - minY) * scale)];
  };
  project.inverse = (screenX, screenY) => {
    const x = minX + (screenX - left) / scale;
    const y = minY + (height - screenY - top) / scale;
    return [x * 180 / Math.PI, (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI];
  };
  return project;
}

function buildSurveyProjector() {
  const lat = Number(state.surveyView.lat), lon = Number(state.surveyView.lon), span = Number(state.surveyView.spanMeters);
  if (!Number.isFinite(lat) || Math.abs(lat) > 85 || !Number.isFinite(lon) || Math.abs(lon) > 180 || !Number.isFinite(span) || span < 100) return null;
  const halfLat = span / (2 * 6378137) * 180 / Math.PI;
  const halfLon = halfLat / Math.max(0.08, Math.cos(lat * Math.PI / 180));
  const west = Math.max(-180, lon - halfLon), east = Math.min(180, lon + halfLon);
  const south = Math.max(-84.9, lat - halfLat), north = Math.min(84.9, lat + halfLat);
  const ring = [[west, south], [east, south], [east, north], [west, north], [west, south]];
  return buildProjector([{ geometry: { type: 'Polygon', coordinates: [ring] } }], { minPadding: Math.max(0.00001, span / 6378137 * 0.01) });
}

function pathForLine(coords, project, close = false) {
  if (!Array.isArray(coords) || coords.length < 1) return '';
  const points = coords.map(project);
  return `M${points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join('L')}${close ? 'Z' : ''}`;
}

function setFeatureAction(element, layer, index) {
  element.classList.add('feature-path');
  element.setAttribute('tabindex', '0');
  element.setAttribute('role', 'button');
  const featureLabel = `${layer.name} · entité ${index + 1}`;
  element.setAttribute('aria-label', featureLabel);
  const title = createSvgElement('title');
  title.textContent = featureLabel;
  element.append(title);
  const select = event => {
    event.stopPropagation();
    state.selectedLayerId = layer.id;
    state.selectedFeature = { layerId: layer.id, index };
    renderLayerList();
    renderLayerTools();
    renderAttributes();
  };
  element.addEventListener('click', select);
  element.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(event); }
  });
}

function appendGeometry(geometry, project, layer, feature, index, budget) {
  if (!geometry || budget.truncated) return;
  const color = featureColor(layer, feature);
  const appendActionable = (element, extraClass = '') => {
    if (budget.count >= MAX_RENDERED_SHAPES) { budget.truncated = true; return false; }
    if (extraClass) element.classList.add(extraClass);
    setFeatureAction(element, layer, index);
    svg.append(element);
    budget.count++;
    return true;
  };
  const drawLine = (coords, closed = false) => {
    if (budget.truncated || !Array.isArray(coords) || coords.length < 2) return;
    const path = createSvgElement('path', {
      d: pathForLine(coords, project, closed),
      fill: closed ? color : 'none',
      'fill-opacity': closed ? '.18' : '0',
      'fill-rule': 'evenodd',
      stroke: color,
      'stroke-width': closed ? '1.6' : '1.8',
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round'
    });
    appendActionable(path);
  };
  const drawPoint = coords => {
    if (budget.truncated || !Array.isArray(coords) || coords.length < 2) return;
    const [cx, cy] = project(coords);
    const circle = createSvgElement('circle', {
      cx: cx.toFixed(2), cy: cy.toFixed(2), r: '4.2',
      fill: color, stroke: '#fff', 'stroke-width': '1.4'
    });
    if (!appendActionable(circle, 'feature-point')) return;
    const label = layer.labelField ? formatCell(feature.properties?.[layer.labelField]).slice(0, 60) : '';
    if (label && budget.labels < 500 && budget.count < MAX_RENDERED_SHAPES) {
      const text = createSvgElement('text', { x: (cx + 6).toFixed(2), y: (cy - 5).toFixed(2), class: 'feature-label' });
      text.textContent = label;
      svg.append(text); budget.labels++; budget.count++;
    }
  };
  const drawPolygon = rings => {
    if (budget.truncated || !Array.isArray(rings) || !rings.length) return;
    const d = rings.map(ring => pathForLine(ring, project, true)).join('');
    if (!d) return;
    const path = createSvgElement('path', {
      d, fill: color, 'fill-opacity': '.18', 'fill-rule': 'evenodd',
      stroke: color, 'stroke-width': '1.6', 'stroke-linejoin': 'round', 'stroke-linecap': 'round'
    });
    appendActionable(path);
  };
  switch (geometry.type) {
    case 'Point': drawPoint(geometry.coordinates); break;
    case 'MultiPoint': geometry.coordinates.forEach(drawPoint); break;
    case 'LineString': drawLine(geometry.coordinates); break;
    case 'MultiLineString': geometry.coordinates.forEach(line => drawLine(line)); break;
    case 'Polygon': drawPolygon(geometry.coordinates); break;
    case 'MultiPolygon': geometry.coordinates.forEach(drawPolygon); break;
    case 'GeometryCollection': geometry.geometries.forEach(child => appendGeometry(child, project, layer, feature, index, budget)); break;
  }
}

function unsafeServiceHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host.includes(':')) return true;
  if (['localhost', 'local', 'internal', 'test', 'invalid'].some(suffix => host === suffix || host.endsWith(`.${suffix}`))) return true;
  if (/^\d+(?:\.\d+){3}$/.test(host)) {
    const octets = host.split('.').map(Number);
    if (octets.some(value => value < 0 || value > 255)) return true;
    const [a, b, c] = octets;
    return a === 0 || a === 10 || a === 127 || a >= 224 || a === 100 && b >= 64 && b <= 127
      || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31
      || a === 192 && (b === 168 || b === 0 || b === 88 && c === 99)
      || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)
      || a === 203 && b === 0 && c === 113;
  }
  return false;
}

function validateHttpsUrl(raw, { template = false } = {}) {
  if (!/^https:\/\//i.test(raw)) throw new Error('Le service doit utiliser HTTPS.');
  const check = template ? raw.replace(/\{[zxy]\}/gi, '0') : raw;
  let url;
  try { url = new URL(check); } catch { throw new Error('URL de service invalide.'); }
  if (url.username || url.password || unsafeServiceHost(url.hostname)) throw new Error('URL refusée : identifiants intégrés ou hôte local/non public.');
  return url;
}

function tileXY(lon, lat, zoom) {
  const n = 2 ** zoom;
  const safeLat = Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI / 180;
  return [Math.floor((lon + 180) / 360 * n), Math.floor((1 - Math.asinh(Math.tan(safeLat)) / Math.PI) / 2 * n)];
}

function tileLonLat(x, y, zoom) {
  const n = 2 ** zoom;
  return [x / n * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI];
}

function appendExternalBasemap(project) {
  const service = state.basemap;
  if (!service) return;
  const topLeft = project.inverse(0, 0), bottomRight = project.inverse(1000, 600);
  if (service.type === 'wms') {
    const nw = mercator(topLeft[0], topLeft[1]), se = mercator(bottomRight[0], bottomRight[1]);
    const radius = 6378137;
    const bbox = [Math.min(nw[0], se[0]) * radius, Math.min(nw[1], se[1]) * radius,
      Math.max(nw[0], se[0]) * radius, Math.max(nw[1], se[1]) * radius].map(value => value.toFixed(3)).join(',');
    const url = new URL(service.url);
    for (const [key, value] of Object.entries({ SERVICE: 'WMS', VERSION: '1.1.1', REQUEST: 'GetMap', LAYERS: service.layers, STYLES: '', SRS: 'EPSG:3857', BBOX: bbox, WIDTH: '1000', HEIGHT: '600', FORMAT: 'image/png', TRANSPARENT: 'TRUE' })) url.searchParams.set(key, value);
    svg.append(createSvgElement('image', { x: 0, y: 0, width: 1000, height: 600, href: url.href, opacity: '.82', preserveAspectRatio: 'none', class: 'external-basemap-image', 'aria-hidden': 'true' }));
    return;
  }
  const mercWest = mercator(topLeft[0], topLeft[1])[0], mercEast = mercator(bottomRight[0], bottomRight[1])[0];
  const spanMeters = Math.max(100, Math.abs(mercEast - mercWest) * 6378137);
  let zoom = Math.max(0, Math.min(19, Math.round(Math.log2(40_075_016.686 * 4 / spanMeters))));
  let minTile, maxTile;
  for (; zoom > 0; zoom--) {
    const a = tileXY(topLeft[0], topLeft[1], zoom), b = tileXY(bottomRight[0], bottomRight[1], zoom);
    minTile = [Math.min(a[0], b[0]), Math.min(a[1], b[1])];
    maxTile = [Math.max(a[0], b[0]), Math.max(a[1], b[1])];
    if ((maxTile[0] - minTile[0] + 1) * (maxTile[1] - minTile[1] + 1) <= 64) break;
  }
  const n = 2 ** zoom;
  for (let x = minTile[0]; x <= maxTile[0]; x++) {
    for (let y = minTile[1]; y <= maxTile[1]; y++) {
      if (y < 0 || y >= n) continue;
      const nw = tileLonLat(x, y, zoom), se = tileLonLat(x + 1, y + 1, zoom);
      const [left, top] = project(nw), [right, bottom] = project(se);
      const tileX = ((x % n) + n) % n;
      const href = service.type === 'wmts'
        ? buildWmtsTileUrl(service, zoom, y, tileX)
        : service.url.replace(/\{z\}/gi, String(zoom)).replace(/\{x\}/gi, String(tileX)).replace(/\{y\}/gi, String(y));
      svg.append(createSvgElement('image', { x: left.toFixed(2), y: top.toFixed(2), width: (right - left).toFixed(2), height: (bottom - top).toFixed(2), href, preserveAspectRatio: 'none', class: 'external-basemap-image', 'aria-hidden': 'true' }));
    }
  }
}

function appendRasterLayer(layer, project) {
  const raster = layer.raster;
  if (!raster?.previewDataUrl || raster.cornersWgs84?.length !== 4) return;
  const [topLeft, topRight, , bottomLeft] = raster.cornersWgs84.map(project);
  const a = (topRight[0] - topLeft[0]) / raster.width;
  const b = (topRight[1] - topLeft[1]) / raster.width;
  const c = (bottomLeft[0] - topLeft[0]) / raster.height;
  const d = (bottomLeft[1] - topLeft[1]) / raster.height;
  const matrix = `matrix(${a} ${b} ${c} ${d} ${topLeft[0]} ${topLeft[1]})`;
  svg.append(createSvgElement('image', {
    x: 0, y: 0, width: raster.width, height: raster.height, transform: matrix,
    href: raster.previewDataUrl, opacity: raster.opacity ?? 0.85,
    preserveAspectRatio: 'none', class: 'raster-overlay', 'aria-hidden': 'true', 'pointer-events': 'none'
  }));
}

function renderMap() {
  svg.replaceChildren();
  const visibleLayers = state.layers.filter(layer => layer.visible);
  const rasterLayers = visibleLayers.filter(layer => layer.kind === 'raster');
  const renderEntries = visibleLayers.map(layer => ({
    layer,
    items: layer.kind === 'raster' ? [] : visibleFeatures(layer)
  }));
  const entries = renderEntries.filter(entry => entry.layer.kind !== 'raster');
  const allFeatures = entries.flatMap(entry => entry.items.map(item => item.feature));
  const rasterExtentPoints = rasterLayers.flatMap(layer => (layer.raster?.cornersWgs84 || []).map(coordinates => ({ geometry: { type: 'Point', coordinates } })));
  let project = state.surveyViewEnabled ? buildSurveyProjector() : null;
  if (!project) project = buildProjector([...allFeatures, ...rasterExtentPoints]);
  const hasFeatureGeometry = allFeatures.some(feature => !!feature.geometry);
  currentProjector = project;
  $('#mapAttribution').textContent = state.basemap ? `Fond externe · ${state.basemap.attribution}` : '';
  mapEmpty.hidden = !!project;
  if (!project) {
    $('#mapSummary').textContent = 'Aucune entité ou image raster affichable dans les couches visibles';
    $('#renderWarning').hidden = true;
    updateActions();
    return;
  }
  appendExternalBasemap(project);
  if (!hasFeatureGeometry && state.surveyViewEnabled) {
    svg.append(createSvgElement('circle', { cx: 500, cy: 300, r: 8, fill: '#fff', stroke: '#b7603e', 'stroke-width': 2, class: 'survey-center-mark', 'pointer-events': 'none' }));
    svg.append(createSvgElement('path', { d: 'M488 300h24M500 288v24', stroke: '#b7603e', 'stroke-width': 1.5, class: 'survey-center-mark', 'pointer-events': 'none' }));
  }
  let rendered = 0;
  let truncated = false;
  const budget = { count: 0, truncated: false, labels: 0 };
  for (const { layer, items } of renderEntries) {
    if (layer.kind === 'raster') {
      appendRasterLayer(layer, project);
      continue;
    }
    if (truncated) continue;
    for (const { feature, index } of items) {
      if (!feature.geometry) continue;
      if (rendered >= MAX_RENDERED_FEATURES) { truncated = true; break; }
      appendGeometry(feature.geometry, project, layer, feature, index, budget);
      rendered++;
      if (budget.truncated) { truncated = true; break; }
    }
  }
  if (state.pendingCoordinates.length) {
    const points = state.pendingCoordinates.map(project);
    const d = `M${points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join('L')}${state.drawMode === 'Polygon' && points.length >= 3 ? 'Z' : ''}`;
    svg.append(createSvgElement('path', { d, class: 'pending-drawing' }));
    for (const [x, y] of points) svg.append(createSvgElement('circle', { cx: x.toFixed(2), cy: y.toFixed(2), r: '4', class: 'pending-vertex' }));
  }
  const total = entries.reduce((sum, entry) => sum + entry.items.length, 0);
  const rasterSummary = rasterLayers.length ? ` · ${rasterLayers.length} raster(s)` : '';
  $('#mapSummary').textContent = `${rendered.toLocaleString('fr-FR')} entité(s) dessinée(s) · ${total.toLocaleString('fr-FR')} entité(s) après filtre${rasterSummary}`;
  const warning = $('#renderWarning');
  warning.hidden = !truncated;
  warning.textContent = truncated ? `Aperçu limité à ${MAX_RENDERED_FEATURES.toLocaleString('fr-FR')} entités / ${MAX_RENDERED_SHAPES.toLocaleString('fr-FR')} symboles; l’export conserve la couche entière.` : '';
  updateActions();
}

function moveLayerInStack(layerId, direction) {
  const reordered = moveLayerStack(state.layers, layerId, direction);
  const changed = reordered.some((layer, index) => layer.id !== state.layers[index]?.id);
  if (!changed) return;
  state.layers = reordered;
  renderLayerList(); renderMap(); renderAttributes();
  const layer = state.layers.find(item => item.id === layerId);
  status(`Couche « ${layer?.name || 'sélectionnée'} » déplacée ${direction === 'up' ? 'au-dessus' : 'en dessous'} dans la pile.`, 'success');
}

function renderLayerList() {
  layerList.replaceChildren();
  $('#layerCount').textContent = String(state.layers.length);
  const hasLayers = state.layers.length > 0;
  if (!hasLayers) {
    const empty = document.createElement('p');
    empty.className = 'empty-layers';
    empty.textContent = 'Ajoutez un GeoJSON, CSV/TSV, KML/KMZ, Shapefile, GeoPackage ou GeoTIFF pour commencer.';
    layerList.append(empty);
  }
  const topFirst = layersTopFirst(state.layers);
  for (let displayIndex = 0; displayIndex < topFirst.length; displayIndex++) {
    const layer = topFirst[displayIndex];
    const card = document.createElement('article');
    card.className = 'layer-card';
    card.dataset.selected = String(layer.id === state.selectedLayerId);
    const main = document.createElement('div');
    main.className = 'layer-main';
    const orderControls = document.createElement('span'); orderControls.className = 'layer-order-controls';
    const moveUp = document.createElement('button'); moveUp.type = 'button'; moveUp.textContent = '↑';
    moveUp.disabled = displayIndex === 0; moveUp.title = 'Déplacer au-dessus';
    moveUp.setAttribute('aria-label', `Déplacer « ${layer.name} » au-dessus`);
    moveUp.addEventListener('click', () => moveLayerInStack(layer.id, 'up'));
    const moveDown = document.createElement('button'); moveDown.type = 'button'; moveDown.textContent = '↓';
    moveDown.disabled = displayIndex === topFirst.length - 1; moveDown.title = 'Déplacer en dessous';
    moveDown.setAttribute('aria-label', `Déplacer « ${layer.name} » en dessous`);
    moveDown.addEventListener('click', () => moveLayerInStack(layer.id, 'down'));
    orderControls.append(moveUp, moveDown);
    const visible = document.createElement('input');
    visible.type = 'checkbox'; visible.className = 'layer-visible';
    visible.checked = layer.visible; visible.setAttribute('aria-label', `Afficher ${layer.name}`);
    visible.addEventListener('change', () => { layer.visible = visible.checked; state.selectedFeature = null; renderLayerTools(); renderMap(); renderAttributes(); updateActions(); });
    const choose = document.createElement('button');
    choose.type = 'button'; choose.className = 'layer-name'; choose.textContent = layer.name;
    choose.title = 'Choisir cette couche pour la table des attributs';
    choose.addEventListener('click', () => { state.selectedLayerId = layer.id; state.selectedFeature = null; renderLayerList(); renderLayerTools(); renderAttributes(); });
    let styleControl;
    if (layer.kind === 'raster') {
      styleControl = document.createElement('input');
      styleControl.type = 'range'; styleControl.className = 'layer-opacity';
      styleControl.min = '0'; styleControl.max = '100'; styleControl.step = '5';
      styleControl.value = String(Math.round((layer.raster.opacity ?? 0.85) * 100));
      styleControl.setAttribute('aria-label', `Opacité de ${layer.name}`);
      styleControl.addEventListener('input', () => { layer.raster.opacity = Number(styleControl.value) / 100; renderMap(); });
    } else {
      styleControl = document.createElement('input');
      styleControl.type = 'color'; styleControl.className = 'layer-color'; styleControl.value = layer.color;
      styleControl.setAttribute('aria-label', `Couleur de ${layer.name}`);
      styleControl.addEventListener('input', () => { layer.color = styleControl.value; renderMap(); });
    }
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'remove-layer'; remove.textContent = '×';
    remove.setAttribute('aria-label', `Retirer ${layer.name}`);
    remove.addEventListener('click', () => {
      state.layers = state.layers.filter(item => item.id !== layer.id);
      if (state.selectedLayerId === layer.id) state.selectedLayerId = state.layers[0]?.id || null;
      state.selectedFeature = null; renderAll();
      status(`Couche retirée · ${layer.name}`, 'success');
    });
    main.append(orderControls, visible, choose, styleControl, remove);
    const meta = document.createElement('p');
    meta.className = 'layer-meta';
    const imported = new Date(layer.importedAt).toLocaleString('fr-FR');
    if (layer.kind === 'raster') {
      const range = layer.raster.bands[0];
      meta.textContent = `${layer.raster.width} × ${layer.raster.height} pixels · ${layer.raster.samplesPerPixel} bande(s) · ${layer.raster.dataType} · ${layer.sourceCrs} → EPSG:4326 · valeurs ${range.min.toFixed(3)}–${range.max.toFixed(3)} · Import ${imported} · Source : ${layer.source}`;
    } else {
      const edited = layer.lastEditedAt && Number.isFinite(Date.parse(layer.lastEditedAt)) ? ` · Modifiée ${new Date(layer.lastEditedAt).toLocaleString('fr-FR')}` : '';
      const remoteState = Number.isSafeInteger(layer.geojson.remotePages)
        ? layer.geojson.remoteTruncated === true
          ? ` · Import distant plafonné (${layer.geojson.remoteTruncationReason === 'PAGE_LIMIT' ? 'limite de pages' : 'limite d’entités'}; suite éventuelle non demandée; ${layer.geojson.remotePages} page(s))`
          : ` · Service distant (${layer.geojson.remotePages} page(s))` : '';
      const derivation = layer.geojson.urbatrameDerivation?.operation ? ` · Dérivé : ${layer.geojson.urbatrameDerivation.operation}` : '';
      meta.textContent = `${layer.geojson.features.length.toLocaleString('fr-FR')} entité(s) · ${layer.sourceCrs === layer.crs ? layer.crs : `${layer.sourceCrs} → ${layer.crs}`} · Import ${imported}${remoteState}${derivation}${edited} · Source : ${layer.source}`;
    }
    card.append(main, meta);
    layerList.append(card);
  }
  updateActions();
  renderLayerTools();
}

function formatCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    try { return JSON.stringify(value); } catch { return '[valeur]'; }
  }
  return String(value);
}

function selectedLayer() { return state.layers.find(layer => layer.id === state.selectedLayerId) || null; }

function fillFieldSelect(select, fields, placeholder, value = '') {
  select.replaceChildren();
  const blank = document.createElement('option'); blank.value = ''; blank.textContent = placeholder; select.append(blank);
  for (const field of fields) {
    const option = document.createElement('option'); option.value = field; option.textContent = field; select.append(option);
  }
  select.value = fields.includes(value) ? value : '';
}

function renderLayerTools() {
  const layer = selectedLayer();
  const isVector = !!layer && layer.kind !== 'raster';
  const fields = isVector ? [...new Set(layer.geojson.features.flatMap(feature => Object.keys(feature.properties || {})))].slice(0, 80) : [];
  fillFieldSelect($('#filterField'), fields, 'Choisir un champ', layer?.filter?.field || '');
  fillFieldSelect($('#styleField'), fields, 'Choisir un attribut', layer?.categoryField || '');
  fillFieldSelect($('#labelField'), fields, 'Aucune étiquette', layer?.labelField || '');
  $('#filterValue').value = layer?.filter?.value || '';
  for (const id of ['filterField', 'styleField', 'labelField', 'filterValue', 'applyFilter', 'clearFilter', 'applyCategoryStyle', 'applyLabels', 'analyzeLayer', 'drawPoint', 'drawLine', 'drawPolygon'])
    $(`#${id}`).disabled = !isVector;
  if (layer?.kind === 'raster') {
    const band = layer.raster.bands[0];
    $('#analysisResults').textContent = `GeoTIFF local · ${layer.raster.width} × ${layer.raster.height} pixels · ${layer.raster.validPixels.toLocaleString('fr-FR')} pixels valides · min ${band.min.toFixed(3)} / max ${band.max.toFixed(3)} · NoData ${layer.raster.noData ?? 'absent'}. Aperçu colorisé indicatif; les valeurs restent inchangées et aucune analyse raster n’est exécutée.`;
  }
  updateEditControls();
  renderDashboard();
}

function dashboardKpi(label, value, note = '') {
  const article = document.createElement('article'); article.className = 'dashboard-kpi';
  const strong = document.createElement('strong'); strong.textContent = String(value);
  const caption = document.createElement('span'); caption.textContent = label;
  article.append(strong, caption);
  if (note) article.title = note;
  return article;
}

function renderDashboardChart(summary, field) {
  const host = $('#dashboardChart'); host.replaceChildren();
  if (!field) {
    const empty = document.createElement('p'); empty.className = 'dashboard-empty';
    empty.textContent = 'Choisissez un attribut pour comparer le nombre d’entités par catégorie.'; host.append(empty); return;
  }
  if (!summary.categories.length) {
    const empty = document.createElement('p'); empty.className = 'dashboard-empty';
    empty.textContent = `Aucune valeur disponible dans « ${field} » après le filtre appliqué.`; host.append(empty); return;
  }
  const width = 760, rowHeight = 27, height = 22 + summary.categories.length * rowHeight;
  const labelWidth = 200, chartWidth = 470, maxCount = Math.max(1, ...summary.categories.map(item => item.count));
  const chart = document.createElementNS(SVG_NS, 'svg');
  chart.setAttribute('viewBox', `0 0 ${width} ${height}`); chart.setAttribute('role', 'img');
  chart.setAttribute('aria-label', `Nombre d’entités par valeur de ${field}`);
  const title = document.createElementNS(SVG_NS, 'title'); title.textContent = `Répartition par ${field}`; chart.append(title);
  summary.categories.forEach((item, index) => {
    const y = 16 + index * rowHeight;
    const label = document.createElementNS(SVG_NS, 'text'); label.setAttribute('x', '8'); label.setAttribute('y', String(y + 10)); label.setAttribute('class', 'bar-label');
    label.textContent = item.label.length > 32 ? `${item.label.slice(0, 29)}…` : item.label;
    const labelTitle = document.createElementNS(SVG_NS, 'title'); labelTitle.textContent = item.label; label.append(labelTitle); chart.append(label);
    const backdrop = document.createElementNS(SVG_NS, 'rect'); backdrop.setAttribute('x', String(labelWidth)); backdrop.setAttribute('y', String(y)); backdrop.setAttribute('width', String(chartWidth)); backdrop.setAttribute('height', '13'); backdrop.setAttribute('rx', '4'); backdrop.setAttribute('class', 'bar-bg'); chart.append(backdrop);
    const bar = document.createElementNS(SVG_NS, 'rect'); bar.setAttribute('x', String(labelWidth)); bar.setAttribute('y', String(y)); bar.setAttribute('width', String(Math.max(2, chartWidth * item.count / maxCount))); bar.setAttribute('height', '13'); bar.setAttribute('rx', '4'); bar.setAttribute('class', 'bar-value'); chart.append(bar);
    const count = document.createElementNS(SVG_NS, 'text'); count.setAttribute('x', String(labelWidth + chartWidth + 12)); count.setAttribute('y', String(y + 10)); count.setAttribute('class', 'bar-count'); count.textContent = item.count.toLocaleString('fr-FR'); chart.append(count);
  });
  host.append(chart);
}

function renderDashboard() {
  const root = $('#dashboardKpis'), fieldSelect = $('#dashboardField');
  const layer = selectedLayer(); root.replaceChildren();
  const filterState = $('#dashboardFilterState'), meta = $('#dashboardMeta');
  if (!layer) {
    fieldSelect.replaceChildren(new Option('Choisir une couche', '')); fieldSelect.disabled = true;
    const empty = document.createElement('p'); empty.className = 'dashboard-empty'; empty.textContent = 'Importez ou sélectionnez une couche vectorielle pour afficher ses indicateurs.'; root.append(empty);
    filterState.textContent = 'Aucun filtre appliqué'; meta.textContent = 'Calcul local dans le navigateur; aucun appel à un service externe.';
    renderDashboardChart({ categories: [] }, ''); return;
  }
  if (layer.kind === 'raster') {
    fieldSelect.replaceChildren(new Option('Aucune statistique par attribut pour le raster', '')); fieldSelect.disabled = true;
    const band = layer.raster.bands[0];
    root.append(
      dashboardKpi('Dimensions', `${layer.raster.width.toLocaleString('fr-FR')} × ${layer.raster.height.toLocaleString('fr-FR')}`),
      dashboardKpi('Pixels valides', layer.raster.validPixels.toLocaleString('fr-FR')),
      dashboardKpi('Minimum bande 1', band.min.toLocaleString('fr-FR', { maximumFractionDigits: 3 })),
      dashboardKpi('Maximum bande 1', band.max.toLocaleString('fr-FR', { maximumFractionDigits: 3 }))
    );
    filterState.textContent = 'Aucun filtre vectoriel';
    meta.textContent = 'Résumé des métadonnées seulement : aucune agrégation ou analyse pixel par pixel n’est exécutée.';
    renderDashboardChart({ categories: [] }, ''); return;
  }
  const fields = [...new Set(layer.geojson.features.flatMap(feature => Object.keys(feature.properties || {})))].slice(0, 80);
  const currentField = fieldSelect.value;
  fillFieldSelect(fieldSelect, fields, 'Choisir un attribut', currentField);
  fieldSelect.disabled = !fields.length;
  const features = visibleFeatures(layer).map(item => item.feature);
  const summary = buildDashboardSummary(features, fieldSelect.value);
  root.append(
    dashboardKpi('Entités après filtre', summary.featureCount.toLocaleString('fr-FR')),
    dashboardKpi('Points', summary.pointCount.toLocaleString('fr-FR')),
    dashboardKpi('Lignes', summary.lineCount.toLocaleString('fr-FR')),
    dashboardKpi('Polygones', summary.polygonCount.toLocaleString('fr-FR')),
    dashboardKpi('Longueurs / contours', formatLength(summary.lengthMeters), 'Longueurs géodésiques; pour les polygones, longueur du contour.'),
    dashboardKpi('Surface cumulée', formatArea(summary.areaSqMeters), 'Approximation plane locale; chevauchements non dissous.')
  );
  const total = layer.geojson.features.length;
  const hiddenNote = layer.visible ? '' : ' · couche masquée sur la carte';
  filterState.textContent = layer.filter?.field
    ? `Filtre : ${layer.filter.field} contient « ${layer.filter.value} » · ${features.length.toLocaleString('fr-FR')}/${total.toLocaleString('fr-FR')}${hiddenNote}`
    : `${features.length.toLocaleString('fr-FR')} entité(s) · aucun filtre${hiddenNote}`;
  meta.textContent = `Couche « ${layer.name} » · EPSG:4326 · calcul local dans le navigateur. Les résultats reflètent le filtre de la couche; ils ne sont pas transmis et ne constituent pas une mesure réglementaire.`;
  renderDashboardChart(summary, fieldSelect.value);
}

function formatLength(metres) {
  return metres < 1000 ? `${metres.toFixed(1)} m` : `${(metres / 1000).toFixed(3)} km`;
}
function formatArea(metres2) {
  return metres2 < 10_000 ? `${metres2.toFixed(1)} m²` : `${(metres2 / 1_000_000).toFixed(4)} km²`;
}

let lastEditSelectionKey = '';
function updateEditControls() {
  const layer = state.layers.find(item => item.id === state.selectedFeature?.layerId) || selectedLayer();
  const history = selectedLayer()?.editHistory || { undo: [], redo: [] };
  const feature = layer && state.selectedFeature?.layerId === layer.id ? layer.geojson.features[state.selectedFeature.index] : null;
  const selectionKey = feature ? `${layer.id}:${state.selectedFeature.index}` : '';
  const vertexCount = feature ? countFeaturePositions([feature]) : 0;
  const vertexInput = $('#editVertexIndex');
  if (selectionKey !== lastEditSelectionKey) {
    vertexInput.value = vertexCount ? '1' : '';
    $('#editAttributeName').value = ''; $('#editAttributeValue').value = '';
    lastEditSelectionKey = selectionKey;
  }
  vertexInput.max = String(Math.max(1, vertexCount));
  vertexInput.disabled = !feature || !!state.drawMode;
  if (vertexCount && Number(vertexInput.value) > vertexCount) vertexInput.value = String(vertexCount);
  const vertexIndex = Number(vertexInput.value) - 1;
  const vertex = feature && Number.isInteger(vertexIndex) ? getVertex(feature.geometry, vertexIndex) : null;
  $('#finishDrawing').disabled = !state.drawMode || state.drawMode === 'Point' || state.pendingCoordinates.length < (state.drawMode === 'Polygon' ? 3 : 2);
  $('#cancelDrawing').disabled = !state.drawMode;
  $('#undoEdit').disabled = !history.undo.length;
  $('#redoEdit').disabled = !history.redo.length;
  $('#moveSelectedVertex').disabled = !vertex || !!state.drawMode;
  $('#deleteSelectedVertex').disabled = !feature || !vertex || !canDeleteVertex(feature.geometry, vertexIndex) || !!state.drawMode;
  $('#insertSelectedVertex').disabled = !feature || !vertex || !canInsertVertex(feature.geometry, vertexIndex) || !canRestoreFeature(layer, 1, false) || !!state.drawMode;
  $('#deleteSelectedFeature').disabled = !feature || !!state.drawMode;
  const attributeName = $('#editAttributeName').value.trim();
  const properties = feature?.properties && typeof feature.properties === 'object' ? feature.properties : {};
  const hasAttribute = Object.hasOwn(properties, attributeName);
  $('#editAttributeName').disabled = !feature || !!state.drawMode;
  $('#editAttributeValue').disabled = !feature || !!state.drawMode;
  $('#saveFeatureAttribute').disabled = !feature || !attributeName || !!state.drawMode;
  $('#deleteFeatureAttribute').disabled = !feature || !hasAttribute || !!state.drawMode;
  const attributeKeys = Object.keys(properties);
  const attributeOptions = $('#editAttributeOptions'); attributeOptions.replaceChildren();
  for (const key of attributeKeys.slice(0, 100)) { const option = document.createElement('option'); option.value = key; attributeOptions.append(option); }
  $('#attributeFieldsSummary').textContent = !feature ? 'Sélectionnez une entité pour modifier ses attributs.'
    : attributeKeys.length ? `Champs (${attributeKeys.length}) : ${attributeKeys.slice(0, 12).join(', ')}${attributeKeys.length > 12 ? '…' : ''}` : 'Cette entité ne contient aucun attribut.';
  $('#selectedEditSummary').textContent = feature
    ? `${layer.name} · entité ${state.selectedFeature.index + 1} · ${feature.geometry.type} · ${vertexCount.toLocaleString('fr-FR')} sommet(s)`
    : 'Cliquez sur une entité pour la sélectionner.';
  $('#editPointLon').value = vertex ? vertex.coordinates[0] : '';
  $('#editPointLat').value = vertex ? vertex.coordinates[1] : '';
  $('#editPointLon').disabled = !vertex || !!state.drawMode;
  $('#editPointLat').disabled = !vertex || !!state.drawMode;
  $('#editStatus').textContent = state.drawMode
    ? `${state.drawMode === 'Point' ? 'Cliquez dans la carte pour ajouter un point' : `Cliquez pour placer des sommets (${state.pendingCoordinates.length}); terminez la géométrie quand elle est prête`}.`
    : 'Ajoutez des entités, insérez/déplacez/supprimez des sommets ou supprimez une entité. Les modifications sont locales, annulables et exportables.';
}

function renderAttributes() {
  const head = $('#attributeTable thead');
  const body = $('#attributeTable tbody');
  head.replaceChildren(); body.replaceChildren();
  const layer = state.layers.find(item => item.id === (state.selectedFeature?.layerId || state.selectedLayerId));
  if (!layer) {
    $('#tableSummary').textContent = 'Sélectionnez une couche';
    const row = document.createElement('tr'), cell = document.createElement('td');
    cell.className = 'table-empty'; cell.colSpan = 1; cell.textContent = 'Importez une couche pour voir ses attributs.';
    row.append(cell); body.append(row); return;
  }
  if (layer.kind === 'raster') {
    const raster = layer.raster, band = raster.bands[0];
    const header = document.createElement('tr');
    for (const label of ['Propriété', 'Valeur']) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = label; header.append(th); }
    head.append(header);
    const bounds = raster.boundsWgs84;
    const details = [
      ['Format', 'GeoTIFF'], ['Dimensions', `${raster.width} × ${raster.height} pixels`],
      ['Bande(s)', `${raster.samplesPerPixel} · ${raster.dataType}`], ['CRS source', raster.sourceCrs],
      ['CRS affichage', 'EPSG:4326 · WGS 84'], ['Résolution source', `${raster.pixelSize[0]} × ${raster.pixelSize[1]} unités/pixel`],
      ['NoData', raster.noData === null ? 'absent' : raster.noData], ['Minimum valide · bande 1', band.min],
      ['Maximum valide · bande 1', band.max], ['Pixels valides', raster.validPixels],
      ['Emprise WGS 84', `${bounds.west.toFixed(6)}, ${bounds.south.toFixed(6)} — ${bounds.east.toFixed(6)}, ${bounds.north.toFixed(6)}`]
    ];
    for (const [property, value] of details) {
      const row = document.createElement('tr');
      for (const content of [property, formatCell(value)]) { const cell = document.createElement('td'); cell.textContent = content; row.append(cell); }
      body.append(row);
    }
    $('#tableSummary').textContent = `${layer.name} · résumé raster`;
    return;
  }
  const filteredItems = visibleFeatures(layer);
  const selected = state.selectedFeature?.layerId === layer.id
    ? [layer.geojson.features[state.selectedFeature.index]].filter(Boolean)
    : filteredItems.slice(0, 10).map(item => item.feature);
  const keys = [...new Set(selected.flatMap(feature => Object.keys(feature.properties || {})))].slice(0, 8);
  const columns = ['id', ...keys.filter(key => key !== 'id')];
  const headerRow = document.createElement('tr');
  for (const name of columns) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = name; headerRow.append(th); }
  head.append(headerRow);
  for (const feature of selected) {
    const row = document.createElement('tr');
    for (const column of columns) {
      const cell = document.createElement('td');
      const value = column === 'id' ? (feature.id ?? feature.properties?.id ?? '') : feature.properties?.[column];
      cell.textContent = formatCell(value);
      cell.title = cell.textContent;
      row.append(cell);
    }
    body.append(row);
  }
  if (!selected.length) {
    const row = document.createElement('tr'), cell = document.createElement('td');
    cell.className = 'table-empty'; cell.colSpan = 1; cell.textContent = 'Cette couche ne contient pas d’entité.';
    row.append(cell); body.append(row);
  }
  $('#tableSummary').textContent = state.selectedFeature?.layerId === layer.id
    ? `${layer.name} · entité sélectionnée`
    : `${layer.name} · aperçu de ${selected.length} ligne(s)`;
}

function startDrawing(mode) {
  const layer = selectedLayer();
  if (!layer) { status('Importez une couche puis sélectionnez-la avant de dessiner.', 'error'); return; }
  if (layer.kind === 'raster') { status('L’édition de géométries est disponible sur une couche vectorielle, pas sur le GeoTIFF.', 'error'); return; }
  if (!layer.visible) { layer.visible = true; renderLayerList(); renderMap(); }
  if (!currentProjector) { status('Aucune géométrie visible pour cadrer le dessin.', 'error'); return; }
  state.drawMode = mode;
  state.pendingCoordinates = [];
  updateEditControls();
}

function surveyPropertiesFromForm() {
  let template;
  try { template = fieldTemplateFromEditor(); state.surveyTemplate = template; }
  catch (error) {
    const labels = {
      FIELD_TEMPLATE_KEY_INVALID: 'clé invalide', FIELD_TEMPLATE_KEY_DUPLICATE: 'clé en double',
      FIELD_TEMPLATE_LABEL_REQUIRED: 'libellé manquant', FIELD_TEMPLATE_OPTIONS_INVALID: 'liste de choix vide ou invalide',
      FIELD_TEMPLATE_NAME_REQUIRED: 'nom de gabarit manquant', FIELD_TEMPLATE_TYPE_INVALID: 'type de champ invalide'
    };
    return { ok: false, error: 'FIELD_TEMPLATE_INVALID', field: 'template', label: `Gabarit invalide : ${labels[error?.code] || 'vérifiez les champs'}` };
  }
  const values = Object.create(null);
  for (const field of template.fields) {
    const input = $(`#survey-value-${field.key}`);
    if (!input) continue;
    values[field.key] = field.type === 'boolean' ? input.checked : input.value;
  }
  return buildSurveyProperties(template, values);
}

function addEditedFeature(layer, geometry, { surveyProperties = null, captureProperties = {}, captureMetadata = {} } = {}) {
  const validated = surveyProperties ? { ok: true, properties: surveyProperties } : surveyPropertiesFromForm();
  if (!validated.ok) {
    status(`Champ requis ou valeur invalide : ${validated.label || validated.field}.`, 'error');
    return false;
  }
  const totalFeatures = state.layers.reduce((sum, item) => sum + item.geojson.features.length, 0);
  const totalPositions = state.layers.reduce((sum, item) => sum + (item.positionCount ?? countFeaturePositions(item.geojson.features)), 0);
  const addedPositions = countFeaturePositions([{ geometry }]);
  const currentLayerPositions = layer.positionCount ?? countFeaturePositions(layer.geojson.features);
  if (layer.geojson.features.length >= MAX_FEATURES || totalFeatures >= MAX_TOTAL_FEATURES) { status('Limite d’entités atteinte; supprimez ou exportez des couches avant de dessiner.', 'error'); return; }
  if (totalPositions + addedPositions > MAX_TOTAL_POSITIONS) { status('Limite de positions atteinte; simplifiez les données avant de dessiner.', 'error'); return; }
  const createdAt = String(captureMetadata.capturedAt || new Date().toISOString());
  const feature = {
    type: 'Feature',
    id: `${layer.id}-edit-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
    properties: {
      ...validated.properties,
      ...(captureProperties && typeof captureProperties === 'object' ? captureProperties : {}),
      _urbaTrame: { source: captureMetadata.method || 'Dessin local dans UrbaTrame', createdAt, ...captureMetadata }
    },
    geometry
  };
  const index = layer.geojson.features.length;
  try { recordLayerEdit(layer, { kind: 'add', feature, index, positions: addedPositions }); }
  catch (error) { status(error.code === 'EDIT_HISTORY_ENTRY_TOO_LARGE' ? 'Édition refusée : cette géométrie dépasse la mémoire maximale réservée à l’annulation.' : 'Édition impossible à enregistrer.', 'error'); return; }
  layer.geojson.features.push(feature);
  layer.positionCount = currentLayerPositions + addedPositions;
  layer.filter = null;
  state.selectedFeature = { layerId: layer.id, index };
  renderAll();
  status(`Entité dessinée ajoutée à « ${layer.name} »; elle sera incluse dans les exports.`, 'success');
  return true;
}

function finishDrawing() {
  if (!state.drawMode || state.drawMode === 'Point') return;
  const min = state.drawMode === 'Polygon' ? 3 : 2;
  if (state.pendingCoordinates.length < min) return;
  const layer = selectedLayer();
  if (!layer) return;
  const survey = surveyPropertiesFromForm();
  if (!survey.ok) { status(`Champ requis ou valeur invalide : ${survey.label || survey.field}. Complétez la fiche avant de terminer.`, 'error'); return; }
  let coordinates = state.pendingCoordinates.map(point => [...point]);
  let geometry;
  if (state.drawMode === 'Polygon') {
    const first = coordinates[0], last = coordinates.at(-1);
    if (first[0] !== last[0] || first[1] !== last[1]) coordinates.push([...first]);
    geometry = { type: 'Polygon', coordinates: [coordinates] };
  } else geometry = { type: 'LineString', coordinates };
  state.drawMode = null;
  state.pendingCoordinates = [];
  addEditedFeature(layer, geometry);
  updateEditControls();
}

function canRestoreFeature(layer, positions, addsFeature = true) {
  const totalFeatures = state.layers.reduce((sum, item) => sum + item.geojson.features.length, 0);
  const totalPositions = state.layers.reduce((sum, item) => sum + (item.positionCount ?? countFeaturePositions(item.geojson.features)), 0);
  const layerPositions = layer.positionCount ?? countFeaturePositions(layer.geojson.features);
  const featureSlotAvailable = !addsFeature || (layer.geojson.features.length < MAX_FEATURES && totalFeatures < MAX_TOTAL_FEATURES);
  return featureSlotAvailable && layerPositions + positions <= MAX_COORDINATE_POSITIONS && totalPositions + positions <= MAX_TOTAL_POSITIONS;
}
function undoEdit() {
  const layer = selectedLayer();
  if (!layer) return;
  const result = undoLayerEdit(layer, (positions, addsFeature) => canRestoreFeature(layer, positions, addsFeature));
  if (!result) return;
  if (result.blocked) { status('Annulation impossible : limite de données atteinte.', 'error'); return; }
  state.selectedFeature = result.kind === 'add' ? null : { layerId: layer.id, index: result.index };
  renderAll();
  const messages = { add: 'Ajout local annulé.', delete: 'Suppression locale annulée.', move: 'Déplacement local annulé.', 'move-vertex': 'Déplacement du sommet annulé.', 'insert-vertex': 'Insertion du sommet annulée.', 'delete-vertex': 'Suppression du sommet annulée.', attribute: 'Modification d’attribut annulée.' };
  status(messages[result.kind] || 'Dernière édition locale annulée.', 'success');
}
function redoEdit() {
  const layer = selectedLayer();
  if (!layer) return;
  const result = redoLayerEdit(layer, (positions, addsFeature) => canRestoreFeature(layer, positions, addsFeature));
  if (!result) return;
  if (result.blocked) { status('Rétablissement impossible : limite de données atteinte.', 'error'); return; }
  state.selectedFeature = result.kind === 'delete' ? null : { layerId: layer.id, index: result.index };
  renderAll();
  const messages = { add: 'Ajout local rétabli.', delete: 'Suppression locale rétablie.', move: 'Déplacement local rétabli.', 'move-vertex': 'Déplacement du sommet rétabli.', 'insert-vertex': 'Insertion du sommet rétablie.', 'delete-vertex': 'Suppression du sommet rétablie.', attribute: 'Modification d’attribut rétablie.' };
  status(messages[result.kind] || 'Dernière édition locale rétablie.', 'success');
}
function selectedVertexContext() {
  const selected = state.selectedFeature, layer = state.layers.find(item => item.id === selected?.layerId);
  const vertexIndex = Number($('#editVertexIndex').value) - 1;
  const feature = layer?.geojson.features[selected?.index];
  return { selected, layer, feature, vertexIndex };
}
function readVertexCoordinates() {
  const rawLon = $('#editPointLon').value.trim(), rawLat = $('#editPointLat').value.trim();
  const lon = Number(rawLon), lat = Number(rawLat);
  if (!rawLon || !rawLat || !Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) {
    status('Saisissez une longitude (−180…180) et une latitude (−90…90) en WGS 84.', 'error'); return null;
  }
  return [lon, lat];
}
function editFailureMessage(error) {
  return error?.code === 'EDIT_HISTORY_ENTRY_TOO_LARGE'
    ? 'Édition refusée : l’historique de cette entité dépasserait 4 Mo. Exportez ou simplifiez la géométrie avant de la modifier.'
    : error?.code === 'EDIT_HISTORY_ENTRY_INVALID' ? 'Édition refusée : impossible de créer un état d’annulation sûr.' : 'Édition locale impossible; vérifiez l’entité et les limites de données.';
}
function moveSelectedVertex() {
  const { selected, layer, feature, vertexIndex } = selectedVertexContext();
  if (!layer || !feature || !getVertex(feature.geometry, vertexIndex)) return;
  const coordinates = readVertexCoordinates(); if (!coordinates) return;
  try { moveVertex(layer, selected.index, vertexIndex, ...coordinates); }
  catch (error) { status(editFailureMessage(error), 'error'); return; }
  renderAll(); status(`Sommet déplacé dans « ${layer.name} »; le changement est local et annulable.`, 'success');
}
function insertSelectedVertex() {
  const { selected, layer, feature, vertexIndex } = selectedVertexContext();
  if (!layer || !feature || !canInsertVertex(feature.geometry, vertexIndex)) return;
  if (!canRestoreFeature(layer, 1, false)) { status('Insertion impossible : limite de positions atteinte.', 'error'); return; }
  const coordinates = readVertexCoordinates(); if (!coordinates) return;
  try { insertVertex(layer, selected.index, vertexIndex, ...coordinates); }
  catch (error) { status(editFailureMessage(error), 'error'); return; }
  renderAll(); status(`Sommet inséré dans « ${layer.name} »; le changement est local et annulable.`, 'success');
}
function deleteSelectedVertex() {
  const { selected, layer, feature, vertexIndex } = selectedVertexContext();
  if (!layer || !feature || !canDeleteVertex(feature.geometry, vertexIndex)) { status('Suppression impossible : la géométrie doit garder son nombre minimal de sommets.', 'error'); return; }
  try { deleteVertex(layer, selected.index, vertexIndex); }
  catch (error) { status(editFailureMessage(error), 'error'); return; }
  renderAll(); status(`Sommet supprimé de « ${layer.name} »; le changement est local et annulable.`, 'success');
}
function deleteSelectedFeature() {
  const selected = state.selectedFeature, layer = state.layers.find(item => item.id === selected?.layerId);
  if (!layer || !layer.geojson.features[selected.index]) return;
  try { deleteFeature(layer, selected.index); }
  catch (error) { status(editFailureMessage(error), 'error'); return; }
  state.selectedFeature = null;
  renderAll(); status(`Entité supprimée de « ${layer.name} »; annulez l’édition ou exportez la couche pour conserver le changement.`, 'success');
}
function loadSelectedAttributeValue() {
  const { feature } = selectedVertexContext();
  const name = $('#editAttributeName').value.trim();
  if (feature?.properties && Object.hasOwn(feature.properties, name)) $('#editAttributeValue').value = JSON.stringify(feature.properties[name], null, 2);
  else $('#editAttributeValue').value = '';
  updateEditControls();
}
function saveSelectedAttribute() {
  const { selected, layer, feature } = selectedVertexContext();
  if (!layer || !feature) return;
  let value;
  try { value = JSON.parse($('#editAttributeValue').value); }
  catch { status('La valeur doit être du JSON valide (texte entre guillemets, nombre, booléen, tableau ou objet).', 'error'); return; }
  try {
    setFeatureAttribute(layer, selected.index, $('#editAttributeName').value, value);
    renderAll(); status('Attribut enregistré localement; annulez l’édition pour revenir à sa valeur précédente.', 'success');
  } catch (error) {
    status(error.code === 'EDIT_ATTRIBUTE_TOO_LARGE' ? 'Valeur trop volumineuse (maximum 20 Ko).'
      : error.code === 'EDIT_ATTRIBUTE_NAME_INVALID' ? 'Nom de champ vide, trop long ou réservé.' : editFailureMessage(error), 'error');
  }
}
function removeSelectedAttribute() {
  const { selected, layer, feature } = selectedVertexContext();
  if (!layer || !feature) return;
  try {
    deleteFeatureAttribute(layer, selected.index, $('#editAttributeName').value);
    renderAll(); status('Attribut supprimé localement; annulez l’édition pour le restaurer.', 'success');
  } catch (error) {
    status(error.code === 'EDIT_ATTRIBUTE_NOT_FOUND' ? 'Ce champ n’existe pas dans l’entité sélectionnée.' : editFailureMessage(error), 'error');
  }
}
$('#editVertexIndex').addEventListener('input', updateEditControls);
$('#editAttributeName').addEventListener('input', updateEditControls);
$('#editAttributeName').addEventListener('change', loadSelectedAttributeValue);
$('#saveFeatureAttribute').addEventListener('click', saveSelectedAttribute);
$('#deleteFeatureAttribute').addEventListener('click', removeSelectedAttribute);
$('#moveSelectedVertex').addEventListener('click', moveSelectedVertex);
$('#insertSelectedVertex').addEventListener('click', insertSelectedVertex);
$('#deleteSelectedVertex').addEventListener('click', deleteSelectedVertex);
$('#deleteSelectedFeature').addEventListener('click', deleteSelectedFeature);

$('#dashboardField').addEventListener('change', renderDashboard);

$('#applyFilter').addEventListener('click', () => {
  const layer = selectedLayer();
  if (!layer) return;
  const field = $('#filterField').value, value = $('#filterValue').value.trim();
  if (value && !field) { status('Choisissez le champ à filtrer.', 'error'); return; }
  layer.filter = value ? { field, value } : null;
  state.selectedFeature = null; renderLayerTools(); renderMap(); renderAttributes();
  status(value ? `Filtre appliqué sur « ${field} ». Les données originales restent intactes.` : 'Filtre vide; toutes les entités sont visibles.', 'success');
});
$('#clearFilter').addEventListener('click', () => {
  const layer = selectedLayer(); if (!layer) return;
  layer.filter = null; $('#filterValue').value = ''; state.selectedFeature = null;
  renderLayerTools(); renderMap(); renderAttributes(); status('Filtre effacé.', 'success');
});
$('#applyCategoryStyle').addEventListener('click', () => {
  const layer = selectedLayer(); if (!layer) return;
  const field = $('#styleField').value;
  if (!field) { layer.categoryField = ''; layer.categoryColors.clear(); renderMap(); status('Style catégoriel désactivé.', 'success'); return; }
  layer.categoryField = field;
  layer.categoryColors = new Map();
  const values = [...new Set(layer.geojson.features.map(feature => formatCell(feature.properties?.[field]) || '(vide)'))].slice(0, 60);
  values.forEach((value, index) => layer.categoryColors.set(value, PALETTE[index % PALETTE.length]));
  renderMap(); status(`Palette appliquée à ${values.length} catégorie(s) de « ${field} ».`, 'success');
});
$('#applyLabels').addEventListener('click', () => {
  const layer = selectedLayer(); if (!layer) return;
  layer.labelField = $('#labelField').value;
  renderMap(); status(layer.labelField ? `Étiquettes de points : « ${layer.labelField} » (aperçu limité à 500).` : 'Étiquettes désactivées.', 'success');
});
$('#analyzeLayer').addEventListener('click', () => {
  const layer = selectedLayer(); if (!layer) return;
  const summary = summarizeFeatures(visibleFeatures(layer).map(item => item.feature));
  const types = Object.entries(summary.types).map(([type, count]) => `${type}: ${count}`).join(' · ') || 'aucune géométrie';
  const extent = summary.extent ? `${summary.extent.west.toFixed(5)}, ${summary.extent.south.toFixed(5)} → ${summary.extent.east.toFixed(5)}, ${summary.extent.north.toFixed(5)}` : 'indisponible';
  $('#analysisResults').textContent = `${summary.featureCount.toLocaleString('fr-FR')} entité(s) · ${summary.coordinateCount.toLocaleString('fr-FR')} sommets\n${types}\nLongueur cumulée : ${formatLength(summary.lengthMeters)}\nSurface polygonale cumulée : ${formatArea(summary.areaSqMeters)}\nEmprise WGS 84 : ${extent}\nAires approximatives; chevauchements non dissous.`;
});

for (const [selector, mode] of [['#drawPoint', 'Point'], ['#drawLine', 'LineString'], ['#drawPolygon', 'Polygon']])
  $(selector).addEventListener('click', () => startDrawing(mode));
$('#finishDrawing').addEventListener('click', finishDrawing);
$('#cancelDrawing').addEventListener('click', () => { state.drawMode = null; state.pendingCoordinates = []; renderMap(); updateEditControls(); });
$('#undoEdit').addEventListener('click', undoEdit);
$('#redoEdit').addEventListener('click', redoEdit);
svg.addEventListener('click', event => {
  if (!state.drawMode) return;
  if (!currentProjector) { status('Ajoutez une géométrie visible avant de dessiner.', 'error'); return; }
  event.preventDefault(); event.stopImmediatePropagation();
  const point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
  const position = point.matrixTransform(svg.getScreenCTM().inverse());
  const [lon, lat] = currentProjector.inverse(position.x, position.y);
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) {
    status('Le point est hors des limites géographiques WGS 84.', 'error'); return;
  }
  if (state.drawMode === 'Point') {
    const layer = selectedLayer(); if (layer) addEditedFeature(layer, { type: 'Point', coordinates: [lon, lat] });
  } else {
    state.pendingCoordinates.push([lon, lat]); renderMap(); updateEditControls();
  }
}, true);

function haversineMeters(a, b) {
  const rad = Math.PI / 180, radius = 6371008.8;
  const dLat = (b[1] - a[1]) * rad, dLon = (b[0] - a[0]) * rad;
  const q = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(q)));
}
function scaleLabel(meters) { return meters >= 1000 ? `${(meters / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} km` : `${Math.round(meters)} m`; }
function buildLayoutSvg() {
  const clone = svg.cloneNode(true);
  clone.querySelectorAll('.external-basemap-image').forEach(image => image.remove());
  clone.setAttribute('xmlns', SVG_NS);
  clone.setAttribute('width', '1600');
  clone.setAttribute('height', '1184');
  clone.setAttribute('viewBox', '0 0 1000 740');
  const children = [...clone.childNodes];
  clone.replaceChildren();
  clone.append(createSvgElement('rect', { x: 0, y: 0, width: 1000, height: 740, fill: '#ffffff' }));
  const title = createSvgElement('text', { x: 38, y: 30, fill: '#20352b', 'font-size': 22, 'font-family': 'system-ui, sans-serif', 'font-weight': 700 });
  title.textContent = ($('#layoutTitle').value.trim() || 'UrbaTrame · carte locale').slice(0, 120);
  clone.append(title);
  const date = new Date().toLocaleString('fr-FR');
  const subtitle = createSvgElement('text', { x: 38, y: 49, fill: '#68766b', 'font-size': 10, 'font-family': 'system-ui, sans-serif' });
  subtitle.textContent = `Données WGS 84 / EPSG:4326 · export local · ${date}`;
  clone.append(subtitle);
  const content = createSvgElement('g', { transform: 'translate(0 55)' });
  children.forEach(child => content.append(child));
  clone.append(content);
  if (currentProjector) {
    const spanMeters = haversineMeters(currentProjector.inverse(60, 570), currentProjector.inverse(160, 570));
    if (Number.isFinite(spanMeters) && spanMeters > 0) {
      const power = 10 ** Math.floor(Math.log10(spanMeters));
      const target = [5, 2, 1].map(value => value * power).find(value => value <= spanMeters) || spanMeters;
      const barWidth = 100 * target / spanMeters;
      const scale = createSvgElement('g', { transform: 'translate(48 622)' });
      const plate = createSvgElement('rect', { x: -7, y: -24, width: barWidth + 14, height: 42, rx: 4, fill: '#fff', 'fill-opacity': '.88', stroke: '#b8c2b8' });
      scale.append(plate);
      const label = createSvgElement('text', { x: 0, y: -8, fill: '#34443a', 'font-size': 10, 'font-family': 'system-ui,sans-serif', 'font-weight': 700 });
      label.textContent = scaleLabel(target); scale.append(label);
      scale.append(createSvgElement('rect', { x: 0, y: 0, width: barWidth / 2, height: 5, fill: '#34443a' }));
      scale.append(createSvgElement('rect', { x: barWidth / 2, y: 0, width: barWidth / 2, height: 5, fill: '#fff', stroke: '#34443a' }));
      clone.append(scale);
    }
    const north = createSvgElement('g', { transform: 'translate(948 91)' });
    north.append(createSvgElement('circle', { cx: 0, cy: 0, r: 24, fill: '#fff', 'fill-opacity': '.85', stroke: '#cbd4ca' }));
    const northLabel = createSvgElement('text', { x: 0, y: -10, fill: '#314239', 'font-size': 11, 'font-family': 'system-ui,sans-serif', 'font-weight': 800, 'text-anchor': 'middle' });
    northLabel.textContent = 'N'; north.append(northLabel);
    north.append(createSvgElement('path', { d: 'M0,-6 L-8,12 L0,7 L8,12 Z', fill: '#28734f', stroke: '#245e42', 'stroke-width': 1 }));
    clone.append(north);
  }
  const visible = state.layers.filter(layer => layer.visible);
  const legend = createSvgElement('g', { transform: 'translate(38 680)' });
  visible.slice(0, 12).forEach((layer, index) => {
    const x = index % 6 * 155, row = Math.floor(index / 6) * 16;
    if (layer.kind === 'raster') legend.append(createSvgElement('rect', { x: x + 1, y: row - 5, width: 10, height: 10, rx: 2, fill: layer.color, stroke: '#5b665c' }));
    else legend.append(createSvgElement('circle', { cx: x + 6, cy: row, r: 5, fill: layer.color }));
    const text = createSvgElement('text', { x: x + 17, y: row + 4, fill: '#3d4b41', 'font-size': 9, 'font-family': 'system-ui, sans-serif' });
    text.textContent = `${layer.name} · ${layer.source}`.slice(0, 40);
    legend.append(text);
  });
  clone.append(legend);
  const notice = createSvgElement('text', { x: 38, y: 715, fill: '#7d877e', 'font-size': 8, 'font-family': 'system-ui, sans-serif' });
  notice.textContent = state.basemap
    ? `Fond externe non inclus dans ce plan. Attribution du fond à consulter : ${state.basemap.attribution}. Aucune limite juridique n’est créée.`
    : 'Les limites sont celles des données source; aucune limite cadastrale ou juridique n’est créée.';
  clone.append(notice);
  const metadata = createSvgElement('metadata');
  metadata.textContent = JSON.stringify({ exportedAt: new Date().toISOString(), coordinateSystem: 'EPSG:4326', sources: visible.map(layer => ({
    name: layer.name, kind: layer.kind === 'raster' ? 'raster' : 'vector', source: layer.source,
    importedAt: layer.importedAt, sourceCrs: layer.sourceCrs,
    ...(layer.kind === 'raster' ? { raster: {
      format: 'GeoTIFF', width: layer.raster.width, height: layer.raster.height,
      samplesPerPixel: layer.raster.samplesPerPixel, noData: layer.raster.noData,
      bands: layer.raster.bands, boundsWgs84: layer.raster.boundsWgs84,
      display: 'affine-preview-no-pixel-resampling'
    } } : { aiAssistance: layer.geojson.urbatrameAi || null })
  })), externalBackground: state.basemap ? { attribution: state.basemap.attribution, service: state.basemap.type } : null });
  return new XMLSerializer().serializeToString(clone);
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = fileName;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}

$('#exportMapSvg').addEventListener('click', () => {
  const svgText = buildLayoutSvg();
  downloadBlob(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }), 'urbatrame-carte-locale.svg');
  status('Plan SVG exporté avec titre, légende, sources et date.', 'success');
});
$('#exportMapPng').addEventListener('click', () => {
  const svgText = buildLayoutSvg();
  const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }));
  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement('canvas'); canvas.width = 1600; canvas.height = 1184;
    const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(blob => { if (blob) downloadBlob(blob, 'urbatrame-carte-locale.png'); URL.revokeObjectURL(url); }, 'image/png');
  };
  image.onerror = () => { URL.revokeObjectURL(url); status('Export PNG impossible dans ce navigateur; exportez en SVG.', 'error'); };
  image.src = url;
});
$('#printMap').addEventListener('click', () => window.print());
$('#exportProjectJson').addEventListener('click', () => {
  try {
    const template = fieldTemplateFromEditor();
    state.surveyTemplate = template;
    const project = JSON.stringify(serializeLocalProject(state.layers, new Date(), { surveyTemplate: template }), null, 2);
    const blob = new Blob([project], { type: 'application/json;charset=utf-8' });
    if (blob.size > MAX_PROJECT_BYTES) { status('Projet supérieur à 30 Mo. Exportez certaines couches séparément en GeoJSON ou retirez un GeoTIFF.', 'error'); return; }
    downloadBlob(blob, 'urbatrame-projet-local.urbatrame.json');
    status('Projet local exporté avec styles, filtres, provenance, gabarit de relevé et sources GeoTIFF. Les valeurs saisies restent dans les entités; le fond externe et le modèle GTX ne sont pas intégrés.', 'success');
  } catch (error) { status(error?.code ? errorMessage(error) : 'Projet local impossible à préparer.', 'error'); }
});
$('#projectFile').addEventListener('change', async () => {
  const file = $('#projectFile').files?.[0];
  if (!file) return;
  if (file.size > MAX_PROJECT_BYTES) { status('Projet trop volumineux; limite de 30 Mo.', 'error'); $('#projectFile').value = ''; return; }
  try {
    const project = parseLocalProject(await file.text(), { includeMetadata: true });
    const loaded = project.layers.map(layer => ({ ...layer, id: id(), name: layerTitle(layer.name) }));
    const rasterLayers = loaded.filter(layer => layer.kind === 'raster');
    if (rasterLayers.length) {
      status(`Restauration locale de ${rasterLayers.length} GeoTIFF(s) depuis le projet…`);
      const GeoTIFFApi = await loadGeoTiffRuntime();
      let totalRasterBytes = 0, totalRasterPixels = 0;
      for (const layer of rasterLayers) {
        const sourceBytes = base64ToBytes(layer.raster.sourceDataBase64);
        const opacity = layer.raster.opacity;
        const raster = await parseGeoTiff(sourceBytes, GeoTIFFApi, { fileName: layer.fileName });
        totalRasterBytes += sourceBytes.byteLength; totalRasterPixels += raster.pixelCount;
        if (totalRasterBytes > MAX_TOTAL_RASTER_BYTES) throw Object.assign(new Error(), { code: 'PROJECT_TOO_MANY_RASTER_BYTES' });
        if (totalRasterPixels > MAX_TOTAL_RASTER_PIXELS) throw Object.assign(new Error(), { code: 'PROJECT_TOO_MANY_RASTER_PIXELS' });
        layer.sourceCrs = raster.sourceCrs;
        layer.geojson = { type: 'FeatureCollection', name: layer.fileName, crs: 'EPSG:4326', sourceCrs: raster.sourceCrs, features: [] };
        layer.raster = { ...raster, sourceBytes, opacity, previewDataUrl: rasterPreviewDataUrl(raster) };
      }
    }
    state.layers = loaded; state.selectedLayerId = loaded[0]?.id || null; state.selectedFeature = null; state.pendingAiGeoJSON = null;
    setSurveyTemplate(project.surveyTemplate || defaultFieldTemplate());
    state.surveyViewEnabled = false;
    state.gpsFix = null;
    state.basemap = null; $('#removeService').disabled = true; $('#serviceStatus').textContent = 'Projet chargé; le fond externe n’est pas restauré.';
    renderAll(); status(`${loaded.length} couche(s) du projet importée(s) localement avec gabarit de relevé.`, 'success');
  } catch (error) { status(error?.code ? errorMessage(error) : 'Projet invalide.', 'error'); }
  finally { $('#projectFile').value = ''; }
});
$('#runAutomation').addEventListener('click', () => {
  const text = $('#automationRecipe').value;
  const output = $('#automationResults'), artifactList = $('#automationArtifacts');
  artifactList.replaceChildren();
  if (text.length > 32_000) { output.textContent = 'Recette trop longue (limite 32 Ko).'; return; }
  try {
    const recipe = JSON.parse(text);
    const result = runLocalRecipe(state.layers.filter(layer => layer.kind !== 'raster'), recipe);
    output.textContent = JSON.stringify(result.reports, null, 2).slice(0, 10_000) || 'Recette validée; aucune opération à afficher.';
    for (const artifact of result.artifacts) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'button-secondary full-button';
      button.textContent = `Télécharger ${artifact.fileName} · ${artifact.collection.features.length.toLocaleString('fr-FR')} entité(s)`;
      button.addEventListener('click', () => downloadBlob(new Blob([JSON.stringify(artifact.collection)], { type: 'application/geo+json;charset=utf-8' }), artifact.fileName));
      artifactList.append(button);
    }
    status(`${recipe.steps.length} étape(s) de recette exécutée(s) localement; aucun service externe contacté.`, 'success');
  } catch (error) { output.textContent = error?.code ? errorMessage(error) : 'JSON de recette invalide.'; status(output.textContent, 'error'); }
});
async function readResponseTextLimited(response, maximumBytes, errorCode = 'FILE_TOO_LARGE') {
  const announced = Number(response.headers.get('content-length') || 0);
  if (announced > maximumBytes) throw Object.assign(new Error(), { code: errorCode });
  if (!response.body?.getReader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maximumBytes) throw Object.assign(new Error(), { code: errorCode });
    return text;
  }
  const reader = response.body.getReader(), chunks = []; let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) { await reader.cancel(); throw Object.assign(new Error(), { code: errorCode }); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total); let cursor = 0;
  for (const chunk of chunks) { bytes.set(chunk, cursor); cursor += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}
function formatUsd(value) { return `$${value.toLocaleString('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 6 })}`; }
function openRouterModelEndpoint(model) {
  const match = String(model || '').trim().match(/^([a-z0-9_.-]+)\/([a-z0-9_.:-]+)$/i);
  if (!match) throw new Error('Saisissez un ID modèle OpenRouter au format fournisseur/modèle.');
  return `https://openrouter.ai/api/v1/models/${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}/endpoints`;
}
function selectedAiLayers() {
  return [...$('#aiLayers').selectedOptions].map(option => state.layers.find(layer => layer.id === option.value)).filter(Boolean);
}
$('#aiProvider').addEventListener('change', () => {
  state.aiPrice = null; state.pendingAiGeoJSON = null; $('#aiValidateResult').checked = false;
  $('#aiPriceStatus').textContent = 'Le contrôle des tarifs ne transmet ni clé, ni consigne, ni géométrie.';
  updateAiControls();
});
$('#aiModel').addEventListener('input', () => {
  if (state.aiPrice?.model !== $('#aiModel').value.trim()) {
    state.aiPrice = null;
    $('#aiPriceStatus').textContent = 'ID du modèle modifié; vérifiez à nouveau ses tarifs avant tout envoi.';
  }
  updateAiControls();
});
for (const selector of ['#aiApiKey', '#aiEndpoint', '#aiLayers', '#aiConsent', '#aiPrompt']) $(selector).addEventListener('input', updateAiControls);
$('#aiLayers').addEventListener('change', updateAiControls);
$('#checkAiPrice').addEventListener('click', async () => {
  const button = $('#checkAiPrice'), model = $('#aiModel').value.trim();
  button.disabled = true; $('#aiPriceStatus').textContent = 'Consultation du catalogue et des tarifs publics du modèle; aucune donnée de couche ni clé n’est jointe.';
  try {
    const url = openRouterModelEndpoint(model);
    const response = await fetch(url, { mode: 'cors', credentials: 'omit', redirect: 'error', cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Catalogue OpenRouter · HTTP ${response.status}.`);
    const json = JSON.parse(await readResponseTextLimited(response, 2 * 1024 * 1024, 'AI_PRICE_TOO_LARGE'));
    const endpoints = json?.data?.endpoints;
    const rates = Array.isArray(endpoints) ? endpoints.map(endpoint => ({ input: Number(endpoint.pricing?.prompt), output: Number(endpoint.pricing?.completion) })).filter(rate => Number.isFinite(rate.input) && Number.isFinite(rate.output) && rate.input >= 0 && rate.output >= 0) : [];
    if (!rates.length) throw new Error('Aucun tarif exploitable trouvé pour cet ID modèle.');
    state.aiPrice = { model, inputMin: Math.min(...rates.map(rate => rate.input)), inputMax: Math.max(...rates.map(rate => rate.input)), outputMin: Math.min(...rates.map(rate => rate.output)), outputMax: Math.max(...rates.map(rate => rate.output)), endpointCount: rates.length, checkedAt: new Date().toISOString() };
    const price = state.aiPrice;
    $('#aiPriceStatus').textContent = `${price.endpointCount} endpoint(s) listé(s) · entrée ${formatUsd(price.inputMin * 1_000_000)}–${formatUsd(price.inputMax * 1_000_000)} / million de tokens · sortie ${formatUsd(price.outputMin * 1_000_000)}–${formatUsd(price.outputMax * 1_000_000)} / million. Vérifié ${new Date(price.checkedAt).toLocaleString('fr-FR')}. Le routage ZDR/data_collection peut restreindre ces endpoints; estimation indicative, pas un devis.`;
  } catch (error) {
    state.aiPrice = null;
    $('#aiPriceStatus').textContent = error.code === 'AI_PRICE_TOO_LARGE' ? 'Réponse tarifaire trop volumineuse.' : error.message || 'Catalogue indisponible (CORS ou réseau).';
  } finally { button.disabled = false; updateAiControls(); }
});
function validateAiEndpoint(raw) {
  let url; try { url = new URL(raw); } catch { throw new Error('Endpoint IA personnalisé invalide.'); }
  if (url.username || url.password) throw new Error('N’intégrez pas de clé ou de mot de passe dans l’URL.');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(host);
  if (!localHttp && (url.protocol !== 'https:' || unsafeServiceHost(url.hostname))) throw new Error('Utilisez un endpoint HTTPS public (ou un serveur local explicite sur localhost).');
  if (!url.pathname.endsWith('/chat/completions')) throw new Error('L’URL personnalisée doit viser un endpoint /chat/completions compatible.');
  return url;
}
function estimateAiCost(promptChars, model) {
  const price = state.aiPrice;
  if (!price || price.model !== model) return 'Tarif non estimé pour ce fournisseur; vérifiez le prix et le quota avant envoi.';
  const approximateInputTokens = Math.ceil(promptChars / 3) + 600, maxOutput = 800;
  const low = approximateInputTokens * price.inputMin + maxOutput * price.outputMin;
  const high = approximateInputTokens * price.inputMax + maxOutput * price.outputMax;
  return `Estimation grossière pour ~${approximateInputTokens} jetons d’entrée + plafond ${maxOutput} jetons de sortie : ${formatUsd(low)}–${formatUsd(high)} USD. Approximation sans tokenizer, cache, taxes ni éventuels frais; le coût réel peut différer.`;
}
$('#runAi').addEventListener('click', async () => {
  const provider = $('#aiProvider').value, model = $('#aiModel').value.trim(), prompt = $('#aiPrompt').value.trim();
  const layers = selectedAiLayers(), key = $('#aiApiKey').value.trim();
  if (!provider || !model || !key || !prompt || !$('#aiConsent').checked || !layers.length) { updateAiControls(); return; }
  if (layers.length > 4) { $('#aiOutput').textContent = 'Sélectionnez au plus 4 couches par demande.'; return; }
  if (provider === 'openrouter' && state.aiPrice?.model !== model) { $('#aiOutput').textContent = 'Vérifiez d’abord le tarif live de ce modèle.'; return; }
  let endpoint;
  try { endpoint = provider === 'openrouter' ? new URL('https://openrouter.ai/api/v1/chat/completions') : validateAiEndpoint($('#aiEndpoint').value.trim()); }
  catch (error) { $('#aiOutput').textContent = error.message; return; }
  const data = {
    task: prompt.slice(0, 1500),
    layers: layers.map(layer => ({
      name: layer.name, fileName: layer.fileName, source: layer.source, importedAt: layer.importedAt,
      sourceCrs: layer.sourceCrs, outputCrs: 'EPSG:4326', totalFeatures: layer.geojson.features.length,
      transmittedFeatures: Math.min(20, layer.geojson.features.length), truncated: layer.geojson.features.length > 20,
      features: layer.geojson.features.slice(0, 20)
    }))
  };
  const userContent = JSON.stringify(data);
  if (userContent.length > 80_000) { $('#aiOutput').textContent = 'Données sélectionnées trop volumineuses (80 Ko). Choisissez moins de couches ou simplifiez les attributs.'; return; }
  const transport = endpoint.protocol === 'https:' ? 'HTTPS' : 'HTTP sur localhost uniquement';
  const disclosure = `Service ${provider === 'openrouter' ? 'OpenRouter + fournisseur d’inférence routé' : endpoint.host} · modèle ${model}\n${layers.map(layer => `${layer.name}: ${Math.min(20, layer.geojson.features.length)}/${layer.geojson.features.length} entité(s), attributs et coordonnées; source ${layer.source}; import ${layer.importedAt}`).join('\n')}\nVotre consigne (${prompt.length} caractères), modèle et clé sont transmis par ${transport}.\n${estimateAiCost(userContent.length + 2000, model)}\nAucun fichier supplémentaire ni autre couche n’est inclus. Continuer ?`;
  if (!window.confirm(disclosure)) return;
  state.pendingAiGeoJSON = null; $('#aiValidateResult').checked = false; updateAiControls();
  $('#aiOutput').textContent = `Envoi explicite en cours à ${endpoint.host}…\n${disclosure}`;
  const systemPrompt = `Tu aides à une analyse urbaine SIG avec les seules données fournies. N’invente jamais de parcelles, limites cadastrales ou juridiques, zonages, faits ou sources. N’infère pas de vérité officielle. Tu peux proposer une synthèse ou un overlay indicatif uniquement à partir des entités fournies. Si tu produis des entités dérivées, indique leur caractère indicatif et cite les couches, identifiants et dates sources dans les propriétés. Le géoréférencement doit rester en WGS 84 / EPSG:4326 longitude-latitude. Réponds uniquement par un objet JSON: {"summary":"...","sources":[...],"limitations":"...","geojson":<FeatureCollection ou null>}. L’étudiant doit vérifier chaque sortie.`;
  const requestBody = { model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }], max_tokens: 800, temperature: 0.2 };
  if (provider === 'openrouter') requestBody.provider = { zdr: true, data_collection: 'deny', sort: 'price', allow_fallbacks: false };
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' };
  $('#aiApiKey').value = ''; $('#aiConsent').checked = false; updateAiControls();
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetch(endpoint.href, { method: 'POST', mode: 'cors', credentials: 'omit', redirect: 'error', cache: 'no-store', headers, body: JSON.stringify(requestBody), signal: controller.signal });
    if (!response.ok) throw new Error(`Fournisseur IA · HTTP ${response.status}. Vérifiez clé, modèle, CORS, quota et solde.`);
    const responseJson = JSON.parse(await readResponseTextLimited(response, 512 * 1024, 'AI_RESPONSE_TOO_LARGE'));
    const content = responseJson?.choices?.[0]?.message?.content;
    const reply = typeof content === 'string' ? content : Array.isArray(content) ? content.map(part => part.text || '').join('') : '';
    if (!reply) throw new Error('Réponse IA vide ou format non reconnu.');
    $('#aiOutput').textContent = `Fournisseur : ${provider === 'openrouter' ? 'OpenRouter' : endpoint.host} · Modèle : ${model}\n${reply.slice(0, 18_000)}`;
    let parsed;
    try {
      const start = reply.indexOf('{'), end = reply.lastIndexOf('}');
      if (start >= 0 && end > start) parsed = JSON.parse(reply.slice(start, end + 1));
    } catch { parsed = null; }
    if (parsed?.geojson) {
      const geojson = parseGeoJSONText(JSON.stringify(parsed.geojson), { fileName: 'synthese-assistee.geojson' });
      if (!geojson.features.length) throw new Error('La sortie GeoJSON est vide.');
      const flagText = JSON.stringify({ name: geojson.name, features: geojson.features.map(feature => feature.properties) });
      if (/cadast(?:re|ral)|parcelle|parcel|juridique|legal|jurisdiction|zoning|regulatory\s+zone/i.test(flagText)) throw new Error('La sortie mentionne des limites cadastrales/juridiques ou du zonage; elle est bloquée. Utilisez seulement des limites réellement sourcées par les données OSM.');
      geojson.urbatrameAi = {
        provider: provider === 'openrouter' ? 'OpenRouter' : endpoint.host, model, generatedAt: new Date().toISOString(),
        studentValidated: false, coordinateCheck: 'WGS 84 / EPSG:4326 — plages vérifiées; géoréférencement à confirmer par l’étudiant',
        summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 2000) : '',
        limitations: typeof parsed.limitations === 'string' ? parsed.limitations.slice(0, 2000) : '',
        reportedSources: Array.isArray(parsed.sources) ? parsed.sources.slice(0, 30).map(source => typeof source === 'string' ? source.slice(0, 300) : JSON.stringify(source).slice(0, 300)) : [],
        inputSources: layers.map(layer => ({ name: layer.name, source: layer.source, importedAt: layer.importedAt, sourceCrs: layer.sourceCrs }))
      };
      state.pendingAiGeoJSON = geojson; $('#aiValidateResult').checked = false;
      $('#aiOutput').textContent += `\n\nGeoJSON valide par contrôle de structure et plages WGS 84 · ${geojson.features.length} entité(s). Sources et date à vérifier avant validation.`;
      updateAiControls();
    } else {
      state.pendingAiGeoJSON = null; updateAiControls();
    }
    status('Réponse IA reçue. Aucune géométrie n’a été ajoutée; vérifiez manuellement les sources, la date et le géoréférencement.', 'success');
  } catch (error) {
    state.pendingAiGeoJSON = null; $('#aiOutput').textContent = error.name === 'AbortError' ? 'Délai de 90 secondes dépassé; aucun nouvel essai automatique.' : error.code === 'AI_RESPONSE_TOO_LARGE' ? 'Réponse IA supérieure à 512 Ko.' : error.message || 'Appel IA impossible (CORS, réseau, modèle ou politique ZDR).';
    status($('#aiOutput').textContent, 'error'); updateAiControls();
  } finally { clearTimeout(timeout); }
});
$('#aiValidateResult').addEventListener('change', updateAiControls);
$('#acceptAiResult').addEventListener('click', () => {
  const geojson = state.pendingAiGeoJSON;
  if (!geojson || !$('#aiValidateResult').checked) return;
  geojson.urbatrameAi.studentValidated = true; geojson.urbatrameAi.studentValidatedAt = new Date().toISOString();
  state.pendingAiGeoJSON = null; $('#aiValidateResult').checked = false;
  const sourceText = geojson.urbatrameAi.inputSources.map(source => `${source.name} (${source.source}; ${source.importedAt})`).join(' · ');
  addLayer(geojson, 'synthese-assistee.geojson', `Proposition IA · ${geojson.urbatrameAi.provider}/${geojson.urbatrameAi.model} · sources à vérifier : ${sourceText}`);
  updateAiControls();
});
$('#serviceType').addEventListener('change', () => {
  const type = $('#serviceType').value;
  $('#wmsLayersField').hidden = !['wms', 'wmts'].includes(type);
  $('#wmtsFields').hidden = type !== 'wmts';
});
$('#externalServiceType').addEventListener('change', () => { $('#wfsTypeNameField').hidden = $('#externalServiceType').value !== 'wfs'; });
function validateAttribution(value) {
  const attribution = String(value || '').trim();
  if (!attribution) throw new Error('Indiquez l’attribution et la licence du service.');
  if (/openstreetmap|\bOSM\b/i.test(attribution) && !/OpenStreetMap contributors/i.test(attribution))
    throw new Error('Pour OSM, indiquez « © OpenStreetMap contributors » et la licence applicable.');
  if (/openbuildingmap|\bOBM\b/i.test(attribution) && (!/OpenBuildingMap/i.test(attribution) || !/GFZ/i.test(attribution) || !/OpenStreetMap/i.test(attribution) || !/ODbL/i.test(attribution)))
    throw new Error('Pour OBM, incluez les attributions OpenBuildingMap, GFZ et OpenStreetMap, ainsi que l’ODbL si la couche est modifiée.');
  return attribution;
}
$('#activateService').addEventListener('click', () => {
  try {
    const type = $('#serviceType').value;
    const rawUrl = $('#serviceUrl').value.trim();
    const attribution = validateAttribution($('#serviceAttribution').value);
    const parsed = validateHttpsUrl(rawUrl, { template: type === 'xyz' });
    if (type === 'xyz') {
      if (!/\{z\}/i.test(rawUrl) || !/\{x\}/i.test(rawUrl) || !/\{y\}/i.test(rawUrl)) throw new Error('Le modèle XYZ doit contenir {z}, {x} et {y}.');
      state.basemap = { type, url: rawUrl, attribution };
    } else if (type === 'wmts') {
      const layer = $('#serviceLayers').value.trim(), matrixSet = $('#wmtsMatrixSet').value.trim(), style = $('#wmtsStyle').value.trim(), format = $('#wmtsFormat').value;
      if (!layer || !matrixSet || !style) throw new Error('Indiquez la couche, la matrice et le style WMTS.');
      const service = { type, url: parsed.href, layer, matrixSet, style, format, attribution };
      buildWmtsTileUrl(service, 0, 0, 0);
      state.basemap = service;
    } else {
      const layers = $('#serviceLayers').value.trim();
      if (!layers) throw new Error('Indiquez au moins un nom de couche WMS.');
      state.basemap = { type, url: parsed.href, layers, attribution };
    }
    $('#removeService').disabled = false;
    $('#serviceStatus').textContent = `${type.toUpperCase()} actif. L’emprise affichée est demandée au service; les couches locales ne quittent pas le navigateur.`;
    renderMap();
  } catch (error) { $('#serviceStatus').textContent = error.code === 'WMTS_PARAMETERS_INVALID' ? 'Paramètres WMTS invalides : vérifiez HTTPS, couche, matrice, style et tuiles.' : error.code === 'WMTS_MATRIXSET_UNSUPPORTED' ? 'Cette version WMTS accepte seulement GoogleMapsCompatible ou WebMercatorQuad.' : error.message; }
});
$('#removeService').addEventListener('click', () => {
  state.basemap = null; $('#removeService').disabled = true;
  $('#serviceStatus').textContent = 'Fond externe retiré; aucune nouvelle requête ne sera émise.';
  renderMap();
});
$('#importRemoteGeoJSON').addEventListener('click', async () => {
  const button = $('#importRemoteGeoJSON'); button.disabled = true;
  try {
    const type = $('#externalServiceType').value;
    const baseUrl = validateHttpsUrl($('#externalGeoJSONUrl').value.trim());
    const typeName = $('#wfsTypeName').value.trim();
    const firstRequest = buildVectorRequestUrl(type, baseUrl.href, typeName);
    validateHttpsUrl(firstRequest.href);
    const attribution = validateAttribution($('#externalGeoJSONAttribution').value);
    const serviceLabel = ({ geojson: 'GeoJSON', wfs: 'WFS 2.0', arcgis: 'ArcGIS FeatureServer', 'arcgis-map': 'ArcGIS MapServer' })[type] || type;
    const responseBound = type === 'geojson' ? 'une réponse GeoJSON limitée à 15 Mo' : `une pagination bornée à ${MAX_REMOTE_FEATURES.toLocaleString('fr-FR')} entités et ${MAX_REMOTE_PAGES} pages maximum`;
    status(`Requête ${serviceLabel} distante lancée après votre action; ${responseBound}. Le fournisseur ne reçoit pas vos couches locales.`);
    const result = await fetchPaginatedVectorService({ type, rawUrl: baseUrl.href, typeName });
    const added = addLayer(result.geojson, result.geojson.name, attribution);
    const paging = result.pages > 1 ? ` · ${result.pages} pages, ${result.features.toLocaleString('fr-FR')} entité(s)` : ` · ${result.features.toLocaleString('fr-FR')} entité(s)`;
    const truncation = result.truncated ? result.truncationReason === 'PAGE_LIMIT'
      ? ` · limite de ${MAX_REMOTE_PAGES} pages; la suite éventuelle n’a pas été demandée`
      : ` · limite de ${MAX_REMOTE_FEATURES.toLocaleString('fr-FR')} entités; la suite éventuelle n’a pas été demandée` : '';
    $('#serviceStatus').textContent = added ? `Réponse GeoJSON reçue de ${baseUrl.host}${paging}${truncation}; attribution : ${attribution}.` : 'Réponse reçue mais couche non ajoutée : limite locale atteinte.';
  } catch (error) {
    status(error.code ? errorMessage(error) : error.message || 'Chargement du service impossible (vérifiez HTTPS et CORS).', 'error');
    $('#serviceStatus').textContent = error.code === 'REMOTE_TOTAL_TOO_LARGE' ? 'Réponse agrégée supérieure à 30 Mo; import arrêté.'
      : error.code === 'REMOTE_PAGE_FEATURE_LIMIT' ? 'Le service a dépassé 1 000 entités sur une page; import arrêté.'
        : error.code === 'REMOTE_PAGINATION_REPEATED' ? 'Le service répète une page malgré l’offset; import arrêté.'
          : error.code === 'REMOTE_PAGINATION_STALLED' ? 'Le service annonce encore des données mais renvoie une page vide.'
            : error.code === 'SERVICE_TIMEOUT' ? 'Délai de réponse dépassé (30 s).'
              : 'Chargement impossible. Vérifiez HTTPS, CORS, la pagination, le format GeoJSON et les conditions du service.';
  } finally { button.disabled = false; }
});

function renderAiLayerOptions() {
  const select = $('#aiLayers');
  const previous = new Set([...select.selectedOptions].map(option => option.value));
  select.replaceChildren();
  for (const layer of state.layers.filter(item => item.kind !== 'raster')) {
    const option = document.createElement('option');
    option.value = layer.id; option.textContent = `${layer.name} · ${layer.geojson.features.length} entité(s) · ${layer.sourceCrs}`;
    option.selected = previous.has(layer.id); select.append(option);
  }
  updateAiControls();
}
function updateAiControls() {
  const provider = $('#aiProvider').value, model = $('#aiModel').value.trim();
  const selectedCount = $('#aiLayers').selectedOptions.length;
  const priceReady = provider !== 'openrouter' || state.aiPrice?.model === model;
  $('#aiEndpointField').hidden = provider !== 'custom';
  $('#openRouterPricing').hidden = provider !== 'openrouter';
  $('#checkAiPrice').disabled = provider !== 'openrouter' || !model;
  $('#runAi').disabled = !provider || !model || !$('#aiApiKey').value || !$('#aiConsent').checked || !$('#aiPrompt').value.trim() || !selectedCount || !priceReady || provider === 'custom' && !$('#aiEndpoint').value.trim();
  $('#acceptAiResult').disabled = !state.pendingAiGeoJSON || !$('#aiValidateResult').checked;
  $('#acceptAiResult').hidden = !state.pendingAiGeoJSON;
  $('#aiValidationRow').hidden = !state.pendingAiGeoJSON;
}
function localIsoDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function surveyStatus(message, kind = '') {
  const statusNode = $('#surveyGpsStatus');
  if (!statusNode) return;
  statusNode.textContent = message;
  statusNode.dataset.state = kind;
}

function fieldTemplateFromEditor() {
  const fields = [...document.querySelectorAll('.survey-field-row')].map(row => {
    const key = row.querySelector('.survey-field-key')?.value.trim() || '';
    const label = row.querySelector('.survey-field-label')?.value.trim() || '';
    const type = row.querySelector('.survey-field-type')?.value || 'text';
    const required = !!row.querySelector('.survey-field-required')?.checked;
    const rawOptions = row.querySelector('.survey-field-options')?.value || '';
    return { key, label, type, required, options: type === 'select' ? rawOptions.split('|').map(value => value.trim()).filter(Boolean) : [] };
  });
  return normalizeFieldTemplate({
    name: $('#surveyTemplateName').value,
    geometryTypes: ['Point', 'LineString', 'Polygon'],
    fields
  });
}

function renderSurveyForm() {
  const host = $('#surveyFormFields');
  if (!host) return;
  const preserved = new Map([...host.querySelectorAll('input,select,textarea')].map(input => [input.id, input.type === 'checkbox' ? input.checked : input.value]));
  host.replaceChildren();
  for (const field of state.surveyTemplate.fields) {
    const label = document.createElement('label');
    label.htmlFor = `survey-value-${field.key}`;
    label.append(document.createTextNode(`${field.label}${field.required ? ' · obligatoire' : ''}`));
    let input;
    if (field.type === 'select') {
      input = document.createElement('select');
      const blank = document.createElement('option'); blank.value = ''; blank.textContent = field.required ? 'Choisir…' : '—'; input.append(blank);
      for (const value of field.options) { const option = document.createElement('option'); option.value = value; option.textContent = value; input.append(option); }
    } else if (field.type === 'text' && field.label.length > 40) {
      input = document.createElement('textarea'); input.maxLength = 2000;
    } else {
      input = document.createElement('input');
      input.type = field.type === 'boolean' ? 'checkbox' : field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text';
      if (field.type === 'number') input.step = 'any';
      if (field.type === 'date') input.value = localIsoDate();
      if (field.type === 'text') input.maxLength = 2000;
    }
    input.id = `survey-value-${field.key}`;
    if (field.required) input.required = true;
    if (preserved.has(input.id)) {
      const oldValue = preserved.get(input.id);
      if (input.type === 'checkbox') input.checked = oldValue === true;
      else input.value = String(oldValue ?? '');
    }
    label.append(input); host.append(label);
  }
  if (!state.surveyTemplate.fields.length) {
    const note = document.createElement('p'); note.className = 'source-footnote';
    note.textContent = 'Aucun attribut personnalisé; les métadonnées de capture UrbaTrame sont conservées.';
    host.append(note);
  }
}

function renderSurveyFieldDefinitions() {
  const host = $('#surveyFieldDefinitions');
  if (!host) return;
  host.replaceChildren();
  state.surveyTemplate.fields.forEach((field, index) => {
    const row = document.createElement('div'); row.className = 'survey-field-row';
    const key = document.createElement('input'); key.className = 'survey-field-key'; key.type = 'text'; key.maxLength = 40; key.value = field.key; key.placeholder = 'cle_champ'; key.setAttribute('aria-label', 'Clé du champ');
    const label = document.createElement('input'); label.className = 'survey-field-label'; label.type = 'text'; label.maxLength = 80; label.value = field.label; label.placeholder = 'Libellé'; label.setAttribute('aria-label', 'Libellé du champ');
    const type = document.createElement('select'); type.className = 'survey-field-type'; type.setAttribute('aria-label', 'Type du champ');
    for (const [value, title] of [['text', 'Texte'], ['number', 'Nombre'], ['date', 'Date'], ['boolean', 'Oui / non'], ['select', 'Liste']]) {
      const option = document.createElement('option'); option.value = value; option.textContent = title; type.append(option);
    }
    type.value = field.type;
    const requiredLabel = document.createElement('label'); requiredLabel.className = 'survey-required';
    const required = document.createElement('input'); required.type = 'checkbox'; required.className = 'survey-field-required'; required.checked = field.required;
    requiredLabel.append(required, document.createTextNode('Obligatoire'));
    const options = document.createElement('input'); options.className = 'survey-field-options'; options.type = 'text'; options.maxLength = 2000;
    options.value = field.options.join(' | '); options.placeholder = 'Choix séparés par |'; options.hidden = field.type !== 'select'; options.setAttribute('aria-label', 'Choix séparés par une barre verticale');
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'button-secondary survey-remove-field'; remove.textContent = 'Supprimer';
    remove.addEventListener('click', () => {
      const updated = state.surveyTemplate.fields.filter((_, fieldIndex) => fieldIndex !== index);
      state.surveyTemplate = normalizeFieldTemplate({ ...state.surveyTemplate, fields: updated });
      renderSurveyFieldDefinitions(); renderSurveyForm();
    });
    const sync = () => {
      options.hidden = type.value !== 'select';
      try {
        state.surveyTemplate = fieldTemplateFromEditor();
        renderSurveyForm();
      } catch { /* Le gabarit reste en édition; la validation est affichée à l'enregistrement. */ }
    };
    for (const input of [key, label, type, required, options]) input.addEventListener('change', sync);
    for (const input of [key, label, options]) input.addEventListener('input', sync);
    row.append(key, label, type, requiredLabel, options, remove); host.append(row);
  });
}

function updateSurveyTemplateSelect() {
  const select = $('#surveyTemplateLibrary');
  if (!select) return;
  select.replaceChildren();
  const empty = document.createElement('option'); empty.value = ''; empty.textContent = savedSurveyTemplates.length ? 'Choisir un gabarit enregistré' : 'Aucun gabarit enregistré'; select.append(empty);
  savedSurveyTemplates.forEach((template, index) => {
    const option = document.createElement('option'); option.value = String(index); option.textContent = template.name; select.append(option);
  });
}

function setSurveyTemplate(value) {
  $('#surveyFormFields').replaceChildren();
  state.surveyTemplate = normalizeFieldTemplate(value);
  $('#surveyTemplateName').value = state.surveyTemplate.name;
  renderSurveyFieldDefinitions(); renderSurveyForm();
}

function storeSurveyTemplate() {
  let template;
  try { template = fieldTemplateFromEditor(); }
  catch (error) { surveyStatus(`Gabarit invalide (${error.code || 'champs à vérifier'}). Vérifiez les clés, libellés et choix.`, 'error'); return null; }
  state.surveyTemplate = template;
  const existing = savedSurveyTemplates.findIndex(item => item.name.toLocaleLowerCase('fr-FR') === template.name.toLocaleLowerCase('fr-FR'));
  if (existing >= 0) savedSurveyTemplates[existing] = template;
  else if (savedSurveyTemplates.length < MAX_SAVED_SURVEY_TEMPLATES) savedSurveyTemplates.push(template);
  else { surveyStatus(`Limite de ${MAX_SAVED_SURVEY_TEMPLATES} gabarits sur cet appareil. Supprimez-en un avant d’en enregistrer un autre.`, 'error'); return null; }
  try { localStorage.setItem(FIELD_TEMPLATES_KEY, JSON.stringify(savedSurveyTemplates)); lastSurveyTemplateStorageSucceeded = true; }
  catch { lastSurveyTemplateStorageSucceeded = false; surveyStatus('Gabarit utilisé pour cet onglet, mais stockage local indisponible. Exportez-le en fichier pour le conserver.', 'error'); }
  updateSurveyTemplateSelect();
  return template;
}

function downloadSurveyTemplate() {
  const template = storeSurveyTemplate();
  if (!template) return;
  const file = serializeFieldTemplate(template);
  downloadBlob(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json;charset=utf-8' }), `${template.name.toLocaleLowerCase('fr-FR').replace(/[^a-z0-9]+/g, '-') || 'gabarit'}.uttemplate.json`);
  surveyStatus(`Gabarit « ${template.name} » exporté. Les valeurs des relevés ne sont pas incluses dans ce fichier.`, 'success');
}

function applySurveyViewInputs() {
  const lat = Number($('#surveyCenterLat').value), lon = Number($('#surveyCenterLon').value), spanMeters = Number($('#surveyViewSpan').value);
  if (!Number.isFinite(lat) || Math.abs(lat) > 85 || !Number.isFinite(lon) || Math.abs(lon) > 180 || !Number.isFinite(spanMeters) || spanMeters < 100 || spanMeters > 3_000) {
    surveyStatus('Centre invalide : latitude −85…85, longitude −180…180 et largeur 100…3 000 m (plafond actuel conservé).', 'error'); return false;
  }
  state.surveyView = { lat, lon, spanMeters };
  state.surveyViewEnabled = true;
  renderMap();
  surveyStatus(`Vue centrée sur ${lat.toFixed(6)}, ${lon.toFixed(6)} · largeur ${Math.round(spanMeters).toLocaleString('fr-FR')} m.`, 'success');
  return true;
}

function zoomSurveyView(factor) {
  const span = Math.max(100, Math.min(3_000, state.surveyView.spanMeters * factor));
  $('#surveyViewSpan').value = String(Math.round(span));
  state.surveyView.spanMeters = span;
  state.surveyViewEnabled = true;
  renderMap();
}

function geolocationPosition() {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.reject(Object.assign(new Error('GEOLOCATION_UNAVAILABLE'), { code: 'GEOLOCATION_UNAVAILABLE' }));
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, error => {
    const code = error?.code === 1 ? 'GEOLOCATION_DENIED' : error?.code === 3 ? 'GEOLOCATION_TIMEOUT' : 'GEOLOCATION_FAILED';
    reject(Object.assign(new Error(code), { code }));
  }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 }));
}

function geolocationErrorText(error) {
  if (error?.code === 'GEOLOCATION_UNAVAILABLE') return 'Ce navigateur ne donne pas accès à une position GNSS. Utilisez une page HTTPS et un appareil compatible.';
  if (error?.code === 'GEOLOCATION_DENIED') return 'Autorisation de localisation refusée. Autorisez-la dans le navigateur si vous souhaitez utiliser le GNSS.';
  if (error?.code === 'GEOLOCATION_TIMEOUT') return 'Le récepteur n’a pas fourni de position avant le délai. Réessayez dehors ou vérifiez le service de localisation.';
  return 'Position indisponible. Vérifiez le GPS, l’autorisation du navigateur et réessayez.';
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function readGpsPosition() {
  const button = $('#readGps'); button.disabled = true; button.textContent = 'Lecture en cours…';
  try {
    const position = await geolocationPosition();
    const coords = position.coords;
    const lat = Number(coords.latitude), lon = Number(coords.longitude), accuracy = Number(coords.accuracy);
    if (!Number.isFinite(lat) || Math.abs(lat) > 85 || !Number.isFinite(lon) || Math.abs(lon) > 180 || !Number.isFinite(accuracy) || accuracy < 0) throw new Error('GEOLOCATION_FAILED');
    const timestamp = Number(position.timestamp) > 0 ? Number(position.timestamp) : Date.now();
    state.gpsFix = {
      lat, lon, accuracyM: accuracy,
      altitudeM: optionalNumber(coords.altitude),
      altitudeAccuracyM: optionalNumber(coords.altitudeAccuracy),
      headingDeg: optionalNumber(coords.heading),
      speedMs: optionalNumber(coords.speed),
      timestamp
    };
    state.surveyView = { ...state.surveyView, lat, lon };
    state.surveyViewEnabled = true;
    $('#surveyCenterLat').value = lat.toFixed(7); $('#surveyCenterLon').value = lon.toFixed(7);
    renderMap(); updateSurveyLayerControls();
    const altitude = state.gpsFix.altitudeM === null ? 'altitude non fournie' : `h navigateur ${state.gpsFix.altitudeM.toFixed(2)} m`;
    surveyStatus(`Position lue : ${lat.toFixed(7)}, ${lon.toFixed(7)} · précision annoncée ±${accuracy.toFixed(1)} m · ${altitude}. La précision dépend de l’appareil et n’est pas certifiée.`, 'success');
    return state.gpsFix;
  } catch (error) {
    state.gpsFix = null; updateSurveyLayerControls();
    surveyStatus(geolocationErrorText(error), 'error');
    return null;
  } finally { button.disabled = false; button.textContent = 'Lire ma position GNSS'; }
}

function captureGpsPoint() {
  const fix = state.gpsFix;
  if (!fix) { surveyStatus('Lisez d’abord une position GNSS, puis vérifiez sa précision.', 'error'); return; }
  const layer = selectedLayer();
  if (!layer || layer.kind === 'raster') { surveyStatus('Créez une couche terrain ou sélectionnez une couche vectorielle avant la capture.', 'error'); return; }
  const form = surveyPropertiesFromForm();
  if (!form.ok) { surveyStatus(`Champ requis ou valeur invalide : ${form.label || form.field}.`, 'error'); $(`#survey-value-${form.field}`)?.focus(); return; }
  if (!layer.visible) layer.visible = true;
  state.surveyView = { ...state.surveyView, lat: fix.lat, lon: fix.lon };
  state.surveyViewEnabled = true;
  $('#surveyCenterLat').value = fix.lat.toFixed(7); $('#surveyCenterLon').value = fix.lon.toFixed(7);
  const capturedAt = new Date(fix.timestamp).toISOString();
  const captureProperties = {
    gps_accuracy_m: fix.accuracyM,
    gps_altitude_ellipsoidal_m: fix.altitudeM,
    gps_altitude_accuracy_m: fix.altitudeAccuracyM,
    gps_heading_deg: fix.headingDeg,
    gps_speed_m_s: fix.speedMs
  };
  const captureMetadata = { method: 'API de géolocalisation du navigateur · WGS 84', capturedAt, horizontalAccuracyM: fix.accuracyM };
  if (state.geoidGrid && $('#confirmGeoidUse').checked && fix.altitudeM !== null) {
    const undulation = interpolateGeoidUndulation(state.geoidGrid, fix.lon, fix.lat);
    if (undulation !== null) {
      captureProperties.geoid_undulation_m = undulation;
      captureProperties.height_orthometric_m = orthometricHeight(fix.altitudeM, undulation);
      captureProperties.height_model = state.geoidGrid.fileName;
      captureProperties.height_operation = 'H = h − N';
      captureMetadata.geoidModel = state.geoidGrid.fileName;
      captureMetadata.geoidUndulationM = undulation;
    } else surveyStatus('Le point est hors couverture du modèle GTX : seule la hauteur ellipsoïdale du navigateur sera conservée.', 'error');
  }
  const added = addEditedFeature(layer, { type: 'Point', coordinates: [fix.lon, fix.lat] }, {
    surveyProperties: form.properties, captureProperties, captureMetadata
  });
  if (added) surveyStatus(`Point GPS capturé dans « ${layer.name} » · ${capturedAt} · précision annoncée ±${fix.accuracyM.toFixed(1)} m.`, 'success');
  else surveyStatus('Point non ajouté. Consultez le message de l’Atelier (limite de couche, d’entités ou d’historique).', 'error');
}

async function loadGeoidFile(file) {
  if (!file) return;
  if (file.size > MAX_GTX_BYTES) { $('#geoidStatus').textContent = `Modèle GTX trop volumineux; maximum ${(MAX_GTX_BYTES / (1024 * 1024)).toLocaleString('fr-FR')} Mo.`; $('#geoidFile').value = ''; return; }
  $('#geoidStatus').textContent = 'Lecture locale du modèle GTX…';
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    state.geoidGrid = parseGtxGrid(bytes, { fileName: file.name });
    $('#removeGeoid').disabled = false;
    $('#confirmGeoidUse').checked = false;
    $('#geoidStatus').textContent = `${state.geoidGrid.fileName} · ${state.geoidGrid.rows.toLocaleString('fr-FR')} × ${state.geoidGrid.columns.toLocaleString('fr-FR')} cellules · longitudes ${state.geoidGrid.west.toFixed(4)}…${state.geoidGrid.east.toFixed(4)}°, latitudes ${state.geoidGrid.south.toFixed(4)}…${state.geoidGrid.north.toFixed(4)}°. Chargé uniquement dans cet onglet.`;
    $('#geoidConfirmRow').hidden = false;
    if (state.gpsFix) {
      const value = interpolateGeoidUndulation(state.geoidGrid, state.gpsFix.lon, state.gpsFix.lat);
      $('#geoidStatus').textContent += value === null ? ' · position GNSS hors couverture.' : ` · N local ≈ ${value.toFixed(3)} m (aperçu).`;
    }
  } catch (error) {
    state.geoidGrid = null; $('#removeGeoid').disabled = true; $('#geoidConfirmRow').hidden = true;
    $('#geoidStatus').textContent = error?.code === 'GTX_TOO_LARGE' ? 'Modèle GTX trop volumineux.' : 'GTX illisible ou format non pris en charge; aucun modèle n’a été chargé.';
  } finally { $('#geoidFile').value = ''; }
}

function updateSurveyLayerControls() {
  const layer = selectedLayer();
  $('#captureGpsPoint').disabled = !state.gpsFix || !layer || layer.kind === 'raster';
  $('#createSurveyLayer').disabled = state.layers.length >= MAX_LAYERS;
}

function updateActions() {
  const hasVisible = state.layers.some(layer => layer.visible);
  const hasVisibleVector = state.layers.some(layer => layer.visible && layer.kind !== 'raster');
  $('#exportGeoJSON').disabled = !hasVisibleVector;
  $('#exportCsv').disabled = !hasVisibleVector;
  $('#exportKml').disabled = !hasVisibleVector;
  $('#exportKmz').disabled = !hasVisibleVector;
  $('#exportGpkg').disabled = !hasVisibleVector;
  $('#exportMapSvg').disabled = !hasVisible;
  $('#exportMapPng').disabled = !hasVisible;
  $('#exportProjectJson').disabled = !state.layers.length;
  $('#printMap').disabled = !hasVisible;
  $('#clearLayers').disabled = !state.layers.length;
  updateSurveyLayerControls();
}

function renderAll() {
  renderLayerList();
  renderMap();
  renderAttributes();
  renderAiLayerOptions();
}

function addCsvOptions(table, fileName) {
  const detected = detectCoordinateFields(table.headers);
  for (const select of [csvLongitude, csvLatitude]) {
    select.replaceChildren();
    for (const header of table.headers) {
      const option = document.createElement('option'); option.value = header; option.textContent = header;
      select.append(option);
    }
  }
  if (detected.longitude) csvLongitude.value = detected.longitude;
  if (detected.latitude) csvLatitude.value = detected.latitude;
  $('#csvCrs').value = 'EPSG:4326';
  state.pendingCsv = table;
  state.pendingCsvFileName = fileName || 'couche.csv';
  state.pendingShapeFiles = null;
  csvMapping.hidden = false;
  shapeMapping.hidden = true;
  status(`CSV prêt · ${table.rows.length.toLocaleString('fr-FR')} ligne(s). Confirmez X/Y et le CRS.`, 'success');
}

function sameStem(name) { return String(name).replace(/\.[^.]+$/, '').toLowerCase(); }
async function handleShapefileSelection(fileList) {
  const selected = [...(fileList || [])];
  if (!selected.length) return;
  try {
    let files;
    if (selected.length === 1 && selected[0].name.toLowerCase().endsWith('.zip')) {
      if (selected[0].size > 30 * 1024 * 1024) throw new Error('Archive Shapefile supérieure à 30 Mo.');
      files = await extractShapefileZip(await selected[0].arrayBuffer());
    } else {
      files = selected.map(file => ({ name: file.name, file, size: file.size }));
    }
    const shpFiles = files.filter(file => file.name.toLowerCase().endsWith('.shp'));
    if (shpFiles.length !== 1) throw new Error('Sélectionnez exactement un fichier .shp avec ses fichiers associés.');
    const shp = shpFiles[0], stem = sameStem(shp.name);
    if (files.some(file => sameStem(file.name) !== stem)) throw new Error('Les fichiers .shp/.dbf/.prj/.cpg doivent partager le même nom de base.');
    if (files.some(file => file.size > MAX_IMPORT_BYTES) || files.reduce((sum, file) => sum + file.size, 0) > 30 * 1024 * 1024)
      throw new Error('Chaque fichier doit faire au plus 15 Mo; le lot SHP/DBF/PRJ au plus 30 Mo.');
    const prj = files.find(file => file.name.toLowerCase().endsWith('.prj')) || null;
    const dbf = files.find(file => file.name.toLowerCase().endsWith('.dbf')) || null;
    const cpg = files.find(file => file.name.toLowerCase().endsWith('.cpg')) || null;
    const prjText = prj ? (prj.buffer ? new TextDecoder().decode(prj.buffer) : await prj.file.text()) : '';
    const detected = detectShapefileCrs(prjText);
    state.pendingCsv = null; state.pendingCsvFileName = ''; csvMapping.hidden = true;
    state.pendingShapeFiles = {
      shpFileName: shp.name, shpBuffer: shp.buffer || null, shpFile: shp.file || null,
      dbfBuffer: dbf?.buffer || null, dbfFile: dbf?.file || null,
      cpgText: cpg?.buffer ? new TextDecoder().decode(cpg.buffer) : cpg?.file ? await cpg.file.text() : 'utf-8'
    };
    $('#shapeFilesSummary').textContent = `${files.map(file => file.name).join(' · ')}${detected ? ` · CRS détecté : ${detected} (à vérifier)` : ' · CRS non détecté : saisissez le code exact'}`;
    $('#shapeCrs').value = detected;
    shapeMapping.hidden = false;
    shapeFilesInput.value = '';
    status('Fichiers Shapefile prêts. Confirmez le CRS source avant l’import.', 'success');
  } catch (error) {
    state.pendingShapeFiles = null; shapeMapping.hidden = true; shapeFilesInput.value = '';
    status(error?.code ? errorMessage(error) : error.message || 'Archive Shapefile invalide.', 'error');
  }
}
shapeFilesInput.addEventListener('change', () => handleShapefileSelection(shapeFilesInput.files));
$('#addShapefile').addEventListener('click', async () => {
  const pending = state.pendingShapeFiles;
  if (!pending) return;
  const button = $('#addShapefile'); button.disabled = true;
  try {
    const shp = pending.shpBuffer || await pending.shpFile.arrayBuffer();
    const dbf = pending.dbfBuffer || (pending.dbfFile ? await pending.dbfFile.arrayBuffer() : null);
    const codePage = pending.cpgText || 'utf-8';
    const geojson = parseShapefileBundle({ shp, dbf, sourceCrs: $('#shapeCrs').value.trim(), fileName: pending.shpFileName, codePage });
    addLayer(geojson, pending.shpFileName, $('#sourceReference').value);
  } catch (error) { status(errorMessage(error), 'error'); }
  finally { button.disabled = false; }
});

async function handleFile(file) {
  if (!file) return;
  const request = ++state.importRequest;
  state.pendingCsv = null; state.pendingCsvFileName = ''; state.pendingShapeFiles = null;
  csvMapping.hidden = true; shapeMapping.hidden = true;
  if (file.size > MAX_IMPORT_BYTES) {
    status(errorMessage(Object.assign(new Error(), { code: 'FILE_TOO_LARGE' })), 'error');
    fileInput.value = '';
    return;
  }
  const extension = file.name.split('.').pop()?.toLowerCase();
  try {
    if (extension === 'gpkg') {
      status('Chargement du lecteur GeoPackage; le fichier est traité uniquement dans ce navigateur…');
      const SQL = await loadSqlRuntime();
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (request !== state.importRequest) return;
      status('Lecture des couches GeoPackage et conversion locale vers WGS 84…');
      const layers = parseGeoPackage(bytes, SQL, { fileName: file.name });
      if (request !== state.importRequest) return;
      const added = addLayers(layers.map(layer => ({ geojson: layer.geojson, fileName: layer.fileName, name: layer.name })), $('#sourceReference').value);
      if (!added) fileInput.value = '';
      return;
    }
    if (extension === 'kmz') {
      status('Lecture locale de l’archive KMZ; aucun NetworkLink ne sera suivi…');
      const archive = await file.arrayBuffer();
      if (request !== state.importRequest) return;
      const kmlFile = await extractKmlFromZip(archive);
      const kmlText = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(kmlFile.buffer));
      const geojson = parseKmlText(kmlText, { fileName: kmlFile.name });
      if (request !== state.importRequest) return;
      addLayer(geojson, file.name, `${$('#sourceReference').value || file.name} · KML interne « ${kmlFile.path} »; liens réseau non suivis`);
      fileInput.value = '';
      return;
    }
    if (extension === 'tif' || extension === 'tiff') {
      status('Chargement du lecteur GeoTIFF; le fichier est traité uniquement dans ce navigateur…');
      const GeoTIFFApi = await loadGeoTiffRuntime();
      const sourceBytes = new Uint8Array(await file.arrayBuffer());
      if (request !== state.importRequest) return;
      status('Lecture du géoréférencement et des pixels raster localement…');
      const raster = await parseGeoTiff(sourceBytes, GeoTIFFApi, { fileName: file.name });
      if (request !== state.importRequest) return;
      const added = addRasterLayer(raster, sourceBytes, $('#sourceReference').value);
      if (!added) fileInput.value = '';
      return;
    }
    const text = await file.text();
    if (request !== state.importRequest) return;
    if (extension === 'csv' || extension === 'tsv') {
      addCsvOptions(parseDelimitedText(text), file.name);
      fileInput.value = '';
    } else if (extension === 'kml') {
      const geojson = parseKmlText(text, { fileName: file.name });
      addLayer(geojson, file.name, $('#sourceReference').value);
    } else if (['geojson', 'json'].includes(extension)) {
      const geojson = parseGeoJSONText(text, { fileName: file.name });
      addLayer(geojson, file.name, $('#sourceReference').value);
    } else {
      const error = Object.assign(new Error(), { code: 'UNSUPPORTED_FILE' });
      status(errorMessage(error), 'error');
      fileInput.value = '';
    }
  } catch (error) {
    if (request !== state.importRequest) return;
    status(errorMessage(error), 'error');
    csvMapping.hidden = true; shapeMapping.hidden = true;
    state.pendingCsv = null; state.pendingCsvFileName = ''; state.pendingShapeFiles = null;
    fileInput.value = '';
  }
}

fileInput.addEventListener('change', () => handleFile(fileInput.files?.[0]));
dropZone.addEventListener('dragover', event => { event.preventDefault(); dropZone.classList.add('is-dragging'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('is-dragging'));
dropZone.addEventListener('drop', event => {
  event.preventDefault(); dropZone.classList.remove('is-dragging');
  handleFile(event.dataTransfer?.files?.[0]);
});

$('#addCsvLayer').addEventListener('click', () => {
  if (!state.pendingCsv) return;
  try {
    const fileName = state.pendingCsvFileName || 'couche.csv';
    const geojson = csvToGeoJSON(state.pendingCsv, {
      longitude: csvLongitude.value,
      latitude: csvLatitude.value,
      sourceCrs: $('#csvCrs').value,
      fileName
    });
    addLayer(geojson, fileName, $('#sourceReference').value);
  } catch (error) {
    status(errorMessage(error), 'error');
  }
});

$('#exportGeoJSON').addEventListener('click', () => {
  const collection = exportVisibleGeoJSON(state.layers.filter(layer => layer.kind !== 'raster'));
  const blob = new Blob([JSON.stringify(collection, null, 2)], { type: 'application/geo+json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = 'urbatrame-couches-locales.geojson';
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  const rasterNote = state.layers.some(layer => layer.visible && layer.kind === 'raster') ? ' · le GeoTIFF n’est pas inclus dans le GeoJSON (utilisez le projet local ou l’export de carte).' : '';
  status(`${collection.features.length.toLocaleString('fr-FR')} entité(s) exportée(s) en GeoJSON avec les références de source${rasterNote}.`, 'success');
});

$('#exportCsv').addEventListener('click', () => {
  try {
    const csv = exportVisibleCsv(state.layers);
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'urbatrame-releve.csv');
    const count = state.layers.filter(layer => layer.visible && layer.kind !== 'raster').reduce((sum, layer) => sum + layer.geojson.features.length, 0);
    status(`${count.toLocaleString('fr-FR')} entité(s) exportée(s) en CSV avec géométrie WKT, attributs, source et date.`, 'success');
  } catch { status('Export CSV impossible; vérifiez les attributs de vos couches.', 'error'); }
});
$('#exportKml').addEventListener('click', () => {
  try {
    const kml = layersToKml(state.layers);
    downloadBlob(new Blob([kml], { type: 'application/vnd.google-earth.kml+xml;charset=utf-8' }), 'urbatrame-releve.kml');
    status('KML EPSG:4326 exporté localement; les propriétés sont incluses comme données étendues.', 'success');
  } catch { status('Export KML impossible; vérifiez les géométries et attributs.', 'error'); }
});
$('#exportKmz').addEventListener('click', () => {
  try {
    const kml = layersToKml(state.layers);
    const archive = createStoredZip([{ name: 'doc.kml', data: kml }]);
    downloadBlob(new Blob([archive], { type: 'application/vnd.google-earth.kmz' }), 'urbatrame-releve.kmz');
    status('KMZ autonome créé localement avec doc.kml; aucun fichier ni fond externe n’est ajouté.', 'success');
  } catch (error) { status(error?.code ? errorMessage(error) : 'Export KMZ impossible.', 'error'); }
});
$('#exportGpkg').addEventListener('click', async () => {
  const button = $('#exportGpkg'); button.disabled = true;
  status('Préparation du GeoPackage EPSG:4326 dans ce navigateur…');
  try {
    const SQL = await loadSqlRuntime();
    const bytes = createGeoPackage(state.layers, SQL);
    downloadBlob(new Blob([bytes], { type: 'application/geopackage+sqlite3' }), 'urbatrame-releve.gpkg');
    const count = state.layers.filter(layer => layer.visible && layer.kind !== 'raster').reduce((sum, layer) => sum + layer.geojson.features.length, 0);
    status(`GeoPackage EPSG:4326 exporté localement · ${count.toLocaleString('fr-FR')} entité(s). Les couches raster ne sont pas incluses.`, 'success');
  } catch (error) { status(error?.code ? errorMessage(error) : 'Export GeoPackage impossible.', 'error'); }
  finally { updateActions(); }
});

$('#clearLayers').addEventListener('click', () => {
  state.layers = []; state.selectedLayerId = null; state.selectedFeature = null; state.pendingAiGeoJSON = null;
  $('#aiValidateResult').checked = false;
  renderAll(); status('Toutes les couches ont été retirées de cet onglet.', 'success');
});

$('#createSurveyLayer').addEventListener('click', createSurveyLayer);
$('#applySurveyView').addEventListener('click', applySurveyViewInputs);
$('#fitSurveyData').addEventListener('click', () => { state.surveyViewEnabled = false; renderMap(); });
$('#surveyZoomIn').addEventListener('click', () => zoomSurveyView(0.5));
$('#surveyZoomOut').addEventListener('click', () => zoomSurveyView(2));
$('#readGps').addEventListener('click', readGpsPosition);
$('#captureGpsPoint').addEventListener('click', captureGpsPoint);
$('#geoidFile').addEventListener('change', () => loadGeoidFile($('#geoidFile').files?.[0]));
$('#removeGeoid').addEventListener('click', () => {
  state.geoidGrid = null; $('#removeGeoid').disabled = true; $('#geoidConfirmRow').hidden = true; $('#confirmGeoidUse').checked = false;
  $('#geoidStatus').textContent = 'Modèle retiré de la mémoire de cet onglet. Les hauteurs ellipsoïdales déjà capturées ne sont pas modifiées.';
});
$('#confirmGeoidUse').addEventListener('change', () => {
  if ($('#confirmGeoidUse').checked) {
    const fix = state.gpsFix;
    if (!state.geoidGrid || !fix || interpolateGeoidUndulation(state.geoidGrid, fix.lon, fix.lat) === null) {
      $('#confirmGeoidUse').checked = false;
      surveyStatus('Impossible de valider le géoïde : chargez un modèle couvrant une position connue et vérifiez son datum vertical.', 'error');
    } else surveyStatus('Vous avez confirmé le modèle et le datum vertical. Les prochaines captures calculeront H = h − N lorsque l’altitude GNSS est disponible.', 'success');
  } else surveyStatus('Conversion verticale désactivée. Les captures conserveront seulement la hauteur ellipsoïdale si elle est fournie.', '');
});
$('#surveyTemplateName').addEventListener('input', () => {
  try { state.surveyTemplate = fieldTemplateFromEditor(); } catch { /* saisie en cours */ }
});
$('#addSurveyField').addEventListener('click', () => {
  if (state.surveyTemplate.fields.length >= MAX_SURVEY_FIELDS) { surveyStatus(`Limite de ${MAX_SURVEY_FIELDS} champs par gabarit.`, 'error'); return; }
  let index = state.surveyTemplate.fields.length + 1, key = `champ_${index}`;
  const used = new Set(state.surveyTemplate.fields.map(field => field.key.toLowerCase()));
  while (used.has(key.toLowerCase())) key = `champ_${++index}`;
  state.surveyTemplate = normalizeFieldTemplate({ ...state.surveyTemplate, fields: [...state.surveyTemplate.fields, { key, label: 'Nouveau champ', type: 'text', required: false, options: [] }] });
  renderSurveyFieldDefinitions(); renderSurveyForm();
});
$('#saveSurveyTemplate').addEventListener('click', () => {
  const template = storeSurveyTemplate();
  if (template) surveyStatus(lastSurveyTemplateStorageSucceeded ? `Gabarit « ${template.name} » enregistré sur cet appareil. Aucun relevé n’est inclus.` : `Gabarit « ${template.name} » reste utilisable dans cet onglet mais n’a pas pu être enregistré; exportez-le en fichier.`, lastSurveyTemplateStorageSucceeded ? 'success' : 'error');
});
$('#exportSurveyTemplate').addEventListener('click', downloadSurveyTemplate);
$('#deleteSurveyTemplate').addEventListener('click', () => {
  const index = Number($('#surveyTemplateLibrary').value);
  if (!Number.isInteger(index) || index < 0 || !savedSurveyTemplates[index]) { surveyStatus('Choisissez le gabarit enregistré à supprimer.', 'error'); return; }
  const [removed] = savedSurveyTemplates.splice(index, 1);
  try { localStorage.setItem(FIELD_TEMPLATES_KEY, JSON.stringify(savedSurveyTemplates)); surveyStatus(`Gabarit « ${removed.name} » supprimé de cet appareil. Les couches/projets déjà enregistrés ne sont pas modifiés.`, 'success'); }
  catch { surveyStatus('Gabarit retiré de la liste de cet onglet, mais le navigateur n’a pas pu mettre à jour le stockage local.', 'error'); }
  updateSurveyTemplateSelect();
});
$('#loadSurveyTemplate').addEventListener('click', () => {
  const index = Number($('#surveyTemplateLibrary').value);
  if (!Number.isInteger(index) || index < 0 || !savedSurveyTemplates[index]) { surveyStatus('Choisissez d’abord un gabarit enregistré.', 'error'); return; }
  setSurveyTemplate(savedSurveyTemplates[index]);
  surveyStatus(`Gabarit « ${state.surveyTemplate.name} » chargé.`, 'success');
});
$('#surveyTemplateFile').addEventListener('change', async () => {
  const file = $('#surveyTemplateFile').files?.[0];
  if (!file) return;
  try {
    if (file.size > MAX_FIELD_TEMPLATE_BYTES) throw Object.assign(new Error(), { code: 'FIELD_TEMPLATE_TOO_LARGE' });
    const template = parseFieldTemplate(await file.text());
    setSurveyTemplate(template);
    surveyStatus(`Gabarit « ${template.name} » importé. Il n’inclut pas les valeurs d’un relevé.`, 'success');
  } catch (error) { surveyStatus(error?.code === 'FIELD_TEMPLATE_TOO_LARGE' ? 'Fichier de gabarit trop volumineux (128 Ko max).' : 'Gabarit invalide ou format UrbaTrame non reconnu.', 'error'); }
  finally { $('#surveyTemplateFile').value = ''; }
});

updateSurveyTemplateSelect();
renderSurveyFieldDefinitions();
renderSurveyForm();
renderAll();
