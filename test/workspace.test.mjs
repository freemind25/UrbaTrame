import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkspaceProject, createWorkspaceTemplate, parseWorkspaceFile,
  removeWorkspaceRecord, serializeWorkspaceRecord, upsertWorkspaceRecord,
  validateWorkspaceRecord
} from '../public/js/workspace.mjs';

const projectInput = {
  name: '  Centre-ville   — test ',
  site: { lat: 36.47, lon: 2.83, name: 'Blida' },
  selectedIds: ['roads', 'volumes', 'unknown', 'roads'],
  shape: 'circle', radius: 600, time: 12,
  sunDate: '2026-06-21',
  scenario: { far: 2.4, cost: 'à saisir', unexpected: { unsafe: true } },
  appearance: {
    palettes: { roads: 5, volumes: 8, unknown: 2 },
    names: { roads: '  Rue principale  ', unknown: 'À ignorer' },
    noText: ['roads', 'unknown', 'roads']
  }
};

describe('espace de travail local', () => {
  test('valide et normalise un projet sans enregistrer géométrie ni résultats', () => {
    const project = createWorkspaceProject(projectInput);
    assert.ok(project);
    assert.equal(project.type, 'urbatrame-project');
    assert.equal(project.name, 'Centre-ville — test');
    assert.deepEqual(project.selectedIds, ['roads', 'volumes']);
    assert.deepEqual(project.scenario, { far: '2.4', cost: 'à saisir' });
    assert.deepEqual(project.appearance, {
      palettes: { roads: 5 }, names: { roads: 'Rue principale' }, noText: ['roads']
    });
    assert.deepEqual(project.site, { lat: 36.47, lon: 2.83, name: 'Blida' });
    assert.equal('geometry' in project, false);
    assert.equal('results' in project, false);
  });

  test('exporte puis réimporte un projet JSON valide', () => {
    const project = createWorkspaceProject(projectInput);
    const json = serializeWorkspaceRecord(project);
    const imported = parseWorkspaceFile(json);
    assert.equal(imported.type, 'urbatrame-project');
    assert.equal(imported.name, project.name);
    assert.deepEqual(imported.selectedIds, project.selectedIds);
    assert.deepEqual(imported.appearance, project.appearance);
    assert.deepEqual(imported.site, project.site);
  });

  test('garde les anciens fichiers compatibles et filtre les styles importés', () => {
    const legacy = { ...projectInput, appearance: undefined };
    delete legacy.appearance;
    const importedLegacy = validateWorkspaceRecord(createWorkspaceProject(legacy));
    assert.equal('appearance' in importedLegacy, false);
    const styled = createWorkspaceProject({
      ...projectInput,
      appearance: {
        palettes: { roads: -1, landuse: 3.5, gw: 2 },
        names: { roads: 'x'.repeat(80) },
        noText: ['unknown', 'gw']
      }
    });
    assert.deepEqual(styled.appearance, {
      palettes: { gw: 2 }, names: { roads: 'x'.repeat(60) }, noText: ['gw']
    });
  });

  test('valide les modèles réutilisables sans coordonnées de site', () => {
    const template = createWorkspaceTemplate({
      name: 'Contexte piéton', selectedIds: ['walkroutes', 'transit'],
      shape: 'rect', radius: 800, time: 9.5, sunDate: '2026-03-20'
    });
    assert.ok(template);
    assert.equal(template.type, 'urbatrame-template');
    assert.equal('site' in template, false);
    assert.deepEqual(validateWorkspaceRecord(template), template);
  });

  test('rejette coordonnées, plages, date, type et fichiers JSON invalides ou trop gros', () => {
    assert.equal(createWorkspaceProject({ ...projectInput, site: { lat: 91, lon: 0 } }), null);
    assert.equal(createWorkspaceProject({ ...projectInput, radius: 625 }), null);
    assert.equal(createWorkspaceProject({ ...projectInput, time: 22 }), null);
    assert.equal(createWorkspaceProject({ ...projectInput, sunDate: '2026-02-30' }), null);
    assert.equal(parseWorkspaceFile('{bad json'), null);
    assert.equal(parseWorkspaceFile('x'.repeat(200_001)), null);
    assert.equal(validateWorkspaceRecord({ type: 'unknown', version: 1 }), null);
  });

  test('ajoute, remplace et supprime des enregistrements par identifiant', () => {
    const first = createWorkspaceTemplate({ id: 'first', name: 'Premier', selectedIds: [], sunDate: '2026-01-01' });
    const replacement = { ...first, name: 'Renommé', updatedAt: Date.now() + 1 };
    const second = createWorkspaceProject({ ...projectInput, id: 'second' });
    let records = upsertWorkspaceRecord([], first);
    records = upsertWorkspaceRecord(records, second);
    records = upsertWorkspaceRecord(records, replacement);
    assert.equal(records.length, 2);
    assert.equal(records.find(item => item.id === 'first').name, 'Renommé');
    assert.deepEqual(removeWorkspaceRecord(records, 'second').map(item => item.id), ['first']);
  });
});
