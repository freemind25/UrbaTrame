/* UrbaTrame · Analyse architecturale — interface
   Relie le formulaire de relevé au moteur de calcul et aux dessins.
   Tout reste local : aucune requête réseau, aucun envoi de fichier. */

import {
  normalizeSurvey, computeMetrics, describeHL, daylightSummary, demainScenario,
  surveyWarnings, surveyFromJSON, surveyToJSON, DEMO_SURVEY, fr, formatHour
} from './archi-rue.mjs';
import { renderAll, PLANCHE_W, PLANCHE_H } from './archi-rue-draw.mjs';

const STORAGE_KEY = 'urbatrame.archi.survey.v1';

const $ = id => document.getElementById(id);

const TABS = {
  usages: 'Plan des usages',
  profil: 'Profil en travers',
  fronts: 'Front bâti déroulé',
  axo: 'Axonométrie',
  ombres: 'Étude d’ombre',
  demain: 'Avant / après',
  planche: 'Planche A3 — six dessins'
};

let state = {
  survey: null,
  drawings: {},
  active: 'usages'
};

/* ------------------------------------------------------------------ */
/* Formulaire                                                          */
/* ------------------------------------------------------------------ */

function bandeRow(bande = { type: 'passage', largeur: 3.5, cote: '' }) {
  const row = document.createElement('div');
  row.className = 'bande';
  const types = [
    ['terrasse', 'terrasse'],
    ['passage', 'passage'],
    ['livraison', 'livraison'],
    ['autre', 'autre']
  ];
  const cotes = [['', '—'], ['ouest', 'ouest'], ['est', 'est']];
  row.innerHTML =
    `<label><select data-k="type">${types.map(([v, l]) => `<option value="${v}"${v === bande.type ? ' selected' : ''}>${l}</option>`).join('')}</select></label>` +
    `<label><input data-k="largeur" type="number" step="0.05" min="0" max="60" value="${Number(bande.largeur) || 0}"></label>` +
    `<label><select data-k="cote">${cotes.map(([v, l]) => `<option value="${v}"${v === (bande.cote || '') ? ' selected' : ''}>${l}</option>`).join('')}</select><span class="unit">côté</span></label>` +
    `<button type="button" title="Supprimer cette bande" aria-label="Supprimer cette bande">×</button>`;
  row.querySelector('button').addEventListener('click', () => {
    row.remove();
    applyForm();
  });
  row.querySelectorAll('select, input').forEach(el => el.addEventListener('input', applyForm));
  return row;
}

function renderBandes(bandes) {
  const host = $('bandes');
  host.textContent = '';
  for (const b of bandes) host.appendChild(bandeRow(b));
}

function bandesFromForm() {
  return [...$('bandes').querySelectorAll('.bande')].map(row => ({
    type: row.querySelector('[data-k="type"]').value,
    largeur: Number(row.querySelector('[data-k="largeur"]').value) || 0,
    cote: row.querySelector('[data-k="cote"]').value
  }));
}

function fillForm(survey) {
  const s = normalizeSurvey(survey);
  $('f-nom').value = s.nom;
  $('f-lieu').value = s.lieu;
  $('f-date').value = s.date;
  $('f-lat').value = s.latitude;
  $('f-lon').value = s.longitude;
  $('f-axe').value = s.axe_deg;
  $('f-axe-hyp').checked = s.axe_hypothese;
  $('f-largeur').value = s.largeur_facades;
  $('f-longueur').value = s.longueur_relevee;
  $('f-sol').value = s.sol;
  $('f-ouest-niveaux').value = s.facades.ouest.niveaux;
  $('f-ouest-rdc').value = s.facades.ouest.rdc;
  $('f-ouest-egout').value = s.facades.ouest.hauteur_egout;
  $('f-ouest-faitage').value = s.facades.ouest.hauteur_faitage;
  $('f-est-niveaux').value = s.facades.est.niveaux;
  $('f-est-rdc').value = s.facades.est.rdc;
  $('f-est-egout').value = s.facades.est.hauteur_egout;
  $('f-est-faitage').value = s.facades.est.hauteur_faitage;
  $('f-gens-vus').value = s.gens.vus;
  $('f-gens-plan').value = s.gens.en_plan;
  $('f-bornes').value = s.mobilier.bornes;
  $('f-potelets').value = s.mobilier.potelets;
  $('f-reverberes').value = s.mobilier.reverberes;
  $('f-arbres').value = s.mobilier.arbres;
  $('f-arceaux').value = s.mobilier.arceaux;
  $('f-poubelles').value = s.mobilier.poubelles;
  renderBandes(s.bandes);
}

function surveyFromForm() {
  return normalizeSurvey({
    nom: $('f-nom').value,
    lieu: $('f-lieu').value,
    date: $('f-date').value,
    latitude: $('f-lat').value,
    longitude: $('f-lon').value,
    axe_deg: $('f-axe').value,
    axe_hypothese: $('f-axe-hyp').checked,
    largeur_facades: $('f-largeur').value,
    longueur_relevee: $('f-longueur').value,
    sol: $('f-sol').value,
    bandes: bandesFromForm(),
    facades: {
      ouest: {
        niveaux: $('f-ouest-niveaux').value,
        rdc: $('f-ouest-rdc').value,
        hauteur_egout: $('f-ouest-egout').value,
        hauteur_faitage: $('f-ouest-faitage').value
      },
      est: {
        niveaux: $('f-est-niveaux').value,
        rdc: $('f-est-rdc').value,
        hauteur_egout: $('f-est-egout').value,
        hauteur_faitage: $('f-est-faitage').value
      }
    },
    mobilier: {
      bornes: $('f-bornes').value,
      potelets: $('f-potelets').value,
      reverberes: $('f-reverberes').value,
      arbres: $('f-arbres').value,
      arceaux: $('f-arceaux').value,
      poubelles: $('f-poubelles').value
    },
    gens: { vus: $('f-gens-vus').value, en_plan: $('f-gens-plan').value }
  });
}

/* ------------------------------------------------------------------ */
/* Rendu                                                               */
/* ------------------------------------------------------------------ */

function toast(message, error = false) {
  const el = $('toast');
  el.textContent = message;
  el.classList.toggle('error', error);
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 3600);
}

let renderTimer = null;

function applyForm({ immediate = false } = {}) {
  const survey = surveyFromForm();
  state.survey = survey;
  const sum = survey.bandes.reduce((t, b) => t + b.largeur, 0);
  const el = $('bandeSum');
  const delta = sum - survey.largeur_facades;
  el.textContent = `Somme des bandes : ${fr(sum)} m pour ${fr(survey.largeur_facades)} m entre façades` +
    (Math.abs(delta) > 0.05 ? ` — écart de ${fr(Math.abs(delta))} m` : ' — cohérent');
  el.classList.toggle('warn', Math.abs(delta) > 0.05);

  try {
    localStorage.setItem(STORAGE_KEY, surveyToJSON(survey));
  } catch (e) { /* stockage plein ou bloqué : le relevé reste en mémoire */ }

  clearTimeout(renderTimer);
  const run = () => draw();
  if (immediate) run(); else renderTimer = setTimeout(run, 220);
}

function draw() {
  const survey = state.survey;
  try {
    state.drawings = renderAll(survey);
  } catch (error) {
    toast('Le dessin a échoué : ' + error.message, true);
    return;
  }
  showTab(state.active);
  renderMetrics();
  renderWarnings();
}

function showTab(key) {
  state.active = key;
  for (const btn of document.querySelectorAll('.tabs button')) {
    btn.setAttribute('aria-selected', String(btn.dataset.tab === key));
  }
  $('stageTitle').textContent = TABS[key] || key;
  const svg = state.drawings[key] || '';
  $('viewport').innerHTML = svg;
  const vp = $('viewport').querySelector('svg');
  if (vp) {
    vp.setAttribute('role', 'img');
    vp.setAttribute('aria-label', TABS[key] || '');
  }
  renderExplain(key);
}

function metric(label, value, unit = '') {
  return `<div class="metric"><span>${label}</span><strong>${value}${unit ? ` <small>${unit}</small>` : ''}</strong></div>`;
}

function renderMetrics() {
  const s = state.survey;
  const m = computeMetrics(s);
  const { summer, winter } = daylightSummary(s);
  $('metrics').innerHTML = [
    metric('Largeur', fr(m.largeur), 'm'),
    metric('Longueur relevée', fr(m.longueur, 0), 'm'),
    metric('Rapport H/L', fr(m.hl, 2), m.typeRue),
    metric('Ciel vu de l’axe', fr(m.cielDeg, 0), '°'),
    metric('Terrasses', fr(m.partTerrasses, 0), '% de la largeur'),
    metric('Passage libre', fr(m.partPassage, 0), '% de la largeur'),
    metric('Soleil au sol · 21 juin', formatHour(summer.anyHours), 'h directes'),
    metric('Soleil au sol · 21 déc.', formatHour(winter.anyHours), 'h directes')
  ].join('');
}

function renderExplain(key) {
  const s = state.survey;
  const m = computeMetrics(s);
  const { summer, winter } = daylightSummary(s);
  const sc = demainScenario(s);
  const texts = {
    usages: `<strong>Lecture.</strong> Les terrasses occupent ${fr(m.partTerrasses, 0)} % de la largeur entre façades, le passage libre ${fr(m.partPassage, 0)} %. ` +
      `${Math.round(s.gens.vus)} personnes sont comptées sur la photo, ${Math.round(s.gens.en_plan)} sont reportées au plan (positions indicatives, réparties par tirage reproductible).`,
    profil: `<strong>Lecture.</strong> H/L ≈ ${fr(m.hl, 2)} : ${describeHL(m)} Le ciel vu de l’axe mesure ${fr(m.cielDeg, 0)}°. ` +
      `Hauteurs à l’égout : ${fr(m.hauteurOuest, 1)} m à l’ouest, ${fr(m.hauteurEst, 1)} m à l’est.`,
    fronts: `<strong>Lecture.</strong> Le front ouest est dessiné immeuble par immeuble, avec une ligne rouge qui suit l’égout de toit. ` +
      `Les cotes en rouge sont celles relevées ; le point d’interrogation signale une hauteur déduite faute de mesure.`,
    axo: `<strong>Lecture.</strong> Vue de l’entrée de la rue à 30° : les façades ouest sont vues, les façades est sont cachées par leur propre volume. ` +
      `La profondeur d’îlot est forfaitaire (5,5 m) : elle sert à donner du corps aux volumes, pas à décrire les parcelles.`,
    ombres: `<strong>Lecture.</strong> Le 21 juin, le sol reçoit du soleil direct de ${summer.firstLegal != null ? formatHour(summer.firstLegal) : '—'} à ` +
      `${summer.lastLegal != null ? formatHour(summer.lastLegal) : '—'}, soit ${formatHour(summer.anyHours)} au meilleur point et ${formatHour(summer.meanHours)} en moyenne sur la largeur. ` +
      `Le 21 décembre : ${winter.anyHours ? formatHour(winter.anyHours) + ' au meilleur point' : 'aucun soleil direct au sol'}.`,
    demain: `<strong>Lecture.</strong> ${sc.trees} arbre(s) possible(s), ${fr(sc.pleineTerre, 1)} m² de pleine terre, passage libre ramené de ${fr(sc.freeBefore)} m à ${fr(sc.freeAfter)} m. ` +
      `Le scénario ne supprime aucune terrasse et ne descend jamais sous ${fr(sc.minFree)} m de passage.`,
    planche: `<strong>Lecture.</strong> La planche rassemble les six dessins, sans les redessiner : ils sont insérés tels quels, avec un cartouche et la date du relevé.`
  };
  $('explain').innerHTML = texts[key] || '';
}

function renderWarnings() {
  const list = surveyWarnings(state.survey);
  $('warnings').innerHTML = list.length
    ? list.map(w => `<p class="warning ${w.niveau}">${escapeHtml(w.texte)}</p>`).join('')
    : '<p class="warning info">Aucune incohérence : le relevé est complet et cohérent.</p>';
}

function escapeHtml(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ------------------------------------------------------------------ */
/* Téléchargements                                                     */
/* ------------------------------------------------------------------ */

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function safeName() {
  return (state.survey.nom || 'rue').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function downloadSvg() {
  const svg = state.drawings[state.active];
  if (!svg) return;
  download(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `${safeName()}-${state.active}.svg`);
  toast('SVG téléchargé — il reste vectoriel et modifiable.');
}

function downloadPng() {
  const svg = state.drawings[state.active];
  if (!svg) return;
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = PLANCHE_W * scale;
  canvas.height = PLANCHE_H * scale;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f7f3ea';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const image = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  image.onload = () => {
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    canvas.toBlob(blob => {
      if (blob) {
        download(blob, `${safeName()}-${state.active}.png`);
        toast('PNG téléchargé (2160 × 3840).');
      }
    }, 'image/png');
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    toast('Le navigateur n’a pas pu rasteriser le SVG : utilisez le SVG ou l’impression.', true);
  };
  image.src = url;
}

/* ------------------------------------------------------------------ */
/* Démarrage                                                           */
/* ------------------------------------------------------------------ */

function boot() {
  let survey = DEMO_SURVEY;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) survey = surveyFromJSON(saved);
  } catch (e) { /* fichier de session illisible : on repart de l’exemple */ }

  fillForm(survey);

  for (const id of ['f-nom', 'f-lieu', 'f-date', 'f-lat', 'f-lon', 'f-axe', 'f-largeur', 'f-longueur',
    'f-sol', 'f-ouest-niveaux', 'f-ouest-rdc', 'f-ouest-egout', 'f-ouest-faitage',
    'f-est-niveaux', 'f-est-rdc', 'f-est-egout', 'f-est-faitage',
    'f-gens-vus', 'f-gens-plan', 'f-bornes', 'f-potelets', 'f-reverberes', 'f-arbres',
    'f-arceaux', 'f-poubelles']) {
    $(id).addEventListener('input', () => applyForm());
  }
  $('f-axe-hyp').addEventListener('change', () => applyForm());

  $('add-bande').addEventListener('click', () => {
    $('bandes').appendChild(bandeRow({ type: 'passage', largeur: 1, cote: '' }));
    applyForm();
  });

  for (const btn of document.querySelectorAll('.tabs button')) {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
  }

  $('downloadSvg').addEventListener('click', downloadSvg);
  $('downloadPng').addEventListener('click', downloadPng);
  $('printBtn').addEventListener('click', () => {
    showTab('planche');
    setTimeout(() => window.print(), 120);
  });

  $('exportBtn').addEventListener('click', () => {
    download(new Blob([surveyToJSON(state.survey)], { type: 'application/json;charset=utf-8' }), 'rue.json');
    toast('Relevé exporté en rue.json.');
  });

  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', async event => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const survey = surveyFromJSON(text);
      fillForm(survey);
      applyForm({ immediate: true });
      toast('Relevé importé.');
    } catch (error) {
      toast('Fichier refusé : ' + error.message, true);
    }
    event.target.value = '';
  });

  $('photoBtn').addEventListener('click', () => $('photoFile').click());
  $('photoFile').addEventListener('change', event => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      toast('Ce fichier n’est pas une image.', true);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      $('photoPreview').src = String(reader.result);
      $('photoCaption').textContent = `${file.name} · ${(file.size / 1024).toFixed(0)} ko · conservée dans l’onglet seulement`;
      $('photoWrap').hidden = false;
      toast('Photo de référence affichée — elle ne quitte pas ce navigateur.');
    };
    reader.onerror = () => toast('La photo n’a pas pu être lue.', true);
    reader.readAsDataURL(file);
    event.target.value = '';
  });
  $('photoClear').addEventListener('click', () => {
    $('photoPreview').removeAttribute('src');
    $('photoWrap').hidden = true;
    $('photoCaption').textContent = '';
    toast('Photo retirée.');
  });

  $('demoBtn').addEventListener('click', () => {
    fillForm(DEMO_SURVEY);
    applyForm({ immediate: true });
    toast('Exemple Montorgueil rechargé.');
  });

  $('clearBtn').addEventListener('click', () => {
    fillForm(normalizeSurvey({ nom: 'Ma rue', date: new Date().toISOString().slice(0, 10) }));
    applyForm({ immediate: true });
    toast('Relevé vide : à vous de mesurer.');
  });

  state.survey = survey;
  draw();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
