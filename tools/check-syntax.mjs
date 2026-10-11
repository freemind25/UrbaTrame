#!/usr/bin/env node
/* Contrôle syntaxique de tous les fichiers JavaScript du dépôt.
   Les fichiers .js du navigateur sont, pour certains, des modules ES
   (app.js importe des .mjs) : `node --check` les refuse à cause de
   l'extension, on les recopie donc en .mjs dans un dossier temporaire pour
   les valider. C'est ce que fait `npm run lint`. */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['.git', 'node_modules', 'test/out', '.cache']);
const EXT = new Set(['.js', '.mjs', '.cjs']);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.relative(ROOT, path.join(dir, e.name));
    if (SKIP.has(e.name) || SKIP.has(rel)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (EXT.has(path.extname(e.name))) out.push(full);
  }
  return out;
}

const files = walk(ROOT).sort();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mtn-lint-'));
let failures = 0, modules = 0;

for (const f of files) {
  const rel = path.relative(ROOT, f);
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
    console.log('  ok   ' + rel);
  } catch (e) {
    /* Deuxième essai en module ES, pour les .js servis en type="module". */
    const copy = path.join(tmp, path.basename(f, '.js') + '.mjs');
    fs.copyFileSync(f, copy);
    try {
      execFileSync(process.execPath, ['--check', copy], { stdio: 'pipe' });
      modules++;
      console.log('  ok   ' + rel + '  (module ES portant l\'extension .js)');
    } catch (e2) {
      failures++;
      console.error('  ÉCHEC ' + rel + '\n' + String(e2.stderr || e2.message).trim());
    }
  }
}
fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${files.length} fichiers contrôlés · ${modules} module(s) ES en .js · ` +
  (failures ? failures + ' échec(s)' : 'aucun échec'));
process.exit(failures ? 1 : 0);
