/* Répertoire partagé navigateur/serveur : URLs fixes uniquement. Les exemples
   d'identifiants ci-dessous sont indicatifs et ne garantissent ni accès ni prix. */
const entry=(label,endpoint,placeholder,routed,models,catalog)=>Object.freeze({label,endpoint,placeholder,routed,models:Object.freeze(models),catalog});
export const AXO_PROVIDERS = Object.freeze({
  openrouter: entry('OpenRouter','https://openrouter.ai/api/v1/chat/completions','openrouter/free',true,['openrouter/free','nvidia/nemotron-3-ultra-550b-a55b:free','openai/gpt-4o-mini','openai/gpt-4o'],'https://openrouter.ai/models'),
  groq: entry('Groq · API','https://api.groq.com/openai/v1/chat/completions','openai/gpt-oss-20b',false,['openai/gpt-oss-20b','openai/gpt-oss-120b'],'https://console.groq.com/docs/models'),
  agnes: entry('Agnes AI','https://apihub.agnes-ai.com/v1/chat/completions','agnes-2.5-flash',false,['agnes-2.5-flash'],'https://agnes-ai.com/en/docs/agnes-25-flash'),
  mistral: entry('Mistral AI','https://api.mistral.ai/v1/chat/completions','mistral-small-latest',false,['mistral-small-latest','mistral-medium-latest','mistral-large-latest'],'https://docs.mistral.ai/getting-started/models/'),
  codecraft: entry('CodeCraft API','https://codecraftapi.com/v1/chat/completions','identifiant CodeCraft',true,['gemma-2-2b'],'https://codecraftapi.com/models'),
  zai: entry('Z.ai · API standard','https://api.z.ai/api/paas/v4/chat/completions','glm-4.7',false,['glm-4.7'],'https://docs.z.ai/guides/llm/glm-4.7'),
  agentrouter: entry('AgentRouter','https://agentrouter.org/v1/chat/completions','identifiant AgentRouter',true,['gpt-5'],'https://docs.agentrouter.org/codex.html'),
  gemini: entry('Gemini · Google AI','https://generativelanguage.googleapis.com/v1beta/openai/chat/completions','gemini-2.5-flash',false,['gemini-2.5-flash','gemini-2.5-pro'],'https://ai.google.dev/gemini-api/docs/models'),
  kira: entry('Kira AI','https://kiraai.vn/api/v1/chat/completions','kira-2.5-flash',true,['kira-2.5-flash','kira-2.5-pro'],'https://kiraai.vn/models/'),
  apinex: entry('APInex','https://api.apinex.bond/v1/chat/completions','drex-v2.0',true,['drex-v2.0'],'https://apinex.bond/models/drex-v2-0'),
  routesme: entry('RoutesMe · API standard','https://routesme.online/v1/chat/completions','routesme/auto',true,['routesme/auto'],'https://routesme.online/')
});
