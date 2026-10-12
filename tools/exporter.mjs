#!/usr/bin/env node
/* Écrit les fichiers d'export hors navigateur, à partir de l'exemple embarqué.
   Sert à produire les exemples de la documentation et à relire un fichier sans
   passer par l'interface (la même chose est proposée par le panneau « Exports
   CAO » de l'application).

     node tools/exporter.mjs                          # tout, dans test/out/
     node tools/exporter.mjs --out /tmp/freemap
     node tools/exporter.mjs --quoi plan --geolocate --equi 5 --avec COURBES,BATI
     node tools/exporter.mjs --coupe 0,-400,0,400 --hauteur 9
     node tools/exporter.mjs --quoi modele --sans-sol

   Options
     --out DIR      dossier de sortie (défaut : test/out)
     --quoi LISTE   plan, coupe, modele, apercus (défaut : tout)
     --avec LISTE   calques du plan (défaut : tous)
     --equi N       équidistance des courbes, en mètres (défaut : automatique)
     --hauteur N    hauteur du bâti sans donnée, en mètres (défaut : 9)
     --geolocate    écrire en UTM (WGS 84) plutôt qu'en repère local
     --coupe A      axe de la coupe « nord,est,nord,est » en mètres depuis le
                    centre du site (défaut : -500,0,500,0 — ouest → est)
     --sans-sol     modèle 3D sans le maillage du terrain
     --inclinaison  inclinaison de la scène 3D, en degrés (défaut : 42)
     --cap          rotation de la scène 3D, en degrés (défaut : 35) */
import fs from 'node:fs';
import path from 'node:path';
import { loadKernel, makeCtx, render, sample, ROOT } from './kernel.mjs';
import * as X from '../public/js/exports.mjs';

const args = process.argv.slice(2);
const opt = (nom, def) => {
  const i = args.indexOf('--' + nom);
  if (i < 0) return def;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : true;
};
const outDir = path.resolve(String(opt('out', path.join(ROOT, 'test/out'))));
const quoi = String(opt('quoi', 'plan,coupe,modele,apercus')).split(',').map(s => s.trim());
const avec = opt('avec', null) ? String(opt('avec')).split(',').map(s => s.trim().toUpperCase()) : null;
const equi = Number(opt('equi', 0)) || 0;
const hauteur = Number(opt('hauteur', 9)) || 9;
const geolocate = !!opt('geolocate', false);
const sansSol = !!opt('sans-sol', false);
const inclinaison = Number(opt('inclinaison', 42));
const cap = Number(opt('cap', 35));
const axe = String(opt('coupe', '-500,0,500,0')).split(',').map(Number);
if (axe.length !== 4 || axe.some(v => !Number.isFinite(v))) {
  console.error('--coupe attend quatre nombres : nord,est,nord,est (mètres depuis le centre)');
  process.exit(2);
}

loadKernel();                       // charge le noyau (moteur, renderers, moteur 3D) dans globalThis
const ctx = makeCtx();
const V = globalThis.FMVue3D;
const nom = (sample.site.name || 'freemap').split(',')[0].trim().toLowerCase().replace(/[^\w]+/g, '-');
const mLat = 1 / 111320, mLon = 1 / (111320 * Math.cos(ctx.sLat * Math.PI / 180));
const point = (dn, de) => [ctx.sLat + dn * mLat, ctx.sLng + de * mLon];

fs.mkdirSync(outDir, { recursive: true });
const ecrit = (fichier, texte) => {
  const f = path.join(outDir, fichier);
  fs.writeFileSync(f, texte);
  const ko = (Buffer.byteLength(texte) / 1024).toFixed(1);
  console.log('  ' + fichier.padEnd(26) + ko.padStart(8) + ' Ko');
  return f;
};

const want = q => quoi.includes(q) || quoi.includes('tout');
const options = { geolocate, equidistance: equi, hauteurBati: hauteur, avec, titre: sample.site.name };
console.log('Freemap · exports — ' + sample.site.name + ' (R = ' + sample.site.R + ' m) → ' + outDir);

let plan = null;
if (want('plan') || want('apercus')) {
  plan = X.dxfTopo(ctx, options);
  const t = X.grilleTerrain(ctx);
  console.log('plan : ' + plan.courbes + ' courbes (équidistance ' + plan.equidistance + ' m), ' +
    plan.nbEntites + ' entités, altitudes ' + (t ? t.min.toFixed(1) + '–' + t.max.toFixed(1) + ' m' : 'absentes') +
    ', repère ' + plan.repere.note);
  if (want('plan')) ecrit('freemap-' + nom + '-plan.dxf', plan.dxf);
  if (want('apercus')) ecrit('freemap-' + nom + '-plan.svg', X.apercuSVG(plan.entites, { largeur: 1200, hauteur: 900 }).svg);
}

let C = null;
if (want('coupe') || want('apercus')) {
  const A = point(axe[0], axe[1]), B = point(axe[2], axe[3]);
  C = X.coupe(ctx, A, B, { hauteurBati: hauteur });
  console.log('coupe : ' + Math.round(C.longueur) + ' m, sol ' + C.zMin.toFixed(1) + '–' + C.zMax.toFixed(1) +
    ' m (dénivelé ' + (C.zMax - C.zMin).toFixed(1) + ' m), ' + C.bati.length + ' bâtiments traversés');
  if (want('coupe')) ecrit('freemap-' + nom + '-coupe.dxf', X.dxfCoupe(C, { titre: sample.site.name }));
  if (want('apercus')) ecrit('freemap-' + nom + '-coupe.svg', X.coupeSVG(C, { titre: sample.site.name, largeur: 1200, hauteur: 480 }).svg);
}

if (want('modele')) {
  const cam = V.camera({ lat: ctx.sLat, lon: ctx.sLng, rayon: ctx.curR, cap, inclinaison, largeur: 640, hauteur: 480 });
  const sc = V.scene(ctx.D.build, cam, { terrain: sansSol ? null : ctx.terrain, palette: 0 });
  const M = X.maillageDeScene(sc, { sol: !sansSol });
  const triangles = M.faces.reduce((s, f) => s + Math.max(0, f.pts.length - 2), 0);
  console.log('modèle : ' + M.sommets.length.toLocaleString('fr-FR') + ' sommets, ' +
    M.faces.length.toLocaleString('fr-FR') + ' faces, ' + triangles.toLocaleString('fr-FR') +
    ' triangles, altitude de référence ' + M.base.toFixed(1) + ' m');
  ecrit('freemap-' + nom + '-modele.obj', X.objDeScene(sc, {}));
  ecrit('freemap-' + nom + '-modele.stl', X.stlDeScene(sc, {}));
  /* la vue de contrôle : le même rendu que la planche « volumes » */
  if (want('apercus')) ecrit('freemap-' + nom + '-vue.svg', render('volumes', {}, 0));
}
console.log('terminé.');
