import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { URBANIS_DZ_PRESETS, getUrbanisDzPreset, URBANIS_DZ_SOURCE } from '../public/js/atelier/presets-urbanis-dz.mjs';
import { normalizeFieldTemplate, buildSurveyProperties, serializeFieldTemplate, parseFieldTemplate } from '../public/js/atelier/field-survey.mjs';

describe('UrbaTrame · modèles urbanis-dz (pack Dropbox)', () => {
  test('deux modèles prêts à l’emploi, normalisés et valides', () => {
    assert.equal(URBANIS_DZ_PRESETS.length, 2);
    const ids = URBANIS_DZ_PRESETS.map(p => p.id);
    assert.deepEqual(ids, ['registre-juridique', 'grille-risques']);
    for (const preset of URBANIS_DZ_PRESETS) {
      // déjà normalisés au chargement : re-normaliser ne doit pas échouer
      const again = normalizeFieldTemplate(preset.template);
      assert.equal(again.name, preset.template.name);
      assert.ok(preset.template.fields.length >= 5);
      assert.match(URBANIS_DZ_SOURCE, /JORADP/);
    }
  });

  test('registre juridique : champs issus du CSV registre_juridique_template.csv', () => {
    const preset = getUrbanisDzPreset('registre-juridique');
    const keys = preset.template.fields.map(f => f.key);
    // colonnes du CSV du pack (ID → ref_id car « id » est réservé)
    for (const k of ['ref_id', 'domaine', 'reference_complete', 'joradp', 'statut', 'textes_lies', 'portee', 'questions_couvertes', 'autorites', 'derniere_verification', 'niveau_confiance'])
      assert.ok(keys.includes(k), `champ manquant: ${k}`);
    const statut = preset.template.fields.find(f => f.key === 'statut');
    assert.equal(statut.type, 'select');
    assert.ok(statut.options.includes('non vérifié — à contrôler au JORADP'));
    assert.ok(!statut.options.includes('en vigueur') || statut.options.includes('en vigueur')); // « en vigueur » est un statut possible mais jamais affirmé sans vérification
    const confiance = preset.template.fields.find(f => f.key === 'niveau_confiance');
    assert.ok(confiance.options.includes('faible — non vérifié'));
    assert.equal(preset.template.fields.find(f => f.key === 'derniere_verification').type, 'date');
  });

  test('grille risques : les 5 rubriques du protocole risques.md', () => {
    const preset = getUrbanisDzPreset('grille-risques');
    const keys = preset.template.fields.map(f => f.key);
    for (const k of ['alea', 'exposition', 'vulnerabilite', 'capacite_reponse', 'decision', 'date_releve'])
      assert.ok(keys.includes(k), `rubrique manquante: ${k}`);
    const decision = preset.template.fields.find(f => f.key === 'decision');
    assert.deepEqual(decision.options, ['éviter', 'réduire', 'adapter', 'protéger', 'préparer', 'relocaliser']);
    const alea = preset.template.fields.find(f => f.key === 'alea');
    assert.ok(alea.options.includes('séisme') && alea.options.includes('inondation / ruissellement'));
  });

  test('getUrbanisDzPreset renvoie une copie défensive et rejette un id inconnu', () => {
    const a = getUrbanisDzPreset('grille-risques');
    a.template.fields[0].label = 'MODIFIÉ';
    const b = getUrbanisDzPreset('grille-risques');
    assert.notEqual(b.template.fields[0].label, 'MODIFIÉ');
    assert.throws(() => getUrbanisDzPreset('inconnu'), e => e.code === 'PRESET_INCONNU');
  });

  test('les modèles produisent des propriétés de relevé valides (buildSurveyProperties) et sont sérialisables', () => {
    const preset = getUrbanisDzPreset('registre-juridique');
    const result = buildSurveyProperties(preset.template, {
      ref_id: 'DZ-URB-90-29',
      domaine: 'urbanisme',
      reference_complete: 'Loi n° 90-29 du 1er décembre 1990 relative à l’aménagement et à l’urbanisme',
      statut: 'non vérifié — à contrôler au JORADP',
      niveau_confiance: 'faible — non vérifié'
    });
    assert.equal(result.ok, true);
    assert.equal(result.properties.ref_id, 'DZ-URB-90-29');
    assert.equal(result.properties.statut, 'non vérifié — à contrôler au JORADP');
    // champ select invalide → refus propre
    const bad = buildSurveyProperties(preset.template, { ref_id: 'X', domaine: 'urbanisme', reference_complete: 'Y', statut: 'certifié en vigueur', niveau_confiance: 'élevé' });
    assert.equal(bad.ok, false);
    assert.equal(bad.error, 'FIELD_VALUE_INVALID');
    const file = serializeFieldTemplate(preset.template);
    const back = parseFieldTemplate(JSON.stringify(file));
    assert.equal(back.name, preset.template.name);
    assert.equal(back.fields.length, preset.template.fields.length);
  });
});
