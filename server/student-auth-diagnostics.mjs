/* Diagnostics de connexion pour l'authentification étudiante.
   Volontairement indépendant de pg : ni pool, ni import du driver, afin que
   la couche HTTP puisse classifier une erreur sans dépendre de PostgreSQL.
   Aucune valeur sensible n'y figure : ni URL, ni identifiants, ni message
   complet — seulement l'étape en cause et le code (SQLSTATE, errno, jeton
   dérivé d'un vocabulaire fermé, ou UNKNOWN_<classe> en dernier recours). */

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

const MAX_CAUSE_DEPTH = 4;

/* Parcourt la chaîne `cause` (bornée) : les erreurs enchaînées portent parfois
   le code un niveau plus bas. Le message sert uniquement à classer — il n'est
   jamais renvoyé (il peut contenir un certificat ou des identifiants). */
function describeError(error) {
  let code = '';
  let message = '';
  let name = '';
  let current = error;
  for (let depth = 0; current && depth < MAX_CAUSE_DEPTH; depth += 1, current = current.cause) {
    if (!code) code = String(current.code || '');
    if (!message) message = String(current.message || '');
    if (!name) name = String(current.name || '');
  }
  return {
    code: code.replace(/[^A-Za-z0-9_]/g, '').slice(0, 32).toUpperCase(),
    message,
    type: name.replace(/[^A-Za-z]/g, '').slice(0, 24) || 'Error'
  };
}

/* Échecs sans SQLSTATE ni errno — typiquement les erreurs client levées par
   le driver pendant l'échange SCRAM ou pendant l'amorçage de la connexion.
   Jetons fixes (jamais le message lui-même) pour que l'aperçu suffise à
   isoler la cause : mot de passe absent de l'URL, channel binding, serveur
   qui ferme la connexion, etc. */
function classifyMessage(message) {
  if (/client password must be/i.test(message)) return { stage: 'auth', code: 'SASL_PASSWORD_MISSING' };
  if (/^SASL channel binding/i.test(message)) return { stage: 'auth', code: 'SASL_CHANNEL_BINDING' };
  if (/SASL: Only mechanism/i.test(message)) return { stage: 'auth', code: 'SASL_MECHANISM' };
  if (/server signature does not match/i.test(message)) return { stage: 'auth', code: 'SASL_SIGNATURE' };
  if (/\bSASL\b|\bSCRAM\b/i.test(message)) return { stage: 'auth', code: 'SASL_ERROR' };
  if (/password authentication failed|authentication failed/i.test(message)) return { stage: 'auth', code: 'AUTH_FAILED' };
  if (/connection terminated|connection ended/i.test(message)) return { stage: 'connection', code: 'CONNECTION_TERMINATED' };
  if (/Client has encountered a connection error/i.test(message)) return { stage: 'connection', code: 'CLIENT_ERROR' };
  if (/\bssl\b|\btls\b|self.signed|certificate|handshake/i.test(message)) return { stage: 'tls', code: 'TLS_ERROR' };
  return null;
}

/* Renvoie { stage, code } : dns, tcp, tls, auth, privilege, database,
   capacity, connection, query — et le code observé, tronqué et assaini.
   Sans code exploitable, un jeton du vocabulaire fermé; en tout dernier
   recours UNKNOWN, ou UNKNOWN_<classe> si la classe d'erreur apporte une
   information (TypeError, AbortError, AggregateError, …). */
export function classifyDatabaseError(error) {
  const { code, message, type } = describeError(error);

  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return { stage: 'dns', code };
  if (['ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNRESET', 'EPIPE'].includes(code))
    return { stage: 'tcp', code };
  if (code === 'CONNECT_TIMEOUT' || /timeout exceeded when trying to connect/i.test(message))
    return { stage: 'tcp', code: 'CONNECT_TIMEOUT' };
  if (code.startsWith('ERR_SSL') || TLS_CODES.has(code))
    return { stage: 'tls', code: code || 'TLS_ERROR' };
  if (code.startsWith('28')) return { stage: 'auth', code };
  if (code === '42501') return { stage: 'privilege', code };
  if (code.startsWith('3D')) return { stage: 'database', code };
  if (code === '53300') return { stage: 'capacity', code };
  if (code.startsWith('08')) return { stage: 'connection', code };
  if (code) return { stage: 'query', code };

  const byMessage = classifyMessage(message);
  if (byMessage) return byMessage;
  return { stage: 'query', code: type === 'Error' ? 'UNKNOWN' : 'UNKNOWN_' + type.toUpperCase() };
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
