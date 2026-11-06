import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  SPACE_SYNTAX_EXCLUSIONS, SPACE_SYNTAX_LABEL,
  buildStreetGraph, distanceMeters, integrationSimplifiee, spaceSyntaxRapport
} from '../public/js/space-syntax.mjs';

/* Ruelles en grille 3×3 (nœuds espacés de ~111 m en latitude) : le nœud
   central doit être le plus intégré (RA minimal), les coins le moins. */
function grille3x3() {
  const features = [];
  const d = 0.001; // ~111 m
  const lignes = [];
  for (let r = 0; r < 3; r++) {
    const coords = [];
    for (let c = 0; c < 3; c++) coords.push([c * d, r * d]);
    lignes.push(coords);
  }
  for (let c = 0; c < 3; c++) {
    const coords = [];
    for (let r = 0; r < 3; r++) coords.push([c * d, r * d]);
    lignes.push(coords);
  }
  for (const [i, coords] of lignes.entries())
    features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: { highway: 'residential', name: `voie ${i}`, layerId: 'roads' } });
  return features;
}

const voie = (coords, tags = {}) => ({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates: coords },
  properties: { highway: 'primary', layerId: 'roads', ...tags }
});

describe('space syntax simplifié (phase D, volet 18)', () => {
  test('distanceMeters : haversine cohérente', () => {
    assert.ok(Math.abs(distanceMeters([3, 36], [3, 36]) ) < 1e-9);
    assert.ok(Math.abs(distanceMeters([3, 36], [3, 36.001]) - 111.19) < 0.5);
    assert.equal(distanceMeters([3, 36], null), Infinity);
  });

  test('buildStreetGraph : nœuds dédoublés, arêtes nommées, exclusions', () => {
    const features = [
      voie([[3, 36], [3.001, 36], [3.001, 36.001]], { name: 'Rue Didouche Mourad' }),
      voie([[3, 36], [3, 36.001]], { highway: 'footway' }),           // exclu
      voie([[3.002, 36], [3.002, 36.001]], { highway: 'service' }),      // conservé
      { type: 'Feature', geometry: { type: 'Point', coordinates: [3, 36] }, properties: { amenity: 'school' } } // ignoré
    ];
    const g = buildStreetGraph(features);
    assert.equal(g.truncated, false);
    assert.equal(g.nodes.length, 5);            // 3 coins de la voie + 2 du « service »
    assert.equal(g.edges.length, 3);            // 2 + 1 (footway exclu)
    assert.equal(g.typesExcl, 1);
    assert.ok(g.edges.some(e => e.name === 'Rue Didouche Mourad'));
    assert.ok(g.edges.every(e => e.len > 0));
  });

  test('buildStreetGraph : MultiLineString et tronçons nuls ignorés', () => {
    const features = [{
      type: 'Feature',
      geometry: { type: 'MultiLineString', coordinates: [[[0, 0], [0.001, 0]], [[0, 0.001], [0.001, 0.001]], [[0.002, 0], [0.002, 0]]] },
      properties: { highway: 'secondary' }
    }];
    const g = buildStreetGraph(features);
    assert.equal(g.edges.length, 2);            // le tronçon nul [0.002,0]→[0.002,0] est ignoré
    assert.equal(g.tronconsIgnores, 1);
  });

  test('buildStreetGraph : tronque au-delà de maxNodes', () => {
    const coords = [];
    for (let i = 0; i < 20; i++) coords.push([i * 0.001, 0]);
    const g = buildStreetGraph([voie(coords)], { maxNodes: 5 });
    assert.equal(g.truncated, true);
  });

  test('integrationSimplifiee : grille 3×3, le centre est le plus intégré', () => {
    const g = buildStreetGraph(grille3x3());
    const res = integrationSimplifiee(g);
    assert.equal(res.ok, true);
    assert.equal(res.nodes, 9);
    assert.equal(res.edges, 12);
    assert.equal(res.bestNode, 4);              // nœud central (1,1)
    /* MD = (4×1 + 4×2)/8 = 1,5 ; k = 9 → RA = 2(1,5−1)/(9−2) = 1/7 */
    assert.ok(Math.abs(res.bestRA - 1 / 7) < 0.001, `RA centre = ${res.bestRA}`);
    assert.equal(res.topEdges.length, 5);
    assert.ok(res.topEdges.every(e => Array.isArray(e.coords) && e.coords.length === 2));
    assert.ok(res.meanRA > 0);
    assert.match(res.label, /approximation/i);
  });

  test('integrationSimplifiee : ligne droite, RA croît vers les extrémités', () => {
    const coords = [];
    for (let i = 0; i < 5; i++) coords.push([i * 0.001, 0]);
    const res = integrationSimplifiee(buildStreetGraph([voie(coords)]));
    assert.equal(res.ok, true);
    assert.equal(res.nodes, 5);
    assert.equal(res.bestNode, 2);              // nœud médian
  });

  test('integrationSimplifiee : graphe trop grand → refus explicite', () => {
    const coords = [];
    for (let i = 0; i < 50; i++) coords.push([i * 0.001, 0]);
    const g = buildStreetGraph([voie(coords)]);
    const res = integrationSimplifiee(g, { maxNodes: 10 });
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'graph-too-large');
  });

  test('spaceSyntaxRapport : sans voies → no-edges ; label d’approximation présent', () => {
    const res = spaceSyntaxRapport({ features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [3, 36] }, properties: {} }], center: { lat: 36, lon: 3 } });
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'no-nodes');       // aucune voie → aucun nœud
    assert.equal(res.label, SPACE_SYNTAX_LABEL);
    const ok = spaceSyntaxRapport({ features: grille3x3(), center: { lat: 36.001, lon: 3.001 } });
    assert.equal(ok.ok, true);
    assert.ok(ok.totalLengthM > 0);
    assert.equal(ok.center.lat, 36.001);
  });

  test('exclusions documentées : footway/cycleway/pedestrian hors graphe', () => {
    for (const h of ['footway', 'cycleway', 'path', 'pedestrian', 'construction'])
      assert.ok(SPACE_SYNTAX_EXCLUSIONS.has(h), h);
  });
});
