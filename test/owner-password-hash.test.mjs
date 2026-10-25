import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = path.resolve('tools/owner-password-hash.mjs');

describe('outil local de vérification du mot de passe propriétaire', () => {
  test('crée uniquement un vérificateur scrypt, accepte un saut de ligne final et refuse l’écrasement', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-password-hash-'));
    const input = path.join(dir, 'secret.txt');
    const output = path.join(dir, 'verifier.txt');
    const password = 'synthetic-owner-password-for-unit-test';
    try {
      fs.writeFileSync(input, `${password}\n`, { mode: 0o600 });
      const result = spawnSync(process.execPath, [SCRIPT, input, output], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.doesNotMatch(result.stdout + result.stderr, new RegExp(password));
      const verifier = fs.readFileSync(output, 'utf8').trim();
      assert.match(verifier, /^scrypt\$16384\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
      const [, , , , salt, hash] = verifier.split('$');
      const derived = crypto.scryptSync(password, Buffer.from(salt, 'base64url'), 32, {
        N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024
      });
      assert.equal(derived.toString('base64url'), hash);

      const second = spawnSync(process.execPath, [SCRIPT, input, output], { encoding: 'utf8' });
      assert.equal(second.status, 2);
      assert.doesNotMatch(second.stdout + second.stderr, new RegExp(password));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('refuse un secret trop court et les fichiers à plusieurs lignes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-password-hash-invalid-'));
    const input = path.join(dir, 'secret.txt');
    const output = path.join(dir, 'verifier.txt');
    try {
      fs.writeFileSync(input, 'too-short');
      let result = spawnSync(process.execPath, [SCRIPT, input, output], { encoding: 'utf8' });
      assert.equal(result.status, 2);
      assert.equal(fs.existsSync(output), false);

      fs.writeFileSync(input, 'a-valid-looking-password-line\nsecond-line');
      result = spawnSync(process.execPath, [SCRIPT, input, output], { encoding: 'utf8' });
      assert.equal(result.status, 2);
      assert.equal(fs.existsSync(output), false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
