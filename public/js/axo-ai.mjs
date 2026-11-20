import { AXO_PROVIDERS } from './axo-ai-providers.mjs?v=20261011providers3';

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
    <label>Identifiant du modèle <input data-model type="text" maxlength="120" placeholder="ex. openai/gpt-4o-mini" autocomplete="off"></label>
    <label>Votre clé API personnelle <input data-key type="password" maxlength="512" autocomplete="off"></label>
    <label>Observations facultatives <textarea data-notes maxlength="2000" rows="3" placeholder="Vos observations et sources à vérifier"></textarea></label>
    <label class="axo-consent"><input data-consent type="checkbox"> J’accepte l’envoi du résumé et le coût éventuel du modèle choisi.</label>
    <button type="button" data-run>Proposer une lecture</button>
    <p data-status role="status">La clé est utilisée pour cet appel seulement, non enregistrée par cette interface. Les tarifs et la conservation des données dépendent du fournisseur.</p>
    <pre data-output aria-live="polite" hidden></pre>`;
  card.querySelector('.body').after(box);
  const el = name => box.querySelector('[data-' + name + ']');
  el('provider').addEventListener('change', () => {
    const selected = AXO_PROVIDERS[el('provider').value];
    el('model').value = '';
    el('model').placeholder = selected.placeholder;
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
