import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function filesBelow(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(full) : [path.relative(path.join(ROOT, 'api'), full).replaceAll(path.sep, '/')];
  }).sort();
}

function response() {
  return {
    statusCode: 200, headers: {}, body: '',
    setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
    writeHead(status, headers) {
      this.statusCode = status;
      for (const [key, value] of Object.entries(headers || {})) this.setHeader(key, value);
    },
    end(body = '') { this.body = body; },
    get json() { try { return JSON.parse(String(this.body)); } catch { return null; } }
  };
}

function request(method, url, body = undefined, headers = {}) {
  return {
    method, url, ...(body === undefined ? {} : { body }),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.10', ...headers },
    socket: { remoteAddress: '203.0.113.10' }
  };
}

process.env.FM_STUDENT_AUTH = 'off';
let handler;
before(async () => {
  handler = (await import('../api/index.js')).default;
});

describe('consolidation des fonctions Vercel', () => {
  test('un seul fichier déployable, avec les deux rewrites nécessaires', () => {
    assert.deepEqual(filesBelow(path.join(ROOT, 'api')), ['index.js']);
    const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
    assert.deepEqual(Object.keys(config.functions), ['api/index.js']);
    assert.equal(config.functions['api/index.js'].maxDuration, 60);
    assert.ok(config.rewrites.some(route => route.source === '/api/(.*)' && route.destination === '/api?__path=/$1'));
    assert.ok(config.rewrites.some(route => route.source === '/analysis/2d' && route.destination === '/api?__path=/analysis/2d'));
    assert.equal(config.rewrites.some(route => route.destination === 'server/api.mjs'), false);
  });

  test('le chemin capturé par Vercel est restauré pour le statut et les analyses', async () => {
    const status = response();
    await handler(request('GET', '/api?__path=%2Fstatus'), status);
    assert.equal(status.statusCode, 200);
    assert.equal(status.json.ok, true);

    const analysis = response();
    await handler(request('POST', '/api?__path=%2Fanalysis%2F2d', {
      action: 'check', device: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    }), analysis);
    assert.equal(analysis.statusCode, 200);
    assert.equal(analysis.json.tier, 'free');
  });

  test('les paramètres d’origine survivent au rewrite imbriqué', async () => {
    const res = response();
    await handler(request('GET', '/api?__path=%2Fatelier%2Fgadm&country=..%2FDZA&level=1'), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.json.error, 'INVALID_COUNTRY');
  });

  test('le rewrite transmet CodeCraft au gestionnaire existant sans toucher à son implémentation', async () => {
    const previousKey = process.env.CODECRAFT_API_KEY;
    const previousFetch = globalThis.fetch;
    const calls = [];
    process.env.CODECRAFT_API_KEY = 'test-only-key';
    globalThis.fetch = async (url, options) => {
      calls.push({ url: String(url), options });
      return { ok: true, status: 200, json: async () => ({ id: 'local-test' }) };
    };
    try {
      const form = new URLSearchParams({ action: 'codecraft', model: 'test-model', prompt: 'test prompt' }).toString();
      const res = response();
      await handler(request('POST', '/api?__path=%2Futil%2Fcodecraft', form, {
        'content-type': 'application/x-www-form-urlencoded'
      }), res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.json.ok, true);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, 'https://codecraftapi.com/v1/chat/completions');
      assert.equal(calls[0].options.headers.Authorization, 'Bearer test-only-key');
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) delete process.env.CODECRAFT_API_KEY;
      else process.env.CODECRAFT_API_KEY = previousKey;
    }
  });
});
