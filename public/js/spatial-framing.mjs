import {
  CADRAGE_PROJECT_TYPE, CADRAGE_PROJECT_VERSION, LAYERS, LEVELS, MAX_ANNOTATIONS,
  MAX_CADRAGES, MAX_CADRAGE_PROJECT_BYTES, MAX_STUDY_RADIUS_M, MIN_VIEW_RADIUS_M, createDefaultFramingRecord,
  defaultLayerVisibility, defaultTitle, distanceMeters, fromLocalMeters, normalizeAnnotation,
  normalizeCenter, normalizeFramingProject, normalizeFramingRecord, parseFramingProject,
  perimeterCoordinates, perimeterStats, radiusForScale, scaleDenominator,
  serializeFramingProject, toLocalMeters, validatePerimeter, validCoordinate
} from './spatial-framing-core.mjs';
import { parseGeoJSONText } from './atelier/local-layers.mjs';
import { parseGeoPackage } from './atelier/geopackage.mjs';

const $ = id => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const STORAGE_KEY = 'urbatrame:spatial-framings:v1';
const MAX_LOCAL_IMPORT_BYTES = 15 * 1024 * 1024;
const MAX_RENDER_FEATURES = 5000;
const formatter = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const state = {
  level: 'wilaya-country',
  center: { lat: 36.7538, lon: 3.0588, name: 'Alger, Algérie' },
  viewRadius: 3000,
  perimeter: null,
  draftShape: [],
  drawTool: null,
  isDragging: false,
  dragStart: null,
  dragCurrent: null,
  editPerimeter: false,
  activeEdit: null,
  annotationDraft: [],
  annotationTool: null,
  annotationMoveMode: false,
  annotations: [],
  selectedAnnotationId: null,
  layerVisibility: defaultLayerVisibility(),
  countryCode: 'DZA',
  countryCatalog: [],
  adminCountry: [],
  adminWilayas: [],
  adminCommunes: [],
  selectedWilayaGid: '',
  selectedWilayaName: '',
  selectedCommuneGid: '',
  selectedCommuneName: '',
  gadmVersion: '4.1',
  gadmLoadedAt: '',
  osmFeatures: [],
  osmInclude: [],
  osmRadius: 0,
  osmLoadedAt: '',
  terrain: null,
  terrainSource: '',
  localFeatures: [],
  localFeatureLabel: '',
  records: [],
  currentRecordId: '',
  currentProjection: null,
  currentTitleManual: false,
  adminRequestId: 0,
  osmRequestId: 0,
  searchRequestId: 0,
  renderId: 0,
  visibleFeatureCount: 0,
  busy: false,
  busyKind: ''
};

const layerById = new Map(LAYERS.map(layer => [layer.id, layer]));
const levelById = new Map(LEVELS.map(level => [level.id, level]));

function svgElement(name, attrs = {}, parent = null) {
  const element = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined && value !== null) element.setAttribute(key, String(value));
  }
  if (parent) parent.append(element);
  return element;
}

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = String(value ?? '');
}

function setStatus(id, message, kind = '') {
  const element = $(id);
  if (!element) return;
  element.textContent = message;
  element.classList.toggle('error', kind === 'error');
  element.classList.toggle('success', kind === 'success');
}

function setBusy(isBusy, message = 'Chargement…', kind = '') {
  state.busy = isBusy;
  state.busyKind = isBusy ? kind : '';
  $('busy').classList.toggle('show', isBusy);
  $('busy').setAttribute('aria-hidden', String(!isBusy));
  setText('busyText', message);
}

let toastTimer = 0;
function toast(message, kind = '') {
  const element = $('toast');
  element.textContent = message;
  element.classList.toggle('error', kind === 'error');
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), 3600);
}

function currentLevel() { return levelById.get(state.level) || LEVELS[0]; }
function isSchematic() { return currentLevel().schematic; }
function currentSelectedUnit() {
  if (state.level === 'wilaya-country') return state.adminWilayas.find(item => featureGid(item, 1) === state.selectedWilayaGid) || null;
  if (state.level === 'city-wilaya') return state.adminCommunes.find(item => featureGid(item, 2) === state.selectedCommuneGid) || null;
  return state.adminCommunes.find(item => featureGid(item, 2) === state.selectedCommuneGid) || null;
}

function cleanCenterName(value) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
}

function currentTitle() {
  return defaultTitle(state.level, {
    wilaya: state.selectedWilayaName || 'à sélectionner',
    city: state.selectedCommuneName || state.center.name || 'à sélectionner',
    study: $('projectName').value.trim() || 'à définir'
  });
}

function updateTitle() {
  if (!state.currentTitleManual || !$('mapTitle').value.trim()) $('mapTitle').value = currentTitle();
  setText('previewTitle', $('mapTitle').value.trim() || currentTitle());
}

function pageDimensionsMm() {
  const size = $('pageSize')?.value || 'A4';
  const orientation = $('orientation')?.value || 'landscape';
  const dims = size === 'A2' ? [594, 420] : size === 'A3' ? [420, 297] : [297, 210];
  return orientation === 'portrait' ? [dims[1], dims[0]] : dims;
}

function pageMapScaleWidthMm() {
  const [pageW, pageH] = pageDimensionsMm();
  const mapW = Math.max(90, pageW - 80);
  const mapH = Math.max(90, pageH - 44);
  return Math.min(mapW, mapH);
}

function formatDistance(value) {
  if (!Number.isFinite(value)) return '—';
  return value >= 1000 ? `${(value / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} km` : `${Math.round(value).toLocaleString('fr-FR')} m`;
}

function formatArea(value) {
  if (!Number.isFinite(value) || value <= 0) return '—';
  return value >= 1_000_000
    ? `${(value / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} km²`
    : `${(value / 10_000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ha`;
}

function formatCoordinate(value, digits = 6) { return Number(value).toFixed(digits); }

function setMapAlert(message, kind = '') {
  const alert = $('mapAlert');
  alert.textContent = message;
  alert.classList.toggle('error', kind === 'error');
  alert.classList.toggle('info', kind === 'info');
}

function syncCenterInputs() {
  $('centerLat').value = Number(state.center.lat).toFixed(6);
  $('centerLon').value = Number(state.center.lon).toFixed(6);
  $('centerName').value = state.center.name || '';
  setText('mapCoordinates', `${formatCoordinate(state.center.lat)}, ${formatCoordinate(state.center.lon)}`);
}

function invalidateRemoteLayers(reason = 'Le centre a changé; les couches distantes affichées doivent être rechargées.') {
  state.osmRequestId++;
  if (state.busyKind === 'osm') setBusy(false);
  state.osmFeatures = [];
  state.osmInclude = [];
  state.osmRadius = 0;
  state.osmLoadedAt = '';
  state.terrain = null;
  state.terrainSource = '';
  setStatus('osmStatus', reason);
}

function applyCenter(value, { fromUnit = false } = {}) {
  const normalized = normalizeCenter(value);
  if (!normalized) {
    setStatus('centerStatus', 'Coordonnées invalides. Saisissez une latitude entre −85 et 85 et une longitude entre −180 et 180.', 'error');
    return false;
  }
  const moved = Math.abs(normalized.lat - state.center.lat) > 1e-7 || Math.abs(normalized.lon - state.center.lon) > 1e-7;
  normalized.name = cleanCenterName(value.name || state.center.name || 'Centre du cadrage');
  state.center = normalized;
  if (moved) invalidateRemoteLayers('Le centre a changé. Les couches OSM/relief précédentes ont été retirées; rechargez-les explicitement si besoin.');
  syncCenterInputs();
  setStatus('centerStatus', fromUnit
    ? 'Centre approximatif appliqué depuis l’unité GADM choisie. Vérifiez sa position avant l’analyse.'
    : 'Centre appliqué (WGS 84). Vérifiez le point et le périmètre avant d’enregistrer.', 'success');
  const check = validatePerimeter(state.perimeter, state.center, { required: false });
  if (state.perimeter && !check.ok) {
    setStatus('perimeterStatus', 'Le centre a changé : le périmètre dépasse maintenant 3 000 m. Redessinez-le ou recentrez la carte avant de sauvegarder.', 'error');
  }
  updateTitle();
  renderAll();
  updateButtons();
  return true;
}

function setLevel(level) {
  if (!levelById.has(level)) return;
  const changed = state.level !== level;
  state.level = level;
  state.drawTool = null;
  state.draftShape = [];
  state.editPerimeter = false;
  state.annotationTool = null;
  state.annotationDraft = [];
  state.annotationMoveMode = false;
  if (changed) {
    const definition = currentLevel();
    if (!definition.schematic) {
      state.viewRadius = definition.defaultRadius;
      $('viewRadius').value = String(state.viewRadius);
      $('mapScale').value = String(scaleDenominator(state.viewRadius, pageMapScaleWidthMm()));
    } else {
      state.viewRadius = MAX_STUDY_RADIUS_M;
      $('viewRadius').value = String(state.viewRadius);
    }
  }
  document.querySelectorAll('input[name="level"]').forEach(input => { input.checked = input.value === level; });
  const badge = $('limitBadge');
  badge.textContent = isSchematic() ? 'Repérage schématique · niveaux 1–2' : 'Périmètre d’analyse ≤ 3 000 m';
  badge.classList.toggle('detail', !isSchematic());
  setText('levelExplanation', isSchematic()
    ? 'Niveau de repérage général : les formes administratives servent à situer le projet et ne sont pas limitées à 3 000 m. Aucun périmètre d’analyse détaillée n’est calculé à cette échelle.'
    : 'Niveau de travail détaillé : le cercle, le rectangle ou chaque sommet du polygone doit rester à 3 000 m au maximum du centre WGS 84. Cette limite est contrôlée dans l’interface et par la route de données dédiée.');
  $('mapScale').disabled = isSchematic();
  $('viewRadius').disabled = isSchematic();
  $('circleRadius').disabled = isSchematic();
  $('finishShape').textContent = 'Terminer le polygone';
  setStatus('perimeterStatus', state.perimeter ? perimeterMessage() : 'Aucun périmètre d’analyse dessiné.');
  updateTitle();
  setMapAlert(isSchematic()
    ? 'Carte de repérage schématique : les limites administratives affichées ne correspondent pas à un périmètre d’analyse. Le plafond de 3 000 m s’applique aux niveaux 3–4.'
    : state.perimeter ? perimeterMessage() : 'Niveau détaillé : dessinez/importez un périmètre d’analyse inférieur ou égal à 3 000 m pour pouvoir enregistrer ce cadrage.',
    isSchematic() ? '' : 'info');
  updateButtons();
  renderAll();
}

function perimeterMessage() {
  const check = validatePerimeter(state.perimeter, state.center, { required: !isSchematic() });
  if (!state.perimeter) return isSchematic() ? 'Aucun périmètre d’analyse défini (facultatif pour le repérage schématique).' : 'Aucun périmètre d’analyse dessiné. Le cadrage détaillé ne peut pas être sauvegardé.';
  if (!check.ok && check.code === 'PERIMETER_TOO_LARGE') return `Périmètre non conforme : sa limite est à ${formatDistance(check.stats.maxDistanceM)} du centre. Maximum autorisé : 3 000 m.`;
  if (!check.ok) return 'Périmètre incomplet ou invalide. Redessinez-le avant de sauvegarder.';
  const prefix = check.stats.maxDistanceM > MAX_STUDY_RADIUS_M - 1 ? 'Limite atteinte.' : 'Périmètre conforme.';
  return `${prefix} Distance maximale au centre : ${formatDistance(check.stats.maxDistanceM)}.`;
}

function updatePerimeterPanel() {
  const check = validatePerimeter(state.perimeter, state.center, { required: !isSchematic() });
  const status = $('perimeterStatus');
  if (!state.perimeter) {
    setStatus('perimeterStatus', perimeterMessage(), !isSchematic() ? 'error' : '');
    $('perimeterMetrics').replaceChildren();
  } else {
    setStatus('perimeterStatus', perimeterMessage(), check.ok ? 'success' : 'error');
    const stats = check.stats;
    const values = [
      ['Surface approximative', formatArea(stats.areaM2)],
      ['Longueur du contour', formatDistance(stats.perimeterM)],
      ['Dimensions approx.', `${formatDistance(stats.widthM)} × ${formatDistance(stats.heightM)}`],
      ['Distance maximale au centre', formatDistance(stats.maxDistanceM)]
    ];
    const fragment = document.createDocumentFragment();
    for (const [label, value] of values) {
      const box = document.createElement('div'); box.className = 'metric';
      const name = document.createElement('span'); name.textContent = label;
      const result = document.createElement('strong'); result.textContent = value;
      box.append(name, result); fragment.append(box);
    }
    $('perimeterMetrics').replaceChildren(fragment);
  }
  updateButtons();
}

function updateButtons() {
  const hasPerimeter = Boolean(state.perimeter);
  const valid = validatePerimeter(state.perimeter, state.center, { required: !isSchematic() }).ok;
  const canDraw = !isSchematic();
  document.querySelectorAll('[data-draw]').forEach(button => { button.disabled = !canDraw; button.setAttribute('aria-pressed', String(state.drawTool === button.dataset.draw)); });
  $('finishShape').disabled = !(state.drawTool === 'polygon' && state.draftShape.length >= 3);
  $('cancelShape').disabled = !state.drawTool;
  $('editShape').disabled = !canDraw || !hasPerimeter || state.perimeter.type === 'circle';
  $('editShape').textContent = state.editPerimeter ? 'Terminer la modification' : 'Modifier les sommets';
  $('clearShape').disabled = !hasPerimeter;
  $('centerOnUnit').disabled = !currentSelectedUnit();
  $('saveFraming').disabled = !valid;
  $('deleteFraming').disabled = !state.currentRecordId || !state.records.some(item => item.id === state.currentRecordId);
  $('finishAnnotation').disabled = !state.annotationTool || (state.annotationTool === 'zone' && state.annotationDraft.length < 3);
  $('updateAnnotation').disabled = !state.selectedAnnotationId;
  $('moveAnnotation').disabled = !state.selectedAnnotationId;
  $('deleteAnnotation').disabled = !state.selectedAnnotationId;
  $('cancelTool').hidden = !(state.drawTool || state.annotationTool || state.editPerimeter || state.annotationMoveMode);
  $('cancelTool').textContent = state.editPerimeter || state.annotationMoveMode ? 'Quitter le mode édition' : 'Quitter l’outil';
}

function updateScaleControls({ from = 'radius' } = {}) {
  if (isSchematic()) {
    $('mapScale').disabled = true;
    $('viewRadius').disabled = true;
    setText('scaleStatus', 'Repérage schématique : la carte n’est pas à l’échelle et ne fournit pas de mesure graphique fiable.');
    return;
  }
  $('mapScale').disabled = false;
  $('viewRadius').disabled = false;
  if (from === 'scale') {
    const scale = Number($('mapScale').value);
    let radius = radiusForScale(scale, pageMapScaleWidthMm());
    if (!Number.isFinite(radius) || radius < MIN_VIEW_RADIUS_M) radius = MIN_VIEW_RADIUS_M;
    if (radius > MAX_STUDY_RADIUS_M) {
      radius = MAX_STUDY_RADIUS_M;
      $('viewRadius').value = String(radius);
      $('mapScale').value = String(scaleDenominator(radius, pageMapScaleWidthMm()));
      setText('scaleStatus', 'Cette échelle dépasserait 3 000 m. Le rayon visible a été limité à 3 000 m; choisissez une échelle plus rapprochée.');
      setMapAlert('L’échelle demandée dépasserait l’emprise autorisée. La vue a été limitée à 3 000 m.', 'error');
    } else {
      $('viewRadius').value = String(Math.round(radius));
      state.viewRadius = Math.round(radius);
      setText('scaleStatus', `Rayon visible : ${formatDistance(state.viewRadius)}. Échelle imprimée estimative 1:${Math.round(scaleDenominator(state.viewRadius, pageMapScaleWidthMm())).toLocaleString('fr-FR')}.`);
    }
  } else {
    let radius = Math.round(Number($('viewRadius').value) || currentLevel().defaultRadius);
    if (radius > MAX_STUDY_RADIUS_M) {
      radius = MAX_STUDY_RADIUS_M;
      $('viewRadius').value = String(radius);
      setText('scaleStatus', 'Rayon limité à 3 000 m maximum.');
    }
    radius = Math.max(MIN_VIEW_RADIUS_M, radius);
    state.viewRadius = radius;
    $('viewRadius').value = String(radius);
    $('mapScale').value = String(scaleDenominator(radius, pageMapScaleWidthMm()));
    setText('scaleStatus', `Rayon visible : ${formatDistance(radius)}. Échelle imprimée estimative 1:${scaleDenominator(radius, pageMapScaleWidthMm()).toLocaleString('fr-FR')}.`);
  }
  renderAll();
}

function loadClassicScript(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url; script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(Object.assign(new Error('READER_ASSET_LOAD_FAILED'), { code: 'READER_ASSET_LOAD_FAILED' }));
    document.head.append(script);
  });
}

let sqlPromise;
async function loadSqlRuntime() {
  if (window.initSqlJs) return window.initSqlJs({ locateFile: file => `/vendor/sql.js/${file}` });
  if (!sqlPromise) sqlPromise = loadClassicScript('/vendor/sql.js/sql-wasm-browser.js')
    .then(() => {
      if (!window.initSqlJs) throw Object.assign(new Error(), { code: 'GPKG_READER_UNAVAILABLE' });
      return window.initSqlJs({ locateFile: file => `/vendor/sql.js/${file}` });
    }).catch(error => { sqlPromise = null; throw error; });
  return sqlPromise;
}

async function populateCountrySelect() {
  try {
    const response = await fetch('/data/gadm-countries.json', { headers: { Accept: 'application/json' } });
    if (!response.ok) return;
    const payload = await response.json();
    const countries = Array.isArray(payload.countries) ? payload.countries.filter(item => /^[A-Z0-9]{3}$/.test(item.code) && item.name) : [];
    if (!countries.length) return;
    state.countryCatalog = countries;
    const options = countries.slice().sort((a, b) => {
      const aName = a.code === 'DZA' ? 'Algérie' : a.name;
      const bName = b.code === 'DZA' ? 'Algérie' : b.name;
      return aName.localeCompare(bName, 'fr');
    }).map(country => {
      const option = document.createElement('option'); option.value = country.code;
      option.textContent = `${country.code === 'DZA' ? 'Algérie' : country.name} (${country.code})`;
      return option;
    });
    $('countryCode').replaceChildren(...options);
    $('countryCode').value = state.countryCode;
  } catch { /* Le choix Algérie reste disponible hors connexion. */ }
}

function onCountryChange() {
  state.adminRequestId++;
  if (state.busyKind === 'gadm') setBusy(false);
  state.countryCode = $('countryCode').value || 'DZA';
  state.adminCountry = []; state.adminWilayas = []; state.adminCommunes = []; state.gadmLoadedAt = '';
  state.selectedWilayaGid = ''; state.selectedWilayaName = '';
  state.selectedCommuneGid = ''; state.selectedCommuneName = '';
  fillSelect($('wilayaSelect'), [], 1, '', 'Chargez d’abord les limites');
  fillSelect($('communeSelect'), [], 2, '', 'Sélectionnez une wilaya');
  setStatus('adminStatus', 'Pays choisi. Cliquez sur « Charger les limites GADM » pour demander ses limites.');
  updateTitle(); renderAll(); updateButtons();
}

async function fetchGadm({ country = state.countryCode, level, parent = '', parentLevel = '' }) {
  const params = new URLSearchParams({ country, level: String(level), version: state.gadmVersion });
  if (parent) { params.set('parent', parent); params.set('parentLevel', String(parentLevel)); }
  const response = await fetch(`/api/atelier/gadm?${params.toString()}`, { headers: { Accept: 'application/geo+json, application/json' } });
  let payload;
  try { payload = await response.json(); } catch { throw new Error('GADM_INVALID_RESPONSE'); }
  if (!response.ok || !payload || !Array.isArray(payload.features))
    throw new Error(payload?.message || payload?.error || (response.status === 404 ? 'GADM_LEVEL_UNAVAILABLE' : 'GADM_UNAVAILABLE'));
  return payload.features.filter(feature => feature?.type === 'Feature' && feature.geometry);
}

function featureProps(feature) { return feature?.properties && typeof feature.properties === 'object' ? feature.properties : {}; }
function featureGid(feature, level) {
  const props = featureProps(feature);
  return String(props[`GID_${level}`] || props.GID || feature?.id || '');
}
function featureName(feature, level) {
  const props = featureProps(feature);
  return String(props[`NAME_${level}`] || props.NAME || props[`NL_NAME_${level}`] || `Unité ${featureGid(feature, level)}`).slice(0, 120);
}
function sortFeatures(features, level) { return [...features].sort((a, b) => featureName(a, level).localeCompare(featureName(b, level), 'fr')); }

function fillSelect(select, features, level, selectedGid, placeholder) {
  const options = [];
  const first = document.createElement('option'); first.value = ''; first.textContent = placeholder; options.push(first);
  for (const feature of sortFeatures(features, level)) {
    const gid = featureGid(feature, level); if (!gid) continue;
    const option = document.createElement('option'); option.value = gid; option.textContent = featureName(feature, level); options.push(option);
  }
  select.replaceChildren(...options);
  select.disabled = features.length === 0;
  if (selectedGid && [...select.options].some(option => option.value === selectedGid)) select.value = selectedGid;
  else select.value = '';
}

async function loadAdministrative() {
  if (state.busy) return;
  const requestId = ++state.adminRequestId;
  state.countryCode = $('countryCode').value || 'DZA';
  const catalogEntry = state.countryCatalog.find(item => item.code === state.countryCode);
  const maxLevel = Number(catalogEntry?.maxLevel ?? 2);
  setBusy(true, 'Chargement explicite des limites GADM…', 'gadm');
  setStatus('adminStatus', `Récupération des limites administratives de ${catalogEntry?.name || state.countryCode} demandée…`);
  try {
    const countryFeatures = await fetchGadm({ level: 0 });
    let wilayas = [];
    if (maxLevel >= 1) wilayas = await fetchGadm({ level: 1 });
    if (requestId !== state.adminRequestId) return;
    state.adminCountry = countryFeatures;
    state.adminWilayas = wilayas;
    state.gadmLoadedAt = new Date().toISOString();
    fillSelect($('wilayaSelect'), wilayas, 1, state.selectedWilayaGid, 'Choisir une unité de niveau 1');
    if (!$('wilayaSelect').value && wilayas.length) {
      const firstPlace = String(state.center.name || '').split(/[·,]/)[0].trim().toLocaleLowerCase('fr');
      const matched = wilayas.find(feature => featureName(feature, 1).toLocaleLowerCase('fr') === firstPlace ||
        firstPlace.startsWith(featureName(feature, 1).toLocaleLowerCase('fr')) || featureName(feature, 1).toLocaleLowerCase('fr').startsWith(firstPlace));
      if (matched) $('wilayaSelect').value = featureGid(matched, 1);
    }
    state.selectedWilayaGid = $('wilayaSelect').value;
    const selectedWilaya = wilayas.find(feature => featureGid(feature, 1) === state.selectedWilayaGid);
    state.selectedWilayaName = selectedWilaya ? featureName(selectedWilaya, 1) : '';
    let detailedLevelError = '';
    state.adminCommunes = [];
    state.selectedCommuneGid = '';
    state.selectedCommuneName = '';
    fillSelect($('communeSelect'), [], 2, '', 'Choisissez une unité de niveau 1');
    if (state.selectedWilayaGid && maxLevel >= 2) {
      try {
        const communes = await fetchGadm({ level: 2, parent: state.selectedWilayaGid, parentLevel: 1 });
        if (requestId !== state.adminRequestId) return;
        state.adminCommunes = communes;
        fillSelect($('communeSelect'), communes, 2, state.selectedCommuneGid, 'Choisir une unité disponible');
        if (!$('communeSelect').value && communes.length) $('communeSelect').value = featureGid(sortFeatures(communes, 2)[0], 2);
        state.selectedCommuneGid = $('communeSelect').value;
        const selectedCommune = communes.find(feature => featureGid(feature, 2) === state.selectedCommuneGid);
        state.selectedCommuneName = selectedCommune ? featureName(selectedCommune, 2) : '';
      } catch (error) {
        fillSelect($('communeSelect'), [], 2, '', 'Unités non disponibles — réessayez');
        detailedLevelError = friendlyError(error);
      }
    }
    if (requestId !== state.adminRequestId) return;
    if (detailedLevelError) setStatus('adminStatus', `Les limites du pays et du niveau 1 sont chargées, mais les subdivisions de ${state.selectedWilayaName || 'l’unité choisie'} sont indisponibles (${detailedLevelError}). Réessayez ou utilisez un contour vérifié localement.`, 'error');
    else if (!state.selectedWilayaGid) setStatus('adminStatus', `Limites GADM ${state.gadmVersion} chargées (${countryFeatures.length} géométrie(s) nationale(s), ${wilayas.length} unité(s) de niveau 1). Choisissez une unité puis cliquez à nouveau pour charger ses subdivisions.`, 'success');
    else if (maxLevel < 2) setStatus('adminStatus', `Limites GADM ${state.gadmVersion} chargées (${wilayas.length} unité(s) de niveau 1). GADM ne propose pas de niveau inférieur pour ce territoire.`, 'success');
    else if (!state.adminCommunes.length) setStatus('adminStatus', `Limites GADM ${state.gadmVersion} chargées (${wilayas.length} unités). Les subdivisions de ${state.selectedWilayaName} ne sont pas disponibles ou n’ont pas été retournées.`, 'success');
    else setStatus('adminStatus', `Limites GADM ${state.gadmVersion} chargées : ${wilayas.length} unités de niveau 1 et ${state.adminCommunes.length} unités sous ${state.selectedWilayaName}. Aperçu généralisé.`, 'success');
    updateTitle(); renderAll(); updateButtons();
  } catch (error) {
    if (requestId !== state.adminRequestId) return;
    setStatus('adminStatus', `Impossible de charger les limites GADM : ${friendlyError(error)}. Vérifiez la connexion puis réessayez.`, 'error');
    setMapAlert('Aucune limite administrative n’a été chargée. Aucune frontière n’a été inventée; réessayez ou utilisez un contour vérifié local.', 'error');
  } finally {
    if (requestId === state.adminRequestId) setBusy(false);
  }
}

function friendlyError(error) {
  const code = String(error?.message || error || 'ERREUR');
  const messages = {
    GADM_LEVEL_UNAVAILABLE: 'niveau GADM indisponible', GADM_UNAVAILABLE: 'source GADM indisponible',
    GADM_INVALID_RESPONSE: 'réponse GADM illisible', GEOCODER_UNAVAILABLE: 'service de recherche indisponible',
    MAP_DATA_UNAVAILABLE: 'source cartographique indisponible', TERRAIN_UNAVAILABLE: 'service de relief indisponible',
    CADRAGE_DATA_LIMIT: 'trop de données pour afficher cette emprise', INVALID_LOCATION: 'coordonnées invalides',
    RADIUS_OUT_OF_RANGE: 'rayon invalide', CADRAGE_RADIUS_OUT_OF_RANGE: 'le rayon demandé dépasse 3 000 m'
  };
  return messages[code] || code.replaceAll('_', ' ').slice(0, 150);
}

function onWilayaChange() {
  state.adminRequestId++;
  if (state.busyKind === 'gadm') setBusy(false);
  state.selectedWilayaGid = $('wilayaSelect').value;
  const selected = state.adminWilayas.find(feature => featureGid(feature, 1) === state.selectedWilayaGid);
  state.selectedWilayaName = selected ? featureName(selected, 1) : '';
  state.adminCommunes = [];
  state.selectedCommuneGid = ''; state.selectedCommuneName = '';
  fillSelect($('communeSelect'), [], 2, '', 'Cliquez sur « Charger les limites GADM »');
  setStatus('adminStatus', state.selectedWilayaName ? `Wilaya choisie : ${state.selectedWilayaName}. Pour charger ses unités de niveau inférieur, cliquez à nouveau sur « Charger les limites GADM ».` : 'Choisissez une wilaya.');
  updateTitle(); renderAll(); updateButtons();
}

function onCommuneChange() {
  state.selectedCommuneGid = $('communeSelect').value;
  const selected = state.adminCommunes.find(feature => featureGid(feature, 2) === state.selectedCommuneGid);
  state.selectedCommuneName = selected ? featureName(selected, 2) : '';
  updateTitle(); renderAll(); updateButtons();
}

function featureCoordinates(geometry, collect = []) {
  if (!geometry || typeof geometry !== 'object') return collect;
  const walk = value => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
      if (validCoordinate(value)) collect.push([Number(value[0]), Number(value[1])]);
      return;
    }
    for (const child of value) walk(child);
  };
  if (geometry.type === 'GeometryCollection') for (const child of geometry.geometries || []) featureCoordinates(child, collect);
  else walk(geometry.coordinates);
  return collect;
}

function featureApproxCenter(feature) {
  const points = featureCoordinates(feature?.geometry);
  if (!points.length) return null;
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const point of points) {
    minLon = Math.min(minLon, point[0]); maxLon = Math.max(maxLon, point[0]);
    minLat = Math.min(minLat, point[1]); maxLat = Math.max(maxLat, point[1]);
  }
  return { lon: (minLon + maxLon) / 2, lat: (minLat + maxLat) / 2 };
}

function centerOnSelectedUnit() {
  const feature = currentSelectedUnit();
  const center = featureApproxCenter(feature);
  if (!center) return toast('Aucun centroïde calculable pour cette unité.', 'error');
  const label = state.level === 'wilaya-country' ? state.selectedWilayaName : (state.selectedCommuneName || state.selectedWilayaName);
  applyCenter({ ...center, name: label ? `${label} · centre approximatif` : 'Centre approximatif de l’unité' }, { fromUnit: true });
}

async function searchPlace(event) {
  event?.preventDefault();
  const query = $('placeSearch').value.trim();
  if (query.length < 2) return setStatus('searchStatus', 'Saisissez au moins deux caractères pour rechercher.', 'error');
  const requestId = ++state.searchRequestId;
  $('searchResults').replaceChildren();
  setStatus('searchStatus', 'Recherche envoyée au service Nominatim / OpenStreetMap…');
  try {
    const response = await fetch('/api/atelier/geocode', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ q: query })
    });
    const payload = await response.json();
    if (requestId !== state.searchRequestId) return;
    const results = Array.isArray(payload) ? payload : payload.results;
    if (!response.ok || !Array.isArray(results)) throw new Error(payload?.error || 'GEOCODER_UNAVAILABLE');
    if (!results.length) return setStatus('searchStatus', `Aucun résultat pour « ${query} ». Essayez une autre orthographe ou saisissez les coordonnées.`, 'error');
    setStatus('searchStatus', `${results.length} résultat${results.length > 1 ? 's' : ''}. Cliquez sur le lieu correct pour l’appliquer.` , 'success');
    for (const result of results.slice(0, 8)) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'search-result';
      button.textContent = `${result.name || 'Lieu sans nom'} · ${Number(result.lat).toFixed(5)}, ${Number(result.lon).toFixed(5)}`;
      button.addEventListener('click', () => {
        applyCenter({ lat: result.lat, lon: result.lon, name: result.name || query });
        setStatus('searchStatus', `Centre sélectionné : ${result.name || query}. La recherche n’a pas chargé de couche cartographique.`, 'success');
        $('searchResults').replaceChildren();
      });
      $('searchResults').append(button);
    }
  } catch (error) {
    if (requestId !== state.searchRequestId) return;
    setStatus('searchStatus', `Recherche impossible : ${friendlyError(error)}. Vous pouvez saisir des coordonnées directement.`, 'error');
  }
}

function applyCoordinatesFromFields() {
  applyCenter({ lat: $('centerLat').value, lon: $('centerLon').value, name: $('centerName').value });
}

function startShape(tool) {
  if (isSchematic()) return toast('Le dessin d’un périmètre d’analyse est réservé aux niveaux 3–4. Les niveaux 1–2 sont des cartes de repérage schématiques.', 'error');
  state.drawTool = tool;
  state.draftShape = [];
  state.editPerimeter = false;
  state.annotationTool = null;
  state.annotationMoveMode = false;
  document.querySelectorAll('[data-draw]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.draw === tool)));
  setMapAlert(tool === 'polygon' ? 'Cliquez pour placer les sommets du polygone; terminez avec « Terminer le polygone ». Chaque sommet doit rester dans un rayon de 3 000 m.' : `Cliquez-glissez pour dessiner le ${tool === 'circle' ? 'cercle' : 'rectangle'}. Le périmètre doit rester dans un rayon de 3 000 m.`, 'info');
  updateButtons(); renderMap();
}

function cancelCurrentTool() {
  state.drawTool = null; state.draftShape = []; state.dragStart = null; state.dragCurrent = null; state.isDragging = false;
  state.editPerimeter = false; state.activeEdit = null; state.annotationTool = null; state.annotationDraft = []; state.annotationMoveMode = false;
  document.querySelectorAll('[data-draw]').forEach(button => button.setAttribute('aria-pressed', 'false'));
  updateButtons(); renderMap();
}

function screenPoint(event) {
  const svg = $('mapCanvas');
  const point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
  try { return point.matrixTransform(svg.getScreenCTM().inverse()); }
  catch {
    const rect = svg.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * 1100 / rect.width, y: (event.clientY - rect.top) * 720 / rect.height };
  }
}

function screenToGeo(event) {
  const point = screenPoint(event);
  return state.currentProjection?.unproject ? state.currentProjection.unproject(point.x, point.y) : null;
}

function validGeoOrStatus(position) {
  if (!validCoordinate(position)) return false;
  if (Math.abs(position[1]) > 85) return false;
  return true;
}

function setNewPerimeter(perimeter, { fit = true } = {}) {
  const check = validatePerimeter(perimeter, state.center, { required: true });
  if (!check.ok) {
    setStatus('perimeterStatus', check.code === 'PERIMETER_TOO_LARGE'
      ? `Forme refusée : une partie se trouve à ${formatDistance(check.stats.maxDistanceM)} du centre. Le maximum est 3 000 m. Réduisez-la ou rapprochez ses sommets.`
      : 'Forme refusée : géométrie incomplète ou invalide. Redessinez-la.', 'error');
    setMapAlert(check.code === 'PERIMETER_TOO_LARGE' ? 'Le périmètre dépasse 3 000 m depuis le centre. La sauvegarde reste bloquée; corrigez la forme.' : 'La forme dessinée ne peut pas être utilisée; corrigez-la puis réessayez.', 'error');
    updateButtons();
    return false;
  }
  state.perimeter = perimeter.type === 'circle'
    ? { type: 'circle', center: perimeter.center.map(Number), radiusMeters: Number(perimeter.radiusMeters) }
    : { type: perimeter.type, coordinates: perimeter.coordinates.map(point => [Number(point[0]), Number(point[1])]) };
  if (fit && check.stats.maxDistanceM > state.viewRadius * 0.92) {
    state.viewRadius = Math.min(MAX_STUDY_RADIUS_M, Math.max(state.viewRadius, Math.ceil(check.stats.maxDistanceM * 1.15 / 50) * 50));
    $('viewRadius').value = String(state.viewRadius);
    $('mapScale').value = String(scaleDenominator(state.viewRadius, pageMapScaleWidthMm()));
  }
  state.drawTool = null; state.draftShape = []; state.isDragging = false;
  document.querySelectorAll('[data-draw]').forEach(button => button.setAttribute('aria-pressed', 'false'));
  updateScaleControls();
  updatePerimeterPanel();
  setMapAlert(perimeterMessage(), 'info');
  renderAll();
  return true;
}

function circleRadiusChanged() {
  const radius = Math.min(MAX_STUDY_RADIUS_M, Math.max(50, Number($('circleRadius').value) || 500));
  $('circleRadius').value = String(radius); setText('circleRadiusOut', `${radius.toLocaleString('fr-FR')} m`);
  if (state.perimeter?.type === 'circle') setNewPerimeter({ type: 'circle', center: [state.center.lon, state.center.lat], radiusMeters: radius }, { fit: false });
}

function finishShape() {
  if (state.drawTool !== 'polygon' || state.draftShape.length < 3) return;
  const points = state.draftShape.map(point => [...point]);
  if (points.length > 1000) return setStatus('perimeterStatus', 'Trop de sommets. Simplifiez le dessin pour continuer.', 'error');
  setNewPerimeter({ type: 'polygon', coordinates: points });
}

function clearShape() {
  state.perimeter = null; state.editPerimeter = false; state.drawTool = null; state.draftShape = [];
  updatePerimeterPanel(); updateButtons();
  setMapAlert('Périmètre supprimé. Le niveau 3–4 ne peut pas être sauvegardé sans un nouveau contour conforme.', 'info');
  renderAll();
}

function toggleEditPerimeter() {
  if (!state.perimeter || state.perimeter.type === 'circle') return;
  state.editPerimeter = !state.editPerimeter;
  state.drawTool = null; state.annotationMoveMode = false;
  setMapAlert(state.editPerimeter ? 'Modification active : faites glisser un sommet. Toute position au-delà de 3 000 m sera refusée.' : 'Modification des sommets terminée.', 'info');
  updateButtons(); renderMap();
}

function updatePerimeterVertex(index, position) {
  if (!state.perimeter || !Array.isArray(state.perimeter.coordinates) || !validGeoOrStatus(position)) return;
  const coordinates = state.perimeter.coordinates.map(point => [...point]);
  if (index < 0 || index >= coordinates.length) return;
  coordinates[index] = position;
  const candidate = { type: 'polygon', coordinates };
  const check = validatePerimeter(candidate, state.center, { required: true });
  if (!check.ok) {
    setStatus('perimeterStatus', check.code === 'PERIMETER_TOO_LARGE' ? `Sommet refusé : il placerait le périmètre à ${formatDistance(check.stats.maxDistanceM)} du centre (maximum 3 000 m).` : 'Sommet refusé : cette modification invalide la forme.', 'error');
    return;
  }
  state.perimeter = candidate;
  updatePerimeterPanel();
}

function startAnnotation() {
  if (isSchematic() && !state.adminCountry.length && !state.adminWilayas.length) return toast('Chargez d’abord une limite GADM pour pouvoir annoter cette carte de repérage.', 'error');
  const type = $('annotationType').value;
  state.annotationTool = type;
  state.annotationDraft = [];
  state.drawTool = null; state.editPerimeter = false; state.annotationMoveMode = false;
  setMapAlert(type === 'point' || type === 'text'
    ? 'Cliquez sur la carte pour placer l’annotation.'
    : type === 'zone' ? 'Cliquez pour tracer les sommets de la zone puis choisissez « Terminer ». '
      : 'Cliquez deux fois sur la carte pour définir le début et la fin de la ligne.', 'info');
  updateButtons(); renderMap();
}

function finishAnnotation() {
  const type = state.annotationTool;
  if (!type) return;
  const points = state.annotationDraft.map(point => [...point]);
  if ((type === 'zone' && points.length < 3) || ((type === 'line' || type === 'arrow') && points.length < 2))
    return toast('Ajoutez assez de points avant de terminer cette annotation.', 'error');
  addAnnotation({ type, coordinates: points });
}

function addAnnotation({ type, position = null, coordinates = [] }) {
  if (state.annotations.length >= MAX_ANNOTATIONS) return toast('Limite de 300 annotations par cadrage atteinte.', 'error');
  const annotation = normalizeAnnotation({
    id: globalThis.crypto?.randomUUID?.() || `ann-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type, position, coordinates, text: $('annotationText').value.trim(), category: $('annotationCategory').value,
    color: $('annotationColor').value, width: 3
  }, state.annotations.length);
  if (!annotation) return toast('Annotation incomplète; vérifiez les points et terminez la forme.', 'error');
  state.annotations.push(annotation);
  state.selectedAnnotationId = annotation.id;
  state.annotationDraft = []; state.annotationTool = null; state.annotationMoveMode = false;
  setMapAlert('Annotation ajoutée. Elle est enregistrée localement avec ce cadrage lorsque vous le sauvegardez.', 'info');
  renderAll(); updateButtons();
}

function syncAnnotationEditor(annotation) {
  if (!annotation) return;
  $('annotationType').value = annotation.type;
  $('annotationCategory').value = annotation.category || 'custom';
  $('annotationText').value = annotation.text || '';
  $('annotationColor').value = annotation.color || '#b24d3b';
}

function selectAnnotation(id) {
  state.selectedAnnotationId = id;
  syncAnnotationEditor(state.annotations.find(item => item.id === id));
  renderAnnotationList(); renderMap(); updateButtons();
}

function updateSelectedAnnotationProperties() {
  const id = state.selectedAnnotationId;
  const source = state.annotations.find(item => item.id === id);
  if (!source) return;
  const normalized = normalizeAnnotation({ ...source,
    text: $('annotationText').value.trim(), category: $('annotationCategory').value,
    color: $('annotationColor').value
  });
  if (!normalized) return toast('La modification de l’annotation n’est pas valide.', 'error');
  state.annotations = state.annotations.map(item => item.id === id ? normalized : item);
  setMapAlert('Texte et style de l’annotation mis à jour localement.', 'info');
  renderAll();
}

function toggleMoveAnnotation() {
  if (!state.selectedAnnotationId) return;
  state.annotationMoveMode = !state.annotationMoveMode;
  state.editPerimeter = false; state.drawTool = null; state.annotationTool = null;
  setMapAlert(state.annotationMoveMode ? 'Déplacement actif : faites glisser un sommet de l’annotation choisie.' : 'Déplacement de l’annotation terminé.', 'info');
  updateButtons(); renderMap();
}

function removeSelectedAnnotation() {
  if (!state.selectedAnnotationId) return;
  state.annotations = state.annotations.filter(item => item.id !== state.selectedAnnotationId);
  state.selectedAnnotationId = '';
  state.annotationMoveMode = false;
  renderAll(); updateButtons();
}

function updateAnnotationPoint(id, index, position) {
  const source = state.annotations.find(item => item.id === id);
  if (!source || !validGeoOrStatus(position)) return;
  let updated;
  if (source.type === 'point' || source.type === 'text') updated = { ...source, position };
  else {
    const coordinates = source.coordinates.map(point => [...point]);
    if (index < 0 || index >= coordinates.length) return;
    coordinates[index] = position; updated = { ...source, coordinates };
  }
  const normalized = normalizeAnnotation(updated);
  if (!normalized) return;
  state.annotations = state.annotations.map(item => item.id === id ? normalized : item);
  renderAnnotationList();
}

function eventHandle(event) {
  const target = event.target?.closest?.('[data-shape-handle],[data-annotation-handle]');
  if (!target) return null;
  if (target.hasAttribute('data-shape-handle') && state.editPerimeter) return { kind: 'perimeter', index: Number(target.dataset.index) };
  if (target.hasAttribute('data-annotation-handle') && state.annotationMoveMode) return { kind: 'annotation', id: target.dataset.id, index: Number(target.dataset.index) };
  return null;
}

function pointerDown(event) {
  const handle = eventHandle(event);
  if (handle) {
    state.activeEdit = handle; state.isDragging = true;
    try { $('mapCanvas').setPointerCapture(event.pointerId); } catch { /* Browser may not expose pointer capture in a preview. */ }
    event.preventDefault(); return;
  }
  if (state.drawTool === 'rectangle' || state.drawTool === 'circle') {
    const point = screenToGeo(event);
    if (!point) return;
    state.isDragging = true; state.dragStart = point; state.dragCurrent = point;
    try { $('mapCanvas').setPointerCapture(event.pointerId); } catch { /* optional */ }
    event.preventDefault(); renderMap();
  }
}

function pointerMove(event) {
  if (!state.isDragging) return;
  const point = screenToGeo(event);
  if (!point) return;
  if (state.activeEdit?.kind === 'perimeter') {
    if (state.perimeter?.type === 'rectangle') {
      state.perimeter = { type: 'polygon', coordinates: [...state.perimeter.coordinates].map(item => [...item]) };
    }
    updatePerimeterVertex(state.activeEdit.index, point);
  } else if (state.activeEdit?.kind === 'annotation') {
    updateAnnotationPoint(state.activeEdit.id, state.activeEdit.index, point);
  } else if (state.drawTool === 'rectangle' || state.drawTool === 'circle') {
    state.dragCurrent = point;
  }
  renderMap();
}

function pointerUp(event) {
  if (!state.isDragging) return;
  const point = screenToGeo(event) || state.dragCurrent;
  if (state.activeEdit) {
    state.activeEdit = null; state.isDragging = false; updatePerimeterPanel(); updateButtons(); renderMap(); return;
  }
  const tool = state.drawTool;
  if ((tool === 'rectangle' || tool === 'circle') && state.dragStart && point) {
    if (tool === 'rectangle') {
      const a = state.dragStart, b = point;
      const coordinates = [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]];
      setNewPerimeter({ type: 'rectangle', coordinates });
    } else {
      const radius = distanceMeters(state.dragStart, point);
      setNewPerimeter({ type: 'circle', center: state.dragStart, radiusMeters: radius });
      if (state.perimeter?.type === 'circle') {
        $('circleRadius').value = String(Math.max(50, Math.min(3000, Math.round(radius / 10) * 10)));
        setText('circleRadiusOut', `${$('circleRadius').value} m`);
      }
    }
  }
  state.isDragging = false; state.dragStart = null; state.dragCurrent = null;
  if (tool === 'rectangle' || tool === 'circle') { state.drawTool = null; document.querySelectorAll('[data-draw]').forEach(button => button.setAttribute('aria-pressed', 'false')); }
  updateButtons(); renderMap();
}

function handleMapClick(event) {
  const target = event.target?.closest?.('[data-admin-gid],[data-ann-id]');
  if (target?.dataset.annId) { selectAnnotation(target.dataset.annId); return; }
  if (target?.dataset.adminGid) {
    if (target.dataset.adminLevel === 'wilaya') {
      $('wilayaSelect').value = target.dataset.adminGid; onWilayaChange();
    } else if (target.dataset.adminLevel === 'commune') {
      $('communeSelect').value = target.dataset.adminGid; onCommuneChange();
    }
    return;
  }
  const point = screenToGeo(event);
  if (!point || !validGeoOrStatus(point)) return;
  if (state.drawTool === 'polygon') {
    if (state.draftShape.length >= 1000) return toast('Limite de 1 000 sommets atteinte.', 'error');
    state.draftShape.push(point); updateButtons(); renderMap(); return;
  }
  if (!state.annotationTool) return;
  state.annotationDraft.push(point);
  const type = state.annotationTool;
  if (type === 'point' || type === 'text') addAnnotation({ type, position: point });
  else if ((type === 'line' || type === 'arrow') && state.annotationDraft.length >= 2) addAnnotation({ type, coordinates: state.annotationDraft.slice(0, 2) });
  else { updateButtons(); renderMap(); }
}

function geometryPath(geometry, project) {
  if (!geometry || typeof geometry !== 'object') return '';
  const makeLine = (line, close = false) => {
    if (!Array.isArray(line) || line.length < (close ? 3 : 2)) return '';
    const coords = line.map(project).filter(point => point && point.every(Number.isFinite));
    if (coords.length < (close ? 3 : 2)) return '';
    return `M${coords.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join('L')}${close ? 'Z' : ''}`;
  };
  const parts = [];
  const addRing = ring => { const path = makeLine(ring, true); if (path) parts.push(path); };
  switch (geometry.type) {
    case 'Point': return '';
    case 'MultiPoint': return '';
    case 'LineString': { const path = makeLine(geometry.coordinates); if (path) parts.push(path); break; }
    case 'MultiLineString': for (const line of geometry.coordinates || []) { const path = makeLine(line); if (path) parts.push(path); } break;
    case 'Polygon': for (const ring of geometry.coordinates || []) addRing(ring); break;
    case 'MultiPolygon': for (const polygon of geometry.coordinates || []) for (const ring of polygon || []) addRing(ring); break;
    case 'GeometryCollection': for (const child of geometry.geometries || []) { const path = geometryPath(child, project); if (path) parts.push(path); } break;
  }
  return parts.join('');
}

function makeProjection(rect, { schematic = isSchematic() } = {}) {
  if (schematic) {
    const features = state.level === 'wilaya-country'
      ? [...state.adminCountry, ...state.adminWilayas]
      : [...state.adminWilayas.filter(feature => featureGid(feature, 1) === state.selectedWilayaGid), ...state.adminCommunes];
    const points = features.flatMap(feature => featureCoordinates(feature.geometry));
    if (!points.length) {
      const centerX = rect.x + rect.width / 2, centerY = rect.y + rect.height / 2;
      return {
        schematic: true, scale: 1,
        project: position => position && [centerX + (Number(position[0]) - state.center.lon) * 80, centerY - (Number(position[1]) - state.center.lat) * 80],
        unproject: (x, y) => [state.center.lon + (x - centerX) / 80, state.center.lat - (y - centerY) / 80],
        available: false
      };
    }
    let minLat = Infinity, maxLat = -Infinity;
    for (const point of points) { minLat = Math.min(minLat, point[1]); maxLat = Math.max(maxLat, point[1]); }
    const latCenter = (minLat + maxLat) / 2;
    const cos = Math.max(0.01, Math.cos(latCenter * Math.PI / 180));
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const point of points) {
      const x = point[0] * cos, y = point[1];
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const padX = Math.max((maxX - minX) * .04, .08), padY = Math.max((maxY - minY) * .04, .08);
    minX -= padX; maxX += padX; minY -= padY; maxY += padY;
    const scale = Math.min((rect.width - 30) / Math.max(1e-8, maxX - minX), (rect.height - 30) / Math.max(1e-8, maxY - minY));
    const drawW = (maxX - minX) * scale, drawH = (maxY - minY) * scale;
    const x0 = rect.x + (rect.width - drawW) / 2, y0 = rect.y + (rect.height - drawH) / 2;
    return {
      schematic: true, scale, available: true,
      project: position => {
        if (!validCoordinate(position)) return null;
        return [x0 + (position[0] * cos - minX) * scale, y0 + (maxY - position[1]) * scale];
      },
      unproject: (x, y) => [((x - x0) / scale + minX) / cos, maxY - (y - y0) / scale]
    };
  }
  const radius = Math.max(MIN_VIEW_RADIUS_M, Math.min(MAX_STUDY_RADIUS_M, Number(state.viewRadius) || 1000));
  const scale = Math.min((rect.width - 54) / (2 * radius), (rect.height - 54) / (2 * radius));
  const cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2;
  return {
    schematic: false, scale, available: true,
    project: position => {
      if (!validCoordinate(position)) return null;
      const [x, y] = toLocalMeters(position, state.center);
      return [cx + x * scale, cy - y * scale];
    },
    unproject: (x, y) => fromLocalMeters((x - cx) / scale, (cy - y) / scale, state.center)
  };
}

function addText(parent, x, y, text, attrs = {}) {
  const node = svgElement('text', { x, y, ...attrs }, parent);
  node.textContent = String(text);
  return node;
}

function renderTerrain(group, project) {
  const terrain = state.terrain;
  if (!terrain || !Array.isArray(terrain.grid) || !state.layerVisibility.relief) return;
  const n = Math.min(40, terrain.grid.length);
  const values = terrain.grid.flat().filter(Number.isFinite);
  if (!values.length) return;
  const min = Math.min(...values), max = Math.max(...values), span = Math.max(1, max - min);
  const radius = Number(terrain.radius) || 0;
  const center = { lat: Number(terrain.lat), lon: Number(terrain.lon) };
  if (!(radius > 0) || !Number.isFinite(center.lat) || !Number.isFinite(center.lon)) return;
  const step = 2 * radius / n;
  for (let row = 0; row < n; row++) for (let col = 0; col < Math.min(n, terrain.grid[row]?.length || 0); col++) {
    const value = Number(terrain.grid[row][col]); if (!Number.isFinite(value)) continue;
    const x0 = -radius + col * step, y0 = radius - row * step;
    const p1 = fromLocalMeters(x0, y0, center), p2 = fromLocalMeters(x0 + step, y0 - step, center);
    const a = project(p1), b = project(p2); if (!a || !b) continue;
    const t = (value - min) / span, hue = 110 - t * 78, light = 81 - t * 25;
    svgElement('rect', { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.max(1, Math.abs(b[0] - a[0]) + .25), height: Math.max(1, Math.abs(b[1] - a[1]) + .25), fill: `hsl(${hue.toFixed(0)} 35% ${light.toFixed(0)}%)`, opacity: .53, 'data-layer': 'relief' }, group);
  }
}

function getOsmLayer(tags, element) {
  if (tags.place) return ['suburb', 'quarter', 'neighbourhood', 'neighborhood', 'locality'].includes(tags.place) ? 'neighborhoods' : 'centralities';
  if (tags.barrier || tags.waterway === 'dam') return 'barriers';
  if (tags.public_transport || tags.railway === 'station' || tags.railway === 'halt' || tags.railway === 'tram_stop' || tags.railway === 'subway_entrance' || tags.highway === 'bus_stop') return 'transport';
  if (tags.railway) return 'rail';
  if (tags.highway) {
    if (['footway', 'path', 'cycleway', 'steps', 'pedestrian', 'bridleway'].includes(tags.highway)) return 'pedestrian';
    if (['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link'].includes(tags.highway)) return 'roadsMain';
    if (['secondary', 'secondary_link', 'tertiary', 'tertiary_link'].includes(tags.highway)) return 'roadsSecondary';
    return 'roadsLocal';
  }
  if (tags.waterway || tags.natural === 'water' || tags.water) return 'water';
  if (tags.building || tags['building:part']) return 'buildings';
  if (tags.leisure || tags.amenity === 'park' || tags.landuse === 'grass' || tags.landuse === 'forest' || tags.landuse === 'meadow' || tags.landuse === 'recreation_ground' || tags.natural === 'wood' || tags.natural === 'scrub' || tags.natural === 'grassland' || tags.natural === 'heath' || tags.natural === 'tree_row' || tags.natural === 'tree') return 'green';
  if (tags.amenity || tags.shop || tags.tourism || tags.public_transport || tags.healthcare || tags.school) return 'equipment';
  return '';
}

function osmElementToFeature(element, index) {
  const tags = element?.tags && typeof element.tags === 'object' ? element.tags : {};
  const layerId = getOsmLayer(tags, element);
  if (!layerId) return null;
  let geometry = null;
  if (element.type === 'node' && Number.isFinite(Number(element.lon)) && Number.isFinite(Number(element.lat))) {
    geometry = { type: 'Point', coordinates: [Number(element.lon), Number(element.lat)] };
  } else if (element.type === 'way' && Array.isArray(element.geometry) && element.geometry.length >= 2) {
    const points = element.geometry.map(point => [Number(point.lon), Number(point.lat)]).filter(validCoordinate);
    if (points.length < 2) return null;
    const closed = points.length > 3 && points[0][0] === points.at(-1)[0] && points[0][1] === points.at(-1)[1];
    const area = Boolean(tags.building || tags['building:part'] || tags.landuse || tags.leisure || tags.natural === 'water' || tags.natural === 'wood' || tags.amenity === 'school' || tags.amenity === 'hospital' || tags.amenity === 'park' || tags.water);
    geometry = closed && area ? { type: 'Polygon', coordinates: [points] } : { type: 'LineString', coordinates: points };
  } else if (element.type === 'relation' && Array.isArray(element.members)) {
    const lines = element.members.filter(member => member?.role !== 'inner' && Array.isArray(member.geometry) && member.geometry.length >= 2)
      .map(member => member.geometry.map(point => [Number(point.lon), Number(point.lat)]).filter(validCoordinate)).filter(line => line.length >= 2);
    if (lines.length) geometry = { type: 'MultiLineString', coordinates: lines };
  }
  if (!geometry) return null;
  return { type: 'Feature', id: `${element.type || 'osm'}-${element.id ?? index}`, geometry, properties: { ...tags, osmType: element.type || '', osmId: element.id ?? index, layerId } };
}

function adminLabel(feature, level) {
  return featureName(feature, level);
}

function addAdminFeature(group, feature, layerId, level, project, { selected = false, clickable = false, fill = '' } = {}) {
  if (!feature?.geometry || !state.layerVisibility[layerId]) return;
  const path = geometryPath(feature.geometry, project);
  if (!path) return;
  const layer = layerById.get(layerId);
  const gid = featureGid(feature, level);
  const isCurrent = selected;
  const attrs = {
    d: path, class: `map-feature${clickable ? ' clickable' : ''}`,
    fill: fill || (layerId === 'country' ? '#eef1eb' : isCurrent ? '#f2c67e' : layerId === 'wilaya' ? '#e7e6d7' : '#ede9db'),
    'fill-opacity': layerId === 'country' ? .65 : isCurrent ? .78 : .48,
    'fill-rule': 'evenodd', stroke: isCurrent ? '#9c4f2d' : (layer?.color || '#82928a'),
    'stroke-width': isCurrent ? 2.4 : layerId === 'country' ? 2.2 : 1.1,
    'vector-effect': 'non-scaling-stroke', 'data-layer': layerId
  };
  if (!isSchematic()) { attrs.fill = 'none'; attrs['fill-opacity'] = 0; attrs['stroke-dasharray'] = layerId === 'commune' ? '5 4' : '8 5'; attrs['stroke-width'] = isCurrent ? 2.2 : 1.3; }
  if (clickable && gid) { attrs['data-admin-level'] = layerId; attrs['data-admin-gid'] = gid; }
  const pathNode = svgElement('path', attrs, group);
  const title = svgElement('title', {}, pathNode); title.textContent = `${adminLabel(feature, level)} · GADM ${state.gadmVersion} · limite administrative indicative`;
}

function renderAdministrative(group, project) {
  if (state.level === 'wilaya-country') {
    for (const feature of state.adminCountry) addAdminFeature(group, feature, 'country', 0, project, { selected: false });
    for (const feature of state.adminWilayas) addAdminFeature(group, feature, 'wilaya', 1, project, {
      selected: featureGid(feature, 1) === state.selectedWilayaGid, clickable: true
    });
    const selected = state.adminWilayas.find(feature => featureGid(feature, 1) === state.selectedWilayaGid);
    if (selected && state.layerVisibility.wilaya) {
      const center = featureApproxCenter(selected), p = center && project([center.lon, center.lat]);
      if (p) addText(group, p[0] + 5, p[1] - 6, featureName(selected, 1), { class: 'map-label', fill: '#583d5d', 'font-size': 13 });
    }
  } else if (state.level === 'city-wilaya') {
    const wilaya = state.adminWilayas.find(feature => featureGid(feature, 1) === state.selectedWilayaGid);
    if (wilaya) addAdminFeature(group, wilaya, 'wilaya', 1, project, { selected: true });
    for (const feature of state.adminCommunes) addAdminFeature(group, feature, 'commune', 2, project, {
      selected: featureGid(feature, 2) === state.selectedCommuneGid, clickable: true
    });
    const selected = state.adminCommunes.find(feature => featureGid(feature, 2) === state.selectedCommuneGid);
    if (selected && state.layerVisibility.commune) {
      const center = featureApproxCenter(selected), p = center && project([center.lon, center.lat]);
      if (p) addText(group, p[0] + 4, p[1] - 5, featureName(selected, 2), { class: 'map-label', fill: '#754b2a', 'font-size': 12 });
    }
  } else {
    const wilaya = state.adminWilayas.find(feature => featureGid(feature, 1) === state.selectedWilayaGid);
    if (wilaya) addAdminFeature(group, wilaya, 'wilaya', 1, project, { selected: false });
    for (const feature of state.adminCommunes) addAdminFeature(group, feature, 'commune', 2, project, {
      selected: featureGid(feature, 2) === state.selectedCommuneGid, clickable: false
    });
  }
}

function renderOsmFeatures(group, project) {
  if (!state.osmFeatures.length) return;
  let rendered = 0, labelCount = 0;
  for (const feature of state.osmFeatures) {
    if (rendered >= MAX_RENDER_FEATURES) break;
    const props = feature.properties || {}, layerId = props.layerId;
    if (!state.layerVisibility[layerId]) continue;
    const geometry = feature.geometry, layer = layerById.get(layerId);
    if (!geometry || !layer) continue;
    if (geometry.type === 'Point') {
      const p = project(geometry.coordinates); if (!p) continue;
      const radius = layerId === 'centralities' ? 5.1 : layerId === 'equipment' ? 3.9 : 2.2;
      const circle = svgElement('circle', { cx: p[0], cy: p[1], r: radius, fill: layer.color, stroke: '#fff', 'stroke-width': 1.2, 'data-layer': layerId, class: 'map-feature clickable' }, group);
      circle.dataset.osmId = String(feature.id || '');
      const title = svgElement('title', {}, circle); title.textContent = `${props.name || layer.label}${props.amenity ? ` · ${props.amenity}` : ''} · OpenStreetMap`;
      if (props.name && (layerId === 'centralities' || labelCount < 24 && layerId === 'equipment')) {
        addText(group, p[0] + 6, p[1] - 5, String(props.name).slice(0, 48), { class: 'map-label', fill: layer.color, 'font-size': 10 }); labelCount++;
      }
    } else {
      const d = geometryPath(geometry, project); if (!d) continue;
      const isArea = geometry.type === 'Polygon' || geometry.type === 'MultiPolygon';
      let strokeWidth = layerId === 'roadsMain' ? 3.0 : layerId === 'roadsSecondary' ? 2.2 : layerId === 'roadsLocal' ? 1.2 : layerId === 'pedestrian' ? 1.5 : layerId === 'water' ? 2.4 : layerId === 'rail' ? 1.8 : 1.5;
      if (layerId === 'barriers') strokeWidth = 1.7;
      const fill = isArea && (layerId === 'green' || layerId === 'buildings') ? layer.color : 'none';
      const opacity = layerId === 'buildings' ? .45 : layerId === 'green' ? .32 : 1;
      const path = svgElement('path', {
        d, class: 'map-feature', fill, 'fill-opacity': opacity, 'fill-rule': 'evenodd',
        stroke: layer.color, 'stroke-width': strokeWidth,
        'stroke-dasharray': layerId === 'pedestrian' ? '3 3' : layerId === 'rail' || layerId === 'barriers' ? '6 4' : '',
        'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke', 'data-layer': layerId
      }, group);
      const title = svgElement('title', {}, path); title.textContent = `${props.name || props.highway || props.landuse || layer.label} · OpenStreetMap`;
    }
    rendered++;
  }
  state.visibleFeatureCount = rendered;
}

function addStudyPerimeter(group, project) {
  if (!state.perimeter || !state.layerVisibility.study) return;
  if (state.perimeter.type === 'circle') {
    const center = project(state.perimeter.center), radiusMeters = Number(state.perimeter.radiusMeters);
    if (!center || !Number.isFinite(radiusMeters)) return;
    const scale = state.currentProjection?.scale || 1;
    const radiusPx = radiusMeters * scale;
    svgElement('circle', { cx: center[0], cy: center[1], r: radiusPx, fill: '#e95337', 'fill-opacity': .12, stroke: '#d8432e', 'stroke-width': 3.2, 'stroke-dasharray': '10 5', 'vector-effect': 'non-scaling-stroke', 'data-layer': 'study' }, group);
    addText(group, center[0] + 8, center[1] - radiusPx - 8, `Périmètre d’étude · r ${Math.round(radiusMeters).toLocaleString('fr-FR')} m`, { class: 'map-label', fill: '#a9362b', 'font-size': 12, 'data-layer': 'study' });
    return;
  }
  const ring = perimeterCoordinates(state.perimeter);
  const d = geometryPath({ type: 'Polygon', coordinates: [ring] }, project);
  if (!d) return;
  svgElement('path', { d, fill: '#e95337', 'fill-opacity': .12, 'fill-rule': 'evenodd', stroke: '#d8432e', 'stroke-width': 3.2, 'stroke-dasharray': '10 5', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke', 'data-layer': 'study' }, group);
  const points = state.perimeter.coordinates || [];
  if (points.length) {
    const mid = points[Math.floor(points.length / 2)], p = project(mid);
    if (p) addText(group, p[0] + 7, p[1] - 7, 'Périmètre d’étude', { class: 'map-label', fill: '#a9362b', 'font-size': 12, 'data-layer': 'study' });
  }
  if (state.editPerimeter && !isSchematic()) {
    const coordinates = state.perimeter.coordinates || [];
    coordinates.forEach((position, index) => {
      const p = project(position); if (!p) return;
      svgElement('circle', { cx: p[0], cy: p[1], r: 7, fill: '#fff', stroke: '#bd3829', 'stroke-width': 2.4, class: 'shape-handle', 'data-shape-handle': 'true', 'data-index': index }, group);
    });
  }
}

function renderAnnotations(group, project, scope) {
  if (!state.layerVisibility.annotations) return;
  const defs = svgElement('defs', {}, group);
  for (const annotation of state.annotations) {
    const selected = annotation.id === state.selectedAnnotationId;
    const attrs = { fill: 'none', stroke: annotation.color, 'stroke-width': annotation.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke', 'data-ann-id': annotation.id };
    if (annotation.type === 'point' || annotation.type === 'text') {
      const p = project(annotation.position); if (!p) continue;
      const circle = svgElement('circle', { cx: p[0], cy: p[1], r: selected ? 6 : 5, fill: annotation.color, stroke: '#fff', 'stroke-width': 1.4, class: 'map-feature clickable', 'data-ann-id': annotation.id, 'data-layer': 'annotations' }, group);
      const title = svgElement('title', {}, circle); title.textContent = `${annotation.category || 'Annotation'}${annotation.text ? ` · ${annotation.text}` : ''}`;
      if (annotation.text) addText(group, p[0] + 8, p[1] - 7, annotation.text, { class: 'annotation-label', fill: annotation.color, 'font-size': 12, 'data-ann-id': annotation.id });
    } else {
      const geometry = annotation.type === 'zone' ? { type: 'Polygon', coordinates: [[...annotation.coordinates, annotation.coordinates[0]]] } : { type: 'LineString', coordinates: annotation.coordinates };
      const d = geometryPath(geometry, project); if (!d) continue;
      if (annotation.type === 'zone') { attrs.fill = annotation.color; attrs['fill-opacity'] = .12; attrs['fill-rule'] = 'evenodd'; }
      if (annotation.type === 'arrow') {
        const markerId = `arrowhead-${scope}-${annotation.id}`;
        const marker = svgElement('marker', { id: markerId, viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' }, defs);
        svgElement('path', { d: 'M0 0L10 5L0 10z', fill: annotation.color }, marker);
        attrs['marker-end'] = `url(#${markerId})`;
      }
      attrs.class = 'map-feature clickable';
      const shape = svgElement('path', attrs, group);
      const title = svgElement('title', {}, shape); title.textContent = `${annotation.category || 'Annotation'}${annotation.text ? ` · ${annotation.text}` : ''}`;
      if (annotation.text) {
        const center = annotation.coordinates[Math.floor(annotation.coordinates.length / 2)], p = project(center);
        if (p) addText(group, p[0] + 6, p[1] - 6, annotation.text, { class: 'annotation-label', fill: annotation.color, 'font-size': 12, 'data-ann-id': annotation.id });
      }
    }
    if (selected && state.annotationMoveMode) {
      const points = annotation.type === 'point' || annotation.type === 'text' ? [annotation.position] : annotation.coordinates;
      points.forEach((position, index) => {
        const p = project(position); if (!p) return;
        svgElement('circle', { cx: p[0], cy: p[1], r: 6, fill: '#fff', stroke: annotation.color, 'stroke-width': 2.2, class: 'annotation-handle', 'data-annotation-handle': 'true', 'data-id': annotation.id, 'data-index': index }, group);
      });
    }
  }
}

function niceScaleDistance(radius) {
  const target = Math.max(25, radius * .45);
  const choices = [25, 50, 100, 200, 250, 500, 750, 1000, 1500, 2000, 2500, 3000];
  return choices.filter(value => value <= target).at(-1) || 25;
}

function drawNorthAndScale(svg, rect, projection, scope) {
  const x = rect.x + rect.width - 38, y = rect.y + 36;
  const north = svgElement('g', { class: 'map-north', 'aria-label': 'Nord' }, svg);
  svgElement('path', { d: `M${x} ${y + 23}L${x} ${y - 5}M${x} ${y - 5}L${x - 7} ${y + 7}L${x} ${y + 3}L${x + 7} ${y + 7}Z`, fill: '#253f3b', stroke: '#253f3b', 'stroke-width': 1.7, 'stroke-linejoin': 'round' }, north);
  addText(north, x, y + 38, 'N', { 'text-anchor': 'middle', fill: '#253f3b', 'font-size': 13 });
  if (projection.schematic || !projection.available) {
    addText(svg, rect.x + rect.width - 152, rect.y + rect.height - 14, 'REPÉRAGE SCHÉMATIQUE · NON À L’ÉCHELLE', { 'text-anchor': 'end', fill: '#67766f', 'font-size': 10, 'font-weight': 800, 'letter-spacing': '.08em' });
    return;
  }
  const radius = Number(state.viewRadius) || 1000;
  const distance = niceScaleDistance(radius);
  const length = distance * projection.scale;
  const sx = rect.x + 22, sy = rect.y + rect.height - 22;
  const g = svgElement('g', { class: 'map-scale' }, svg);
  svgElement('line', { x1: sx, y1: sy, x2: sx + length, y2: sy, stroke: '#243e39', 'stroke-width': 4, 'stroke-linecap': 'square', 'vector-effect': 'non-scaling-stroke' }, g);
  svgElement('line', { x1: sx, y1: sy - 5, x2: sx, y2: sy + 5, stroke: '#243e39', 'stroke-width': 2 }, g);
  svgElement('line', { x1: sx + length, y1: sy - 5, x2: sx + length, y2: sy + 5, stroke: '#243e39', 'stroke-width': 2 }, g);
  addText(g, sx, sy - 8, `${formatDistance(distance)} · échelle graphique`, { fill: '#41574f', 'font-size': 10, 'font-weight': 700 });
  addText(svg, rect.x + rect.width - 14, rect.y + rect.height - 14, `1:${scaleDenominator(state.viewRadius, pageMapScaleWidthMm()).toLocaleString('fr-FR')}`, { 'text-anchor': 'end', fill: '#67766f', 'font-size': 10, 'font-weight': 700 });
}

function drawPreviewDraft(group, project) {
  const points = state.draftShape;
  if (state.drawTool === 'polygon' && points.length) {
    const path = geometryPath({ type: 'LineString', coordinates: [...points, ...(state.dragCurrent ? [state.dragCurrent] : [])] }, project);
    if (path) svgElement('path', { d: path, class: 'draw-preview', fill: 'none', stroke: '#da5a3b', 'stroke-width': 2.4, 'stroke-dasharray': '6 5', 'vector-effect': 'non-scaling-stroke' }, group);
    for (const point of points) { const p = project(point); if (p) svgElement('circle', { cx: p[0], cy: p[1], r: 4, fill: '#fff', stroke: '#d95135', 'stroke-width': 2, class: 'draw-preview' }, group); }
  } else if (state.isDragging && state.dragStart && state.dragCurrent && (state.drawTool === 'rectangle' || state.drawTool === 'circle')) {
    if (state.drawTool === 'rectangle') {
      const a = project(state.dragStart), b = project(state.dragCurrent); if (!a || !b) return;
      svgElement('rect', { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(b[0] - a[0]), height: Math.abs(b[1] - a[1]), class: 'draw-preview', fill: '#e95337', 'fill-opacity': .1, stroke: '#d8432e', 'stroke-width': 2.5, 'stroke-dasharray': '7 4' }, group);
    } else {
      const a = project(state.dragStart), b = project(state.dragCurrent); if (!a || !b) return;
      svgElement('circle', { cx: a[0], cy: a[1], r: Math.hypot(b[0] - a[0], b[1] - a[1]), class: 'draw-preview', fill: '#e95337', 'fill-opacity': .1, stroke: '#d8432e', 'stroke-width': 2.5, 'stroke-dasharray': '7 4' }, group);
    }
  }
}

function drawCenter(group, project) {
  if (isSchematic()) return;
  const p = project([state.center.lon, state.center.lat]); if (!p) return;
  svgElement('circle', { cx: p[0], cy: p[1], r: 8, fill: '#fff', stroke: '#204f49', 'stroke-width': 2.4, 'vector-effect': 'non-scaling-stroke' }, group);
  svgElement('path', { d: `M${p[0] - 13} ${p[1]}H${p[0] + 13}M${p[0]} ${p[1] - 13}V${p[1] + 13}`, stroke: '#204f49', 'stroke-width': 1.4, 'vector-effect': 'non-scaling-stroke' }, group);
  addText(group, p[0] + 11, p[1] + 19, 'Centre choisi', { class: 'map-label', fill: '#204f49', 'font-size': 10 });
}

function drawMapScene(svg, rect, { scope = 'preview', includeMeta = true } = {}) {
  const projection = makeProjection(rect);
  state.currentProjection = projection;
  const id = `clip-${scope}-${++state.renderId}`;
  const defs = svgElement('defs', {}, svg);
  const clip = svgElement('clipPath', { id }, defs);
  const viewCenterX = rect.x + rect.width / 2, viewCenterY = rect.y + rect.height / 2;
  if (projection.schematic) svgElement('rect', { x: rect.x, y: rect.y, width: rect.width, height: rect.height, rx: 2 }, clip);
  else svgElement('circle', { cx: viewCenterX, cy: viewCenterY, r: projection.scale * state.viewRadius }, clip);
  svgElement('rect', { x: rect.x, y: rect.y, width: rect.width, height: rect.height, fill: '#fbfcf9', stroke: '#cfd9d1', 'stroke-width': 1.2 }, svg);
  const group = svgElement('g', { 'clip-path': `url(#${id})` }, svg);
  if (projection.schematic && !projection.available) {
    addText(group, rect.x + rect.width / 2, rect.y + rect.height / 2 - 18, 'Chargez des limites GADM pour afficher le territoire.', { class: 'no-data-label', 'text-anchor': 'middle' });
    addText(group, rect.x + rect.width / 2, rect.y + rect.height / 2 + 12, 'Aucune limite administrative n’est fabriquée par UrbaTrame.', { class: 'no-data-label', 'text-anchor': 'middle', 'font-size': 13 });
  } else {
    if (!isSchematic()) renderTerrain(group, projection.project);
    renderAdministrative(group, projection.project);
    if (!isSchematic()) renderOsmFeatures(group, projection.project);
    if (state.localFeatures.length && state.layerVisibility.local) {
      for (const item of state.localFeatures.slice(0, MAX_RENDER_FEATURES)) {
        const path = geometryPath(item.geometry, projection.project);
        if (path) svgElement('path', { d: path, fill: item.geometry.type?.includes('Polygon') ? '#167e83' : 'none', 'fill-opacity': .11, stroke: '#167e83', 'stroke-width': 1.6, 'stroke-dasharray': '5 3', 'vector-effect': 'non-scaling-stroke', 'fill-rule': 'evenodd', 'data-layer': 'local' }, group);
        if (item.geometry.type === 'Point') {
          const p = projection.project(item.geometry.coordinates);
          if (p) svgElement('circle', { cx: p[0], cy: p[1], r: 4, fill: '#167e83', stroke: '#fff', 'stroke-width': 1, 'data-layer': 'local' }, group);
        }
      }
    }
    renderAnnotations(group, projection.project, scope);
    addStudyPerimeter(group, projection.project);
    drawCenter(group, projection.project);
    drawPreviewDraft(group, projection.project);
    if (state.annotationTool && state.annotationDraft.length) {
      const path = geometryPath({ type: 'LineString', coordinates: [...state.annotationDraft, ...(state.dragCurrent ? [state.dragCurrent] : [])] }, projection.project);
      if (path) svgElement('path', { d: path, fill: 'none', stroke: $('annotationColor').value || '#b24d3b', 'stroke-width': 2.2, 'stroke-dasharray': '6 4', class: 'draw-preview' }, group);
    }
    if (!state.osmFeatures.length && !state.adminCountry.length && !state.localFeatures.length && !state.perimeter && !isSchematic()) {
      addText(group, rect.x + rect.width / 2, rect.y + rect.height / 2, 'Dessinez un périmètre ou chargez des couches cartographiques.', { class: 'no-data-label', 'text-anchor': 'middle' });
    }
  }
  if (!projection.schematic && projection.available) {
    svgElement('circle', {
      cx: rect.x + rect.width / 2, cy: rect.y + rect.height / 2,
      r: projection.scale * state.viewRadius, fill: 'none', stroke: '#97a69d',
      'stroke-width': 1.1, 'stroke-dasharray': '5 5', 'vector-effect': 'non-scaling-stroke'
    }, svg);
  }
  drawNorthAndScale(svg, rect, projection, scope);
  if (includeMeta) {
    const subtitle = isSchematic() ? 'REPÉRAGE SCHÉMATIQUE' : `CENTRE ${formatCoordinate(state.center.lat, 5)}, ${formatCoordinate(state.center.lon, 5)} · RAYON VISIBLE ${formatDistance(state.viewRadius)}`;
    addText(svg, rect.x + 12, rect.y + 18, subtitle, { fill: '#62716a', 'font-size': 10, 'font-weight': 800, 'letter-spacing': '.08em' });
  }
  return projection;
}

function renderMap() {
  const svg = $('mapCanvas');
  if (!svg) return;
  svg.replaceChildren();
  const title = svgElement('title', { id: 'mapSvgTitle' }, svg); title.textContent = $('mapTitle').value || currentTitle();
  const desc = svgElement('desc', { id: 'mapSvgDesc' }, svg);
  desc.textContent = isSchematic() ? 'Carte de repérage administratif schématique.' : `Carte d’analyse limitée à ${MAX_STUDY_RADIUS_M} mètres du centre.`;
  drawMapScene(svg, { x: 22, y: 28, width: 1056, height: 664 }, { scope: 'preview' });
  const date = new Date(); setText('mapDate', date.toLocaleDateString('fr-FR'));
  setText('mapCoordinates', `${formatCoordinate(state.center.lat)}, ${formatCoordinate(state.center.lon)}`);
  setText('mapSources', sourceSummary());
  renderLegend();
  updateMapAlert();
}

function sourceSummary() {
  const sources = [];
  const dateOf = value => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleDateString('fr-FR') : 'date non précisée';
  if (state.adminCountry.length || state.adminWilayas.length) sources.push(`GADM ${state.gadmVersion} (gadm.org), chargé le ${dateOf(state.gadmLoadedAt)}`);
  if (state.osmFeatures.length) sources.push(`OpenStreetMap / Overpass · ODbL, chargé le ${dateOf(state.osmLoadedAt)}`);
  if (state.terrain) sources.push(`AWS Terrain Tiles · Terrarium, chargé le ${dateOf(state.osmLoadedAt)}`);
  if (state.localFeatures.length) sources.push('fichier local');
  const reference = $('sourceReference')?.value.trim();
  if (reference) sources.push(reference);
  return sources.length ? sources.join(' · ') : 'Sources non chargées';
}

function updateMapAlert() {
  if (isSchematic()) {
    if (!state.adminCountry.length && !state.adminWilayas.length) setMapAlert('Carte de repérage schématique. Chargez les limites GADM à l’aide du bouton dédié; aucune frontière n’est fabriquée.', 'info');
    else setMapAlert(state.level === 'wilaya-country'
      ? `Repérage schématique : ${state.selectedWilayaName || 'choisissez une wilaya'} dans le pays. Aperçu GADM généralisé, sans valeur cadastrale ou juridique.`
      : `Repérage schématique : ${state.selectedCommuneName || 'choisissez une unité'} dans la wilaya ${state.selectedWilayaName || 'sélectionnée'}. Pour l’analyse détaillée, passez au niveau 3 ou 4 et dessinez un contour de 3 000 m maximum.`);
    return;
  }
  const check = validatePerimeter(state.perimeter, state.center, { required: true });
  if (state.perimeter && !check.ok) setMapAlert(perimeterMessage(), 'error');
  else if (!state.perimeter) setMapAlert('Niveau détaillé : dessinez/importez un périmètre d’analyse inférieur ou égal à 3 000 m pour pouvoir enregistrer ce cadrage.', 'info');
  else if (check.stats.maxDistanceM > state.viewRadius + 1) setMapAlert(`Le contour reste conforme aux 3 000 m, mais une partie est hors de l’emprise visible (${formatDistance(state.viewRadius)}). Cliquez sur « Recentrer » ou augmentez le rayon visible avant l’export.`, 'info');
  else if (state.osmFeatures.length && state.osmRadius < state.viewRadius) setMapAlert(`Le périmètre est conforme; les données OSM chargées ne couvrent que ${formatDistance(state.osmRadius)} autour du centre, moins que l’emprise visible (${formatDistance(state.viewRadius)}). Rechargez les couches pour compléter la carte.`, 'info');
  else setMapAlert(`${perimeterMessage()} Données et annotations affichées selon les couches activées; vérifiez leur date et leur source.`, 'info');
}

function layerHasData(id) {
  if (id === 'country') return state.adminCountry.length > 0;
  if (id === 'wilaya') return state.adminWilayas.length > 0;
  if (id === 'commune') return state.adminCommunes.length > 0;
  if (id === 'study') return Boolean(state.perimeter);
  if (id === 'relief') return Boolean(state.terrain);
  if (id === 'local') return state.localFeatures.length > 0;
  if (id === 'annotations') return state.annotations.length > 0;
  return state.osmFeatures.some(feature => feature.properties?.layerId === id);
}

function renderLayerControls() {
  const root = $('layerControls'); if (!root) return;
  const fragment = document.createDocumentFragment();
  for (const layer of LAYERS) {
    const label = document.createElement('label'); label.className = 'layer-toggle';
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = state.layerVisibility[layer.id] !== false; input.dataset.layerId = layer.id;
    input.addEventListener('change', () => {
      state.layerVisibility[layer.id] = input.checked;
      renderAll();
    });
    const swatch = document.createElement('span'); swatch.className = 'layer-swatch'; swatch.style.background = layer.color;
    if (layer.line) { swatch.style.height = '3px'; swatch.style.border = '0'; swatch.style.borderRadius = '2px'; }
    const name = document.createElement('span'); name.textContent = layer.label;
    const source = document.createElement('span'); source.className = 'layer-source'; source.textContent = layer.source;
    label.append(input, swatch, name, source); fragment.append(label);
  }
  root.replaceChildren(fragment);
}

function renderLegend() {
  const root = $('mapLegend'); const fragment = document.createDocumentFragment();
  for (const layer of LAYERS) {
    if (!state.layerVisibility[layer.id] || !layerHasData(layer.id)) continue;
    const item = document.createElement('div'); item.className = 'legend-item';
    const mark = document.createElement('span'); mark.className = 'legend-mark'; mark.style.background = layer.color;
    if (layer.line) { mark.style.height = '3px'; mark.style.border = '0'; mark.style.borderRadius = '2px'; }
    const text = document.createElement('span'); text.textContent = layer.label;
    item.append(mark, text); fragment.append(item);
  }
  if (!fragment.childNodes.length) {
    const empty = document.createElement('div'); empty.className = 'legend-item'; empty.textContent = 'Aucune couche visible avec des données chargées.'; fragment.append(empty);
  }
  root.replaceChildren(fragment);
}

function renderAnnotationList() {
  const root = $('annotationList'); const fragment = document.createDocumentFragment();
  if (!state.annotations.length) {
    const note = document.createElement('p'); note.className = 'fine-status'; note.textContent = 'Aucune annotation.'; fragment.append(note);
  } else state.annotations.forEach((annotation, index) => {
    const row = document.createElement('div'); row.className = `annotation-row${annotation.id === state.selectedAnnotationId ? ' selected' : ''}`;
    const input = document.createElement('input'); input.type = 'radio'; input.name = 'selectedAnnotation'; input.checked = annotation.id === state.selectedAnnotationId;
    input.setAttribute('aria-label', `Sélectionner l’annotation ${index + 1}`); input.addEventListener('change', () => selectAnnotation(annotation.id));
    const dot = document.createElement('span'); dot.className = 'annotation-dot'; dot.style.background = annotation.color;
    const name = document.createElement('span'); name.className = 'annotation-name'; name.textContent = `${annotation.category || annotation.type}${annotation.text ? ` · ${annotation.text}` : ''}`;
    const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = 'Choisir'; edit.addEventListener('click', () => selectAnnotation(annotation.id));
    row.append(input, dot, name, edit); fragment.append(row);
  });
  root.replaceChildren(fragment);
  updateButtons();
}

function renderAll() {
  renderLayerControls(); renderAnnotationList(); renderMap(); updatePerimeterPanel();
}

function updateCenterFromUnitTitle() {
  updateTitle(); renderMap(); updateButtons();
}

function selectedRemoteDatasets() {
  return [...document.querySelectorAll('input[name="remoteLayer"]:checked')].map(input => input.value);
}

async function loadOsmAndRelief() {
  if (state.busy) return;
  const requestId = ++state.osmRequestId;
  const lat = Number(state.center.lat), lon = Number(state.center.lon);
  const radius = Math.min(MAX_STUDY_RADIUS_M, Math.max(200, Math.round(Number(state.viewRadius) || 500)));
  const include = selectedRemoteDatasets();
  if (!include.length) return setStatus('osmStatus', 'Cochez au moins un thème OSM avant de charger les données.', 'error');
  setBusy(true, 'Demande explicite des couches OSM / relief…', 'osm');
  setStatus('osmStatus', `Requête envoyée pour ${include.join(', ')} dans un rayon de ${formatDistance(radius)} autour du centre.`);
  try {
    const response = await fetch('/api/atelier/cadrage-extract', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ lat, lon, radius, include, terrain: $('loadRelief').checked, terrainN: 24 })
    });
    let payload;
    try { payload = await response.json(); } catch { throw new Error('MAP_DATA_UNAVAILABLE'); }
    if (requestId !== state.osmRequestId) return;
    if (!response.ok || !payload?.ok) {
      if (payload?.error === 'CADRAGE_RADIUS_OUT_OF_RANGE') throw new Error('CADRAGE_RADIUS_OUT_OF_RANGE');
      if (payload?.error === 'CADRAGE_DATA_LIMIT') throw new Error('CADRAGE_DATA_LIMIT');
      throw new Error(payload?.error || 'MAP_DATA_UNAVAILABLE');
    }
    state.osmFeatures = (payload.elements || []).map(osmElementToFeature).filter(Boolean);
    state.osmInclude = [...(payload.include || include)];
    state.osmRadius = Number(payload.radius) || radius;
    state.osmLoadedAt = payload.extractedAt || new Date().toISOString();
    state.terrain = payload.terrain || null;
    state.terrainSource = payload.source?.elevation || '';
    const warnings = Array.isArray(payload.warnings) ? payload.warnings : [];
    const visible = state.osmFeatures.length;
    let msg = `${visible.toLocaleString('fr-FR')} objets OSM convertis en couches visibles; rayon interrogé ${formatDistance(state.osmRadius)}. Source : © OpenStreetMap contributors, ODbL.`;
    if (warnings.includes('RELIEF_UNAVAILABLE') || $('loadRelief').checked && !state.terrain) msg += ' Relief indisponible; les autres couches restent disponibles.';
    if (!visible) msg += ' Aucune entité n’a été retournée dans cette emprise.';
    if (visible > MAX_RENDER_FEATURES) msg += ` Carte surchargée : l’aperçu ne dessine que ${MAX_RENDER_FEATURES.toLocaleString('fr-FR')} objets; masquez des couches ou réduisez le rayon.`;
    setStatus('osmStatus', msg, visible ? 'success' : 'error');
    renderAll();
  } catch (error) {
    if (requestId !== state.osmRequestId) return;
    setStatus('osmStatus', `Données cartographiques indisponibles : ${friendlyError(error)}. Réduisez le rayon ou désactivez des couches, puis réessayez.`, 'error');
    setMapAlert(`La requête OSM/relief n’a pas abouti : ${friendlyError(error)}. Aucune limite n’a été créée.`, 'error');
  } finally {
    if (requestId === state.osmRequestId) setBusy(false);
  }
}

function polygonRingFromFeature(feature) {
  const geometry = feature?.geometry;
  if (!geometry) return null;
  if (geometry.type === 'Polygon' && Array.isArray(geometry.coordinates?.[0])) return geometry.coordinates[0];
  if (geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates?.[0]?.[0])) return geometry.coordinates[0][0];
  return null;
}

function updateBoundaryFeatureOptions({ selectFirst = false } = {}) {
  const polygonIndexes = state.localFeatures.map((feature, index) => polygonRingFromFeature(feature) ? index : -1).filter(index => index >= 0);
  const select = $('boundaryFeatureSelect');
  select.replaceChildren();
  const availableIndexes = polygonIndexes.slice(0, 1000);
  const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = polygonIndexes.length > 1000
    ? 'Choisir parmi les 1 000 premiers contours' : polygonIndexes.length ? 'Choisir un contour polygonal' : 'Aucun polygone dans le fichier'; select.append(placeholder);
  availableIndexes.forEach(index => {
    const feature = state.localFeatures[index]; const option = document.createElement('option'); option.value = String(index);
    option.textContent = `${feature.layerName} · ${String(feature.properties.name || feature.properties.NAME || feature.properties.id || `entité ${index + 1}`).slice(0, 100)}`; select.append(option);
  });
  select.disabled = !polygonIndexes.length; $('useBoundary').disabled = !polygonIndexes.length;
  if (selectFirst && polygonIndexes.length) select.value = String(polygonIndexes[0]);
  return polygonIndexes;
}

async function importLocalLayer(event) {
  const file = event.target.files?.[0]; if (!file) return;
  event.target.value = '';
  if (state.busy) return setStatus('perimeterStatus', 'Attendez la fin de l’opération en cours avant de lire un autre fichier.', 'error');
  if (file.size > MAX_LOCAL_IMPORT_BYTES) return setStatus('perimeterStatus', 'Fichier supérieur à 15 Mo. Choisissez un fichier plus léger.', 'error');
  setBusy(true, 'Lecture du fichier local…', 'local');
  try {
    let layers;
    if (/\.gpkg$/i.test(file.name)) {
      const SQL = await loadSqlRuntime();
      const parsed = parseGeoPackage(await file.arrayBuffer(), SQL, { fileName: file.name });
      layers = parsed.map(layer => ({ name: layer.name, features: layer.geojson.features, sourceCrs: layer.sourceCrs }));
    } else {
      const parsed = parseGeoJSONText(await file.text(), { fileName: file.name, maxFeatures: 20_000 });
      layers = [{ name: parsed.name || file.name, features: parsed.features, sourceCrs: parsed.sourceCrs || 'EPSG:4326' }];
    }
    const total = layers.reduce((sum, layer) => sum + layer.features.length, 0);
    if (total > 20_000) throw new Error('TOO_MANY_FEATURES');
    state.localFeatureLabel = file.name;
    state.localFeatures = layers.flatMap(layer => layer.features.map((feature, index) => ({
      id: `${layer.name}-${index + 1}`, layerName: layer.name, geometry: feature.geometry,
      properties: { ...(feature.properties || {}) }
    })));
    const polygonCount = updateBoundaryFeatureOptions({ selectFirst: true }).length;
    let importMessage = `${total.toLocaleString('fr-FR')} entités chargées localement depuis ${file.name}. CRS source : ${layers.map(layer => layer.sourceCrs).filter(Boolean).join(', ') || 'EPSG:4326'}. Sélectionnez un contour et vérifiez la limite de 3 000 m.`;
    if (total > MAX_RENDER_FEATURES) importMessage += ` L’aperçu sera limité à ${MAX_RENDER_FEATURES.toLocaleString('fr-FR')} entités.`;
    if (polygonCount > 1000) importMessage += ' La liste de contours présente les 1 000 premiers polygones.';
    setStatus('perimeterStatus', importMessage, 'success');
    renderAll();
  } catch (error) {
    state.localFeatures = []; state.localFeatureLabel = '';
    setStatus('perimeterStatus', `Import local impossible : ${friendlyError(error)}. Vérifiez le format, le CRS et la taille du fichier.`, 'error');
  } finally { setBusy(false); }
}

function useImportedBoundary() {
  const index = Number($('boundaryFeatureSelect').value);
  const feature = state.localFeatures[index];
  const ring = polygonRingFromFeature(feature);
  if (!ring) return setStatus('perimeterStatus', 'Choisissez un polygone valide dans la couche importée.', 'error');
  setNewPerimeter({ type: 'polygon', coordinates: ring });
}

function copyLocalSnapshot() {
  if (!state.localFeatures.length) return null;
  const features = state.localFeatures.map(item => ({ type: 'Feature', properties: { ...item.properties, _layerName: item.layerName }, geometry: item.geometry }));
  const snapshot = { type: 'FeatureCollection', features };
  try { if (JSON.stringify(snapshot).length <= 1_300_000) return snapshot; }
  catch { /* fall through */ }
  return null;
}

function currentRecord() {
  const existing = state.records.find(item => item.id === state.currentRecordId);
  const now = Date.now();
  const record = {
    type: 'urbatrame-spatial-framing', version: CADRAGE_PROJECT_VERSION,
    id: existing?.id || `cadrage-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: $('projectName').value.trim() || 'Cadrage sans titre', createdAt: existing?.createdAt || now, updatedAt: now,
    level: state.level, center: { ...state.center }, projectName: $('projectName').value.trim(), studyName: $('projectName').value.trim(),
    countryCode: state.countryCode, wilayaGid: state.selectedWilayaGid, wilayaName: state.selectedWilayaName,
    communeGid: state.selectedCommuneGid, communeName: state.selectedCommuneName,
    perimeter: state.perimeter ? structuredCloneSafe(state.perimeter) : null,
    layerVisibility: { ...state.layerVisibility }, annotations: state.annotations.map(item => structuredCloneSafe(item)),
    viewRadius: Math.min(MAX_STUDY_RADIUS_M, Math.max(MIN_VIEW_RADIUS_M, state.viewRadius)),
    scaleDenominator: isSchematic() ? 0 : Number($('mapScale').value) || scaleDenominator(state.viewRadius, pageMapScaleWidthMm()),
    layout: { pageSize: $('pageSize').value, orientation: $('orientation').value, dpi: 150 },
    title: $('mapTitle').value.trim() || currentTitle(), comments: $('mapComments').value.trim(),
    sourceAttribution: $('sourceReference').value.trim() || 'Sources à vérifier : GADM 4.1 et OpenStreetMap / ODbL si utilisés',
    localSnapshot: copyLocalSnapshot()
  };
  return normalizeFramingRecord(record, { requirePerimeter: !isSchematic(), now });
}

function structuredCloneSafe(value) {
  try { return JSON.parse(JSON.stringify(value)); } catch { return value; }
}

function readStoredRecords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const normalized = normalizeFramingProject({ type: CADRAGE_PROJECT_TYPE, version: CADRAGE_PROJECT_VERSION, exportedAt: Date.now(), cadrages: parsed.cadrages || parsed });
    return normalized?.cadrages || [];
  } catch { return []; }
}

function persistRecords() {
  const payload = { type: CADRAGE_PROJECT_TYPE, version: CADRAGE_PROJECT_VERSION, exportedAt: Date.now(), cadrages: state.records };
  const text = JSON.stringify(payload);
  if (text.length > MAX_CADRAGE_PROJECT_BYTES) throw new Error('PROJECT_TOO_LARGE');
  localStorage.setItem(STORAGE_KEY, text);
}

function renderSavedFramings() {
  const select = $('savedFramings'), fragment = document.createDocumentFragment();
  const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = state.records.length ? 'Choisir un cadrage enregistré' : 'Aucun cadrage enregistré'; fragment.append(placeholder);
  for (const record of [...state.records].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const option = document.createElement('option'); option.value = record.id;
    option.textContent = `${record.name} · ${new Date(record.updatedAt).toLocaleDateString('fr-FR')} · ${LEVELS.find(level => level.id === record.level)?.label || record.level}`;
    fragment.append(option);
  }
  select.replaceChildren(fragment);
  select.value = state.currentRecordId || '';
  $('deleteFraming').disabled = !state.records.some(item => item.id === state.currentRecordId);
}

function loadRecord(record) {
  if (!record) return;
  if (state.busy) return setStatus('saveStatus', 'Attendez la fin du chargement en cours avant d’ouvrir un autre cadrage.', 'error');
  state.adminRequestId++;
  if (state.busyKind === 'gadm') setBusy(false);
  state.currentRecordId = record.id;
  state.level = record.level;
  state.center = { ...record.center };
  state.viewRadius = record.viewRadius;
  state.perimeter = record.perimeter ? structuredCloneSafe(record.perimeter) : null;
  state.annotations = record.annotations.map(item => structuredCloneSafe(item));
  state.selectedAnnotationId = '';
  state.layerVisibility = { ...record.layerVisibility };
  state.countryCode = record.countryCode || 'DZA';
  state.selectedWilayaGid = record.wilayaGid || ''; state.selectedWilayaName = record.wilayaName || '';
  state.selectedCommuneGid = record.communeGid || ''; state.selectedCommuneName = record.communeName || '';
  state.adminCountry = []; state.adminWilayas = []; state.adminCommunes = []; state.gadmLoadedAt = '';
  fillSelect($('wilayaSelect'), [], 1, '', 'Rechargez les limites GADM');
  fillSelect($('communeSelect'), [], 2, '', 'Sélectionnez une wilaya');
  invalidateRemoteLayers('Couches OSM/relief non incluses dans la sauvegarde; rechargez-les explicitement après avoir vérifié le centre.');
  state.localFeatures = []; state.localFeatureLabel = '';
  if (record.localSnapshot) {
    try {
      const parsed = parseGeoJSONText(JSON.stringify(record.localSnapshot), { fileName: 'couche-locale-du-cadrage.geojson', maxFeatures: 5000 });
      state.localFeatures = parsed.features.map((feature, index) => ({ id: `restored-${index + 1}`, layerName: String(feature.properties?._layerName || 'Couche locale'), geometry: feature.geometry, properties: feature.properties || {} }));
      state.localFeatureLabel = 'couche locale enregistrée';
    } catch { state.localFeatures = []; }
  }
  updateBoundaryFeatureOptions();
  $('countryCode').value = state.countryCode;
  $('projectName').value = record.projectName || record.name;
  $('mapTitle').value = record.title; state.currentTitleManual = true;
  $('mapComments').value = record.comments || '';
  $('sourceReference').value = record.sourceAttribution || '';
  $('pageSize').value = record.layout.pageSize; $('orientation').value = record.layout.orientation;
  $('mapScale').value = record.scaleDenominator ? String(record.scaleDenominator) : String(scaleDenominator(state.viewRadius, pageMapScaleWidthMm()));
  $('viewRadius').value = String(state.viewRadius);
  $('centerLat').value = String(state.center.lat); $('centerLon').value = String(state.center.lon); $('centerName').value = state.center.name;
  $('circleRadius').value = String(record.perimeter?.type === 'circle' ? record.perimeter.radiusMeters : 500);
  setText('circleRadiusOut', `${$('circleRadius').value} m`);
  setStatus('adminStatus', 'Cadrage chargé. Les limites GADM ne sont pas enregistrées; rechargez-les si vous souhaitez les afficher.');
  setStatus('osmStatus', 'Les couches OSM/relief ne sont pas sauvegardées. Rechargez-les explicitement si nécessaire.');
  document.querySelectorAll('input[name="level"]').forEach(input => { input.checked = input.value === state.level; });
  state.currentTitleManual = true;
  updateTitle(); renderSavedFramings(); updateButtons(); renderAll();
  setStatus('saveStatus', `Cadrage « ${record.name} » ouvert depuis le stockage local. Les données distantes n’ont pas été rechargées.`, 'success');
}

function saveCurrentFraming() {
  const record = currentRecord();
  if (!record) {
    const code = validatePerimeter(state.perimeter, state.center, { required: !isSchematic() }).code;
    const message = code === 'PERIMETER_REQUIRED' ? 'Dessinez ou importez d’abord un périmètre valide; la sauvegarde est bloquée.'
      : code === 'PERIMETER_TOO_LARGE' ? 'Sauvegarde bloquée : le périmètre dépasse 3 000 m du centre.'
        : 'Le cadrage n’est pas valide. Vérifiez le centre, l’échelle et les sommets.';
    setStatus('saveStatus', message, 'error'); return;
  }
  const index = state.records.findIndex(item => item.id === record.id);
  if (index < 0 && state.records.length >= MAX_CADRAGES) return setStatus('saveStatus', `Limite de ${MAX_CADRAGES} cadrages par navigateur atteinte. Supprimez-en un ou exportez le projet JSON.`, 'error');
  const previous = index >= 0 ? state.records[index] : null;
  if (index >= 0) state.records.splice(index, 1, record); else state.records.push(record);
  try {
    persistRecords(); state.currentRecordId = record.id; renderSavedFramings();
    setStatus('saveStatus', `Cadrage « ${record.name} » enregistré localement. Les couches OSM/relief devront être rechargées après fermeture; le contour et les annotations sont conservés.`, 'success');
    if (state.localFeatures.length && !record.localSnapshot) toast('Cadrage enregistré sans la couche locale (fichier trop volumineux pour le stockage navigateur). Exportez un GeoJSON séparé pour la conserver.', 'error');
    else toast('Cadrage enregistré sur cet appareil.');
  } catch (error) {
    if (index >= 0) state.records.splice(index, 1, previous); else state.records = state.records.filter(item => item.id !== record.id);
    setStatus('saveStatus', 'Stockage local plein ou indisponible. Exportez les cadrages en JSON, puis libérez de l’espace navigateur.', 'error');
  }
}

function deleteCurrentFraming() {
  const record = state.records.find(item => item.id === state.currentRecordId);
  if (!record) return;
  state.records = state.records.filter(item => item.id !== record.id);
  state.currentRecordId = '';
  try { persistRecords(); setStatus('saveStatus', `Cadrage « ${record.name} » supprimé du navigateur.`, 'success'); }
  catch { setStatus('saveStatus', 'Impossible de mettre à jour le stockage local.', 'error'); }
  renderSavedFramings(); updateButtons();
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = fileName; link.style.display = 'none';
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function safeFileName(value) {
  return String(value || 'cadrage-urbatrame').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'cadrage-urbatrame';
}

function buildPrintSvg() {
  const priorProjection = state.currentProjection;
  const priorFeatureCount = state.visibleFeatureCount;
  const [pageW, pageH] = pageDimensionsMm();
  const viewW = 1200, viewH = Math.round(viewW * pageH / pageW);
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('xmlns', NS); svg.setAttribute('viewBox', `0 0 ${viewW} ${viewH}`);
  svg.setAttribute('width', `${pageW}mm`); svg.setAttribute('height', `${pageH}mm`);
  svg.setAttribute('role', 'img'); svg.setAttribute('aria-labelledby', 'exportTitle exportDescription');
  svgElement('rect', { x: 0, y: 0, width: viewW, height: viewH, fill: '#fff' }, svg);
  const margin = 42, headerH = 120, footerH = 52, legendW = Math.round(viewW * 0.205), gap = 20;
  const contentY = margin + headerH, contentH = viewH - contentY - footerH - margin;
  const mapW = viewW - margin * 2 - legendW - gap, mapH = contentH;
  const mapRect = { x: margin, y: contentY, width: mapW, height: mapH };
  const title = svgElement('title', { id: 'exportTitle' }, svg); title.textContent = $('mapTitle').value.trim() || currentTitle();
  const description = svgElement('desc', { id: 'exportDescription' }, svg); description.textContent = isSchematic() ? 'Plan de repérage schématique, données administratives indicatives.' : `Cadrage spatial, rayon visible ${formatDistance(state.viewRadius)}, périmètre d’analyse limité à 3 000 mètres.`;
  svgElement('rect', { x: margin, y: margin, width: viewW - margin * 2, height: 1.4, fill: '#1e5d54' }, svg);
  addText(svg, margin, margin + 38, 'URBATRAME · ANALYSE DES SITES URBAINS', { fill: '#3e6358', 'font-size': 17, 'font-weight': 800, 'letter-spacing': 1.4 });
  addText(svg, margin, margin + 80, $('mapTitle').value.trim() || currentTitle(), { fill: '#1c3f3b', 'font-size': 27, 'font-weight': 800 });
  addText(svg, margin, margin + 105, `${$('projectName').value.trim() || 'Cadrage spatial'} · ${currentLevel().label} · ${new Date().toLocaleDateString('fr-FR')}`, { fill: '#67766f', 'font-size': 13 });
  drawMapScene(svg, mapRect, { scope: 'export', includeMeta: false });
  const legendX = margin + mapW + gap, legendY = contentY, legendH = contentH;
  svgElement('rect', { x: legendX, y: legendY, width: legendW, height: legendH, rx: 8, fill: '#fbfcfa', stroke: '#d8e0da', 'stroke-width': 1.1 }, svg);
  addText(svg, legendX + 16, legendY + 27, 'LÉGENDE', { fill: '#50665d', 'font-size': 13, 'font-weight': 800, 'letter-spacing': 1.1 });
  let y = legendY + 53;
  let legendCount = 0;
  for (const layer of LAYERS) {
    if (!state.layerVisibility[layer.id] || !layerHasData(layer.id)) continue;
    if (y > legendY + legendH - 65) break;
    svgElement('rect', { x: legendX + 16, y: y - 10, width: 12, height: layer.line ? 3 : 12, rx: 2, fill: layer.color, stroke: layer.line ? 'none' : '#d0d6d1' }, svg);
    addText(svg, legendX + 38, y, layer.label, { fill: '#51645c', 'font-size': 11 });
    y += 26; legendCount++;
  }
  if (!legendCount) addText(svg, legendX + 16, y, 'Aucune couche chargée', { fill: '#75827b', 'font-size': 11 });
  y += 18;
  if (y < legendY + legendH - 92) {
    svgElement('line', { x1: legendX + 14, y1: y, x2: legendX + legendW - 14, y2: y, stroke: '#e0e6e1' }, svg); y += 20;
    addText(svg, legendX + 16, y, isSchematic() ? 'Échelle : schématique, non métrique' : `Échelle numérique estimative : 1:${scaleDenominator(state.viewRadius, pageMapScaleWidthMm()).toLocaleString('fr-FR')}`, { fill: '#51645c', 'font-size': 10, 'font-weight': 700 }); y += 20;
    addText(svg, legendX + 16, y, `Centre : ${formatCoordinate(state.center.lat, 5)}, ${formatCoordinate(state.center.lon, 5)}`, { fill: '#607168', 'font-size': 10 }); y += 19;
    addText(svg, legendX + 16, y, 'CRS : EPSG:4326 · WGS 84', { fill: '#607168', 'font-size': 10 }); y += 19;
    addText(svg, legendX + 16, y, `Mise en page : ${$('pageSize').value} · ${$('orientation').value === 'landscape' ? 'paysage' : 'portrait'}`, { fill: '#607168', 'font-size': 10 });
  }
  const footerY = viewH - margin - footerH + 17;
  svgElement('line', { x1: margin, y1: footerY - 12, x2: viewW - margin, y2: footerY - 12, stroke: '#dae2dc', 'stroke-width': 1 }, svg);
  const sources = sourceSummary().slice(0, 210);
  const usesGadm = state.adminCountry.length || state.adminWilayas.length;
  const sourceNote = usesGadm ? ` GADM ${state.gadmVersion} : limites administratives indicatives, non cadastrales.` : '';
  addText(svg, margin, footerY + 6, `Sources : ${sources}.${sourceNote}`, { fill: '#54675f', 'font-size': 10 });
  const credits = [];
  if (state.osmFeatures.length) credits.push('© OpenStreetMap contributors · ODbL');
  if (usesGadm) credits.push(`GADM ${state.gadmVersion} · gadm.org`);
  if (state.terrain) credits.push('AWS Terrain Tiles · Terrarium');
  credits.push('UrbaTrame · Designed by M.SADI');
  addText(svg, margin, footerY + 25, credits.join(' · '), { fill: '#697871', 'font-size': 9 });
  if ($('mapComments').value.trim()) {
    const comment = $('mapComments').value.trim().slice(0, 180);
    addText(svg, viewW - margin, footerY + 6, comment, { fill: '#54675f', 'font-size': 9, 'text-anchor': 'end' });
  }
  state.currentProjection = priorProjection;
  state.visibleFeatureCount = priorFeatureCount;
  return svg;
}

function serializeSvg(svg) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}`;
}

function exportSvg() {
  const svg = buildPrintSvg();
  downloadBlob(new Blob([serializeSvg(svg)], { type: 'image/svg+xml;charset=utf-8' }), `${safeFileName($('projectName').value)}.svg`);
  toast('Plan SVG exporté.');
}

async function exportRaster(format) {
  const svg = buildPrintSvg();
  const [widthMm, heightMm] = pageDimensionsMm();
  const dpi = Number($('pageDpi')?.value) || 150;
  const scale = dpi / 25.4;
  const width = Math.round(widthMm * scale), height = Math.round(heightMm * scale);
  if (width * height > 36_000_000) return toast('Image trop grande pour le navigateur. Choisissez un format plus petit ou SVG.', 'error');
  const source = new Blob([serializeSvg(svg)], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(source);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('SVG_RENDER_FAILED')); image.src = url; });
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('CANVAS_UNAVAILABLE');
    context.fillStyle = '#fff'; context.fillRect(0, 0, width, height); context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('IMAGE_EXPORT_FAILED')), format === 'jpeg' ? 'image/jpeg' : 'image/png', .93));
    downloadBlob(blob, `${safeFileName($('projectName').value)}.${format === 'jpeg' ? 'jpg' : 'png'}`);
    toast(`${format.toUpperCase()} exporté (${width} × ${height} px).`);
  } catch (error) { toast(`Export ${format.toUpperCase()} impossible : ${friendlyError(error)}. Essayez SVG ou PDF.`, 'error'); }
  finally { URL.revokeObjectURL(url); }
}

function openPrintDialog() {
  const svgMarkup = serializeSvg(buildPrintSvg());
  const parsed = new DOMParser().parseFromString(svgMarkup, 'image/svg+xml').documentElement;
  const svg = document.importNode(parsed, true);
  const container = document.createElement('div'); container.className = 'print-document'; container.append(svg);
  $('printLayout').replaceChildren(container);
  const [w, h] = pageDimensionsMm();
  const size = $('pageSize').value, orientation = w > h ? 'landscape' : 'portrait';
  let printStyle = $('dynamicPageStyle');
  if (!printStyle) { printStyle = document.createElement('style'); printStyle.id = 'dynamicPageStyle'; document.head.append(printStyle); }
  printStyle.textContent = `@media print { @page { size: ${size} ${orientation}; margin: 0; } }`;
  $('printLayout').setAttribute('aria-hidden', 'false');
  const cleanup = () => { $('printLayout').replaceChildren(); $('printLayout').setAttribute('aria-hidden', 'true'); window.removeEventListener('afterprint', cleanup); };
  window.addEventListener('afterprint', cleanup, { once: true });
  window.print();
}

function exportProjectFile() {
  const current = currentRecord();
  if (current) {
    const index = state.records.findIndex(item => item.id === current.id);
    if (index >= 0) state.records.splice(index, 1, current);
    else if (state.records.length < MAX_CADRAGES) state.records.push(current);
  }
  const text = serializeFramingProject(state.records);
  downloadBlob(new Blob([text], { type: 'application/json;charset=utf-8' }), `${safeFileName($('projectName').value)}-cadrages.json`);
  setStatus('saveStatus', 'Projet JSON exporté. Le fichier peut contenir les contours, annotations et, si la taille le permet, la couche locale importée; il ne contient pas les couches OSM/GADM téléchargées.', 'success');
}

async function importProjectFile(event) {
  const file = event.target.files?.[0]; event.target.value = '';
  if (!file) return;
  if (file.size > 15 * 1024 * 1024) return setStatus('saveStatus', 'Fichier JSON supérieur à 15 Mo. Import impossible.', 'error');
  try {
    const project = parseFramingProject(await file.text());
    if (!project) throw new Error('PROJECT_INVALID');
    const byId = new Map(state.records.map(record => [record.id, record]));
    for (const record of project.cadrages) byId.set(record.id, record);
    const merged = [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    if (merged.length > MAX_CADRAGES) throw new Error('PROJECT_TOO_MANY_RECORDS');
    state.records = merged;
    persistRecords(); renderSavedFramings();
    if (project.cadrages[0]) loadRecord(project.cadrages[0]);
    setStatus('saveStatus', `${project.cadrages.length} cadrage${project.cadrages.length > 1 ? 's' : ''} importé${project.cadrages.length > 1 ? 's' : ''} depuis le fichier. Les appels externes n’ont pas été lancés.`, 'success');
  } catch (error) {
    const message = error.message === 'PROJECT_TOO_MANY_RECORDS' ? `Le projet dépasserait la limite locale de ${MAX_CADRAGES} cadrages.` : 'Projet invalide, incomplet ou incompatible. Aucune donnée n’a été importée.';
    setStatus('saveStatus', message, 'error');
  }
}

function deleteFromProjectSelect() {
  const id = $('savedFramings').value;
  const record = state.records.find(item => item.id === id);
  if (record) { state.currentRecordId = record.id; deleteCurrentFraming(); }
}

function updateProjectName() {
  if (!state.currentTitleManual) updateTitle();
}

function hookEvents() {
  $('searchForm').addEventListener('submit', searchPlace);
  $('applyCenter').addEventListener('click', applyCoordinatesFromFields);
  $('loadAdmin').addEventListener('click', loadAdministrative);
  $('wilayaSelect').addEventListener('change', onWilayaChange);
  $('communeSelect').addEventListener('change', onCommuneChange);
  $('centerOnUnit').addEventListener('click', centerOnSelectedUnit);
  $('countryCode').addEventListener('change', onCountryChange);
  document.querySelectorAll('input[name="level"]').forEach(input => input.addEventListener('change', () => setLevel(input.value)));
  document.querySelectorAll('[data-draw]').forEach(button => button.addEventListener('click', () => startShape(button.dataset.draw)));
  $('finishShape').addEventListener('click', finishShape);
  $('cancelShape').addEventListener('click', cancelCurrentTool);
  $('clearShape').addEventListener('click', clearShape);
  $('editShape').addEventListener('click', toggleEditPerimeter);
  $('circleRadius').addEventListener('input', circleRadiusChanged);
  $('loadOsm').addEventListener('click', loadOsmAndRelief);
  $('importBoundary').addEventListener('change', importLocalLayer);
  $('useBoundary').addEventListener('click', useImportedBoundary);
  $('startAnnotation').addEventListener('click', startAnnotation);
  $('finishAnnotation').addEventListener('click', finishAnnotation);
  $('updateAnnotation').addEventListener('click', updateSelectedAnnotationProperties);
  $('moveAnnotation').addEventListener('click', toggleMoveAnnotation);
  $('deleteAnnotation').addEventListener('click', removeSelectedAnnotation);
  $('projectName').addEventListener('input', updateProjectName);
  $('mapTitle').addEventListener('input', () => { state.currentTitleManual = true; setText('previewTitle', $('mapTitle').value); renderMap(); });
  $('sourceReference').addEventListener('input', renderMap);
  $('pageSize').addEventListener('change', () => updateScaleControls({ from: 'radius' }));
  $('orientation').addEventListener('change', () => updateScaleControls({ from: 'radius' }));
  $('mapScale').addEventListener('change', () => updateScaleControls({ from: 'scale' }));
  $('viewRadius').addEventListener('change', () => updateScaleControls({ from: 'radius' }));
  $('savedFramings').addEventListener('change', () => {
    const record = state.records.find(item => item.id === $('savedFramings').value);
    if (record) loadRecord(record);
  });
  $('saveFraming').addEventListener('click', saveCurrentFraming);
  $('deleteFraming').addEventListener('click', deleteFromProjectSelect);
  $('exportProject').addEventListener('click', exportProjectFile);
  $('importProject').addEventListener('change', importProjectFile);
  $('exportSvg').addEventListener('click', exportSvg);
  $('exportPng').addEventListener('click', () => exportRaster('png'));
  $('exportJpeg').addEventListener('click', () => exportRaster('jpeg'));
  $('printMap').addEventListener('click', openPrintDialog);
  $('fitMap').addEventListener('click', () => {
    if (!isSchematic() && state.perimeter) {
      const stats = perimeterStats(state.perimeter, state.center);
      state.viewRadius = Math.min(MAX_STUDY_RADIUS_M, Math.max(100, Math.ceil(stats.maxDistanceM * 1.18 / 50) * 50));
      $('viewRadius').value = String(state.viewRadius); $('mapScale').value = String(scaleDenominator(state.viewRadius, pageMapScaleWidthMm()));
    }
    renderAll();
  });
  $('resetMap').addEventListener('click', () => { if (!isSchematic()) { state.viewRadius = currentLevel().defaultRadius; $('viewRadius').value = String(state.viewRadius); $('mapScale').value = String(scaleDenominator(state.viewRadius, pageMapScaleWidthMm())); } renderAll(); });
  $('cancelTool').addEventListener('click', cancelCurrentTool);
  const map = $('mapCanvas');
  map.addEventListener('pointerdown', pointerDown);
  map.addEventListener('pointermove', pointerMove);
  map.addEventListener('pointerup', pointerUp);
  map.addEventListener('pointercancel', pointerUp);
  map.addEventListener('click', handleMapClick);
  map.addEventListener('dblclick', event => { if (state.drawTool === 'polygon') { event.preventDefault(); finishShape(); } });
}

function initialize() {
  syncCenterInputs();
  state.records = readStoredRecords();
  renderSavedFramings();
  $('mapTitle').value = currentTitle();
  $('mapDate').textContent = new Date().toLocaleDateString('fr-FR');
  $('circleRadius').value = '500'; setText('circleRadiusOut', '500 m');
  $('viewRadius').value = String(state.viewRadius);
  $('mapScale').value = String(scaleDenominator(state.viewRadius, pageMapScaleWidthMm()));
  hookEvents();
  void populateCountrySelect(); // fichier statique local; aucun service externe n'est contacté.
  updateScaleControls({ from: 'radius' });
  setLevel('wilaya-country');
  if (state.records.length) setStatus('saveStatus', `${state.records.length} cadrage${state.records.length > 1 ? 's' : ''} disponible${state.records.length > 1 ? 's' : ''} dans le stockage local de cet appareil.`, 'success');
  renderAll();
  updateButtons();
}

initialize();
