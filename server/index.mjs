/* Point d'entrée du serveur.
   ─────────────────────────────────────────────────────────────────────────
     node server/index.mjs [--port 4173] [--host 0.0.0.0] [--data-dir data]
   ou, par variables d'environnement : PORT, FM_HOST, FM_DATA_DIR,
   FM_PUBLIC_DIR.
   ─────────────────────────────────────────────────────────────────────────
   Importable : `createApp()` renvoie un serveur HTTP non démarré, ce qui
   permet aux bancs d'essai de le lancer sur un port éphémère.               */
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PRODUCT, PUBLIC_DIR, DATA_DIR, DEFAULT_PORT, DEFAULT_HOST, accessMode
} from './config.mjs';
import { log } from './http.mjs';
import { createRuntime } from './runtime.mjs';
import { createApi } from './api.mjs';
import { VERSION } from '../public/js/plan-2d.mjs';

export function createApp({
  publicDir = PUBLIC_DIR,
  dataDir = DATA_DIR,
  cooldownMs,
  studentAuthOptions = {}
} = {}) {
  /* `typeof` et non un test de véracité : 0 est une valeur légitime (tests). */
  const runtime = createRuntime({ mode: 'node', dataDir, cooldownMs, studentAuthOptions });
  const licence = runtime.licence, quota = runtime.quota, runs = runtime.runs;
  const api = createApi({ licence, quota, runs, publicDir, studentAuth: runtime.studentAuth });

  const server = http.createServer((req, res) => {
    api(req, res).catch(e => {
      log('erreur non traitée', e?.message);
      try { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end('{"error":"INTERNAL"}'); }
      catch { /* réponse déjà envoyée */ }
    });
  });

  return { server, licence, quota, runs, runtime, publicDir, dataDir };
}

/* Petite ligne de journal : dit d'un coup d'œil si les licences sont actives. */
function stateLine(licence) {
  return licence.disabled
    ? 'licences inactives : essai gratuit seulement (aucune clé de signature)'
    : 'licences actives · clé publique ' + licence.pubB64;
}

/* ── exécution directe ── */
const isMain = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const arg = name => {
    const i = process.argv.indexOf('--' + name);
    return i > -1 ? process.argv[i + 1] : undefined;
  };
  const port = Number(arg('port') || DEFAULT_PORT);
  const host = arg('host') || DEFAULT_HOST;
  const dataDir = arg('data-dir') || DATA_DIR;

  const { server, licence, runtime } = createApp({ dataDir });
  server.listen(port, host, () => {
    log(`${PRODUCT} v${VERSION} · serveur prêt sur http://${host}:${port}`);
    log(`dossier public  : ${PUBLIC_DIR}`);
    log(`dossier données : ${dataDir}`);
    log(`état      : ${stateLine(licence)}`);
    log(accessMode() === 'open'
      ? 'accès     : libre — toutes les analyses, sans licence ni quota (FM_ACCESS=licence pour rétablir les paliers)'
      : 'accès     : sous licence — 5 analyses gratuites, Pro/Max sur licence signée ou code historique');
    log(runtime.studentAuth.required
      ? `auth étudiants : requise · ${runtime.studentAuth.ready ? 'prête' : 'configuration incomplète (routes protégées en 503)'}`
      : 'auth étudiants : désactivée (FM_STUDENT_AUTH=required pour l’activer après validation)');
  });
  for (const sig of ['SIGINT', 'SIGTERM'])
    process.on(sig, () => { log('arrêt'); server.close(() => process.exit(0)); });
}
