import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultFieldTemplate, normalizeFieldTemplate, buildSurveyProperties,
  escapeCsvCell, geometryToWkt, exportVisibleCsv
} from '../public/js/atelier/field-survey.mjs';

describe('UrbaTrame · gabarits et exports de relevé terrain', () => {
  test('le gabarit par défaut couvre les trois géométries et des champs typés', () => {
    const template = normalizeFieldTemplate(defaultFieldTemplate());
    assert.deepEqual(template.geometryTypes, ['Point', 'LineString', 'Polygon']);
    assert.deepEqual(template.fields.map(field => field.type), ['select', 'text', 'date']);
    assert.equal(template.fields[0].required, true);
  });

  test('valide les attributs et conserve les nombres négatifs comme nombres', () => {
    const template = normalizeFieldTemplate({ name: 'Nivellement', geometryTypes: ['Point'], fields: [
      { key: 'altitude', label: 'Altitude', type: 'number', required: true },
      { key: 'controle', label: 'Contrôlé', type: 'boolean', required: false }
    ] });
    const values = buildSurveyProperties(template, { altitude: '-12.75', controle: false });
    assert.equal(values.ok, true);
    assert.equal(values.properties.altitude, -12.75);
    assert.equal(typeof values.properties.altitude, 'number');
    assert.equal(values.properties.controle, false);
    assert.equal(buildSurveyProperties(template, { altitude: 'erreur' }).ok, false);
    assert.equal(buildSurveyProperties(template, { altitude: '' }).error, 'FIELD_VALUE_REQUIRED');
  });

  test('bloque les clés réservées, doublons et listes sans choix', () => {
    assert.throws(() => normalizeFieldTemplate({ name: 'x', fields: [{ key: 'gps_accuracy_m', label: 'Précision', type: 'number' }] }), error => error.code === 'FIELD_TEMPLATE_KEY_INVALID');
    assert.throws(() => normalizeFieldTemplate({ name: 'x', fields: [
      { key: 'classe', label: 'A', type: 'text' }, { key: 'classe', label: 'B', type: 'text' }
    ] }), error => error.code === 'FIELD_TEMPLATE_KEY_DUPLICATE');
    assert.throws(() => normalizeFieldTemplate({ name: 'x', fields: [{ key: 'classe', label: 'Classe', type: 'select', options: [] }] }), error => error.code === 'FIELD_TEMPLATE_OPTIONS_INVALID');
  });

  test('exporte WKT, provenance et horodatage; une valeur texte de formule est neutralisée', () => {
    const layers = [{
      name: 'Relevé', source: 'Campagne locale', visible: true, kind: 'vector',
      geojson: { features: [{
        type: 'Feature', id: 'p-1', properties: { altitude: -12.75, observation: '=HYPERLINK("x")' },
        geometry: { type: 'Point', coordinates: [6.7, 36.2] }
      }] }
    }];
    const csv = exportVisibleCsv(layers, { now: new Date('2026-10-21T10:00:00.000Z') });
    assert.match(csv, /"source"/);
    assert.match(csv, /"Campagne locale"/);
    assert.match(csv, /"2026-10-21T10:00:00\.000Z"/);
    assert.match(csv, /"POINT \(6\.7 36\.2\)"/);
    assert.match(csv, /"-12\.75"/);
    assert.match(csv, /"'=HYPERLINK\(""x""\)"/);
    assert.equal(escapeCsvCell(-12.75), '"-12.75"');
    assert.equal(geometryToWkt({ type: 'LineString', coordinates: [[0, 0], [1, -2]] }), 'LINESTRING (0 0, 1 -2)');
  });

  test('ignore les couches invisibles et raster dans le tableau CSV', () => {
    const csv = exportVisibleCsv([
      { visible: false, kind: 'vector', geojson: { features: [{ properties: {}, geometry: null }] } },
      { visible: true, kind: 'raster', geojson: { features: [] } }
    ]);
    assert.match(csv, /"layer","source","exported_at"/);
    assert.equal(csv.split('\r\n').filter(Boolean).length, 1);
  });
});
