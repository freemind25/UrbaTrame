/* Lecture/écriture locale du sous-ensemble KML 2.2 utile aux couches vectorielles.
   Le parseur XML refuse DTD/entités externes : aucun NetworkLink n'est suivi. */
import { MAX_IMPORT_BYTES, MAX_FEATURES, MAX_COORDINATE_POSITIONS, parseGeoJSONText } from './local-layers.mjs';

const MAX_XML_NODES = 250_000;
const MAX_XML_DEPTH = 64;
const MAX_KML_PROPERTIES = 100;
const GEOMETRY_NAMES = new Set(['Point', 'LineString', 'LinearRing', 'Polygon', 'MultiGeometry']);

function fail(code, detail = '') {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  throw error;
}

function decodeEntities(text) {
  if (/&(?!(?:#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);)/i.test(text)) fail('KML_XML_INVALID');
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity) => {
    const lower = entity.toLowerCase();
    if (lower === 'amp') return '&';
    if (lower === 'lt') return '<';
    if (lower === 'gt') return '>';
    if (lower === 'quot') return '"';
    if (lower === 'apos') return "'";
    const code = lower.startsWith('#x') ? Number.parseInt(lower.slice(2), 16) : Number.parseInt(lower.slice(1), 10);
    if (!Number.isSafeInteger(code) || code < 1 || code > 0x10ffff || code >= 0xd800 && code <= 0xdfff) fail('KML_XML_INVALID');
    return String.fromCodePoint(code);
  });
}

function localName(name) { return String(name || '').split(':').at(-1); }

function parseXml(text) {
  if (typeof text !== 'string' || !text.trim()) fail('KML_EMPTY');
  if (text.length > MAX_IMPORT_BYTES) fail('FILE_TOO_LARGE');
  if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(text)) fail('KML_XML_UNSAFE');
  const root = { name: '#document', attrs: Object.create(null), children: [], text: '' };
  const stack = [root];
  const tokens = text.match(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<![^>]*>|<[^>]*>|[^<]+/g) || [];
  let nodes = 0;
  for (const token of tokens) {
    if (token.startsWith('<!--') || token.startsWith('<?')) continue;
    if (token.startsWith('<![CDATA[')) { stack.at(-1).text += token.slice(9, -3); continue; }
    if (token.startsWith('<!')) fail('KML_XML_INVALID');
    if (token.startsWith('</')) {
      const name = token.slice(2, -1).trim();
      if (stack.length < 2 || stack.at(-1).tagName !== name) fail('KML_XML_INVALID');
      stack.pop();
      continue;
    }
    if (token.startsWith('<')) {
      const inside = token.slice(1, -1).trim();
      const selfClosing = inside.endsWith('/');
      const body = selfClosing ? inside.slice(0, -1).trim() : inside;
      const match = body.match(/^([^\s/>]+)([\s\S]*)$/);
      if (!match) fail('KML_XML_INVALID');
      const tagName = match[1];
      const attrs = Object.create(null);
      const attrText = match[2];
      let cursor = 0;
      const attrRegex = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/gy;
      while (cursor < attrText.length) {
        while (/\s/.test(attrText[cursor] || '') || attrText[cursor] === '/') cursor++;
        if (cursor >= attrText.length) break;
        attrRegex.lastIndex = cursor;
        const attr = attrRegex.exec(attrText);
        if (!attr) fail('KML_XML_INVALID');
        const key = localName(attr[1]);
        if (Object.hasOwn(attrs, key)) fail('KML_XML_INVALID');
        attrs[key] = decodeEntities(attr[3] ?? attr[4] ?? '');
        cursor = attrRegex.lastIndex;
      }
      const node = { tagName, name: localName(tagName), attrs, children: [], text: '' };
      stack.at(-1).children.push(node);
      if (++nodes > MAX_XML_NODES) fail('KML_TOO_COMPLEX');
      if (!selfClosing) {
        if (stack.length >= MAX_XML_DEPTH) fail('KML_TOO_COMPLEX');
        stack.push(node);
      }
      continue;
    }
    stack.at(-1).text += decodeEntities(token);
  }
  if (stack.length !== 1) fail('KML_XML_INVALID');
  return root;
}

function children(node, name) { return (node?.children || []).filter(child => child.name.toLowerCase() === name.toLowerCase()); }
function firstChild(node, name) { return children(node, name)[0] || null; }
function textContent(node) { return node ? node.text + node.children.map(textContent).join('') : ''; }
function trimmedText(node, maximum = 2000) { return textContent(node).replace(/\s+/g, ' ').trim().slice(0, maximum); }

function parseCoordinates(text) {
  const raw = String(text || '').trim();
  if (!raw) fail('KML_COORDINATES_INVALID');
  const positions = [];
  for (const tuple of raw.split(/\s+/)) {
    const parts = tuple.split(',');
    if (parts.length < 2 || parts.length > 3 || parts.some(part => part.trim() === '')) fail('KML_COORDINATES_INVALID');
    const position = parts.map(Number);
    if (position.some(value => !Number.isFinite(value))) fail('KML_COORDINATES_INVALID');
    const [lon, lat] = position;
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) fail('KML_COORDINATES_INVALID');
    positions.push(position);
    if (positions.length > MAX_COORDINATE_POSITIONS) fail('TOO_MANY_COORDINATES');
  }
  return positions;
}

function geometryFromNode(node) {
  if (!node) return null;
  if (node.name === 'Point') {
    const coords = parseCoordinates(textContent(firstChild(node, 'coordinates')));
    return coords.length === 1 ? { type: 'Point', coordinates: coords[0] } : { type: 'MultiPoint', coordinates: coords };
  }
  if (node.name === 'LineString' || node.name === 'LinearRing') {
    const coords = parseCoordinates(textContent(firstChild(node, 'coordinates')));
    if (coords.length < 2) fail('KML_COORDINATES_INVALID');
    if (node.name === 'LinearRing') {
      if (coords.length < 3) fail('KML_COORDINATES_INVALID');
      const first = coords[0], last = coords.at(-1);
      if (first[0] !== last[0] || first[1] !== last[1]) coords.push([...first]);
      return { type: 'LinearRing', coordinates: coords };
    }
    return { type: 'LineString', coordinates: coords };
  }
  if (node.name === 'Polygon') {
    const outer = firstChild(node, 'outerBoundaryIs');
    const outerRing = geometryFromNode(firstChild(outer, 'LinearRing'));
    if (!outerRing) fail('KML_POLYGON_OUTER_RING_REQUIRED');
    const rings = [outerRing.coordinates];
    for (const inner of children(node, 'innerBoundaryIs')) {
      const ring = geometryFromNode(firstChild(inner, 'LinearRing'));
      if (ring) rings.push(ring.coordinates);
    }
    return { type: 'Polygon', coordinates: rings };
  }
  if (node.name === 'MultiGeometry') {
    const geometries = node.children.filter(child => GEOMETRY_NAMES.has(child.name)).map(geometryFromNode).filter(Boolean);
    if (!geometries.length) return null;
    if (geometries.every(value => value.type === 'Point')) return { type: 'MultiPoint', coordinates: geometries.map(value => value.coordinates) };
    if (geometries.every(value => value.type === 'LineString')) return { type: 'MultiLineString', coordinates: geometries.map(value => value.coordinates) };
    if (geometries.every(value => value.type === 'Polygon')) return { type: 'MultiPolygon', coordinates: geometries.map(value => value.coordinates) };
    return { type: 'GeometryCollection', geometries };
  }
  return null;
}

function placemarkProperties(node) {
  const properties = Object.create(null);
  for (const key of ['name', 'description', 'address', 'phoneNumber', 'styleUrl', 'visibility']) {
    const value = trimmedText(firstChild(node, key), key === 'description' ? 4000 : 500);
    if (value) properties[key] = value;
  }
  const extended = firstChild(node, 'ExtendedData');
  const add = (keyValue, valueNode) => {
    const key = String(keyValue || '').trim().slice(0, 120);
    if (!key || key === '__proto__' || key === 'constructor' || Object.keys(properties).length >= MAX_KML_PROPERTIES) return;
    properties[key] = trimmedText(valueNode, 2000);
  };
  for (const data of children(extended, 'Data')) add(data.attrs.name, firstChild(data, 'value'));
  for (const schemaData of children(extended, 'SchemaData'))
    for (const value of children(schemaData, 'SimpleData')) add(value.attrs.name, value);
  return properties;
}

function walk(node, name, out = []) {
  if (node.name === name) out.push(node);
  for (const child of node.children || []) walk(child, name, out);
  return out;
}

export function parseKmlText(text, { fileName = 'couche.kml' } = {}) {
  const root = parseXml(text);
  const placemarks = walk(root, 'Placemark');
  if (!placemarks.length) fail('KML_NO_PLACEMARKS');
  if (placemarks.length > MAX_FEATURES) fail('TOO_MANY_FEATURES');
  let positionCount = 0;
  const features = [];
  for (const [index, placemark] of placemarks.entries()) {
    const geometries = placemark.children.filter(child => GEOMETRY_NAMES.has(child.name)).map(geometryFromNode).filter(Boolean);
    let geometry = geometries.length === 1 ? geometries[0] : geometries.length
      ? { type: 'GeometryCollection', geometries } : null;
    if (geometry?.type === 'LinearRing') geometry = { type: 'LineString', coordinates: geometry.coordinates };
    if (!geometry) continue;
    const feature = { type: 'Feature', id: placemark.attrs.id || `kml-${index + 1}`, properties: placemarkProperties(placemark), geometry };
    features.push(feature);
  }
  if (!features.length) fail('KML_NO_GEOMETRIES');
  const parsed = parseGeoJSONText(JSON.stringify({ type: 'FeatureCollection', name: fileName, features }), { fileName });
  for (const feature of parsed.features) {
    const count = (() => {
      let total = 0;
      const visit = value => {
        if (!Array.isArray(value)) return;
        if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') total++;
        else value.forEach(visit);
      };
      if (feature.geometry?.type === 'GeometryCollection') feature.geometry.geometries.forEach(child => visit(child.coordinates));
      else visit(feature.geometry?.coordinates);
      return total;
    })();
    positionCount += count;
    if (positionCount > MAX_COORDINATE_POSITIONS) fail('TOO_MANY_COORDINATES');
  }
  parsed.sourceCrs = 'EPSG:4326';
  parsed.kml = { placemarks: placemarks.length, importedFeatures: parsed.features.length, unsupportedLinksFetched: false };
  return parsed;
}

function xmlEscape(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function kmlPosition(position) {
  return position.map(value => Number(value).toString()).join(',');
}
function kmlLine(coordinates) { return coordinates.map(kmlPosition).join(' '); }
function kmlGeometry(geometry) {
  if (!geometry) return '';
  if (geometry.type === 'Point') return `<Point><coordinates>${kmlPosition(geometry.coordinates)}</coordinates></Point>`;
  if (geometry.type === 'MultiPoint') return `<MultiGeometry>${geometry.coordinates.map(coordinates => kmlGeometry({ type: 'Point', coordinates })).join('')}</MultiGeometry>`;
  if (geometry.type === 'LineString') return `<LineString><tessellate>1</tessellate><coordinates>${kmlLine(geometry.coordinates)}</coordinates></LineString>`;
  if (geometry.type === 'MultiLineString') return `<MultiGeometry>${geometry.coordinates.map(coordinates => kmlGeometry({ type: 'LineString', coordinates })).join('')}</MultiGeometry>`;
  if (geometry.type === 'Polygon') {
    const [outer = [], ...inners] = geometry.coordinates;
    return `<Polygon><outerBoundaryIs><LinearRing><coordinates>${kmlLine(outer)}</coordinates></LinearRing></outerBoundaryIs>${inners.map(ring => `<innerBoundaryIs><LinearRing><coordinates>${kmlLine(ring)}</coordinates></LinearRing></innerBoundaryIs>`).join('')}</Polygon>`;
  }
  if (geometry.type === 'MultiPolygon') return `<MultiGeometry>${geometry.coordinates.map(coordinates => kmlGeometry({ type: 'Polygon', coordinates })).join('')}</MultiGeometry>`;
  if (geometry.type === 'GeometryCollection') return `<MultiGeometry>${geometry.geometries.map(kmlGeometry).join('')}</MultiGeometry>`;
  return '';
}

export function layersToKml(layers, { title = 'UrbaTrame · relevé', now = new Date() } = {}) {
  const folders = (layers || []).filter(layer => layer.visible !== false && layer.kind !== 'raster').map(layer => {
    const placemarks = (layer.geojson?.features || []).map((feature, index) => {
      const properties = feature.properties || {};
      const name = properties.name ?? properties.nom ?? `Entité ${index + 1}`;
      const extended = Object.entries(properties).filter(([key]) => key !== 'name' && key !== 'nom' && key !== '__proto__')
        .map(([key, value]) => `<Data name="${xmlEscape(key)}"><value>${xmlEscape(value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : value)}</value></Data>`).join('');
      const description = properties.description ?? properties.observation ?? '';
      return `<Placemark id="ut-${index + 1}"><name>${xmlEscape(name)}</name>${description ? `<description>${xmlEscape(description)}</description>` : ''}${extended ? `<ExtendedData>${extended}</ExtendedData>` : ''}${kmlGeometry(feature.geometry)}</Placemark>`;
    }).join('');
    return `<Folder><name>${xmlEscape(layer.name || 'Couche')}</name><description>${xmlEscape(layer.source || '')}</description>${placemarks}</Folder>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xmlEscape(title)}</name><description>Export local UrbaTrame · EPSG:4326 WGS 84 · ${xmlEscape(now.toISOString())}</description>${folders}</Document></kml>`;
}
