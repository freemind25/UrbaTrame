/* Freemap · application
   Orchestration : catalogue, plan partagé, appels réseau, vérification des
   licences signées Ed25519, rendu des cartes, exports, interface.
   ───────────────────────────────────────────────────────────────────────── */
import { plan, FREE_IDS, MAX_IDS, LIMITS, DEPS, VERSION } from './plan-2d.mjs';
import { Routes, errText } from './routes.mjs';
import { store, deviceId, cacheClear } from './persist.mjs';
import { normalizeElements, dedupe } from './osm.mjs';
import { ouvrir3D } from './vue3d-ui.mjs';
import { ouvrirExports } from './exports-ui.mjs';
import { svgElementToPngBlob } from './png-export.mjs';
import { summarizeSite, calculateFeasibility } from './site-summary.mjs';
import { buildConceptMassing, conceptMeshScene, renderConceptMassingSvg } from './concept-massing.mjs';
import { objDeScene, stlDeScene } from './exports.mjs';

const CAT = globalThis.FMCatalog, RND = globalThis.FMRender, ENG = globalThis.FMEngine;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const validISODate = value => {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(value || ''))) return false;
  const d = new Date(value + 'T00:00:00Z');
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
};
const storedSunDate = store.get('sunDate', '');

/* ─────────── état ─────────── */
const S = {
  lang: 'fr',
  device: deviceId(),
  session: store.get('session', null),
  ent: store.get('ent', null),
  tier: 'free',
  access: 'licence',   /* 'open' = période d'essai ouverte, annoncée par /api/status */
  pub: null,
  D: { roads: [], build: [], green: [], pois: [], rail: [], coast: [] },
  terrain: null,
  climate: null,
  windrose: null,
  mapLoaded: false,
  dataSite: null,                                // contexte exact des couches déjà chargées
  site: { lat: null, lon: null, R: 600, name: '' },
  shape: store.get('shape', 'circle'),
  poly: null,                                  // polygone de site (mode poly)
  sel: new Set(store.get('sel', FREE_IDS.slice())),
  pal: store.get('pal', {}),                   // id → index de palette
  names: store.get('names', {}),               // id → titre personnalisé
  noText: new Set(store.get('noText', [])),
  time: store.get('time', 12),
  sunDate: validISODate(storedSunDate) ? storedSunDate : todayISO(),
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
  if ($('#siteReport')?.classList.contains('on')) renderSiteReport();
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

/* ═══════════════ vue 3D ═══════════════
   Ouvre la fenêtre de volumes bâtis : mêmes données que l'analyse « Volumes 3D »
   quand elles sont déjà chargées, sinon le serveur les fournit (action
   `buildings`), avec repli sur les tuiles osmbuildings.org si on le demande. */
function vue3D(opts = {}) {
  return ouvrir3D({
    lat: S.site.lat, lon: S.site.lon, rayon: S.site.R,
    nom: S.site.name, langue: S.lang,
    heure: Math.round(S.time), sunDate: S.sunDate, inclinaison: 50,
    batiments: (S.D.build || []).length ? S.D.build : null,
    routes: S.D.roads || [],
    eaux: (S.D.green || []).filter(x => x.k === 'w').map(x => x.g),
    terrain: S.terrain || null,
    device: S.device, compte: S.session?.account, jeton: S.session?.token,
    fondParDefaut: false
  });
}

/* Panneau des exports CAO : plan DXF, coupe topographique, modèle OBJ/STL.
   Il partage l'état de l'application (jeu de données, relief, site). */
function vueExports() {
  return ouvrirExports({
    lat: S.site.lat, lon: S.site.lon, rayon: S.site.R,
    nom: S.site.name, langue: S.lang,
    D: S.D, terrain: S.terrain,
    device: S.device, compte: S.session?.account, jeton: S.session?.token
  });
}

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
        <span class="txt"><b>${T(a.nom, a.en)}</b><i>${T(a.sub, a.enSub || a.sub)}</i></span>
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
    watermark: !isOpenAccess(), time: S.time, sunDate: S.sunDate, siteName: S.site.name,
    D: S.D, terrain: S.terrain, climate: S.climate, windrose: S.windrose, noSiteMark: false
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
          ${id === 'volumes' ? `<button title="${T('ouvrir la vue 3D interactive', 'open interactive 3D view')}" data-3d>3D</button>` : ''}
          <button title="${T('palette suivante', 'next palette')}" data-pal>◨</button>
          <button title="${T('texte on/off', 'text on/off')}" data-txt class="${S.noText.has(id) ? 'off' : ''}">✎</button>
          <button title="SVG" data-svg>SVG</button>
          <button title="PNG ×3" data-png>PNG</button>
        </span>
      </header>
      <div class="body">${renderOne(id)}</div>
      <footer class="note">${id === 'wind'
        ? T('NASA POWER · MERRA-2 · 10 m · direction = provenance du vent · flux régional, pas de vent local CFD', 'NASA POWER · MERRA-2 · 10 m · direction = where wind comes from · regional flow, not local CFD')
        : T('données © OpenStreetMap', 'data © OpenStreetMap')}</footer>`;
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
    const b3d = card.querySelector('[data-3d]');
    if (b3d) b3d.addEventListener('click', () => vue3D());
    card.querySelector('[data-svg]').addEventListener('click', () => downloadSVG(id, card));
    card.querySelector('[data-png]').addEventListener('click', () => downloadPNG(id, card));
    grid.appendChild(card);
  });
  renderMiniMap();
}
function refreshSolarCards() {
  for (const id of ['sun', 'volumes']) {
    const body = $('#card_' + id + ' .body');
    if (body) body.innerHTML = renderOne(id);
  }
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
    `urbatrame-${id}.svg`);
  log('export SVG · ' + id);
}
async function downloadPNG(id, card) {
  try {
    const blob = await svgElementToPngBlob(svgOf(card), { scale: 3, background: '#fff' });
    download(blob, `urbatrame-${id}.png`);
    log('export PNG ×3 · ' + id);
  } catch (e) {
    console.error('PNG', id, e);
    toast(T('Export PNG impossible', 'PNG export failed'), false);
  }
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

/* ═══════════════ synthèse du site & scénario de faisabilité ═══════════════ */
function reportNumber(value, digits = 0) {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(S.lang === 'en' ? 'en-GB' : 'fr-FR', {
    maximumFractionDigits: digits, minimumFractionDigits: digits
  }).format(value);
}
function reportArea(value) {
  if (!Number.isFinite(value)) return '—';
  return value >= 1_000_000 ? `${reportNumber(value / 1_000_000, 2)} km²` : `${reportNumber(value)} m²`;
}
function reportLength(value) {
  if (!Number.isFinite(value)) return '—';
  return value >= 1_000 ? `${reportNumber(value / 1_000, 2)} km` : `${reportNumber(value)} m`;
}
function reportPercent(value) { return Number.isFinite(value) ? `${reportNumber(value, 1)}%` : '—'; }
function reportMetric(label, value, detail = '') {
  const card = document.createElement('article');
  card.className = 'report-metric';
  const name = document.createElement('span'); name.className = 'report-metric-label'; name.textContent = label;
  const amount = document.createElement('strong'); amount.className = 'report-metric-value'; amount.textContent = value;
  card.append(name, amount);
  if (detail) { const note = document.createElement('small'); note.textContent = detail; card.append(note); }
  return card;
}
function reportSection(title, description = '') {
  const section = document.createElement('section'); section.className = 'report-section';
  const heading = document.createElement('div'); heading.className = 'report-section-heading';
  const h = document.createElement('h3'); h.textContent = title; heading.append(h);
  if (description) { const p = document.createElement('p'); p.textContent = description; heading.append(p); }
  section.append(heading);
  return section;
}
function reportNote(text, type = '') {
  const note = document.createElement('p');
  note.className = 'report-note' + (type ? ' ' + type : '');
  note.textContent = text;
  return note;
}
function currentReportContext() {
  return S.dataSite || (S.site.lat == null ? null : {
    ...S.site, shape: S.shape, polygon: S.poly
  });
}
function reportDataOutOfDate(snapshot) {
  if (!S.dataSite || S.site.lat == null) return false;
  return Math.abs(S.site.lat - snapshot.lat) > 1e-6 ||
    Math.abs(S.site.lon - snapshot.lon) > 1e-6 ||
    S.site.R !== snapshot.R || S.shape !== snapshot.shape;
}
function scenarioField(parent, id, label, value, options = {}) {
  const wrap = document.createElement('label'); wrap.className = 'scenario-field';
  const title = document.createElement('span'); title.textContent = label;
  const input = document.createElement('input');
  input.id = id; input.type = options.type || 'number'; input.value = value ?? '';
  if (options.type === 'text') { input.maxLength = options.maxLength || 8; input.autocomplete = 'off'; }
  else {
    input.min = options.min ?? 0; input.max = options.max ?? 1e9; input.step = options.step || 'any';
    input.inputMode = 'decimal';
  }
  wrap.append(title, input); parent.append(wrap);
  return input;
}
function renderScenario(host) {
  const saved = store.get('siteScenario', {});
  const section = reportSection(T('Scénario de capacité — hypothèses manuelles', 'Capacity scenario — user assumptions'),
    T('Renseignez les paramètres de votre projet. La surface du terrain est saisie séparément de la zone d’analyse.',
      'Enter your project assumptions. Plot area is separate from the study extent.'));
  section.classList.add('scenario-section');
  section.append(reportNote(T(
    'Aucun zonage ni coefficient réglementaire n’est déduit des données cartographiques. Ces résultats sont des ordres de grandeur, à vérifier auprès des documents officiels.',
    'No zoning or statutory coefficient is inferred from map data. These are indicative figures; check the official planning documents.'), 'important'));

  const fields = document.createElement('div'); fields.className = 'scenario-fields';
  const area = scenarioField(fields, 'scenarioArea', T('Terrain du projet · m²', 'Project plot · m²'), saved.area || '', { min: 1, max: 1e9 });
  const far = scenarioField(fields, 'scenarioFar', T('FAR / COS souhaité', 'Target FAR'), saved.far || '', { min: 0, max: 100 });
  const coverage = scenarioField(fields, 'scenarioCoverage', T('Emprise maximale · %', 'Maximum site coverage · %'), saved.coverage || '', { min: 0, max: 100, step: 0.1 });
  const floors = scenarioField(fields, 'scenarioFloors', T('Nombre de niveaux', 'Number of floors'), saved.floors || '', { min: 1, max: 300, step: 1 });
  const cost = scenarioField(fields, 'scenarioCost', T('Coût par m² · facultatif', 'Cost per m² · optional'), saved.cost || '', { min: 0, max: 1e12 });
  const currency = scenarioField(fields, 'scenarioCurrency', T('Devise', 'Currency'), saved.currency || 'DZD', { type: 'text', maxLength: 8 });
  section.append(fields);

  const conceptSection = reportSection(T('Volumes 3D conceptuels', 'Conceptual 3D massing'), T(
    'Décrivez la composition à générer. La maquette est un schéma de volumes rectangulaires égaux, disposés en rangée; elle n’est pas géoréférencée et ne représente aucune limite foncière.',
    'Describe the massing to generate. The model is a schematic row of equal rectangular volumes; it is not georeferenced and shows no land boundary.'));
  conceptSection.classList.add('concept-section');
  const conceptFields = document.createElement('div'); conceptFields.className = 'scenario-fields concept-fields';
  const volumeCount = scenarioField(conceptFields, 'scenarioVolumeCount', T('Nombre de volumes', 'Number of volumes'), saved.volumeCount || '', { min: 1, max: 24, step: 1 });
  const floorHeight = scenarioField(conceptFields, 'scenarioFloorHeight', T('Hauteur d’étage · m', 'Floor-to-floor height · m'), saved.floorHeight || '', { min: 1, max: 20, step: 0.1 });
  const aspect = scenarioField(conceptFields, 'scenarioAspect', T('Largeur / profondeur', 'Width / depth ratio'), saved.aspect || '', { min: 0.1, max: 10, step: 0.1 });
  const gap = scenarioField(conceptFields, 'scenarioGap', T('Écart entre volumes · m', 'Gap between volumes · m'), saved.gap || '', { min: 0, max: 1000, step: 0.5 });
  conceptSection.append(conceptFields);
  section.append(conceptSection);

  const output = document.createElement('div'); output.className = 'scenario-output'; output.setAttribute('aria-live', 'polite');
  section.append(output);
  const inputs = { area, far, coverage, floors, cost, currency, volumeCount, floorHeight, aspect, gap };
  const update = () => {
    const values = Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value.trim()]));
    store.set('siteScenario', values);
    output.replaceChildren();
    const result = calculateFeasibility({
      siteAreaM2: values.area === '' ? NaN : Number(values.area),
      far: values.far === '' ? NaN : Number(values.far),
      coveragePct: values.coverage === '' ? NaN : Number(values.coverage),
      floors: values.floors === '' ? NaN : Number(values.floors),
      costPerM2: values.cost === '' ? null : Number(values.cost)
    });
    if (!result) {
      output.append(reportNote(T(
        'Saisissez une surface, un FAR, un pourcentage d’emprise et un nombre de niveaux pour afficher une capacité indicative.',
        'Enter plot area, FAR, coverage and floor count to see an indicative capacity.'), 'scenario-prompt'));
    } else {
      const grid = document.createElement('div'); grid.className = 'report-metrics scenario-results';
      grid.append(
        reportMetric(T('Capacité selon le FAR', 'FAR-based capacity'), reportArea(result.areaByFarM2)),
        reportMetric(T('Capacité selon emprise × niveaux', 'Coverage × floors capacity'), reportArea(result.areaByCoverageM2)),
        reportMetric(T('Surface de plancher retenue', 'Indicative floor area'), reportArea(result.floorAreaM2),
          T('contrainte la plus stricte appliquée', 'most restrictive input applied')),
        reportMetric(T('Emprise au sol estimée', 'Indicative footprint'), reportArea(result.footprintM2))
      );
      if (result.costEstimate != null) {
        const unit = (values.currency || 'DZD').slice(0, 8);
        grid.append(reportMetric(T('Coût de construction indicatif', 'Indicative construction cost'),
          `${reportNumber(result.costEstimate)} ${unit}`, T('hors terrain, réseaux, honoraires et taxes', 'excluding land, utilities, fees and taxes')));
      }
      output.append(grid);
      output.append(reportNote(result.bindingConstraint === 'far'
        ? T('Dans cette hypothèse, le FAR/COS limite la surface de plancher.', 'Under these assumptions, FAR is the limiting factor.')
        : T('Dans cette hypothèse, l’emprise au sol multipliée par les niveaux limite la surface de plancher.', 'Under these assumptions, coverage multiplied by floors is the limiting factor.'), 'scenario-explanation'));
    }

    const concept = result && buildConceptMassing({
      siteAreaM2: values.area === '' ? null : Number(values.area),
      floorAreaM2: result.floorAreaM2,
      footprintM2: result.footprintM2,
      floors: values.floors === '' ? null : Number(values.floors),
      floorHeightM: values.floorHeight === '' ? null : Number(values.floorHeight),
      volumeCount: values.volumeCount === '' ? null : Number(values.volumeCount),
      aspectRatio: values.aspect === '' ? null : Number(values.aspect),
      gapM: values.gap === '' ? null : Number(values.gap)
    });
    const conceptControls = document.createElement('div'); conceptControls.className = 'concept-controls';
    const generate = document.createElement('button'); generate.type = 'button'; generate.className = 'primary concept-generate';
    generate.textContent = T('Générer / actualiser la maquette 3D', 'Generate / refresh 3D massing');
    generate.disabled = !concept;
    conceptControls.append(generate);
    const conceptHint = reportNote(concept
      ? T('Les dimensions sont dérivées des valeurs saisies ci-dessus. La disposition en rangée est schématique; aucun ajustement au terrain, au nord, au zonage ou à une réglementation n’est effectué.',
        'Dimensions come from the inputs above. The row layout is schematic; no fit to the site, north, zoning or regulations is performed.')
      : T('Pour générer la maquette, complétez le scénario de capacité, le nombre de volumes, la hauteur d’étage et le rapport largeur/profondeur. L’écart doit aussi être renseigné pour plusieurs volumes.',
        'To generate the model, complete the capacity scenario, number of volumes, floor-to-floor height and width/depth ratio. Enter a gap when using multiple volumes.'), 'scenario-prompt');
    const conceptPreview = document.createElement('div'); conceptPreview.className = 'concept-preview';
    generate.addEventListener('click', () => {
      if (!concept) return;
      const view = document.createElement('label'); view.className = 'concept-view-control';
      const viewText = document.createElement('span'); viewText.textContent = T('Angle de vue · graphique, sans nord', 'View angle · graphic only, not north');
      const slider = document.createElement('input'); slider.type = 'range'; slider.min = '0'; slider.max = '359'; slider.step = '1'; slider.value = '45';
      const angleValue = document.createElement('output'); angleValue.textContent = '45°';
      view.append(viewText, slider, angleValue);
      let svg = '';
      const draw = () => {
        svg = renderConceptMassingSvg(concept, { lang: S.lang === 'en' ? 'en' : 'fr', viewAngleDeg: Number(slider.value) });
        conceptPreview.innerHTML = svg;
        angleValue.textContent = `${slider.value}°`;
      };
      slider.addEventListener('input', draw);
      const exports = document.createElement('div'); exports.className = 'concept-export-actions';
      const exportButton = (label, handler) => {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
        button.addEventListener('click', handler); return button;
      };
      exports.append(
        exportButton(T('Télécharger SVG', 'Download SVG'), () => download(
          new Blob([svg], { type: 'image/svg+xml' }), 'urbatrame-volumes-conceptuels.svg')),
        exportButton('OBJ', () => {
          const scene = conceptMeshScene(concept);
          download(new Blob([objDeScene(scene, { titre: 'volumes 3D conceptuels', mention: 'hypotheses utilisateur · sans georeferencement' })], { type: 'text/plain' }), 'urbatrame-volumes-conceptuels.obj');
        }),
        exportButton('STL', () => {
          const scene = conceptMeshScene(concept);
          download(new Blob([stlDeScene(scene)], { type: 'model/stl' }), 'urbatrame-volumes-conceptuels.stl');
        })
      );
      generate.textContent = T('Maquette générée', 'Model generated');
      generate.disabled = true;
      conceptControls.replaceChildren(generate);
      conceptPreview.replaceChildren();
      output.append(view, conceptPreview, exports);
      draw();
    });
    output.append(conceptControls, conceptHint);
  };
  for (const input of Object.values(inputs)) input.addEventListener('input', update);
  update();
  host.append(section);
}
function renderSiteReport() {
  const host = $('#siteReportBody'), subtitle = $('#siteReportSubtitle');
  if (!host || !subtitle) return;
  host.replaceChildren();
  const site = currentReportContext();
  if (!site) {
    subtitle.textContent = T('Recherchez un lieu pour commencer.', 'Search for a place to begin.');
    host.append(reportNote(T('Choisissez un lieu, puis générez les analyses pour remplir cette synthèse.',
      'Choose a place, then generate analyses to fill this report.')));
    return;
  }
  const lat = Number(site.lat), lon = Number(site.lon), radius = Number(site.R) || 600;
  const shapeName = site.shape === 'square' || site.shape === 'rect' ? T('carré', 'square')
    : Array.isArray(site.polygon) ? T('polygone fourni', 'provided polygon') : T('cercle', 'circle');
  subtitle.textContent = `${site.name || 'Site'} · ${lat.toFixed(5)}, ${lon.toFixed(5)} · ${shapeName} · ${reportNumber(radius)} m`;

  if (reportDataOutOfDate(site)) {
    host.append(reportNote(T(
      `Les données cartographiques chargées concernent ${site.name || 'le site précédent'} (${reportNumber(site.R)} m). La sélection actuelle a changé : relancez la génération pour actualiser cette synthèse.`,
      `The loaded map data belong to ${site.name || 'the previous site'} (${reportNumber(site.R)} m). The current selection has changed; generate again to refresh this report.`), 'warning'));
  }

  if (!S.dataSite) {
    host.append(reportNote(T(
      'Aucune analyse n’a encore été générée pour ce lieu. Les indicateurs apparaîtront après le chargement des données OSM.',
      'No analysis has been generated for this place yet. OSM indicators will appear after data are loaded.')));
    renderScenario(host);
    host.append(reportNote(T(
      'Les métriques cartographiques s’appuient sur les objets OSM dont le centre est dans l’emprise. Les surfaces ne sont pas rognées au bord; les chevauchements et cours intérieures non soustraites peuvent influer sur les totaux. L’emprise d’analyse n’est pas une parcelle cadastrale.',
      'Map metrics use OSM objects whose centre falls within the extent. Areas are not clipped at the edge; overlaps and un-subtracted inner rings can affect totals. The study extent is not a cadastral plot.'), 'method-note'));
    return;
  }

  const m = summarizeSite({
    D: S.D, terrain: S.terrain, climate: S.climate,
    lat, lon, radius, shape: site.shape || 'circle', polygon: site.polygon || null
  });
  const windSectors = Array.isArray(S.windrose?.sectors) ? S.windrose.sectors : [];
  const dominantWind = windSectors.length
    ? windSectors.reduce((best, x) => x.frequencyPct > best.frequencyPct ? x : best, windSectors[0])
    : null;
  const compass16 = S.lang === 'en'
    ? ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
    : ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
  const windDirection = dominantWind
    ? compass16[Math.round(dominantWind.bearing / 22.5) % 16] : null;
  const rosePeriod = S.windrose?.period?.start && S.windrose?.period?.end
    ? `${String(S.windrose.period.start).slice(0, 4)}–${String(S.windrose.period.end).slice(0, 4)}` : T('10 ans', '10 years');

  const intro = document.createElement('div'); intro.className = 'report-intro';
  const introText = document.createElement('div');
  const place = document.createElement('h3'); place.textContent = site.name || T('Zone analysée', 'Study area');
  const blurb = document.createElement('p');
  blurb.textContent = S.mapLoaded
    ? T(
      `${reportNumber(m.buildings.count)} emprise(s) bâtie(s) OSM centrée(s) dans cette zone; ${reportArea(m.green.areaM2)} de polygones verts cartographiés; ${reportLength(m.roads.lengthM)} de voirie mesurée dans l’emprise.`,
      `${reportNumber(m.buildings.count)} OSM building footprint(s) centred in this extent; ${reportArea(m.green.areaM2)} of mapped green polygons; ${reportLength(m.roads.lengthM)} of road network measured inside the extent.`)
    : S.windrose
      ? T(
        'Rose des vents NASA POWER chargée pour ce point; statistique régionale à 10 m, sans calcul local autour des bâtiments.',
        'NASA POWER wind rose loaded for this point; a regional 10 m statistic, with no local calculation around buildings.')
      : T('Aucune couche cartographique OSM n’a été demandée dans cette génération.',
        'No OpenStreetMap layer was requested in this generation.');
  introText.append(place, blurb);
  const badge = document.createElement('span'); badge.className = 'report-status';
  badge.textContent = S.mapLoaded
    ? T('Indicateurs issus des données chargées', 'Indicators from loaded data')
    : S.windrose
      ? T('Climatologie régionale NASA POWER', 'NASA POWER regional climatology')
      : T('Aucune couche OSM chargée', 'No OSM layer loaded');
  intro.append(introText, badge); host.append(intro);

  if (S.mapLoaded) {
  const morph = reportSection(T('Indicateurs urbains', 'Urban indicators'),
    T('Comptages et surfaces dérivés des couches cartographiques disponibles.', 'Counts and areas derived from available mapped layers.'));
  const grid = document.createElement('div'); grid.className = 'report-metrics';
  const climateText = m.climate.meanMaxC == null || m.climate.meanMinC == null
    ? T('Non chargé', 'Not loaded')
    : `${reportNumber(m.climate.meanMaxC, 1)} / ${reportNumber(m.climate.meanMinC, 1)} °C`;
  const terrainText = m.terrain.reliefM == null ? T('Non chargé', 'Not loaded')
    : `${reportNumber(m.terrain.minM)}–${reportNumber(m.terrain.maxM)} m`;
  grid.append(
    reportMetric(T('Surface de l’emprise d’analyse', 'Study extent area'), reportArea(m.areaM2), shapeName),
    reportMetric(T('Bâtiments OpenStreetMap', 'OpenStreetMap buildings'), reportNumber(m.buildings.count),
      `${reportNumber(m.buildings.heightsKnown)} ${T('avec hauteur renseignée', 'with mapped height')}`),
    reportMetric(T('Empreintes bâties cumulées', 'Summed building footprints'), reportArea(m.buildings.footprintM2),
      `${reportPercent(m.buildings.coveragePct)} ${T('de l’emprise · somme indicative', 'of extent · indicative sum')}`),
    reportMetric(T('Espaces verts cartographiés', 'Mapped green areas'), reportArea(m.green.areaM2),
      `${reportNumber(m.green.count)} ${T('polygone(s)', 'polygon(s)')} · ${reportPercent(m.green.coveragePct)}`),
    reportMetric(T('Eau cartographiée', 'Mapped water'), reportArea(m.water.areaM2),
      `${reportNumber(m.water.count)} ${T('polygone(s)', 'polygon(s)')} · ${reportPercent(m.water.coveragePct)}`),
    reportMetric(T('Voirie mesurée', 'Road network measured'), reportLength(m.roads.lengthM),
      `${reportNumber(m.roads.count)} ${T('tronçon(s) touchant l’emprise', 'segments intersecting the extent')}`),
    reportMetric(T('Équipements & arrêts', 'Amenities & transit stops'), reportNumber(m.points.total),
      `${reportNumber(m.points.amenities)} ${T('équipement(s)', 'amenity point(s)')} · ${reportNumber(m.points.transit)} ${T('arrêt(s)', 'transit stop(s)')}`),
    reportMetric(T('Relief échantillonné', 'Sampled terrain range'), terrainText,
      m.terrain.reliefM == null ? T('Grille d’altitude non chargée', 'Elevation grid not loaded') : `${reportNumber(m.terrain.reliefM)} m · ${reportNumber(m.terrain.samples)} ${T('points', 'samples')}`),
    reportMetric(T('Températures journalières moyennes', 'Mean daily temperatures'), climateText,
      m.climate.days ? `${reportNumber(m.climate.days)} ${T('jours NASA POWER valides', 'valid NASA POWER days')}` : T('Séries climatiques non chargées', 'Climate series not loaded'))
  );
  morph.append(grid); host.append(morph);
  }

  const env = reportSection(T('Climat & environnement', 'Climate & environment'),
    T('Moyennes indicatives de séries journalières; elles ne remplacent pas une étude microclimatique.', 'Indicative averages from daily series; not a substitute for a microclimate study.'));
  const envGrid = document.createElement('div'); envGrid.className = 'report-metrics report-metrics-compact';
  envGrid.append(
    reportMetric(T('Précipitations annualisées', 'Annualised precipitation'), m.climate.estimatedAnnualRainMm == null ? '—' : `${reportNumber(m.climate.estimatedAnnualRainMm)} mm/an`, T('moyenne journalière × 365', 'daily mean × 365')),
    reportMetric(T('Vent moyen à 10 m', 'Mean wind at 10 m'), m.climate.meanWind10mMs == null ? '—' : `${reportNumber(m.climate.meanWind10mMs, 1)} m/s`, 'NASA POWER'),
    reportMetric(T('Rayonnement solaire moyen', 'Mean solar radiation'), m.climate.meanSolarKwhM2Day == null ? '—' : `${reportNumber(m.climate.meanSolarKwhM2Day, 1)} kWh/m²/j`, 'NASA POWER'),
    ...(S.mapLoaded ? [reportMetric(T('Hauteurs bâties connues', 'Mapped building heights'), m.buildings.count ? `${reportNumber(m.buildings.heightsKnown)} / ${reportNumber(m.buildings.count)}` : '—',
      m.buildings.meanKnownHeightM == null ? T('Hauteurs OSM non renseignées', 'No OSM heights available') : `${T('moyenne', 'mean')} ${reportNumber(m.buildings.meanKnownHeightM, 1)} m · ${T('max.', 'max')} ${reportNumber(m.buildings.maxKnownHeightM, 1)} m · ${T('volume connu', 'known volume')} ${reportNumber(m.buildings.knownVolumeM3)} m³`)] : []),
    reportMetric(T('Direction dominante du vent · 10 m', 'Prevailing wind direction · 10 m'),
      dominantWind ? `${windDirection} · ${reportNumber(dominantWind.frequencyPct, 1)}%` : '—',
      dominantWind ? `NASA POWER · MERRA-2 · ${rosePeriod} · ${reportNumber(dominantWind.meanSpeedMs, 1)} m/s · ${T('flux régional', 'regional flow')}` : T('Rose des vents non chargée', 'Wind rose not loaded')),
    reportMetric(T('Vitesse moyenne pondérée · 10 m', 'Weighted mean wind speed · 10 m'),
      Number.isFinite(S.windrose?.meanSpeedMs) ? `${reportNumber(S.windrose.meanSpeedMs, 1)} m/s` : '—',
      T('NASA POWER · MERRA-2 · pondération des 16 secteurs', 'NASA POWER · MERRA-2 · weighted across 16 sectors'))
  );
  env.append(envGrid);
  if (m.points.categories.length) {
    const cats = document.createElement('p'); cats.className = 'report-categories';
    const label = document.createElement('strong'); label.textContent = T('Catégories de points les plus fréquentes : ', 'Most frequent point categories: ');
    cats.append(label, document.createTextNode(m.points.categories.slice(0, 6).map(x => `${x.name} (${reportNumber(x.count)})`).join(' · ')));
    env.append(cats);
  }
  host.append(env);

  renderScenario(host);
  host.append(reportNote(S.mapLoaded ? T(
    'Méthode & limites : les emprises bâties et vertes sont comptées lorsque leur centroïde tombe dans la zone; leur surface entière est sommée, sans découpe au contour. Les superpositions OSM et les cours intérieures non soustraites peuvent augmenter les totaux. La pluie annualisée est une moyenne quotidienne NASA POWER × 365. Les hauteurs ne sont utilisées que lorsqu’elles sont cartographiées. La rose des vents MERRA-2 à 10 m décrit un flux régional et ne simule pas le vent local entre les bâtiments.',
    'Method & limits: building and green polygons are counted when their centroid falls inside the extent; whole areas are summed, without clipping at the boundary. OSM overlaps and un-subtracted inner rings can raise totals. Annualised rainfall is the NASA POWER daily mean × 365. Heights are used only when mapped. The MERRA-2 wind rose at 10 m describes regional flow; it does not simulate local wind between buildings.') : T(
    'Limite : la rose des vents NASA POWER/MERRA-2 à 10 m est une statistique régionale; elle ne représente pas les effets locaux du bâti, des rues ou du relief fin.',
    'Limitation: the NASA POWER/MERRA-2 wind rose at 10 m is a regional statistic; it does not represent local effects of buildings, streets or fine-scale terrain.'), 'method-note'));
  host.append(reportNote(T(
    'Sources : © OpenStreetMap contributors (ODbL) · climat et rose des vents NASA POWER (MERRA-2, 10 m) · relief Terrarium (SRTM/USGS). La zone affichée est une emprise d’analyse, pas une limite foncière/cadastrale. Aucun zonage local, droit à construire ou coût de marché n’est inféré.',
    'Sources: © OpenStreetMap contributors (ODbL) · NASA POWER climate and wind rose (MERRA-2, 10 m) · Terrarium terrain (SRTM/USGS). The displayed shape is a study extent, not a cadastral/property boundary. No local zoning, development right or market cost is inferred.'), 'method-note'));
}
function openSiteReport() {
  renderSiteReport();
  const modal = $('#siteReport'); modal.classList.add('on'); modal.setAttribute('aria-hidden', 'false');
  $('#siteReportClose').focus();
}
function closeSiteReport() {
  const modal = $('#siteReport'); modal.classList.remove('on'); modal.setAttribute('aria-hidden', 'true');
  $('#siteReportBtn')?.focus();
}

/* ═══════════════ chargement (étapes) ═══════════════ */
function stages(planObj, extra) {
  const list = [{ id: 'prepare', fr: 'Préparation de la sélection', en: 'Preparing selection' }];
  for (const g of planObj.groups)
    list.push({ id: 'g_' + g.id, fr: g.fr, en: g.en });
  if (planObj.climate) list.push({ id: 'climate', fr: 'Lecture des séries NASA POWER', en: 'Reading NASA POWER series' });
  if (planObj.windrose) list.push({ id: 'windrose', fr: 'Calcul de la rose des vents NASA POWER', en: 'Loading NASA POWER wind rose' });
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
  const requestedSite = {
    ...S.site, shape: S.shape,
    polygon: S.poly ? JSON.parse(JSON.stringify(S.poly)) : null
  };
  if (p.windrose) S.windrose = null;

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
    const acc = { roads: [], build: [], green: [], pois: [], rail: [], coast: [] };
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
    S.mapLoaded = p.groups.length > 0;

    /* 3 · sources annexes */
    if (p.climate) {
      state.climate = 'active'; drawLoader(list, state, t0);
      try { S.climate = await S.routes.climate(S.site.lat, S.site.lon, S.device); log('climat NASA POWER chargé'); state.climate = 'done'; }
      catch (e) { S.climate = null; state.climate = 'failed'; log('climat indisponible (' + (e.error || e.message) + ')'); }
    }
    if (p.windrose) {
      state.windrose = 'active'; drawLoader(list, state, t0);
      try {
        S.windrose = await S.routes.windrose(S.site.lat, S.site.lon, S.device);
        log(`rose NASA POWER/MERRA-2 chargée · ${S.windrose.period.start} → ${S.windrose.period.end}`);
        state.windrose = 'done';
      } catch (e) {
        S.windrose = null; state.windrose = 'failed';
        log('rose des vents indisponible (' + (e.error || e.message) + ')');
      }
    }
    if (p.terrain) {
      state.terrain = 'active'; drawLoader(list, state, t0);
      try {
        S.terrain = await S.routes.terrain(S.site.lat, S.site.lon, S.site.R, 24, S.device);
        log(`altimétrie ${S.terrain.n}×${S.terrain.n} (zoom ${S.terrain.zoom})`);
        state.terrain = 'done';
      } catch (e) { S.terrain = null; state.terrain = 'failed'; log('altimétrie indisponible (' + (e.error || e.message) + ')'); }
    }

    S.dataSite = requestedSite;
    state.render = 'done';
    renderCards();
    if ($('#siteReport')?.classList.contains('on')) renderSiteReport();
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
    S.windrose = await fetch('data/windrose-elkhroub.json').then(r => r.ok ? r.json() : null).catch(() => null);
    S.site.lat = d.site.lat; S.site.lon = d.site.lon; S.site.R = d.site.R; S.site.name = d.site.name;
    $('#q').value = d.site.name;
    $('#radius').value = d.site.R; $('#radiusOut').textContent = d.site.R + ' m';
    S.D = normalizeElements(null, dedupe(d.elements));
    S.mapLoaded = true;
    S.terrain = d.terrain || null;
    S.climate = d.climate || null;
    S.cacheInfo = T('exemple embarqué', 'bundled sample');
    S.dataSite = { ...d.site, shape: S.shape, polygon: null };
    setSite(d.site.lat, d.site.lon, d.site.name);
    renderCards();
    if ($('#siteReport')?.classList.contains('on')) renderSiteReport();
    updateGenBtn();
    log(`exemple : ${S.D.build.length} emprises · ${S.D.roads.length} tronçons · ${S.D.green.length} vert/eau · ${S.D.pois.length} POI`
        + (S.terrain ? ` · altimétrie ${S.terrain.n}×${S.terrain.n}` : '')
        + (S.climate ? ' · climat NASA POWER' : '')
        + (S.windrose ? ' · rose NASA POWER/MERRA-2' : ''));
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
  const locationChanged = S.site.lat !== lat || S.site.lon !== lon;
  S.site.lat = lat; S.site.lon = lon; S.site.name = name;
  if (locationChanged) {
    S.windrose = null;
    const card = $('#card_wind');
    if (card) card.querySelector('.body').innerHTML = renderOne('wind');
  }
  $('#siteInfo').innerHTML = `<b>${esc(name)}</b><span>${lat.toFixed(5)}°, ${lon.toFixed(5)}° · r = ${S.site.R} m</span>`;
  log(`site · ${name} (${lat.toFixed(5)}, ${lon.toFixed(5)})`);
  updateGenBtn();
  if ($('#siteReport')?.classList.contains('on')) renderSiteReport();
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
    if (S.dataSite || S.D.build.length || S.D.roads.length || S.windrose || S.climate || S.terrain) renderCards();
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
    if ($('#siteReport')?.classList.contains('on')) renderSiteReport();
  });
  $('#shape').addEventListener('change', e => {
    S.shape = e.target.value; store.set('shape', S.shape);
    const rw = $('#radiusWrap'); if (rw) rw.style.opacity = S.shape === 'poly' ? '.45' : '1';
    renderCards();
    if ($('#siteReport')?.classList.contains('on')) renderSiteReport();
  });
  $('#time').addEventListener('input', e => {
    S.time = +e.target.value;
    const h = Math.floor(S.time), m = Math.round((S.time % 1) * 60);
    $('#timeOut').textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    store.set('time', S.time);
    refreshSolarCards();
  });
  $('#sunDate').addEventListener('change', e => {
    if (!validISODate(e.target.value)) { e.target.value = S.sunDate; return; }
    S.sunDate = e.target.value;
    store.set('sunDate', S.sunDate);
    refreshSolarCards();
  });
  $('#gen').addEventListener('click', generate);
  $('#clear').addEventListener('click', () => {
    S.D = { roads: [], build: [], green: [], pois: [], rail: [], coast: [] };
    S.terrain = null; S.climate = null; S.windrose = null; S.mapLoaded = false; S.dataSite = null;
    renderCards();
    if ($('#siteReport')?.classList.contains('on')) renderSiteReport();
    log('carte vidée');
  });
  $('#cacheBtn').addEventListener('click', async () => {
    await cacheClear(); toast(T('Cache des requêtes vidé', 'Query cache cleared'));
    log('cache IndexedDB vidé');
  });
  $('#plansBtn').addEventListener('click', openPlans);
  $('#restoreBtn')?.addEventListener('click', restore);
  $('#helpBtn').addEventListener('click', () => openModal('help'));
  $('#siteReportBtn').addEventListener('click', openSiteReport);
  $('#siteReportClose').addEventListener('click', closeSiteReport);
  $('#siteReport').addEventListener('click', e => { if (e.target === $('#siteReport')) closeSiteReport(); });
  $('#siteReportPrint').addEventListener('click', () => {
    document.body.classList.add('printing-report');
    const cleanup = () => document.body.classList.remove('printing-report');
    window.addEventListener('afterprint', cleanup, { once: true });
    window.print();
    setTimeout(cleanup, 1200);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && $('#siteReport').classList.contains('on')) closeSiteReport();
  });
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
  $('#proExport').addEventListener('click', () => vueExports());
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
  $('#sunDate').value = S.sunDate;
  $('#timeOut').textContent = String(Math.floor(S.time)).padStart(2, '0') + ':' + String(Math.round((S.time % 1) * 60)).padStart(2, '0');

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

  if (qp.get('vue3d') === '1') setTimeout(() => vue3D(), 400);
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
