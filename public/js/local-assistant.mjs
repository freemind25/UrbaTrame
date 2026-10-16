/* Assistant spatial local : rapproche une question en français/anglais des
   analyses déjà présentes dans UrbaTrame. Aucun modèle, réseau ou géocodage
   implicite : les correspondances sont déterministes et vérifiables. */

const normalize = value => String(value || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const hasPhrase = (text, phrase) => (` ${text} `).includes(` ${normalize(phrase)} `);

const RULES = [
  { intent: 'roads', ids: ['roads', 'pedestrian'], terms: ['voirie', 'rues', 'rue', 'routes', 'route', 'street', 'streets', 'roads', 'road network', 'reseau viaire', 'connectivite'] },
  { intent: 'landuse', ids: ['landuse'], terms: ['occupation du sol', 'usage du sol', 'land use', 'landuse', 'zones fonctionnelles'] },
  { intent: 'functional-zoning', ids: ['zoningplan', 'landuse'], terms: ['zonage', 'zoning', 'zone', 'zones'] },
  { intent: 'green-water', ids: ['gw'], terms: ['vert', 'espaces verts', 'parc', 'parcs', 'vegetation', 'green space', 'green spaces', 'water', 'eau', 'hydrographie'] },
  { intent: 'density', ids: ['density'], terms: ['densite', 'density', 'emprise batie', 'building density'] },
  { intent: 'massing', ids: ['massing', 'volumes'], terms: ['volume', 'volumes', '3d', 'hauteur', 'hauteurs', 'height', 'building height', 'typologie', 'typology', 'batiment', 'batiments', 'bati', 'building', 'buildings'] },
  { intent: 'amenities', ids: ['sitemap', 'poitype', 'poiheat'], terms: ['equipement', 'equipements', 'service', 'services', 'amenity', 'amenities', 'poi', 'point d interet', 'points d interet', 'ecole', 'ecoles', 'school', 'schools', 'hopital', 'hospital', 'pharmacie', 'pharmacy', 'commerce', 'shops'] },
  { intent: 'transit', ids: ['transit', 'walkroutes'], terms: ['transport', 'transit', 'bus', 'arret', 'arrets', 'station', 'stations', 'metro', 'tram', 'train'] },
  { intent: 'accessibility', ids: ['walkroutes', 'access', 'pedestrian'], terms: ['accessibilite', 'accessibility', 'isochrone', 'isochrones', 'marche', 'a pied', 'walking', '15 min', '15 minutes', 'temps de trajet', 'travel time', 'catchment', 'rayon de marche'] },
  { intent: 'solar', ids: ['sun', 'climsolar'], terms: ['soleil', 'solaire', 'ensoleillement', 'ombre', 'ombres', 'shadow', 'shadows', 'sunlight', 'solar'] },
  { intent: 'wind', ids: ['wind'], terms: ['vent', 'vents', 'wind', 'wind rose', 'rose des vents'] },
  { intent: 'climate', ids: ['climover', 'climtemp', 'climprecip'], terms: ['climat', 'climate', 'temperature', 'temperatures', 'pluie', 'pluie', 'precipitation', 'precipitations', 'rain', 'weather'] },
  { intent: 'terrain', ids: ['contour', 'aspect', 'wireframe'], terms: ['topographie', 'topography', 'relief', 'terrain', 'pente', 'slope', 'altitude', 'elevation'] },
  { intent: 'context', ids: ['context', 'location', 'mappingboard'], terms: ['contexte', 'context', 'situation', 'localisation', 'location', 'site context'] }
];

const REPORT_TERMS = ['faisabilite', 'feasibility', 'capacite', 'capacity', 'far', 'cos', 'cout de construction', 'construction cost', 'emprise maximale', 'floor area'];
const LEGAL_TERMS = ['zonage', 'zoning', 'reglement', 'regulatory', 'cadastre', 'cadastral', 'parcelle', 'parcelles', 'parcel', 'property boundary', 'droit a construire', 'development rights'];
const ACCESS_TERMS = ['isochrone', 'isochrones', 'marche', 'a pied', 'walking', '15 min', '15 minutes', 'temps de trajet', 'travel time', 'catchment', 'rayon de marche'];
const MARKET_TERMS = ['demographie', 'demographic', 'demographics', 'population', 'loyer', 'loyers', 'rent', 'rents', 'prix immobilier', 'property prices', 'footfall', 'frequentation'];
const COST_TERMS = ['cout de construction', 'construction cost', 'cout au m2', 'cost per m2'];

const matches = (text, terms) => terms.some(term => hasPhrase(text, term));

/** Retourne des identifiants d'analyses existants et des limites explicites. */
export function analyzeSpatialQuestion(question) {
  const text = normalize(question);
  if (!text) return { analysisIds: [], intents: [], warnings: ['empty'], openReport: false };
  const intents = RULES.filter(rule => matches(text, rule.terms));
  const analysisIds = [...new Set(intents.flatMap(rule => rule.ids))];
  const warnings = [];
  const legal = matches(text, LEGAL_TERMS);
  const access = matches(text, ACCESS_TERMS);
  const market = matches(text, MARKET_TERMS);
  const cost = matches(text, COST_TERMS);
  if (legal) warnings.push('legal-data');
  if (access) warnings.push('indicative-walking-speed');
  if (market) warnings.push('market-data-unavailable');
  if (cost) warnings.push('user-cost-only');
  return {
    analysisIds,
    intents: intents.map(rule => rule.intent),
    warnings,
    openReport: matches(text, REPORT_TERMS),
    noMatch: !analysisIds.length && !matches(text, REPORT_TERMS)
  };
}
