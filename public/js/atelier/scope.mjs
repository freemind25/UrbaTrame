/* Prépare des vues non mutantes d'une couche et de ses indices d'origine.
   Une sélection signifie « passe les filtres attributaires », pas « dans l'écran ». */
export function scopedLayer(layer, scope, items) {
  if (!layer || layer.kind === 'raster') return layer;
  if (!['all', 'filtered'].includes(scope)) throw new Error('INVALID_SCOPE');
  const original = layer.geojson.features;
  const selected = scope === 'filtered' ? items : original.map((feature, index) => ({ feature, index }));
  if (!Array.isArray(selected) || selected.some(x => !Number.isInteger(x.index) || x.index < 0 || x.index >= original.length || x.feature !== original[x.index])) throw new Error('INVALID_SCOPE_ITEMS');
  return { ...layer, geojson: { ...layer.geojson, features: selected.map(x => x.feature) },
    scopeInfo: { scope, originalCount: original.length, usedCount: selected.length, originalIndices: selected.map(x => x.index) } };
}
export function scopedIndex(layer, originalIndex) {
  return layer?.scopeInfo?.originalIndices?.indexOf(originalIndex) ?? -1;
}
export function publicScopeInfo(layer, textFilter = null, category = null) {
  const info = layer.scopeInfo;
  return { layer: layer.name, scope: info.scope, originalCount: info.originalCount, usedCount: info.usedCount,
    filters: info.scope === 'filtered' ? { text: textFilter || null, category: category ? { field: category.field, key: category.key, label: category.label } : null } : null };
}
