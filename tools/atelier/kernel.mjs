/* Le même noyau sans navigateur : utilisé par la CLI et les tests. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normaliser, arbresDepuisRangées } from '../../public/js/atelier/osm-data.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const sample = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/atelier-elkhroub.json'), 'utf8'));
let loaded = false;
export function loadKernel() {
  if (!loaded) {
    for (const f of ['engine.js', 'vue3d.js']) {
      const src = fs.readFileSync(path.join(ROOT, 'public/js/atelier', f), 'utf8');
      (0, eval)(src);
    }
    loaded = true;
  }
  return { engine: globalThis.FMEngine, vue3d: globalThis.FMVue3D };
}
export function makeCtx(over = {}) {
  return {
    sLat: sample.site.lat, sLng: sample.site.lon, curR: sample.site.R,
    siteName: sample.site.name || 'El Khroub', shape: 'circle', lang: 'fr',
    D: normaliser(sample.elements), terrain: sample.terrain,
    ...over
  };
}
export function sceneFor(ctx, { hour = 15, date = new Date().toISOString().slice(0, 10), cap = 35, inclinaison = 42, width = 1200, height = 900, trees = true, buildings = true, terrain = true } = {}) {
  loadKernel();
  const V = globalThis.FMVue3D;
  const cam = V.camera({ lat: ctx.sLat, lon: ctx.sLng, rayon: ctx.curR, cap, inclinaison, largeur: width, hauteur: height });
  const sun = V.soleil(V.instantLocal(hour, ctx.sLat, ctx.sLng, date), ctx.sLat, ctx.sLng);
  const sc = V.scene(buildings ? ctx.D.build || [] : [], cam, { terrain: terrain ? ctx.terrain : null, palette: 0, soleil: sun, echelleH: 1 });
  if (trees) sc.arbres = [...(ctx.D.trees || []), ...arbresDepuisRangées(ctx.D.treeRows || [])].map(t => {
    const [x, y] = cam.toLocal(t.lat, t.lon);
    return { x, y, z: sc.terrain?.z(t.lat, t.lon) || 0, h: Number(t.h) || 6, r: Math.max(1, (Number(t.h) || 6) * .22) };
  }).filter(t => Math.hypot(t.x, t.y) <= cam.rayon + 1e-6);
  return sc;
}
