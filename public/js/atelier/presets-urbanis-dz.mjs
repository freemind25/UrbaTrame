/* Modèles de relevé prêts à l'emploi issus du pack « urbanis-dz »
   (dossier Dropbox partagé aka56v8xvg0c2u2r96g1k, 2026-11-15) :
   - assets/registre_juridique_template.csv → gabarit « Registre juridique »
   - references/risques.md (grille aléa/exposition/vulnérabilité/réponse/décision)
     → gabarit « Grille risques »
   Les deux sont des dictionnaires d'attributs pour le relevé terrain (02),
   au format UrbaTrameFieldTemplate. Conformément au pack : aucune référence
   juridique n'y est affirmée — le champ « statut » vaut « à vérifier » et le
   panneau rappelle de contrôler au JORADP. */
import { normalizeFieldTemplate } from './field-survey.mjs';

export const URBANIS_DZ_SOURCE = 'Pack « urbanis-dz » (Dropbox partagé aka56v8xvg0c2u2r96g1k) — statuts à vérifier au JORADP';

const REGISTRE_JURIDIQUE = {
  format: 'UrbaTrameFieldTemplate',
  version: 1,
  name: 'Registre juridique (urbanis-dz)',
  geometryTypes: ['Point', 'LineString', 'Polygon'],
  fields: [
    { key: 'ref_id', label: 'ID (ex. DZ-URB-90-29)', type: 'text', required: true, options: [] },
    { key: 'domaine', label: 'Domaine', type: 'select', required: true, options: ['urbanisme', 'risques', 'environnement', 'foncier', 'patrimoine', 'données', 'autre'] },
    { key: 'reference_complete', label: 'Référence complète (nature, n°, date, intitulé)', type: 'text', required: true, options: [] },
    { key: 'joradp', label: 'JORADP (n°, date, page, lien)', type: 'text', required: false, options: [] },
    { key: 'statut', label: 'Statut', type: 'select', required: true, options: ['en vigueur', 'modifié', 'abrogé', 'en projet', 'transitoire à vérifier', 'non vérifié — à contrôler au JORADP'] },
    { key: 'textes_lies', label: 'Textes liés (modificatifs, décrets, arrêtés)', type: 'text', required: false, options: [] },
    { key: 'portee', label: 'Portée concrète', type: 'text', required: false, options: [] },
    { key: 'questions_couvertes', label: 'Questions couvertes', type: 'text', required: false, options: [] },
    { key: 'autorites', label: 'Autorités compétentes', type: 'text', required: false, options: [] },
    { key: 'derniere_verification', label: 'Dernière vérification (date)', type: 'date', required: false, options: [] },
    { key: 'niveau_confiance', label: 'Niveau de confiance', type: 'select', required: true, options: ['élevé', 'moyen', 'faible — non vérifié'] }
  ]
};

const GRILLE_RISQUES = {
  format: 'UrbaTrameFieldTemplate',
  version: 1,
  name: 'Grille risques (urbanis-dz)',
  geometryTypes: ['Point', 'LineString', 'Polygon'],
  fields: [
    { key: 'alea', label: 'ALÉA (phénomène plausible)', type: 'select', required: true, options: ['séisme', 'risque géologique / glissement', 'inondation / ruissellement', 'incendie / feu de forêt', 'risque industriel (installation classée)', 'pollution / déchets dangereux', 'chaleur', 'autre'] },
    { key: 'exposition', label: 'EXPOSITION (qui/quoi est dans la zone)', type: 'text', required: true, options: [] },
    { key: 'vulnerabilite', label: 'VULNÉRABILITÉ (fragilités)', type: 'text', required: false, options: [] },
    { key: 'capacite_reponse', label: 'CAPACITÉ DE RÉPONSE (accès secours, eau, énergie…)', type: 'text', required: false, options: [] },
    { key: 'decision', label: 'DÉCISION envisagée', type: 'select', required: true, options: ['éviter', 'réduire', 'adapter', 'protéger', 'préparer', 'relocaliser'] },
    { key: 'pieces_services', label: 'Pièces / services à consulter', type: 'text', required: false, options: [] },
    { key: 'source', label: 'Source (carte, étude, avis)', type: 'text', required: false, options: [] },
    { key: 'date_releve', label: 'Date du relevé', type: 'date', required: true, options: [] }
  ]
};

const PRESETS = [
  {
    id: 'registre-juridique',
    name: 'Registre juridique (urbanis-dz)',
    description: 'Saisie d’un texte juridique : référence complète, statut (à vérifier au JORADP), autorités, niveau de confiance — d’après assets/registre_juridique_template.csv.',
    template: REGISTRE_JURIDIQUE
  },
  {
    id: 'grille-risques',
    name: 'Grille risques (urbanis-dz)',
    description: 'Aléa / exposition / vulnérabilité / capacité de réponse / décision, avec pièces et services — d’après references/risques.md. Aucune conclusion « sans risque » sans source.',
    template: GRILLE_RISQUES
  }
];

/* Presets normalisés au chargement du module (validation immédiate). */
export const URBANIS_DZ_PRESETS = PRESETS.map(p => ({ ...p, template: normalizeFieldTemplate(p.template) }));

export function getUrbanisDzPreset(id) {
  const preset = URBANIS_DZ_PRESETS.find(p => p.id === id);
  if (!preset) throw Object.assign(new Error('PRESET_INCONNU'), { code: 'PRESET_INCONNU' });
  /* copie défensive : le gabarit chargé ne doit pas être modifié en place */
  return { ...preset, template: normalizeFieldTemplate(JSON.parse(JSON.stringify(preset.template))) };
}
