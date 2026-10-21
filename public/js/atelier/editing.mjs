import { countFeaturePositions } from './local-layers.mjs';

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function fail(code) { const error = new Error(code); error.code = code; throw error; }
function layerPositionCount(layer) { return layer.positionCount ?? countFeaturePositions(layer.geojson.features); }
export const MAX_EDIT_HISTORY_OPERATIONS = 50;
export const MAX_EDIT_HISTORY_BYTES = 4 * 1024 * 1024;
export function recordLayerEdit(layer, edit) {
  let serialized;
  const { feature: _feature, ...sizedEdit } = edit;
  try { serialized = JSON.stringify(sizedEdit); } catch { fail('EDIT_HISTORY_ENTRY_INVALID'); }
  const bytes = (serialized?.length || 0) * 2;
  if (bytes > MAX_EDIT_HISTORY_BYTES) fail('EDIT_HISTORY_ENTRY_TOO_LARGE');
  layer.editHistory ||= { undo: [], redo: [] };
  layer.editHistory.undo ||= []; layer.editHistory.redo ||= [];
  edit.historyBytes = bytes;
  layer.editHistory.redo.length = 0;
  layer.editHistory.undo.push(edit);
  let totalBytes = layer.editHistory.undo.reduce((sum, item) => sum + (item.historyBytes || 0), 0);
  while (layer.editHistory.undo.length > MAX_EDIT_HISTORY_OPERATIONS || totalBytes > MAX_EDIT_HISTORY_BYTES) {
    const discarded = layer.editHistory.undo.shift();
    totalBytes -= discarded?.historyBytes || 0;
    layer.editHistory.historyTruncated = true;
  }
  layer.lastEditedAt = new Date().toISOString();
  return edit;
}
function isPosition(value) { return Array.isArray(value) && value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number'; }
function getAtPath(root, path) { return path.reduce((value, key) => value?.[key], root); }
function setAtPath(root, path, value) {
  const parent = getAtPath(root, path.slice(0, -1));
  if (!parent) fail('EDIT_VERTEX_NOT_FOUND');
  parent[path.at(-1)] = value;
}

function findVertexDescriptor(geometry, targetIndex) {
  let current = 0, found = null;
  function add(path, containerPath, index, kind, minimum, closed = false) {
    if (current++ !== targetIndex) return false;
    found = { path, containerPath, index, kind, minimum, closed };
    return true;
  }
  function visit(currentGeometry, prefix = []) {
    if (!currentGeometry || found) return;
    if (currentGeometry.type === 'GeometryCollection') {
      currentGeometry.geometries?.some((child, index) => { visit(child, [...prefix, 'geometries', index]); return !!found; });
      return;
    }
    if (currentGeometry.type === 'Point') {
      add([...prefix, 'coordinates'], null, 0, 'point', 1);
      return;
    }
    const type = currentGeometry.type;
    const kind = type === 'MultiPoint' ? 'multipoint' : ['Polygon', 'MultiPolygon'].includes(type) ? 'ring' : 'line';
    const minimum = kind === 'multipoint' ? 1 : kind === 'ring' ? 4 : 2;
    function walk(value, path) {
      if (found || !Array.isArray(value)) return;
      if (value.length && isPosition(value[0])) {
        for (let index = 0; index < value.length; index++) {
          if (add([...path, index], path, index, kind, minimum, kind === 'ring')) return;
        }
        return;
      }
      for (let index = 0; index < value.length; index++) walk(value[index], [...path, index]);
    }
    walk(currentGeometry.coordinates, [...prefix, 'coordinates']);
  }
  visit(geometry);
  return found;
}

export function getVertex(geometry, index) {
  if (!Number.isInteger(index) || index < 0) return null;
  const descriptor = findVertexDescriptor(geometry, index);
  const coordinates = descriptor && getAtPath(geometry, descriptor.path);
  return coordinates ? { ...descriptor, coordinates: [...coordinates] } : null;
}

export function canDeleteVertex(geometry, index) {
  const descriptor = findVertexDescriptor(geometry, index);
  if (!descriptor || descriptor.kind === 'point') return false;
  const container = getAtPath(geometry, descriptor.containerPath);
  return Array.isArray(container) && container.length > descriptor.minimum;
}

export function canInsertVertex(geometry, index) {
  const descriptor = findVertexDescriptor(geometry, index);
  return !!descriptor && descriptor.kind !== 'point' && Array.isArray(getAtPath(geometry, descriptor.containerPath));
}

function validateLonLat(longitude, latitude) {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90)
    fail('EDIT_COORDINATE_OUT_OF_RANGE');
}

function saveGeometryEdit(layer, index, kind, before, after, positions = 0) {
  const feature = layer.geojson.features[index];
  recordLayerEdit(layer, { kind, feature, index, before, after: clone(after), positions });
  feature.geometry = after;
  return feature;
}

export function moveVertex(layer, featureIndex, vertexIndex, longitude, latitude) {
  const feature = layer?.geojson?.features?.[featureIndex];
  if (!feature) fail('EDIT_FEATURE_NOT_FOUND');
  const descriptor = findVertexDescriptor(feature.geometry, vertexIndex);
  if (!descriptor) fail('EDIT_VERTEX_NOT_FOUND');
  validateLonLat(longitude, latitude);
  const before = clone(feature.geometry), after = clone(feature.geometry);
  const originalPosition = getAtPath(after, descriptor.path);
  const originalRing = descriptor.closed ? getAtPath(before, descriptor.containerPath) : null;
  const ringWasClosed = Array.isArray(originalRing) && isPosition(originalRing[0]) && isPosition(originalRing.at(-1))
    && originalRing[0][0] === originalRing.at(-1)[0] && originalRing[0][1] === originalRing.at(-1)[1];
  const movedPosition = [longitude, latitude, ...originalPosition.slice(2)];
  setAtPath(after, descriptor.path, movedPosition);
  if (descriptor.closed && ringWasClosed) {
    const ring = getAtPath(after, descriptor.containerPath);
    if (descriptor.index === 0) ring[ring.length - 1] = [...movedPosition];
    else if (descriptor.index === ring.length - 1) ring[0] = [...movedPosition];
  }
  return saveGeometryEdit(layer, featureIndex, 'move-vertex', before, after);
}

export function movePoint(layer, index, longitude, latitude) {
  const feature = layer?.geojson?.features?.[index];
  if (!feature) fail('EDIT_FEATURE_NOT_FOUND');
  if (feature.geometry?.type !== 'Point') fail('EDIT_POINT_REQUIRED');
  return moveVertex(layer, index, 0, longitude, latitude);
}

export function insertVertex(layer, featureIndex, vertexIndex, longitude, latitude) {
  const feature = layer?.geojson?.features?.[featureIndex];
  if (!feature) fail('EDIT_FEATURE_NOT_FOUND');
  const descriptor = findVertexDescriptor(feature.geometry, vertexIndex);
  if (!descriptor) fail('EDIT_VERTEX_NOT_FOUND');
  if (descriptor.kind === 'point') fail('EDIT_VERTEX_INSERT_UNSUPPORTED');
  validateLonLat(longitude, latitude);
  const before = clone(feature.geometry), after = clone(feature.geometry);
  const currentPositions = layerPositionCount(layer);
  const container = getAtPath(after, descriptor.containerPath);
  let insertionIndex = descriptor.index + 1;
  if (descriptor.closed && descriptor.index === container.length - 1) insertionIndex = container.length - 1;
  container.splice(insertionIndex, 0, [longitude, latitude]);
  const result = saveGeometryEdit(layer, featureIndex, 'insert-vertex', before, after, 1);
  layer.positionCount = currentPositions + 1;
  return result;
}

export function deleteVertex(layer, featureIndex, vertexIndex) {
  const feature = layer?.geojson?.features?.[featureIndex];
  if (!feature) fail('EDIT_FEATURE_NOT_FOUND');
  const descriptor = findVertexDescriptor(feature.geometry, vertexIndex);
  if (!descriptor) fail('EDIT_VERTEX_NOT_FOUND');
  if (descriptor.kind === 'point') fail('EDIT_POINT_VERTEX_DELETE_UNSUPPORTED');
  const existingContainer = getAtPath(feature.geometry, descriptor.containerPath);
  if (!Array.isArray(existingContainer) || existingContainer.length <= descriptor.minimum) fail('EDIT_MINIMUM_VERTICES');
  const before = clone(feature.geometry), after = clone(feature.geometry);
  const container = getAtPath(after, descriptor.containerPath);
  const isClosedRing = descriptor.closed && isPosition(container[0]) && isPosition(container.at(-1))
    && container[0][0] === container.at(-1)[0] && container[0][1] === container.at(-1)[1];
  if (isClosedRing && (descriptor.index === 0 || descriptor.index === container.length - 1)) {
    container.shift(); container.pop();
    container.push([...container[0]]);
  } else container.splice(descriptor.index, 1);
  const removedPositions = countFeaturePositions([{ geometry: before }]) - countFeaturePositions([{ geometry: after }]);
  const currentPositions = layerPositionCount(layer);
  const result = saveGeometryEdit(layer, featureIndex, 'delete-vertex', before, after, removedPositions);
  layer.positionCount = Math.max(0, currentPositions - removedPositions);
  return result;
}

export function deleteFeature(layer, index) {
  const feature = layer?.geojson?.features?.[index];
  if (!feature) fail('EDIT_FEATURE_NOT_FOUND');
  const positions = countFeaturePositions([feature]);
  const currentPositions = layerPositionCount(layer);
  recordLayerEdit(layer, { kind: 'delete', feature, index, positions });
  layer.geojson.features.splice(index, 1);
  layer.positionCount = Math.max(0, currentPositions - positions);
  return { feature, index, positions };
}

function safeAttributeName(value) {
  const name = String(value ?? '').trim();
  if (!name || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name) || ['__proto__', 'prototype', 'constructor'].includes(name))
    fail('EDIT_ATTRIBUTE_NAME_INVALID');
  return name;
}
function setAttributeState(feature, edit, side) {
  const isBefore = side === 'before';
  const nullProperties = isBefore ? edit.beforePropertiesNull : edit.afterPropertiesNull;
  const exists = isBefore ? edit.beforeExists : edit.afterExists;
  const value = isBefore ? edit.beforeValue : edit.afterValue;
  if (nullProperties) { feature.properties = null; return; }
  if (!feature.properties || typeof feature.properties !== 'object' || Array.isArray(feature.properties)) feature.properties = {};
  if (exists) Object.defineProperty(feature.properties, edit.name, { value: clone(value), writable: true, enumerable: true, configurable: true });
  else delete feature.properties[edit.name];
}
export function setFeatureAttribute(layer, index, rawName, value) {
  const feature = layer?.geojson?.features?.[index];
  if (!feature) fail('EDIT_FEATURE_NOT_FOUND');
  const name = safeAttributeName(rawName);
  let serialized;
  try { serialized = JSON.stringify(value); } catch { fail('EDIT_ATTRIBUTE_VALUE_INVALID'); }
  if (serialized === undefined) fail('EDIT_ATTRIBUTE_VALUE_INVALID');
  if (serialized.length > 20_000) fail('EDIT_ATTRIBUTE_TOO_LARGE');
  const beforeExists = !!feature.properties && Object.hasOwn(feature.properties, name);
  const edit = {
    kind: 'attribute', feature, index, name, beforePropertiesNull: feature.properties === null,
    beforeExists, beforeValue: beforeExists ? clone(feature.properties[name]) : undefined,
    afterPropertiesNull: false, afterExists: true, afterValue: JSON.parse(serialized), positions: 0
  };
  recordLayerEdit(layer, edit);
  setAttributeState(feature, edit, 'after');
  return feature;
}
export function deleteFeatureAttribute(layer, index, rawName) {
  const feature = layer?.geojson?.features?.[index];
  if (!feature) fail('EDIT_FEATURE_NOT_FOUND');
  const name = safeAttributeName(rawName);
  if (!feature.properties || !Object.hasOwn(feature.properties, name)) fail('EDIT_ATTRIBUTE_NOT_FOUND');
  const edit = {
    kind: 'attribute', feature, index, name, beforePropertiesNull: false, beforeExists: true,
    beforeValue: clone(feature.properties[name]), afterPropertiesNull: false, afterExists: false, afterValue: undefined, positions: 0
  };
  recordLayerEdit(layer, edit);
  delete feature.properties[name];
  return feature;
}

function positionCanBeRestored(canRestore, positions, addsFeature) { return canRestore(positions, addsFeature); }
export function undoLayerEdit(layer, canRestore = () => true) {
  const edit = layer?.editHistory?.undo?.at(-1);
  if (!edit) return null;
  const kind = edit.kind || 'add';
  if (kind === 'add') {
    const index = layer.geojson.features.indexOf(edit.feature);
    if (index < 0) return null;
    const currentPositions = layerPositionCount(layer);
    layer.geojson.features.splice(index, 1);
    layer.positionCount = Math.max(0, currentPositions - (edit.positions || 0));
    edit.index = index;
  } else if (kind === 'delete') {
    if (!positionCanBeRestored(canRestore, edit.positions || 0, true)) return { blocked: true, kind };
    const index = Math.min(edit.index, layer.geojson.features.length);
    const currentPositions = layerPositionCount(layer);
    layer.geojson.features.splice(index, 0, edit.feature);
    layer.positionCount = currentPositions + (edit.positions || 0);
    edit.index = index;
  } else if (['move', 'move-vertex'].includes(kind)) {
    const index = layer.geojson.features.indexOf(edit.feature);
    if (index < 0) return null;
    edit.feature.geometry = clone(edit.before);
    edit.index = index;
  } else if (kind === 'attribute') {
    const index = layer.geojson.features.indexOf(edit.feature);
    if (index < 0) return null;
    setAttributeState(edit.feature, edit, 'before');
    edit.index = index;
  } else if (kind === 'insert-vertex' || kind === 'delete-vertex') {
    const index = layer.geojson.features.indexOf(edit.feature);
    if (index < 0) return null;
    if (kind === 'delete-vertex' && !positionCanBeRestored(canRestore, edit.positions || 0, false)) return { blocked: true, kind };
    const currentPositions = layerPositionCount(layer);
    edit.feature.geometry = clone(edit.before);
    layer.positionCount = kind === 'insert-vertex'
      ? Math.max(0, currentPositions - (edit.positions || 0))
      : currentPositions + (edit.positions || 0);
    edit.index = index;
  } else return null;
  layer.editHistory.undo.pop(); layer.editHistory.redo.push(edit);
  layer.lastEditedAt = new Date().toISOString();
  return { kind, index: edit.index, feature: edit.feature };
}

export function redoLayerEdit(layer, canRestore = () => true) {
  const edit = layer?.editHistory?.redo?.at(-1);
  if (!edit) return null;
  const kind = edit.kind || 'add';
  if (kind === 'add') {
    if (!positionCanBeRestored(canRestore, edit.positions || 0, true)) return { blocked: true, kind };
    const index = Math.min(edit.index, layer.geojson.features.length);
    const currentPositions = layerPositionCount(layer);
    layer.geojson.features.splice(index, 0, edit.feature);
    layer.positionCount = currentPositions + (edit.positions || 0);
    edit.index = index;
  } else if (kind === 'delete') {
    const index = layer.geojson.features.indexOf(edit.feature);
    if (index < 0) return null;
    const currentPositions = layerPositionCount(layer);
    layer.geojson.features.splice(index, 1);
    layer.positionCount = Math.max(0, currentPositions - (edit.positions || 0));
    edit.index = index;
  } else if (['move', 'move-vertex'].includes(kind)) {
    const index = layer.geojson.features.indexOf(edit.feature);
    if (index < 0) return null;
    edit.feature.geometry = clone(edit.after);
    edit.index = index;
  } else if (kind === 'attribute') {
    const index = layer.geojson.features.indexOf(edit.feature);
    if (index < 0) return null;
    setAttributeState(edit.feature, edit, 'after');
    edit.index = index;
  } else if (kind === 'insert-vertex' || kind === 'delete-vertex') {
    const index = layer.geojson.features.indexOf(edit.feature);
    if (index < 0) return null;
    if (kind === 'insert-vertex' && !positionCanBeRestored(canRestore, edit.positions || 0, false)) return { blocked: true, kind };
    const currentPositions = layerPositionCount(layer);
    edit.feature.geometry = clone(edit.after);
    layer.positionCount = kind === 'insert-vertex'
      ? currentPositions + (edit.positions || 0)
      : Math.max(0, currentPositions - (edit.positions || 0));
    edit.index = index;
  } else return null;
  layer.editHistory.redo.pop(); layer.editHistory.undo.push(edit);
  layer.lastEditedAt = new Date().toISOString();
  return { kind, index: edit.index, feature: edit.feature };
}
