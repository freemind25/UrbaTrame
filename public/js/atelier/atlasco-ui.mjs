/* Panneau « Cartes communautaires Atlas » de l'atelier cartographique.
   Appelle UNIQUEMENT notre proxy /api/atlasco/* (lecture seule). Les images
   des modèles viennent d'atlas.co (images publiques). */
import {
  ATLASCO_TEMPLATES_URL, ATLASCO_MAP_URL, ATLASCO_LAYERS_URL, ATLASCO_COMMUNITY_URL,
  ATLASCO_KINDS, ATLASCO_SUGGESTIONS,
  buildTemplatesParams, normalizeTemplate, kindFr, buildCitation, readFavorites, toggleFavorite,
  extractAtlasProjectId
} from './atlasco.mjs';

const $ = s => document.querySelector(s);

const state = {
  offset: 0,
  limit: 12,
  total: 0,
  loading: false,
  controller: null,
  kinds: ATLASCO_KINDS,
  collections: []
};

function status(message, kind = '') {
  const el = $('#atStatus');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('error', kind === 'error');
  el.classList.toggle('success', kind === 'success');
}

function errorMessage(error) {
  const map = {
    QUERY_TOO_LONG: 'La recherche dépasse 120 caractères.',
    KIND_INVALID: 'Catégorie inconnue.',
    COLLECTION_INVALID: 'Collection inconnue.',
    LIMIT_INVALID: 'Limite invalide.',
    OFFSET_INVALID: 'Page invalide.',
    RATE_LIMITED: 'Trop de recherches à la suite : patientez quelques secondes.',
    ATLASCO_LIST_FAILED: 'atlas.co est indisponible (bibliothèque).',
    ATLASCO_MAP_FAILED: 'atlas.co est indisponible (page du modèle).',
    ATLASCO_LAYERS_FAILED: 'Les couches de cette carte partagée ne sont pas lisibles publiquement.'
  };
  let msg = map[error?.code] || 'Recherche impossible pour le moment.';
  if (error?.code === 'RATE_LIMITED' && error.retryAfter) msg = `Trop de recherches : réessayez dans ${error.retryAfter} s.`;
  return msg;
}

function chip(text, cls = '') {
  const span = document.createElement('span');
  span.className = `la-chip ${cls}`.trim();
  span.textContent = text;
  return span;
}

function fillKinds() {
  const sel = $('#atKind');
  for (const k of state.kinds) {
    const opt = document.createElement('option');
    opt.value = k.id;
    opt.textContent = k.fr;
    sel.appendChild(opt);
  }
  const dl = $('#atSuggestions');
  for (const s of ATLASCO_SUGGESTIONS) {
    const opt = document.createElement('option');
    opt.value = s;
    dl.appendChild(opt);
  }
}

function fillCollections(collections) {
  const sel = $('#atCollection');
  const existing = new Set([...sel.options].map(o => o.value));
  for (const c of collections) {
    if (existing.has(c.slug)) continue;
    const opt = document.createElement('option');
    opt.value = c.slug;
    opt.textContent = `${c.label}${c.count ? ` (${c.count})` : ''}`;
    sel.appendChild(opt);
  }
}

function renderCard(item) {
  const t = normalizeTemplate(item);
  const card = document.createElement('article');
  card.className = 'la-card atlasco-card';
  card.dataset.slug = t.slug;

  if (t.image) {
    const img = document.createElement('img');
    img.className = 'la-thumb';
    img.loading = 'lazy';
    img.alt = '';
    img.src = t.image;
    img.addEventListener('error', () => img.remove());
    card.appendChild(img);
  }

  const body = document.createElement('div');
  body.className = 'la-card-body';
  const title = document.createElement('h3');
  title.className = 'la-card-title';
  title.textContent = t.title;
  body.appendChild(title);

  const meta = document.createElement('p');
  meta.className = 'la-card-meta';
  meta.append(chip(kindFr(t.kind, t.kindLabel), 'la-chip-cat'));
  body.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'la-card-actions';

  const favBtn = document.createElement('button');
  favBtn.type = 'button';
  favBtn.className = 'button-secondary la-fav-btn';
  const isFav = readFavorites().some(f => f.slug === t.slug);
  favBtn.textContent = isFav ? '★ Retirer des favoris' : '☆ Ajouter aux favoris';
  favBtn.addEventListener('click', () => {
    const { added } = toggleFavorite(t);
    favBtn.textContent = added ? '★ Retirer des favoris' : '☆ Ajouter aux favoris';
    renderFavorites();
    status(added ? `« ${t.title} » ajouté aux favoris (stockés dans ce navigateur).` : `« ${t.title} » retiré des favoris.`, 'success');
  });
  actions.appendChild(favBtn);

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'button-secondary';
  copyBtn.textContent = 'Copier la citation';
  copyBtn.addEventListener('click', async () => {
    const citation = buildCitation(t);
    try { await navigator.clipboard.writeText(citation); status(`Citation copiée : ${citation}`, 'success'); }
    catch { status(`Citation : ${citation}`, 'success'); }
  });
  actions.appendChild(copyBtn);

  const layersBtn = document.createElement('button');
  layersBtn.type = 'button';
  layersBtn.className = 'button-secondary atlasco-layers-btn';
  layersBtn.textContent = 'Voir la carte et ses couches';
  layersBtn.addEventListener('click', async () => {
    layersBtn.disabled = true;
    try {
      const res = await fetch(`${ATLASCO_MAP_URL}?slug=${encodeURIComponent(t.slug)}`);
      const detail = await res.json().catch(() => ({}));
      if (!res.ok || !detail.ok) throw Object.assign(new Error(detail.error || 'HTTP ' + res.status), { code: detail.error });
      let shareLine = detail.shareUrl ? ` Carte publique : ${detail.shareUrl}` : ' (carte publique non trouvée)';
      if (detail.shareId) {
        try {
          const lres = await fetch(`${ATLASCO_LAYERS_URL}?project=${encodeURIComponent(detail.shareId)}`);
          const ldata = await lres.json().catch(() => ({}));
          if (lres.ok && ldata.ok && ldata.layers.length) {
            shareLine += ` — ${ldata.layers.length} couche(s) : ${ldata.layers.map(l => l.name).join(', ')}`;
          } else if (lres.ok && ldata.ok) shareLine += ' — aucune couche listée.';
        } catch { /* la liste des couches est facultative */ }
      }
      status(`${detail.title || t.title}.${shareLine} Modèle : ${detail.pageUrl}`, 'success');
      const links = document.createElement('div');
      links.className = 'la-card-actions';
      if (detail.shareUrl) {
        const a = document.createElement('a');
        a.className = 'text-button'; a.href = detail.shareUrl; a.target = '_blank'; a.rel = 'noopener noreferrer';
        a.textContent = 'Ouvrir la carte publique ↗';
        links.appendChild(a);
      }
      const b = document.createElement('a');
      b.className = 'text-button'; b.href = detail.pageUrl || t.pageUrl; b.target = '_blank'; b.rel = 'noopener noreferrer';
      b.textContent = 'Page du modèle ↗';
      links.appendChild(b);
      const c = document.createElement('a');
      c.className = 'text-button'; c.href = ATLASCO_COMMUNITY_URL; c.target = '_blank'; c.rel = 'noopener noreferrer';
      c.textContent = 'Bibliothèque atlas.co ↗';
      links.appendChild(c);
      card.querySelector('.la-card-body').appendChild(links);
      if (detail.description) {
        const p = document.createElement('p');
        p.className = 'la-card-desc';
        p.textContent = detail.description;
        card.querySelector('.la-card-body').insertBefore(p, card.querySelector('.la-card-actions'));
      }
    } catch (error) {
      status(errorMessage(error), 'error');
    } finally {
      layersBtn.disabled = false;
    }
  });
  actions.appendChild(layersBtn);

  body.appendChild(actions);
  card.appendChild(body);
  return card;
}

function renderFavorites() {
  const ul = $('#atFavorites');
  if (!ul) return;
  ul.replaceChildren();
  const favs = readFavorites();
  if (!favs.length) {
    const li = document.createElement('li');
    li.className = 'la-fav-empty';
    li.textContent = 'Aucun favori pour le moment.';
    ul.appendChild(li);
    return;
  }
  for (const fav of favs) {
    const li = document.createElement('li');
    li.className = 'la-fav-item';
    const label = document.createElement('span');
    label.textContent = `${fav.title}${fav.kind ? ` — ${kindFr(fav.kind)}` : ''}`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'text-button';
    remove.textContent = '✕';
    remove.title = 'Retirer des favoris';
    remove.addEventListener('click', () => {
      toggleFavorite({ slug: fav.slug });
      renderFavorites();
      for (const card of document.querySelectorAll('.atlasco-card')) {
        if (card.dataset.slug !== fav.slug) continue;
        const btn = card.querySelector('.la-fav-btn');
        if (btn) btn.textContent = '☆ Ajouter aux favoris';
      }
      status(`« ${fav.title} » retiré des favoris.`, 'success');
    });
    li.append(label, remove);
    ul.appendChild(li);
  }
}

function renderResults(payload) {
  const box = $('#atResults');
  box.replaceChildren();
  state.total = payload.total;
  if (payload.collections) { state.collections = payload.collections; fillCollections(payload.collections); }
  if (payload.kinds) state.kinds = payload.kinds;
  if (!payload.items.length) {
    const p = document.createElement('p');
    p.className = 'la-empty';
    p.textContent = 'Aucun modèle public ne correspond à cette recherche.';
    box.appendChild(p);
  }
  for (const item of payload.items) box.appendChild(renderCard(item));
  const from = state.offset + 1;
  const to = Math.min(state.offset + payload.items.length, state.total);
  $('#atPageInfo').textContent = state.total > 0 ? `${from}–${to} sur ${state.total.toLocaleString('fr-FR')}` : '0 résultat';
  $('#atPrev').disabled = state.loading || state.offset === 0;
  $('#atNext').disabled = state.loading || state.offset + state.limit >= state.total;
}

async function runSearch() {
  if (state.loading) return;
  let params;
  try {
    params = buildTemplatesParams({
      q: $('#atQuery').value,
      kind: $('#atKind').value,
      collection: $('#atCollection').value,
      limit: state.limit,
      offset: state.offset
    });
  } catch (error) { status(errorMessage(error), 'error'); return; }
  state.loading = true;
  $('#atSearch').disabled = true;
  $('#atPrev').disabled = true;
  $('#atNext').disabled = true;
  status('Recherche envoyée à atlas.co (lecture seule) via le serveur UrbaTrame…');
  state.controller?.abort();
  state.controller = new AbortController();
  try {
    const res = await fetch(`${ATLASCO_TEMPLATES_URL}?${params}`, { signal: state.controller.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw Object.assign(new Error(data.error || 'HTTP ' + res.status), { code: data.error, retryAfter: data.retryAfter });
    renderResults(data);
    status(`${data.total.toLocaleString('fr-FR')} modèle(s) public(s) Atlas — métadonnées publiques. Aucune donnée locale transmise.`, 'success');
  } catch (error) {
    if (error.name === 'AbortError') return;
    status(errorMessage(error), 'error');
  } finally {
    state.loading = false;
    $('#atSearch').disabled = false;
    $('#atPrev').disabled = state.offset === 0;
    $('#atNext').disabled = state.offset + state.limit >= state.total;
  }
}

/* « Ma carte partagée » : l'utilisateur colle le lien public de SA carte Atlas
   (partagée publiquement dans Atlas : Share → lien public) ; on liste alors ses
   couches en lecture seule via /api/atlasco/layers. Aucune connexion au compte
   Google n'est nécessaire ni possible ici. */
async function loadSharedLayers() {
  const box = $('#atSharedResult');
  const btn = $('#atSharedBtn');
  let projectId;
  try { projectId = extractAtlasProjectId($('#atSharedLink').value); }
  catch (error) { status(errorMessage(error), 'error'); return; }
  btn.disabled = true;
  box.replaceChildren();
  status('Lecture des couches publiques de la carte Atlas…');
  try {
    const res = await fetch(`${ATLASCO_LAYERS_URL}?project=${encodeURIComponent(projectId)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw Object.assign(new Error(data.error || 'HTTP ' + res.status), { code: data.error });
    box.replaceChildren();
    const head = document.createElement('p');
    head.className = 'la-card-desc';
    const open = document.createElement('a');
    open.href = `https://app.atlas.co/shared/${projectId}`;
    open.target = '_blank'; open.rel = 'noopener noreferrer';
    open.textContent = 'Ouvrir la carte sur Atlas ↗';
    head.append(`${data.layers.length} couche(s) publique(s) — `, open);
    box.appendChild(head);
    const ul = document.createElement('ul');
    ul.className = 'atlasco-layers';
    for (const layer of data.layers) {
      const li = document.createElement('li');
      const bbox = Array.isArray(layer.bbox) ? ` · emprise [${layer.bbox.map(n => n.toFixed(2)).join(', ')}]` : '';
      li.textContent = `${layer.name} — ${layer.type || 'type inconnu'}${bbox}`;
      ul.appendChild(li);
    }
    box.appendChild(ul);
    const hint = document.createElement('p');
    hint.className = 'source-footnote';
    hint.textContent = 'Pour récupérer les données : dans Atlas, ouvrez la carte → couche → ⋯ → « Télécharger » → GeoJSON, puis glissez le fichier dans le panneau 01 / DONNÉES de cet atelier (lecture 100 % locale).';
    box.appendChild(hint);
    status(`${data.layers.length} couche(s) listée(s) en lecture seule. Aucune donnée locale transmise.`, 'success');
  } catch (error) {
    box.replaceChildren();
    const p = document.createElement('p');
    p.className = 'la-empty';
    p.textContent = errorMessage(error) + ' Si la carte n’est pas partagée publiquement dans Atlas (Share → lien public), ses couches ne sont pas lisibles ici — exportez plutôt le GeoJSON depuis Atlas.';
    box.appendChild(p);
    status(errorMessage(error), 'error');
  } finally {
    btn.disabled = false;
  }
}

/* « Publier sur Atlas » : on réutilise l’export GeoJSON existant de l’atelier
   (bouton #exportGeoJSON) ; l’utilisateur importe ensuite le fichier dans Atlas. */
function exportForAtlas() {
  const btn = $('#exportGeoJSON');
  if (!btn || btn.disabled) { status('Importez d’abord une couche vectorielle (panneau 01 / DONNÉES) pour pouvoir l’exporter en GeoJSON.', 'error'); return; }
  btn.click();
  status('Export GeoJSON lancé (téléchargement local). Étapes pour publier sur Atlas : app.atlas.co → nouveau projet → « Add data » → importez le fichier GeoJSON → Share → activez le lien public.', 'success');
}

function init() {
  if (!$('#atlascoPanel')) return;
  fillKinds();
  renderFavorites();
  $('#atSharedBtn').addEventListener('click', loadSharedLayers);
  $('#atSharedLink').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); loadSharedLayers(); } });
  $('#atExportForAtlas').addEventListener('click', exportForAtlas);
  $('#atSearch').addEventListener('click', () => { state.offset = 0; runSearch(); });
  $('#atQuery').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); state.offset = 0; runSearch(); } });
  $('#atKind').addEventListener('change', () => { state.offset = 0; runSearch(); });
  $('#atCollection').addEventListener('change', () => { state.offset = 0; runSearch(); });
  $('#atPrev').addEventListener('click', () => { state.offset = Math.max(0, state.offset - state.limit); runSearch(); });
  $('#atNext').addEventListener('click', () => { state.offset += state.limit; runSearch(); });
}

init();
