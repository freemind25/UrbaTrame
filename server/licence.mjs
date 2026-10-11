/* Licences : catalogue de codes, jetons de session et titres signés Ed25519.
   ───────────────────────────────────────────────────────────────────────────
   L'application est la nôtre : le catalogue de codes est donc défini ici.
   Le titre (`ent`) est un JWT sans en-tête, vérifiable hors ligne :

       payload = { v:1, t:'pro'|'max', d:'<appareil>', x:<expiration ms> }
       ent     = base64url(payload) + '.' + base64url(signature Ed25519)

   Le navigateur possède la clé publique (`GET /api/status`) et vérifie la
   signature, le palier, l'appareil et la date avant d'ouvrir un accès : modifier
   localStorage ne suffit pas à se donner une licence.
   ─────────────────────────────────────────────────────────────────────────── */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DAY = 864e5;

/* Codes de démonstration livrés publiquement pour éprouver le parcours
   d'activation. En production, les remplacer par le catalogue réel :
   `MTN_CODES` ou un fichier `codes.json` dans le dossier de données. */
export const DEMO_CODES = new Map([
  ['cs_demo_pro',      { plan: 'pro', tier: 'pro', days: 30 }],
  ['cs_demo_max',      { plan: 'max', tier: 'max', days: 30 }],
  ['cs_demo_lifetime', { plan: 'max', tier: 'max', days: null }],
  ['cs_etude_2026',    { plan: 'max', tier: 'max', days: 90 }]
]);

export const validDevice = d => typeof d === 'string' && /^[0-9a-f-]{16,40}$/i.test(d);

const b64u = b => Buffer.from(b).toString('base64url');

export function createLicence({ dataDir, codes = DEMO_CODES } = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const keyFile = path.join(dataDir, 'keys.json');

  /* La paire de clés doit survivre aux redémarrages : si elle est régénérée,
     toutes les licences déjà délivrées deviennent invérifiables. */
  let keys;
  if (fs.existsSync(keyFile)) {
    const j = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
    keys = {
      privateKey: crypto.createPrivateKey({ key: j.private, format: 'jwk' }),
      publicKey: crypto.createPublicKey({ key: j.public, format: 'jwk' }),
      publicRaw: Buffer.from(j.publicRaw, 'base64')
    };
  } else {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    const priv = privateKey.export({ format: 'jwk' });
    const pub = publicKey.export({ format: 'jwk' });
    const raw = Buffer.from(pub.x, 'base64url');
    keys = { privateKey, publicKey, publicRaw: raw };
    fs.writeFileSync(keyFile,
      JSON.stringify({ private: priv, public: pub, publicRaw: raw.toString('base64') }, null, 1),
      { mode: 0o600 });
  }

  const pubB64 = keys.publicRaw.toString('base64');
  const sessions = new Map();    // token -> {account, code, tier, plan, expiresAt, device}
  const refByCode = new Map();   // code  -> code de parrainage

  function signEntitlement(payload) {
    const body = b64u(Buffer.from(JSON.stringify(payload), 'utf8'));
    const sig = crypto.sign(null, Buffer.from(body), keys.privateKey);
    return body + '.' + b64u(sig);
  }

  function activate(code, device, now = Date.now()) {
    code = String(code || '').trim();
    const def = codes.get(code);
    if (!def) return { error: 'INVALID_CODE', status: 400 };
    if (!validDevice(device)) return { error: 'INVALID_DEVICE', status: 400 };

    const account = 'acc_' + crypto.createHash('sha1').update(code).digest('hex').slice(0, 12);
    const token = b64u(crypto.randomBytes(24));
    const expiresAt = def.days ? now + def.days * DAY : null;
    sessions.set(token, { account, code, tier: def.tier, plan: def.plan, expiresAt, device });

    if (!refByCode.has(code))
      refByCode.set(code, 'MTN-' + crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 5));

    const ent = signEntitlement({ v: 1, t: def.tier, d: device, x: expiresAt || now + 3650 * DAY });
    return { ok: true, account, token, plan: def.plan, tier: def.tier, expiresAt, ent, ref: refByCode.get(code) };
  }

  function check(session, now = Date.now()) {
    const { account, token, device } = session || {};
    if (!account || !token) return { ok: true, tier: 'free' };
    const s = sessions.get(token);
    if (!s || s.account !== account) return { error: 'DEVICE_REVOKED', status: 403 };
    if (s.expiresAt && s.expiresAt < now) return { error: 'EXPIRED', status: 403, expired: true };
    const ent = signEntitlement({ v: 1, t: s.tier, d: device, x: s.expiresAt || now + 3650 * DAY });
    return { ok: true, tier: s.tier, plan: s.plan || s.tier, expiresAt: s.expiresAt, ent };
  }

  return {
    pubB64,
    activate,
    check,
    signEntitlement,
    /* utilisés par les utilitaires de parrainage */
    sessionFor: code => {
      for (const s of sessions.values()) if (s.code === code) return s;
      return null;
    },
    refFor: code => refByCode.get(code) || '',
    knownCodes: () => [...codes.keys()]
  };
}
