/* Freemap · application
   Orchestration : catalogue, plan partagé, appels réseau, vérification des
   licences signées Ed25519, rendu des cartes, exports, interface.
   ───────────────────────────────────────────────────────────────────────── */
import { plan, FREE_IDS, MAX_IDS, LIMITS, DEPS, VERSION } from './plan-2d.mjs';
import { Routes, errText } from './routes.mjs';
import { store, deviceId, cacheClear } from './persist.mjs';
import { normalizeElements, dedupe } from './osm.mjs';

const CAT = globalThis.FMCatalog, RND = globalThis.FMRender, ENG = globalThis.FMEngine;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

/* ─────────── état ─────────── */
const S = {
  lang: 'fr',
  device: deviceId(),
  session: store.get('session', null),
  ent: store.get('ent', null),
  tier: 'free',
  access: 'licence',   /* 'open' = période d'essai ouverte, annoncée par /api/status */
  pub: null,
  D: { roads: [], build: [], green: [], pois: [] },
  terrain: null,
  climate: null,
  site: { lat: null, lon: null, R: 600, name: '' },
  shape: store.get('shape', 'circle'),
  poly: null,                                  // polygone de site (mode poly)
  sel: new Set(store.get('sel', FREE_IDS.slice())),
  pal: store.get('pal', {}),                   // id → index de palette
  names: store.get('names', {}),               // id → titre personnalisé
  noText: new Set(store.get('noText', [])),
  time: store.get('time', 12),
  busy: false,
  routes: null,
  cacheInfo: ''
};
S.routes = new Routes('', m => log(m));

/* ─────────── i18n minimal ─────────── */
const T = (fr, en) => (S.lang === 'en' ? en : fr);
const REFRESH_KEYS = ['gen', 'search', 'radius', 'shape', 'catalog', 'help', 'plans', 'theme'];

function applyLang() {
  document.documentElement.lang = S.lang;
  $$('[data-fr]').forEach(el => {
    const fr = el.dataset.fr, en = el.dataset.en || fr;
    if (el.tagName === 'INPUT') el.placeholder = T(fr, en); else el.textContent = T(fr, en);
  });
  renderCatalog();
  $('#langBtn').textContent = S.lang === 'fr' ? 'EN' : 'FR';
}

/* ─────────── journal ─────────── */
function log(msg) {
  const el = $('#log');
  if (!el) return;
  const line = document.createElement('div');
  const time = new Date().toLocaleTimeString(S.lang === 'fr' ? 'fr-FR' : 'en-GB', { hour12: false });
  line.textContent = time + ' · ' + msg;
  el.prepend(line);
  while (el.children.length > 60) el.lastChild.remove();
}

function toast(msg, ok = true) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (ok ? '' : ' err');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.className = 'toast'; }, 4200);
}

/* ═══════════════ licences : vérification Ed25519 ═══════════════ */
const b64uToBytes = s => {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
};
let PUB_KEY = null;
async function loadPublicKey() {
  try {
    const d = await (await fetch('/api/status')).json();
    S.pub = d.pub;
    /* Mode d'accès : `open` = toutes les analyses ouvertes (période d'essai). */
    if (d.access === 'open' || d.access === 'licence') S.access = d.access;
    PUB_KEY = await crypto.subtle.importKey(
      'raw', b64uToBytes(d.pub), { name: 'Ed25519' }, false, ['verify']);
    log(`clé publique Ed25519 chargée (${d.pub.slice(0, 12)}…)`);
  } catch (e) { log('clé publique indisponible : ' + e.message); }
}
/* Vérifie le jeton signé : signature + version + niveau + appareil + expiration. */
async function verifyEnt(raw) {
  if (!raw || !PUB_KEY) return null;
  try {
    const [body, sig] = String(raw).split('.');
    if (!body || !sig) return null;
    const ok = await crypto.subtle.verify('Ed25519', PUB_KEY, b64uToBytes(sig), new TextEncoder().encode(body));
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(b64uToBytes(body)));
    if (!p || p.v !== 1 || (p.t !== 'pro' && p.t !== 'max')) return null;
    if (p.d !== S.device || p.x <= Date.now()) return null;
    return p;
  } catch { return null; }
}
async function refreshEntitlement() {
  const ent = await verifyEnt(S.ent);
  let tier = 'free', exp = null;
  if (ent) { tier = ent.t; exp = ent.x; }
  else if (S.ent) { store.set('ent', null); S.ent = null; }
  const changed = tier !== S.tier;
  S.tier = tier;
  if (S.access === 'open') { applyAccessLabel(); return tier; }
  $('#badge').textContent = tier === 'max' ? 'MAX ✓' : tier === 'pro' ? 'PRO ✓' : T('ESSAI', 'TRIAL');
  $('#badge').className = 'badge ' + tier;
  if (exp) log(`licence ${tier.toUpperCase()} valable jusqu'au ${new Date(exp).toLocaleDateString('fr-FR')}`);
  if (changed) { renderCatalog(); renderCards(); }
  return tier;
}
/* Période d'essai ouverte : tout est débloqué, sans licence ni filigrane. */
const isOpenAccess = () => S.access === 'open';
const isPaid = () => isOpenAccess() || S.tier === 'pro' || S.tier === 'max';
function applyAccessLabel() {
  const b = $('#badge');
  b.textContent = T('LIBRE', 'OPEN');
  b.className = 'badge open';
  const btn = $('#plansBtn');
  if (btn) btn.textContent = T('Accès libre', 'Open access');
  document.body.classList.toggle('open-access', isOpenAccess());
}
const unlocked = id => {
  if (isOpenAccess()) return true;
  const a = CAT.find(x => x.id === id);
  if (!a) return false;
  if (a.tier === 'free') return true;
  if (a.tier === 'pro') return S.tier === 'pro' || S.tier === 'max';
  return S.tier === 'max';
};

/* ═══════════════ catalogue ═══════════════ */
function renderCatalog() {
  const host = $('#catalog');
  host.innerHTML = '';
  for (const [gk, label] of Object.entries(globalThis.FM_GROUPS)) {
    const items = CAT.filter(a => a.g === gk);
    if (!items.length) continue;
    const g = document.createElement('section');
    g.className = 'group';
    const okCount = items.filter(a => S.sel.has(a.id)).length;
    g.innerHTML = `<h3>${T(label[0], label[1])}<span>${okCount}/${items.length}</span></h3>
      <div class="items"><button class="mini" data-all="${gk}">${T('tout', 'all')}</button>
      <button class="mini" data-none="${gk}">${T('aucun', 'none')}</button></div>`;
    for (const a of items) {
      const sel = S.sel.has(a.id), un = unlocked(a.id);
      const row = document.createElement('label');
      row.className = 'item' + (sel ? ' on' : '') + (un && a.impl ? '' : ' locked') + (a.impl ? '' : ' soon');
      const limit = LIMITS[a.id];
      row.innerHTML = `
        <input type="checkbox" ${sel ? 'checked' : ''} ${(un && a.impl) ? '' : 'disabled'} data-id="${a.id}">
        <span class="txt"><b>${T(a.nom, a.en)}</b><i>${T(a.sub, a.sub)}</i></span>
        <span class="tags">
          <em>${a.tag}</em>
          ${a.tier === 'free' ? '' : a.tier === 'max' ? '<em class="max">MAX</em>' : '<em class="pro">PRO</em>'}
          ${a.impl ? '' : '<em class="soon">v0.2</em>'}
        </span>
        <span class="limit">${limit} m</span>`;
      row.querySelector('input').addEventListener('change', e => {
        if (e.target.checked) S.sel.add(a.id); else S.sel.delete(a.id);
        store.set('sel', [...S.sel]);
        updateGenBtn(); renderCatalog();
      });
      host.appendChild(g);
      g.querySelector('.items').after(row);
    }
    g.querySelector('[data-all]')?.addEventListener('click', () => {
      items.filter(a => a.impl && unlocked(a.id)).forEach(a => S.sel.add(a.id));
      store.set('sel', [...S.sel]); renderCatalog(); updateGenBtn();
    });
    g.querySelector('[data-none]')?.addEventListener('click', () => {
      items.forEach(a => S.sel.delete(a.id));
      store.set('sel', [...S.sel]); renderCatalog(); updateGenBtn();
    });
  }
  updateGenBtn();
}

function selected() { return CAT.filter(a => S.sel.has(a.id) && a.impl && unlocked(a.id)).map(a => a.id); }
function updateGenBtn() {
  const n = selected().length;
  const b = $('#gen');
  b.textContent = n ? T(`Générer les analyses (${n})`, `Generate analyses (${n})`) : T('Générer les analyses', 'Generate analyses');
  b.classList.toggle('ready', n > 0);
  const skipped = selected().filter(id => S.site.R > LIMITS[id]);
  $('#warn').textContent = skipped.length
    ? T(`${skipped.length} analyse(s) dépassent leur rayon maximal à ${S.site.R} m`,
        `${skipped.length} analysis/analyses exceed their max radius at ${S.site.R} m`)
    : '';
}

/* ═══════════════ contexte de rendu ═══════════════ */
function ctxFor(id) {
  const pal = S.pal[id] || 0;
  return {
    sLat: S.site.lat, sLng: S.site.lon, curR: S.site.R,
    shape: S.shape, sitePolygon: S.poly,
    isPro: isPaid(), lang: S.lang === 'en' ? 'en' : 'fr',
    watermark: !isOpenAccess(), time: S.time, siteName: S.site.name,
    D: S.D, terrain: S.terrain, climate: S.climate, noSiteMark: false
  };
}
function renderOne(id) {
  const fn = RND[id];
  if (!fn) return ENG.blank(ctxFor(id), 'ANALYSE NON IMPLÉMENTÉE');
  let svg;
  try { svg = fn(ctxFor(id), S.pal[id] || 0); }
  catch (e) { console.error(id, e); svg = ENG.blank(ctxFor(id), 'ERREUR DE RENDU'); }
  if (S.noText.has(id)) svg = svg.replace(/<text\b[\s\S]*?<\/text>/g, '');
  return svg;
}

/* ═══════════════ cartes ═══════════════ */
function renderCards() {
  const ids = selected();
  const grid = $('#grid');
  grid.innerHTML = '';
  if (!ids.length) {
    grid.innerHTML = `<p class="empty">${T('Sélectionnez des analyses, puis lancez la génération.', 'Pick analyses, then generate.')}</p>`;
    return;
  }
  ids.forEach((id, i) => {
    const a = CAT.find(x => x.id === id);
    const card = document.createElement('article');
    card.className = 'card';
    card.id = 'card_' + id;
    card.innerHTML = `
      <header>
        <span class="num">${String(i + 1).padStart(2, '0')}</span>
        <span class="title" contenteditable="true" spellcheck="false">${esc(S.names[id] || T(a.nom, a.en))}</span>
        <span class="tag">${a.tag}</span>
        <span class="ctl">
          <button title="${T('palette suivante', 'next palette')}" data-pal>◨</button>
          <button title="${T('texte on/off', 'text on/off')}" data-txt class="${S.noText.has(id) ? 'off' : ''}">✎</button>
          <button title="SVG" data-svg>SVG</button>
          <button title="PNG ×3" data-png>PNG</button>
        </span>
      </header>
      <div class="body">${renderOne(id)}</div>
      <footer class="note">${T('données © OpenStreetMap', 'data © OpenStreetMap')}</footer>`;
    card.querySelector('.title').addEventListener('blur', e => {
      S.names[id] = e.target.textContent.trim().slice(0, 60);
      store.set('names', S.names);
    });
    card.querySelector('[data-pal]').addEventListener('click', () => {
      S.pal[id] = ((S.pal[id] || 0) + 1) % 6;
      store.set('pal', S.pal);
      card.querySelector('.body').innerHTML = renderOne(id);
    });
    card.querySelector('[data-txt]').addEventListener('click', e => {
      S.noText.has(id) ? S.noText.delete(id) : S.noText.add(id);
      store.set('noText', [...S.noText]);
      e.currentTarget.classList.toggle('off', S.noText.has(id));
      card.querySelector('.body').innerHTML = renderOne(id);
    });
    card.querySelector('[data-svg]').addEventListener('click', () => downloadSVG(id, card));
    card.querySelector('[data-png]').addEventListener('click', () => downloadPNG(id, card));
    grid.appendChild(card);
  });
  renderMiniMap();
}

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const svgOf = card => card.querySelector('svg');
function download(blob, name) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = u; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(u), 4000);
}
function downloadSVG(id, card) {
  const svg = svgOf(card).outerHTML;
  download(new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + svg], { type: 'image/svg+xml' }),
    `freemap-${id}.svg`);
  log('export SVG · ' + id);
}
function downloadPNG(id, card) {
  const svg = svgOf(card);
  const scale = 3;
  const xml = new XMLSerializer().serializeToString(svg);
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = 240 * scale; c.height = 268 * scale;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    x.drawImage(img, 0, 0, c.width, c.height);
    c.toBlob(b => download(b, `freemap-${id}.png`), 'image/png');
    log('export PNG ×' + scale + ' · ' + id);
  };
  img.onerror = () => toast(T('Export PNG impossible', 'PNG export failed'), false);
  img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
}

/* ═══════════════ aperçu du site ═══════════════ */
function renderMiniMap() {
  const host = $('#mini');
  if (!host) return;
  if (S.site.lat == null) { host.innerHTML = ''; return; }
  const W = 260, H = 170, pad = 6;
  const d = S.site.R / 111320, dl = d / Math.cos(S.site.lat * Math.PI / 180);
  const pr = (lat, lon) => [
    pad + (lon - (S.site.lon - dl)) / (2 * dl) * (W - pad * 2),
    pad + ((S.site.lat + d) - lat) / (2 * d) * (H - pad * 2)
  ];
  let s = `<svg viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#fff"/>`;
  for (const b of S.D.green || []) {
    const pts = b.g.map(p => pr(p[0], p[1]).map(v => v.toFixed(1)).join(','));
    if (pts.length > 2) s += `<polygon points="${pts.join(' ')}" fill="${b.k === 'w' ? '#B7D3E2' : '#D6E8CB'}"/>`;
  }
  for (const r of S.D.roads || []) {
    const pts = r.g.map(p => pr(p[0], p[1]).map(v => v.toFixed(1)).join(','));
    if (pts.length > 1) s += `<polyline points="${pts.join(' ')}" fill="none" stroke="${/motorway|trunk|primary/.test(r.h) ? '#2A2824' : '#C9C6C0'}" stroke-width="${/motorway|trunk|primary/.test(r.h) ? 1.4 : .7}"/>`;
  }
  for (const b of S.D.build || []) {
    const pts = b.g.map(p => pr(p[0], p[1]).map(v => v.toFixed(1)).join(','));
    if (pts.length > 2) s += `<polygon points="${pts.join(' ')}" fill="#2E2C28"/>`;
  }
  for (const p of S.D.pois || []) {
    const [x, y] = pr(p.y, p.x);
    s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.2" fill="#C0392B"/>`;
  }
  const [sx, sy] = pr(S.site.lat, S.site.lon);
  s += `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="4" fill="none" stroke="#C0392B" stroke-width="1.4"/>
        <circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="1.4" fill="#C0392B"/></svg>`;
  host.innerHTML = s;
}

/* ═══════════════ chargement (étapes) ═══════════════ */
function stages(planObj, extra) {
  const list = [{ id: 'prepare', fr: 'Préparation de la sélection', en: 'Preparing selection' }];
  for (const g of planObj.groups)
    list.push({ id: 'g_' + g.id, fr: g.fr, en: g.en });
  if (planObj.climate) list.push({ id: 'climate', fr: 'Lecture des séries NASA POWER', en: 'Reading NASA POWER series' });
  if (planObj.terrain) list.push({ id: 'terrain', fr: 'Échantillonnage de l\'altimétrie', en: 'Sampling elevation' });
  list.push({ id: 'render', fr: 'Composition des diagrammes', en: 'Composing diagrams' });
  return list;
}
function drawLoader(list, state, startedAt) {
  const host = $('#loader');
  if (!list.length) { host.classList.remove('on'); return; }
  host.classList.add('on');
  const done = list.filter(s => ['done', 'failed'].includes(state[s.id])).length;
  const pct = Math.min(97, Math.round(done / list.length * 100));
  const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
  host.innerHTML = `
    <div class="box">
      <h2>${T('GÉNÉRATION EN COURS', 'GENERATING')} <small>${done}/${list.length}</small></h2>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <ol>${list.map(s => `<li class="${state[s.id] || 'pending'}">${
        { done: '✓', failed: '!', active: '●', pending: '○' }[state[s.id] || 'pending']} ${T(s.fr, s.en)}</li>`).join('')}</ol>
      <p class="eta">${secs} s</p>
    </div>`;
  if (done === list.length) setTimeout(() => host.classList.remove('on'), 500);
}

/* ═══════════════ génération ═══════════════ */
async function generate() {
  if (S.busy) return;
  const ids = selected();
  if (!ids.length) { toast(T('Sélectionnez au moins une analyse', 'Pick at least one analysis'), false); return; }
  if (S.site.lat == null) { toast(T('Cherchez d\'abord un lieu', 'Search a place first'), false); return; }

  let p;
  try { p = plan(ids, S.site.R, S.site.lat, S.site.lon); }
  catch (e) { toast(errText(e.message, S.lang), false); log('plan refusé : ' + e.message); return; }
  if (p.skipped.length)
    log(`rayon ${S.site.R} m : ${p.skipped.length} analyse(s) ignorée(s) (${p.skipped.join(', ')})`);

  S.busy = true;
  const list = stages(p, null);
  const state = {}; state.prepare = 'done';
  const t0 = Date.now();
  const tick = setInterval(() => drawLoader(list, state, t0), 500);
  drawLoader(list, state, t0);

  const freeRun = p.selected.every(id => FREE_IDS.includes(id));
  /* En accès libre, l'échec du serveur n'est jamais bloquant : on se rabat
     toujours sur les miroirs publics interrogés par le navigateur. */
  const softTrial = freeRun || isOpenAccess();
  let run = null, useServer = isOpenAccess() || !freeRun;

  try {
    /* 1 · ouverture de session (le serveur rejoue le plan de son côté) */
    try {
      const b = await S.routes.begin(p.selected, S.site.R, S.site.lat, S.site.lon,
        { device: S.device, session: S.session, free: freeRun });
      run = b.run;
      log(`session ouverte · ${run.slice(0, 8)} · mode ${b.tier}${b.access === 'open' ? ' (accès libre)' : ''}`);
      useServer = isOpenAccess() || !freeRun;
    } catch (e) {
      const code = e.error || e.message;
      if (!softTrial) {
        if (code === 'LICENCE_REQUIRED') { openPlans(); throw new Error('licence refusée par le serveur'); }
        if (code === 'GENERATION_IN_PROGRESS' || code === 'RATE_LIMITED') {
          toast(errText(code, S.lang) + (e.retryAfter ? ` (${e.retryAfter} s)` : ''), false);
          throw e;
        }
      }
      /* essai gratuit : le serveur n'est pas indispensable, on continue en direct */
      log('serveur indisponible → Overpass public directement (' + code + ')');
    }

    /* 2 · données OSM, par groupe */
    const acc = { roads: [], build: [], green: [], pois: [] };
    for (const g of p.groups) {
      state['g_' + g.id] = 'active'; drawLoader(list, state, t0);
      let els = null;
      if (useServer && run) {
        try {
          const r = await S.routes.query(run, g.id, { device: S.device, session: S.session });
          els = r.elements;
          log(`groupe ${g.id} · ${els.length} éléments (serveur)`);
        } catch (e) {
          log(`groupe ${g.id} · serveur en échec (${e.error || e.message}) → Overpass public`);
        }
      }
      if (!els) {
        const d = await S.routes.overpassDirect(g.query, 60_000);
        els = d.elements;
        if (d._cache) S.cacheInfo = T('données en cache', 'cached data');
        log(`groupe ${g.id} · ${els.length} éléments (public)`);
      }
      normalizeElements(acc, dedupe(els));
      state['g_' + g.id] = 'done'; drawLoader(list, state, t0);
    }
    S.D = acc;

    /* 3 · sources annexes */
    if (p.climate) {
      state.climate = 'active'; drawLoader(list, state, t0);
      try { S.climate = await S.routes.climate(S.site.lat, S.site.lon, S.device); log('climat NASA POWER chargé'); state.climate = 'done'; }
      catch (e) { S.climate = null; state.climate = 'failed'; log('climat indisponible (' + (e.error || e.message) + ')'); }
    }
    if (p.terrain) {
      state.terrain = 'active'; drawLoader(list, state, t0);
      try {
        S.terrain = await S.routes.terrain(S.site.lat, S.site.lon, S.site.R, 24, S.device);
        log(`altimétrie ${S.terrain.n}×${S.terrain.n} (zoom ${S.terrain.zoom})`);
        state.terrain = 'done';
      } catch (e) { S.terrain = null; state.terrain = 'failed'; log('altimétrie indisponible (' + (e.error || e.message) + ')'); }
    }

    state.render = 'done';
    renderCards();
    updateGenBtn();
    log(`terminé en ${((Date.now() - t0) / 1000).toFixed(1)} s · ${acc.build.length} emprises, ${acc.roads.length} tronçons, ${acc.green.length} polygones, ${acc.pois.length} POI`);
  } catch (e) {
    if (e.error) toast(errText(e.error, S.lang), false);
    else toast(String(e.message || e), false);
    log('échec : ' + (e.error || e.message));
  } finally {
    clearInterval(tick);
    state.render = state.render || 'done';
    drawLoader([], state, t0);
    if (run) S.routes.end(run, { device: S.device, session: S.session });
    S.busy = false;
  }
}

/* ═══════════════ exemple embarqué ═══════════════
   Extrait réel capturé depuis OpenStreetMap + NASA POWER + Terrarium :
   permet d'utiliser l'application sans dépendre d'Overpass au premier essai. */
async function loadSample() {
  try {
    log('chargement de l\'exemple (El Khroub, Constantine)…');
    const d = await (await fetch('data/sample-elkhroub.json')).json();
    S.site.lat = d.site.lat; S.site.lon = d.site.lon; S.site.R = d.site.R; S.site.name = d.site.name;
    $('#q').value = d.site.name;
    $('#radius').value = d.site.R; $('#radiusOut').textContent = d.site.R + ' m';
    S.D = normalizeElements(null, dedupe(d.elements));
    S.terrain = d.terrain || null;
    S.climate = d.climate || null;
    S.cacheInfo = T('exemple embarqué', 'bundled sample');
    setSite(d.site.lat, d.site.lon, d.site.name);
    renderCards(); updateGenBtn();
    log(`exemple : ${S.D.build.length} emprises · ${S.D.roads.length} tronçons · ${S.D.green.length} vert/eau · ${S.D.pois.length} POI`
        + (S.terrain ? ` · altimétrie ${S.terrain.n}×${S.terrain.n}` : '')
        + (S.climate ? ' · climat NASA POWER' : ''));
    toast(isOpenAccess() ? T('Exemple chargé.', 'Sample loaded.') : T('Exemple chargé — changez de palier pour voir les analyses Pro.', 'Sample loaded — switch tier to see the Pro analyses.'));
  } catch (e) { toast(T('Exemple indisponible', 'Sample unavailable'), false); log('exemple : ' + e.message); }
}

/* ═══════════════ recherche & site ═══════════════ */
async function doSearch() {
  const q = $('#q').value.trim();
  if (!q) return;
  if (/^-?\d+(\.\d+)?\s*[,;]\s*-?\d+(\.\d+)?$/.test(q)) {
    const [lat, lon] = q.split(/[,;]/).map(Number);
    setSite(lat, lon, `${lat.toFixed(4)}, ${lon.toFixed(4)}`);
    return;
  }
  log('géocodage · ' + q);
  try {
    const d = await S.routes.geocode(q);
    if (!d.length) { toast(T('Lieu introuvable', 'Place not found'), false); return; }
    const it = d[0];
    setSite(parseFloat(it.lat), parseFloat(it.lon), (it.display_name || '').split(',').slice(0, 3).join(', '));
  } catch (e) { toast(T('Géocodage en échec', 'Geocoding failed'), false); log('géocodage : ' + (e.message || e)); }
}
function setSite(lat, lon, name) {
  S.site.lat = lat; S.site.lon = lon; S.site.name = name;
  $('#siteInfo').innerHTML = `<b>${esc(name)}</b><span>${lat.toFixed(5)}°, ${lon.toFixed(5)}° · r = ${S.site.R} m</span>`;
  log(`site · ${name} (${lat.toFixed(5)}, ${lon.toFixed(5)})`);
  updateGenBtn();
}

/* ═══════════════ modales ═══════════════ */
function openModal(id) { $('#' + id).classList.add('on'); }
function closeModal(id) { $('#' + id).classList.remove('on'); }
function openPlans() {
  const p = $('#planBody');
  if (isOpenAccess()) {
    p.innerHTML = `
    <div class="plans-open">
      <h3>${T('Accès libre', 'Open access')}</h3>
      <p>${T(
        'Pendant la période d\'essai, <strong>toutes les analyses sont ouvertes</strong> : ni licence, ni filigrane, ni limite de génération.',
        'During the trial period, <strong>every analysis is open</strong>: no licence, no watermark, no generation limit.')}</p>
      <p class="fine">${T(
        'Les abonnements Pro et Max seront proposés plus tard. Cette page les présentera à ce moment-là.',
        'Pro and Max subscriptions will come later. This page will show them then.')}</p>
    </div>`;
    return;
  }
  p.innerHTML = `
    <div class="plans">
      <section class="plan">
        <h3>Pro</h3><div class="per">${T('Pass 30 jours', '30-day pass')}</div><strong>7,99 €</strong>
        <ul><li>${T('Toutes les analyses 2D', 'All 2D analyses')}</li>
        <li>${T('Sans filigrane', 'No watermark')}</li>
        <li>${T('Exports SVG & PNG', 'SVG & PNG exports')}</li></ul>
        <button class="buy" data-buy="pro">${T('Choisir Pro', 'Choose Pro')}</button>
      </section>
      <section class="plan max">
        <h3>Max <span class="badge-s">${T('le plus choisi', 'most chosen')}</span></h3>
        <div class="per">${T('Pass 30 jours', '30-day pass')}</div><strong>12,99 €</strong>
        <ul><li>${T('Tout Pro', 'Everything in Pro')}</li>
        <li>${T('Planches composées', 'Composed boards')}</li>
        <li>${T('Volume, terrain, climat', 'Massing, terrain, climate')}</li></ul>
        <button class="buy" data-buy="max">${T('Choisir Max', 'Choose Max')}</button>
      </section>
      <section class="plan">
        <h3>${T('À vie', 'Lifetime')}</h3><div class="per">${T('Max, pour toujours', 'Max, forever')}</div><strong>49,00 €</strong>
        <ul><li>${T('Tout Max', 'Everything in Max')}</li>
        <li>${T('Sans expiration', 'No expiry')}</li>
        <li>${T('Restauration par code', 'Restore by code')}</li></ul>
        <button class="buy" data-buy="lifetime">${T('Prendre à vie', 'Go Lifetime')}</button>
      </section>
    </div>
    <div class="activate">
      <label>${T('Vous avez un code de licence ?', 'Have a licence code?')}
        <input id="licCode" type="text" placeholder="cs_…" value=""></label>
      <button id="licGo">${T('Activer', 'Activate')}</button>
    </div>
    <p class="fine">${T('Clone d\'étude : aucun paiement réel. Pour éprouver le parcours d\'achat, activez un des codes de démonstration ci-dessous.',
      'Study clone: no real payment. To exercise the purchase flow, activate one of the demo codes below.')}</p>
    <div class="row" style="margin-top:12px">
      <button id="restoreBtn" data-fr="Restaurer la licence enregistrée" data-en="Restore stored licence">Restaurer la licence enregistrée</button>
    </div>
    <p class="fine mono">cs_demo_pro · cs_demo_max · cs_demo_lifetime</p>`;
  p.querySelectorAll('[data-buy]').forEach(b => b.addEventListener('click', () => {
    const map = { pro: 'cs_demo_pro', max: 'cs_demo_max', lifetime: 'cs_demo_lifetime' };
    $('#licCode').value = map[b.dataset.buy];
    toast(T('Code de démonstration inséré — validez pour activer.', 'Demo code filled — confirm to activate.'));
  }));
  p.querySelector('#licGo').addEventListener('click', () => activate($('#licCode').value.trim()));
  p.querySelector('#restoreBtn').addEventListener('click', restore);
  openModal('plans');
}
async function activate(code) {
  if (!code) return;
  try {
    const d = await S.routes.activate(code, S.device);
    if (d.error) { toast(errText(d.error, S.lang), false); return; }
    S.session = { account: d.account, token: d.token };
    store.set('session', S.session);
    store.set('rcode', code);
    if (d.ent) { S.ent = d.ent; store.set('ent', d.ent); }
    await refreshEntitlement();
    closeModal('plans');
    toast(T('Licence activée', 'Licence activated'));
    log(`licence ${S.tier.toUpperCase()} activée (appareil ${S.device.slice(0, 8)}…)`);
  } catch (e) { toast(errText(e.error || e.message, S.lang), false); }
}
async function restore() {
  const code = store.get('rcode', null);
  if (!code) { toast(T('Aucun code enregistré sur cet appareil', 'No stored code on this device'), false); return; }
  await activate(code);
}

/* ═══════════════ démarrage ═══════════════ */
function wireUI() {
  $('#langBtn').addEventListener('click', () => {
    S.lang = S.lang === 'fr' ? 'en' : 'fr';
    store.set('lang', S.lang);
    applyLang();
    if (S.D.build.length || S.D.roads.length) renderCards();
  });
  $('#search').addEventListener('click', doSearch);
  $('#sample')?.addEventListener('click', loadSample);
  $('#q').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
  $('#radius').addEventListener('input', e => {
    S.site.R = +e.target.value;
    $('#radiusOut').textContent = S.site.R + ' m';
    if (S.site.name) $('#siteInfo').querySelector('span').textContent =
      `${S.site.lat.toFixed(5)}°, ${S.site.lon.toFixed(5)}° · r = ${S.site.R} m`;
    updateGenBtn();
  });
  $('#shape').addEventListener('change', e => {
    S.shape = e.target.value; store.set('shape', S.shape);
    const rw = $('#radiusWrap'); if (rw) rw.style.opacity = S.shape === 'poly' ? '.45' : '1';
    renderCards();
  });
  $('#time').addEventListener('input', e => {
    S.time = +e.target.value;
    const h = Math.floor(S.time), m = Math.round((S.time % 1) * 60);
    $('#timeOut').textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    store.set('time', S.time);
    if (S.sel.has('sun')) {
      const card = $('#card_sun'); if (card) card.querySelector('.body').innerHTML = renderOne('sun');
    }
  });
  $('#gen').addEventListener('click', generate);
  $('#clear').addEventListener('click', () => {
    S.D = { roads: [], build: [], green: [], pois: [] }; S.terrain = null; S.climate = null;
    renderCards(); log('carte vidée');
  });
  $('#cacheBtn').addEventListener('click', async () => {
    await cacheClear(); toast(T('Cache des requêtes vidé', 'Query cache cleared'));
    log('cache IndexedDB vidé');
  });
  $('#plansBtn').addEventListener('click', openPlans);
  $('#restoreBtn')?.addEventListener('click', restore);
  $('#helpBtn').addEventListener('click', () => openModal('help'));
  $('#devBtn').addEventListener('click', () => {
    const d = $('#devPanel');
    d.classList.toggle('on');
    if (d.classList.contains('on')) renderDev();
  });
  $('#theme').addEventListener('click', e => {
    const b = e.target.closest('button[data-th]');
    if (!b) return;
    const off = +b.dataset.th;
    for (const id of selected()) S.pal[id] = off % 6;
    store.set('pal', S.pal);
    renderCards();
    $$('#theme button').forEach(x => x.classList.toggle('on', x === b));
  });
  $$('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('.modal').classList.remove('on')));
  $$('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m) m.classList.remove('on'); }));
  $('#expAll').addEventListener('click', async () => {
    for (const id of selected()) {
      const card = $('#card_' + id);
      if (card) downloadSVG(id, card);
      await new Promise(r => setTimeout(r, 250));
    }
    toast(T('Exports SVG lancés', 'SVG exports started'));
  });
  $('#print').addEventListener('click', () => {
    document.body.classList.add('printing');
    window.print();
    setTimeout(() => document.body.classList.remove('printing'), 800);
  });
}

function renderDev() {
  const d = $('#devPanel');
  const rows = [
    ['appareil', S.device],
    ['niveau', S.tier],
    ['session', S.session ? S.session.account : '—'],
    ['jeton signé', S.ent ? S.ent.slice(0, 34) + '…' : '—'],
    ['clé publique', S.pub ? S.pub.slice(0, 26) + '…' : 'indisponible'],
    ['site', S.site.lat != null ? `${S.site.lat.toFixed(5)}, ${S.site.lon.toFixed(5)}` : '—'],
    ['données', `${S.D.build.length} bât. · ${S.D.roads.length} voirie · ${S.D.green.length} vert · ${S.D.pois.length} POI`],
    ['altimétrie', S.terrain ? `${S.terrain.n}×${S.terrain.n} z${S.terrain.zoom}` : '—'],
    ['climat', S.climate ? 'NASA POWER' : '—'],
    ['cache', S.cacheInfo || '—'],
    ['version', VERSION]
  ];
  d.innerHTML = '<h4>état interne</h4><table>' + rows.map(([k, v]) =>
    `<tr><td>${esc(k)}</td><td>${esc(String(v))}</td></tr>`).join('') + '</table>';
}

async function init() {
  const qp = new URLSearchParams(location.search);
  S.lang = store.get('lang', qp.get('lang') || (navigator.language || 'fr').slice(0, 2) === 'en' ? 'en' : 'fr');
  if (qp.get('lang')) S.lang = qp.get('lang') === 'en' ? 'en' : 'fr';
  if (qp.get('free') === '1') { S.sel = new Set(FREE_IDS); }
  $$('#theme button').forEach((b, i) => b.classList.toggle('on', i === 0));

  wireUI();
  applyLang();
  $('#radius').value = S.site.R;
  $('#radiusOut').textContent = S.site.R + ' m';
  $('#shape').value = S.shape;
  $('#time').value = S.time;
  $('#timeOut').textContent = String(Math.floor(S.time)).padStart(2, '0') + ':00';

  await loadPublicKey();
  /* licence : relecture au démarrage puis vérification serveur */
  if (S.session) {
    try {
      const d = await S.routes.check(S.device, S.session);
      if (d.ent) { S.ent = d.ent; store.set('ent', d.ent); }
      else if (d.error) { S.session = null; store.set('session', null); store.set('ent', null); S.ent = null; }
    } catch (e) { log('vérification serveur indisponible : ' + (e.message || e)); }
  }
  await refreshEntitlement();

  if (qp.get('upgrade')) openPlans();
  if (qp.get('sample') === '1') setTimeout(loadSample, 300);
  if (qp.get('q')) {
    $('#q').value = qp.get('q');
    setTimeout(doSearch, 400);
  }
  log(isOpenAccess()
    ? `prêt · ${T('accès libre — toutes les analyses, sans filigrane', 'open access — every analysis, no watermark')}`
    : `prêt · ${T('essai gratuit = 4 analyses filigranées', 'free trial = 4 watermarked analyses')}`);
}

init();
window.addEventListener('beforeprint', () => document.body.classList.add('printing'));
