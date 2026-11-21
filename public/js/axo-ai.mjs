import { AXO_PROVIDERS } from './axo-ai-providers.mjs?v=20261011keytest1';

/* Assistance textuelle pour la planche éclatée. Aucune clé n'est persistée,
   aucune modification de carte n'est appliquée automatiquement. */
export function buildAxoAiContext(snapshot, notes = '') {
  if (!snapshot?.site || !snapshot?.buckets) throw new Error('Chargez d’abord les données du site.');
  if (snapshot.stale) throw new Error('Le site ou son emprise a changé : rechargez les données avant l’envoi.');
  const site = snapshot.site, d = snapshot.buckets;
  return {
    objet: 'Préparer une analyse de site éclatée sans ajouter de géométrie.',
    site: { nom: String(site.name || '').slice(0, 150), latitude: site.lat, longitude: site.lon, rayon_m: site.R, forme: site.shape },
    source: 'OpenStreetMap, données chargées ; couverture et date à vérifier.',
    comptages: {
      batiments: (d.build || []).length, voies: (d.roads || []).length,
      zones_occupation_vert_eau: (d.green || []).length,
      points_interet: (d.pois || []).length, voies_ferrees: (d.rail || []).length
    },
    precisions: 'Comptages des objets chargés, pas nécessairement limités à la zone visible. Aucune géométrie, aucun attribut d’objet, aucune photographie ni aucun fichier ne sont transmis. Ces chiffres seuls ne permettent pas de localiser ni de prouver une direction ou une barrière.',
    observations_utilisateur: String(notes || '').trim().slice(0, 2000),
    demande: 'Présente séparément faits fournis, hypothèses et vérifications. Pas de coordonnées ni de tracé inventés.'
  };
}

export function mountAxoAssistant(card, getSnapshot) {
  const box = document.createElement('details'); box.className = 'axo-ai';
  box.innerHTML = `<summary>Assistance IA · hypothèses à vérifier</summary>
    <p>Un résumé du site sera envoyé au fournisseur choisi, via le serveur UrbaTrame. Aucun tracé ne sera ajouté automatiquement. Tarifs et quota à vérifier avant chaque appel.</p>
    <label>Fournisseur <select data-provider>${Object.entries(AXO_PROVIDERS).map(([id, item]) => `<option value="${id}">${item.label}</option>`).join('')}</select></label>
    <label>Modèles proposés pour ce fournisseur <select data-model-choice></select></label>
    <label>Identifiant du modèle <input data-model type="text" maxlength="120" placeholder="fournisseur/modèle" autocomplete="off" spellcheck="false"></label>
    <p data-model-hint>Exemples indicatifs ; les modèles retournés après test sont séparés. Disponibilité pour la génération et tarifs à confirmer. Vous pouvez saisir un autre identifiant.</p>
    <p data-free-hint></p>
    <p><a data-catalog target="_blank" rel="noopener noreferrer">Consulter la documentation ou le catalogue du fournisseur ↗</a></p>
    <label>Votre clé API personnelle <input data-key type="password" maxlength="512" autocomplete="off"></label>
    <button type="button" data-test-key>Tester la clé et charger les modèles</button>
    <p data-key-status role="status">Test disponible pour Mistral, Groq et OpenRouter. Il envoie la clé via UrbaTrame sans envoyer de données de site ni générer de texte.</p>
    <label>Observations facultatives <textarea data-notes maxlength="2000" rows="3" placeholder="Vos observations et sources à vérifier"></textarea></label>
    <label class="axo-consent"><input data-consent type="checkbox"> J’accepte l’envoi du résumé et le coût éventuel du modèle choisi.</label>
    <button type="button" data-run>Proposer une lecture</button>
    <p data-status role="status">La clé reste dans ce champ après un test et est effacée à l’envoi de la demande ou au changement de fournisseur. Les tarifs et la conservation des données dépendent du fournisseur.</p>
    <pre data-output aria-live="polite" hidden></pre>`;
  card.querySelector('.body').after(box);
  const el = name => box.querySelector('[data-' + name + ']');
  let liveModels=[];
  function updateModelExamples() {
    const selected = AXO_PROVIDERS[el('provider').value];
    const choice=el('model-choice');
    choice.replaceChildren(new Option('— Choisir un exemple ou saisir un identifiant —',''));
    const examples=document.createElement('optgroup'); examples.label='Exemples indicatifs';
    for (const id of selected.models) {
      const free = el('provider').value==='openrouter' && (id==='openrouter/free' || id.endsWith(':free'));
      examples.append(new Option(id + (free ? ' — gratuit annoncé, à vérifier' : id.startsWith('labs-') ? ' — Labs, gratuit annoncé sous conditions' : ''),id));
    }
    choice.append(examples);
    if (liveModels.length) {
      const group=document.createElement('optgroup'); group.label='Modèles retournés par le fournisseur — tarifs à vérifier';
      for (const id of liveModels) group.append(new Option(id + (id.startsWith('labs-') ? ' — Labs, conditions à vérifier' : ''),id));
      choice.append(group);
    }
    choice.add(new Option('Autre identifiant (saisie manuelle)','__custom__'));
    const current=el('model').value.trim();
    choice.value=!current?'':Array.from(choice.options).some(o=>o.value===current)?current:'__custom__';
    el('model').placeholder=selected.placeholder;
    el('catalog').href=selected.catalog;
    const hints={
      openrouter:'OpenRouter : openrouter/free choisit un modèle gratuit variable ; les variantes :free sont annoncées gratuites sous quota. Ne retirez pas :free. Les autres modèles peuvent être payants.',
      gemini:'Gemini : certains modèles sont accessibles sur le plan gratuit ; un projet avec facturation peut être payant. Vérifiez modèle, compte et quota.',
      groq:'Groq : un plan gratuit limité est annoncé ; vérifiez votre plan, les modèles et le quota. Le plan Developer est payant.',
      mistral:'Mistral : les modèles Labs sont annoncés gratuits sous conditions, sans garantie d’accès ; Mistral indique une collecte de données sans possibilité de refus pour Labs. Vérifiez tarifs et droits avant tout appel.'
    };
    el('free-hint').textContent=hints[el('provider').value] || 'La gratuité dépend du compte, du modèle et des conditions du fournisseur.';
    const supported=['mistral','groq','openrouter'].includes(el('provider').value);
    el('test-key').disabled=!supported;
    el('test-key').textContent=el('provider').value==='openrouter' ? 'Tester la clé' : 'Tester la clé et charger les modèles';
    el('key-status').textContent=supported ? 'Test sans génération : la clé sera envoyée au fournisseur via UrbaTrame. Les prix et quotas ne sont pas vérifiés.' : 'Test de clé non disponible pour ce fournisseur : aucune méthode de vérification fiable n’est configurée. Consultez son tableau de bord.';
  }
  updateModelExamples();
  el('model-choice').addEventListener('change',()=>{
    const id=el('model-choice').value;
    if(id && id!=='__custom__') el('model').value=id;
    else if(id==='__custom__') {el('model').value='';el('model').focus();}
  });
  el('model').addEventListener('input',()=>{
    const value=el('model').value.trim();
    el('model-choice').value=!value?'':Array.from(el('model-choice').options).some(o=>o.value===value)?value:'__custom__';
  });
  el('provider').addEventListener('change', () => {
    el('model').value = '';
    liveModels=[];
    updateModelExamples();
    el('key').value = '';
    el('consent').checked = false;
    el('output').textContent = '';
    el('output').hidden = true;
    el('status').textContent = 'Fournisseur changé : saisissez sa propre clé et son modèle, puis vérifiez tarifs et conditions.';
  });
  el('key').addEventListener('input',()=>{
    if (liveModels.length) { liveModels=[]; updateModelExamples(); }
    else if (['mistral','groq','openrouter'].includes(el('provider').value))
      el('key-status').textContent='Clé modifiée : relancez le test si nécessaire.';
  });
  el('test-key').addEventListener('click', async()=>{
    const provider=el('provider').value, key=el('key').value.trim(), status=el('key-status');
    if (!key) {status.textContent='Saisissez d’abord la clé API de ce fournisseur.';return;}
    if (location.protocol!=='https:' && !['localhost','127.0.0.1','[::1]'].includes(location.hostname)) {
      status.textContent='Connexion HTTPS requise pour transmettre une clé, sauf sur localhost.';return;
    }
    if (!window.confirm(`Tester la clé ${AXO_PROVIDERS[provider].label} via le serveur UrbaTrame ?\n\nLa clé sera envoyée au fournisseur pour vérifier son accès. Aucun résumé de site ni génération de texte ne sera envoyé. Les tarifs et quotas ne sont pas vérifiés.`)) return;
    liveModels=[]; updateModelExamples();
    el('test-key').disabled=true; el('provider').disabled=true; el('key').disabled=true; el('run').disabled=true;
    status.textContent='Vérification en cours…';
    try {
      const response=await fetch('/api/ai/test-key',{
        method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},
        body:JSON.stringify({provider}),signal:AbortSignal.timeout(25_000)
      });
      const result=await response.json();
      if (!response.ok || !result.ok) {
        const code=result.upstreamStatus;
        if (code===401) throw new Error('Clé refusée par le fournisseur (HTTP 401). Vérifiez la clé et le service choisi.');
        if (code===403) throw new Error('Accès refusé (HTTP 403) : droits, compte ou filtrage réseau à vérifier.');
        if (code===429) throw new Error('Quota ou limite atteint (HTTP 429). Réessayez plus tard.');
        throw new Error('Vérification impossible'+(code?' (HTTP fournisseur '+code+')':'')+' ; réessayez ou consultez le fournisseur.');
      }
      liveModels=Array.isArray(result.models)?result.models:[];
      updateModelExamples();
      status.textContent=Array.isArray(result.models)
        ? `Clé acceptée pour la liste des modèles : ${liveModels.length} identifiant(s) affiché(s)${result.truncated?' (liste limitée)':''}. Accès à la génération, prix et quotas non vérifiés.`
        : 'Clé acceptée par le service de vérification. Accès à la génération, prix et quotas non vérifiés.';
    } catch(error) { status.textContent=error?.message || 'Vérification impossible.'; }
    finally {el('test-key').disabled=false;el('provider').disabled=false;el('key').disabled=false;el('run').disabled=false;}
  });
  el('run').addEventListener('click', async () => {
    const provider = el('provider').value, model = el('model').value.trim(), key = el('key').value.trim();
    const status = el('status'), output = el('output');
    if (!el('consent').checked || !key || !model) { status.textContent = 'Indiquez un modèle et votre clé, puis cochez le consentement.'; return; }
    if (location.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
      status.textContent = 'Connexion HTTPS requise pour transmettre une clé, sauf sur localhost.'; return;
    }
    let context;
    try { context = buildAxoAiContext(getSnapshot(), el('notes').value); }
    catch (error) { status.textContent = error.message; return; }
    const config = AXO_PROVIDERS[provider];
    if (!config) { status.textContent = 'Fournisseur non reconnu.'; return; }
    const providerName = config.label + (config.routed ? ' (peut transmettre au fournisseur du modèle)' : '');
    const disclosure = `Envoyer à ${providerName} via le serveur UrbaTrame ?\n\nSite : ${context.site.nom} (${context.site.latitude}, ${context.site.longitude}), rayon ${context.site.rayon_m} m, forme ${context.site.forme}.\nComptages OSM chargés : ${JSON.stringify(context.comptages)}.\nVos observations : ${context.observations_utilisateur || 'aucune'}.\nAucune géométrie ni fichier ne sera transmis. La clé transite par le serveur et n’est pas enregistrée par ce module.\n\nDestination : ${config.endpoint}.\nModèle : ${model}. Prix et quota non vérifiés automatiquement : des frais peuvent s’appliquer. Continuer ?`;
    if (!window.confirm(disclosure)) return;
    el('key').value = ''; liveModels=[]; updateModelExamples(); el('consent').checked = false; el('run').disabled = true; el('provider').disabled = true; el('test-key').disabled = true;
    status.textContent = 'Envoi en cours…'; output.hidden = true; output.textContent = '';
    try {
      const response = await fetch('/api/ai/interpret', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify({ provider, model, context }), signal: AbortSignal.timeout(50_000)
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        const upstream = result.upstreamStatus ? ` (HTTP fournisseur ${result.upstreamStatus})` : '';
        const waf = provider === 'codecraft' && result.upstreamStatus === 403 ? ' CodeCraft peut bloquer le relais serveur par son WAF ; aucun contournement automatique.' : '';
        throw new Error(`Appel impossible${upstream}. Vérifiez clé, modèle, quota et accès.${waf}`);
      }
      output.textContent = `PROPOSITION NON VALIDÉE — ${providerName} · ${model}\nSite : ${context.site.nom}\n\n${result.text}`;
      output.hidden = false;
      status.textContent = 'Lecture générée : à contrôler et documenter. Rien n’a été ajouté à la planche.';
    } catch (error) { status.textContent = error?.message || 'Appel impossible : vérifiez la connexion et le fournisseur.'; }
    finally { el('run').disabled = false; el('provider').disabled = false; el('test-key').disabled = !['mistral','groq','openrouter'].includes(provider); }
  });
  return box;
}
