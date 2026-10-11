#!/usr/bin/env node
/* Capture un extrait réel et l'écrit au format de l'exemple embarqué
   (public/data/sample-elkhroub.json), en passant directement par les mêmes
   sources et le même planificateur que l'application.

   L'exemple embarqué permet d'utiliser l'application sans réseau — c'est
   aussi lui qui alimente les bancs d'essai.

     node tools/capture-sample.mjs                     # El Khroub, 600 m
     node tools/capture-sample.mjs --lat 48.85 --lon 2.35 --radius 1200 \
          --name "Paris" --out public/data/sample-paris.json
*/
import fs from 'node:fs';
import path from 'node:path';
import { plan, DEPS, LIMITS } from '../public/js/mtn-2d-plan.mjs';
import { overpass } from '../server/sources/overpass.mjs';
import { terrain } from '../server/sources/terrain.mjs';
import { climate } from '../server/sources/climate.mjs';
import { log } from '../server/http.mjs';
import { ROOT } from './kernel.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  return i > -1 ? args[i + 1] : def;
};

const lat = Number(opt('lat', 36.2642));
const lon = Number(opt('lon', 6.6969));
const radius = Number(opt('radius', 600));
const name = String(opt('name', 'El Khroub, Constantine (Algérie)'));
const out = path.resolve(String(opt('out', path.join(ROOT, 'public/data/sample-elkhroub.json'))));
const n = Number(opt('grid', 16));

/* La couche `poi` est demandée avec les sélecteurs larges (`poiheat`) pour que
   l'extrait contienne aussi les POI ; le climat et le relief le sont d'office. */
const ids = ['roads', 'landuse', 'gw', 'fabric', 'density', 'massing', 'typology',
  'poiheat', 'poitype', 'vitality', 'combined', 'transit', 'voronoi', 'sitemap',
  'noise', 'sun', 'contour', 'aspect', 'wireframe', 'climtemp']
  .filter(id => DEPS[id] && radius <= LIMITS[id]);

log(`capture : ${name} · ${radius} m · ${ids.length} analyses`);
const p = plan(ids, radius, lat, lon);
log(`plan : ${p.groups.length} requête(s) — ${p.groups.map(g => g.id).join(', ')}`);

const elements = new Map();      // déduplication par type:id, comme le client
for (const g of p.groups) {
  const d = await overpass(g.query);
  for (const e of d.elements) elements.set(e.type + ':' + e.id, e);
  log(`  lot ${g.id.padEnd(7)} ${String(d.elements.length).padStart(6)} éléments`);
}

const site = { name, lat, lon, R: radius };
const payload = {
  site,
  elements: [...elements.values()],
  terrain: await terrain(lat, lon, radius, n),
  climate: await climate(lat, lon),
  note: `Extrait réel OpenStreetMap + NASA POWER + Terrarium, capturé le ` +
    new Date().toISOString().slice(0, 10) + '.'
};

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(payload));
log(`${elements.size} éléments · ${(fs.statSync(out).size / 1024).toFixed(0)} Ko → ${path.relative(ROOT, out)}`);
log(`pensez à mettre à jour le nom et le rayon du bouton « Exemple » dans public/js/app.js`);
