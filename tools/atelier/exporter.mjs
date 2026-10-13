#!/usr/bin/env node
/* Altiplan CLI. Sans options, exporte l'exemple embarqué d'El Khroub.
   Avec --lat et --lon, lit les couches publiques en ligne.

     node tools/exporter.mjs --out ./exports
     node tools/exporter.mjs --lieu "Constantine, Algérie" --rayon 900 --geolocate
     node tools/exporter.mjs --lat 36.2642 --lon 6.6969 --rayon 600 --equi 5
     node tools/exporter.mjs --avec COURBES,BATI,VOIRIE,ARBRES,PARCELLES
*/
import fs from 'node:fs';
import path from 'node:path';
import { loadKernel, makeCtx, sceneFor, ROOT, sample } from './kernel.mjs';
import { normaliser } from '../../public/js/atelier/osm-data.mjs';
import * as X from '../../public/js/atelier/exports.mjs';
import { DATASET_IDS, queryFor } from '../../server/atelier-data.mjs';
import { overpass, geocode } from '../../server/sources/overpass.mjs';
import { terrain } from '../../server/sources/terrain.mjs';
import { planPNG, sectionPNG, scenePNG } from './png.mjs';

const argv = process.argv.slice(2);
const get = (key, fallback = undefined) => {
  const i = argv.indexOf('--' + key);
  if (i < 0) return fallback;
  return argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true;
};
if (get('help') || get('h')) {
  console.log('Freemap · Atelier topographique, exporter sans dépendance\n\n--out DIR  --lieu TEXTE  --lat N --lon E --rayon M\n--equi M  --geolocate  --hauteur M  --avec CALQUES\n--coupe N,E,N,E (mètres locaux)  --heure 0..23  --date YYYY-MM-DD');
  process.exit(0);
}
const outDir = path.resolve(String(get('out', path.join(ROOT, 'exports'))));
const latArg = get('lat'), lonArg = get('lon'), lieu = get('lieu');
const rayon = Number(get('rayon', sample.site.R));
if (!Number.isFinite(rayon) || rayon < 200 || rayon > 3989) {
  console.error('Erreur : --rayon doit être compris entre 200 et 3 989 mètres (emprise circulaire maximale ≈ 50 km²).'); process.exit(2);
}
const equi = Number(get('equi', 0)) || 0;
const hauteur = Number(get('hauteur', 9)) || 9;
const heureBrute = Number(get('heure', 15));
const heure = Number.isFinite(heureBrute) ? Math.max(0, Math.min(23, heureBrute)) : 15;
const date = String(get('date', new Date().toISOString().slice(0, 10)));
const matchDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
const dateCheck = matchDate ? new Date(Date.UTC(Number(matchDate[1]), Number(matchDate[2]) - 1, Number(matchDate[3]))) : null;
if (!dateCheck || dateCheck.getUTCFullYear() !== Number(matchDate[1]) || dateCheck.getUTCMonth() + 1 !== Number(matchDate[2]) || dateCheck.getUTCDate() !== Number(matchDate[3])) {
  console.error('Erreur : --date doit être une date valide au format AAAA-MM-JJ.'); process.exit(2);
}
const geolocate = !!get('geolocate', false);
const avec = get('avec') ? String(get('avec')).split(',').map(x => x.trim().toUpperCase()) : null;
const axis = String(get('coupe', '0,-600,0,600')).split(',').map(Number);
if (axis.length !== 4 || axis.some(n => !Number.isFinite(n))) {
  console.error('Erreur : --coupe attend quatre nombres N,E,N,E en mètres locaux.'); process.exit(2);
}

let site = { ...sample.site }, elements = sample.elements, ground = sample.terrain;
const online = latArg !== undefined || lonArg !== undefined || lieu !== undefined;
if (online) {
  if (lieu) {
    const places = await geocode(String(lieu));
    if (!places.length) throw new Error('Aucun lieu trouvé : ' + lieu);
    site.lat = Number(places[0].lat); site.lon = Number(places[0].lon); site.name = places[0].display_name || lieu;
  } else {
    if (latArg === undefined || lonArg === undefined) throw new Error('Fournir ensemble --lat et --lon.');
    site.lat = Number(latArg); site.lon = Number(lonArg); site.name = 'Site personnalisé';
  }
  site.R = rayon;
  const query = queryFor({ lat: site.lat, lon: site.lon, radius: rayon, include: DATASET_IDS });
  console.log(`Lecture OSM + relief · ${site.lat.toFixed(5)}, ${site.lon.toFixed(5)} · rayon ${rayon} m …`);
  const [osm, dem] = await Promise.all([overpass(query), terrain(site.lat, site.lon, rayon, 24)]);
  elements = osm.elements; ground = dem;
}
site.R = rayon;
const D = normaliser(elements);
const ctx = makeCtx({ sLat: site.lat, sLng: site.lon, curR: rayon, siteName: site.name, D, terrain: ground });
loadKernel();
fs.mkdirSync(outDir, { recursive: true });
const slug = String(site.name || 'site').split(',')[0].normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'site';
const stem = 'freemap-atelier-' + slug;
function write(suffix, data) {
  const file = path.join(outDir, stem + '-' + suffix);
  fs.writeFileSync(file, data);
  const size = fs.statSync(file).size;
  console.log(`  ${path.basename(file).padEnd(35)} ${(size / 1024).toFixed(1).padStart(8)} Ko`);
}

const plan = X.dxfTopo(ctx, { geolocate, equidistance: equi, hauteurBati: hauteur, avec, titre: site.name });
write('plan.dxf', plan.dxf);
write('plan.svg', X.apercuSVG(plan.entites, { largeur: 1600, hauteur: 1200 }).svg);
write('plan.png', planPNG(plan.entites, { width: 1600, height: 1200 }));

const mLat = 1 / 111320, mLon = 1 / (111320 * Math.cos(site.lat * Math.PI / 180));
const point = (north, east) => [site.lat + north * mLat, site.lon + east * mLon];
const A = point(axis[0], axis[1]), B = point(axis[2], axis[3]);
const section = X.coupe(ctx, A, B, { hauteurBati: hauteur });
write('coupe.dxf', X.dxfCoupe(section, { titre: site.name }));
write('coupe.svg', X.coupeSVG(section, { titre: site.name, largeur: 1600, hauteur: 760 }).svg);
write('coupe.png', sectionPNG(section, { width: 1600, height: 760, title: site.name }));

const scene = sceneFor(ctx, { hour: heure, date, width: 1200, height: 900 });
const M = X.maillageDeScene(scene);
write('modele.obj', X.objDeScene(scene, { mention: 'Donnees © OpenStreetMap (ODbL) · elevation Terrarium' }));
write('modele.stl', X.stlDeScene(scene));
write('vue-3d.png', scenePNG(scene, { width: 1200, height: 900, title: site.name, hour: heure }));

const meta = {
  tool: 'Freemap · Atelier (Altiplan)', version: '0.1.0', site: { name: site.name, lat: site.lat, lon: site.lon, radius: rayon },
  layers: Object.fromEntries(Object.entries(D).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length])),
  terrain: ground ? { n: ground.n, min: Math.min(...ground.grid.flat()), max: Math.max(...ground.grid.flat()) } : null,
  plan: { contourLines: plan.courbes, interval: plan.equidistance, entities: plan.nbEntites, coordinateSystem: plan.repere.note },
  section: { length: Math.round(section.longueur), buildingsCrossed: section.bati.length },
  model: { vertices: M.sommets.length, faces: M.faces.length, referenceElevation: M.base },
  sources: { map: 'OpenStreetMap contributors (ODbL 1.0)', elevation: 'Terrarium elevation tiles' },
  exportedAt: new Date().toISOString()
};
write('releve.json', JSON.stringify(meta, null, 2) + '\n');
console.log(`\nTerminé : ${outDir}\n${D.build.length} bâtiments · ${D.trees.length} arbres · ${plan.courbes} courbes · ${section.bati.length} bâtiments traversés · ${M.sommets.length.toLocaleString('fr-FR')} sommets 3D`);
