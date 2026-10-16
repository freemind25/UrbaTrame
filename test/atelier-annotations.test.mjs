import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_FIELD_NOTES, createFieldNote, fieldNotesGeoJSON, fieldNotesInExtent,
  normalizeFieldNotes
} from '../public/js/atelier/annotations.mjs';

const note = (id, lat, lon, extra = {}) => createFieldNote({
  id, lat, lon, category: 'observation', title: `Note ${id}`, siteName: 'Site test', ...extra
}, { id, now: 1_700_000_000_000 });

describe('repères locaux Altiplan', () => {
  test('valide les coordonnées, la catégorie et le titre, puis borne les textes', () => {
    const valid = createFieldNote({
      lat: 36.2642, lon: 6.6969, category: 'access', title: '  Entrée principale  ',
      text: '  Passage étroit\nà vérifier  ', siteName: 'El Khroub'
    }, { id: 'note-1', now: 1_700_000_000_000 });
    assert.equal(valid.title, 'Entrée principale');
    assert.equal(valid.text, 'Passage étroit\nà vérifier');
    assert.equal(valid.category, 'access');
    assert.equal(valid.siteName, 'El Khroub');
    assert.equal(createFieldNote({ lat: 90, lon: 0, category: 'observation', title: 'Hors limite' }), null);
    assert.equal(createFieldNote({ lat: 0, lon: 0, category: 'unknown', title: 'Type invalide' }), null);
    assert.equal(createFieldNote({ lat: 0, lon: 0, category: 'observation', title: '   ' }), null);
  });

  test('ne retient que les notes situées dans le cercle ou le carré courant', () => {
    const diagonal = note('diagonal', 0.0008, 0.0008);
    const center = note('center', 0, 0);
    const notes = [diagonal, center];
    assert.deepEqual(fieldNotesInExtent(notes, { lat: 0, lon: 0, radius: 100, shape: 'circle' }).map(x => x.id), ['center']);
    assert.deepEqual(fieldNotesInExtent(notes, { lat: 0, lon: 0, radius: 100, shape: 'square' }).map(x => x.id), ['diagonal', 'center']);
  });

  test('assainit le stockage local, déduplique les identifiants et plafonne le nombre de notes', () => {
    const records = normalizeFieldNotes([
      note('duplicate', 0, 0), note('duplicate', 0.1, 0.1), null,
      { id: 'bad', lat: 200, lon: 0, category: 'observation', title: 'Coordonnée invalide' }
    ]);
    assert.equal(records.length, 1);
    const limited = normalizeFieldNotes(Array.from({ length: MAX_FIELD_NOTES + 10 }, (_, i) => note(`n${i}`, 0, 0)));
    assert.equal(limited.length, MAX_FIELD_NOTES);
  });

  test('exporte des Points GeoJSON avec l’ordre [longitude, latitude], sans fabriquer de polygones', () => {
    const featureCollection = fieldNotesGeoJSON([note('export-1', 36.2642, 6.6969, { text: 'À revoir' })]);
    assert.equal(featureCollection.type, 'FeatureCollection');
    assert.equal(featureCollection.features.length, 1);
    const feature = featureCollection.features[0];
    assert.equal(feature.geometry.type, 'Point');
    assert.deepEqual(feature.geometry.coordinates, [6.6969, 36.2642]);
    assert.equal(feature.properties.note, 'À revoir');
    assert.equal(feature.properties.site, 'Site test');
    assert.equal(typeof feature.properties.created_at, 'string');
  });
});
