const MAP_VERSION = '4.1';
const COUNTRIES_URL = '/data/gadm-countries.json';
const API_URL = '/api/atelier/gadm';
const SVG_NS = 'http://www.w3.org/2000/svg';
const PALETTE = ['#d8e5d7', '#d4e2d5', '#e4e9d8', '#cddfd2', '#e2e6d3', '#d1e0db', '#e7e8d7', '#d5e1ca'];
const METADATA_FIELDS = [
  ['GID', level => `GID_${level}`],
  ['Nom officiel', level => `NAME_${level}`],
  ['Nom local', level => `NL_NAME_${level}`],
  ['Noms alternatifs', level => `VARNAME_${level}`],
  ['Type administratif', level => `TYPE_${level}`],
  ['Type (anglais)', level => `ENGTYPE_${level}`],
  ['Code local', level => `CC_${level}`],
  ['HASC', level => `HASC_${level}`],
  ['ISO', level => `ISO_${level}`],
  ['Valide depuis', level => `VALIDFR_${level}`],
  ['Valide jusqu’à', level => `VALIDTO_${level}`],
  ['Remarques', level => `REMARKS_${level}`]
];
const THEMES = {
  admin: { label: 'Limites administratives', title: 'Frontières vectorielles' },
  elevation: { directory: 'elevation', suffix: 'elevation', label: 'Altitude au-dessus du niveau de la mer (m)', title: 'Altitude · m' },
  elevation_mask: { directory: 'elevation', suffix: 'elevation_mask', label: 'Altitude · zones masquées', title: 'Altitude · masque' },
  temperature: { directory: 'climate', suffix: 'temperature', label: 'Température annuelle moyenne (°C)', title: 'Température annuelle · °C' },
  temperature_mask: { directory: 'climate', suffix: 'temperature_mask', label: 'Température annuelle · zones masquées', title: 'Température · masque' },
  precipitation: { directory: 'climate', suffix: 'precipitation', label: 'Précipitations annuelles totales (mm)', title: 'Précipitations annuelles · mm' },
  precipitation_mask: { directory: 'climate', suffix: 'precipitation_mask', label: 'Précipitations · zones masquées', title: 'Précipitations · masque' },
  nightlight: { directory: 'nightlight', suffix: 'nightlight', label: 'Éclairage nocturne', title: 'Éclairage nocturne' },
  nightlight_mask: { directory: 'nightlight', suffix: 'nightlight_mask', label: 'Éclairage nocturne · zones masquées', title: 'Éclairage nocturne · masque' }
};
const WORLD_DOWNLOADS = {
  '4.1': [
    { label: 'GeoPackage · monde', note: '1,47 Go · tous niveaux dans une base', url: 'https://geodata.ucdavis.edu/gadm/gadm4.1/gadm_410-gpkg.zip' },
    { label: 'Geodatabase · monde', note: '957 Mo · format Esri', url: 'https://geodata.ucdavis.edu/gadm/gadm4.1/gadm_410-gdb.zip' },
    { label: 'Couches par niveau · monde', note: '2,68 Go · GeoPackage', url: 'https://geodata.ucdavis.edu/gadm/gadm4.1/gadm_410-levels.zip' }
  ],
  '4.0': [
    { label: 'GeoPackage · monde', note: '1,16 Go · version 4.0.4', url: 'https://geodata.ucdavis.edu/gadm/gadm4.0/gadm404-gpkg.zip' },
    { label: 'Shapefile · monde', note: '1,13 Go · version 4.0.4', url: 'https://geodata.ucdavis.edu/gadm/gadm4.0/gadm404-shp.zip' },
    { label: 'Couches par niveau · monde', note: '1,94 Go · GeoPackage', url: 'https://geodata.ucdavis.edu/gadm/gadm4.0/gadm404-levels.zip' }
  ],
  '3.6': [
    { label: 'GeoPackage · monde', note: '574 Mo · tous niveaux', url: 'https://geodata.ucdavis.edu/gadm/gadm3.6/gadm36_gpkg.zip' },
    { label: 'Shapefile · monde', note: '563 Mo · tous niveaux', url: 'https://geodata.ucdavis.edu/gadm/gadm3.6/gadm36_shp.zip' },
    { label: 'Couches par niveau · monde', note: '1,29 Go · GeoPackage', url: 'https://geodata.ucdavis.edu/gadm/gadm3.6/gadm36_levels_gpkg.zip' },
    { label: 'Couches par niveau · monde', note: '1,26 Go · Shapefile', url: 'https://geodata.ucdavis.edu/gadm/gadm3.6/gadm36_levels_shp.zip' }
  ]
};

const $ = selector => document.querySelector(selector);
const state = {
  country: 'DZA',
  countryRows: [],
  countriesByVersion: {},
  level: 0,
  parent: null,
  features: [],
  selectedKey: null,
  downloadVersion: '4.1',
  zoom: 1,
  renderedFeatures: [],
  requestId: 0
};

function getCountryRows(version = '4.1') {
  return state.countriesByVersion[version] || [];
}
function getCountry(code = state.country, version = '4.1') {
  return getCountryRows(version).find(country => country.code === code) || null;
}
function levelLabel(level) {
  return level === 0 ? 'Pays · niveau 0' : `Subdivision · niveau ${level}`;
}
function currentProperties(feature) {
  return feature?.properties && typeof feature.properties === 'object' ? feature.properties : {};
}
function currentName(feature, level = state.level) {
  const properties = currentProperties(feature);
  return String(properties[`NAME_${level}`] || properties.NAME_0 || properties.COUNTRY || 'Unité sans nom');
}
function currentGid(feature, level = state.level) {
  const properties = currentProperties(feature);
  return String(properties[`GID_${level}`] || feature?.id || currentName(feature, level));
}
function featureKey(feature, level = state.level) {
  return currentGid(feature, level);
}
function selectedFeature() {
  return state.features.find(feature => featureKey(feature) === state.selectedKey) || null;
}
function safeText(value) {
  if (value === undefined || value === null || value === '') return '';
  return String(value);
}
function setStatus(message = '') {
  $('#gadm-map-status').textContent = message;
}

function populateCountrySelect() {
  const select = $('#gadm-country');
  select.replaceChildren();
  const countries = [...state.countryRows].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  for (const country of countries) {
    const option = document.createElement('option');
    option.value = country.code;
    option.textContent = country.name;
    select.append(option);
  }
  if (!countries.some(country => country.code === state.country)) state.country = countries[0]?.code || 'DZA';
  select.value = state.country;
}

function populateLevelSelect() {
  const select = $('#gadm-level');
  select.replaceChildren();
  const country = getCountry(state.country, '4.1');
  const maxLevel = country?.maxLevel ?? 0;
  state.level = Math.min(state.level, maxLevel);
  for (let level = 0; level <= maxLevel; level++) {
    const option = document.createElement('option');
    option.value = String(level);
    option.textContent = level === 0 ? 'Niveau 0 · Pays' : `Niveau ${level} · subdivisions`;
    select.append(option);
  }
  select.value = String(state.level);
}

function updateCountryLabels() {
  const country = getCountry(state.country, '4.1');
  const name = country?.name || state.country;
  $('#gadm-list-title').textContent = `${name} · ${levelLabel(state.level)}`;
  const themeSelect = $('#gadm-theme');
  updateTheme(themeSelect.value);
  renderDownloads();
}

function renderParentControls() {
  const parentName = state.parent?.name;
  $('#gadm-parent-label').textContent = parentName
    ? `Sous-unités de ${parentName} · GID ${state.parent.gid}`
    : 'Vue nationale · sélectionnez une unité pour consulter sa fiche.';
  $('#gadm-back').disabled = !state.parent;
  const country = getCountry(state.country, '4.1');
  const maxLevel = country?.maxLevel ?? 0;
  $('#gadm-descend').disabled = !selectedFeature() || state.level >= maxLevel;
  $('#gadm-descend').textContent = state.level >= maxLevel ? 'Niveau le plus détaillé' : 'Explorer le niveau inférieur →';
}

function createMetaRow(label, value) {
  const row = document.createElement('div');
  row.className = 'gadm-meta-row';
  const term = document.createElement('dt');
  term.textContent = label;
  const definition = document.createElement('dd');
  definition.textContent = value;
  row.append(term, definition);
  return row;
}

function renderInspector() {
  const feature = selectedFeature();
  const country = getCountry(state.country, '4.1');
  const defaultName = country?.name || state.country;
  $('#gadm-selected-level').textContent = `NIVEAU ${state.level}`;
  $('#gadm-selected-name').textContent = feature ? currentName(feature) : defaultName;
  const props = currentProperties(feature);
  const localType = safeText(props[`TYPE_${state.level}`]);
  const englishType = safeText(props[`ENGTYPE_${state.level}`]);
  $('#gadm-selected-type').textContent = feature
    ? [localType, englishType].filter(Boolean).join(' · ') || levelLabel(state.level)
    : `${levelLabel(state.level)} · aperçu GADM ${MAP_VERSION}`;

  const target = $('#gadm-selected-meta');
  target.replaceChildren();
  if (!feature) {
    const empty = document.createElement('p');
    empty.className = 'gadm-inspector-empty';
    empty.textContent = 'Cliquez sur une unité dans la carte ou la liste pour afficher son identifiant et ses métadonnées.';
    target.append(empty);
  } else {
    for (const [label, getField] of METADATA_FIELDS) {
      const value = safeText(props[getField(state.level)]);
      if (value) target.append(createMetaRow(label, value));
    }
    if (state.level > 0 && safeText(props.COUNTRY)) target.append(createMetaRow('Pays', safeText(props.COUNTRY)));
  }
  renderParentControls();
}

function searchValue(feature) {
  const properties = currentProperties(feature);
  const fields = [
    properties[`NAME_${state.level}`], properties[`GID_${state.level}`], properties[`TYPE_${state.level}`],
    properties[`ENGTYPE_${state.level}`], properties[`VARNAME_${state.level}`], properties[`NL_NAME_${state.level}`]
  ];
  return fields.filter(Boolean).join(' ').toLocaleLowerCase();
}

function renderFeatureList() {
  const host = $('#gadm-feature-list');
  host.replaceChildren();
  const query = $('#gadm-feature-search').value.trim().toLocaleLowerCase();
  const sorted = [...state.features].sort((a, b) => currentName(a).localeCompare(currentName(b), 'fr'));
  const matches = query ? sorted.filter(feature => searchValue(feature).includes(query)) : sorted;
  $('#gadm-feature-count').textContent = `${matches.length.toLocaleString('fr-FR')}${query ? ` / ${state.features.length.toLocaleString('fr-FR')}` : ''}`;
  const maxShown = 320;
  for (const feature of matches.slice(0, maxShown)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', String(featureKey(feature) === state.selectedKey));
    button.dataset.featureKey = featureKey(feature);
    const name = document.createElement('strong');
    name.textContent = currentName(feature);
    const secondary = document.createElement('small');
    const props = currentProperties(feature);
    const type = safeText(props[`ENGTYPE_${state.level}`] || props[`TYPE_${state.level}`]);
    const gid = safeText(props[`GID_${state.level}`]);
    secondary.textContent = [type, gid].filter(Boolean).join(' · ') || `Niveau ${state.level}`;
    button.append(name, secondary);
    button.addEventListener('click', () => selectFeature(feature));
    host.append(button);
  }
  if (!matches.length) {
    const empty = document.createElement('p');
    empty.className = 'gadm-list-empty';
    empty.textContent = state.features.length ? 'Aucune unité ne correspond à ce filtre.' : 'Aucune unité chargée.';
    host.append(empty);
  } else if (matches.length > maxShown) {
    const more = document.createElement('p');
    more.className = 'gadm-list-empty';
    more.textContent = `Affichage des ${maxShown} premiers résultats. Affinez la recherche pour parcourir la suite.`;
    host.append(more);
  }
}

function normalizeLongitude(value) {
  return ((value % 360) + 360) % 360;
}
function collectCoordinates(value, output) {
  if (!Array.isArray(value)) return;
  if (value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])) {
    output.push(value);
    return;
  }
  for (const child of value) collectCoordinates(child, output);
}
function geometryCoordinates(geometry, output) {
  if (!geometry) return;
  if (geometry.type === 'GeometryCollection') {
    for (const item of geometry.geometries || []) geometryCoordinates(item, output);
  } else {
    collectCoordinates(geometry.coordinates, output);
  }
}

function createProjection(features) {
  const coords = [];
  for (const feature of features) geometryCoordinates(feature.geometry, coords);
  if (!coords.length) return null;

  const longitudes = coords.map(point => normalizeLongitude(point[0])).sort((a, b) => a - b);
  let largestGap = -1;
  let gapIndex = 0;
  for (let index = 0; index < longitudes.length; index++) {
    const next = index === longitudes.length - 1 ? longitudes[0] + 360 : longitudes[index + 1];
    const gap = next - longitudes[index];
    if (gap > largestGap) { largestGap = gap; gapIndex = index; }
  }
  const start = longitudes[(gapIndex + 1) % longitudes.length];
  const span = Math.max(0.001, 360 - largestGap);
  let minX = Infinity, maxX = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const point of coords) {
    let delta = normalizeLongitude(point[0]) - start;
    if (delta < 0) delta += 360;
    if (delta > span && delta - span > 180) delta -= 360;
    minX = Math.min(minX, delta);
    maxX = Math.max(maxX, delta);
    const lat = Math.max(-89.5, Math.min(89.5, point[1]));
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  if (maxX - minX < 0.001) { minX -= 0.5; maxX += 0.5; }
  if (maxLat - minLat < 0.001) { minLat -= 0.5; maxLat += 0.5; }
  const centerLat = (minLat + maxLat) / 2;
  const longitudeScale = Math.max(0.15, Math.cos(centerLat * Math.PI / 180));
  const xMin = minX * longitudeScale, xMax = maxX * longitudeScale;
  const yRange = maxLat - minLat;
  const xRange = Math.max(0.001, xMax - xMin);
  const margin = 38;
  const scale = Math.min((900 - margin * 2) / xRange, (560 - margin * 2) / yRange);
  const extraX = 900 - margin * 2 - xRange * scale;
  const extraY = 560 - margin * 2 - yRange * scale;
  return point => {
    let delta = normalizeLongitude(point[0]) - start;
    if (delta < 0) delta += 360;
    if (delta > span && delta - span > 180) delta -= 360;
    const x = margin + extraX / 2 + (delta * longitudeScale - xMin) * scale;
    const lat = Math.max(-89.5, Math.min(89.5, point[1]));
    const y = margin + extraY / 2 + (maxLat - lat) * scale;
    return [x, y];
  };
}

function linePath(points, project, close = false) {
  if (!Array.isArray(points) || points.length < 2) return '';
  const converted = points.map(point => project(point));
  let path = `M${converted[0][0].toFixed(2)},${converted[0][1].toFixed(2)}`;
  for (let index = 1; index < converted.length; index++)
    path += `L${converted[index][0].toFixed(2)},${converted[index][1].toFixed(2)}`;
  return close ? `${path}Z` : path;
}
function geometryPath(geometry, project) {
  if (!geometry) return '';
  switch (geometry.type) {
    case 'Polygon': return (geometry.coordinates || []).map(ring => linePath(ring, project, true)).join('');
    case 'MultiPolygon': return (geometry.coordinates || []).flatMap(polygon =>
      polygon.map(ring => linePath(ring, project, true))).join('');
    case 'LineString': return linePath(geometry.coordinates, project, false);
    case 'MultiLineString': return (geometry.coordinates || []).map(line => linePath(line, project, false)).join('');
    case 'GeometryCollection': return (geometry.geometries || []).map(item => geometryPath(item, project)).join('');
    default: return '';
  }
}

function renderMap() {
  const svg = $('#gadm-vector-map');
  svg.replaceChildren();
  state.renderedFeatures = [];
  if (!state.features.length) return;
  const selected = selectedFeature();
  const limit = 2800;
  const shown = state.features.slice(0, limit);
  if (selected && !shown.includes(selected)) shown.push(selected);
  const projection = createProjection(shown);
  if (!projection) return;
  state.renderedFeatures = shown;
  const group = document.createElementNS(SVG_NS, 'g');
  group.setAttribute('class', 'gadm-feature-layer');
  const limited = state.features.length > limit;
  for (let index = 0; index < shown.length; index++) {
    const feature = shown[index];
    const path = document.createElementNS(SVG_NS, 'path');
    const key = featureKey(feature);
    path.setAttribute('d', geometryPath(feature.geometry, projection));
    path.setAttribute('class', `gadm-feature-shape${key === state.selectedKey ? ' is-selected' : ''}`);
    path.setAttribute('fill', feature.geometry?.type === 'LineString' ? 'none' : PALETTE[index % PALETTE.length]);
    path.setAttribute('fill-rule', 'evenodd');
    path.setAttribute('data-feature-index', String(index));
    path.setAttribute('role', 'button');
    path.setAttribute('tabindex', '0');
    path.setAttribute('aria-label', `${currentName(feature)} · ${key}`);
    group.append(path);
  }
  svg.append(group);
  svg.style.transform = `scale(${state.zoom})`;
  if (limited) {
    setStatus(`Aperçu des ${limit.toLocaleString('fr-FR')} premières unités. Filtrez la liste ou explorez un parent pour afficher plus de détails.`);
  } else {
    setStatus('');
  }
}

function selectFeature(feature) {
  state.selectedKey = featureKey(feature);
  renderFeatureList();
  renderInspector();
  renderMap();
  const match = [...$('#gadm-feature-list').querySelectorAll('button')].find(button => button.dataset.featureKey === state.selectedKey);
  if (match) match.scrollIntoView({ block: 'nearest' });
}

function themeImageUrl(themeKey) {
  const theme = THEMES[themeKey];
  if (!theme || !theme.directory || !theme.suffix) return '';
  const code = encodeURIComponent(state.country);
  return `https://gadm.org/img/480/${theme.directory}/${code}/${code}_${theme.suffix}.png`;
}

function updateTheme(themeKey) {
  const theme = THEMES[themeKey] || THEMES.admin;
  const image = $('#gadm-theme-image');
  const panel = $('#gadm-theme-panel');
  const svg = $('#gadm-vector-map');
  const isAdmin = themeKey === 'admin' || !theme.directory;
  svg.hidden = !isAdmin;
  panel.hidden = isAdmin;
  const mapContext = isAdmin ? `GADM ${MAP_VERSION}` : (getCountry(state.country, '4.1')?.name || state.country);
  $('#gadm-map-title').textContent = `${theme.title} · ${mapContext}`;
  if (isAdmin) {
    image.removeAttribute('src');
    $('#gadm-theme-fallback').hidden = true;
    $('#gadm-map-caption').textContent = 'Aperçu vectoriel pour consultation ; les téléchargements conservent les géométries officielles complètes.';
    return;
  }
  $('#gadm-map-caption').textContent = `${theme.label} · aperçu raster national servi par GADM ; non lié aux versions historiques des téléchargements.`;
  $('#gadm-theme-fallback').hidden = true;
  image.alt = `${theme.label}, ${getCountry(state.country, '4.1')?.name || state.country} · aperçu GADM`;
  image.onload = () => { $('#gadm-theme-fallback').hidden = true; };
  image.onerror = () => { $('#gadm-theme-fallback').hidden = false; };
  image.src = themeImageUrl(themeKey);
}

function buildDownloadUrl(version, country, kind, level) {
  const root = `https://geodata.ucdavis.edu/gadm/gadm${version}/`;
  const fileVersion = `gadm${version.replace('.', '')}`;
  if (version === '3.6') {
    if (kind === 'gpkg') return `${root}gpkg/${fileVersion}_${country}_gpkg.zip`;
    if (kind === 'shp') return `${root}shp/${fileVersion}_${country}_shp.zip`;
    if (kind === 'kmz') return `${root}kmz/${fileVersion}_${country}_${level}.kmz`;
    return '';
  }
  if (kind === 'geojson') return `${root}json/${fileVersion}_${country}_${level}.json`;
  if (kind === 'geojsonZip') return `${root}json/${fileVersion}_${country}_${level}.json.zip`;
  if (kind === 'gpkg') return `${root}gpkg/${fileVersion}_${country}.gpkg`;
  if (kind === 'shp') return `${root}shp/${fileVersion}_${country}_shp.zip`;
  if (kind === 'kmz') return `${root}kmz/${fileVersion}_${country}_${level}.kmz`;
  if (kind === 'kml' && version === '4.1') return `${root}kmz/${fileVersion}_${country}_${level}.kml`;
  return '';
}

function makeDownloadCard({ label, note, url, badge = 'Téléchargement direct' }) {
  const card = document.createElement('article');
  card.className = 'gadm-download-card';
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.textContent = label;
  const description = document.createElement('p');
  description.textContent = note;
  const hint = document.createElement('small');
  hint.textContent = badge;
  card.append(link, description, hint);
  return card;
}

function renderDownloads() {
  const host = $('#gadm-downloads');
  if (!host) return;
  host.replaceChildren();
  const version = state.downloadVersion;
  const country = getCountry(state.country, version);
  const name = getCountry(state.country, '4.1')?.name || state.country;
  if (!country) {
    $('#gadm-download-note').textContent = `${name} n’est pas proposé dans l’archive GADM ${version}. Consultez la page officielle des anciennes versions.`;
    const link = makeDownloadCard({
      label: `Pays disponibles · GADM ${version}`,
      note: 'Ouvrir la liste officielle des pays et des niveaux.',
      url: version === '3.6' ? 'https://gadm.org/download_country36.html' : 'https://gadm.org/download_country40.html',
      badge: 'Site officiel GADM'
    });
    host.append(link);
    renderWorldDownloads();
    return;
  }

  const downloadLevel = Math.min(state.level, country.maxLevel);
  const levelText = `niveau ${downloadLevel}`;
  const levelNotice = state.level > country.maxLevel
    ? `Cette archive s’arrête au niveau ${country.maxLevel} ; les formats par niveau utilisent ce niveau maximal.`
    : `Les formats par niveau suivent ${levelText}.`;
  const assets = [];
  if (version === '3.6') {
    assets.push(
      { kind: 'kmz', label: `KMZ · ${levelText}`, note: 'Contours pour Google Earth, au niveau sélectionné.' },
      { kind: 'gpkg', label: 'GeoPackage · pays', note: 'Tous les niveaux disponibles, regroupés en ZIP.' },
      { kind: 'shp', label: 'Shapefile · pays', note: 'Tous les niveaux disponibles, regroupés en ZIP.' }
    );
  } else {
    assets.push(
      { kind: 'geojson', label: `GeoJSON · ${levelText}`, note: 'Fichier vectoriel web, non compressé.' },
      { kind: 'geojsonZip', label: `GeoJSON ZIP · ${levelText}`, note: 'Même couche, compressée en ZIP.' },
      { kind: 'kmz', label: `KMZ · ${levelText}`, note: 'Contours pour Google Earth.' },
      { kind: 'gpkg', label: 'GeoPackage · pays', note: 'Base du pays ; plusieurs niveaux administratifs.' },
      { kind: 'shp', label: 'Shapefile · pays', note: 'Archives par pays ; plusieurs niveaux.' }
    );
    if (version === '4.1') assets.splice(3, 0, { kind: 'kml', label: `KML · ${levelText}`, note: 'Fichier KML lisible dans les outils cartographiques.' });
  }
  for (const asset of assets) {
    const url = buildDownloadUrl(version, state.country, asset.kind, downloadLevel);
    if (url) host.append(makeDownloadCard({ label: asset.label, note: asset.note, url, badge: `GADM ${version}` }));
  }
  $('#gadm-download-note').textContent = `${levelNotice} GeoPackage et Shapefile couvrent le pays et plusieurs niveaux.`;
  renderWorldDownloads();
}

function renderWorldDownloads() {
  const host = $('#gadm-world-downloads');
  if (!host) return;
  host.replaceChildren();
  for (const item of WORLD_DOWNLOADS[state.downloadVersion] || []) {
    host.append(makeDownloadCard({ ...item, badge: `GADM ${state.downloadVersion} · monde` }));
  }
}

async function loadBoundaries() {
  const country = getCountry(state.country, '4.1');
  const requestId = ++state.requestId;
  const versionName = country?.name || state.country;
  const params = new URLSearchParams({ country: state.country, level: String(state.level), version: MAP_VERSION });
  if (state.parent) {
    params.set('parent', state.parent.gid);
    params.set('parentLevel', String(state.parent.level));
  }
  setStatus('Lecture des limites officielles GADM…');
  $('#gadm-map-caption').textContent = 'Connexion à la source officielle ; préparation de l’aperçu vectoriel…';
  $('#gadm-list-title').textContent = `${versionName} · ${levelLabel(state.level)}`;
  try {
    const response = await fetch(`${API_URL}?${params.toString()}`, { headers: { Accept: 'application/geo+json, application/json' } });
    const data = await response.json();
    if (requestId !== state.requestId) return;
    if (!response.ok || data.ok === false) {
      const messages = {
        GADM_LEVEL_UNAVAILABLE: 'Ce niveau n’existe pas dans cette version pour le pays choisi.',
        GADM_PREVIEW_TOO_LARGE: 'Aperçu trop volumineux. Choisissez une unité parentale ou téléchargez le fichier officiel.',
        GADM_SOURCE_TOO_LARGE: 'Fichier source trop volumineux pour l’aperçu. Téléchargez-le directement.',
        GADM_TIMEOUT: 'La source GADM met trop de temps à répondre. Réessayez dans un instant.',
        GADM_UNAVAILABLE: 'La source GADM est temporairement indisponible.'
      };
      const message = messages[data.error] || data.message || 'Impossible de charger ces limites GADM.';
      state.features = [];
      state.selectedKey = null;
      renderFeatureList();
      renderInspector();
      renderMap();
      setStatus(message);
      $('#gadm-map-caption').textContent = 'Les téléchargements officiels restent disponibles même si l’aperçu ne se charge pas.';
      return;
    }
    state.features = Array.isArray(data.features) ? data.features : [];
    if (state.parent && state.parent.level === 0 && state.level === 1 && state.features.length === 0) {
      state.features = [];
    }
    state.selectedKey = state.features.length ? featureKey(state.features[0]) : null;
    const previewLabel = data.gadm?.previewGeneralized ? 'Aperçu géométrique allégé' : 'Aperçu vectoriel';
    $('#gadm-map-caption').textContent = `${previewLabel} · ${state.features.length.toLocaleString('fr-FR')} unité${state.features.length === 1 ? '' : 's'}. Les fichiers téléchargés gardent les géométries officielles complètes.`;
    renderFeatureList();
    renderInspector();
    renderMap();
    if (!state.features.length) setStatus('Aucune subdivision disponible sous cette unité.');
  } catch (error) {
    if (requestId !== state.requestId) return;
    state.features = [];
    state.selectedKey = null;
    renderFeatureList();
    renderInspector();
    renderMap();
    setStatus('Erreur réseau pendant la lecture de GADM. Vérifiez la connexion puis réessayez.');
    $('#gadm-map-caption').textContent = String(error?.message || 'Source indisponible');
  }
}

function changeCountry() {
  state.country = $('#gadm-country').value;
  state.level = 0;
  state.parent = null;
  state.selectedKey = null;
  state.zoom = 1;
  $('#gadm-feature-search').value = '';
  populateLevelSelect();
  updateCountryLabels();
  loadBoundaries();
}

function drillDown() {
  const feature = selectedFeature();
  if (!feature) return;
  const country = getCountry(state.country, '4.1');
  if (state.level >= (country?.maxLevel ?? 0)) return;
  state.parent = { gid: currentGid(feature), level: state.level, name: currentName(feature) };
  state.level += 1;
  state.zoom = 1;
  $('#gadm-level').value = String(state.level);
  $('#gadm-feature-search').value = '';
  updateCountryLabels();
  loadBoundaries();
}

function moveUp() {
  if (!state.parent) return;
  const oldParent = state.parent;
  state.level = oldParent.level;
  state.parent = null;
  state.zoom = 1;
  state.selectedKey = oldParent.gid;
  $('#gadm-level').value = String(state.level);
  $('#gadm-feature-search').value = '';
  updateCountryLabels();
  loadBoundaries().then(() => {
    if (state.features.some(feature => featureKey(feature) === oldParent.gid)) selectFeature(state.features.find(feature => featureKey(feature) === oldParent.gid));
  });
}

function resetZoom() {
  state.zoom = 1;
  $('#gadm-vector-map').style.transform = 'scale(1)';
}

function initMapEvents() {
  $('#gadm-vector-map').addEventListener('click', event => {
    const path = event.target.closest('.gadm-feature-shape');
    if (!path) return;
    const index = Number(path.getAttribute('data-feature-index'));
    const feature = state.renderedFeatures[index];
    if (feature) selectFeature(feature);
  });
  $('#gadm-vector-map').addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const path = event.target.closest('.gadm-feature-shape');
    if (!path) return;
    event.preventDefault();
    const feature = state.renderedFeatures[Number(path.getAttribute('data-feature-index'))];
    if (feature) selectFeature(feature);
  });
  $('#gadm-zoom-in').addEventListener('click', () => {
    state.zoom = Math.min(3.2, state.zoom + 0.2);
    $('#gadm-vector-map').style.transform = `scale(${state.zoom})`;
  });
  $('#gadm-zoom-out').addEventListener('click', () => {
    state.zoom = Math.max(0.8, state.zoom - 0.2);
    $('#gadm-vector-map').style.transform = `scale(${state.zoom})`;
  });
  $('#gadm-zoom-fit').addEventListener('click', resetZoom);
  $('#gadm-theme').addEventListener('change', event => updateTheme(event.target.value));
}

export async function initGadmAtlas() {
  const root = $('#atlas-administratif');
  if (!root) return;
  try {
    const response = await fetch(COUNTRIES_URL, { cache: 'no-cache' });
    if (!response.ok) throw new Error('COUNTRY_LIST_UNAVAILABLE');
    const data = await response.json();
    state.countryRows = Array.isArray(data.countries) ? data.countries : [];
    state.countriesByVersion = data.countriesByVersion || { '4.1': state.countryRows };
  } catch {
    state.countryRows = [{ code: 'DZA', name: 'Algérie', maxLevel: 2 }];
    state.countriesByVersion = { '4.1': state.countryRows, '4.0': state.countryRows, '3.6': state.countryRows };
    setStatus('Liste pays indisponible ; l’Algérie reste sélectionnée.');
  }

  populateCountrySelect();
  populateLevelSelect();
  $('#gadm-level').addEventListener('change', event => {
    state.level = Number(event.target.value);
    state.parent = null;
    state.selectedKey = null;
    state.zoom = 1;
    $('#gadm-feature-search').value = '';
    updateCountryLabels();
    loadBoundaries();
  });
  $('#gadm-country').addEventListener('change', changeCountry);
  $('#gadm-download-version').addEventListener('change', event => {
    state.downloadVersion = event.target.value;
    $('#gadm-version-note').textContent = `Aperçu vectoriel : GADM ${MAP_VERSION} · archives ${state.downloadVersion} pour les téléchargements`;
    renderDownloads();
  });
  $('#gadm-feature-search').addEventListener('input', renderFeatureList);
  $('#gadm-descend').addEventListener('click', drillDown);
  $('#gadm-back').addEventListener('click', moveUp);
  initMapEvents();
  updateCountryLabels();
  $('#gadm-version-note').textContent = `Aperçu vectoriel : GADM ${MAP_VERSION} · données d’archive sélectionnables pour les téléchargements`;
  const defaultCountry = getCountry('DZA', '4.1');
  state.selectedKey = 'DZA';
  $('#gadm-selected-name').textContent = defaultCountry?.name || 'Algérie';
  loadBoundaries();
}
