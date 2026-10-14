#!/usr/bin/env node
/* Rend une ou plusieurs analyses en SVG hors navigateur, à partir de
   l'exemple embarqué. Sert à produire les planches de documentation et à
   inspecter un rendu sans passer par l'interface.

     node tools/render-svg.mjs                      # toutes les analyses dans test/out/
     node tools/render-svg.mjs --ids roads,massing  # une sélection
     node tools/render-svg.mjs --pro --lang en --out /tmp/svg
     node tools/render-svg.mjs --png                # + planches PNG si ImageMagick est là
*/
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadKernel, render, sample, ROOT } from './kernel.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  return i > -1 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : def;
};
const outDir = path.resolve(String(opt('out', path.join(ROOT, 'test/out'))));
const lang = String(opt('lang', 'fr'));
const pro = !!opt('pro', false);
const withPng = args.includes('--png');

const { catalog } = loadKernel();
const ids = opt('ids')
  ? String(opt('ids')).split(',').map(s => s.trim()).filter(Boolean)
  : catalog.filter(a => a.impl).map(a => a.id);

fs.mkdirSync(outDir, { recursive: true });
const written = [];
for (const id of ids) {
  let svg;
  try {
    svg = render(id, { isPro: pro, lang, watermark: !pro });
  } catch (e) {
    console.error('  échec ' + id + ' : ' + e.message);
    process.exitCode = 1;
    continue;
  }
  const file = path.join(outDir, id + '.svg');
  fs.writeFileSync(file, svg);
  written.push(file);
  console.log('  ' + id.padEnd(16) + String(svg.length).padStart(7) + ' o  ' + file);
}
console.log(`\n${written.length}/${ids.length} SVG écrits dans ${outDir}` +
  (pro ? ' (mode licencié, sans filigrane)' : ' (mode essai, filigrané)'));
console.log(`site : ${sample.site.name} · rayon ${sample.site.R} m · ` +
  `${sample.elements.length} éléments d'origine`);

if (withPng) {
  /* Rasterisation facultative : dépend de cairosvg (Python) et d'ImageMagick. */
  const pngs = [];
  try {
    for (const f of written) {
      const png = f.replace(/\.svg$/, '.png');
      execFileSync('python3', ['-c',
        'import cairosvg,sys;cairosvg.svg2png(url=sys.argv[1],write_to=sys.argv[2],scale=2.0,background_color="white")',
        f, png], { stdio: 'pipe' });
      pngs.push(png);
    }
  } catch (e) {
    console.error('\nRasterisation indisponible (cairosvg absent) — SVG conservés.');
    process.exit(0);
  }
  for (let k = 0; k < pngs.length; k += 12) {
    const sheet = path.join(outDir, 'planche-' + (k / 12 + 1) + '.png');
    try {
      execFileSync('magick', ['montage', ...pngs.slice(k, k + 12),
        '-tile', '4x3', '-geometry', '+8+8', '-background', '#e8e8e8', sheet], { stdio: 'pipe' });
      console.log('  planche ' + sheet);
    } catch { console.error('  ImageMagick absent : planche non produite'); }
  }
}
