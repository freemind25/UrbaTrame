/* Panneau « Catalogue Layer Atlas » de l'atelier cartographique.
   Appelle UNIQUEMENT notre proxy /api/layeratlas/search (lecture seule) :
   aucune requête ne part directement de ce navigateur vers layeratlas.com,
   sauf les miniatures (images publiques servies par upcdn.io, comme les
   tuiles OSM déjà utilisées pour le fond). */
import {
  LAYERATLAS_CATEGORIES, LAYERATLAS_SEARCH_URL, LAYERATLAS_SITE_URL, LAYERATLAS_SUGGESTIONS,
  buildSearchParams, normalizeHit, layerAtlasThumbnailUrl, buildCitation, readFavorites, toggleFavorite
} from './layeratlas.mjs';

const $ = s => document.querySelector(s);

const state = {
  offset: 0,
  limit: 12,
  found: 0,
  outOf: 0,
  loading: false,
  lastParams: null,
  controller: null
};

function status(message, kind = '') {
  const el = $('#laStatus');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('error', kind === 'error');
  el.classList.toggle('success', kind === 'success');
}

function errorMessage(error) {
  const map = {
    QUERY_TOO_LONG: 'La recherche dépasse 120 caractères.',
    CATEGORY_INVALID: 'Catégorie inconnue.',
    LIMIT_INVALID: 'Limite invalide.',
    OFFSET_INVALID: 'Page invalide.',
    RATE_LIMITED: 'Trop de recherches à la suite : patientez quelques secondes.',
    LAYERATLAS_COGNITO_FAILED: 'Layer Atlas est indisponible (authentification du catalogue).',
    LAYERATLAS_KEY_FAILED: 'Layer Atlas est indisponible (clé de recherche).',
    LAYERATLAS_SEARCH_FAILED: 'Layer Atlas est indisponible (recherche).'
  };
  let msg = map[error?.code] || 'Recherche impossible pour le moment.';
  if (error?.code === 'RATE_LIMITED' && error.retryAfter) msg = `Trop de recherches : réessayez dans ${error.retryAfter} s.`;
  return msg;
}

function fillSelect(select, values, keepSelection = true) {
  const previous = keepSelection ? select.value : '';
  const keep = new Set([...select.options].map(o => o.value));
  for (const v of values) {
    if (keep.has(v)) continue;
    const opt = document.createElement('option');
    opt.value = v; opt.textContent = v;
    select.appendChild(opt);
  }
  if (previous) select.value = previous;
}

function initFilters() {
  const cat = $('#laCategory');
  for (const c of LAYERATLAS_CATEGORIES) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = `${c.label} · ${c.theme}`;
    cat.appendChild(opt);
  }
  const dl = $('#laSuggestions');
  for (const s of LAYERATLAS_SUGGESTIONS) {
    const opt = document.createElement('option');
    opt.value = s;
    dl.appendChild(opt);
  }
}

function chip(text, cls = '') {
  const span = document.createElement('span');
  span.className = `la-chip ${cls}`.trim();
  span.textContent = text;
  return span;
}

function renderCard(doc) {
  const hit = normalizeHit(doc);
  const card = document.createElement('article');
  card.className = 'la-card';
  card.dataset.id = hit.id;

  const thumbUrl = layerAtlasThumbnailUrl(doc);
  if (thumbUrl) {
    const img = document.createElement('img');
    img.className = 'la-thumb';
    img.loading = 'lazy';
    img.alt = '';
    img.src = thumbUrl;
    img.addEventListener('error', () => img.remove());
    card.appendChild(img);
  }

  const body = document.createElement('div');
  body.className = 'la-card-body';

  const title = document.createElement('h3');
  title.className = 'la-card-title';
  title.textContent = hit.name;
  body.appendChild(title);

  const meta = document.createElement('p');
  meta.className = 'la-card-meta';
  meta.append(
    chip(hit.categoryLabel, 'la-chip-cat'),
    ...(hit.organization ? [chip(hit.organization, 'la-chip-org')] : []),
    ...hit.keywords.slice(0, 4).map(k => chip(k, 'la-chip-kw'))
  );
  body.appendChild(meta);

  if (hit.description) {
    const desc = document.createElement('p');
    desc.className = 'la-card-desc';
    desc.textContent = hit.description;
    body.appendChild(desc);
  }

  const foot = document.createElement('p');
  foot.className = 'la-card-foot';
  foot.append(
    chip(hit.assetTypeLabel, 'la-chip-type'),
    chip(`popularité ${hit.popularity.toLocaleString('fr-FR')}`, 'la-chip-pop')
  );
  if (hit.attributionTitle || hit.attributionURL) {
    const attr = document.createElement('span');
    attr.className = 'la-attribution';
    attr.textContent = `Attribution : ${hit.attributionTitle || '(voir lien)'}`;
    if (hit.attributionURL) {
      const a = document.createElement('a');
      a.href = hit.attributionURL;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = hit.attributionURL.replace(/^https:\/\//, '');
      attr.append(' · ', a);
    }
    foot.appendChild(attr);
  }
  body.appendChild(foot);

  const actions = document.createElement('div');
  actions.className = 'la-card-actions';

  const favBtn = document.createElement('button');
  favBtn.type = 'button';
  favBtn.className = 'button-secondary la-fav-btn';
  const isFav = readFavorites().some(f => f.id === hit.id);
  favBtn.textContent = isFav ? '★ Retirer des favoris' : '☆ Ajouter aux favoris';
  favBtn.addEventListener('click', () => {
    const { added } = toggleFavorite(doc);
    favBtn.textContent = added ? '★ Retirer des favoris' : '☆ Ajouter aux favoris';
    renderFavorites();
    status(added ? `« ${hit.name} » ajouté aux favoris (stockés dans ce navigateur).` : `« ${hit.name} » retiré des favoris.`, 'success');
  });
  actions.appendChild(favBtn);

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'button-secondary';
  copyBtn.textContent = 'Copier la citation';
  copyBtn.addEventListener('click', async () => {
    const citation = buildCitation(doc);
    try {
      await navigator.clipboard.writeText(citation);
      status(`Citation copiée : ${citation}`, 'success');
    } catch {
      status(`Citation : ${citation}`, 'success');
    }
  });
  actions.appendChild(copyBtn);

  const siteLink = document.createElement('a');
  siteLink.className = 'text-button';
  siteLink.href = LAYERATLAS_SITE_URL;
  siteLink.target = '_blank';
  siteLink.rel = 'noopener noreferrer';
  siteLink.textContent = 'Ouvrir layeratlas.com ↗';
  actions.appendChild(siteLink);

  body.appendChild(actions);
  card.appendChild(body);
  return card;
}

function renderFavorites() {
  const ul = $('#laFavorites');
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
    label.textContent = `${fav.name}${fav.organization ? ` — ${fav.organization}` : ''}`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'text-button';
    remove.textContent = '✕';
    remove.title = 'Retirer des favoris';
    remove.addEventListener('click', () => {
      toggleFavorite({ id: fav.id });
      renderFavorites();
      for (const card of document.querySelectorAll('.la-card')) {
        if (card.dataset.id !== fav.id) continue;
        const btn = card.querySelector('.la-fav-btn');
        if (btn) btn.textContent = '☆ Ajouter aux favoris';
      }
      status(`« ${fav.name} » retiré des favoris.`, 'success');
    });
    li.append(label, remove);
    ul.appendChild(li);
  }
}

function renderResults(payload) {
  const box = $('#laResults');
  box.replaceChildren();
  state.found = payload.found;
  state.outOf = payload.outOf;
  if (!payload.hits.length) {
    const p = document.createElement('p');
    p.className = 'la-empty';
    p.textContent = 'Aucune couche publique ne correspond à cette recherche.';
    box.appendChild(p);
  }
  for (const doc of payload.hits) box.appendChild(renderCard(doc));

  const orgValues = payload.facets.find(f => f.field === 'organization')?.counts.map(c => c.value).filter(Boolean) || [];
  fillSelect($('#laOrganization'), orgValues);

  const from = state.offset + 1;
  const to = Math.min(state.offset + payload.hits.length, state.outOf);
  $('#laPageInfo').textContent = state.outOf > 0 ? `${from}–${to} sur ${state.outOf.toLocaleString('fr-FR')}` : '0 résultat';
  $('#laPrev').disabled = state.loading || state.offset === 0;
  $('#laNext').disabled = state.loading || state.offset + state.limit >= state.outOf;
}

async function runSearch() {
  if (state.loading) return;
  const q = $('#laQuery').value;
  const category = $('#laCategory').value;
  const organization = $('#laOrganization').value;
  let params;
  try {
    params = buildSearchParams({ q, category, organization, limit: state.limit, offset: state.offset });
  } catch (error) {
    status(errorMessage(error), 'error');
    return;
  }
  state.loading = true;
  $('#laSearch').disabled = true;
  $('#laPrev').disabled = true;
  $('#laNext').disabled = true;
  status('Recherche envoyée à layeratlas.com (lecture seule) via le serveur UrbaTrame…');
  state.controller?.abort();
  state.controller = new AbortController();
  try {
    const res = await fetch(`${LAYERATLAS_SEARCH_URL}?${params}`, { signal: state.controller.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw Object.assign(new Error(data.error || 'HTTP ' + res.status), { code: data.error, retryAfter: data.retryAfter });
    state.lastParams = params;
    renderResults(data);
    status(`${data.found.toLocaleString('fr-FR')} couche(s) trouvée(s)${data.cached ? ' (réponse en cache)' : ''} — métadonnées publiques Layer Atlas. Aucune donnée locale transmise.`, 'success');
  } catch (error) {
    if (error.name === 'AbortError') return;
    status(errorMessage(error), 'error');
  } finally {
    state.loading = false;
    $('#laSearch').disabled = false;
    if (state.lastParams) {
      $('#laPrev').disabled = state.offset === 0;
      $('#laNext').disabled = state.offset + state.limit >= state.outOf;
    }
  }
}

function init() {
  if (!$('#layeratlasPanel')) return;
  initFilters();
  renderFavorites();
  $('#laSearch').addEventListener('click', () => { state.offset = 0; runSearch(); });
  $('#laQuery').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); state.offset = 0; runSearch(); } });
  $('#laCategory').addEventListener('change', () => { state.offset = 0; runSearch(); });
  $('#laOrganization').addEventListener('change', () => { state.offset = 0; runSearch(); });
  $('#laPrev').addEventListener('click', () => { state.offset = Math.max(0, state.offset - state.limit); runSearch(); });
  $('#laNext').addEventListener('click', () => { state.offset += state.limit; runSearch(); });
}

init();
