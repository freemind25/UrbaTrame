import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboardSummary } from '../public/js/atelier/dashboard.mjs';
import { layersTopFirst, moveLayerStack } from '../public/js/atelier/layer-stack.mjs';

describe('UrbaTrame · widgets de l’atelier cartographique', () => {
  test('calcule des KPI descriptifs et une répartition filtrée sans inventer de données', () => {
    const features = [
      { type: 'Feature', properties: { usage: 'parc' }, geometry: { type: 'Point', coordinates: [3, 36] } },
      { type: 'Feature', properties: { usage: 'parc' }, geometry: { type: 'Point', coordinates: [3.01, 36] } },
      { type: 'Feature', properties: { usage: 'école' }, geometry: { type: 'LineString', coordinates: [[3, 36], [3.01, 36]] } },
      { type: 'Feature', properties: { usage: null }, geometry: { type: 'Polygon', coordinates: [[[3, 36], [3.01, 36], [3.01, 36.01], [3, 36]]] } }
    ];
    const result = buildDashboardSummary(features, 'usage');
    assert.equal(result.featureCount, 4);
    assert.equal(result.pointCount, 2);
    assert.equal(result.lineCount, 1);
    assert.equal(result.polygonCount, 1);
    assert.equal(result.categoryTotal, 4);
    assert.deepEqual(result.categories.slice(0, 3), [
      { label: 'parc', count: 2 }, { label: '(vide)', count: 1 }, { label: 'école', count: 1 }
    ]);
    assert.ok(result.lengthMeters > 0);
    assert.ok(result.areaSqMeters > 0);
    assert.equal(result.extent.west, 3);
  });

  test('limite les classes, regroupe la longue traîne et gère les couches vides', () => {
    const features = Array.from({ length: 10 }, (_, index) => ({
      type: 'Feature', properties: { classe: `c${index}` }, geometry: { type: 'Point', coordinates: [index, 0] }
    }));
    const result = buildDashboardSummary(features, 'classe', 4);
    assert.equal(result.categories.length, 5);
    assert.equal(result.categories.at(-1).label, 'Autres catégories');
    assert.equal(result.categories.at(-1).count, 6);
    assert.deepEqual(buildDashboardSummary([]).categories, []);
    assert.equal(buildDashboardSummary([]).featureCount, 0);
  });

  test('la pile suit un ordre visuel haut-vers-bas et l’ordre est modifiable par clavier', () => {
    const layers = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]; // rendu SVG : a en bas, c au-dessus
    assert.deepEqual(layersTopFirst(layers).map(layer => layer.id), ['c', 'b', 'a']);
    assert.deepEqual(moveLayerStack(layers, 'a', 'up').map(layer => layer.id), ['b', 'a', 'c']);
    assert.deepEqual(moveLayerStack(layers, 'c', 'down').map(layer => layer.id), ['a', 'c', 'b']);
    assert.deepEqual(moveLayerStack(layers, 'c', 'up').map(layer => layer.id), ['a', 'b', 'c']);
    assert.deepEqual(moveLayerStack(layers, 'a', 'down').map(layer => layer.id), ['a', 'b', 'c']);
  });
});
