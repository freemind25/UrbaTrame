/* Licences : catalogue de codes, sessions et titres signés Ed25519.
   ───────────────────────────────────────────────────────────────────────────
   Deux modes de session, selon l'endroit où le serveur tourne :

   ▸ `sessions` (défaut, serveur classique)
     Les sessions de génération vivent en mémoire : un redémarrage les efface,
     mais tout est stocké, donc un code peut être révoqué côté serveur.

   ▸ `stateless` (Vercel, Cloudflare, toute plateforme sans disque ni état)
     Le jeton EST le titre : un bloc signé Ed25519 `{ v, t, d, x }` que le
     serveur revérifie à chaque appel avec sa clé publique. Aucun stockage,
     donc aucune révocation possible avant expiration — la contrepartie est
     documentée dans docs/VERCEL.md.

   Dans les deux modes le titre `ent` est vérifiable hors ligne par le
   navigateur, qui détient la clé publique servie par `GET /api/status`.
   ─────────────────────────────────────────────────────────────────────────── */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { issuerPublicKeyFromEnv, verifyLicenseToken } from './licence-token.mjs';

export const DAY = 864e5;

/* Codes de démonstration réservés au développement local. Ils ne sont jamais
   utilisés par défaut en production; les catalogues réels sont fournis par
   FM_CODES ou par un fichier de données privé. */
export const DEMO_CODES = new Map([
  ['cs_demo_pro',      { plan: 'pro', tier: 'pro', days: 30 }],
  ['cs_demo_max',      { plan: 'max', tier: 'max', days: 30 }],
  ['cs_demo_lifetime', { plan: 'max', tier: 'max', days: null }],
  ['cs_etude_2026',    { plan: 'max', tier: 'max', days: 90 }]
]);

/* Catalogue effectif : variable d'environnement > fichier local. Les codes
   de démonstration ne servent qu'en développement, jamais en production. */
export function resolveCodes({ dataDir, env = process.env } = {}) {
  if (typeof env.FM_CODES === 'string' && env.FM_CODES.trim()) {
    try {
      const j = JSON.parse(env.FM_CODES);
      if (j && typeof j === 'object' && !Array.isArray(j)) return new Map(Object.entries(j));
    } catch { /* catalogue invalide : ne jamais ouvrir les licences en production */ }
  }
  const file = dataDir ? path.join(dataDir, 'codes.json') : null;
  if (file && fs.existsSync(file)) {
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (j && typeof j === 'object' && !Array.isArray(j)) return new Map(Object.entries(j));
    } catch { /* fichier illisible : mode vide en production */ }
  }
  return env.NODE_ENV === 'production' || Boolean(env.VERCEL) ? new Map() : DEMO_CODES;
}

export const validDevice = d => typeof d === 'string' && /^[0-9a-f-]{16,40}$/i.test(d);

const b64u = b => Buffer.from(b).toString('base64url');

/* Clé privée fournie par l'environnement (`FM_SIGNING_KEY`, base64 d'un JWK).
   Utile dès qu'il n'y a pas de disque : Vercel, conteneur sans volume… */
export function keysFromEnv(env = process.env) {
  const raw = env.FM_SIGNING_KEY;
  if (!raw) return null;
  try {
    const jwk = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    const privateKey = crypto.createPrivateKey({ key: jwk, format: 'jwk' });
    const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    const publicRaw = Buffer.from(jwk.x, 'base64url');
    return { privateKey, publicKey, publicRaw };
  } catch {
    return null;   // clé illisible : on repart sans licence plutôt qu'en erreur
  }
}

/* Clé publique extraite d'un titre signé, pour l'exposer sans clé privée. */
export function keysFromFile(dataDir) {
  const keyFile = path.join(dataDir, 'keys.json');
  if (fs.existsSync(keyFile)) {
    try { fs.chmodSync(keyFile, 0o600); } catch { /* ACL Windows / stockage read-only */ }
    const j = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
    return {
      privateKey: crypto.createPrivateKey({ key: j.private, format: 'jwk' }),
      publicKey: crypto.createPublicKey({ key: j.public, format: 'jwk' }),
      publicRaw: Buffer.from(j.publicRaw, 'base64')
    };
  }
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const priv = privateKey.export({ format: 'jwk' });
  const pub = publicKey.export({ format: 'jwk' });
  const publicRaw = Buffer.from(pub.x, 'base64url');
  fs.writeFileSync(keyFile,
    JSON.stringify({ private: priv, public: pub, publicRaw: publicRaw.toString('base64') }, null, 1),
    { mode: 0o600 });
  return { privateKey, publicKey, publicRaw };
}

export function createLicence({
  dataDir,
  keys,                      // paire fournie (environnement) ; sinon lue ou créée
  codes,
  issuerPublicKey = undefined,
  stateless = false          // sessions sans stockage (plateformes sans disque)
} = {}) {
  const resolved = keys || (dataDir ? keysFromFile(dataDir) : null);
  const catalogue = codes || resolveCodes({ dataDir });
  const licenseIssuer = issuerPublicKey === undefined ? issuerPublicKeyFromEnv() : issuerPublicKey;
  /* Sans clé, le service reste utilisable en essai gratuit : mieux vaut un
     mode dégradé explicite qu'une erreur au démarrage. */
  const disabled = !resolved;
  const pubB64 = resolved ? resolved.publicRaw.toString('base64') : '';
  const licensePubB64 = licenseIssuer?.publicRaw?.toString('base64') || '';

  const sessions = new Map();    // mode « sessions » : token -> {account, code, tier, …}
  const refByCode = new Map();   // code -> code de parrainage

  function signEntitlement(payload) {
    if (disabled) throw new Error('NO_SIGNING_KEY');
    const body = b64u(Buffer.from(JSON.stringify(payload), 'utf8'));
    const sig = crypto.sign(null, Buffer.from(body), resolved.privateKey);
    return body + '.' + b64u(sig);
  }

  /* Vérification d'un titre signé, côté serveur (mode sans état). */
  function verifyEntitlement(token, device, now = Date.now()) {
    if (!token || typeof token !== 'string') return { error: 'INVALID_TOKEN', status: 400 };
    const [body, sig] = token.split('.');
    if (!body || !sig) return { error: 'INVALID_TOKEN', status: 400 };
    let ok = false;
    try {
      ok = crypto.verify(null, Buffer.from(body), resolved.publicKey, Buffer.from(sig, 'base64url'));
    } catch { ok = false; }
    if (!ok) return { error: 'DEVICE_REVOKED', status: 403 };
    let p;
    try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); }
    catch { return { error: 'INVALID_TOKEN', status: 400 }; }
    if (p.v !== 1 || !['pro', 'max'].includes(p.t)) return { error: 'DEVICE_REVOKED', status: 403 };
    if (device && p.d !== device) return { error: 'DEVICE_REVOKED', status: 403 };
    if (p.x && p.x <= now) return { error: 'EXPIRED', status: 403, expired: true };
    return { ok: true, tier: p.t, plan: p.t, expiresAt: p.x || null };
  }

  function activate(code, device, now = Date.now()) {
    code = String(code || '').trim();
    const def = catalogue.get(code);
    if (!def) return { error: 'INVALID_CODE', status: 400 };
    if (!validDevice(device)) return { error: 'INVALID_DEVICE', status: 400 };
    if (disabled) return { error: 'NO_SIGNING_KEY', status: 503 };

    const account = 'acc_' + crypto.createHash('sha1').update(code).digest('hex').slice(0, 12);
    const expiresAt = def.days ? now + def.days * DAY : null;
    const ent = signEntitlement({ v: 1, t: def.tier, d: device, x: expiresAt || 0 });
    const token = b64u(crypto.randomBytes(24));

    if (!stateless)
      sessions.set(token, { account, code, tier: def.tier, plan: def.plan, expiresAt, device });

    if (!refByCode.has(code))
      refByCode.set(code, 'MTN-' + crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 5));

    return {
      ok: true, account,
      /* En mode sans état, le titre signé fait office de jeton de session :
         le serveur peut le revérifier sans rien stocker. */
      token: stateless ? ent : token,
      plan: def.plan, tier: def.tier, expiresAt, ent, ref: refByCode.get(code)
    };
  }

  function activateLicense(tokenValue, device, now = Date.now()) {
    if (!validDevice(device)) return { error: 'INVALID_DEVICE', status: 400 };
    if (!licenseIssuer?.publicKey) return { error: 'LICENSE_ISSUER_UNCONFIGURED', status: 503 };
    if (disabled) return { error: 'NO_SIGNING_KEY', status: 503 };
    const verified = verifyLicenseToken(tokenValue, licenseIssuer.publicKey, now);
    if (verified.error) return verified;

    const { licenseId, tier, expiresAt } = verified.claims;
    const account = 'lic_' + crypto.createHash('sha256').update(licenseId).digest('hex').slice(0, 12);
    const ent = signEntitlement({ v: 1, t: tier, d: device, x: expiresAt || 0, li: licenseId });
    const token = b64u(crypto.randomBytes(24));
    if (!stateless)
      sessions.set(token, { account, code: 'signed:' + licenseId, tier, plan: tier, expiresAt, device, licenseId });

    return {
      ok: true, account, token: stateless ? ent : token,
      plan: tier, tier, expiresAt, ent, licenseId
    };
  }

  function check(session, now = Date.now()) {
    const { account, token, device } = session || {};
    if (!token) return { ok: true, tier: 'free' };

    /* Un fichier .utlic est un titre autonome : le navigateur peut l’importer
       sans code d’activation, et le serveur le vérifie à chaque analyse payante. */
    const issued = verifyLicenseToken(token, licenseIssuer?.publicKey, now);
    if (issued.ok) {
      if (!validDevice(device)) return { error: 'INVALID_DEVICE', status: 400 };
      if (disabled) return { error: 'NO_SIGNING_KEY', status: 503 };
      const { licenseId, tier, expiresAt } = issued.claims;
      const ent = signEntitlement({ v: 1, t: tier, d: device, x: expiresAt || 0, li: licenseId });
      return { ok: true, tier, plan: tier, expiresAt, ent, licenseId };
    }
    if (issued.error === 'EXPIRED' || issued.error === 'LICENSE_NOT_YET_VALID') return issued;

    if (stateless) {
      const r = verifyEntitlement(token, device, now);
      if (r.error) return r;
      const ent = signEntitlement({ v: 1, t: r.tier, d: device, x: r.expiresAt || 0 });
      return { ok: true, tier: r.tier, plan: r.tier, expiresAt: r.expiresAt, ent };
    }

    if (!account) return { ok: true, tier: 'free' };
    const s = sessions.get(token);
    if (!s || s.account !== account) return { error: 'DEVICE_REVOKED', status: 403 };
    if (s.expiresAt && s.expiresAt <= now) return { error: 'EXPIRED', status: 403, expired: true };
    const ent = signEntitlement({ v: 1, t: s.tier, d: device, x: s.expiresAt || 0, ...(s.licenseId ? { li: s.licenseId } : {}) });
    return { ok: true, tier: s.tier, plan: s.plan || s.tier, expiresAt: s.expiresAt, ent };
  }

  return {
    pubB64,
    licensePubB64,
    activate,
    activateLicense,
    check,
    signEntitlement,
    verifyEntitlement,
    disabled,
    stateless,
    issuerReady: Boolean(licenseIssuer?.publicKey),
    /* utilisés par les utilitaires de parrainage */
    sessionFor: code => {
      for (const s of sessions.values()) if (s.code === code) return s;
      return null;
    },
    refFor: code => refByCode.get(code) || '',
    knownCodes: () => [...catalogue.keys()],
    sessionCount: () => sessions.size
  };
}
