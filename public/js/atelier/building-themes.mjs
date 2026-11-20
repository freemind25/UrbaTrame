/* Cartes thématiques de bâtiments : attributs OSM stricts et surfaces indicatives. */
import { enLocal } from './exports.mjs';

const positiveNumber = (value, suffix = '') => {
  const str = String(value ?? '').trim();
  const pattern = suffix ? /^\d+(?:\.\d+)?\s*(?:m)?$/i : /^\d+(?:\.\d+)?$/;
  if (!pattern.test(str)) return null;
  const n = Number.parseFloat(str);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function buildingThemeAttributes(tags = {}) {
  const height = positiveNumber(tags.height, 'm');
  const levels = positiveNumber(tags['building:levels']);
  const floors = Number.isInteger(levels) ? levels : null;
  return {
    themeLevels: floors,
    themeHeightM: height ?? (floors !== null ? floors * 3.1 : null),
    themeHeightSource: height !== null ? 'osm-height' : floors !== null ? 'levels-estimate' : 'unknown'
  };
}

function ringArea(ring, lat, lon) {
  if (!Array.isArray(ring) || ring.length < 3 || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (!ring.every(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0] - lat) < 1 && Math.abs(p[1] - lon) < 1)) return null;
  const pts = ring.map(([la, lo]) => enLocal(la, lo, lat, lon));
  let twice = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    twice += a[0] * b[1] - b[0] * a[1];
  }
  const a = Math.abs(twice) / 2;
  return a > 0 && Number.isFinite(a) ? a : null;
}

export function buildingFootprintArea(building, lat, lon) {
  const outer = ringArea(building?.g, lat, lon);
  if (outer === null) return null;
  let holes = 0;
  for (const ring of building.trous || []) {
    const area = ringArea(ring, lat, lon);
    if (area === null) return null;
    holes += area;
  }
  return outer > holes ? outer - holes : null;
}

export const THEMES = Object.freeze({
  height: { fr: 'Hauteur du bâti', en: 'Building height', ranges: [6, 12, 24, 45], labels: ['< 6 m', '6–12 m', '12–24 m', '24–45 m', '≥ 45 m'] },
  floors: { fr: 'Nombre de niveaux', en: 'Number of floors', ranges: [2, 4, 7, 11], labels: ['1', '2–3', '4–6', '7–10', '≥ 11'] },
  area: { fr: 'Surface d’emprise', en: 'Footprint area', ranges: [100, 300, 1000, 3000], labels: ['< 100 m²', '100–300 m²', '300–1 000 m²', '1 000–3 000 m²', '≥ 3 000 m²'] }
});
export const THEME_COLORS = Object.freeze(['#EAF3EE', '#B5DDCF', '#76BDAF', '#398D88', '#17545A']);
export const UNKNOWN_COLOR = '#C7C9C8';

export function buildingThemeClass(building, theme, lat, lon) {
  if (!THEMES[theme]) return { index: -1, value: null, color: UNKNOWN_COLOR };
  const value = theme === 'height' ? building?.themeHeightM : theme === 'floors' ? building?.themeLevels : buildingFootprintArea(building, lat, lon);
  if (!Number.isFinite(value) || value <= 0) return { index: -1, value: null, color: UNKNOWN_COLOR };
  const idx = THEMES[theme].ranges.findIndex(v => value < v);
  const index = idx < 0 ? 4 : idx;
  return { index, value, color: THEME_COLORS[index] };
}
