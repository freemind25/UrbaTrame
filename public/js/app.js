/* Freemap · application
   Orchestration : catalogue, plan partagé, appels réseau, vérification des
   licences signées Ed25519, rendu des cartes, exports, interface.
   ───────────────────────────────────────────────────────────────────────── */
import { plan, FREE_IDS, MAX_IDS, LIMITS, VERSION } from './plan-2d.mjs';
import { estimateDataPreview, layerLabel } from './data-preview.mjs';
import { OBM_CATEGORIES, obmCategoryLabel } from './openbuildingmap.mjs';
import { Routes, errText } from './routes.mjs';
import { store, deviceId, cacheClear, cacheGet } from './persist.mjs';
import { normalizeElements, dedupe } from './osm.mjs';
import { ouvrir3D } from './vue3d-ui.mjs';
import { ouvrirExports } from './exports-ui.mjs';
import { svgElementToPngBlob } from './png-export.mjs';
import { summarizeSite, calculateFeasibility } from './site-summary.mjs';
import { buildConceptMassing, conceptMeshScene, renderConceptMassingSvg } from './concept-massing.mjs';
import { objDeScene, stlDeScene } from './exports.mjs';
import { analyzeSpatialQuestion } from './local-assistant.mjs';
import { verifyIssuedLicenseToken } from './licence-client.mjs';
import { studentAuthReady } from './student-auth-ui.mjs';
import {
  createWorkspaceProject, createWorkspaceTemplate, makeWorkspaceId,
  parseWorkspaceFile, removeWorkspaceRecord, serializeWorkspaceRecord, upsertWorkspaceRecord, validateWorkspaceRecord
} from './workspace.mjs';

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
  licenseToken: store.get('licenseToken', null),
  tier: 'free',
  access: 'licence',   /* 'open' = période d'essai ouverte, annoncée par /api/status */
  licenseFileActivation: false,
  studentAuthRequired: false,
  studentUser: null,
  pub: null,
  D: { roads: [], build: [], green: [], pois: [], rail: [], coast: [] },
  terrain: null,
  climate: null,
  windrose: null,
  obm: null,
  mapLoaded: false,
  dataSite: null,                                // contexte exact des couches déjà chargées
  site: { lat: null, lon: null, R: 600, name: '' },
  shape: store.get('shape', 'circle'),
  poly: null,                                  // polygone de site (mode poly)
  sel: new Set(store.get('sel', ['roads', 'landuse', 'gw', 'fabric'])),
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
let latestAssistantResult = null;
let dataPreviewTimer = null;
let dataPreviewRevision = 0;

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
  if ($('#assistantModal')?.classList.contains('on') && latestAssistantResult) renderAssistantResult(latestAssistantResult);
  if ($('#workspaceModal')?.classList.contains('on')) renderWorkspace();
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
let ISSUER_PUBLIC_KEY = null;
/* WebCrypto Ed25519 absente sur certains postes (Electron/Chromium < 137,
   navigateurs anciens). La détection ne se fait qu'une fois : on n'essaie pas
   d'importer une clé que le navigateur ne saurait pas manipuler, le journal
   dit alors ce qui se passe réellement, et la vérification de signature est
   déléguée au serveur (action `check`), seul endroit décédé aujourd'hui. */
let ed25519Unsupported = false;
async function importEd25519Key(base64) {
  if (ed25519Unsupported) return null;
  try {
    return await crypto.subtle.importKey(
      'raw', b64uToBytes(base64), { name: 'Ed25519' }, false, ['verify']);
  } catch (e) {
    if (/unrecognized|unsupported|not supported/i.test(String(e?.message || '')))
      ed25519Unsupported = true;
    return null;
  }
}
async function loadPublicKey() {
  let status = null;
  try {
    status = await (await fetch('/api/status')).json();
  } catch (e) { log('statut du serveur indisponible : ' + e.message); }
  if (status) {
    S.pub = status.pub;
    S.licenseFileActivation = status.licenses?.signedFileActivation === true;
    /* Mode d'accès : `open` = toutes les analyses ouvertes (période d'essai). */
    if (status.access === 'open' || status.access === 'licence') S.access = status.access;
    if (status.licenses?.publicKey) store.set('licensePubB64', status.licenses.publicKey);
    if (status.pub) {
      PUB_KEY = await importEd25519Key(status.pub);
      if (PUB_KEY) log(`clé de session Ed25519 chargée (${status.pub.slice(0, 12)}…)`);
      else if (ed25519Unsupported)
        log('signature Ed25519 non prise en charge par ce navigateur : licences vérifiées par le serveur');
      else log('clé de session illisible : vérification locale des licences impossible');
    }
  }

  const issuerB64 = status?.licenses?.publicKey || store.get('licensePubB64', '');
  if (issuerB64) {
    ISSUER_PUBLIC_KEY = await importEd25519Key(issuerB64);
    if (ISSUER_PUBLIC_KEY) log('clé publique de licence signée chargée');
    else if (!ed25519Unsupported) log('clé publique de licence illisible : vérification .utlic déléguée au serveur');
  }
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
    if (p.d !== S.device || (p.x && p.x <= Date.now())) return null;
    return p;
  } catch { return null; }
}
async function verifyLicenseFileToken(raw) {
  return verifyIssuedLicenseToken(raw, ISSUER_PUBLIC_KEY);
}
async function refreshEntitlement() {
  if (S.studentAuthRequired) {
    const tier = S.studentUser ? 'max' : 'free';
    const changed = tier !== S.tier;
    S.tier = tier;
    const badge = $('#badge');
    if (badge) {
      badge.textContent = S.studentUser ? 'MAX ✓' : T('CONNEXION', 'SIGN IN');
      badge.className = 'badge ' + (S.studentUser ? 'max' : '');
    }
    if (changed) { renderCatalog(); renderCards(); }
    return tier;
  }
  const ent = await verifyEnt(S.ent);
  const signedLicense = ent ? null : await verifyLicenseFileToken(S.licenseToken);
  let tier = 'free', exp = null;
  if (ent) { tier = ent.t; exp = ent.x || null; }
  else if (signedLicense) { tier = signedLicense.tier; exp = signedLicense.expiresAt; }
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
  scheduleDataPreview();
}

/* ═══════════════ prévision des couches et de la charge ═══════════════ */
function scheduleDataPreview() {
  if (!$('#dataPreview')) return;
  dataPreviewRevision++;
  clearTimeout(dataPreviewTimer);
  dataPreviewTimer = setTimeout(updateDataPreview, 120);
}
function previewNumber(value, digits = 1) {
  return new Intl.NumberFormat(S.lang === 'en' ? 'en-US' : 'fr-FR', { maximumFractionDigits: digits }).format(value);
}
function previewCacheAge(timestamp) {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 60) return T(`il y a ${Math.max(1, minutes)} min`, `${Math.max(1, minutes)} min ago`);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return T(`il y a ${hours} h`, `${hours} h ago`);
  const days = Math.floor(hours / 24);
  return T(`il y a ${days} j`, `${days} d ago`);
}
function previewElement(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}
function renderDataPreviewEmpty(message, badge, invalid = false) {
  const badgeEl = $('#dataPreviewBadge');
  badgeEl.className = 'data-preview-badge' + (invalid ? ' invalid' : '');
  badgeEl.textContent = badge;
  $('#dataPreviewLead').textContent = message;
  $('#dataPreviewStats').replaceChildren();
  $('#dataPreviewRows').replaceChildren();
  $('#dataPreviewNote').textContent = T(
    'Cet aperçu est local : aucune requête OSM, OpenBuildingMap, NASA POWER ou relief n’est lancée avant « Générer ».',
    'This preview is local: no OSM, OpenBuildingMap, NASA POWER or terrain request is made before “Generate”.'
  );
}
function renderDataPreview(estimate, cacheStates, checking) {
  const badge = $('#dataPreviewBadge');
  const loadLabel = {
    low: T('faible', 'light'), medium: T('modérée', 'moderate'), high: T('élevée', 'high')
  }[estimate.load];
  badge.className = `data-preview-badge ${estimate.load}`;
  badge.textContent = T(`Charge estimée : ${loadLabel}`, `Estimated load: ${loadLabel}`);

  const skippedCount = estimate.skipped.length;
  const selectedCount = estimate.selected.length;
  $('#dataPreviewLead').textContent = T(
    `${selectedCount} analyse(s) planifiée(s) · ${skippedCount} écartée(s) par leur plafond · estimation locale, sans requête aux fournisseurs.`,
    `${selectedCount} analysis/analyses planned · ${skippedCount} skipped by radius limit · local estimate, no provider requests.`
  );

  const stats = $('#dataPreviewStats');
  stats.replaceChildren();
  const addStat = (value, label) => {
    const card = previewElement('div', 'data-preview-stat');
    card.append(previewElement('b', '', value), previewElement('span', '', label));
    stats.append(card);
  };
  addStat(`${previewNumber(estimate.studyAreaKm2, 2)} km²`, T('surface d’étude estimée', 'estimated study area'));
  addStat(`${previewNumber(estimate.osmAreaKm2, 2)} km²`, T('boîte OSM interrogée', 'OSM query bounding box'));
  addStat(String(estimate.groups.length), T('lots Overpass planifiés', 'planned Overpass batches'));
  addStat(loadLabel, T('indice indicatif, densité inconnue', 'indicative; density unknown'));

  const rows = $('#dataPreviewRows');
  rows.replaceChildren();
  const addRow = (title, detail, status, statusClass = 'pending') => {
    const row = previewElement('article', 'data-preview-row');
    const main = previewElement('div', 'data-preview-row-main');
    main.append(previewElement('div', 'data-preview-row-title', title), previewElement('div', 'data-preview-row-detail', detail));
    row.append(main, previewElement('div', `data-preview-status ${statusClass}`, status));
    rows.append(row);
  };
  for (const group of estimate.groups) {
    const cache = cacheStates.get(group.id);
    const layers = group.keys.map(key => layerLabel(key, S.lang)).join(' · ');
    const title = T(`OpenStreetMap · lot ${group.id}`, `OpenStreetMap · ${group.id} batch`);
    let status, statusClass;
    if (checking && cache === undefined) {
      status = T('Lecture du cache local…', 'Checking local cache…'); statusClass = 'pending';
    } else if (cache?.hit) {
      status = T(`Cache exact : ${previewNumber(cache.count, 0)} objet(s) · ${previewCacheAge(cache.timestamp)}`,
        `Exact cache: ${previewNumber(cache.count, 0)} object(s) · ${previewCacheAge(cache.timestamp)}`);
      statusClass = 'hit';
    } else {
      status = T('Pas de cache exact récent · réseau non testé', 'No recent exact cache · network not tested');
      statusClass = 'miss';
    }
    addRow(title, layers, status, statusClass);
  }
  if (estimate.climate) {
    addRow(
      'NASA POWER · climat',
      T(`${estimate.climate.series} séries × ${previewNumber(estimate.climate.days, 0)} jours ≈ ${previewNumber(estimate.climate.values, 0)} valeurs`,
        `${estimate.climate.series} series × ${previewNumber(estimate.climate.days, 0)} days ≈ ${previewNumber(estimate.climate.values, 0)} values`),
      T('Requête prévue · disponibilité réseau non vérifiée', 'Request planned · network availability not checked')
    );
  }
  if (estimate.windrose) {
    addRow(
      'NASA POWER / MERRA-2 · rose des vents',
      T(`${estimate.windrose.sectors} secteurs · ${estimate.windrose.years} années civiles achevées`,
        `${estimate.windrose.sectors} sectors · ${estimate.windrose.years} completed calendar years`),
      T('Requête prévue · disponibilité réseau non vérifiée', 'Request planned · network availability not checked')
    );
  }
  if (estimate.terrain) {
    addRow(
      T('Terrarium · altimétrie', 'Terrarium · terrain'),
      T(`Grille ${Math.sqrt(estimate.terrain.samples)} × ${Math.sqrt(estimate.terrain.samples)} · zoom ${estimate.terrain.zoom} · ≈ ${estimate.terrain.tiles} tuile(s)`,
        `${Math.sqrt(estimate.terrain.samples)} × ${Math.sqrt(estimate.terrain.samples)} grid · zoom ${estimate.terrain.zoom} · ≈ ${estimate.terrain.tiles} tile(s)`),
      T('Requête prévue · disponibilité réseau non vérifiée', 'Request planned · network availability not checked')
    );
  }
  if (estimate.obm) {
    addRow(
      'OpenBuildingMap · occupation',
      T(`Empreintes et classes d’occupation · zoom ${estimate.obm.zoom} · ≈ ${estimate.obm.tiles} tuile(s)`,
        `Footprints and occupancy classes · zoom ${estimate.obm.zoom} · ≈ ${estimate.obm.tiles} tile(s)`),
      T('Requête prévue · réseau non testé', 'Request planned · network not tested')
    );
  }
  if (!estimate.groups.length && !estimate.climate && !estimate.windrose && !estimate.terrain && !estimate.obm) {
    addRow(T('Calcul local', 'Local calculation'),
      T('Aucune couche ou série externe nécessaire pour cette sélection.', 'No external layer or series is required for this selection.'),
      T('Pas de téléchargement prévu', 'No download planned'), 'hit');
  }
  if (skippedCount) {
    const names = estimate.skipped.map(id => {
      const analysis = CAT.find(item => item.id === id);
      return analysis ? T(analysis.nom, analysis.en) : id;
    }).join(', ');
    addRow(T('Hors plafond de rayon', 'Over radius limit'), names,
      T(`Non exécutée à ${S.site.R} m`, `Not run at ${S.site.R} m`), 'miss');
  }
  $('#dataPreviewNote').textContent = T(
    'La boîte interrogée est rectangulaire autour du site; sa surface peut dépasser le cercle affiché. L’indice combine cette surface, le nombre de lots Overpass et les requêtes annexes — ce n’est ni un nombre prédit d’objets ni une taille de fichier. Le zoom OBM peut baisser pour plafonner le nombre de tuiles; disponibilité et densité restent inconnues avant le chargement. Les comptes réels varient selon la densité cartographique. Le cache navigateur exact (7 jours) est indicatif : selon le mode, le serveur peut être interrogé en premier.',
    'The query box is rectangular around the site and can exceed the displayed circle. The index combines its area, Overpass batch count and ancillary requests—it is not a predicted feature count or file size. Actual counts vary with mapped density. The exact browser cache (7 days) is indicative: depending on access mode, the server may be queried first.'
  );
}
async function updateDataPreview() {
  const ids = selected();
  const revision = ++dataPreviewRevision;
  if (S.site.lat == null || S.site.lon == null) {
    renderDataPreviewEmpty(T('Choisissez un lieu pour prévoir les couches et la charge.', 'Choose a place to preview layers and workload.'), T('Lieu requis', 'Place required'));
    return;
  }
  if (!ids.length) {
    renderDataPreviewEmpty(T('Cochez au moins une analyse pour prévoir les couches requises.', 'Select at least one analysis to preview its required layers.'), T('Aucune analyse', 'No analyses'));
    return;
  }
  let estimate;
  try {
    estimate = estimateDataPreview({ analysisIds: ids, radius: S.site.R, lat: S.site.lat, lon: S.site.lon, shape: S.shape });
  } catch {
    renderDataPreviewEmpty(T('Le plan ne peut pas être estimé : vérifiez le lieu, le rayon et la sélection.', 'The plan cannot be estimated: check the place, radius and selection.'), T('Paramètres à vérifier', 'Check settings'), true);
    return;
  }
  const cacheStates = new Map();
  renderDataPreview(estimate, cacheStates, true);
  const checks = await Promise.all(estimate.groups.map(async group => {
    try {
      const hit = await cacheGet(group.query);
      return [group.id, hit ? {
        hit: true,
        count: Array.isArray(hit.d?.elements) ? hit.d.elements.length : 0,
        timestamp: hit.t
      } : { hit: false }];
    } catch { return [group.id, { hit: false }]; }
  }));
  if (revision !== dataPreviewRevision) return;
  for (const [id, state] of checks) cacheStates.set(id, state);
  renderDataPreview(estimate, cacheStates, false);
}

/* ═══════════════ contexte de rendu ═══════════════ */
function ctxFor(id) {
  const pal = S.pal[id] || 0;
  return {
    sLat: S.site.lat, sLng: S.site.lon, curR: S.site.R,
    shape: S.shape, sitePolygon: S.poly,
    isPro: isPaid(), lang: S.lang === 'en' ? 'en' : 'fr',
    watermark: !isOpenAccess(), time: S.time, sunDate: S.sunDate, siteName: S.site.name,
    D: S.D, terrain: S.terrain, climate: S.climate, windrose: S.windrose, obm: S.obm, noSiteMark: false
  };
}
function renderOne(id) {
  const fn = RND[id];
  if (!fn) return ENG.blank(ctxFor(id), 'ANALYSE NON IMPLÉMENTÉE');
  let svg;
  try { svg = fn(ctxFor(id), S.pal[id] || 0); }
  catch (e) { console.error(id, e); svg = ENG.blank(ctxFor(id), 'ERREUR DE RENDU'); }
  if (S.noText.has(id) && id !== 'obmoccupancy') svg = svg.replace(/<text\b[\s\S]*?<\/text>/g, '');
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
          ${id === 'obmoccupancy' ? '' : `<button title="${T('palette suivante', 'next palette')}" data-pal>◨</button>`}
          ${id === 'obmoccupancy' ? '' : `<button title="${T('texte on/off', 'text on/off')}" data-txt class="${S.noText.has(id) ? 'off' : ''}">✎</button>`}
          <button title="SVG" data-svg>SVG</button>
          <button title="PNG ×3" data-png>PNG</button>
        </span>
      </header>
      <div class="body">${renderOne(id)}</div>
      <footer class="note">${id === 'wind'
        ? T('NASA POWER · MERRA-2 · 10 m · direction = provenance du vent · flux régional, pas de vent local CFD', 'NASA POWER · MERRA-2 · 10 m · direction = where wind comes from · regional flow, not local CFD')
        : id === 'obmoccupancy'
          ? T('OpenBuildingMap · GFZ Data Services (2025) · © OpenStreetMap contributors · ODbL 1.0 · classe inconnue ≠ absence de bâti', 'OpenBuildingMap · GFZ Data Services (2025) · © OpenStreetMap contributors · ODbL 1.0 · unknown class ≠ no building')
          : T('données © OpenStreetMap', 'data © OpenStreetMap')}</footer>`;
    card.querySelector('.title').addEventListener('blur', e => {
      S.names[id] = e.target.textContent.trim().slice(0, 60);
      store.set('names', S.names);
    });
    const paletteButton = card.querySelector('[data-pal]');
    if (paletteButton) paletteButton.addEventListener('click', () => {
      S.pal[id] = ((S.pal[id] || 0) + 1) % 6;
      store.set('pal', S.pal);
      card.querySelector('.body').innerHTML = renderOne(id);
    });
    const textToggle = card.querySelector('[data-txt]');
    if (textToggle) textToggle.addEventListener('click', e => {
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
    : S.obm?.ok
      ? T(
        `${reportNumber(S.obm.featureCount)} empreinte(s) de la couche OpenBuildingMap; ${S.obm.classifiedOccupancyPct == null ? '—' : reportPercent(S.obm.classifiedOccupancyPct)} ont une classe d’occupation renseignée.`,
        `${reportNumber(S.obm.featureCount)} OpenBuildingMap footprint(s); ${S.obm.classifiedOccupancyPct == null ? '—' : reportPercent(S.obm.classifiedOccupancyPct)} have a recorded occupancy class.`)
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
    : S.obm?.ok
      ? T('Couche OpenBuildingMap chargée séparément', 'Separate OpenBuildingMap layer loaded')
      : S.windrose
        ? T('Climatologie régionale NASA POWER', 'NASA POWER regional climatology')
        : T('Aucune couche OSM chargée', 'No OSM layer loaded');
  intro.append(introText, badge); host.append(intro);

  if (S.obm) {
    const obmSection = reportSection(
      T('OpenBuildingMap · occupation des bâtiments', 'OpenBuildingMap · building occupancy'),
      T('Couche facultative, distincte des objets OpenStreetMap interrogés par UrbaTrame.',
        'Optional layer, kept separate from the OpenStreetMap objects queried by UrbaTrame.')
    );
    if (!S.obm.ok) {
      obmSection.append(reportNote(T(
        'La couche OpenBuildingMap n’a pas pu être chargée. Les analyses OSM déjà chargées restent indépendantes.',
        'The OpenBuildingMap layer could not be loaded. Any loaded OSM analyses remain independent.'), 'warning'));
    } else {
      const obmGrid = document.createElement('div'); obmGrid.className = 'report-metrics report-metrics-compact';
      const classifiedText = S.obm.classifiedOccupancyPct == null ? '—' : reportPercent(S.obm.classifiedOccupancyPct);
      obmGrid.append(
        reportMetric(T('Empreintes OpenBuildingMap', 'OpenBuildingMap footprints'), reportNumber(S.obm.featureCount),
          T(`centroïdes dans l’emprise · tuiles z${S.obm.tileZoom}`, `centroids in extent · z${S.obm.tileZoom} tiles`)),
        reportMetric(T('Occupation classée', 'Occupancy classified'), classifiedText,
          T(`${reportNumber(S.obm.knownOccupancyCount)} empreinte(s) sur ${reportNumber(S.obm.featureCount)} · uniquement dans la couche OBM`,
            `${reportNumber(S.obm.knownOccupancyCount)} of ${reportNumber(S.obm.featureCount)} footprints · OBM layer only`)),
        reportMetric(T('Classe inconnue / non renseignée', 'Unknown / unreported class'), reportNumber(S.obm.unknownOccupancyCount),
          T('Ne signifie pas qu’il n’y a pas de bâtiment.', 'Does not mean there is no building.')),
        reportMetric(T('Tuiles reçues', 'Tiles received'), `${reportNumber(S.obm.tilesLoaded)} / ${reportNumber(S.obm.tilesRequested)}`,
          S.obm.partial ? T('Réponse partielle', 'Partial response') : T('Toutes les tuiles demandées', 'All requested tiles'))
      );
      obmSection.append(obmGrid);
      const categories = OBM_CATEGORIES
        .map(item => ({ item, count: S.obm.occupancyCounts?.[item.key] || 0 }))
        .filter(entry => entry.count > 0)
        .sort((a, b) => b.count - a.count);
      if (categories.length) {
        const categoryLine = document.createElement('p'); categoryLine.className = 'report-categories';
        const label = document.createElement('strong');
        label.textContent = T('Classes d’occupation : ', 'Occupancy classes: ');
        categoryLine.append(label, document.createTextNode(categories
          .map(({ item, count }) => `${obmCategoryLabel(item.key, S.lang)} (${reportNumber(count)})`).join(' · ')));
        obmSection.append(categoryLine);
      }
      if (S.obm.partial || S.obm.featuresTruncated) {
        obmSection.append(reportNote(T(
          `Résultat incomplet : ${reportNumber(S.obm.tilesFailed)} tuile(s) en échec${S.obm.featuresTruncated ? ' · affichage des empreintes plafonné, comptages calculés sur les tuiles reçues' : ''}.`,
          `Incomplete result: ${reportNumber(S.obm.tilesFailed)} tile(s) failed${S.obm.featuresTruncated ? ' · displayed footprints capped; counts use the received tiles' : ''}.`), 'warning'));
      }
      obmSection.append(reportNote(T(
        'La part classée décrit seulement les empreintes OBM retournées dans cette emprise; ce n’est pas un taux de complétude du bâti. Les tuiles publiques fournissent ici la classe d’occupation et l’identifiant OSM, pas la hauteur, la surface de plancher ni la provenance par bâtiment. Une classe inconnue ou l’absence d’empreintes renvoyées ne prouve pas l’absence de bâtiments; les empreintes OBM ne sont pas des parcelles ou limites cadastrales.',
        'The classified share describes only the OBM footprints returned within this extent; it is not a building-map completeness rate. The public tiles expose occupancy class and OSM identifier here, not height, floorspace or per-building provenance. An unknown class or zero returned footprints is not evidence of absence; OBM footprints are not plots or cadastral boundaries.'), 'method-note'));
    }
    host.append(obmSection);
  }

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
  const generalMethod = S.mapLoaded ? T(
    'Méthode & limites : les emprises bâties et vertes sont comptées lorsque leur centroïde tombe dans la zone; leur surface entière est sommée, sans découpe au contour. Les superpositions OSM et les cours intérieures non soustraites peuvent augmenter les totaux. Les hauteurs ne sont utilisées que lorsqu’elles sont cartographiées.',
    'Method & limits: building and green polygons are counted when their centroid falls inside the extent; whole areas are summed, without clipping at the boundary. OSM overlaps and un-subtracted inner rings can raise totals. Heights are used only when mapped.')
    : S.windrose ? T(
      'Limite : la rose des vents NASA POWER/MERRA-2 à 10 m est une statistique régionale; elle ne représente pas les effets locaux du bâti, des rues ou du relief fin.',
      'Limitation: the NASA POWER/MERRA-2 wind rose at 10 m is a regional statistic; it does not represent local effects of buildings, streets or fine-scale terrain.')
      : S.obm?.ok ? T(
        'Méthode : les empreintes OBM sont retenues par centroïde dans l’emprise; le dessin des tuiles peut être généralisé et n’est pas découpé au contour.',
        'Method: OBM footprints are selected by centroid within the extent; tile geometry may be generalized and is not clipped to the boundary.')
        : '';
  if (generalMethod) host.append(reportNote(generalMethod, 'method-note'));
  const sourceAttribution = [
    ...(S.mapLoaded ? ['© OpenStreetMap contributors (ODbL)'] : []),
    ...(S.obm?.ok ? ['OpenBuildingMap, GFZ Data Services (2025), ODbL 1.0 · doi.org/10.5880/GFZ.LKUT.2025.002'] : []),
    ...(S.climate || S.windrose ? ['NASA POWER / MERRA-2'] : []),
    ...(S.terrain ? ['Terrarium (SRTM/USGS)'] : [])
  ];
  const sourceNote = `${sourceAttribution.length
    ? T('Sources : ', 'Sources: ') + sourceAttribution.join(' · ')
    : T('Aucune source externe n’a été chargée.', 'No external data source was loaded.')}. ${T(
    'La zone affichée est une emprise d’analyse, pas une limite foncière/cadastrale. Aucun zonage local, droit à construire ou coût de marché n’est inféré.',
    'The displayed shape is a study extent, not a cadastral/property boundary. No local zoning, development right or market cost is inferred.')}`;
  host.append(reportNote(sourceNote, 'method-note'));
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
  if (planObj.selected.includes('obmoccupancy')) list.push({ id: 'obmoccupancy', fr: 'Chargement des tuiles OpenBuildingMap', en: 'Loading OpenBuildingMap tiles' });
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
  /* Une génération fraîche ne doit pas réutiliser les séries d'un autre site
     ou d'une précédente sélection dans la synthèse. */
  S.climate = null;
  S.windrose = null;
  S.terrain = null;
  S.obm = null;

  S.busy = true;
  const list = stages(p, null);
  const state = {}; state.prepare = 'done';
  const t0 = Date.now();
  const tick = setInterval(() => drawLoader(list, state, t0), 500);
  drawLoader(list, state, t0);

  const freeRun = p.selected.every(id => FREE_IDS.includes(id));
  /* En accès libre, l'échec du serveur n'est jamais bloquant : on se rabat
     toujours sur les miroirs publics interrogés par le navigateur. */
  const softTrial = !S.studentAuthRequired && (freeRun || isOpenAccess());
  let run = null, useServer = S.studentAuthRequired || isOpenAccess() || !freeRun;

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
      if (S.studentAuthRequired) {
        if (code === 'STUDENT_AUTH_REQUIRED') window.location.reload();
        toast(T('La session étudiante doit être renouvelée.', 'Please renew your student session.'), false);
        throw e;
      }
      if (!softTrial) {
        if (code === 'LICENCE_REQUIRED') { openPlans(); throw new Error('licence refusée par le serveur'); }
        if (code === 'GENERATION_IN_PROGRESS' || code === 'RATE_LIMITED') {
          toast(errText(code, S.lang) + (e.retryAfter ? ` (${e.retryAfter} s)` : ''), false);
          throw e;
        }
      }
      /* essai gratuit : les lots OSM peuvent partir directement; les sources
         annexes restent appelées séparément et signaleront leurs propres échecs. */
      log(p.groups.length
        ? 'serveur indisponible → Overpass public directement (' + code + ')'
        : 'session indisponible (' + code + ')');
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
          if (S.studentAuthRequired) {
            if (e.error === 'STUDENT_AUTH_REQUIRED') window.location.reload();
            throw e;
          }
          log(`groupe ${g.id} · serveur en échec (${e.error || e.message}) → Overpass public`);
        }
      }
      if (!els) {
        if (S.studentAuthRequired) throw new Error('STUDENT_AUTH_REQUIRED');
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
    if (p.selected.includes('obmoccupancy')) {
      state.obmoccupancy = 'active'; drawLoader(list, state, t0);
      try {
        S.obm = await S.routes.obmOccupancy(S.site.lat, S.site.lon, S.site.R, S.shape, S.device);
        log(`OpenBuildingMap · ${S.obm.featureCount} empreintes · ${S.obm.knownOccupancyCount} classes renseignées · tuiles z${S.obm.tileZoom} ${S.obm.tilesLoaded}/${S.obm.tilesRequested}`);
        state.obmoccupancy = 'done';
      } catch (e) {
        const error = e.error || e.message || 'OBM_SOURCE_UNAVAILABLE';
        S.obm = { ok: false, error, site: { ...requestedSite, radius: requestedSite.R } };
        state.obmoccupancy = 'failed';
        log('OpenBuildingMap indisponible (' + error + ')');
      }
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
    S.obm = null;
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
const modalReturnFocus = new WeakMap();
function openModal(id) {
  const modal = $('#' + id);
  if (!modal.classList.contains('on')) modalReturnFocus.set(modal, document.activeElement);
  modal.classList.add('on');
  modal.setAttribute('aria-hidden', 'false');
  modal.querySelector('[autofocus], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')?.focus();
}
function closeModal(id) {
  const modal = $('#' + id);
  modal.classList.remove('on');
  modal.setAttribute('aria-hidden', 'true');
  const returnFocus = modalReturnFocus.get(modal);
  if (returnFocus?.isConnected) returnFocus.focus();
  modalReturnFocus.delete(modal);
}

/* ═══════════════ assistant spatial local ═══════════════ */
function renderAssistantResult(result) {
  const host = $('#assistantResults');
  if (!host) return;
  host.replaceChildren();
  if (result.warnings.includes('empty')) {
    host.append(reportNote(T('Écrivez une question pour obtenir des propositions.', 'Enter a question to get suggestions.'), 'scenario-prompt'));
    return;
  }
  const card = document.createElement('section'); card.className = 'assistant-result-card';
  const heading = document.createElement('h3');
  heading.textContent = result.noMatch
    ? T('Aucune analyse correspondante dans le catalogue actuel', 'No matching analysis in the current catalogue')
    : T('Analyses proposées · aucune génération lancée', 'Suggested analyses · nothing has been run yet');
  card.append(heading);
  const available = result.analysisIds.filter(id => CAT.some(a => a.id === id && a.impl && unlocked(id)));
  const list = document.createElement('ul');
  for (const id of result.analysisIds) {
    const item = CAT.find(a => a.id === id);
    if (!item) continue;
    const li = document.createElement('li');
    const access = !item.impl ? T(' · prochainement', ' · not implemented') : !unlocked(id) ? ` · ${item.tier.toUpperCase()}` : '';
    li.textContent = T(item.nom, item.en) + access;
    list.append(li);
  }
  if (list.children.length) card.append(list);
  if (result.openReport) {
    const report = document.createElement('p'); report.className = 'fine';
    report.textContent = T('La question concerne aussi le scénario de capacité dans « Synthèse & scénario ».', 'The question also relates to the capacity scenario in “Site summary & scenario”.');
    card.append(report);
  }
  if (!list.children.length && !result.openReport) {
    const noData = document.createElement('p'); noData.className = 'fine';
    noData.textContent = T('Essayez « densité bâtie », « espaces verts », « transport », « soleil » ou « relief ».', 'Try “building density”, “green space”, “transit”, “sun” or “terrain”.');
    card.append(noData);
  }
  host.append(card);
  const warningText = {
    'legal-data': T('Les termes de zonage renvoient seulement aux usages fonctionnels cartographiés dans OSM. Aucun règlement, droit à construire ni contour cadastral n’est fourni ou déduit.', 'Zoning terms map only to functional land-use tags in OSM. No planning rule, development right or cadastral boundary is supplied or inferred.'),
    'indicative-walking-speed': T('L’accessibilité piétonne disponible utilise le réseau OSM et une vitesse indicative fixe de 4,8 km/h; ce n’est pas un trajet en temps réel ni un service de transport public.', 'The available walking-access analysis uses the OSM network and a fixed indicative speed of 4.8 km/h; it is not live routing or public-transit travel time.'),
    'market-data-unavailable': T('Les données démographiques, loyers et fréquentation commerciale ne sont pas actuellement branchées. Elles ne seront pas estimées sans source vérifiable.', 'Demographics, rents and retail footfall are not currently connected. They will not be estimated without a verifiable source.'),
    'user-cost-only': T('Le coût de construction est calculé seulement si vous saisissez un coût unitaire dans le scénario; aucun tarif de marché n’est fourni.', 'Construction cost is calculated only if you enter a unit cost in the scenario; no market price is supplied.')
  };
  for (const code of result.warnings) if (warningText[code])
    host.append(reportNote(warningText[code], 'assistant-warning'));
  if (result.noMatch && !result.warnings.length)
    host.append(reportNote(T('La demande ne correspond pas encore à une analyse disponible. L’assistant local ne fabrique pas de réponse.', 'This request does not yet map to an available analysis. The local helper does not invent an answer.'), 'scenario-prompt'));

  const actions = document.createElement('div'); actions.className = 'assistant-actions';
  if (available.length) {
    const apply = (replace, label) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = replace ? '' : 'primary'; button.textContent = label;
      button.addEventListener('click', () => {
        S.sel = replace ? new Set(available) : new Set([...S.sel, ...available]);
        store.set('sel', [...S.sel]);
        renderCatalog(); updateGenBtn();
        closeModal('assistantModal');
        toast(T(`${available.length} analyse(s) prêtes; cliquez sur « Générer » après vérification.`, `${available.length} analysis/analyses ready; review, then click “Generate”.`));
      });
      return button;
    };
    actions.append(
      apply(false, T('Ajouter à la sélection', 'Add to selection')),
      apply(true, T('Remplacer la sélection', 'Replace selection'))
    );
  }
  if (result.openReport) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = T('Ouvrir la synthèse du site', 'Open site summary');
    button.addEventListener('click', () => { closeModal('assistantModal'); openSiteReport(); });
    actions.append(button);
  }
  if (actions.children.length) host.append(actions);
}
function runSpatialAssistant() {
  latestAssistantResult = analyzeSpatialQuestion($('#assistantQuery').value);
  renderAssistantResult(latestAssistantResult);
}

/* ═══════════════ espace local : projets et modèles ═══════════════ */
const emptySpatialData = () => ({ roads: [], build: [], green: [], pois: [], rail: [], coast: [] });
function readWorkspaceList(key, type) {
  const raw = store.get(key, []);
  const rows = (Array.isArray(raw) ? raw : []).map(validateWorkspaceRecord).filter(x => x && x.type === type);
  store.set(key, rows);
  return rows;
}
function currentWorkspaceName() {
  return $('#workspaceName').value.trim() || S.site.name || T('Projet UrbaTrame', 'UrbaTrame project');
}
function currentWorkspaceFields(name) {
  return {
    name, selectedIds: [...S.sel], shape: S.shape, radius: S.site.R,
    time: S.time, sunDate: S.sunDate, scenario: store.get('siteScenario', {}),
    appearance: { palettes: S.pal, names: S.names, noText: [...S.noText] }
  };
}
function saveWorkspaceProject() {
  const record = createWorkspaceProject({ ...currentWorkspaceFields(currentWorkspaceName()), site: S.site, id: makeWorkspaceId() });
  if (!record) { toast(T('Choisissez un lieu valide avant d’enregistrer un projet.', 'Choose a valid place before saving a project.'), false); return; }
  const rows = upsertWorkspaceRecord(readWorkspaceList('workspaceProjects', 'urbatrame-project'), record);
  store.set('workspaceProjects', rows); renderWorkspace();
  toast(T('Projet enregistré dans ce navigateur.', 'Project saved in this browser.'));
}
function saveWorkspaceTemplate() {
  const record = createWorkspaceTemplate({ ...currentWorkspaceFields(currentWorkspaceName()), id: makeWorkspaceId() });
  if (!record) { toast(T('Nom ou paramètres du modèle invalides.', 'Template name or settings are invalid.'), false); return; }
  const rows = upsertWorkspaceRecord(readWorkspaceList('workspaceTemplates', 'urbatrame-template'), record);
  store.set('workspaceTemplates', rows); renderWorkspace();
  toast(T('Modèle réutilisable enregistré.', 'Reusable template saved.'));
}
function workspaceDate(timestamp) {
  return Number.isFinite(Number(timestamp)) ? new Intl.DateTimeFormat(S.lang === 'en' ? 'en-GB' : 'fr-FR', { dateStyle: 'medium' }).format(new Date(Number(timestamp))) : '—';
}
function workspaceButton(label, handler, primary = false) {
  const button = document.createElement('button'); button.type = 'button';
  if (primary) button.className = 'primary';
  button.textContent = label; button.addEventListener('click', handler); return button;
}
function renderWorkspace() {
  const projectHost = $('#workspaceProjects'), templateHost = $('#workspaceTemplates');
  if (!projectHost || !templateHost) return;
  projectHost.replaceChildren(); templateHost.replaceChildren();
  const projects = readWorkspaceList('workspaceProjects', 'urbatrame-project');
  const templates = readWorkspaceList('workspaceTemplates', 'urbatrame-template');
  const fill = (host, rows, isProject) => {
    if (!rows.length) {
      const empty = document.createElement('p'); empty.className = 'workspace-empty';
      empty.textContent = isProject ? T('Aucun projet enregistré.', 'No saved projects.') : T('Aucun modèle enregistré.', 'No saved templates.');
      host.append(empty); return;
    }
    for (const item of rows) {
      const row = document.createElement('article'); row.className = 'workspace-record';
      const info = document.createElement('div');
      const name = document.createElement('div'); name.className = 'workspace-record-title'; name.textContent = item.name;
      const detail = document.createElement('div'); detail.className = 'workspace-record-meta';
      const place = isProject ? (item.site.name || `${item.site.lat.toFixed(4)}, ${item.site.lon.toFixed(4)}`) + ` · ${item.radius} m` : `${item.radius} m · ${item.shape}`;
      detail.textContent = `${place} · ${item.selectedIds.length} ${T('analyse(s)', 'analysis/analyses')} · ${workspaceDate(item.updatedAt)}`;
      info.append(name, detail);
      const controls = document.createElement('div'); controls.className = 'workspace-record-actions';
      controls.append(workspaceButton(isProject ? T('Ouvrir', 'Load') : T('Appliquer', 'Apply'), () => {
        if (isProject) loadWorkspaceProject(item); else applyWorkspaceTemplate(item);
      }, true));
      controls.append(workspaceButton(T('Supprimer', 'Delete'), () => {
        const key = isProject ? 'workspaceProjects' : 'workspaceTemplates';
        store.set(key, removeWorkspaceRecord(rows, item.id)); renderWorkspace();
      }));
      row.append(info, controls); host.append(row);
    }
  };
  fill(projectHost, projects, true); fill(templateHost, templates, false);
}
function setWorkspaceControls(record) {
  S.sel = new Set(record.selectedIds);
  S.shape = record.shape; S.site.R = record.radius; S.time = record.time; S.sunDate = record.sunDate; S.poly = null;
  store.set('sel', [...S.sel]); store.set('shape', S.shape); store.set('time', S.time); store.set('sunDate', S.sunDate);
  store.set('siteScenario', record.scenario || {});
  if (record.appearance) {
    S.pal = { ...record.appearance.palettes };
    S.names = { ...record.appearance.names };
    S.noText = new Set(record.appearance.noText);
    store.set('pal', S.pal); store.set('names', S.names); store.set('noText', [...S.noText]);
  }
  $('#radius').value = S.site.R; $('#radiusOut').textContent = S.site.R + ' m';
  $('#shape').value = S.shape; $('#time').value = S.time; $('#sunDate').value = S.sunDate;
  $('#timeOut').textContent = `${String(Math.floor(S.time)).padStart(2, '0')}:${String(Math.round((S.time % 1) * 60)).padStart(2, '0')}`;
  const radiusWrap = $('#radiusWrap'); if (radiusWrap) radiusWrap.style.opacity = S.shape === 'poly' ? '.45' : '1';
}
function clearWorkspaceResults() {
  S.D = emptySpatialData(); S.terrain = null; S.climate = null; S.windrose = null; S.obm = null;
  S.mapLoaded = false; S.dataSite = null; S.cacheInfo = '';
}
function finishWorkspaceLoad() {
  renderCatalog(); renderCards(); updateGenBtn();
  if ($('#siteReport')?.classList.contains('on')) renderSiteReport();
  closeModal('workspaceModal');
  toast(T('Configuration chargée. Relancez les analyses pour actualiser les résultats.', 'Configuration loaded. Rerun analyses to refresh results.'));
}
function loadWorkspaceProject(project) {
  clearWorkspaceResults(); setWorkspaceControls(project);
  S.site.R = project.radius;
  const name = project.site.name || `${project.site.lat.toFixed(4)}, ${project.site.lon.toFixed(4)}`;
  $('#q').value = name;
  setSite(project.site.lat, project.site.lon, name);
  finishWorkspaceLoad();
}
function applyWorkspaceTemplate(template) {
  clearWorkspaceResults(); setWorkspaceControls(template);
  if (S.site.lat == null) $('#q').value = '';
  finishWorkspaceLoad();
}
async function importWorkspaceFile(file) {
  if (!file) return;
  try {
    if (file.size > 200_000) throw new Error('FILE_TOO_LARGE');
    const record = parseWorkspaceFile(await file.text());
    if (!record) throw new Error('INVALID_FILE');
    const key = record.type === 'urbatrame-project' ? 'workspaceProjects' : 'workspaceTemplates';
    const rows = readWorkspaceList(key, record.type);
    store.set(key, upsertWorkspaceRecord(rows, record));
    $('#workspaceName').value = record.name;
    renderWorkspace();
    toast(T('Configuration importée dans l’espace local.', 'Configuration imported into the local workspace.'));
  } catch {
    toast(T('Fichier JSON UrbaTrame invalide ou trop volumineux.', 'Invalid or oversized UrbaTrame JSON file.'), false);
  } finally { $('#importWorkspaceFile').value = ''; }
}
function exportCurrentWorkspaceProject() {
  const record = createWorkspaceProject({ ...currentWorkspaceFields(currentWorkspaceName()), site: S.site, id: makeWorkspaceId() });
  if (!record) { toast(T('Choisissez un lieu valide avant l’export.', 'Choose a valid place before exporting.'), false); return; }
  const safeName = record.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'projet';
  download(new Blob([serializeWorkspaceRecord(record)], { type: 'application/json' }), `urbatrame-${safeName}.json`);
}
function openWorkspace() {
  $('#workspaceName').value = S.site.name || '';
  renderWorkspace(); openModal('workspaceModal');
}
function openAssistant() {
  latestAssistantResult = null; $('#assistantResults').replaceChildren();
  openModal('assistantModal'); $('#assistantQuery').focus();
}

function licenceActivationPanel() {
  return `
    <section class="license-activation">
      <h3>${T('Activer avec un fichier de licence', 'Activate with a licence file')}</h3>
      <p>${T('Sélectionnez le fichier .utlic émis pour vous. Il contient un titre signé Pro ou Max; il ne contient aucune donnée de votre projet.', 'Select the .utlic file issued to you. It contains a signed Pro or Max entitlement; it contains no project data.')}</p>
      <label>${T('Fichier de licence UrbaTrame (.utlic)', 'UrbaTrame licence file (.utlic)')}
        <input id="licenseFile" type="file" accept=".utlic,application/json"></label>
      <button id="licenseImport">${T('Importer et activer', 'Import and activate')}</button>
      <div class="row" style="margin-top:12px">
        <button id="restoreBtn" data-fr="Restaurer la licence enregistrée" data-en="Restore stored licence">${T('Restaurer la licence enregistrée', 'Restore stored licence')}</button>
      </div>
      <details class="legacy-license">
        <summary>${T('J’ai un ancien code de licence', 'I have a legacy licence code')}</summary>
        <div class="activate">
          <label>${T('Code de licence', 'Licence code')}<input id="licCode" type="text" placeholder="UT-…" autocomplete="off"></label>
          <button id="licGo">${T('Activer le code', 'Activate code')}</button>
        </div>
      </details>
    </section>`;
}

function wireLicenceActivation(host) {
  host.querySelector('#licenseImport')?.addEventListener('click', async () => {
    if (!ISSUER_PUBLIC_KEY) {
      toast(errText('LICENSE_ISSUER_UNCONFIGURED', S.lang), false);
      return;
    }
    const file = host.querySelector('#licenseFile')?.files?.[0];
    if (!file) { toast(T('Choisissez d’abord un fichier .utlic.', 'Choose a .utlic file first.'), false); return; }
    if (file.size > 16_384) { toast(T('Fichier trop volumineux.', 'File is too large.'), false); return; }
    try {
      const doc = JSON.parse(await file.text());
      if (doc?.format !== 'UrbaTrame-License' || doc?.version !== 1 ||
          typeof doc?.token !== 'string' || doc.token.length > 12_000)
        throw new Error('INVALID_LICENSE_FILE');
      await activateLicenseToken(doc.token);
    } catch (error) {
      toast(errText(error.error || error.message || 'INVALID_LICENSE_FILE', S.lang), false);
    }
  });
  host.querySelector('#licGo')?.addEventListener('click', () => activate(host.querySelector('#licCode').value.trim()));
  host.querySelector('#restoreBtn')?.addEventListener('click', restore);
}

function openPlans() {
  const p = $('#planBody');
  if (S.studentAuthRequired) {
    const owner = S.studentUser?.isOwner === true && S.studentUser?.role === 'admin';
    const title = owner ? T('Accès propriétaire', 'Owner access') : T('Accès universitaire', 'University access');
    const detail = !S.studentUser
      ? T('Connectez-vous avec une adresse ajoutée à la liste autorisée pour recevoir automatiquement Max, qui inclut Pro.', 'Sign in with an address on the approved list to receive Max automatically; Max includes Pro.')
      : owner
        ? T('Session propriétaire authentifiée. Vous disposez du rôle administrateur et du niveau Max, incluant Pro.', 'Owner session authenticated. You have the administrator role and Max, including Pro.')
        : T('Votre adresse universitaire est vérifiée. Vous disposez automatiquement de Max, y compris toutes les fonctions Pro.', 'Your university address is verified. Max is included automatically, together with all Pro features.');
    p.innerHTML = `<div class="plans-open"><h3>${title}</h3><p>${detail}</p></div>`;
    openModal('plans');
    return;
  }
  const openNotice = isOpenAccess() ? `
    <div class="plans-open">
      <h3>${T('Accès libre', 'Open access')}</h3>
      <p>${T('Toutes les analyses sont ouvertes actuellement. Un fichier Pro/Max peut être activé et conservé, mais les droits ne seront appliqués que lorsque le serveur sera configuré en mode licence.', 'Every analysis is currently open. A Pro/Max file can be activated and stored, but the tier will only be enforced when the server is configured for licence mode.')}</p>
    </div>` : '';
  const tiers = isOpenAccess() ? '' : `
    <div class="plans">
      <section class="plan">
        <h3>Pro</h3><div class="per">${T('Les 5 analyses gratuites + les 33 analyses Pro', 'The 5 free analyses + 33 Pro analyses')}</div>
        <ul><li>${T('Morphologie, usages et mobilité', 'Morphology, land use and mobility')}</li>
        <li>${T('Relief et climat', 'Terrain and climate')}</li>
        <li>${T('Accès sans filigrane', 'No watermark')}</li></ul>
      </section>
      <section class="plan max">
        <h3>Max</h3><div class="per">${T('Tout Pro + les 8 planches Max', 'Everything in Pro + the 8 Max boards')}</div>
        <ul><li>${T('Planches de contexte et d’insertion', 'Context and site-insertion boards')}</li>
        <li>${T('Données urbaines · nœuds et trame', 'Urban data · nodes and grid')}</li>
        <li>${T('Cônes de vue et accès radial', 'View cones and radial access')}</li></ul>
      </section>
    </div>
    <p class="fine">${T('Cette activation ne traite aucun paiement. Les tarifs et conditions commerciales restent à définir.', 'This activation does not process payments. Pricing and commercial terms remain to be set.')}</p>`;
  p.innerHTML = openNotice + tiers + licenceActivationPanel();
  wireLicenceActivation(p);
  openModal('plans');
}

function saveActivation(d, { code = null, licenseToken = null } = {}) {
  S.session = { account: d.account, token: d.token };
  store.set('session', S.session);
  if (code) {
    store.set('rcode', code);
    store.set('licenseToken', null);
    S.licenseToken = null;
  }
  if (licenseToken) {
    S.licenseToken = licenseToken;
    store.set('licenseToken', licenseToken);
    store.set('rcode', null);
  }
  if (d.ent) { S.ent = d.ent; store.set('ent', d.ent); }
}

async function activate(code) {
  if (!code) return;
  try {
    const d = await S.routes.activate(code, S.device);
    if (d.error) { toast(errText(d.error, S.lang), false); return; }
    saveActivation(d, { code });
    await refreshEntitlement();
    closeModal('plans');
    toast(T('Licence activée', 'Licence activated'));
    log(`licence ${S.tier.toUpperCase()} activée`);
  } catch (e) { toast(errText(e.error || e.message, S.lang), false); }
}

async function activateLicenseToken(token) {
  if (!token) return;
  if (!ISSUER_PUBLIC_KEY) { toast(errText('LICENSE_ISSUER_UNCONFIGURED', S.lang), false); return; }
  const claims = await verifyLicenseFileToken(token);
  if (!claims) { toast(errText('INVALID_LICENSE', S.lang), false); return; }
  S.licenseToken = token;
  S.session = { account: 'license_' + claims.licenseId, token };
  S.ent = null;
  store.set('licenseToken', token);
  store.set('session', S.session);
  store.set('ent', null);
  store.set('rcode', null);
  await refreshEntitlement();
  closeModal('plans');
  toast(T('Licence signée activée', 'Signed licence activated'));
  log(`licence ${claims.tier.toUpperCase()} activée · ${claims.licenseId}`);
}

async function restore() {
  const licenseToken = S.licenseToken || store.get('licenseToken', null);
  if (licenseToken) { await activateLicenseToken(licenseToken); return; }
  const code = store.get('rcode', null);
  if (!code) { toast(T('Aucune licence enregistrée sur cet appareil', 'No stored licence on this device'), false); return; }
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
    scheduleDataPreview();
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
    S.terrain = null; S.climate = null; S.windrose = null; S.obm = null; S.mapLoaded = false; S.dataSite = null;
    renderCards(); updateGenBtn();
    if ($('#siteReport')?.classList.contains('on')) renderSiteReport();
    log('carte vidée');
  });
  $('#cacheBtn').addEventListener('click', async () => {
    await cacheClear(); toast(T('Cache des requêtes vidé', 'Query cache cleared'));
    log('cache IndexedDB vidé'); scheduleDataPreview();
  });
  $('#plansBtn').addEventListener('click', openPlans);
  $('#restoreBtn')?.addEventListener('click', restore);
  $('#helpBtn').addEventListener('click', () => openModal('help'));
  $('#assistantBtn').addEventListener('click', openAssistant);
  $('#assistantAnalyze').addEventListener('click', runSpatialAssistant);
  $('#assistantQuery').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runSpatialAssistant(); });
  $$('[data-assistant-query]').forEach(button => button.addEventListener('click', () => {
    $('#assistantQuery').value = button.dataset.assistantQuery || '';
    runSpatialAssistant();
  }));
  $('#workspaceBtn').addEventListener('click', openWorkspace);
  $('#saveWorkspaceProject').addEventListener('click', saveWorkspaceProject);
  $('#saveWorkspaceTemplate').addEventListener('click', saveWorkspaceTemplate);
  $('#exportWorkspaceProject').addEventListener('click', exportCurrentWorkspaceProject);
  $('#importWorkspaceFile').addEventListener('change', e => importWorkspaceFile(e.target.files?.[0]));
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
    if (e.key !== 'Escape') return;
    if ($('#siteReport').classList.contains('on')) closeSiteReport();
    else {
      const modal = $$('.modal.on').at(-1);
      if (modal) closeModal(modal.id);
    }
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
  $$('[data-close]').forEach(b => b.addEventListener('click', () => closeModal(b.closest('.modal').id)));
  $$('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m) closeModal(m.id); }));
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
  const studentAuth = await studentAuthReady;
  S.studentAuthRequired = studentAuth.required === true;
  S.studentUser = studentAuth.authenticated ? studentAuth.user : null;
  if (S.studentAuthRequired) S.access = 'licence';

  /* Les sessions/licences historiques ne remplacent pas l'authentification
     universitaire; elles sont ignorées dans le régime étudiant. */
  if (!S.studentAuthRequired && S.session) {
    try {
      const d = await S.routes.check(S.device, S.session);
      if (d.ent) { S.ent = d.ent; store.set('ent', d.ent); }
      else if (d.error) {
        const signedLicense = await verifyLicenseFileToken(S.licenseToken);
        if (signedLicense) {
          S.session = { account: 'license_' + signedLicense.licenseId, token: S.licenseToken };
          store.set('session', S.session);
          store.set('ent', null); S.ent = null;
        } else {
          S.session = null; store.set('session', null); store.set('ent', null); S.ent = null;
        }
      }
    } catch (e) { log('vérification serveur indisponible : ' + (e.message || e)); }
  }
  await refreshEntitlement();

  const mayUseApp = !S.studentAuthRequired || Boolean(S.studentUser);
  if (mayUseApp && qp.get('vue3d') === '1') setTimeout(() => vue3D(), 400);
  if (mayUseApp && qp.get('upgrade')) openPlans();
  if (mayUseApp && qp.get('sample') === '1') setTimeout(loadSample, 300);
  if (mayUseApp && qp.get('q')) {
    $('#q').value = qp.get('q');
    setTimeout(doSearch, 400);
  }
  if (S.studentAuthRequired)
    log(S.studentUser?.isOwner === true
      ? 'session propriétaire active · rôle administrateur · palier MAX'
      : S.studentUser ? 'session étudiante active · palier MAX (Pro inclus)' : 'authentification universitaire requise');
  else log(isOpenAccess()
    ? `prêt · ${T('accès libre — toutes les analyses, sans filigrane', 'open access — every analysis, no watermark')}`
    : `prêt · ${T('essai gratuit = 5 analyses filigranées', 'free trial = 5 watermarked analyses')}`);
}

init();
window.addEventListener('beforeprint', () => document.body.classList.add('printing'));
