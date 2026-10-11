#!/usr/bin/env node
/* Personnalise le dépôt pour un compte GitHub donné : adresses du dépôt,
   badge d'intégration continue, signature envoyée aux sources de données.

     node tools/personaliser.mjs --compte <pseudo> [--nom <dépôt>] [--contact <adresse>]
     node tools/personaliser.mjs --etat          # où en est la personnalisation ?

   Sans --contact, la signature envoyée à OpenStreetMap reste neutre ; les
   règles d'usage de Nominatim demandent cependant une adresse joignable dès
   que l'instance est publique. */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './kernel.mjs';

const PLACEHOLDER = 'CHANGER-MOI';
const DEFAULT_REPO = 'maptonap-clone';

const args = process.argv.slice(2);
const opt = name => {
  const i = args.indexOf('--' + name);
  return i > -1 ? args[i + 1] : undefined;
};

/* ── état ── */
if (args.includes('--etat')) {
  const files = targets();
  let restant = 0;
  for (const f of files) {
    const n = (fs.readFileSync(f, 'utf8').match(new RegExp(PLACEHOLDER, 'g')) || []).length;
    const ua = f.endsWith('config.mjs') ? uaLine() : '';
    console.log(`  ${path.relative(ROOT, f).padEnd(34)} ${n ? n + ' emplacement(s) à compléter' : 'à jour'}` + (ua ? ' — ' + ua : ''));
    restant += n;
  }
  console.log(restant
    ? `\n${restant} emplacement(s) en attente. Lancez :\n  npm run personnaliser -- --compte <pseudo> [--nom ${DEFAULT_REPO}] [--contact <adresse>]`
    : '\nPersonnalisation terminée.');
  process.exit(0);
}

const compte = opt('compte');
const nom = opt('nom') || DEFAULT_REPO;
const contact = opt('contact');

if (!compte) {
  console.error('Usage : npm run personnaliser -- --compte <pseudo> [--nom ' + DEFAULT_REPO + '] [--contact <adresse>]');
  console.error('        npm run personnaliser -- --etat');
  process.exit(2);
}
if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(compte)) {
  console.error(`Pseudo GitHub invalide : « ${compte} » (lettres, chiffres et tirets).`);
  process.exit(2);
}
if (contact && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) {
  console.error(`Adresse de contact invalide : « ${contact} ».`);
  process.exit(2);
}

const base = `https://github.com/${compte}/${nom}`;
const remplacements = [
  [`https://github.com/${PLACEHOLDER}/${DEFAULT_REPO}.git`, base + '.git'],
  [`https://github.com/${PLACEHOLDER}/${DEFAULT_REPO}/releases`, base + '/releases'],
  [`https://github.com/${PLACEHOLDER}/${DEFAULT_REPO}/actions`, base + '/actions'],
  [`https://github.com/${PLACEHOLDER}/${DEFAULT_REPO}/discussions`, base + '/discussions'],
  [`https://github.com/${PLACEHOLDER}/${DEFAULT_REPO}/issues`, base + '/issues'],
  [`https://github.com/${PLACEHOLDER}/${DEFAULT_REPO}#readme`, base + '#readme'],
  [`https://github.com/${PLACEHOLDER}/${DEFAULT_REPO}`, base]
];

let touched = 0;
for (const file of targets()) {
  const before = fs.readFileSync(file, 'utf8');
  let after = before;
  for (const [from, to] of remplacements) after = after.split(from).join(to);

  /* Le badge d'intégration continue est placé dans un commentaire tant que les
     adresses sont provisoires : on le révèle une fois le compte connu. */
  after = after.replace(
    /<!-- Badge de CI :[\s\S]*?\n(\[!\[CI\][^\n]*)\n-->\n/,
    '$1\n'
  );

  /* Signature envoyée aux sources externes. Remplacement ligne à ligne : la
     chaîne contient elle-même des points-virgules, une expression trop courte
     la tronquerait. */
  if (file.endsWith('config.mjs'))
    after = after.replace(
      /^export const UA = .*$/m,
      `export const UA = 'MapToNap-clone/${version()} (${base}${contact ? ' ; ' + contact : ''})';`
    );

  if (after !== before) {
    fs.writeFileSync(file, after);
    touched++;
    console.log('  mis à jour  ' + path.relative(ROOT, file));
  }
}

/* Nom affiché du projet, s'il change */
if (nom !== DEFAULT_REPO) {
  const p = path.join(ROOT, 'package.json');
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  j.name = nom;
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
  console.log('  mis à jour  package.json (nom : ' + nom + ')');
}

console.log(`\n${touched} fichier(s) mis à jour pour ${base}`);
console.log('Étapes suivantes :');
console.log(`  1. git add -A && git commit -m "Personnalisation du dépôt pour ${compte}"`);
console.log('  2. créez le dépôt vide sur GitHub, sans README ni licence');
console.log(`  3. git remote add origin git@github.com:${compte}/${nom}.git`);
console.log('  4. git push -u origin main');
if (!contact) console.log('\nRappel : --contact <adresse> complète la signature envoyée à OpenStreetMap.');

function targets() {
  return [
    'README.md',
    'CHANGELOG.md',
    'package.json',
    'server/config.mjs',
    '.github/ISSUE_TEMPLATE/config.yml'
  ].map(f => path.join(ROOT, f)).filter(f => fs.existsSync(f));
}

function uaLine() {
  const m = fs.readFileSync(path.join(ROOT, 'server/config.mjs'), 'utf8').match(/export const UA = (.*?);/);
  return m ? 'signature : ' + m[1] : '';
}

function version() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
}
