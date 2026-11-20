import { summarizeFeatures } from './local-analysis.mjs';

const MAX_DASHBOARD_CATEGORIES = 8;

function valueLabel(value) {
  if (value === null || value === undefined || String(value).trim() === '') return '(vide)';
  if (typeof value === 'object') {
    try { return JSON.stringify(value).slice(0, 120) || '(vide)'; }
    catch { return '[valeur]'; }
  }
  return String(value).trim().slice(0, 120) || '(vide)';
}

/** Tableau de bord descriptif local; il ne déduit pas de normes d'accessibilité ou de zonage. */
export function buildDashboardSummary(features = [], categoryField = '', maxCategories = MAX_DASHBOARD_CATEGORIES) {
  const rows = Array.isArray(features) ? features : [];
  const metrics = summarizeFeatures(rows);
  const types = metrics.types || {};
  const pointCount = (types.Point || 0) + (types.MultiPoint || 0);
  const lineCount = (types.LineString || 0) + (types.MultiLineString || 0);
  const polygonCount = (types.Polygon || 0) + (types.MultiPolygon || 0);
  const counts = new Map();
  if (categoryField) {
    for (const feature of rows) {
      const label = valueLabel(feature?.properties?.[categoryField]);
      counts.set(label, (counts.get(label) || 0) + 1);
    }
  }
  const ordered = [...counts].map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'fr-FR'));
  const limit = Number.isInteger(maxCategories) ? Math.max(1, Math.min(20, maxCategories)) : MAX_DASHBOARD_CATEGORIES;
  const categories = ordered.slice(0, limit);
  const otherCount = ordered.slice(limit).reduce((sum, item) => sum + item.count, 0);
  if (otherCount) categories.push({ label: 'Autres catégories', count: otherCount });
  return {
    featureCount: rows.length,
    pointCount, lineCount, polygonCount,
    coordinateCount: metrics.coordinateCount,
    lengthMeters: metrics.lengthMeters,
    areaSqMeters: metrics.areaSqMeters,
    extent: metrics.extent,
    categories,
    categoryField: String(categoryField || ''),
    categoryTotal: ordered.reduce((sum, item) => sum + item.count, 0),
    categoryCount: ordered.length
  };
}

/* Valeurs typées : la chaîne "1" et le nombre 1 ne sont jamais confondus.
   Les objets sont comptés mais ne peuvent pas servir de filtre exact. */
export function dashboardCategory(value) {
  if (value == null) return { key: 'null', label: '(absent ou nul)', selectable: true };
  if (typeof value === 'string') return { key: JSON.stringify(['string', value]), label: value === '' ? '(texte vide)' : `« ${value} »`, selectable: true };
  if (typeof value === 'number' && Number.isFinite(value)) return { key: JSON.stringify(['number', value]), label: `${value} (nombre)`, selectable: true };
  if (typeof value === 'boolean') return { key: JSON.stringify(['boolean', value]), label: `${value} (booléen)`, selectable: true };
  return { key: 'complex', label: '(valeurs complexes)', selectable: false };
}
export function dashboardCategoryCounts(features, field, maxCategories = 8) {
  const counts = new Map();
  for (const feature of features || []) {
    const value = feature?.properties && Object.hasOwn(feature.properties, field) ? feature.properties[field] : null;
    const item = dashboardCategory(value);
    if (!counts.has(item.key)) counts.set(item.key, { ...item, count: 0 });
    counts.get(item.key).count++;
  }
  const ordered = [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'fr-FR'));
  const limit = Number.isInteger(maxCategories) ? Math.max(1, Math.min(20, maxCategories)) : 8;
  const result = ordered.slice(0, limit), remaining = ordered.slice(limit);
  if (remaining.length) result.push({ key: null, label: 'Autres catégories', selectable: false, count: remaining.reduce((n, x) => n + x.count, 0) });
  return result;
}
export function matchesDashboardCategory(feature, selection) {
  if (!selection || !selection.field || !selection.key) return true;
  const value = feature?.properties && Object.hasOwn(feature.properties, selection.field) ? feature.properties[selection.field] : null;
  return dashboardCategory(value).key === selection.key;
}
