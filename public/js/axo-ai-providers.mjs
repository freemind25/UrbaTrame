/* Répertoire commun au navigateur et au serveur : aucune URL utilisateur ne
   peut être transmise au relais. Seuls les endpoints HTTPS recensés ici sont
   autorisés ; les catalogues et tarifs des comptes restent à vérifier. */
export const AXO_PROVIDERS = Object.freeze({
  openrouter: Object.freeze({ label:'OpenRouter', endpoint:'https://openrouter.ai/api/v1/chat/completions', placeholder:'fournisseur/modèle', routed:true }),
  agnes: Object.freeze({ label:'Agnes AI', endpoint:'https://apihub.agnes-ai.com/v1/chat/completions', placeholder:'agnes-2.5-flash', routed:false }),
  mistral: Object.freeze({ label:'Mistral AI', endpoint:'https://api.mistral.ai/v1/chat/completions', placeholder:'Identifiant de modèle Mistral', routed:false }),
  codecraft: Object.freeze({ label:'CodeCraft API', endpoint:'https://codecraftapi.com/v1/chat/completions', placeholder:'Identifiant du modèle CodeCraft', routed:true }),
  zai: Object.freeze({ label:'Z.ai · API standard', endpoint:'https://api.z.ai/api/paas/v4/chat/completions', placeholder:'Identifiant de modèle GLM', routed:false }),
  agentrouter: Object.freeze({ label:'AgentRouter', endpoint:'https://agentrouter.org/v1/chat/completions', placeholder:'Identifiant du modèle AgentRouter', routed:true }),
  gemini: Object.freeze({ label:'Gemini · Google AI', endpoint:'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', placeholder:'Identifiant de modèle Gemini', routed:false }),
  kira: Object.freeze({ label:'Kira AI', endpoint:'https://kiraai.vn/api/v1/chat/completions', placeholder:'Identifiant du modèle Kira', routed:true }),
  apinex: Object.freeze({ label:'APInex', endpoint:'https://api.apinex.bond/v1/chat/completions', placeholder:'Identifiant du modèle APInex', routed:true }),
  routesme: Object.freeze({ label:'RoutesMe · API standard', endpoint:'https://routesme.online/v1/chat/completions', placeholder:'Identifiant du modèle RoutesMe', routed:true })
});
