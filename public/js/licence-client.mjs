/* Vérification navigateur des fichiers .utlic avec WebCrypto.
   Aucune clé privée ni dépendance serveur n’est chargée dans ce module. */
function bytesFromBase64Url(value) {
  let base64 = String(value).replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  const binary = atob(base64);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

export async function verifyIssuedLicenseToken(token, publicKey, now = Date.now(), subtle = globalThis.crypto?.subtle) {
  if (!token || !publicKey || !subtle) return null;
  try {
    const parts = String(token).split('.');
    if (parts.length !== 2 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) return null;
    const valid = await subtle.verify(
      'Ed25519', publicKey, bytesFromBase64Url(parts[1]), new TextEncoder().encode(parts[0]));
    if (!valid) return null;
    const claims = JSON.parse(new TextDecoder().decode(bytesFromBase64Url(parts[0])));
    const expectedKeys = ['expiresAt', 'issuedAt', 'licenseId', 'product', 'tier', 'v'].sort().join('|');
    if (!claims || typeof claims !== 'object' || Array.isArray(claims) ||
        Object.keys(claims).sort().join('|') !== expectedKeys ||
        claims.v !== 1 || claims.product !== 'UrbaTrame' ||
        !/^UTL-[0-9A-F]{16}$/.test(claims.licenseId) ||
        !['pro', 'max'].includes(claims.tier) ||
        !Number.isSafeInteger(claims.issuedAt) || claims.issuedAt <= 0 ||
        claims.issuedAt > now + 5 * 60_000 ||
        (claims.expiresAt !== null &&
          (!Number.isSafeInteger(claims.expiresAt) || claims.expiresAt <= claims.issuedAt || claims.expiresAt <= now)))
      return null;
    return claims;
  } catch { return null; }
}
