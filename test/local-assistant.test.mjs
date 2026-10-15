import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSpatialQuestion } from '../public/js/local-assistant.mjs';

describe('assistant spatial local', () => {
  test('associe une demande française aux analyses existantes sans appel externe', () => {
    const result = analyzeSpatialQuestion('Où sont les espaces verts et l’eau ?');
    assert.deepEqual(result.analysisIds, ['gw']);
    assert.deepEqual(result.intents, ['green-water']);
    assert.equal(result.noMatch, false);
    assert.equal(result.openReport, false);
    assert.deepEqual(result.warnings, []);
  });

  test('propose des analyses de marche et de transport, avec leur hypothèse signalée', () => {
    const result = analyzeSpatialQuestion('Analyse l’accessibilité piétonne en 15 minutes et les arrêts de bus');
    assert.ok(result.analysisIds.includes('walkroutes'));
    assert.ok(result.analysisIds.includes('transit'));
    assert.ok(result.analysisIds.includes('pedestrian'));
    assert.ok(result.warnings.includes('indicative-walking-speed'));
  });

  test('distingue la lecture fonctionnelle OSM des règles et limites juridiques', () => {
    const result = analyzeSpatialQuestion('Quel est le zonage et quelles parcelles sont constructibles ?');
    assert.ok(result.analysisIds.includes('zoningplan'));
    assert.ok(result.warnings.includes('legal-data'));
  });

  test('ne fabrique pas de démographie ou de données de marché absentes', () => {
    const result = analyzeSpatialQuestion('Compare la population et les loyers de ce quartier');
    assert.deepEqual(result.analysisIds, []);
    assert.equal(result.noMatch, true);
    assert.ok(result.warnings.includes('market-data-unavailable'));
  });

  test('oriente la faisabilité vers le rapport et rappelle que le coût est saisi', () => {
    const result = analyzeSpatialQuestion('Estime la faisabilité et le coût de construction avec mon FAR');
    assert.equal(result.openReport, true);
    assert.ok(result.warnings.includes('user-cost-only'));
    assert.equal(result.noMatch, false);
  });

  test('comprend quelques demandes anglaises et refuse les requêtes vides/inconnues', () => {
    const english = analyzeSpatialQuestion('Show building density and 3D massing');
    assert.ok(english.analysisIds.includes('density'));
    assert.ok(english.analysisIds.includes('volumes'));
    assert.equal(analyzeSpatialQuestion('   ').warnings[0], 'empty');
    assert.equal(analyzeSpatialQuestion('run a market forecast').noMatch, true);
  });
});
