import { AXO_PROVIDERS } from './axo-ai-providers.mjs?v=20261011free1';

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
    <label>Exemples de modèles pour ce fournisseur <select data-model-choice></select></label>
    <label>Identifiant du modèle <input data-model type="text" maxlength="120" placeholder="fournisseur/modèle" autocomplete="off" spellcheck="false"></label>
    <p data-model-hint>Exemples indicatifs, non vérifiés en direct : disponibilité et tarifs à confirmer chez le fournisseur. Vous pouvez saisir un autre identifiant.</p>
    <p data-free-hint></p>
    <p><a data-catalog target="_blank" rel="noopener noreferrer">Consulter la documentation ou le catalogue du fournisseur ↗</a></p>
    <label>Votre clé API personnelle <input data-key type="password" maxlength="512" autocomplete="off"></label>
    <label>Observations facultatives <textarea data-notes maxlength="2000" rows="3" placeholder="Vos observations et sources à vérifier"></textarea></label>
    <label class="axo-consent"><input data-consent type="checkbox"> J’accepte l’envoi du résumé et le coût éventuel du modèle choisi.</label>
    <button type="button" data-run>Proposer une lecture</button>
    <p data-status role="status">La clé est utilisée pour cet appel seulement, non enregistrée par cette interface. Les tarifs et la conservation des données dépendent du fournisseur.</p>
    <pre data-output aria-live="polite" hidden></pre>`;
  card.querySelector('.body').after(box);
  const el = name => box.querySelector('[data-' + name + ']');
  function updateModelExamples() {
    const selected = AXO_PROVIDERS[el('provider').value];
    const choice=el('model-choice');
    choice.replaceChildren(new Option('— Choisir un exemple ou saisir un identifiant —',''));
    for (const id of selected.models) {
      const free = el('provider').value==='openrouter' && (id==='openrouter/free' || id.endsWith(':free'));
      choice.add(new Option(id + (free ? ' — gratuit annoncé, à vérifier' : ''),id));
    }
    choice.add(new Option('Autre identifiant (saisie manuelle)','__custom__'));
    el('model').placeholder=selected.placeholder;
    el('catalog').href=selected.catalog;
    const hints={
      openrouter:'OpenRouter : openrouter/free choisit un modèle gratuit variable ; les variantes :free sont annoncées gratuites sous quota. Ne retirez pas :free. Les autres modèles peuvent être payants.',
      gemini:'Gemini : certains modèles sont accessibles sur le plan gratuit ; un projet avec facturation peut être payant. Vérifiez modèle, compte et quota.',
      groq:'Groq : un plan gratuit limité est annoncé ; vérifiez votre plan, les modèles et le quota. Le plan Developer est payant.'
    };
    el('free-hint').textContent=hints[el('provider').value] || 'La gratuité dépend du compte, du modèle et des conditions du fournisseur.';
  }
  updateModelExamples();
  el('model-choice').addEventListener('change',()=>{
    const id=el('model-choice').value;
    if(id && id!=='__custom__') el('model').value=id;
    else if(id==='__custom__') {el('model').value='';el('model').focus();}
  });
  el('model').addEventListener('input',()=>{
    const value=el('model').value.trim(),examples=AXO_PROVIDERS[el('provider').value].models;
    el('model-choice').value=!value?'':examples.includes(value)?value:'__custom__';
  });
  el('provider').addEventListener('change', () => {
    el('model').value = '';
    updateModelExamples();
    el('key').value = '';
    el('consent').checked = false;
    el('output').textContent = '';
    el('output').hidden = true;
    el('status').textContent = 'Fournisseur changé : saisissez sa propre clé et son modèle, puis vérifiez tarifs et conditions.';
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
    el('key').value = ''; el('consent').checked = false; el('run').disabled = true; el('provider').disabled = true;
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
    finally { el('run').disabled = false; el('provider').disabled = false; }
  });
  return box;
}
