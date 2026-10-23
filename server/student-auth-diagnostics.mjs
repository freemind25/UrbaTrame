/* Diagnostics de connexion pour l'authentification étudiante.
   Volontairement indépendant de pg : ni pool, ni import du driver, afin que
   la couche HTTP puisse classifier une erreur sans dépendre de PostgreSQL.
   Aucune valeur sensible n'y figure : ni URL, ni identifiants, ni message
   complet — seulement l'étape en cause et le code (SQLSTATE ou errno). */

const TLS_CODES = new Set([
  'EPROTO',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'CERT_HAS_EXPIRED',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'HOSTNAME_MISMATCH'
]);

/* Renvoie { stage, code } : dns, tcp, tls, auth, privilege, database,
   capacity, connection, query — et le code observé, tronqué et assaini. */
export function classifyDatabaseError(error) {
  const raw = String(error?.code || error?.cause?.code || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 32);
  const code = raw.toUpperCase();
  const message = String(error?.message || error?.cause?.message || '');

  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return { stage: 'dns', code };
  if (['ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNRESET', 'EPIPE'].includes(code))
    return { stage: 'tcp', code };
  if (code === 'CONNECT_TIMEOUT' || /timeout exceeded when trying to connect/i.test(message))
    return { stage: 'tcp', code: 'CONNECT_TIMEOUT' };
  if (code.startsWith('ERR_SSL') || TLS_CODES.has(code) || /self.signed|certificate|handshake.*tls|tls.*handshake/i.test(message))
    return { stage: 'tls', code: code || 'TLS_ERROR' };
  if (code.startsWith('28')) return { stage: 'auth', code };
  if (code === '42501') return { stage: 'privilege', code };
  if (code.startsWith('3D')) return { stage: 'database', code };
  if (code === '53300') return { stage: 'capacity', code };
  if (code.startsWith('08')) return { stage: 'connection', code };
  return { stage: 'query', code: code || 'UNKNOWN' };
}

/* Sonde légère : un SELECT 1, borné dans le temps. Renvoie toujours un
   résultat exploitable, jamais une exception. */
export async function probeDatabase(pool, { timeoutMs = 4_000 } = {}) {
  const started = Date.now();
  let timer = null;
  try {
    const timeout = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        const error = new Error('timeout exceeded when trying to connect');
        error.code = 'CONNECT_TIMEOUT';
        reject(error);
      }, timeoutMs);
    });
    await Promise.race([pool.query('SELECT 1 AS disponibilite'), timeout]);
    return { ok: true, latencyMs: Date.now() - started, stage: 'ready', code: null };
  } catch (error) {
    const { stage, code } = classifyDatabaseError(error);
    return { ok: false, latencyMs: Date.now() - started, stage, code };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
