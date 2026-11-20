import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAxoAiHandler, AXO_AI_PROVIDERS } from '../server/axo-ai.mjs';
import { buildAxoAiContext } from '../public/js/axo-ai.mjs';

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

test('dix fournisseurs : URL fixes et distinctes, aucune redirection ni fuite de clé', async () => {
  const expected = {
    openrouter:'https://openrouter.ai/api/v1/chat/completions', agnes:'https://apihub.agnes-ai.com/v1/chat/completions',
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
