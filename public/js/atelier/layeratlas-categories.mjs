/* Layer Atlas (layeratlas.com) — catégories du catalogue communautaire.
   Source : constantes extraites du bundle public de layeratlas.com le
   2026-11-15 (liste ht=[{label:"Basemap",value:"cat1"}, …]).
   Ce fichier est la source unique : importé par le serveur (server/layeratlas.mjs)
   et par le client (public/js/atelier/layeratlas.mjs). Le test
   test/layeratlas.test.mjs épingle la table complète pour garder les deux
   côtés synchronisés. */

export const LAYERATLAS_CATEGORIES = [
  { id: 'cat1', label: 'Basemap', theme: 'Fonds de carte' },
  { id: 'cat2', label: 'Imagery', theme: 'Imagerie satellite/aérienne' },
  { id: 'cat3', label: 'Agriculture', theme: 'Agriculture' },
  { id: 'cat4', label: 'Culture', theme: 'Culture et patrimoine' },
  { id: 'cat5', label: 'Demography', theme: 'Démographie et population' },
  { id: 'cat6', label: 'Economy', theme: 'Économie' },
  { id: 'cat7', label: 'Education', theme: 'Éducation' },
  { id: 'cat8', label: 'Energy', theme: 'Énergie' },
  { id: 'cat9', label: 'Environnement', theme: 'Environnement' },
  { id: 'cat10', label: 'Geology', theme: 'Géologie et sol' },
  { id: 'cat11', label: 'Health', theme: 'Santé' },
  { id: 'cat12', label: 'Historical', theme: 'Cartes historiques' },
  { id: 'cat13', label: 'Infrastructure', theme: 'Infrastructure et réseaux' },
  { id: 'cat14', label: 'Marine', theme: 'Mer et littoral' },
  { id: 'cat15', label: 'Political', theme: 'Limites administratives et politiques' },
  { id: 'cat16', label: 'Tourism', theme: 'Tourisme' },
  { id: 'cat17', label: 'Transport', theme: 'Transport et mobilité' }
];

export const LAYERATLAS_CATEGORY_BY_ID = new Map(LAYERATLAS_CATEGORIES.map(c => [c.id, c]));

export function isLayerAtlasCategory(value) {
  return typeof value === 'string' && LAYERATLAS_CATEGORY_BY_ID.has(value);
}

export function layerAtlasCategoryLabel(id) {
  return LAYERATLAS_CATEGORY_BY_ID.get(id)?.label || id || '';
}

/* assetType vu dans le catalogue : "QgsLayerDefinition" (.qlr QGIS) ou "Dataset". */
export const LAYERATLAS_ASSET_TYPE_LABELS = {
  QgsLayerDefinition: 'Définition de couche QGIS (.qlr)',
  Dataset: 'Jeu de données téléchargeable'
};

export function layerAtlasAssetTypeLabel(assetType) {
  return LAYERATLAS_ASSET_TYPE_LABELS[assetType] || String(assetType || 'Autre');
}
