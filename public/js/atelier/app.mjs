import { createMap } from './map.mjs';
import { areaForShape, insideShape, normalizeBoundary, toLocal } from './geometry.mjs';
import { normaliser } from './osm-data.mjs';
import { ouvrirExports } from './exports-ui.mjs';

const $ = selector => document.querySelector(selector);
const $all = selector => [...document.querySelectorAll(selector)];
const sampleUrl = '/data/atelier-elkhroub.json';
const demoLayers = ['buildings', 'roads', 'landuse', 'water', 'rail', 'trees', 'parcels', 'pois'];
const initial = { lat: 36.2642, lon: 6.6969, radius: 600, shape: 'circle', boundary: [], name: 'El Khroub, Constantine', terrain: null };
let site = { ...initial };
let data = { roads: [], build: [], green: [], pois: [], trees: [], treeRows: [], parcels: [], landuse: [], rail: [], waterways: [], raw: [] };
let busy = false;
let boundaryDrawing = false;
let dataSignature = null;
let loadedInclude = new Set();

const map = createMap($('#map'), {
  lat: site.lat, lon: site.lon, zoom: 15, radius: site.radius, shape: site.shape, boundary: site.boundary,
  onCenter(lat, lon) {
    site.lat = lat; site.lon = lon;
    $('#latitude').value = lat.toFixed(6); $('#longitude').value = lon.toFixed(6);
    if (!boundaryDrawing && site.boundary.length >= 3 && !boundaryFits(site.boundary)) {
      site.boundary = [];
      map.clearBoundary();
      $('#message').textContent = 'Le centre de l’emprise a changé : la limite de projet, désormais hors site, a été effacée.';
    }
    updateCoordinates();
    if (site.name === 'El Khroub, Constantine') site.name = 'Emprise personnalisée';
    updatePlaceName();
    updateFreshness();
  },
  onBoundaryChange(points) {
    site.boundary = points;
    updateBoundaryStatus();
  }
});

function coordinates(lat = site.lat, lon = site.lon) {
  const ns = lat < 0 ? 'S' : 'N', ew = lon < 0 ? 'O' : 'E';
  return `${Math.abs(lat).toFixed(4)}° ${ns} · ${Math.abs(lon).toFixed(4)}° ${ew}`;
}
function updateCoordinates() {
  $('#coordinateText').textContent = coordinates();
  $('#mapBottomCoords').textContent = `${site.lat.toFixed(5)}, ${site.lon.toFixed(5)}`;
}
function updatePlaceName() {
  const name = (site.name || 'Emprise personnalisée').split(',').slice(0, 2).join(',').trim();
  $('#siteName').textContent = name;
  $('#mapLocation').textContent = name.toLocaleUpperCase('fr-FR');
}
function updateBoundaryStatus() {
  const count = map.getBoundary().length;
  $('#drawBoundary').setAttribute('aria-pressed', String(boundaryDrawing));
  $('#drawBoundary').textContent = boundaryDrawing ? 'Tracé en cours…' : 'Tracer sur la carte';
  $('#finishBoundary').disabled = !boundaryDrawing || count < 3;
  $('#undoBoundary').disabled = !boundaryDrawing || count === 0;
  $('#clearBoundary').disabled = count === 0;
  $('#boundaryStatus').textContent = boundaryDrawing
    ? `${count} point${count === 1 ? '' : 's'} · ajoutez au moins 3 points`
    : count >= 3 ? `Limite utilisateur · ${count} sommets` : 'Optionnelle';
  $('#map').classList.toggle('drawing-boundary', boundaryDrawing);
  const tip = $('#mapTip');
  if (tip) tip.textContent = boundaryDrawing
    ? 'Cliquez pour ajouter des sommets, puis « Terminer »'
    : 'Cliquez pour placer le centre · glissez pour explorer';
}
function updateFreshness(label = '') {
  const sameSite = dataSignature && Math.abs(dataSignature.lat - site.lat) < 1e-8 &&
    Math.abs(dataSignature.lon - site.lon) < 1e-8 && dataSignature.radius === site.radius;
  const selectedLayers = $all('.layer-row input:checked').map(box => box.value);
  const needsLayer = selectedLayers.some(layer => !loadedInclude.has(layer));
  const fresh = !!sameSite && !needsLayer;
  $('#openExports').disabled = !fresh;
  if (fresh) {
    if (label) $('#mapState').innerHTML = `<i></i> ${label}`;
  } else {
    $('#mapState').innerHTML = '<i></i> Emprise ou couches modifiées · récupérez les données pour actualiser';
  }
  return fresh;
}
function boundaryFits(points) {
  return points.every(([lat, lon]) => {
    const [x, y] = toLocal([lat, lon], { lat: site.lat, lon: site.lon });
    return insideShape(x, y, site.radius, site.shape);
  });
}
function updateRadius() {
  site.radius = Number($('#radius').value);
  site.shape = $('#baseShape').value === 'square' ? 'square' : 'circle';
  $('#radiusValue').value = site.radius;
  $('#radiusValue').textContent = site.radius;
  const area = areaForShape(site.shape, site.radius) / 1_000_000;
  $('#areaValue').textContent = `${area.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} km²`;
  $('#shapeLabel').textContent = site.shape === 'square' ? 'emprise carrée' : 'emprise circulaire';
  if (!boundaryDrawing && site.boundary.length >= 3 && !boundaryFits(site.boundary)) {
    site.boundary = [];
    map.clearBoundary();
    $('#message').textContent = 'La nouvelle emprise ne contient plus la limite tracée : celle-ci a été effacée.';
  }
  map.setShape(site.shape);
  map.setRadius(site.radius);
  updateFreshness();
}
function setData(d, terrain, label = '', include = demoLayers) {
  data = d;
  dataSignature = { lat: site.lat, lon: site.lon, radius: site.radius };
  loadedInclude = new Set(include);
  site.terrain = terrain || null;
  map.setData(dataPourExport());
  const count = data.raw?.length ?? 0;
  const summary = [
    data.build?.length ? `${data.build.length.toLocaleString('fr-FR')} bâtiments` : '',
    data.roads?.length ? `${data.roads.length.toLocaleString('fr-FR')} voies` : '',
    data.trees?.length ? `${data.trees.length.toLocaleString('fr-FR')} arbres` : '',
    data.parcels?.length ? `${data.parcels.length.toLocaleString('fr-FR')} parcelles` : ''
  ].filter(Boolean).join(' · ');
  $('#featureSummary').textContent = summary || `${count.toLocaleString('fr-FR')} objets chargés${label ? ' · ' + label : ''}`;
  updateFreshness(`${label || 'Données prêtes'} · ${count.toLocaleString('fr-FR')} objets OpenStreetMap`);
}
function updateSite(lat, lon, name = 'Emprise personnalisée', fit = true) {
  site.lat = Number(lat); site.lon = Number(lon); site.name = name;
  $('#latitude').value = site.lat.toFixed(6); $('#longitude').value = site.lon.toFixed(6);
  if (site.boundary.length >= 3 && !boundaryFits(site.boundary)) {
    site.boundary = [];
    map.clearBoundary();
    $('#message').textContent = 'Le lieu a changé : la limite de projet, désormais hors site, a été effacée.';
  }
  updateCoordinates(); updatePlaceName();
  map.setCenter(site.lat, site.lon, false);
  if (fit) map.setRadius(site.radius);
  updateFreshness();
}
function setBusy(value, text = '') {
  busy = value;
  $('#extractButton').disabled = value;
  $('#extractButton').classList.toggle('is-busy', value);
  $('#progress').hidden = !value;
  $('#progressText').textContent = text || 'Lecture des sources publiques…';
  $('#connectionDot').classList.toggle('is-busy', value);
}
async function postJSON(url, body) {
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body)
  });
  const result = await response.json();
  if (!response.ok || result.ok === false) throw new Error(result.detail || result.error || `HTTP ${response.status}`);
  return result;
}

async function loadDemo() {
  try {
    const response = await fetch(sampleUrl, { cache: 'force-cache' });
    if (!response.ok) throw new Error('demo missing');
    const demo = await response.json();
    site = { ...initial, lat: demo.site.lat, lon: demo.site.lon, radius: demo.site.R, name: demo.site.name, terrain: demo.terrain };
    $('#radius').value = site.radius;
    updateCoordinates(); updateRadius(); updatePlaceName();
    setData(normaliser(demo.elements), demo.terrain, 'Exemple local · El Khroub');
    $('#mapState').innerHTML = `<i></i> Exemple local · ${demo.elements.length.toLocaleString('fr-FR')} objets réels`;
  } catch {
    $('#message').textContent = 'L’exemple embarqué n’a pas pu être chargé. Vous pouvez quand même rechercher un lieu.';
  }
}

$('#radius').addEventListener('input', updateRadius);
$('#baseShape').addEventListener('change', updateRadius);
$('#drawBoundary').addEventListener('click', () => {
  boundaryDrawing = true;
  map.clearBoundary();
  map.setDrawMode('boundary');
  updateBoundaryStatus();
});
$('#finishBoundary').addEventListener('click', () => {
  try {
    const boundary = normalizeBoundary(map.getBoundary(), { lat: site.lat, lon: site.lon }, { maxPoints: 100, minArea: 25 });
    if (!boundaryFits(boundary)) throw new Error('BOUNDARY_OUTSIDE_STUDY');
    site.boundary = boundary;
    map.setBoundary(boundary);
    map.setDrawMode(null);
    boundaryDrawing = false;
    updateBoundaryStatus();
    $('#message').textContent = 'Limite de projet enregistrée. Elle sera exportée sur le calque SITE, distinct des parcelles OSM.';
  } catch (error) {
    const reasons = {
      BOUNDARY_NEEDS_THREE_POINTS: 'Ajoutez au moins trois points.',
      BOUNDARY_TOO_SMALL: 'La limite est trop petite pour former une emprise utile.',
      BOUNDARY_SELF_INTERSECTS: 'La limite se croise elle-même; ajustez les sommets.',
      BOUNDARY_TOO_MANY_POINTS: 'La limite dépasse 100 points.',
      BOUNDARY_OUTSIDE_STUDY: 'Gardez la limite à l’intérieur de l’emprise carrée ou circulaire.'
    };
    $('#message').textContent = reasons[error.message] || 'Les coordonnées de la limite sont invalides.';
  }
});
$('#undoBoundary').addEventListener('click', () => { map.undoBoundary(); updateBoundaryStatus(); });
$('#clearBoundary').addEventListener('click', () => {
  boundaryDrawing = false; map.setDrawMode(null); map.clearBoundary(); updateBoundaryStatus();
});
$('#homeMap').addEventListener('click', () => { map.setCenter(site.lat, site.lon, false); map.setRadius(site.radius); });
$('#zoomIn').addEventListener('click', () => map.zoomBy(1));
$('#zoomOut').addEventListener('click', () => map.zoomBy(-1));
$('#allLayers').addEventListener('click', e => {
  const boxes = $all('.layer-row input[type=checkbox]');
  const select = boxes.some(b => !b.checked);
  boxes.forEach(b => { b.checked = select; });
  e.currentTarget.textContent = select ? 'Tout décocher' : 'Tout cocher';
  map.setData(dataPourExport());
  updateFreshness();
});
$all('.layer-row input').forEach(box => box.addEventListener('change', () => {
  map.setData(dataPourExport()); updateFreshness();
}));
$('#coordinateToggle').addEventListener('click', () => {
  const edit = $('#coordinateEdit'); edit.hidden = !edit.hidden;
  if (!edit.hidden) $('#latitude').focus();
});
$('#applyCoordinates').addEventListener('click', () => {
  const lat = Number($('#latitude').value), lon = Number($('#longitude').value);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) {
    $('#message').textContent = 'Coordonnées incorrectes. Vérifiez latitude (−85 à 85) et longitude (−180 à 180).'; return;
  }
  updateSite(lat, lon, 'Emprise personnalisée'); $('#coordinateEdit').hidden = true;
});

$('#searchForm').addEventListener('submit', async event => {
  event.preventDefault();
  const query = $('#placeSearch').value.trim();
  if (query.length < 2) return;
  const resultsBox = $('#searchResults');
  resultsBox.hidden = false; resultsBox.innerHTML = '<button type="button" disabled>Recherche en cours…</button>';
  try {
    const result = await postJSON('/api/atelier/geocode', { q: query });
    if (!result.results.length) { resultsBox.innerHTML = '<button type="button" disabled>Aucun lieu trouvé.</button>'; return; }
    resultsBox.replaceChildren(...result.results.map(place => {
      const button = document.createElement('button'); button.type = 'button';
      button.textContent = place.name;
      const small = document.createElement('small'); small.textContent = `${Number(place.lat).toFixed(5)}, ${Number(place.lon).toFixed(5)}`;
      button.append(small);
      button.addEventListener('click', () => {
        updateSite(place.lat, place.lon, place.name);
        resultsBox.hidden = true; $('#placeSearch').value = '';
        $('#message').textContent = 'Lieu centré. Cliquez sur « Récupérer les données » pour actualiser les couches.';
      });
      return button;
    }));
  } catch (error) {
    resultsBox.innerHTML = '<button type="button" disabled>Recherche indisponible — cliquez sur la carte ou saisissez les coordonnées.</button>';
    $('#message').textContent = `Recherche interrompue : ${error.message}`;
  }
});
document.addEventListener('click', event => {
  if (!event.target.closest('#searchForm, #searchResults')) $('#searchResults').hidden = true;
});

$('#extractButton').addEventListener('click', async () => {
  if (busy) return;
  const include = $all('.layer-row input:checked').map(box => box.value);
  if (!include.length) { $('#message').textContent = 'Cochez au moins une couche avant la récupération.'; return; }
  const requestedSite = { lat: site.lat, lon: site.lon, radius: site.radius };
  $('#message').textContent = '';
  setBusy(true, 'Interrogation des miroirs OpenStreetMap…');
  try {
    const result = await postJSON('/api/atelier/extract', {
      ...requestedSite, include, terrainN: 24, terrain: true
    });
    site.terrain = result.terrain;
    const normalized = normaliser(result.elements);
    setData(normalized, result.terrain, 'Extraction en ligne', result.include);
    dataSignature = requestedSite;
    updateFreshness(`Extraction en ligne · ${result.elements.length.toLocaleString('fr-FR')} objets OpenStreetMap`);
    const missing = result.warnings?.includes('RELIEF_UNAVAILABLE');
    $('#message').textContent = missing
      ? 'Données cartographiques reçues ; le relief est temporairement indisponible. Les exports de courbes et de terrain 3D resteront incomplets.'
      : `${result.elements.length.toLocaleString('fr-FR')} objets reçus · données OSM à jour${result.extractedAt ? ' · ' + new Date(result.extractedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : ''}`;
  } catch (error) {
    $('#message').textContent = `Récupération impossible : ${error.message}. Le service OpenStreetMap peut être temporairement chargé ; réessayez dans un instant.`;
  } finally { setBusy(false); }
});

function dataPourExport() {
  const selected = new Set($all('.layer-row input:checked').map(box => box.value));
  return {
    ...data,
    build: selected.has('buildings') ? data.build : [],
    roads: selected.has('roads') ? data.roads : [],
    green: (data.green || []).filter(feature => feature.k === 'w' ? selected.has('water') : selected.has('landuse')),
    waterways: selected.has('water') ? data.waterways : [],
    landuse: selected.has('landuse') ? data.landuse : [],
    rail: selected.has('rail') ? data.rail : [],
    trees: selected.has('trees') ? data.trees : [],
    treeRows: selected.has('trees') ? data.treeRows : [],
    parcels: selected.has('parcels') ? data.parcels : [],
    pois: selected.has('pois') ? data.pois : []
  };
}
$('#openExports').addEventListener('click', () => {
  if (!updateFreshness()) { $('#message').textContent = 'Récupérez les données à nouveau : le lieu, le rayon ou les couches ont changé.'; return; }
  if (!data.raw?.length) { $('#message').textContent = 'Chargez un jeu de données ou utilisez l’exemple embarqué avant l’export.'; return; }
  const include = $all('.layer-row input:checked').map(box => box.value);
  ouvrirExports({ lat: site.lat, lon: site.lon, rayon: site.radius, shape: site.shape, boundary: site.boundary,
    nom: site.name, D: dataPourExport(), terrain: site.terrain, include, langue: 'fr' });
});
$('#helpButton').addEventListener('click', () => $('#helpDialog').showModal());
$('#helpDialog').addEventListener('click', e => { if (e.target === $('#helpDialog')) $('#helpDialog').close(); });

fetch('/api/atelier/health').then(r => r.ok ? $('#connectionDot').classList.remove('offline') : Promise.reject())
  .catch(() => { $('#connectionDot').classList.add('offline'); $('#message').textContent = 'Serveur hors ligne : les exports restent disponibles avec l’exemple chargé localement.'; });
updateCoordinates(); updateRadius(); updatePlaceName();
await loadDemo();
updateBoundaryStatus();
window.addEventListener('beforeunload', () => map.destroy(), { once: true });
