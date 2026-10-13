import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normaliser, arbresDepuisRangées } from '../public/js/atelier/osm-data.mjs';

const geom = (lat, lon, size = .0001) => [
  { lat, lon }, { lat, lon: lon + size }, { lat: lat + size, lon: lon + size },
  { lat: lat + size, lon }, { lat, lon }
];

describe('normalisation des couches OSM', () => {
  const raw = [
    { type: 'node', id: 1, lat: 36.1, lon: 6.1, tags: { natural: 'tree', 'tree:height': '8' } },
    { type: 'way', id: 2, geometry: geom(36.1, 6.1), tags: { natural: 'tree_row' } },
    { type: 'way', id: 3, geometry: geom(36.1, 6.1), tags: { building: 'apartments', height: '12 m', name: 'Bloc A' } },
    { type: 'way', id: 4, geometry: [{ lat: 36.1, lon: 6.1 }, { lat: 36.11, lon: 6.11 }], tags: { highway: 'residential' } },
    { type: 'way', id: 5, geometry: geom(36.1, 6.1), tags: { landuse: 'residential' } },
    { type: 'way', id: 6, geometry: geom(36.1, 6.1), tags: { boundary: 'parcel' } },
    { type: 'way', id: 7, geometry: [{ lat: 36.1, lon: 6.1 }, { lat: 36.11, lon: 6.11 }], tags: { railway: 'rail' } },
    { type: 'way', id: 8, geometry: [{ lat: 36.1, lon: 6.1 }, { lat: 36.11, lon: 6.11 }], tags: { waterway: 'stream' } },
    { type: 'node', id: 9, lat: 36.1, lon: 6.1, tags: { amenity: 'school', name: 'École' } }
  ];
  const d = normaliser(raw);
  test('les arbres ponctuels conservent la hauteur OSM', () => {
    assert.equal(d.trees.length, 1); assert.equal(d.trees[0].h, 8);
  });
  test('bâti et voies sont séparés et normalisés', () => {
    assert.equal(d.build.length, 1); assert.equal(d.build[0].h, 12); assert.equal(d.build[0].t, 'apartments');
    assert.equal(d.roads.length, 1); assert.equal(d.roads[0].h, 'residential');
  });
  test('arbres en rangée, zones, parcelles, rail et eau linéaire restent distincts', () => {
    assert.equal(d.treeRows.length, 1); assert.equal(d.landuse.length, 1);
    assert.equal(d.parcels.length, 1); assert.equal(d.rail.length, 1);
    assert.equal(d.waterways.length, 1);
  });
  test('les POI sont réservés aux nœuds utiles', () => {
    assert.equal(d.pois.length, 1); assert.equal(d.pois[0].nom, 'École');
  });
});

describe('arbres issus d’une rangée OSM', () => {
  test('crée des points 3D à intervalles réguliers sans altérer la ligne source', () => {
    const row = { id: 42, nom: 'Allée', tags: { height: '12' }, g: [[0, 0], [0, 14 / 111320]] };
    const trees = arbresDepuisRangées([row]);
    assert.equal(trees.length, 3);
    assert.equal(trees[0].lon, row.g[0][1]);
    assert.ok(Math.abs(trees.at(-1).lon - row.g[1][1]) < 1e-12);
    assert.ok(trees.every(t => t.h === 12 && t.row === 42));
    assert.equal(row.g.length, 2);
  });
  test('les rangées courtes sont représentées par un seul arbre et la limite est respectée', () => {
    const rows = Array.from({ length: 8 }, (_, id) => ({ id, g: [[36, 6], [36, 6.00001]] }));
    assert.equal(arbresDepuisRangées(rows).length, 8);
    assert.equal(arbresDepuisRangées(rows, { limite: 3 }).length, 3);
  });
});
