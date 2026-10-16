import {
  freeModelsFromCatalog,
  lonLatToMercator,
  mercatorToLonLat,
  parseAiJson,
  solveAffineTransform,
  transformPixel,
  validateAiSynthesis
} from './s5-core.mjs';

const $ = id => document.getElementById(id);
const state = {
  maps: {
    old: { file: null, image: null, objectUrl: null },
    current: { file: null, image: null, objectUrl: null }
  },
  points: [],
  transforms: { old: null, current: null },
  observations: [],
  aiSummary: '',
  aiProvenance: null,
  aiModels: new Map(),
  pendingPick: null,
  placingMarker: false,
  movingObservationId: null,
  viewport: null,
  resizeObserver: null
};

const elements = {
  controlPoints: $('controlPoints'),
  addControlPoint: $('addControlPoint'),
  georefStatus: $('georefStatus'),
  residualList: $('residualList'),
  oldPreview: $('oldPreview'),
  currentPreview: $('currentPreview'),
  oldPreviewImage: $('oldPreviewImage'),
  currentPreviewImage: $('currentPreviewImage'),
  canvas: $('comparisonCanvas'),
  canvasPlaceholder: $('canvasPlaceholder'),
  quality: $('overlayQuality'),
  slider: $('comparisonSlider'),
  sliderLabel: $('sliderLabel'),
  sliderValue: $('sliderValue'),
  mode: $('comparisonMode'),
  exportPng: $('exportMapPng'),
  exportJson: $('exportProjectJson'),
  addManual: $('addManualObservation'),
  manualLabel: $('manualLabel'),
  manualCategory: $('manualCategory'),
  annotationStatus: $('annotationStatus'),
  observationsList: $('observationsList'),
  aiSummary: $('aiSummary'),
  groupSynthesis: $('groupSynthesisText'),
  applyAiDraft: $('applyAiDraft'),
  synthesisConfirmed: $('synthesisConfirmed'),
  provider: $('aiProvider'),
  customEndpoint: $('customEndpoint'),
  customModel: $('customModel'),
  customEndpointField: $('customEndpointField'),
  customModelField: $('customModelField'),
  modelSelect: $('aiModel'),
  modelSelectField: $('modelSelectField'),
  apiKey: $('apiKey'),
  loadModels: $('loadFreeModels'),
  clearKey: $('clearApiKey'),
  customConfirmRow: $('customConfirmRow'),
  customConfirmFree: $('customConfirmFree'),
  visionConfirmRow: $('visionConfirmRow'),
  visionConfirm: $('visionConfirm'),
  consent: $('imageConsent'),
  runAi: $('runAiSynthesis'),
  aiStatus: $('aiStatus')
};

function makeElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setStatus(node, text, kind = '') {
  node.textContent = text;
  if (kind) node.dataset.kind = kind;
  else delete node.dataset.kind;
}

function invalidateSynthesis() {
  elements.synthesisConfirmed.checked = false;
}

function updateSynthesisControls() {
  const hasText = Boolean(elements.groupSynthesis.value.trim());
  elements.synthesisConfirmed.disabled = !hasText;
  if (!hasText) elements.synthesisConfirmed.checked = false;
}

function getMeta(side) {
  const prefix = side === 'old' ? 'old' : 'current';
  return {
    year: $(`${prefix}Year`).value.trim(),
    scale: $(`${prefix}Scale`).value.trim(),
    source: $(`${prefix}Source`).value.trim(),
    license: $(`${prefix}License`).value.trim()
  };
}

function validCoordinates(point) {
  if (!point.lat?.trim() || !point.lon?.trim()) return false;
  const lat = Number(point.lat), lon = Number(point.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

function addPoint(initial = false) {
  const number = state.points.length + 1;
  state.points.push({
    id: `cp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: `Repère ${number}`,
    lat: '', lon: '', old: null, current: null
  });
  invalidateSynthesis();
  renderControlPoints();
  if (!initial) updateGeoreferencing();
}

function updatePointPickButtons() {
  for (const button of elements.controlPoints.querySelectorAll('[data-pick]')) {
    const id = button.closest('.control-row')?.dataset.pointId;
    const side = button.dataset.pick;
    const active = state.pendingPick?.id === id && state.pendingPick?.side === side;
    button.classList.toggle('is-pending', active);
    button.setAttribute('aria-pressed', String(active));
  }
}

function renderControlPoints() {
  elements.controlPoints.replaceChildren();
  for (const point of state.points) {
    const row = makeElement('div', 'control-row');
    row.dataset.pointId = point.id;

    const name = document.createElement('input');
    name.type = 'text'; name.maxLength = 80; name.value = point.name;
    name.placeholder = 'Nom du repère'; name.setAttribute('aria-label', 'Nom du repère');
    name.dataset.field = 'name';

    const lat = document.createElement('input');
    lat.type = 'number'; lat.step = 'any'; lat.min = '-90'; lat.max = '90'; lat.value = point.lat;
    lat.placeholder = 'Latitude'; lat.setAttribute('aria-label', 'Latitude WGS84');
    lat.dataset.field = 'lat';

    const lon = document.createElement('input');
    lon.type = 'number'; lon.step = 'any'; lon.min = '-180'; lon.max = '180'; lon.value = point.lon;
    lon.placeholder = 'Longitude'; lon.setAttribute('aria-label', 'Longitude WGS84');
    lon.dataset.field = 'lon';

    for (const input of [name, lat, lon]) {
      input.addEventListener('input', event => {
        point[event.currentTarget.dataset.field] = event.currentTarget.value;
        invalidateSynthesis();
        updateGeoreferencing();
      });
    }

    const oldButton = makeElement('button', '', point.old ? `✓ Historique · ${Math.round(point.old.x)},${Math.round(point.old.y)}` : 'Pointer historique');
    oldButton.type = 'button'; oldButton.dataset.pick = 'old';
    oldButton.setAttribute('aria-label', `Choisir la position historique pour ${point.name}`);
    oldButton.addEventListener('click', () => beginPointPick(point, 'old'));

    const currentButton = makeElement('button', '', point.current ? `✓ Actuelle · ${Math.round(point.current.x)},${Math.round(point.current.y)}` : 'Pointer actuelle');
    currentButton.type = 'button'; currentButton.dataset.pick = 'current';
    currentButton.setAttribute('aria-label', `Choisir la position actuelle pour ${point.name}`);
    currentButton.addEventListener('click', () => beginPointPick(point, 'current'));

    const remove = makeElement('button', 'remove-point', '×');
    remove.type = 'button'; remove.title = 'Supprimer ce point'; remove.setAttribute('aria-label', 'Supprimer ce point de contrôle');
    remove.addEventListener('click', () => {
      state.points = state.points.filter(item => item.id !== point.id);
      invalidateSynthesis();
      if (state.pendingPick?.id === point.id) state.pendingPick = null;
      renderControlPoints(); updateGeoreferencing();
    });

    const coords = makeElement('span', 'point-coords', 'Coordonnées WGS84 : latitude puis longitude. Les deux positions image sont requises.');
    row.append(name, lat, lon, oldButton, currentButton, remove, coords);
    elements.controlPoints.append(row);
  }
  updatePointPickButtons();
}

function beginPointPick(point, side) {
  if (!state.maps[side].image) {
    setStatus(elements.georefStatus, `Importez d’abord la carte ${side === 'old' ? 'historique' : 'actuelle'}.`, 'warning');
    return;
  }
  state.pendingPick = { id: point.id, side };
  state.placingMarker = false;
  state.movingObservationId = null;
  updatePointPickButtons();
  const imageName = side === 'old' ? 'historique' : 'actuelle';
  setStatus(elements.georefStatus, `Cliquez sur le repère « ${point.name || 'sans nom'} » dans l’image ${imageName}.`, 'warning');
  const preview = side === 'old' ? elements.oldPreview : elements.currentPreview;
  preview.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function loadMap(side, file) {
  if (!file) return;
  if (!/^image\/(png|jpeg|webp)$/i.test(file.type)) {
    setStatus(elements.georefStatus, 'Format refusé : choisissez un fichier PNG, JPEG ou WebP.', 'error');
    return;
  }
  if (file.size > 12 * 1024 * 1024) {
    setStatus(elements.georefStatus, 'Le fichier dépasse 12 Mo. Réduisez-le avant import.', 'error');
    return;
  }
  const map = state.maps[side];
  elements.consent.checked = false;
  updateAiControls();
  const loadId = `load-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  map.loadId = loadId;
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    if (map.loadId !== loadId) { URL.revokeObjectURL(url); return; }
    if (image.naturalWidth * image.naturalHeight > 35_000_000) {
      URL.revokeObjectURL(url);
      setStatus(elements.georefStatus, 'Image trop grande pour le navigateur (plus de 35 mégapixels).', 'error');
      return;
    }
    if (map.objectUrl) URL.revokeObjectURL(map.objectUrl);
    map.file = file; map.image = image; map.objectUrl = url;
    invalidateSynthesis();
    elements.consent.checked = false;
    for (const point of state.points) point[side] = null;
    const previewImage = side === 'old' ? elements.oldPreviewImage : elements.currentPreviewImage;
    const preview = side === 'old' ? elements.oldPreview : elements.currentPreview;
    const empty = preview.querySelector('.empty-preview');
    previewImage.src = url; previewImage.hidden = false;
    if (empty) empty.hidden = true;
    const info = $(side === 'old' ? 'oldImageInfo' : 'currentImageInfo');
    info.textContent = `${image.naturalWidth} × ${image.naturalHeight} px · ${(file.size / 1024 / 1024).toFixed(2)} Mo · ${file.name}`;
    state.pendingPick = null;
    renderControlPoints();
    updateGeoreferencing();
    updateAiControls();
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    if (map.loadId === loadId) setStatus(elements.georefStatus, 'Impossible de lire cette image.', 'error');
  };
  image.src = url;
}

function getMatchedControlPoints() {
  return state.points.filter(point => validCoordinates(point) && point.old && point.current).map(point => ({
    point,
    world: lonLatToMercator(Number(point.lon), Number(point.lat))
  }));
}

function updateGeoreferencing() {
  state.transforms = { old: null, current: null };
  elements.residualList.replaceChildren();
  const hasInvalidCoordinates = state.points.some(point => {
    if (!point.lat?.trim() || !point.lon?.trim()) return false;
    const lat = Number(point.lat), lon = Number(point.lon);
    return !Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180;
  });
  if (hasInvalidCoordinates) {
    setStatus(elements.georefStatus, 'Coordonnées WGS84 invalides : latitude −90…90°, longitude −180…180°.', 'error');
    elements.residualList.append(makeElement('li', '', 'Corrigez les coordonnées invalides.'));
    renderComparison(); updateAiControls(); return;
  }
  let matched = [];
  try { matched = getMatchedControlPoints(); }
  catch (error) {
    setStatus(elements.georefStatus, error.message || 'Vérifiez les coordonnées WGS84.', 'error');
    elements.residualList.append(makeElement('li', '', 'Coordonnées WGS84 invalides.'));
    renderComparison(); updateAiControls(); return;
  }

  if (!state.maps.old.image || !state.maps.current.image) {
    const missing = [];
    if (!state.maps.old.image) missing.push('historique');
    if (!state.maps.current.image) missing.push('actuelle');
    setStatus(elements.georefStatus, `Importez la carte ${missing.join(' et la carte ')} avant le calcul.`, '');
    elements.residualList.append(makeElement('li', '', 'Importez les deux cartes.'));
  } else if (matched.length < 3) {
    setStatus(elements.georefStatus, `${matched.length} point(s) complet(s) sur 3 minimum : renseignez latitude/longitude et les deux positions image.`, 'warning');
    elements.residualList.append(makeElement('li', '', 'Trois points communs non alignés minimum.'));
  } else {
    try {
      state.transforms.old = solveAffineTransform(matched.map(({ point, world }) => ({ pixel: point.old, world })));
      state.transforms.current = solveAffineTransform(matched.map(({ point, world }) => ({ pixel: point.current, world })));
      const oldRmse = state.transforms.old.rmse;
      const currentRmse = state.transforms.current.rmse;
      setStatus(elements.georefStatus,
        `Ajustement affine EPSG:3857 sur ${matched.length} repères. RMSE planimétrique dans la projection : historique ${oldRmse.toFixed(1)} m · actuelle ${currentRmse.toFixed(1)} m. Vérifiez les résidus et la distribution des points.`);
      matched.forEach(({ point }, index) => {
        const name = point.name.trim() || `Repère ${index + 1}`;
        elements.residualList.append(makeElement('li', '', `${name} : historique ${state.transforms.old.residuals[index].toFixed(1)} m (EPSG:3857) · actuelle ${state.transforms.current.residuals[index].toFixed(1)} m`));
      });
    } catch (error) {
      state.transforms = { old: null, current: null };
      setStatus(elements.georefStatus, error.message || 'Géoréférencement impossible; vérifiez les repères.', 'error');
      elements.residualList.append(makeElement('li', '', 'Ajustement impossible; points colinéaires ou trop rapprochés.'));
    }
  }
  renderComparison();
  updateAiControls();
}

function getImageCorners(side) {
  const map = state.maps[side], transform = state.transforms[side];
  if (!map.image || !transform) return [];
  const w = map.image.naturalWidth, h = map.image.naturalHeight;
  return [[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => transformPixel(transform, x, y));
}

function canvasContext() {
  const canvas = elements.canvas;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width || 800));
  const height = Math.max(220, Math.round(rect.height || 420));
  const dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
  if (canvas.width !== Math.round(width * dpr)) canvas.width = Math.round(width * dpr);
  if (canvas.height !== Math.round(height * dpr)) canvas.height = Math.round(height * dpr);
  const context = canvas.getContext('2d');
  return { canvas, context, width, height, dpr };
}

function screenFromWorld(world, viewport) {
  return {
    x: viewport.padX + (world.x - viewport.minX) * viewport.scale,
    y: viewport.padY + (viewport.maxY - world.y) * viewport.scale
  };
}

function drawMapImage(context, map, transform, viewport, dpr) {
  if (!map.image || !transform) return;
  const scale = viewport.scale, padX = viewport.padX, padY = viewport.padY;
  context.save();
  context.setTransform(
    dpr * scale * transform.a,
    dpr * -scale * transform.d,
    dpr * scale * transform.b,
    dpr * -scale * transform.e,
    dpr * (padX + (transform.c - viewport.minX) * scale),
    dpr * (padY + (viewport.maxY - transform.f) * scale)
  );
  context.drawImage(map.image, 0, 0);
  context.restore();
}

function observationWorld(observation) {
  if (Number.isFinite(observation.lon) && Number.isFinite(observation.lat)) {
    return lonLatToMercator(observation.lon, observation.lat);
  }
  if (observation.origin === 'IA' && state.maps.old.image && state.transforms.old) {
    return transformPixel(state.transforms.old,
      observation.x * state.maps.old.image.naturalWidth,
      observation.y * state.maps.old.image.naturalHeight);
  }
  return null;
}

function drawObservation(context, observation, viewport, dpr) {
  if (!observation.confirmed && observation.origin !== 'IA') return;
  let world;
  try { world = observationWorld(observation); } catch { return; }
  if (!world) return;
  const point = screenFromWorld(world, viewport);
  if (point.x < -30 || point.y < -30 || point.x > viewport.width + 30 || point.y > viewport.height + 30) return;
  const aiPending = observation.origin === 'IA' && !observation.confirmed;
  context.save();
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.beginPath(); context.arc(point.x, point.y, aiPending ? 7 : 6, 0, Math.PI * 2);
  context.setLineDash(aiPending ? [3, 2] : []);
  context.lineWidth = 2;
  context.fillStyle = aiPending ? 'rgba(255,255,255,.75)' : '#1f7654';
  context.strokeStyle = aiPending ? '#9255aa' : '#fff';
  context.fill(); context.stroke();
  context.beginPath(); context.arc(point.x, point.y, aiPending ? 4 : 3.3, 0, Math.PI * 2);
  context.fillStyle = aiPending ? '#9255aa' : '#1f7654'; context.fill();
  const label = String(observation.label || 'Observation').slice(0, 34);
  context.font = '11px system-ui, sans-serif';
  const textWidth = context.measureText(label).width;
  const boxX = Math.min(Math.max(4, point.x + 10), viewport.width - textWidth - 18);
  const boxY = Math.max(16, point.y - 8);
  context.fillStyle = 'rgba(255,255,255,.92)';
  context.fillRect(boxX - 4, boxY - 12, textWidth + 8, 17);
  context.fillStyle = aiPending ? '#674679' : '#2f4d3d';
  context.fillText(label, boxX, boxY);
  context.restore();
}

function renderComparison({ includeUnconfirmed = true } = {}) {
  const { canvas, context, width, height, dpr } = canvasContext();
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#eef1ec'; context.fillRect(0, 0, width, height);
  const ready = Boolean(state.maps.old.image && state.maps.current.image && state.transforms.old && state.transforms.current);
  elements.canvasPlaceholder.hidden = ready;
  elements.exportPng.disabled = !ready;
  elements.exportJson.disabled = !(state.maps.old.image || state.maps.current.image);
  elements.addManual.disabled = !ready;

  if (!ready) {
    state.viewport = null;
    elements.quality.textContent = 'En attente du géoréférencement';
    return;
  }

  const corners = [...getImageCorners('old'), ...getImageCorners('current')];
  const xs = corners.map(point => point.x), ys = corners.map(point => point.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const pad = Math.min(22, Math.max(8, Math.min(width, height) * .035));
  const spanX = Math.max(1, maxX - minX), spanY = Math.max(1, maxY - minY);
  const availableWidth = width - pad * 2, availableHeight = height - pad * 2;
  const scale = Math.min(availableWidth / spanX, availableHeight / spanY);
  const padX = pad + (availableWidth - spanX * scale) / 2;
  const padY = pad + (availableHeight - spanY * scale) / 2;
  const viewport = { minX, maxX, minY, maxY, padX, padY, scale, width, height };
  state.viewport = viewport;

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.fillStyle = '#f5f6f2'; context.fillRect(0, 0, width, height);
  drawMapImage(context, state.maps.old, state.transforms.old, viewport, dpr);
  const mode = elements.mode.value;
  const slider = Number(elements.slider.value) / 100;
  if (mode === 'swipe') {
    const splitX = width * slider;
    context.save();
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.beginPath(); context.rect(splitX, 0, width - splitX, height); context.clip();
    drawMapImage(context, state.maps.current, state.transforms.current, viewport, dpr);
    context.restore();
    context.save(); context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.strokeStyle = '#204d3d'; context.lineWidth = 2;
    context.beginPath(); context.moveTo(splitX, 0); context.lineTo(splitX, height); context.stroke();
    context.restore();
  } else {
    context.save(); context.globalAlpha = slider;
    drawMapImage(context, state.maps.current, state.transforms.current, viewport, dpr);
    context.restore();
  }

  for (const observation of state.observations) {
    if (!includeUnconfirmed && observation.origin === 'IA' && !observation.confirmed) continue;
    drawObservation(context, observation, viewport, dpr);
  }
  const oldRmse = state.transforms.old.rmse, currentRmse = state.transforms.current.rmse;
  elements.quality.textContent = `RMSE EPSG:3857 · historique ${oldRmse.toFixed(1)} m / actuelle ${currentRmse.toFixed(1)} m`;
}

function eventCanvasPosition(event) {
  const rect = elements.canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function canvasPointToWorld(position) {
  const viewport = state.viewport;
  if (!viewport || viewport.scale <= 0) throw new Error('La superposition n’est pas prête.');
  return {
    x: viewport.minX + (position.x - viewport.padX) / viewport.scale,
    y: viewport.maxY - (position.y - viewport.padY) / viewport.scale
  };
}

function worldToPixel(transform, world) {
  const determinant = transform.a * transform.e - transform.b * transform.d;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-18) return null;
  const dx = world.x - transform.c, dy = world.y - transform.f;
  return {
    x: (transform.e * dx - transform.b * dy) / determinant,
    y: (-transform.d * dx + transform.a * dy) / determinant
  };
}

function isInsideEitherMap(world) {
  return ['old', 'current'].some(side => {
    const map = state.maps[side], transform = state.transforms[side];
    if (!map.image || !transform) return false;
    const pixel = worldToPixel(transform, world);
    return pixel && pixel.x >= 0 && pixel.y >= 0 && pixel.x <= map.image.naturalWidth && pixel.y <= map.image.naturalHeight;
  });
}

function onCanvasClick(event) {
  if (!state.viewport) return;
  const position = eventCanvasPosition(event);
  if (state.movingObservationId) {
    const observation = state.observations.find(item => item.id === state.movingObservationId);
    if (!observation) { state.movingObservationId = null; return; }
    const world = canvasPointToWorld(position);
    if (!isInsideEitherMap(world)) {
      setStatus(elements.annotationStatus, 'Cliquez à l’intérieur d’une des deux images géoréférencées.', 'warning');
      return;
    }
    const geographic = mercatorToLonLat(world.x, world.y);
    invalidateSynthesis();
    observation.lon = geographic.lon; observation.lat = geographic.lat; observation.repositioned = true;
    state.movingObservationId = null;
    setStatus(elements.annotationStatus, 'Repère repositionné. Vérifiez son intitulé puis validez-le si nécessaire.', 'success');
    renderObservations(); renderComparison(); return;
  }
  if (state.placingMarker) {
    const world = canvasPointToWorld(position);
    if (!isInsideEitherMap(world)) {
      setStatus(elements.annotationStatus, 'Cliquez à l’intérieur d’une des deux images géoréférencées.', 'warning');
      return;
    }
    const geographic = mercatorToLonLat(world.x, world.y);
    const label = elements.manualLabel.value.trim() || `Observation ${state.observations.filter(item => item.origin === 'Manuel').length + 1}`;
    invalidateSynthesis();
    state.observations.push({
      id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      label, category: elements.manualCategory.value, detail: 'Position placée manuellement sur la superposition.',
      lon: geographic.lon, lat: geographic.lat, confidence: 1, confirmed: true, origin: 'Manuel'
    });
    state.placingMarker = false;
    elements.canvas.style.cursor = 'crosshair';
    setStatus(elements.annotationStatus, 'Repère ajouté. Les coordonnées sont exportées avec le plan.', 'success');
    elements.manualLabel.value = '';
    renderObservations(); renderComparison(); return;
  }
}

function renderObservations() {
  elements.observationsList.replaceChildren();
  for (const observation of state.observations) {
    const card = makeElement('article', 'observation-card');
    card.dataset.origin = observation.origin;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox'; checkbox.checked = Boolean(observation.confirmed);
    checkbox.disabled = observation.origin !== 'IA';
    checkbox.setAttribute('aria-label', observation.origin === 'IA' ? 'Valider cette proposition IA' : 'Observation validée');
    checkbox.addEventListener('change', () => {
      invalidateSynthesis();
      observation.confirmed = checkbox.checked;
      renderComparison(); renderObservations();
    });
    const content = document.createElement('div');
    const title = document.createElement('input');
    title.type = 'text'; title.value = observation.label; title.maxLength = 100;
    title.setAttribute('aria-label', 'Intitulé de l’observation');
    title.addEventListener('change', () => { invalidateSynthesis(); observation.label = title.value.trim() || 'Observation'; renderComparison(); });
    const detail = makeElement('p', '', `${observation.origin === 'IA' ? 'Proposition IA' : 'Manuel'} · ${observation.category || 'autre'}${observation.origin === 'IA' ? ` · confiance indicative ${(observation.confidence * 100).toFixed(0)} %` : ''}${observation.detail ? ` · ${observation.detail}` : ''}`);
    content.append(title, detail);
    const actions = makeElement('div', 'observation-actions');
    const tag = makeElement('span', 'confidence', observation.origin === 'IA' ? 'À valider' : 'Retenu');
    const move = makeElement('button', '', 'Repositionner');
    move.type = 'button'; move.setAttribute('aria-label', 'Repositionner ce repère sur le plan');
    move.addEventListener('click', () => {
      state.movingObservationId = observation.id; state.placingMarker = false;
      elements.canvas.style.cursor = 'crosshair';
      setStatus(elements.annotationStatus, `Cliquez sur le plan pour repositionner « ${observation.label} ».`, 'warning');
      elements.canvas.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    const remove = makeElement('button', '', 'Retirer');
    remove.type = 'button'; remove.setAttribute('aria-label', 'Retirer cette observation');
    remove.addEventListener('click', () => {
      invalidateSynthesis();
      state.observations = state.observations.filter(item => item.id !== observation.id);
      renderObservations(); renderComparison();
    });
    actions.append(tag, move, remove);
    card.append(checkbox, content, actions);
    elements.observationsList.append(card);
  }
  elements.aiSummary.hidden = !state.aiSummary;
  elements.aiSummary.textContent = state.aiSummary ? `Synthèse proposée par l’IA — brouillon non validé : ${state.aiSummary}` : '';
  elements.applyAiDraft.disabled = !state.aiSummary;
}

function setProviderUI() {
  const provider = elements.provider.value;
  elements.customEndpointField.hidden = provider !== 'custom';
  elements.customModelField.hidden = provider !== 'custom';
  elements.customConfirmRow.hidden = provider !== 'custom';
  elements.modelSelectField.hidden = !['openrouter', 'apinex'].includes(provider);
  elements.loadModels.hidden = !['openrouter', 'apinex'].includes(provider);
  elements.apiKey.disabled = !provider;
  elements.clearKey.disabled = !provider || !elements.apiKey.value;
  elements.loadModels.disabled = !provider || !elements.apiKey.value;
  elements.visionConfirmRow.hidden = true;
  elements.visionConfirm.checked = false;
  elements.customConfirmFree.checked = false;
  elements.consent.checked = false;
  elements.aiModels.clear();
  elements.modelSelect.replaceChildren(new Option('Charger le catalogue…', ''));
  if (provider) setStatus(elements.aiStatus, 'La clé sera transmise uniquement au fournisseur sélectionné lors d’une requête explicite.', '');
  else setStatus(elements.aiStatus, 'Mode local actif; aucune clé ni requête IA.', '');
  updateAiControls();
}

function normalizedBaseUrl() {
  const provider = elements.provider.value;
  if (provider === 'openrouter') return 'https://openrouter.ai/api/v1';
  if (provider === 'apinex') return 'https://api.apinex.bond/v1';
  if (provider !== 'custom') throw new Error('Choisissez un fournisseur.');
  const input = elements.customEndpoint.value.trim();
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('L’endpoint personnalisé doit être une URL HTTPS sans identifiants, paramètres ni fragment.');
  }
  return url.href.replace(/\/+$/, '');
}

function selectedModelState() {
  const provider = elements.provider.value;
  if (provider === 'custom') {
    return {
      id: elements.customModel.value.trim(),
      free: elements.customConfirmFree.checked,
      vision: elements.customConfirmFree.checked
    };
  }
  const item = state.aiModels.get(elements.modelSelect.value);
  if (!item) return { id: '', free: false, vision: false };
  return { id: item.id, free: true, vision: item.vision === true || (item.vision === null && elements.visionConfirm.checked) };
}

function updateAiControls() {
  const provider = elements.provider.value;
  const hasKey = Boolean(elements.apiKey.value.trim());
  elements.clearKey.disabled = !hasKey;
  elements.loadModels.disabled = !hasKey || !['openrouter', 'apinex'].includes(provider);
  let endpointOk = provider === 'openrouter' || provider === 'apinex';
  if (provider === 'custom') {
    try { normalizedBaseUrl(); endpointOk = true; } catch { endpointOk = false; }
  }
  const model = selectedModelState();
  const modelOk = Boolean(model.id && model.free && model.vision);
  const imagesReady = Boolean(state.maps.old.image && state.maps.current.image);
  const georeferenced = Boolean(state.transforms.old && state.transforms.current);
  elements.runAi.disabled = !(provider && hasKey && endpointOk && modelOk && imagesReady && georeferenced && elements.consent.checked);
  elements.addManual.disabled = !(imagesReady && georeferenced);
}

async function loadModels() {
  const provider = elements.provider.value;
  if (!['openrouter', 'apinex'].includes(provider)) return;
  const key = elements.apiKey.value.trim();
  if (!key) { setStatus(elements.aiStatus, 'Saisissez votre clé API avant de charger le catalogue.', 'warning'); return; }
  let endpoint;
  try { endpoint = normalizedBaseUrl(); }
  catch (error) { setStatus(elements.aiStatus, error.message, 'error'); return; }
  elements.loadModels.disabled = true;
  elements.loadModels.textContent = 'Chargement…';
  setStatus(elements.aiStatus, `Requête authentifiée vers ${provider === 'openrouter' ? 'OpenRouter' : 'APInex'}; aucune image n’est jointe à cette requête.`, '');
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    let response;
    try {
      response = await fetch(`${endpoint}/models`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
        credentials: 'omit',
        signal: controller.signal,
        referrerPolicy: 'no-referrer'
      });
    } finally { clearTimeout(timeout); }
    if (!response.ok) throw new Error(`Le catalogue a répondu HTTP ${response.status}. Vérifiez la clé, l’accès API et les conditions du fournisseur.`);
    const payload = await response.json();
    const models = freeModelsFromCatalog(payload, provider);
    state.aiModels.clear();
    elements.modelSelect.replaceChildren();
    for (const model of models) {
      if (model.vision === false) continue;
      state.aiModels.set(model.id, model);
      const option = new Option(`${model.name} · gratuit · ${model.vision === true ? 'image annoncée' : 'image à vérifier'}`, model.id);
      elements.modelSelect.add(option);
    }
    if (state.aiModels.size === 0) {
      elements.modelSelect.add(new Option('Aucun modèle gratuit compatible trouvé', ''));
      setStatus(elements.aiStatus, 'Aucun modèle déclaré gratuit avec une capacité image dans la réponse. Aucun modèle payant ne sera utilisé automatiquement.', 'warning');
    } else {
      elements.modelSelect.selectedIndex = 0;
      onModelSelection();
      setStatus(elements.aiStatus, `${state.aiModels.size} modèle(s) présenté(s) comme gratuit(s). Vérifiez le quota, la capacité image et la politique de rétention avant envoi.`, 'success');
    }
  } catch (error) {
    const message = error?.name === 'AbortError'
      ? 'Délai dépassé pendant le chargement du catalogue.'
      : error?.message || 'Impossible de charger le catalogue. Le fournisseur peut bloquer les requêtes navigateur (CORS).';
    setStatus(elements.aiStatus, message, 'error');
  } finally {
    elements.loadModels.textContent = 'Charger les modèles gratuits';
    updateAiControls();
  }
}

function onModelSelection() {
  const model = state.aiModels.get(elements.modelSelect.value);
  const needsVisionCheck = Boolean(model && model.vision === null);
  elements.visionConfirmRow.hidden = !needsVisionCheck;
  elements.visionConfirm.checked = false;
  updateAiControls();
}

function resizeImageDataUrl(image, maxDimension = 1400) {
  const ratio = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * ratio));
  const height = Math.max(1, Math.round(image.naturalHeight * ratio));
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#fff'; context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', .78);
}

function metadataForPrompt() {
  const trim = value => String(value || '').slice(0, 180);
  return {
    historique: { année_ou_période: trim(getMeta('old').year), échelle: trim(getMeta('old').scale), source: trim(getMeta('old').source) },
    actuelle: { année_ou_période: trim(getMeta('current').year), échelle: trim(getMeta('current').scale), source: trim(getMeta('current').source) }
  };
}

function contentText(messageContent) {
  if (typeof messageContent === 'string') return messageContent;
  if (Array.isArray(messageContent)) return messageContent.map(part => typeof part === 'string' ? part : part?.text || '').join('\n');
  return '';
}

async function runAi() {
  const provider = elements.provider.value;
  const apiKey = elements.apiKey.value.trim();
  const model = selectedModelState();
  if (!elements.consent.checked) { setStatus(elements.aiStatus, 'Cochez le consentement explicite avant l’envoi des images et métadonnées.', 'warning'); return; }
  if (!apiKey || !model.id || !model.free || !model.vision) { setStatus(elements.aiStatus, 'Clé, modèle gratuit et capacité image doivent être vérifiés.', 'warning'); return; }
  if (!state.maps.old.image || !state.maps.current.image || !state.transforms.old || !state.transforms.current) {
    setStatus(elements.aiStatus, 'Importez et géoréférencez les deux cartes avant une analyse IA.', 'warning'); return;
  }

  let endpoint;
  try { endpoint = normalizedBaseUrl(); }
  catch (error) { setStatus(elements.aiStatus, error.message, 'error'); return; }

  elements.runAi.disabled = true;
  elements.runAi.textContent = 'Analyse en cours…';
  setStatus(elements.aiStatus, `Envoi direct de deux images JPEG réduites et des métadonnées à ${provider === 'openrouter' ? 'OpenRouter' : provider === 'apinex' ? 'APInex' : 'l’endpoint choisi'}; aucune bascule vers un modèle payant.`, 'warning');
  try {
    const oldData = resizeImageDataUrl(state.maps.old.image);
    const currentData = resizeImageDataUrl(state.maps.current.image);
    const metadata = metadataForPrompt();
    const prompt = [
      'Vous êtes un assistant de lecture comparative de cartes urbaines. Comparez uniquement les indices visibles dans les deux images jointes : la première est la carte historique, la seconde la carte actuelle.',
      'N’inventez pas de faits, de dates, de lieux, de limites de propriété, de parcelles cadastrales ou de zonage juridique. Ne présentez pas une hypothèse comme un fait. Les images peuvent avoir des échelles et orientations différentes. N’essayez pas de géoréférencer les documents et ne prétendez pas que les positions sont exactes.',
      'Retournez uniquement un objet JSON valide, sans balises Markdown, de forme : {"summary":"...","observations":[{"label":"...","category":"viaire|bâti|eau|végétation|espace-ouvert|autre","confidence":0.0,"detail":"...","x":0.0,"y":0.0}]}. Au plus six observations. x et y sont des fractions entre 0 et 1 mesurées depuis le coin supérieur gauche de l’image HISTORIQUE; ne proposez un point que si sa position est identifiable. Sinon, retournez une liste vide. La confiance décrit l’incertitude de lecture, pas une probabilité statistique.',
      'Formulez la synthèse et les détails en français. Mentionnez les limites visuelles et l’incertitude. L’étudiant doit contrôler et valider chaque suggestion.',
      `Métadonnées fournies par l’utilisateur : ${JSON.stringify(metadata)}`
    ].join('\n\n');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);
    let response;
    try {
      response = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(provider === 'openrouter' ? { 'HTTP-Referer': window.location.origin, 'X-Title': 'UrbaTrame S5' } : {})
        },
        referrerPolicy: 'no-referrer',
        credentials: 'omit',
        signal: controller.signal,
        body: JSON.stringify({
          model: model.id,
          temperature: 0.15,
          max_tokens: 1100,
          messages: [{ role: 'user', content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: oldData } },
            { type: 'image_url', image_url: { url: currentData } }
          ] }]
        })
      });
    } finally { clearTimeout(timeout); }
    if (!response.ok) throw new Error(`Le fournisseur a répondu HTTP ${response.status}. Vérifiez ses quotas, sa politique et la compatibilité image du modèle.`);
    const payload = await response.json();
    const rawText = contentText(payload?.choices?.[0]?.message?.content);
    const normalized = validateAiSynthesis(parseAiJson(rawText));
    state.observations = state.observations.filter(item => item.origin !== 'IA' || item.confirmed);
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    for (const [index, observation] of normalized.observations.entries()) {
      observation.id = `ai-${runId}-${index}`;
      state.observations.push(observation);
    }
    state.aiSummary = normalized.summary;
    state.aiProvenance = { provider, model: model.id, generated_at: new Date().toISOString() };
    renderObservations(); renderComparison();
    setStatus(elements.aiStatus, `${normalized.observations.length} proposition(s) reçue(s). Aucune n’est validée automatiquement. Vérifiez la source et placez les repères avant export.`, 'success');
  } catch (error) {
    const message = error?.name === 'AbortError'
      ? 'Délai dépassé pendant l’analyse. Aucun nouvel essai ni fournisseur de secours n’a été lancé.'
      : error?.message || 'La requête a échoué. Vérifiez le endpoint, le CORS, la clé et les limites du fournisseur.';
    setStatus(elements.aiStatus, message, 'error');
  } finally {
    elements.runAi.textContent = 'Proposer une synthèse';
    updateAiControls();
  }
}

function addManualObservation() {
  if (!state.viewport) return;
  state.placingMarker = true;
  state.movingObservationId = null;
  state.pendingPick = null;
  elements.canvas.style.cursor = 'crosshair';
  setStatus(elements.annotationStatus, 'Cliquez sur le plan pour placer un repère manuel. Vous pourrez le repositionner ensuite.', 'warning');
  elements.canvas.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function wrapText(context, text, x, y, maxWidth, lineHeight, maxLines = 3) {
  const words = String(text || 'Non renseignée').split(/\s+/);
  let line = '', lines = 0;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (context.measureText(test).width > maxWidth && line) {
      context.fillText(line, x, y); y += lineHeight; lines++; line = word;
      if (lines >= maxLines - 1) { line = `${line}…`; break; }
    } else line = test;
  }
  if (line && lines < maxLines) context.fillText(line, x, y);
}

function exportPng() {
  if (!state.transforms.old || !state.transforms.current) return;
  renderComparison({ includeUnconfirmed: false });
  const output = document.createElement('canvas');
  const width = 1600, headerHeight = 150, mapHeight = 930, footerHeight = 450;
  output.width = width; output.height = headerHeight + mapHeight + footerHeight;
  const context = output.getContext('2d');
  context.fillStyle = '#fff'; context.fillRect(0, 0, output.width, output.height);
  context.fillStyle = '#153e3d'; context.fillRect(0, 0, width, 12);
  context.fillStyle = '#20352b'; context.font = 'bold 34px Georgia, serif';
  const oldYear = getMeta('old').year || 'date non renseignée';
  const currentYear = getMeta('current').year || 'date non renseignée';
  context.fillText('UrbaTrame · Comparaison historique', 54, 63);
  context.fillStyle = '#66736a'; context.font = '19px system-ui, sans-serif';
  context.fillText(`${oldYear}  →  ${currentYear}`, 54, 103);
  context.fillStyle = '#879188'; context.font = '14px system-ui, sans-serif';
  context.fillText(`Plan exporté le ${new Date().toLocaleDateString('fr-FR')}`, 54, 130);
  const sourceCanvas = elements.canvas;
  const scale = Math.min((width - 80) / sourceCanvas.width, (mapHeight - 38) / sourceCanvas.height);
  const drawW = sourceCanvas.width * scale, drawH = sourceCanvas.height * scale;
  const drawX = (width - drawW) / 2, drawY = headerHeight + (mapHeight - drawH) / 2;
  context.fillStyle = '#f4f6f2'; context.fillRect(30, headerHeight, width - 60, mapHeight);
  context.drawImage(sourceCanvas, drawX, drawY, drawW, drawH);
  context.strokeStyle = '#dbe4da'; context.lineWidth = 2;
  context.strokeRect(drawX, drawY, drawW, drawH);
  renderComparison(); // rétablir l’aperçu des propositions après la capture exportable

  const footerY = headerHeight + mapHeight + 30;
  context.fillStyle = '#38483d'; context.font = 'bold 17px system-ui, sans-serif';
  context.fillText('Sources, méthode et repères', 54, footerY);
  const col1 = 54, col2 = 825, colW = 710;
  context.fillStyle = '#526158'; context.font = 'bold 13px system-ui, sans-serif';
  context.fillText(`Historique · ${oldYear}`, col1, footerY + 30);
  context.fillText(`Actuelle · ${currentYear}`, col2, footerY + 30);
  context.fillStyle = '#66736a'; context.font = '13px system-ui, sans-serif';
  wrapText(context, `Source : ${getMeta('old').source || 'Non renseignée'} · Échelle : ${getMeta('old').scale || 'Non renseignée'} · Droits : ${getMeta('old').license || 'À vérifier'}`, col1, footerY + 55, colW, 19, 4);
  wrapText(context, `Source : ${getMeta('current').source || 'Non renseignée'} · Échelle : ${getMeta('current').scale || 'Non renseignée'} · Droits : ${getMeta('current').license || 'À vérifier'}`, col2, footerY + 55, colW, 19, 4);
  context.fillStyle = '#526158'; context.font = 'bold 13px system-ui, sans-serif';
  context.fillText('Géoréférencement', col1, footerY + 138);
  context.fillStyle = '#66736a'; context.font = '13px system-ui, sans-serif';
  context.fillText(`Transformation affine · EPSG:3857 · ${state.transforms.old.pointCount} points communs · RMSE historique ${state.transforms.old.rmse.toFixed(1)} m · actuelle ${state.transforms.current.rmse.toFixed(1)} m`, col1, footerY + 161);
  const overlayDescription = elements.mode.value === 'swipe'
    ? `Balayage : historique à gauche, actuelle à droite · volet ${elements.slider.value} %.`
    : `Transparence : carte actuelle à ${elements.slider.value} % d’opacité, sur la carte historique.`;
  context.fillText(overlayDescription, col1, footerY + 183);
  context.fillText(`${state.observations.filter(item => item.confirmed).length} observation(s) retenue(s) · interprétations à vérifier · aucune limite cadastrale ou juridique générée`, col1, footerY + 205);
  const approvedSynthesis = elements.synthesisConfirmed.checked ? elements.groupSynthesis.value.trim() : '';
  context.fillStyle = '#526158'; context.font = 'bold 13px system-ui, sans-serif';
  context.fillText(approvedSynthesis ? 'Synthèse du groupe · texte relu et confirmé' : 'Synthèse du groupe · aucun texte confirmé', col1, footerY + 232);
  context.fillStyle = '#66736a'; context.font = '12px system-ui, sans-serif';
  wrapText(context, approvedSynthesis || 'Aucun texte de synthèse n’a été validé pour cet export.', col1, footerY + 253, width - 108, 17, 6);
  if (state.aiProvenance) {
    context.fillStyle = '#80658c'; context.font = '11px system-ui, sans-serif';
    wrapText(context, `Aide IA (propositions, non-source) : ${state.aiProvenance.provider} · ${state.aiProvenance.model} · ${new Date(state.aiProvenance.generated_at).toLocaleString('fr-FR')}`, col1, footerY + 370, width - 108, 15, 2);
  }
  context.fillStyle = '#1f7654'; context.beginPath(); context.arc(col1 + 8, footerY + 407, 6, 0, Math.PI * 2); context.fill();
  context.fillStyle = '#66736a'; context.fillText('Observation retenue', col1 + 22, footerY + 411);
  context.beginPath(); context.arc(col1 + 220, footerY + 407, 6, 0, Math.PI * 2); context.fill();
  context.fillStyle = '#66736a'; context.fillText('Plan indicatif · sources et date reportées', col1 + 234, footerY + 411);
  output.toBlob(blob => {
    if (!blob) { setStatus(elements.georefStatus, 'Échec de création du PNG.', 'error'); return; }
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob);
    link.download = `UrbaTrame-S5-synthese-${new Date().toISOString().slice(0, 10)}.png`;
    link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }, 'image/png');
}

function exportJson() {
  const round = value => Number.isFinite(value) ? Number(value.toFixed(8)) : null;
  let pointResiduals = [];
  if (state.transforms.old && state.transforms.current) {
    try {
      pointResiduals = getMatchedControlPoints().map(({ point }, index) => ({
        name: point.name,
        historical_residual_epsg3857_m: round(state.transforms.old.residuals[index]),
        current_residual_epsg3857_m: round(state.transforms.current.residuals[index])
      }));
    } catch { /* les résidus restent vides si les coordonnées ont changé */ }
  }
  const controlPoints = state.points.map(point => ({
    name: point.name,
    latitude: validCoordinates(point) ? Number(point.lat) : null,
    longitude: validCoordinates(point) ? Number(point.lon) : null,
    historique_px: point.old ? { x: round(point.old.x), y: round(point.old.y) } : null,
    actuelle_px: point.current ? { x: round(point.current.x), y: round(point.current.y) } : null
  }));
  const observationRecords = state.observations.map(observation => {
    let geo = null;
    try {
      const world = observationWorld(observation);
      if (world) geo = mercatorToLonLat(world.x, world.y);
    } catch { /* garder le repère sans coordonnées si le géoréférencement manque */ }
    return {
      label: observation.label,
      category: observation.category,
      detail: observation.detail,
      origin: observation.origin,
      confidence_indicative: observation.origin === 'IA' ? observation.confidence : null,
      validated_by_student: Boolean(observation.confirmed),
      latitude: geo ? round(geo.lat) : null,
      longitude: geo ? round(geo.lon) : null,
      position_image_historique_normalisee: observation.origin === 'IA' && !observation.repositioned ? { x: round(observation.x), y: round(observation.y) } : null
    };
  });
  const project = {
    format: 'UrbaTrame S5 comparison 1.0',
    exported_at: new Date().toISOString(),
    georeferencing: {
      method: 'Ajustement affine bidimensionnel par moindres carrés sur les points de contrôle saisis',
      projection: 'EPSG:3857 (Web Mercator; WGS84 en entrée)',
      historical_rmse_epsg3857_m: state.transforms.old?.rmse ?? null,
      current_rmse_epsg3857_m: state.transforms.current?.rmse ?? null,
      control_point_count: state.transforms.old?.pointCount ?? 0
    },
    maps: {
      historical: { ...getMeta('old'), filename: state.maps.old.file?.name || null, width_px: state.maps.old.image?.naturalWidth || null, height_px: state.maps.old.image?.naturalHeight || null },
      current: { ...getMeta('current'), filename: state.maps.current.file?.name || null, width_px: state.maps.current.image?.naturalWidth || null, height_px: state.maps.current.image?.naturalHeight || null }
    },
    control_points: controlPoints,
    control_point_residuals: pointResiduals,
    observations: observationRecords.filter(item => item.origin !== 'IA' || item.validated_by_student),
    unvalidated_ai_suggestions: observationRecords.filter(item => item.origin === 'IA' && !item.validated_by_student),
    group_synthesis: { validated_by_student: elements.synthesisConfirmed.checked, text: elements.groupSynthesis.value.trim() || null },
    ai_assistance: state.aiProvenance,
    ai_summary_draft: state.aiSummary || null,
    notes: [
      'Les images ne sont pas incluses dans cet export JSON.',
      'Les suggestions IA en attente sont séparées et ne font pas partie des observations retenues.',
      'Aucune limite cadastrale ou juridique n’est produite.'
    ]
  };
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json;charset=utf-8' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob);
  link.download = `UrbaTrame-S5-points-annotations-${new Date().toISOString().slice(0, 10)}.json`;
  link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function metadataListeners() {
  for (const id of ['oldYear', 'oldScale', 'oldSource', 'oldLicense', 'currentYear', 'currentScale', 'currentSource', 'currentLicense']) {
    $(id).addEventListener('input', () => {
      invalidateSynthesis();
      if (!id.endsWith('License')) elements.consent.checked = false;
      renderComparison(); updateAiControls();
    });
  }
  $('oldMapFile').addEventListener('change', event => loadMap('old', event.currentTarget.files?.[0]));
  $('currentMapFile').addEventListener('change', event => loadMap('current', event.currentTarget.files?.[0]));
}

function init() {
  $('currentYear').value = String(new Date().getFullYear());
  addPoint(true); addPoint(true); addPoint(true);
  renderControlPoints();
  metadataListeners();
  elements.addControlPoint.addEventListener('click', () => addPoint());
  elements.oldPreview.addEventListener('click', event => {
    if (state.pendingPick?.side !== 'old' || !state.pendingPick || event.target !== elements.oldPreviewImage) return;
    const point = state.points.find(item => item.id === state.pendingPick.id);
    const rect = elements.oldPreviewImage.getBoundingClientRect();
    if (!point || !state.maps.old.image || !rect.width || !rect.height || event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return;
    point.old = { x: (event.clientX - rect.left) * state.maps.old.image.naturalWidth / rect.width, y: (event.clientY - rect.top) * state.maps.old.image.naturalHeight / rect.height };
    invalidateSynthesis();
    state.pendingPick = null; renderControlPoints(); updateGeoreferencing();
  });
  elements.currentPreview.addEventListener('click', event => {
    if (state.pendingPick?.side !== 'current' || !state.pendingPick || event.target !== elements.currentPreviewImage) return;
    const point = state.points.find(item => item.id === state.pendingPick.id);
    const rect = elements.currentPreviewImage.getBoundingClientRect();
    if (!point || !state.maps.current.image || !rect.width || !rect.height || event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return;
    point.current = { x: (event.clientX - rect.left) * state.maps.current.image.naturalWidth / rect.width, y: (event.clientY - rect.top) * state.maps.current.image.naturalHeight / rect.height };
    invalidateSynthesis();
    state.pendingPick = null; renderControlPoints(); updateGeoreferencing();
  });
  elements.slider.addEventListener('input', () => {
    elements.sliderValue.textContent = `${elements.slider.value} %`;
    renderComparison();
  });
  elements.mode.addEventListener('change', () => {
    elements.sliderLabel.textContent = elements.mode.value === 'swipe' ? 'Position du volet de comparaison' : 'Opacité de la carte actuelle';
    renderComparison();
  });
  elements.canvas.addEventListener('click', onCanvasClick);
  elements.addManual.addEventListener('click', addManualObservation);
  elements.exportPng.addEventListener('click', exportPng);
  elements.exportJson.addEventListener('click', exportJson);
  elements.provider.addEventListener('change', () => {
    elements.apiKey.value = '';
    setProviderUI();
  });
  elements.apiKey.addEventListener('input', updateAiControls);
  elements.customEndpoint.addEventListener('input', updateAiControls);
  elements.customModel.addEventListener('input', updateAiControls);
  elements.customConfirmFree.addEventListener('change', updateAiControls);
  elements.visionConfirm.addEventListener('change', updateAiControls);
  elements.consent.addEventListener('change', updateAiControls);
  elements.modelSelect.addEventListener('change', onModelSelection);
  elements.loadModels.addEventListener('click', loadModels);
  elements.clearKey.addEventListener('click', () => {
    elements.apiKey.value = '';
    elements.consent.checked = false;
    state.aiModels.clear();
    elements.modelSelect.replaceChildren(new Option('Charger le catalogue…', ''));
    elements.visionConfirm.checked = false;
    setStatus(elements.aiStatus, 'Clé effacée de la page. Elle n’avait pas été enregistrée.', 'success');
    updateAiControls();
  });
  elements.runAi.addEventListener('click', runAi);
  elements.applyAiDraft.addEventListener('click', () => {
    if (!state.aiSummary) return;
    elements.groupSynthesis.value = state.aiSummary;
    elements.synthesisConfirmed.checked = false;
    updateSynthesisControls();
    elements.groupSynthesis.focus();
    setStatus(elements.annotationStatus, 'Brouillon copié. Relisez-le, corrigez-le, puis cochez sa validation pour l’inclure dans les exports.', 'warning');
  });
  elements.groupSynthesis.addEventListener('input', () => {
    invalidateSynthesis();
    updateSynthesisControls();
    renderComparison();
  });
  elements.synthesisConfirmed.addEventListener('change', () => renderComparison());
  elements.manualLabel.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); addManualObservation(); } });
  if ('ResizeObserver' in window) {
    state.resizeObserver = new ResizeObserver(() => renderComparison());
    state.resizeObserver.observe(elements.canvas);
  }
  window.addEventListener('resize', () => renderComparison(), { passive: true });
  window.addEventListener('pagehide', () => {
    elements.apiKey.value = '';
    for (const map of Object.values(state.maps)) if (map.objectUrl) URL.revokeObjectURL(map.objectUrl);
    state.aiModels.clear(); state.observations.length = 0;
  }, { once: true });
  setProviderUI();
  updateSynthesisControls();
  renderObservations(); renderComparison(); updateGeoreferencing();
}

init();
