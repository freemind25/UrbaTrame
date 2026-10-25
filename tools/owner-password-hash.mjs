#!/usr/bin/env node
/* Produit localement le vérificateur propriétaire; ne lit ni n'imprime aucun
   secret serveur et refuse d'écraser un fichier de sortie existant. */
import fs from 'node:fs';
import crypto from 'node:crypto';

const [inputPath, outputPath, ...extra] = process.argv.slice(2);
if (!inputPath || !outputPath || extra.length) {
  console.error('Usage: node tools/owner-password-hash.mjs <fichier-mot-de-passe> <fichier-verificateur>');
  process.exit(2);
}

let fileBytes;
try { fileBytes = fs.readFileSync(inputPath); }
catch {
  console.error('Impossible de lire le fichier privé.');
  process.exit(2);
}

try {
  let end = fileBytes.length;
  if (end >= 2 && fileBytes[end - 2] === 13 && fileBytes[end - 1] === 10) end -= 2;
  else if (end >= 1 && fileBytes[end - 1] === 10) end -= 1;
  const passwordBytes = fileBytes.subarray(0, end);
  if (!passwordBytes.length || passwordBytes.includes(0) || passwordBytes.includes(10) || passwordBytes.includes(13)) {
    console.error('Le fichier doit contenir une seule ligne non vide (un saut de ligne final est accepté).');
    process.exit(2);
  }

  let password;
  try { password = new TextDecoder('utf-8', { fatal: true }).decode(passwordBytes); }
  catch {
    console.error('Le fichier doit être encodé en UTF-8 valide.');
    process.exit(2);
  }
  const characters = Array.from(password).length;
  if (characters < 16) {
    console.error('Choisissez au moins 16 caractères.');
    process.exit(2);
  }
  if (passwordBytes.length > 512) {
    console.error('Le mot de passe dépasse la limite de 512 octets.');
    process.exit(2);
  }

  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(passwordBytes, salt, 32, {
    N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024
  });
  const verifier = `scrypt$16384$8$1$${salt.toString('base64url')}$${derived.toString('base64url')}\n`;
  try {
    fs.writeFileSync(outputPath, verifier, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  } catch {
    console.error('Impossible de créer le fichier vérificateur (vérifiez le chemin et l’absence de fichier existant).');
    process.exit(2);
  }
  passwordBytes.fill(0);
  derived.fill(0);
  console.log('Vérificateur scrypt créé dans le fichier de sortie. Protégez-le et ne le commitez pas.');
} finally {
  fileBytes.fill(0);
}
