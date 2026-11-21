import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAxoAiHandler, createAxoKeyTestHandler, AXO_AI_PROVIDERS, AXO_KEY_ENDPOINTS } from '../server/axo-ai.mjs';
import { buildAxoAiContext } from '../public/js/axo-ai.mjs';
import { AXO_PROVIDERS } from '../public/js/axo-ai-providers.mjs';

function response() {
  return { status: 0, headers: null, data: null,
    writeHead(status, headers) { this.status=status; this.headers=headers; },
    end(data) { this.data=JSON.parse(data); } };
}
const request = (body, key='private-fake-test-key') => ({
  headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
  body
});
const ctx = { site:{ name:'Test',lat:1,lon:2,R:500,shape:'circle' }, buckets:{ build:[{}],roads:[{},{}],green:[],pois:[],rail:[] } };

test('résumé de site limité : sans géométries, nécessite des données à jour', () => {
  const result=buildAxoAiContext(ctx,'Observation');
  assert.deepEqual(result.comptages,{batiments:1,voies:2,zones_occupation_vert_eau:0,points_interet:0,voies_ferrees:0});
  assert.equal(result.observations_utilisateur,'Observation');
  assert.doesNotMatch(JSON.stringify(result), /geometry|\"g\":/);
  assert.throws(()=>buildAxoAiContext({...ctx,stale:true}),/changé/);
  assert.throws(()=>buildAxoAiContext(null),/Chargez/);
});

test('exemples de modèles distincts par fournisseur et documentation HTTPS', () => {
  assert.ok(AXO_PROVIDERS.openrouter.models.includes('openrouter/free'));
  assert.ok(AXO_PROVIDERS.openrouter.models.includes('nvidia/nemotron-3-ultra-550b-a55b:free'));
  assert.ok(AXO_PROVIDERS.groq.models.includes('openai/gpt-oss-20b'));
  assert.deepEqual(AXO_PROVIDERS.kira.models, ['kira-2.5-flash','kira-2.5-pro']);
  assert.ok(AXO_PROVIDERS.mistral.models.includes('labs-mistral-small-creative'));
  assert.ok(AXO_PROVIDERS.mistral.models.includes('ministral-3b-latest'));
  assert.ok(AXO_PROVIDERS.mistral.models.includes('voxtral-small-latest'));
  for (const provider of Object.values(AXO_PROVIDERS)) {
    assert.ok(provider.models.length > 0);
    assert.equal(new URL(provider.catalog).protocol,'https:');
    assert.ok(Object.isFrozen(provider.models));
    for (const id of provider.models) assert.match(id,/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/);
  }
  assert.ok(!AXO_PROVIDERS.mistral.models.includes('agnes-2.5-flash'));
  assert.ok(!AXO_PROVIDERS.kira.models.includes('gemma-2-2b'));
});

test('onze fournisseurs : URL fixes et distinctes, aucune redirection ni fuite de clé', async () => {
  const expected = {
    openrouter:'https://openrouter.ai/api/v1/chat/completions', groq:'https://api.groq.com/openai/v1/chat/completions', agnes:'https://apihub.agnes-ai.com/v1/chat/completions',
    mistral:'https://api.mistral.ai/v1/chat/completions', codecraft:'https://codecraftapi.com/v1/chat/completions',
    zai:'https://api.z.ai/api/paas/v4/chat/completions', agentrouter:'https://agentrouter.org/v1/chat/completions',
    gemini:'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    kira:'https://kiraai.vn/api/v1/chat/completions', apinex:'https://api.apinex.bond/v1/chat/completions',
    routesme:'https://routesme.online/v1/chat/completions'
  };
  assert.deepEqual(AXO_AI_PROVIDERS, expected);
  for (const provider of Object.keys(expected)) {
    let called=0;
    const h=createAxoAiHandler({cooldownMs:0,fetchImpl:async (url,options)=>{
      called++; assert.equal(url,AXO_AI_PROVIDERS[provider]);
      assert.equal(options.redirect,'error');
      assert.equal(options.headers.Authorization,'Bearer private-fake-test-key');
      const body=JSON.parse(options.body);
      assert.equal(body.model,'test/model');
      assert.equal(body.max_tokens,800);
      assert.match(body.messages[0].content,/pas une carte exhaustive/);
      assert.doesNotMatch(options.body,/private-fake-test-key/);
      return new Response(JSON.stringify({choices:[{message:{content:'Hypothèse à vérifier'}}]}),{status:200});
    }});
    const res=response();
    await h(request({provider,model:'test/model',context:buildAxoAiContext(ctx)}),res,'1.2.3.4');
    assert.equal(called,1); assert.equal(res.status,200); assert.equal(res.data.text,'Hypothèse à vérifier');
    assert.doesNotMatch(JSON.stringify(res.data),/private-fake-test-key/);
    assert.equal(res.headers['Cache-Control'],'no-store');
  }
});

test('routeur gratuit OpenRouter et modèle Groq : identifiants exacts, sans bascule payante', async () => {
  for (const [provider,model] of [
    ['openrouter','openrouter/free'],
    ['openrouter','nvidia/nemotron-3-ultra-550b-a55b:free'],
    ['groq','openai/gpt-oss-20b'],
    ['mistral','voxtral-small-latest'],
    ['gemini','gemini-2.5-flash']
  ]) {
    let payload;
    const handler=createAxoAiHandler({cooldownMs:0,fetchImpl:async (url,opts)=>{
      assert.equal(url,AXO_AI_PROVIDERS[provider]);
      assert.equal(opts.redirect,'error');
      payload=JSON.parse(opts.body);
      return new Response(JSON.stringify({choices:[{message:{content:'Essai simulé'}}]}));
    }});
    const res=response();
    await handler(request({provider,model,context:buildAxoAiContext(ctx)}),res,'x');
    assert.equal(res.status,200);
    assert.equal(payload.model,model);
    assert.equal(Object.hasOwn(payload,'models'),false);
    assert.equal(Object.hasOwn(payload,'provider'),false);
    assert.equal(res.data.model,model);
  }
});

test('le relais refuse les fournisseurs et modèles invalides, les clés absentes et les corps trop grands', async () => {
  const h=createAxoAiHandler({fetchImpl:()=>{throw new Error('Doit rester hors réseau')}});
  for (const [body,key,expected] of [
    [{provider:'http://127.0.0.1',model:'a',context:{}},'x','INVALID_PROVIDER'],
    [{provider:'__proto__',model:'a',context:{}},'x','INVALID_PROVIDER'],
    [{provider:'routeme',model:'a',context:{}},'x','INVALID_PROVIDER'],
    [{provider:'agnes',model:'http://example.org',context:{}},'x','INVALID_MODEL'],
    [{provider:'agnes',model:'a',context:{}},'','API_KEY_REQUIRED'],
    [{provider:'agnes',model:'a',context:{long:'x'.repeat(25_000)}},'x','INVALID_BODY']
  ]) {
    const res=response(); await h(request(body,key),res,'x'); assert.equal(res.data.error,expected);
  }
});

test('les erreurs amont ne répercutent pas la clé ou le contenu amont', async () => {
  const h=createAxoAiHandler({fetchImpl:async()=>new Response('private-fake-test-key secret', {status:401})});
  const res=response(); await h(request({provider:'agnes',model:'agnes-2.5-flash',context:{}}),res,'x');
  assert.equal(res.data.error,'UPSTREAM_ERROR'); assert.equal(res.data.upstreamStatus,401);
  assert.doesNotMatch(JSON.stringify(res.data),/private-fake-test-key|secret/);
});


test('test de clé : endpoints fixes, GET sans génération ni données de site et catalogue Mistral filtré', async () => {
  for (const provider of Object.keys(AXO_KEY_ENDPOINTS)) {
    const handler=createAxoKeyTestHandler({cooldownMs:0,fetchImpl:async (url,opts)=>{
      assert.equal(url,AXO_KEY_ENDPOINTS[provider]); assert.equal(opts.method,'GET');
      assert.equal(opts.redirect,'error'); assert.equal(opts.headers.Authorization,'Bearer private-fake-test-key');
      assert.equal(opts.body,undefined);
      return new Response(JSON.stringify(provider==='openrouter' ? {data:{label:'private-fake-test-key'}} : {data:[
        {id:'chat',capabilities:{completion_chat:true}}, {id:'nonchat',capabilities:{completion_chat:false}},
        {id:'unknown'}, {id:'archived',archived:true,capabilities:{completion_chat:true}},
        {id:'chat',capabilities:{completion_chat:true}}, {id:'private-fake-test-key',capabilities:{completion_chat:true}}
      ]}));
    }});
    const res=response(); await handler(request({provider}),res,'x');
    assert.equal(res.status,200); assert.equal(res.headers['Cache-Control'],'no-store');
    assert.doesNotMatch(JSON.stringify(res.data),/private-fake-test-key/);
    if(provider==='mistral') assert.deepEqual(res.data.models,['chat']);
    if(provider==='openrouter') assert.equal(res.data.models,null);
    if(provider==='groq') assert.deepEqual(res.data.models,['chat','unknown']);
  }
});

test('test de clé : refuse accès arbitraire, clés absentes, gros corps et erreurs amont sans fuite', async () => {
  const handler=createAxoKeyTestHandler({cooldownMs:0,fetchImpl:async()=>new Response('private-fake-test-key secret',{status:401})});
  for (const [body,key,error] of [
    [{provider:'__proto__'},'x','TEST_UNSUPPORTED'],[{provider:'kira'},'x','TEST_UNSUPPORTED'],
    [{provider:'mistral'},'','API_KEY_REQUIRED'],[{provider:'mistral',long:'x'.repeat(3000)},'x','INVALID_BODY']
  ]) {const res=response();await handler(request(body,key),res,'x');assert.equal(res.data.error,error);}
  const res=response(); await handler(request({provider:'mistral'}),res,'x');
  assert.equal(res.data.error,'UPSTREAM_ERROR');assert.equal(res.data.upstreamStatus,401);
  assert.doesNotMatch(JSON.stringify(res.data),/private-fake-test-key|secret/);
});

test('test de clé : quotas, JSON et réponses trop grandes sont contrôlés', async () => {
  let done;const wait=new Promise(resolve=>done=resolve);
  const handler=createAxoKeyTestHandler({cooldownMs:10000,fetchImpl:async()=>{await wait;return new Response('{}')}});
  const first=response(),second=response(); const inflight=handler(request({provider:'groq'}),first,'ip');
  await new Promise(resolve=>setTimeout(resolve,0)); await handler(request({provider:'groq'}),second,'ip');
  assert.equal(second.data.error,'GENERATION_IN_PROGRESS');done();await inflight;assert.equal(first.data.error,'INVALID_RESPONSE');
  const large=createAxoKeyTestHandler({cooldownMs:0,fetchImpl:async()=>new Response('x'.repeat(2_000_001))});
  const res=response();await large(request({provider:'mistral'}),res,'ip');assert.equal(res.data.error,'UPSTREAM_UNAVAILABLE');
});
