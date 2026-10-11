#!/usr/bin/env node
/* Collecte les fichiers *.test.mjs du dossier test/ et lance le lanceur de
   tests de Node sur cette liste explicite : les utilitaires partagés
   (test/helpers/) ne sont ainsi jamais pris pour des fichiers de test. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_DIR = path.join(ROOT, 'test');

function collect(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...collect(full));
    else if (e.name.endsWith('.test.mjs')) out.push(full);
  }
  return out.sort();
}

const files = collect(TEST_DIR);
if (!files.length) {
  console.error('aucun fichier de test trouvé dans ' + TEST_DIR);
  process.exit(1);
}

const args = ['--test', ...process.argv.slice(2).filter(a => !a.startsWith('--test')), ...files];
const child = spawn(process.execPath, args, { stdio: 'inherit', cwd: ROOT });
child.on('exit', code => process.exit(code ?? 1));
