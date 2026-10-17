import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { deleteFeature, movePoint, moveVertex, insertVertex, deleteVertex, setFeatureAttribute, deleteFeatureAttribute, getVertex, canDeleteVertex, canInsertVertex, recordLayerEdit, MAX_EDIT_HISTORY_BYTES, MAX_EDIT_HISTORY_OPERATIONS, undoLayerEdit, redoLayerEdit } from '../public/js/atelier/editing.mjs';

function feature(type, coordinates, properties = {}) {
  return { type: 'Feature', properties, geometry: { type, coordinates } };
}
function layer(features, positionCount) {
  return { id: 'layer-1', geojson: { type: 'FeatureCollection', features }, ...(positionCount === undefined ? {} : { positionCount }), editHistory: { undo: [], redo: [] } };
}

describe('UrbaTrame · édition locale des entités', () => {
  test('supprime, annule et rétablit une entité sans perdre géométrie ni attributs', () => {
    const original = feature('LineString', [[1, 2], [3, 4], [5, 6]], { name: 'chemin' });
    const target = layer([original]);
    const removed = deleteFeature(target, 0);
    assert.equal(removed.feature, original);
    assert.equal(target.geojson.features.length, 0);
    assert.equal(target.positionCount, 0);
    assert.equal(undoLayerEdit(target).kind, 'delete');
    assert.equal(target.geojson.features[0], original);
    assert.equal(target.positionCount, 3);
    assert.deepEqual(target.geojson.features[0].properties, { name: 'chemin' });
    assert.equal(redoLayerEdit(target).kind, 'delete');
    assert.equal(target.geojson.features.length, 0);
    assert.equal(target.positionCount, 0);
  });

  test('déplace un point en WGS 84, préserve Z et permet annulation/rétablissement', () => {
    const original = feature('Point', [1, 2, 80], { label: 'repère' });
    const target = layer([original], 1);
    movePoint(target, 0, 6.1, 36.8);
    assert.deepEqual(original.geometry.coordinates, [6.1, 36.8, 80]);
    assert.deepEqual(original.properties, { label: 'repère' });
    assert.equal(undoLayerEdit(target).kind, 'move-vertex');
    assert.deepEqual(original.geometry.coordinates, [1, 2, 80]);
    assert.equal(redoLayerEdit(target).kind, 'move-vertex');
    assert.deepEqual(original.geometry.coordinates, [6.1, 36.8, 80]);
    assert.equal(target.positionCount, 1);
  });

  test('refuse les types et coordonnées invalides sans modifier les données', () => {
    const target = layer([feature('LineString', [[1, 2], [3, 4]])], 2);
    assert.throws(() => movePoint(target, 0, 2, 3), error => error.code === 'EDIT_POINT_REQUIRED');
    target.geojson.features[0] = feature('Point', [1, 2]);
    assert.throws(() => movePoint(target, 0, 181, 0), error => error.code === 'EDIT_COORDINATE_OUT_OF_RANGE');
    assert.deepEqual(target.geojson.features[0].geometry.coordinates, [1, 2]);
    assert.equal(target.editHistory.undo.length, 0);
  });

  test('une limite de capacité bloque la restauration sans retirer l’édition de l’historique', () => {
    const original = feature('Point', [0, 0]);
    const target = layer([original], 1);
    deleteFeature(target, 0);
    assert.equal(undoLayerEdit(target, () => false).blocked, true);
    assert.equal(target.geojson.features.length, 0);
    assert.equal(target.editHistory.undo.length, 1);
    assert.equal(redoLayerEdit(target), null);
  });

  test('annule et rétablit aussi l’ajout d’une entité et met à jour les positions', () => {
    const added = feature('Point', [4, 5]);
    const target = layer([added], 1);
    target.editHistory.undo.push({ kind: 'add', feature: added, index: 0, positions: 1 });
    assert.equal(undoLayerEdit(target).kind, 'add');
    assert.equal(target.geojson.features.length, 0);
    assert.equal(target.positionCount, 0);
    assert.equal(redoLayerEdit(target).kind, 'add');
    assert.equal(target.geojson.features[0], added);
    assert.equal(target.positionCount, 1);
  });

  test('énumère et modifie les sommets imbriqués dans GeometryCollection et MultiPolygon', () => {
    const geometry = { type: 'GeometryCollection', geometries: [
      { type: 'Point', coordinates: [1, 2] },
      { type: 'MultiPolygon', coordinates: [[[[3, 4], [5, 4], [5, 6], [3, 4]]]] }
    ] };
    const target = layer([{ type: 'Feature', properties: {}, geometry }], 5);
    assert.deepEqual(getVertex(geometry, 0).coordinates, [1, 2]);
    assert.deepEqual(getVertex(geometry, 1).coordinates, [3, 4]);
    assert.deepEqual(getVertex(geometry, 4).coordinates, [3, 4]);
    moveVertex(target, 0, 1, 4, 7);
    assert.deepEqual(target.geojson.features[0].geometry.geometries[1].coordinates[0][0][0], [4, 7]);
    assert.deepEqual(target.geojson.features[0].geometry.geometries[1].coordinates[0][0].at(-1), [4, 7]);
    assert.equal(undoLayerEdit(target).kind, 'move-vertex');
    assert.deepEqual(target.geojson.features[0].geometry.geometries[1].coordinates[0][0][0], [3, 4]);
  });

  test('déplace un sommet de polygone et conserve la fermeture de l’anneau', () => {
    const ring = [[0, 0], [4, 0], [4, 4], [0, 0]];
    const target = layer([feature('Polygon', [ring])], 4);
    moveVertex(target, 0, 0, -1, -1);
    assert.deepEqual(target.geojson.features[0].geometry.coordinates[0][0], [-1, -1]);
    assert.deepEqual(target.geojson.features[0].geometry.coordinates[0].at(-1), [-1, -1]);
    assert.equal(undoLayerEdit(target).kind, 'move-vertex');
    assert.deepEqual(target.geojson.features[0].geometry.coordinates[0], ring);
    assert.equal(redoLayerEdit(target).kind, 'move-vertex');
    assert.deepEqual(target.geojson.features[0].geometry.coordinates[0][0], [-1, -1]);
    assert.equal(getVertex(target.geojson.features[0].geometry, 3).coordinates[0], -1);
  });

  test('insère et supprime un sommet de ligne avec historique et compteur corrects', () => {
    const target = layer([feature('LineString', [[0, 0], [2, 2], [4, 4]])], 3);
    assert.equal(canInsertVertex(target.geojson.features[0].geometry, 0), true);
    insertVertex(target, 0, 0, 1, 1);
    assert.deepEqual(target.geojson.features[0].geometry.coordinates, [[0, 0], [1, 1], [2, 2], [4, 4]]);
    assert.equal(undoLayerEdit(target).kind, 'insert-vertex');
    assert.equal(target.positionCount, 3);
    assert.deepEqual(target.geojson.features[0].geometry.coordinates, [[0, 0], [2, 2], [4, 4]]);
    assert.equal(redoLayerEdit(target).kind, 'insert-vertex');
    assert.equal(target.positionCount, 4);
    assert.equal(canDeleteVertex(target.geojson.features[0].geometry, 1), true);
    deleteVertex(target, 0, 1);
    assert.equal(target.positionCount, 3);
    assert.deepEqual(target.geojson.features[0].geometry.coordinates, [[0, 0], [2, 2], [4, 4]]);
    assert.equal(undoLayerEdit(target).kind, 'delete-vertex');
    assert.equal(target.positionCount, 4);
    assert.equal(redoLayerEdit(target).kind, 'delete-vertex');
    assert.equal(target.positionCount, 3);
  });

  test('refuse la suppression qui rendrait une ligne, un anneau ou un point invalide', () => {
    const line = feature('LineString', [[0, 0], [1, 1]]);
    const polygon = feature('Polygon', [[[0, 0], [1, 0], [1, 1], [0, 0]]]);
    const point = feature('Point', [0, 0]);
    assert.equal(canDeleteVertex(line.geometry, 0), false);
    assert.equal(canDeleteVertex(polygon.geometry, 0), false);
    assert.equal(canDeleteVertex(point.geometry, 0), false);
    assert.throws(() => deleteVertex(layer([line], 2), 0, 0), error => error.code === 'EDIT_MINIMUM_VERTICES');
    assert.throws(() => deleteVertex(layer([point], 1), 0, 0), error => error.code === 'EDIT_POINT_VERTEX_DELETE_UNSUPPORTED');
  });

  test('supprime une extrémité de fermeture en faisant tourner l’anneau sans l’ouvrir', () => {
    const target = layer([feature('Polygon', [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]])], 5);
    deleteVertex(target, 0, 0);
    const ring = target.geojson.features[0].geometry.coordinates[0];
    assert.equal(ring.length, 4);
    assert.deepEqual(ring[0], ring.at(-1));
    assert.equal(target.positionCount, 4);
  });

  test('ajoute, remplace et annule un attribut typé JSON, y compris sur une géométrie sans propriétés', () => {
    const original = feature('Point', [1, 2], null);
    const target = layer([original], 1);
    setFeatureAttribute(target, 0, 'population', 42);
    assert.deepEqual(original.properties, { population: 42 });
    assert.equal(undoLayerEdit(target).kind, 'attribute');
    assert.equal(original.properties, null);
    assert.equal(redoLayerEdit(target).kind, 'attribute');
    assert.deepEqual(original.properties, { population: 42 });
    setFeatureAttribute(target, 0, 'population', { estimate: true });
    assert.deepEqual(original.properties.population, { estimate: true });
    assert.equal(undoLayerEdit(target).kind, 'attribute');
    assert.equal(original.properties.population, 42);
  });

  test('supprime et rétablit un attribut sans modifier les autres champs', () => {
    const original = feature('Point', [1, 2], { name: 'Place', height: 12 });
    const target = layer([original], 1);
    deleteFeatureAttribute(target, 0, 'height');
    assert.deepEqual(original.properties, { name: 'Place' });
    assert.equal(undoLayerEdit(target).kind, 'attribute');
    assert.deepEqual(original.properties, { name: 'Place', height: 12 });
    assert.equal(redoLayerEdit(target).kind, 'attribute');
    assert.deepEqual(original.properties, { name: 'Place' });
  });

  test('refuse les noms d’attributs réservés et les valeurs trop volumineuses', () => {
    const target = layer([feature('Point', [1, 2], {})], 1);
    assert.throws(() => setFeatureAttribute(target, 0, '__proto__', 'x'), error => error.code === 'EDIT_ATTRIBUTE_NAME_INVALID');
    assert.throws(() => setFeatureAttribute(target, 0, 'note', 'x'.repeat(20_001)), error => error.code === 'EDIT_ATTRIBUTE_TOO_LARGE');
    assert.deepEqual(target.geojson.features[0].properties, {});
    assert.equal(target.editHistory.undo.length, 0);
  });

  test('borne l’historique par couche à 50 actions et 4 Mo', () => {
    const target = layer([], 0);
    for (let index = 0; index <= MAX_EDIT_HISTORY_OPERATIONS; index++) recordLayerEdit(target, { kind: 'test', index });
    assert.equal(target.editHistory.undo.length, MAX_EDIT_HISTORY_OPERATIONS);
    assert.equal(target.editHistory.historyTruncated, true);
    const huge = layer([], 0);
    const tooLarge = { kind: 'test', payload: 'x'.repeat(Math.ceil(MAX_EDIT_HISTORY_BYTES / 2)) };
    assert.throws(() => recordLayerEdit(huge, tooLarge), error => error.code === 'EDIT_HISTORY_ENTRY_TOO_LARGE');
    assert.equal(huge.editHistory.undo.length, 0);
  });
});
