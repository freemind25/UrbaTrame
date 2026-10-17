import { greatCircleDistanceMeters } from './local-analysis.mjs';

const EARTH_RADIUS_METERS = 6_371_008.8;
export const MAX_BUFFER_POINTS = 2_000;
export const MAX_BUFFER_LINE_SEGMENTS = 2_000;
export const MAX_BUFFER_LINE_SEGMENT_METERS = 100_000;
export const MAX_BUFFER_OUTPUT_POSITIONS = 100_000;
export const DEFAULT_BUFFER_SEGMENTS = 32;

function fail(code) { const error = new Error(code); error.code = code; throw error; }

function normalizeLongitude(longitude) {
  const normalized = ((longitude + 180) % 360 + 360) % 360 - 180;
  return normalized === -180 && longitude > 0 ? 180 : normalized;
}

export function destinationPoint(longitude, latitude, bearingRadians, distanceMeters) {
  const angularDistance = distanceMeters / EARTH_RADIUS_METERS;
  const phi1 = latitude * Math.PI / 180, lambda1 = longitude * Math.PI / 180;
  const sinPhi2 = Math.sin(phi1) * Math.cos(angularDistance)
    + Math.cos(phi1) * Math.sin(angularDistance) * Math.cos(bearingRadians);
  const phi2 = Math.asin(Math.max(-1, Math.min(1, sinPhi2)));
  const lambda2 = lambda1 + Math.atan2(
    Math.sin(bearingRadians) * Math.sin(angularDistance) * Math.cos(phi1),
    Math.cos(angularDistance) - Math.sin(phi1) * Math.sin(phi2)
  );
  return [normalizeLongitude(lambda2 * 180 / Math.PI), phi2 * 180 / Math.PI];
}

function visitPoints(geometry, callback) {
  if (!geometry) return;
  if (geometry.type === 'Point') { callback(geometry.coordinates); return; }
  if (geometry.type === 'MultiPoint') { for (const point of geometry.coordinates || []) callback(point); return; }
  if (geometry.type === 'GeometryCollection') for (const child of geometry.geometries || []) visitPoints(child, callback);
}

function visitLineSegments(geometry, callback) {
  let segmentIndex = 0;
  const visit = child => {
    if (!child) return;
    if (child.type === 'LineString') {
      const line = Array.isArray(child.coordinates) ? child.coordinates : [];
      for (let index = 1; index < line.length; index++) callback(line[index - 1], line[index], segmentIndex++);
    } else if (child.type === 'MultiLineString') {
      for (const line of child.coordinates || []) {
        for (let index = 1; index < line.length; index++) callback(line[index - 1], line[index], segmentIndex++);
      }
    } else if (child.type === 'GeometryCollection') for (const nested of child.geometries || []) visit(nested);
  };
  visit(geometry);
  return segmentIndex;
}

function initialBearing(a, b) {
  const phi1 = a[1] * Math.PI / 180, phi2 = b[1] * Math.PI / 180;
  const deltaLambda = (b[0] - a[0]) * Math.PI / 180;
  return Math.atan2(Math.sin(deltaLambda) * Math.cos(phi2), Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda));
}

function lineSegmentCapsule(a, b, radiusMeters, segments) {
  const halfSegments = Math.ceil(segments / 2);
  const forward = initialBearing(a, b);
  const reverse = initialBearing(b, a);
  const forwardAtEnd = reverse + Math.PI;
  const ring = [];
  for (let index = 0; index <= halfSegments; index++)
    ring.push(destinationPoint(a[0], a[1], forward - Math.PI / 2 - Math.PI * index / halfSegments, radiusMeters));
  for (let index = 0; index <= halfSegments; index++)
    ring.push(destinationPoint(b[0], b[1], forwardAtEnd + Math.PI / 2 - Math.PI * index / halfSegments, radiusMeters));
  ring.push([...ring[0]]);
  if (ring.some((position, index) => index > 0 && Math.abs(position[0] - ring[index - 1][0]) > 180)) fail('RECIPE_BUFFER_ANTIMERIDIAN_UNSUPPORTED');
  return ring;
}

export function bufferPointFeatures(features, {
  radiusMeters, segments = DEFAULT_BUFFER_SEGMENTS,
  sourceLayer = 'Couche source', source = 'Source utilisateur', importedAt = '', now = new Date()
} = {}) {
  if (!Number.isFinite(radiusMeters) || radiusMeters < 1 || radiusMeters > 5_000) fail('RECIPE_BUFFER_RADIUS_INVALID');
  if (!Number.isInteger(segments) || segments < 12 || segments > 64) fail('RECIPE_BUFFER_SEGMENTS_INVALID');
  if (!Array.isArray(features)) fail('RECIPE_BUFFER_INPUT_INVALID');
  const buffered = [];
  let pointCount = 0;
  let outputPositions = 0;
  const generatedAt = now.toISOString();
  for (let featureIndex = 0; featureIndex < features.length; featureIndex++) {
    const sourceFeature = features[featureIndex];
    visitPoints(sourceFeature?.geometry, point => {
      if (!Array.isArray(point) || point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || point[0] < -180 || point[0] > 180 || point[1] < -90 || point[1] > 90)
        fail('RECIPE_BUFFER_COORDINATE_INVALID');
      pointCount++;
      outputPositions += segments + 1;
      if (pointCount > MAX_BUFFER_POINTS || outputPositions > MAX_BUFFER_OUTPUT_POSITIONS) fail('RECIPE_BUFFER_COMPLEXITY');
      const ring = Array.from({ length: segments }, (_, index) => destinationPoint(point[0], point[1], -2 * Math.PI * index / segments, radiusMeters));
      ring.push([...ring[0]]);
      if (ring.some((position, index) => index > 0 && Math.abs(position[0] - ring[index - 1][0]) > 180)) fail('RECIPE_BUFFER_ANTIMERIDIAN_UNSUPPORTED');
      const sourceId = sourceFeature.id ?? sourceFeature.properties?.id ?? featureIndex + 1;
      buffered.push({
        type: 'Feature', id: `buffer-${featureIndex + 1}-${buffered.length + 1}`,
        properties: {
          _urbaTrameDerivation: {
            operation: 'buffer-point', radiusMeters, segments, method: 'approximation géodésique sphérique',
            dissolved: false, generatedAt, sourceLayer, source, importedAt,
            sourceFeatureId: sourceId, sourceFeatureIndex: featureIndex
          }
        },
        geometry: { type: 'Polygon', coordinates: [ring] }
      });
    });
  }
  if (!buffered.length) fail('RECIPE_BUFFER_POINTS_REQUIRED');
  return { features: buffered, pointCount, outputPositions, generatedAt, radiusMeters, segments };
}

export function bufferLineFeatures(features, {
  radiusMeters, segments = DEFAULT_BUFFER_SEGMENTS,
  sourceLayer = 'Couche source', source = 'Source utilisateur', importedAt = '', now = new Date()
} = {}) {
  if (!Number.isFinite(radiusMeters) || radiusMeters < 1 || radiusMeters > 5_000) fail('RECIPE_BUFFER_RADIUS_INVALID');
  if (!Number.isInteger(segments) || segments < 12 || segments > 64) fail('RECIPE_BUFFER_SEGMENTS_INVALID');
  if (!Array.isArray(features)) fail('RECIPE_BUFFER_INPUT_INVALID');
  const buffered = [];
  let segmentCount = 0, outputPositions = 0;
  const generatedAt = now.toISOString();
  for (let featureIndex = 0; featureIndex < features.length; featureIndex++) {
    const sourceFeature = features[featureIndex];
    visitLineSegments(sourceFeature?.geometry, (a, b, sourceSegmentIndex) => {
      const validCoordinate = point => Array.isArray(point) && point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]) && point[0] >= -180 && point[0] <= 180 && point[1] >= -90 && point[1] <= 90;
      if (!validCoordinate(a) || !validCoordinate(b)) fail('RECIPE_BUFFER_COORDINATE_INVALID');
      if (Math.abs(a[0] - b[0]) > 180) fail('RECIPE_BUFFER_ANTIMERIDIAN_UNSUPPORTED');
      const segmentLengthMeters = greatCircleDistanceMeters(a, b);
      if (segmentLengthMeters < 0.001) fail('RECIPE_BUFFER_LINE_SEGMENT_INVALID');
      if (segmentLengthMeters > MAX_BUFFER_LINE_SEGMENT_METERS) fail('RECIPE_BUFFER_LINE_SEGMENT_TOO_LONG');
      const ringPositions = 2 * (Math.ceil(segments / 2) + 1) + 1;
      segmentCount++;
      outputPositions += ringPositions;
      if (segmentCount > MAX_BUFFER_LINE_SEGMENTS || outputPositions > MAX_BUFFER_OUTPUT_POSITIONS) fail('RECIPE_BUFFER_LINE_COMPLEXITY');
      const ring = lineSegmentCapsule(a, b, radiusMeters, segments);
      const sourceId = sourceFeature.id ?? sourceFeature.properties?.id ?? featureIndex + 1;
      buffered.push({
        type: 'Feature', id: `line-buffer-${featureIndex + 1}-${sourceSegmentIndex + 1}`,
        properties: { _urbaTrameDerivation: {
          operation: 'buffer-line-segment', radiusMeters, segments, method: 'capsules géodésiques sphériques approximatives par segment',
          dissolved: false, generatedAt, sourceLayer, source, importedAt,
          sourceFeatureId: sourceId, sourceFeatureIndex: featureIndex, sourceSegmentIndex, segmentLengthMeters
        } },
        geometry: { type: 'Polygon', coordinates: [ring] }
      });
    });
  }
  if (!buffered.length) fail('RECIPE_BUFFER_LINES_REQUIRED');
  return { features: buffered, segmentCount, outputPositions, generatedAt, radiusMeters, segments };
}
