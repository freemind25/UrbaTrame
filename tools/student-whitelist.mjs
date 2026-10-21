#!/usr/bin/env node
/* Outil local de gestion de la liste blanche. Aucune API web ne peut modifier
   cette liste. La chaîne de connexion d'administration reste sur l'ordinateur
   de la responsable; ne pas la définir dans Vercel. */
import fs from 'node:fs/promises';
import { createStudentAuthPool } from '../server/student-auth-postgres.mjs';
import { normalizeStudentEmail } from '../server/student-auth.mjs';

const HELP = `
Gestion privée de la liste blanche étudiante UrbaTrame

Prérequis : FM_AUTH_ADMIN_DATABASE_URL doit désigner le rôle PostgreSQL
administrateur conservé par la responsable et ne doit JAMAIS être configuré
sur Vercel. FM_AUTH_DB_SSL=false est réservé aux bases locales sans TLS.

Commandes :
  node tools/student-whitelist.mjs add <email>
  node tools/student-whitelist.mjs remove <email>
  node tools/student-whitelist.mjs list
  node tools/student-whitelist.mjs import <fichier.csv|txt>

L'import ajoute/réactive les adresses valides de la première colonne; il ne
retire jamais les adresses absentes du fichier. Le fichier n'est pas copié ni
ajouté au projet. Toutes les adresses sont normalisées en minuscules.
`;

const [command, ...args] = process.argv.slice(2);
if (!command || command === '--help' || command === '-h') {
  console.log(HELP.trim());
  process.exit(0);
}

const connectionString = process.env.FM_AUTH_ADMIN_DATABASE_URL;
if (!connectionString) {
  console.error('FM_AUTH_ADMIN_DATABASE_URL manquant. Aucun accès à la base effectué.');
  process.exit(2);
}

const pool = createStudentAuthPool({
  connectionString,
  max: 1,
  ssl: String(process.env.FM_AUTH_ADMIN_DB_SSL || process.env.FM_AUTH_DB_SSL || 'true').toLowerCase() !== 'false'
});

function requireEmail(input) {
  const email = normalizeStudentEmail(input);
  if (!email) throw new Error('ADRESSE_INVALIDE_OU_DOMAINE_NON_AUTORISE');
  return email;
}

async function setOne(email, active, action = null, client = pool) {
  const before = await client.query(
    'SELECT is_active FROM whitelisted_students WHERE email = $1 FOR UPDATE', [email]);
  const exists = before.rowCount > 0;
  const wasActive = Boolean(before.rows[0]?.is_active);
  if (active) {
    await client.query(
      `INSERT INTO whitelisted_students (email, is_active, created_by)
       VALUES ($1, TRUE, 'owner-cli')
       ON CONFLICT (email) DO UPDATE
       SET is_active = TRUE, updated_at = now(), deactivated_at = NULL`,
      [email]);
    if (exists) {
      await client.query('UPDATE student_users SET is_active = TRUE WHERE email = $1', [email]);
    }
    const event = action || (!exists ? 'add' : wasActive ? null : 'reactivate');
    if (event) await client.query(
      'INSERT INTO student_whitelist_audit (email, action, actor) VALUES ($1, $2, $3)',
      [email, event, 'owner-cli']);
    return !exists ? 'added' : wasActive ? 'already-active' : 'reactivated';
  }
  if (!exists || !wasActive) return !exists ? 'not-found' : 'already-inactive';
  const now = new Date();
  await client.query(
    `UPDATE whitelisted_students SET is_active = FALSE, updated_at = $2, deactivated_at = $2
     WHERE email = $1`, [email, now]);
  await client.query('UPDATE student_users SET is_active = FALSE WHERE email = $1', [email]);
  await client.query(
    `UPDATE otp_verifications SET invalidated_at = $2
     WHERE email = $1 AND consumed_at IS NULL AND invalidated_at IS NULL`, [email, now]);
  await client.query(
    `UPDATE student_sessions s SET revoked_at = $2
     FROM student_users u WHERE s.user_id = u.id AND u.email = $1 AND s.revoked_at IS NULL`,
    [email, now]);
  await client.query(
    'INSERT INTO student_whitelist_audit (email, action, actor) VALUES ($1, $2, $3)',
    [email, 'remove', 'owner-cli']);
  return 'removed';
}

async function changeOne(email, active) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await setOne(email, active, null, client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* transaction déjà terminée */ }
    throw error;
  } finally { client.release(); }
}

async function importEmails(filePath) {
  const file = await fs.readFile(filePath, 'utf8');
  const emails = new Set();
  const invalid = [];
  for (const [index, lineRaw] of file.replace(/^\uFEFF/, '').split(/\r?\n/).entries()) {
    const line = lineRaw.trim();
    if (!line || line.startsWith('#') || /^email\s*(,|;|$)/i.test(line)) continue;
    const first = line.split(/[;,\t]/, 1)[0].trim().replace(/^"|"$/g, '');
    const normalized = normalizeStudentEmail(first);
    if (normalized) emails.add(normalized);
    else invalid.push(index + 1);
  }
  if (invalid.length) throw new Error('IMPORT_EMAILS_INVALIDES_LIGNES_' + invalid.slice(0, 20).join('_'));
  if (!emails.size) throw new Error('IMPORT_SANS_ADRESSE');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let added = 0, reactivated = 0, unchanged = 0;
    for (const email of emails) {
      const result = await setOne(email, true, 'import', client);
      if (result === 'added') added++;
      else if (result === 'reactivated') reactivated++;
      else unchanged++;
    }
    await client.query('COMMIT');
    console.log(`Import terminé : ${added} ajoutée(s), ${reactivated} réactivée(s), ${unchanged} déjà active(s). Aucune adresse n'a été retirée.`);
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* transaction déjà terminée */ }
    throw error;
  } finally { client.release(); }
}

try {
  if (command === 'list') {
    if (args.length) throw new Error('ARGUMENTS_INATTENDUS');
    const result = await pool.query(
      'SELECT email, created_at, is_active FROM whitelisted_students WHERE is_active = TRUE ORDER BY email');
    for (const row of result.rows) console.log(row.email);
    console.log(`${result.rowCount} adresse(s) active(s).`);
  } else if (command === 'add') {
    if (args.length !== 1) throw new Error('USAGE: add <email>');
    const result = await changeOne(requireEmail(args[0]), true);
    console.log(result === 'already-active' ? 'Adresse déjà active.' : 'Adresse ajoutée/réactivée; le compte recevra automatiquement Max après OTP.');
  } else if (command === 'remove') {
    if (args.length !== 1) throw new Error('USAGE: remove <email>');
    const result = await changeOne(requireEmail(args[0]), false);
    console.log(result === 'removed' ? 'Adresse retirée; compte désactivé et sessions révoquées.' : 'Adresse absente ou déjà inactive.');
  } else if (command === 'import') {
    if (args.length !== 1) throw new Error('USAGE: import <fichier.csv|txt>');
    await importEmails(args[0]);
  } else {
    throw new Error('COMMANDE_INCONNUE');
  }
} catch (error) {
  console.error('Échec de gestion de la liste :', String(error?.message || 'ERROR').slice(0, 300));
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => {});
}
