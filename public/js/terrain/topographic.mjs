const SVG_NS = 'http://www.w3.org/2000/svg';
const D2R = Math.PI / 180;
const COLOR_STOPS = [
  [0.00, [32, 95, 113]],
  [0.18, [49, 137, 118]],
  [0.38, [117, 166, 104]],
  [0.57, [192, 189, 116]],
  [0.74, [213, 157, 91]],
  [0.89, [157, 105, 78]],
  [1.00, [239, 228, 202]]
];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finiteNumber = value => value !== null && value !== '' && Number.isFinite(Number(value));
const toHex = value => Math.round(value).toString(16).padStart(2, '0');

function rowsOf(terrain) {
  if (!Array.isArray(terrain?.grid) || terrain.grid.length < 2) return null;
  const rows = terrain.grid.slice(0, 256).map(row => Array.isArray(row) ? row : []);
  const columns = Math.min(256, ...rows.map(row => row.length));
  return columns >= 2 ? { rows, rowCount: rows.length, columnCount: columns } : null;
}

export function terrainExtent(terrain) {
  const grid = rowsOf(terrain);
  const lat = Number(terrain?.lat), lon = Number(terrain?.lon), radius = Number(terrain?.radius);
  if (!grid || !Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(radius) || radius <= 0 || Math.abs(lat) > 85 || Math.abs(lon) > 180)
    return null;
  const dy = radius / 111320;
  const dx = dy / Math.max(0.08, Math.cos(lat * D2R));
  return {
    north: lat + dy, south: lat - dy, west: lon - dx, east: lon + dx,
    centerLat: lat, centerLon: lon, radius,
    rows: grid.rows, rowCount: grid.rowCount, columnCount: grid.columnCount
  };
}

export function terrainStats(terrain) {
  const grid = rowsOf(terrain);
  if (!grid) return null;
  let min = Infinity, max = -Infinity, count = 0;
  for (const row of grid.rows) for (let col = 0; col < grid.columnCount; col++) {
    const value = row[col];
    if (!finiteNumber(value)) continue;
    const number = Number(value);
    min = Math.min(min, number); max = Math.max(max, number); count++;
  }
  return count ? { min, max, count, rows: grid.rowCount, columns: grid.columnCount } : null;
}

export function contourInterval(min, max) {
  const range = Math.max(0, Number(max) - Number(min));
  if (!Number.isFinite(range) || range <= 0) return 0;
  const target = range / 10;
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const candidates = [1, 2, 2.5, 5, 10].map(value => value * magnitude);
  return candidates.find(value => value >= target) || 10 * magnitude;
}

export function terrainColor(value, min, max) {
  const range = Number(max) - Number(min);
  const t = range > 0 ? clamp((Number(value) - Number(min)) / range, 0, 1) : 0.5;
  for (let index = 1; index < COLOR_STOPS.length; index++) {
    const [end, endColor] = COLOR_STOPS[index];
    const [start, startColor] = COLOR_STOPS[index - 1];
    if (t <= end) {
      const amount = (t - start) / (end - start);
      const rgb = startColor.map((channel, i) => channel + (endColor[i] - channel) * amount);
      return `#${rgb.map(toHex).join('')}`;
    }
  }
  return `#${COLOR_STOPS.at(-1)[1].map(toHex).join('')}`;
}

export function sampleTerrain(terrain, lat, lon) {
  if (!terrainStats(terrain)) return { status: 'not-loaded' };
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) return { status: 'invalid-point' };
  const extent = terrainExtent(terrain);
  if (!extent) return { status: 'invalid-terrain' };
  const latitude = Number(lat), longitude = Number(lon);
  const epsilon = 1e-10;
  if (latitude < extent.south - epsilon || latitude > extent.north + epsilon ||
      longitude < extent.west - epsilon || longitude > extent.east + epsilon) return { status: 'outside', extent };

  const rowPosition = clamp((extent.north - latitude) / (extent.north - extent.south) * (extent.rowCount - 1), 0, extent.rowCount - 1);
  const columnPosition = clamp((longitude - extent.west) / (extent.east - extent.west) * (extent.columnCount - 1), 0, extent.columnCount - 1);
  const row0 = Math.floor(rowPosition), row1 = Math.min(extent.rowCount - 1, row0 + 1);
  const column0 = Math.floor(columnPosition), column1 = Math.min(extent.columnCount - 1, column0 + 1);
  const rowFraction = rowPosition - row0, columnFraction = columnPosition - column0;
  const candidates = [
    [extent.rows[row0][column0], (1 - rowFraction) * (1 - columnFraction)],
    [extent.rows[row0][column1], (1 - rowFraction) * columnFraction],
    [extent.rows[row1][column0], rowFraction * (1 - columnFraction)],
    [extent.rows[row1][column1], rowFraction * columnFraction]
  ];
  let total = 0, weight = 0;
  for (const [value, contribution] of candidates) {
    if (!finiteNumber(value) || contribution <= 0) continue;
    total += Number(value) * contribution;
    weight += contribution;
  }
  if (weight <= 0) return { status: 'no-data', extent };
  return { status: 'ok', elevation: Math.round(total / weight * 10) / 10, extent };
}

export function formatElevation(value) {
  return `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Number(value))} m`;
}

export const TERRAIN_PROVENANCE = 'Relief Terrarium · tuiles d’altitude publiques AWS (sources SRTM/USGS/EU-DEM selon couverture) · valeur indicative, non certifiée.';

export function updateTerrainLegend(root, terrain, { unloadedText = 'Relief non chargé. Lancez le chargement du relief pour afficher l’échelle.' } = {}) {
  if (!root) return null;
  root.replaceChildren();
  root.classList.add('topo-legend');
  root.setAttribute('aria-label', 'Échelle du relief topographique');
  const stats = terrainStats(terrain);
  if (!stats) {
    const message = document.createElement('span');
    message.className = 'topo-legend-empty';
    message.textContent = unloadedText;
    root.append(message);
    return null;
  }

  const title = document.createElement('strong');
  title.className = 'topo-legend-title';
  title.textContent = 'Altitude du relief · mètres';
  const bar = document.createElement('span');
  bar.className = 'topo-legend-bar';
  bar.setAttribute('aria-hidden', 'true');
  bar.style.background = `linear-gradient(90deg, ${COLOR_STOPS.map(([stop, rgb]) => `${`#${rgb.map(toHex).join('')}`} ${Math.round(stop * 100)}%`).join(', ')})`;
  const values = document.createElement('span');
  values.className = 'topo-legend-values';
  const low = document.createElement('span'); low.textContent = formatElevation(stats.min);
  const high = document.createElement('span'); high.textContent = formatElevation(stats.max);
  values.append(low, high);
  const interval = contourInterval(stats.min, stats.max);
  const note = document.createElement('span');
  note.className = 'topo-legend-note';
  note.textContent = interval ? `Courbes indicatives · intervalle ${formatElevation(interval)} · ${TERRAIN_PROVENANCE}` : `Relief uniforme dans cette grille · ${TERRAIN_PROVENANCE}`;
  root.append(title, bar, values, note);
  root.dataset.minimum = String(stats.min);
  root.dataset.maximum = String(stats.max);
  root.dataset.contourInterval = String(interval);
  return { ...stats, interval };
}

export function updateElevationReadout(root, terrain, lat, lon) {
  if (!root) return { status: 'no-readout' };
  const coordinate = Number.isFinite(Number(lat)) && Number.isFinite(Number(lon))
    ? ` · ${Number(lat).toFixed(5)}, ${Number(lon).toFixed(5)}` : '';
  const result = sampleTerrain(terrain, lat, lon);
  root.dataset.elevationStatus = result.status;
  if (result.status === 'not-loaded') root.textContent = 'Altitude indisponible : relief non chargé. Chargez le relief, puis cliquez sur la carte.';
  else if (result.status === 'outside') root.textContent = `Point hors de l’emprise du relief chargé${coordinate}. Rechargez le relief autour de ce point.`;
  else if (result.status === 'no-data') root.textContent = `Aucune altitude valide à ce point${coordinate}.`;
  else if (result.status === 'invalid-point') root.textContent = 'Cliquez sur un point cartographique valide pour lire l’altitude.';
  else if (result.status === 'invalid-terrain') root.textContent = 'Altitude indisponible : la grille de relief reçue est invalide. Rechargez le relief.';
  else root.textContent = `Altitude estimée : ${formatElevation(result.elevation)}${coordinate} · interpolation bilinéaire Terrarium, non certifiée.`;
  return result;
}

function svgNode(name, attributes = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

function cellCoordinates(extent, row, column) {
  const latitudeStep = (extent.north - extent.south) / (extent.rowCount - 1);
  const longitudeStep = (extent.east - extent.west) / (extent.columnCount - 1);
  const centerLat = extent.north - row * latitudeStep;
  const centerLon = extent.west + column * longitudeStep;
  return [
    [Math.max(extent.west, centerLon - longitudeStep / 2), Math.min(extent.north, centerLat + latitudeStep / 2)],
    [Math.min(extent.east, centerLon + longitudeStep / 2), Math.min(extent.north, centerLat + latitudeStep / 2)],
    [Math.min(extent.east, centerLon + longitudeStep / 2), Math.max(extent.south, centerLat - latitudeStep / 2)],
    [Math.max(extent.west, centerLon - longitudeStep / 2), Math.max(extent.south, centerLat - latitudeStep / 2)]
  ];
}

function pathForPoints(points, project) {
  const screen = points.map(project);
  if (screen.some(point => !Array.isArray(point) || point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1]))) return '';
  return `M${screen.map(point => `${Number(point[0]).toFixed(2)},${Number(point[1]).toFixed(2)}`).join('L')}Z`;
}

function contourSegments(extent, level) {
  const segments = [];
  const edges = [[0, 1], [1, 2], [2, 3], [3, 0]];
  const rows = extent.rowCount, columns = extent.columnCount;
  for (let row = 0; row < rows - 1; row++) for (let column = 0; column < columns - 1; column++) {
    const values = [
      Number(extent.rows[row][column]), Number(extent.rows[row][column + 1]),
      Number(extent.rows[row + 1][column + 1]), Number(extent.rows[row + 1][column])
    ];
    if (values.some(value => !Number.isFinite(value))) continue;
    const nw = [extent.west + column / (columns - 1) * (extent.east - extent.west), extent.north - row / (rows - 1) * (extent.north - extent.south)];
    const ne = [extent.west + (column + 1) / (columns - 1) * (extent.east - extent.west), nw[1]];
    const se = [ne[0], extent.north - (row + 1) / (rows - 1) * (extent.north - extent.south)];
    const sw = [nw[0], se[1]];
    const points = [nw, ne, se, sw];
    const intersections = [];
    for (const [a, b] of edges) {
      const va = values[a], vb = values[b];
      if (!((va < level && vb >= level) || (vb < level && va >= level))) continue;
      const denominator = vb - va;
      if (denominator === 0) continue;
      const t = clamp((level - va) / denominator, 0, 1);
      intersections.push([points[a][0] + (points[b][0] - points[a][0]) * t, points[a][1] + (points[b][1] - points[a][1]) * t]);
    }
    if (intersections.length === 2) segments.push(intersections);
    else if (intersections.length === 4) {
      const centerAbove = values.reduce((sum, value) => sum + value, 0) / 4 >= level;
      if ((values[0] >= level) === centerAbove) segments.push([intersections[0], intersections[3]], [intersections[1], intersections[2]]);
      else segments.push([intersections[0], intersections[1]], [intersections[2], intersections[3]]);
    }
  }
  return segments;
}

export function appendTopographicLayer(parent, terrain, project, { opacity = 0.58, contours = true } = {}) {
  const stats = terrainStats(terrain), extent = terrainExtent(terrain);
  if (!parent || !stats || !extent || typeof project !== 'function') return null;
  const group = svgNode('g', { 'data-layer': 'relief', 'aria-label': 'Relief coloré Terrarium et courbes de niveau indicatives', 'pointer-events': 'none' });
  const buckets = new Map();
  for (let row = 0; row < extent.rowCount; row++) for (let column = 0; column < extent.columnCount; column++) {
    const value = extent.rows[row][column];
    if (!finiteNumber(value)) continue;
    const t = stats.max > stats.min ? clamp((Number(value) - stats.min) / (stats.max - stats.min), 0, 1) : 0.5;
    const bucket = Math.min(15, Math.floor(t * 16));
    const path = pathForPoints(cellCoordinates(extent, row, column), project);
    if (!path) continue;
    buckets.set(bucket, (buckets.get(bucket) || '') + path);
  }
  for (const [bucket, paths] of buckets) {
    const fraction = (bucket + 0.5) / 16;
    const color = terrainColor(stats.min + (stats.max - stats.min) * fraction, stats.min, stats.max);
    group.append(svgNode('path', { d: paths, fill: color, 'fill-opacity': clamp(Number(opacity), 0, 1), stroke: 'none', 'data-relief-cells': bucket }));
  }

  const interval = contours ? contourInterval(stats.min, stats.max) : 0;
  if (interval > 0) {
    const first = Math.ceil(stats.min / interval) * interval;
    const levelCount = Math.min(40, Math.max(0, Math.floor((stats.max - first) / interval) + 1));
    for (let index = 0; index < levelCount; index++) {
      const level = first + index * interval;
      const segments = contourSegments(extent, level);
      let d = '';
      for (const segment of segments) {
        const a = project(segment[0]), b = project(segment[1]);
        if (!Array.isArray(a) || !Array.isArray(b) || !a.every(Number.isFinite) || !b.every(Number.isFinite)) continue;
        d += `M${Number(a[0]).toFixed(2)},${Number(a[1]).toFixed(2)}L${Number(b[0]).toFixed(2)},${Number(b[1]).toFixed(2)}`;
      }
      if (d) group.append(svgNode('path', {
        d, fill: 'none', stroke: '#443c2d', 'stroke-width': index % 5 === 0 ? 1.35 : 0.7,
        'stroke-opacity': index % 5 === 0 ? 0.62 : 0.38,
        'vector-effect': 'non-scaling-stroke', 'data-contour-elevation': level
      }));
    }
  }
  const title = svgNode('title');
  title.textContent = `Relief Terrarium indicatif · ${formatElevation(stats.min)} à ${formatElevation(stats.max)} · courbes ${interval ? `tous les ${formatElevation(interval)}` : 'non disponibles'}`;
  group.prepend(title);
  parent.append(group);
  return { ...stats, interval, extent };
}
