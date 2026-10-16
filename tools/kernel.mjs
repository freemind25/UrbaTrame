/* Chargement du noyau de rendu dans Node, exactement comme le navigateur :
   les scripts classiques du catalogue, moteur et renderers sont évalués tels quels
   et s'installent sur globalThis. Aucune transformation,
   aucune étape de build — ce que le banc d'essai exécute est ce qui est servi. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeElements, dedupe } from '../public/js/osm.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const KERNEL_FILES = ['catalog.js', 'engine.js', 'vue3d.js', 'renderers-core.js', 'renderers-pro.js', 'renderers-obm.js', 'renderers-boards.js'];
let loaded = false;

export function loadKernel() {
  if (!loaded) {
    for (const f of KERNEL_FILES) {
      const src = fs.readFileSync(path.join(ROOT, 'public/js', f), 'utf8');
      (0, eval)(src);                // évaluation indirecte → portée globale
    }
    loaded = true;
  }
  return {
    catalog: globalThis.FMCatalog,
    groups: globalThis.FM_GROUPS,
    renderers: globalThis.FMRender
  };
}

export const SAMPLE_PATH = path.join(ROOT, 'public/data/sample-elkhroub.json');
export const sample = JSON.parse(fs.readFileSync(SAMPLE_PATH, 'utf8'));
export const sampleWindrose = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/windrose-elkhroub.json'), 'utf8'));

/* Jeu de données normalisé, prêt pour les renderers. */
export function sampleBuckets() {
  return normalizeElements(null, dedupe(sample.elements));
}

export function makeCtx(over = {}) {
  return {
    sLat: sample.site.lat,
    sLng: sample.site.lon,
    curR: sample.site.R,
    shape: 'circle',
    sitePolygon: null,
    isPro: false,
    lang: 'fr',
    watermark: true,
    time: 12,
    siteName: sample.site.name,
    D: sampleBuckets(),
    terrain: sample.terrain,
    climate: sample.climate,
    windrose: sampleWindrose,
    noSiteMark: false,
    ...over
  };
}

/* Rejoue une analyse et renvoie son SVG. */
export function render(id, over = {}, scenery = 0) {
  const { renderers } = loadKernel();
  const fn = renderers[id];
  if (typeof fn !== 'function') throw new Error('renderer absent : ' + id);
  return fn(makeCtx(over), scenery);
}
