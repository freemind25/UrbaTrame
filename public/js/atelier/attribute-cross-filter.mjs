/* Jointure attributaire stricte et directionnelle ; pas de cascade entre règles. */
export function crossKey(value) {
  if (typeof value === 'string') return value.trim() ? JSON.stringify(['string',value]) : null;
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(['number',value]);
  if (typeof value === 'boolean') return JSON.stringify(['boolean',value]);
  return null;
}
export function crossKeySet(features, field) {
  const keys=new Set();
  for (const feature of features || []) { const key=crossKey(feature?.properties?.[field]); if (key !== null) keys.add(key); }
  return keys;
}
export function crossMatches(feature, field, keys) {
  const key=crossKey(feature?.properties?.[field]); return key !== null && keys.has(key);
}
