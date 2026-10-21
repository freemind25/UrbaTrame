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

  test('le navigateur utilise une session cookie HttpOnly, pas un jeton en localStorage', () => {
    const ui = read('public/js/student-auth-ui.mjs');
    assert.match(ui, /credentials: 'same-origin'/);
    assert.match(ui, /\/api\/auth\/request-otp/);
    assert.match(ui, /\/api\/auth\/verify-otp/);
    assert.match(ui, /\/api\/auth\/logout/);
    assert.doesNotMatch(ui, /localStorage|sessionStorage|sessionToken/);
  });

  test('le mode étudiant bloque le repli Overpass direct et attribue le niveau Max', () => {
    const app = read('public/js/app.js');
    assert.match(app, /studentAuthRequired/);
    assert.match(app, /S\.studentUser \? 'max' : 'free'/);
    assert.match(app, /if \(S\.studentAuthRequired\) throw new Error\('STUDENT_AUTH_REQUIRED'\)/);
    assert.match(app, /if \(S\.studentAuthRequired\) \{\s*if \(code === 'STUDENT_AUTH_REQUIRED'\)/);
  });

  test('les fonctions Vercel des API de l’application vérifient la session', () => {
    for (const file of [
      'api/analysis/2d.js', 'api/util.js',
      'api/atelier/health.js', 'api/atelier/geocode.js', 'api/atelier/extract.js',
      'api/atelier/cadrage-extract.js', 'api/atelier/gadm.js'
    ]) assert.match(read(file), /requireStudentSession/, file);
    assert.doesNotMatch(read('api/status.js'), /requireStudentSession/);
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
