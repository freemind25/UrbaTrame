#!/usr/bin/env node
/* Gestionnaire privé des licences UrbaTrame.
   La paire de l’émetteur est créée et conservée hors du dépôt. Le fichier
   privé est chiffré par mot de passe; seul le public FM_LICENSE_PUB est
   communiqué au serveur. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LICENSE_FILE_FORMAT, LICENSE_PRODUCT, LICENSE_VERSION,
  makeLicenseClaims, signLicenseToken
} from '../server/licence-token.mjs';

const SCRYPT_N = 32_768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

export function defaultVaultPath({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  const root = platform === 'win32'
    ? (env.APPDATA || path.join(home, 'AppData', 'Roaming'))
    : (env.XDG_CONFIG_HOME || path.join(home, '.config'));
  return path.join(root, 'UrbaTrame', 'licence-issuer.enc.json');
}

function assertPassphrase(passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < 12)
    throw new Error('PASSPHRASE_TOO_SHORT');
}

export function encryptIssuerVault(privateJwk, publicRaw, passphrase, random = crypto.randomBytes) {
  assertPassphrase(passphrase);
  const salt = random(16), iv = random(12);
  const key = crypto.scryptSync(passphrase, salt, 32, {
    N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM
  });
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const clear = Buffer.from(JSON.stringify(privateJwk), 'utf8');
  try {
    const encrypted = Buffer.concat([cipher.update(clear), cipher.final()]);
    return {
      format: 'UrbaTrame-License-Issuer-Key',
      version: 1,
      algorithm: 'Ed25519',
      kdf: { name: 'scrypt', n: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, salt: salt.toString('base64') },
      cipher: {
        name: 'aes-256-gcm', iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64')
      },
      publicKey: Buffer.from(publicRaw).toString('base64')
    };
  } finally {
    key.fill(0);
    clear.fill(0);
  }
}

export function decryptIssuerVault(vault, passphrase) {
  assertPassphrase(passphrase);
  if (!vault || vault.format !== 'UrbaTrame-License-Issuer-Key' || vault.version !== 1 ||
      vault.algorithm !== 'Ed25519' || vault.kdf?.name !== 'scrypt' || vault.kdf.n !== SCRYPT_N ||
      vault.kdf.r !== SCRYPT_R || vault.kdf.p !== SCRYPT_P || vault.cipher?.name !== 'aes-256-gcm')
    throw new Error('INVALID_ISSUER_VAULT');
  const salt = Buffer.from(vault.kdf.salt, 'base64');
  const iv = Buffer.from(vault.cipher.iv, 'base64');
  const tag = Buffer.from(vault.cipher.tag, 'base64');
  const encrypted = Buffer.from(vault.cipher.data, 'base64');
  const key = crypto.scryptSync(passphrase, salt, 32, {
    N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM
  });
  let clear;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    clear = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    const jwk = JSON.parse(clear.toString('utf8'));
    if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || typeof jwk.d !== 'string')
      throw new Error('INVALID_ISSUER_VAULT');
    const publicJwk = crypto.createPublicKey({ key: jwk, format: 'jwk' }).export({ format: 'jwk' });
    const derivedPublic = Buffer.from(publicJwk.x, 'base64url').toString('base64');
    if (derivedPublic !== vault.publicKey) throw new Error('INVALID_ISSUER_VAULT');
    return jwk;
  } catch {
    throw new Error('WRONG_PASSPHRASE_OR_DAMAGED_VAULT');
  } finally {
    key.fill(0);
    clear?.fill(0);
  }
}

export function createLicenseArtifact({ tier, days = null, lifetime = false, privateKey, now = Date.now(), licenseId } = {}) {
  if (!['pro', 'max'].includes(tier)) throw new Error('INVALID_TIER');
  if (Boolean(lifetime) === (days != null)) throw new Error('CHOOSE_DAYS_OR_LIFETIME');
  const nDays = days == null ? null : Number(days);
  if (nDays != null && (!Number.isInteger(nDays) || nDays < 1 || nDays > 3650))
    throw new Error('INVALID_DAYS');
  if (!privateKey) throw new Error('NO_LICENSE_ISSUER_KEY');
  const id = licenseId || 'UTL-' + crypto.randomBytes(8).toString('hex').toUpperCase();
  const expiresAt = lifetime ? null : now + nDays * 86_400_000;
  const claims = makeLicenseClaims({ tier, licenseId: id, issuedAt: now, expiresAt });
  const token = signLicenseToken(claims, privateKey);
  return {
    format: LICENSE_FILE_FORMAT,
    version: LICENSE_VERSION,
    product: LICENSE_PRODUCT,
    licenseId: id,
    tier,
    issuedAt: new Date(now).toISOString(),
    expiresAt: expiresAt == null ? null : new Date(expiresAt).toISOString(),
    token
  };
}

function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (!item.startsWith('--')) { positional.push(item); continue; }
    const [key, attached] = item.slice(2).split('=', 2);
    if (attached !== undefined) options[key] = attached;
    else if (['lifetime', 'help'].includes(key)) options[key] = true;
    else options[key] = argv[++i];
  }
  return { positional, options };
}

export function promptSecret(label, io = process) {
  const input = io.stdin, output = io.stdout;
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function')
    return Promise.reject(new Error('INTERACTIVE_TERMINAL_REQUIRED'));
  return new Promise((resolve, reject) => {
    let value = '';
    const wasRaw = input.isRaw;
    const cleanup = () => {
      input.off('data', onData);
      try { input.setRawMode(Boolean(wasRaw)); } catch {}
      input.pause();
      output.write('\n');
    };
    const onData = chunk => {
      for (const char of String(chunk)) {
        if (char === '\u0003') {
          cleanup(); reject(new Error('CANCELLED')); return;
        }
        if (char === '\r' || char === '\n') {
          cleanup(); resolve(value); return;
        }
        if (char === '\u007f' || char === '\b') {
          if (value.length) { value = value.slice(0, -1); output.write('\b \b'); }
          continue;
        }
        if (char >= ' ' && char !== '\u007f') { value += char; output.write('*'); }
      }
    };
    output.write(label);
    input.setRawMode(true);
    input.setEncoding('utf8');
    input.resume();
    input.on('data', onData);
  });
}

async function writePrivateFile(file, content) {
  const abs = path.resolve(file);
  fs.mkdirSync(path.dirname(abs), { recursive: true, mode: 0o700 });
  const handle = await fs.promises.open(abs, 'wx', 0o600);
  try { await handle.writeFile(content, 'utf8'); }
  finally { await handle.close(); }
  try { fs.chmodSync(abs, 0o600); } catch {}
  return abs;
}

async function createIssuerKeyFile(target) {
  if (fs.existsSync(target)) throw new Error('ISSUER_KEY_ALREADY_EXISTS');
  const first = await promptSecret('Nouveau mot de passe (12 caractères minimum) : ');
  const second = await promptSecret('Confirmez le mot de passe : ');
  if (first !== second) throw new Error('PASSPHRASE_MISMATCH');
  assertPassphrase(first);
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const privateJwk = privateKey.export({ format: 'jwk' });
  const publicJwk = publicKey.export({ format: 'jwk' });
  const publicRaw = Buffer.from(publicJwk.x, 'base64url');
  const vault = encryptIssuerVault(privateJwk, publicRaw, first);
  const abs = await writePrivateFile(target, JSON.stringify(vault, null, 2) + '\n');
  return { abs, publicRaw };
}

async function loadIssuerPrivateKey(file) {
  if (!fs.existsSync(file)) throw new Error('ISSUER_KEY_NOT_FOUND');
  const first = await promptSecret('Mot de passe du générateur : ');
  const vault = JSON.parse(fs.readFileSync(file, 'utf8'));
  const jwk = decryptIssuerVault(vault, first);
  return crypto.createPrivateKey({ key: jwk, format: 'jwk' });
}

function defaultOutputPath() {
  const docs = path.join(os.homedir(), 'Documents', 'UrbaTrame-Licences');
  return path.join(docs, 'licence-' + new Date().toISOString().slice(0, 10) + '.utlic');
}

function help() {
  console.log(`Gestionnaire privé de licences UrbaTrame

Commandes :
  node tools/licence-manager.mjs init [--keyfile CHEMIN]
  node tools/licence-manager.mjs public [--keyfile CHEMIN]
  node tools/licence-manager.mjs issue --tier pro|max (--days N | --lifetime) [--out FICHIER] [--keyfile CHEMIN]

`);
  console.log('Le coffre et les fichiers .utlic sont créés hors du dépôt par défaut.');
  console.log('La clé privée reste chiffrée localement; seul FM_LICENSE_PUB est transmis au serveur.');
}

export async function main(argv = process.argv.slice(2)) {
  const { positional, options } = parseArgs(argv);
  if (options.help || !positional.length) return help();
  const [command] = positional;
  const keyfile = path.resolve(options.keyfile || defaultVaultPath());

  if (command === 'init') {
    try {
      const { abs, publicRaw } = await createIssuerKeyFile(keyfile);
      console.log('Générateur créé : ' + abs);
      console.log('Clé privée chiffrée; conservez le mot de passe et faites une sauvegarde sécurisée du coffre.');
      console.log('À configurer dans Vercel / environnement local (clé publique, non secrète) :');
      console.log('FM_LICENSE_PUB=' + publicRaw.toString('base64'));
    } catch (error) {
      if (error.message === 'ISSUER_KEY_ALREADY_EXISTS') {
        console.error('Refus : le coffre existe déjà; aucune clé n’a été remplacée.');
      } else if (error.message === 'INTERACTIVE_TERMINAL_REQUIRED') {
        console.error('Lancez cette commande dans PowerShell ou un terminal interactif.');
      } else if (error.message === 'PASSPHRASE_MISMATCH') {
        console.error('Les mots de passe ne correspondent pas. Aucun coffre créé.');
      } else if (error.message === 'PASSPHRASE_TOO_SHORT') {
        console.error('Choisissez un mot de passe d’au moins 12 caractères.');
      } else console.error('Création impossible : ' + error.message);
      process.exitCode = 1;
    }
    return;
  }

  if (command === 'public') {
    try {
      const jwk = await loadIssuerPrivateKey(keyfile);
      const publicJwk = crypto.createPublicKey({ key: jwk, format: 'jwk' }).export({ format: 'jwk' });
      const raw = Buffer.from(publicJwk.x, 'base64url');
      console.log('FM_LICENSE_PUB=' + raw.toString('base64'));
    } catch (error) {
      console.error('Lecture impossible : ' + error.message);
      process.exitCode = 1;
    }
    return;
  }

  if (command === 'issue') {
    const tier = String(options.tier || '').toLowerCase();
    const hasDays = options.days !== undefined;
    if (!['pro', 'max'].includes(tier) || (Boolean(options.lifetime) === hasDays)) {
      console.error('Indiquez --tier pro|max et exactement un choix : --days N ou --lifetime.');
      process.exitCode = 1; return;
    }
    const out = path.resolve(options.out || defaultOutputPath());
    try {
      const privateKey = await loadIssuerPrivateKey(keyfile);
      const artifact = createLicenseArtifact({
        tier,
        days: hasDays ? Number(options.days) : null,
        lifetime: Boolean(options.lifetime),
        privateKey
      });
      const abs = await writePrivateFile(out, JSON.stringify(artifact, null, 2) + '\n');
      console.log(`Licence ${tier.toUpperCase()} créée : ${artifact.licenseId}`);
      console.log('Expiration : ' + (artifact.expiresAt || 'sans expiration'));
      console.log('Fichier : ' + abs);
      console.log('Remettez uniquement ce fichier .utlic au titulaire de la licence.');
    } catch (error) {
      const messages = {
        INTERACTIVE_TERMINAL_REQUIRED: 'Lancez cette commande dans PowerShell ou un terminal interactif.',
        WRONG_PASSPHRASE_OR_DAMAGED_VAULT: 'Mot de passe incorrect ou coffre endommagé.',
        ISSUER_KEY_NOT_FOUND: 'Coffre émetteur introuvable; lancez d’abord la commande init.',
        PASSPHRASE_TOO_SHORT: 'Le mot de passe doit contenir au moins 12 caractères.',
        EEXIST: 'Le fichier existe déjà; choisissez un autre chemin.',
        INVALID_DAYS: 'La durée doit être un entier compris entre 1 et 3650 jours.',
        CHOOSE_DAYS_OR_LIFETIME: 'Choisissez exactement --days N ou --lifetime.'
      };
      console.error(messages[error.message] || 'Émission impossible : ' + error.message);
      process.exitCode = 1;
    }
    return;
  }

  console.error('Commande inconnue : ' + command);
  help();
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
