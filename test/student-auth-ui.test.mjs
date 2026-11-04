import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../tools/kernel.mjs';

const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

describe('garde d’accès étudiant — interface et routes', () => {
  test('la connexion partagée est chargée sur les pages d’application UrbaTrame', () => {
    for (const file of [
      'public/index.html', 'public/atelier.html', 'public/atelier-analyse.html',
      'public/atelier-cartographique.html', 'public/atelier-s5.html', 'public/cadrage-spatial.html'
    ]) assert.match(read(file), /student-auth-ui\.mjs/, file);
  });

  test('la session authentifiée reste dans le bandeau et ne recouvre pas les liens de navigation', () => {
    const ui = read('public/js/student-auth-ui.mjs');
    assert.match(ui, /header\.classList\.add\('ut-auth-header'\);\s*header\.append\(badge\)/);
    assert.match(ui, /\.ut-auth-header\{height:auto!important;flex-wrap:wrap!important\}/);
    assert.match(ui, /\.ut-student-user\{position:static/);
    assert.match(ui, /@media\(max-width:900px\)\{\.ut-auth-header>nav\{order:3;flex:1 0 100%/);
    assert.doesNotMatch(ui, /\.ut-student-user\{position:fixed/);
  });

  test('le navigateur utilise une session cookie HttpOnly, pas un jeton en localStorage', () => {
    const ui = read('public/js/student-auth-ui.mjs');
    assert.match(ui, /credentials: 'same-origin'/);
    assert.match(ui, /\/api\/auth\/request-otp/);
    assert.match(ui, /\/api\/auth\/verify-otp/);
    assert.match(ui, /\/api\/auth\/logout/);
    assert.doesNotMatch(ui, /localStorage|sessionStorage|sessionToken/);
  });

  test('l’accès propriétaire est séparé et utilise un POST mot de passe, sans changer le parcours OTP étudiant', () => {
    const ui = read('public/js/student-auth-ui.mjs');
    const api = read('server/api.mjs');
    assert.match(ui, /ownerLoginReady/);
    assert.match(ui, /Mot de passe propriétaire/);
    assert.match(ui, /\/api\/auth\/session/);
    assert.match(ui, /body: JSON\.stringify\(\{ password: ownerInput\.value \}\)/);
    assert.match(api, /url\.pathname === '\/api\/auth\/session'[\s\S]*?req\.method === 'POST'[\s\S]*?authHandlers\.ownerLogin\(req, res, ip\)/);
    assert.match(api, /const ip = clientIp\(req\)/);
  });

  test('l’erreur de vérification peut afficher uniquement le diagnostic assaini fourni en Preview', () => {
    const ui = read('public/js/student-auth-ui.mjs');
    assert.match(ui, /error\.debug = result\.debug/);
    assert.match(ui, /error\.debug\?\.stage/);
    assert.match(ui, /error\.debug\?\.code/);
    assert.doesNotMatch(ui, /error\.debug\?\.message/);
  });

  test('les sessions propriétaire utilisent les miroirs publics et les étudiants restent sur le serveur', () => {
    const app = read('public/js/app.js');
    assert.match(app, /studentAuthRequired/);
    assert.match(app, /S\.studentUser \? 'max' : 'free'/);
    assert.match(app, /const ownerSession = S\.studentUser\?\.isOwner === true && S\.studentUser\?\.role === 'admin'/);
    assert.match(app, /run = b\.run;[\s\S]*?useServer = !ownerSession && \(S\.studentAuthRequired \|\| isOpenAccess\(\) \|\| !freeRun\);/);
    assert.match(app, /if \(S\.studentAuthRequired && !ownerSession\) throw new Error\('STUDENT_AUTH_REQUIRED'\)/);
    assert.match(app, /if \(!ownerSession \|\| !run\) throw e/);
    assert.match(app, /relais serveur protégé/);
    assert.match(app, /if \(S\.studentAuthRequired\) \{\s*if \(code === 'STUDENT_AUTH_REQUIRED'\)/);
  });

  test('les appels géocodage et analyse transmettent le cookie same-origin', () => {
    const routes = read('public/js/routes.mjs');
    assert.match(routes, /fetch\(this\.base \+ '\/analysis\/2d',[\s\S]*?credentials: 'same-origin'/);
    assert.match(routes, /fetch\(this\.base \+ '\/api\/util',[\s\S]*?credentials: 'same-origin'/);
  });

  test('le routeur Vercel unifié protège les API sensibles sans protéger le statut public', () => {
    const api = read('server/api.mjs');
    const protectedPaths = api.match(/const protectedPaths = new Set\(\[([\s\S]*?)\]\);/)?.[1] || '';
    for (const route of [
      '/analysis/2d', '/api/util',
      '/api/atelier/health', '/api/atelier/geocode', '/api/atelier/extract',
      '/api/atelier/cadrage-extract', '/api/atelier/gadm'
    ]) assert.ok(protectedPaths.includes(`'${route}'`), `${route} reste protégé`);
    assert.match(api, /requireStudentSession\(req, res, studentAuth\)/);
    assert.doesNotMatch(protectedPaths, /\/api\/status/);
    assert.match(read('api/index.js'), /createApi\(\{/);
  });

  test('la migration stocke un HMAC et non un code OTP en clair; l’admin DB ne figure pas dans les exemples', () => {
    const sql = read('db/migrations/001_student_auth.sql');
    assert.match(sql, /code_mac\s+text/);
    assert.match(sql, /attempts_count/);
    assert.match(sql, /is_active\s+boolean/);
    assert.doesNotMatch(sql, /\bcode\s+integer\b/i);
    assert.doesNotMatch(read('.env.example'), /FM_AUTH_ADMIN_DATABASE_URL/);
  });
});
