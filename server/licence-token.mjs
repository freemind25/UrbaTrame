/* Format des fichiers de licence UrbaTrame (.utlic).
   Le signataire privé reste dans l’outil local du propriétaire; le serveur
   reçoit uniquement la clé publique FM_LICENSE_PUB. */
import crypto from 'node:crypto';

export const LICENSE_PRODUCT = 'UrbaTrame';
export const LICENSE_FILE_FORMAT = 'UrbaTrame-License';
export const LICENSE_VERSION = 1;

const b64u = value => Buffer.from(value).toString('base64url');
const TOKEN_SEGMENT = /^[A-Za-z0-9_-]+$/;
const LICENSE_ID = /^UTL-[0-9A-F]{16}$/;
const ALLOWED_KEYS = ['expiresAt', 'issuedAt', 'licenseId', 'product', 'tier', 'v'];

export function issuerPublicKeyFromRaw(raw) {
  const bytes = Buffer.from(raw || []);
  if (bytes.length !== 32) return null;
  try {
    const x = bytes.toString('base64url');
    const publicKey = crypto.createPublicKey({
      key: { kty: 'OKP', crv: 'Ed25519', x },
      format: 'jwk'
    });
    return { publicKey, publicRaw: bytes };
  } catch {
    return null;
  }
}

export function issuerPublicKeyFromEnv(env = process.env) {
  const value = String(env.FM_LICENSE_PUB || '').trim();
  if (!value) return null;
  try {
    const raw = Buffer.from(value, 'base64');
    return issuerPublicKeyFromRaw(raw);
  } catch {
    return null;
  }
}

export function makeLicenseClaims({
  tier,
  licenseId,
  issuedAt = Date.now(),
  expiresAt = null
} = {}) {
  const claims = {
    v: LICENSE_VERSION,
    product: LICENSE_PRODUCT,
    licenseId: String(licenseId || ''),
    tier: String(tier || ''),
    issuedAt: Number(issuedAt),
    expiresAt: expiresAt == null ? null : Number(expiresAt)
  };
  const error = validateLicenseClaims(claims, Number(issuedAt));
  if (error) throw new Error(error);
  return claims;
}

export function validateLicenseClaims(claims, now = Date.now()) {
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) return 'INVALID_LICENSE';
  if (Object.keys(claims).sort().join('|') !== [...ALLOWED_KEYS].sort().join('|')) return 'INVALID_LICENSE';
  if (claims.v !== LICENSE_VERSION || claims.product !== LICENSE_PRODUCT) return 'INVALID_LICENSE';
  if (!LICENSE_ID.test(String(claims.licenseId || ''))) return 'INVALID_LICENSE';
  if (claims.tier !== 'pro' && claims.tier !== 'max') return 'INVALID_LICENSE';
  if (!Number.isSafeInteger(claims.issuedAt) || claims.issuedAt <= 0) return 'INVALID_LICENSE';
  if (claims.issuedAt > now + 5 * 60_000) return 'LICENSE_NOT_YET_VALID';
  if (claims.expiresAt !== null &&
      (!Number.isSafeInteger(claims.expiresAt) || claims.expiresAt <= claims.issuedAt))
    return 'INVALID_LICENSE';
  if (claims.expiresAt !== null && claims.expiresAt <= now) return 'EXPIRED';
  return '';
}

export function signLicenseToken(claims, privateKey) {
  const error = validateLicenseClaims(claims, claims?.issuedAt || Date.now());
  if (error) throw new Error(error);
  if (!privateKey) throw new Error('NO_LICENSE_ISSUER_KEY');
  const body = b64u(Buffer.from(JSON.stringify(claims), 'utf8'));
  const signature = crypto.sign(null, Buffer.from(body, 'ascii'), privateKey);
  return body + '.' + b64u(signature);
}

export function verifyLicenseToken(token, publicKey, now = Date.now()) {
  if (!publicKey) return { error: 'LICENSE_ISSUER_UNCONFIGURED', status: 503 };
  if (typeof token !== 'string' || token.length < 40 || token.length > 12_000)
    return { error: 'INVALID_LICENSE', status: 400 };
  const parts = token.split('.');
  if (parts.length !== 2 || !TOKEN_SEGMENT.test(parts[0]) || !TOKEN_SEGMENT.test(parts[1]))
    return { error: 'INVALID_LICENSE', status: 400 };

  let validSignature = false;
  try {
    validSignature = crypto.verify(
      null,
      Buffer.from(parts[0], 'ascii'),
      publicKey,
      Buffer.from(parts[1], 'base64url')
    );
  } catch { validSignature = false; }
  if (!validSignature) return { error: 'INVALID_LICENSE', status: 400 };

  let claims;
  try { claims = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); }
  catch { return { error: 'INVALID_LICENSE', status: 400 }; }
  const error = validateLicenseClaims(claims, now);
  if (error) return { error, status: error === 'EXPIRED' ? 403 : 400 };
  return { ok: true, claims };
}

export function tokenFromLicenseFile(value) {
  let file = value;
  if (typeof file === 'string') {
    try { file = JSON.parse(file); }
    catch { return null; }
  }
  if (!file || typeof file !== 'object' || Array.isArray(file) ||
      file.format !== LICENSE_FILE_FORMAT || file.version !== LICENSE_VERSION ||
      typeof file.token !== 'string') return null;
  return file.token;
}
