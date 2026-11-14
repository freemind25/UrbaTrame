/* UrbaTrame · widget « Assistant » flottant, injecté sur toutes les pages publiques.
   IA 100 % locale par défaut (routeur FreeLLMAPI sur http://localhost:3001) ou
   endpoint personnalisé (CodeCraft direct…). Config persistée en localStorage
   (clé fm_chatWidget via persist.mjs). Aucune donnée personnelle requise. */
import { store } from './persist.mjs';

export const SYSTEM_PROMPT = "Tu es l'assistant d'UrbaTrame, un outil d'étude urbaine (cartes, relevés terrain, volumes 3D, analyses de site, exports vectoriels). Réponds en français, clairement et par étapes concrètes. N'invente jamais de limites cadastrales ou juridiques ; rappelle toujours les limites de tes réponses et la nécessité de vérifier les sources.";

export const PROVIDERS = Object.freeze({
  freellmapi: {
    label: 'FreeLLMAPI — routeur LOCAL (nécessite Docker, 100 % chez vous)',
    endpoint: 'http://localhost:3001/v1/chat/completions',
    hint: 'Docker requis : docker run -d --name freellmapi -p 3001:3001 -e DASHBOARD_ORIGINS=https://freemap-rose.vercel.app,http://localhost:4173 -v freellmapi-data:/app/server/data ghcr.io/tashfeenahmed/freellmapi:latest — puis clé unifiée du routeur. Vos messages ne quittent pas votre machine.'
  },
  codecraft: {
    label: 'CodeCraft — appel DIRECT, sans Docker (clé gratuite cc_…)',
    endpoint: 'https://codecraftapi.com/v1/chat/completions',
    hint: 'Sans Docker : créez une clé gratuite sur codecraftapi.com (Dashboard → API Keys, ~0,5 M tokens/mois, sans carte bancaire), collez-la ici (elle commence par cc_…). Attention : avec cette option, vos messages passent par les serveurs de CodeCraft (voir leur politique de confidentialité).'
  },
  custom: {
    label: 'Autre endpoint OpenAI-compatible (fourni par vous)',
    endpoint: '',
    hint: 'Saisissez l’URL complète …/v1/chat/completions et votre clé. La clé reste sur cet appareil et n’est envoyée qu’à cet endpoint.'
  }
});

export function validateChatEndpoint(raw) {
  const v = String(raw || '').trim();
  if (!v) return { ok: false, error: 'Endpoint vide.' };
  let u;
  try { u = new URL(v); } catch { return { ok: false, error: 'URL invalide.' }; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, error: 'Protocole http/https requis.' };
  if (!/chat/i.test(u.pathname)) return { ok: false, error: 'L’URL doit viser un endpoint /chat/completions (le mot « chat » doit apparaître dans le chemin).' };
  return { ok: true, base: u.href.replace(/\/chat\/completions\/?$/i, '') };
}

export function buildChatBody(cfg, history) {
  return {
    model: String(cfg.model || '').trim(),
    stream: false,
    max_tokens: 1024,
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...history.map(m => ({ role: m.role, content: m.content }))]
  };
}

const CFG_KEY = 'chatWidget';
const defaultCfg = () => ({ provider: 'freellmapi', endpoint: PROVIDERS.freellmapi.endpoint, key: '', model: '' });
function loadCfg() {
  const saved = store.get(CFG_KEY, null) || {};
  const cfg = { ...defaultCfg(), ...saved };
  if (cfg.provider !== 'custom' && PROVIDERS[cfg.provider] && saved.endpoint == null) cfg.endpoint = PROVIDERS[cfg.provider].endpoint;
  return cfg;
}

const CSS = `
#ut-chat-widget * { box-sizing: border-box; font-family: inherit; }
#ut-chat-widget { position: fixed; right: 18px; bottom: 18px; z-index: 9999; font-size: 14px; }
#ut-chat-fab { width: 52px; height: 52px; border-radius: 50%; border: none; background: #153E3D; color: #F4F1E8; font-size: 24px; cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,.25); }
#ut-chat-fab:hover { background: #1d5453; }
#ut-chat-panel { display: none; width: 360px; max-width: calc(100vw - 32px); height: 480px; max-height: calc(100vh - 100px); background: #F4F1E8; border: 1px solid #153E3D; border-radius: 14px; box-shadow: 0 10px 30px rgba(0,0,0,.3); flex-direction: column; overflow: hidden; }
#ut-chat-panel.open { display: flex; }
#ut-chat-head { background: #153E3D; color: #F4F1E8; padding: 10px 12px; display: flex; align-items: center; gap: 8px; font-weight: 700; }
#ut-chat-head .dot { width: 8px; height: 8px; border-radius: 50%; background: #D67855; }
#ut-chat-head button { margin-left: auto; background: none; border: none; color: #F4F1E8; cursor: pointer; font-size: 14px; }
#ut-chat-msgs { flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
#ut-chat-msgs .m { max-width: 85%; padding: 8px 10px; border-radius: 10px; white-space: pre-wrap; line-height: 1.35; }
#ut-chat-msgs .user { align-self: flex-end; background: #153E3D; color: #F4F1E8; }
#ut-chat-msgs .assistant { align-self: flex-start; background: #fff; border: 1px solid #d8d2c2; color: #222; }
#ut-chat-msgs .error { align-self: flex-start; background: #f8d7d0; border: 1px solid #D67855; color: #7a2a12; font-size: 12.5px; }
#ut-chat-form { display: flex; gap: 6px; padding: 8px; border-top: 1px solid #d8d2c2; background: #fff; }
#ut-chat-input { flex: 1; border: 1px solid #b9b6aa; border-radius: 8px; padding: 8px; font-size: 14px; }
#ut-chat-send { border: none; background: #D67855; color: #fff; border-radius: 8px; padding: 8px 12px; cursor: pointer; font-weight: 700; }
#ut-chat-send:disabled { opacity: .5; cursor: default; }
#ut-chat-settings { display: none; padding: 10px; border-top: 1px solid #d8d2c2; background: #fff; font-size: 12.5px; }
#ut-chat-settings.open { display: block; }
#ut-chat-settings label { display: block; margin: 6px 0 2px; font-weight: 600; }
#ut-chat-settings input, #ut-chat-settings select { width: 100%; padding: 6px; border: 1px solid #b9b6aa; border-radius: 6px; font-size: 12.5px; }
#ut-chat-settings .row { display: flex; gap: 6px; margin-top: 8px; }
#ut-chat-settings button { flex: 1; padding: 7px; border-radius: 8px; border: 1px solid #153E3D; background: #153E3D; color: #F4F1E8; cursor: pointer; font-size: 12.5px; }
#ut-chat-settings button.ghost { background: #fff; color: #153E3D; }
#ut-chat-note { font-size: 11px; color: #6b6858; padding: 6px 10px 0; }
`;

export function mountChatWidget(doc = document) {
  if (doc.getElementById('ut-chat-widget')) return null;
  const style = doc.createElement('style');
  style.id = 'ut-chat-css';
  style.textContent = CSS;
  doc.head.appendChild(style);

  let cfg = loadCfg();
  const history = [];
  let busy = false;

  const root = doc.createElement('div');
  root.id = 'ut-chat-widget';
  root.innerHTML = `
    <button id="ut-chat-fab" type="button" aria-label="Ouvrir l’assistant IA">💬</button>
    <div id="ut-chat-panel" role="dialog" aria-label="Assistant IA UrbaTrame">
      <div id="ut-chat-head"><span class="dot"></span> Assistant UrbaTrame
        <button type="button" id="ut-chat-gear" title="Réglages IA" aria-label="Réglages IA">⚙</button>
        <button type="button" id="ut-chat-close" aria-label="Fermer">✕</button>
      </div>
      <div id="ut-chat-msgs" aria-live="polite"></div>
      <div id="ut-chat-settings">
        <label for="ut-cfg-provider">Fournisseur</label>
        <select id="ut-cfg-provider">${Object.entries(PROVIDERS).map(([v, p]) => `<option value="${v}">${p.label}</option>`).join('')}</select>
        <label for="ut-cfg-endpoint">Endpoint (doit contenir « chat »)</label>
        <input id="ut-cfg-endpoint" type="url" placeholder="https://…/v1/chat/completions">
        <label for="ut-cfg-key">Clé API (reste sur cet appareil)</label>
        <input id="ut-cfg-key" type="password" autocomplete="off">
        <label for="ut-cfg-model">Modèle</label>
        <select id="ut-cfg-model"><option value="">— charger le catalogue —</option></select>
        <div class="row">
          <button type="button" id="ut-cfg-models">Charger les modèles</button>
          <button type="button" id="ut-cfg-save" class="ghost">Enregistrer</button>
        </div>
        <p id="ut-chat-note"></p>
      </div>
      <form id="ut-chat-form">
        <input id="ut-chat-input" type="text" maxlength="2000" placeholder="Posez une question sur UrbaTrame…" autocomplete="off">
        <button id="ut-chat-send" type="submit">Envoyer</button>
      </form>
    </div>`;
  doc.body.appendChild(root);

  const $ = id => root.querySelector('#' + id);
  const panel = $('ut-chat-panel'), msgs = $('ut-chat-msgs'), input = $('ut-chat-input'), sendBtn = $('ut-chat-send');

  function addMsg(role, text) {
    const d = doc.createElement('div');
    d.className = 'm ' + role;
    d.textContent = text;
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function syncProviderHint() {
    const p = PROVIDERS[cfg.provider];
    $('ut-chat-note').innerHTML = p && p.hint
      ? p.hint
      : 'Clé jamais envoyée ailleurs qu’à l’endpoint choisi.';
  }

  function syncCfgForm() {
    $('ut-cfg-provider').value = cfg.provider;
    $('ut-cfg-endpoint').value = cfg.endpoint;
    $('ut-cfg-key').value = cfg.key;
    syncProviderHint();
    if (cfg.model) {
      const sel = $('ut-cfg-model');
      if (![...sel.options].some(o => o.value === cfg.model)) sel.add(new Option(cfg.model, cfg.model));
      sel.value = cfg.model;
    }
  }
  syncCfgForm();

  $('ut-cfg-provider').addEventListener('change', e => {
    cfg.provider = e.target.value;
    if (cfg.provider !== 'custom') cfg.endpoint = PROVIDERS[cfg.provider].endpoint;
    $('ut-cfg-endpoint').value = cfg.endpoint;
    syncProviderHint();
  });
  $('ut-cfg-save').addEventListener('click', () => {
    cfg = {
      provider: $('ut-cfg-provider').value,
      endpoint: $('ut-cfg-endpoint').value.trim(),
      key: $('ut-cfg-key').value.trim(),
      model: $('ut-cfg-model').value.trim()
    };
    store.set(CFG_KEY, cfg);
    addMsg('assistant', 'Réglages enregistrés localement ✔');
  });
  $('ut-cfg-models').addEventListener('click', async () => {
    const chk = validateChatEndpoint($('ut-cfg-endpoint').value);
    if (!chk.ok) { addMsg('error', chk.error); return; }
    if (!$('ut-cfg-key').value.trim()) { addMsg('error', 'Saisissez d’abord la clé API.'); return; }
    addMsg('assistant', 'Chargement du catalogue…');
    try {
      const r = await fetch(chk.base + '/models', { headers: { Authorization: 'Bearer ' + $('ut-cfg-key').value.trim(), Accept: 'application/json' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const list = Array.isArray(j) ? j : (j.data || j.models || []);
      const sel = $('ut-cfg-model');
      sel.replaceChildren(new Option('— choisir un modèle —', ''));
      for (const m of list.slice(0, 300)) {
        const id = String(m.id || m.name || '');
        if (id) sel.add(new Option(id, id));
      }
      addMsg('assistant', list.length + ' modèle(s) chargé(s).');
    } catch (e) {
      addMsg('error', 'Catalogue indisponible : ' + e.message + ' (routeur local lancé ? `docker ps` → freellmapi Up)');
    }
  });

  $('ut-chat-fab').addEventListener('click', () => { panel.classList.add('open'); input.focus(); });
  $('ut-chat-close').addEventListener('click', () => panel.classList.remove('open'));
  $('ut-chat-gear').addEventListener('click', () => { $('ut-chat-settings').classList.toggle('open'); syncCfgForm(); });

  $('ut-chat-form').addEventListener('submit', async e => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || busy) return;
    const chk = validateChatEndpoint(cfg.endpoint);
    if (!chk.ok) { addMsg('error', chk.error); return; }
    if (!cfg.key.trim()) { addMsg('error', 'Clé API manquante : ouvrez ⚙ et collez la clé unifiée (freellmapi-… ou cc_…).'); return; }
    if (!cfg.model.trim()) { addMsg('error', 'Choisissez un modèle (⚙ → « Charger les modèles »).'); return; }
    busy = true; sendBtn.disabled = true;
    addMsg('user', text);
    input.value = '';
    history.push({ role: 'user', content: text });
    try {
      const r = await fetch(chk.base + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.key.trim() },
        body: JSON.stringify(buildChatBody(cfg, history))
      });
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        throw new Error('HTTP ' + r.status + (t ? ' · ' + t.slice(0, 160) : ''));
      }
      const j = await r.json();
      const reply = j?.choices?.[0]?.message?.content || '(réponse vide)';
      history.push({ role: 'assistant', content: reply });
      addMsg('assistant', reply);
    } catch (err) {
      const hint = cfg.provider === 'freellmapi'
        ? ' — avec FreeLLMAPI, vérifiez que le routeur tourne (`docker ps`) et que son CORS autorise cette origine (DASHBOARD_ORIGINS=https://freemap-rose.vercel.app). Sans Docker : choisissez « CodeCraft — appel direct » dans ⚙.'
        : (PROVIDERS[cfg.provider] && PROVIDERS[cfg.provider].hint) || '';
      addMsg('error', 'Envoi impossible : ' + err.message + hint);
    } finally {
      busy = false; sendBtn.disabled = false; input.focus();
    }
  });

  return root;
}

if (typeof document !== 'undefined' && !document.getElementById('ut-chat-widget')) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mountChatWidget());
  else mountChatWidget();
}
