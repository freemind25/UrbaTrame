/* Repères personnels sur la carte Altiplan.
   Données utilisateur conservées dans le navigateur et exportables en GeoJSON;
   elles restent distinctes des couches OSM et des limites de projet. */
import { insideShape, toLocal } from './geometry.mjs';

export const FIELD_NOTE_CATEGORIES = Object.freeze([
  { id: 'observation', label: 'Observation', color: '#286b91' },
  { id: 'access', label: 'Accès', color: '#438455' },
  { id: 'issue', label: 'Point à traiter', color: '#b94e3f' },
  { id: 'vegetation', label: 'Végétation', color: '#688c49' },
  { id: 'verify', label: 'À vérifier', color: '#b77b2e' }
]);

export const MAX_FIELD_NOTES = 500;
const CATEGORY_IDS = new Set(FIELD_NOTE_CATEGORIES.map(category => category.id));
const NOTE_ID = /^[\w-]{1,80}$/;

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
function cleanLine(value, max) {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
    : '';
}
function cleanText(value, max) {
  return typeof value === 'string'
    ? value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max)
    : '';
}

export function normalizeFieldNote(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const lat = Number(raw.lat), lon = Number(raw.lon);
  const title = cleanLine(raw.title, 80);
  const category = String(raw.category || '');
  if (!Number.isFinite(lat) || Math.abs(lat) > 85 || !Number.isFinite(lon) || Math.abs(lon) > 180 ||
      !title || !CATEGORY_IDS.has(category)) return null;
  const createdAt = Number(raw.createdAt);
  const validTime = Number.isFinite(createdAt) && createdAt > 0 && Number.isFinite(new Date(createdAt).getTime());
  return {
    id: typeof raw.id === 'string' && NOTE_ID.test(raw.id) ? raw.id : makeId(),
    lat,
    lon,
    category,
    title,
    text: cleanText(raw.text, 1000),
    siteName: cleanLine(raw.siteName, 120),
    createdAt: validTime ? createdAt : Date.now()
  };
}

export function normalizeFieldNotes(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set(), out = [];
  for (const item of value) {
    const note = normalizeFieldNote(item);
    if (!note || seen.has(note.id)) continue;
    seen.add(note.id);
    out.push(note);
    if (out.length >= MAX_FIELD_NOTES) break;
  }
  return out;
}

export function createFieldNote(input, { now = Date.now(), id = makeId() } = {}) {
  return normalizeFieldNote({ ...input, id, createdAt: now });
}

export function fieldNotesInExtent(notes, site) {
  const lat = Number(site?.lat), lon = Number(site?.lon), radius = Number(site?.radius);
  if (!Number.isFinite(lat) || Math.abs(lat) > 85 || !Number.isFinite(lon) || Math.abs(lon) > 180 ||
      !Number.isFinite(radius) || radius <= 0) return [];
  const shape = site?.shape === 'square' ? 'square' : 'circle';
  const origin = { lat, lon };
  return normalizeFieldNotes(notes).filter(note => {
    const [x, y] = toLocal([note.lat, note.lon], origin);
    return insideShape(x, y, radius, shape);
  }).sort((a, b) => b.createdAt - a.createdAt);
}

export function fieldNotesGeoJSON(notes) {
  const clean = normalizeFieldNotes(notes);
  return {
    type: 'FeatureCollection',
    features: clean.map(note => ({
      type: 'Feature',
      id: note.id,
      geometry: { type: 'Point', coordinates: [note.lon, note.lat] },
      properties: {
        id: note.id,
        category: note.category,
        title: note.title,
        note: note.text,
        site: note.siteName,
        created_at: new Date(note.createdAt).toISOString()
      }
    }))
  };
}
