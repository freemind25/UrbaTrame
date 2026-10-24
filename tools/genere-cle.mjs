#!/usr/bin/env node
/* Génère la paire Ed25519 du serveur, utilisée pour signer les attestations
   de session. Ce n’est PAS le générateur des titres Pro/Max .utlic : celui-ci
   est `tools/licence-manager.mjs` et conserve sa clé privée hors du projet.
   ───────────────────────────────────────────────────────────────────────────
     node tools/genere-cle.mjs            # affiche la valeur à copier
     node tools/genere-cle.mjs --fichier data/keys.json
                                          # écrit directement un fichier local

   Deux usages :

   ▸ Serveur classique : sans argument, écrit data/keys.json (c'est ce que fait
     le serveur au premier démarrage s'il est absent). Sauvegardez ce fichier :
     le perdre revient à invalider toutes les licences déjà délivrées.

   ▸ Vercel (aucun disque) : copiez la valeur affichée dans la variable
     d'environnement FM_SIGNING_KEY du projet. Sans elle, l'application reste
     utilisable mais uniquement en essai gratuit.
   ─────────────────────────────────────────────────────────────────────────── */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './kernel.mjs';

const args = process.argv.slice(2);
const i = args.indexOf('--fichier');
const target = i > -1 ? path.resolve(ROOT, args[i + 1]) : null;

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const priv = privateKey.export({ format: 'jwk' });
const pub = publicKey.export({ format: 'jwk' });
const publicRaw = Buffer.from(pub.x, 'base64url');

if (target) {
  if (fs.existsSync(target)) {
    console.error(`Refus : ${path.relative(ROOT, target)} existe déjà.`);
    console.error('Le remplacer invaliderait les licences en circulation.');
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(
    { private: priv, public: pub, publicRaw: publicRaw.toString('base64') }, null, 1), { mode: 0o600 });
  console.log('Paire écrite dans ' + path.relative(ROOT, target) + ' (droits 600)');
  console.log('Clé publique : ' + publicRaw.toString('base64'));
} else {
  console.log('Clé privée à coller dans la variable d\'environnement FM_SIGNING_KEY :\n');
  console.log(Buffer.from(JSON.stringify(priv)).toString('base64'));
  console.log('\nClé publique correspondante (le service la publie de lui-même) :\n');
  console.log(publicRaw.toString('base64'));
  console.log('\nSur Vercel :');
  console.log('  vercel env add FM_SIGNING_KEY production    # collez la première valeur');
  console.log('  ou Project → Settings → Environment Variables');
  console.log('\nRappels : sans cette clé, l\'application tourne en essai gratuit et');
  console.log('l\'activation d\'un code répond NO_SIGNING_KEY. Ne la commitez jamais,');
  console.log('et sauvegardez-la : la perdre invalide les licences déjà délivrées.');
}
