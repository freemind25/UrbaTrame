/* Persistance locale de projets et modèles de travail UrbaTrame.
   Le fichier décrit la configuration (site, analyses, hypothèses), pas les
   données OSM ni les résultats rendus. Aucun compte ou synchronisation serveur. */
import { DEPS } from './plan-2d.mjs';

const VALID_IDS = new Set(Object.keys(DEPS));
const SHAPES = new Set(['circle', 'rect', 'square']);
const SCENARIO_KEYS = ['area', 'far', 'coverage', 'floors', 'cost', 'currency', 'volumeCount', 'floorHeight', 'aspect', 'gap'];
const MAX_FILE_CHARS = 200_000;

function cleanName(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 80) : '';
}
function cleanIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(id => typeof id === 'string' && VALID_IDS.has(id)))].slice(0, 50);
}
function cleanScenario(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const key of SCENARIO_KEYS) {
    const item = value[key];
    if (item == null) continue;
    if (typeof item !== 'string' && typeof item !== 'number') continue;
    const text = String(item).trim().slice(0, key === 'currency' ? 8 : 32);
    if (text) out[key] = text;
  }
  return out;
}
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function validCommon(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.version !== 1) return null;
  const name = cleanName(raw.name);
  if (!name || !SHAPES.has(raw.shape)) return null;
  const radius = Number(raw.radius);
  const time = Number(raw.time);
  const sunDate = raw.sunDate;
  if (!Number.isFinite(radius) || radius < 200 || radius > 3000 || radius % 50 !== 0) return null;
  if (!Number.isFinite(time) || time < 4 || time > 21 || Math.abs(time * 4 - Math.round(time * 4)) > 1e-6) return null;
  if (!validDate(sunDate)) return null;
  return {
    id: typeof raw.id === 'string' && /^[\w-]{1,80}$/.test(raw.id) ? raw.id : makeWorkspaceId(),
    name,
    createdAt: Number.isFinite(Number(raw.createdAt)) ? Number(raw.createdAt) : Date.now(),
    updatedAt: Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : Date.now(),
    shape: raw.shape,
    radius,
    time,
    sunDate,
    selectedIds: cleanIds(raw.selectedIds),
    scenario: cleanScenario(raw.scenario)
  };
}

export function makeWorkspaceId() {
  return globalThis.crypto?.randomUUID?.() || `ut-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createWorkspaceProject({ name, site, selectedIds, shape = 'circle', radius = 600, time = 12, sunDate, scenario = {}, id, createdAt, updatedAt } = {}) {
  const lat = Number(site?.lat), lon = Number(site?.lon);
  if (!Number.isFinite(lat) || Math.abs(lat) > 85 || !Number.isFinite(lon) || Math.abs(lon) > 180) return null;
  const common = validCommon({
    version: 1, id: id || makeWorkspaceId(), name, createdAt: createdAt ?? Date.now(),
    updatedAt: updatedAt ?? Date.now(), shape, radius, time, sunDate,
    selectedIds, scenario
  });
  if (!common) return null;
  return {
    type: 'urbatrame-project', version: 1, ...common,
    site: {
      lat, lon,
      name: typeof site?.name === 'string' ? site.name.trim().slice(0, 120) : ''
    }
  };
}

export function createWorkspaceTemplate({ name, selectedIds, shape = 'circle', radius = 600, time = 12, sunDate, scenario = {}, id, createdAt, updatedAt } = {}) {
  const common = validCommon({
    version: 1, id: id || makeWorkspaceId(), name, createdAt: createdAt ?? Date.now(),
    updatedAt: updatedAt ?? Date.now(), shape, radius, time, sunDate,
    selectedIds, scenario
  });
  return common ? { type: 'urbatrame-template', version: 1, ...common } : null;
}

export function validateWorkspaceRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.type === 'urbatrame-project')
    return createWorkspaceProject({ ...raw, site: raw.site });
  if (raw.type === 'urbatrame-template')
    return createWorkspaceTemplate(raw);
  return null;
}

export function parseWorkspaceFile(text) {
  if (typeof text !== 'string' || text.length > MAX_FILE_CHARS) return null;
  try { return validateWorkspaceRecord(JSON.parse(text)); }
  catch { return null; }
}

export function upsertWorkspaceRecord(records, record, limit = 40) {
  const valid = validateWorkspaceRecord(record);
  if (!valid) return Array.isArray(records) ? records.slice(0, limit) : [];
  const current = Array.isArray(records) ? records.map(validateWorkspaceRecord).filter(Boolean) : [];
  return [valid, ...current.filter(item => item.id !== valid.id)].slice(0, limit);
}

export function removeWorkspaceRecord(records, id) {
  return (Array.isArray(records) ? records : [])
    .map(validateWorkspaceRecord).filter(item => item && item.id !== id);
}

export function serializeWorkspaceRecord(record) {
  const valid = validateWorkspaceRecord(record);
  return valid ? JSON.stringify(valid, null, 2) : '';
}
