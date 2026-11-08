import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateChatEndpoint, buildChatBody, SYSTEM_PROMPT, PROVIDERS } from '../public/js/chat-widget.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = ['index.html', 'atelier.html', 'atelier-analyse.html', 'atelier-cartographique.html', 'atelier-s5.html', 'bibliotheque-cartes.html', 'cadrage-spatial.html', 'cadrage-spatial-notice.html'];

describe('widget assistant IA flottant', () => {
  test('validation de l’endpoint (mot « chat » requis, base dérivée)', () => {
    assert.equal(validateChatEndpoint('http://localhost:3001/v1/chat/completions').ok, true);
    assert.equal(validateChatEndpoint('http://localhost:3001/v1/chat/completions').base, 'http://localhost:3001/v1');
    assert.equal(validateChatEndpoint('https://codecraftapi.com/v1/chat/completions').base, 'https://codecraftapi.com/v1');
    assert.equal(validateChatEndpoint('http://localhost:3001/v1').ok, false);
    assert.equal(validateChatEndpoint('').ok, false);
    assert.equal(validateChatEndpoint('ftp://x/chat/completions').ok, false);
  });

  test('buildChatBody : system UrbaTrame + historique conservé, stream off', () => {
    const b = buildChatBody({ model: 'agne-2.5-flash' }, [{ role: 'user', content: 'salut' }, { role: 'assistant', content: 'bonjour' }]);
    assert.equal(b.model, 'agne-2.5-flash');
    assert.equal(b.stream, false);
    assert.equal(b.messages[0].role, 'system');
    assert.equal(b.messages[0].content, SYSTEM_PROMPT);
    assert.deepEqual(b.messages.slice(1).map(m => m.role), ['user', 'assistant']);
  });

  test('fournisseurs proposés : FreeLLMAPI local par défaut + CodeCraft direct', () => {
    assert.equal(PROVIDERS.freellmapi.endpoint, 'http://localhost:3001/v1/chat/completions');
    assert.ok(PROVIDERS.codecraft.endpoint.includes('codecraftapi.com'));
  });

  test('le widget est injecté sur les 8 pages publiques', () => {
    for (const f of PAGES) {
      const html = fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
      assert.ok(html.includes('/js/chat-widget.mjs'), f + ' charge le widget');
    }
  });
});
