import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createStudentAuthRuntime } from '../server/student-auth-runtime.mjs';
import { createStudentAuthMemoryRepository } from './helpers/student-auth-memory-repository.mjs';

const EMAIL = '202600000001@univ-constantine3.dz';
const SECRET = Buffer.alloc(32, 0x22);

describe('configuration du service d’authentification étudiante', () => {
  test('l’authentification n’est pas activée implicitement', () => {
    const runtime = createStudentAuthRuntime({ env: {} });
    assert.equal(runtime.required, false);
    assert.equal(runtime.ready, true);
  });

  test('si elle est requise mais non configurée, le runtime échoue fermé', () => {
    const runtime = createStudentAuthRuntime({ env: { FM_STUDENT_AUTH: 'required' } });
    assert.equal(runtime.required, true);
    assert.equal(runtime.ready, false);
    assert.ok(runtime.missing.includes('FM_AUTH_DATABASE_URL'));
    assert.ok(runtime.missing.includes('FM_AUTH_OTP_KEY'));
    assert.ok(runtime.missing.includes('FM_AUTH_SMTP_HOST'));
  });

  test('les dépendances de test injectées rendent le service prêt sans réseau ni secrets réels', () => {
    const runtime = createStudentAuthRuntime({
      mode: 'vercel',
      env: { FM_STUDENT_AUTH: 'required' },
      dependencies: {
        repository: createStudentAuthMemoryRepository({ whitelist: [EMAIL] }),
        sendOtpEmail: async () => {},
        otpSecret: SECRET
      }
    });
    assert.equal(runtime.required, true);
    assert.equal(runtime.ready, true);
    assert.equal(runtime.disabled, false);
  });
});
