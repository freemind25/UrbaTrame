const STORAGE_KEY = 'urbatrame.atelier-analyse.v1';
const STATUS_LABELS = { todo: 'À faire', doing: 'En cours', done: 'Terminé' };

const sessions = [
  {
    id: 'S1', phase: 'Cadrage', title: 'Cadrage et organisation',
    activity: 'Présentation du quartier imposé, découpage en secteurs, répartition des groupes et préparation du matériel.',
    deliverable: 'Fiche d’identification amorcée'
  },
  {
    id: 'S2', phase: 'Méthode et corpus', title: 'Méthode et corpus',
    activity: 'Reprendre les quatre gestes, les six dimensions et les registres du cours, puis inventorier les sources disponibles.',
    deliverable: 'Question de lecture validée et fiche de source type'
  },
  {
    id: 'S3', phase: 'Terrain 1 · demi-journée', title: 'Reconnaissance d’ensemble',
    activity: 'Suivre un itinéraire fixe, réaliser des croquis et des photographies datées, localiser les limites d’étude.',
    deliverable: 'Carnet de terrain rempli à la main et premières fiches-indices'
  },
  {
    id: 'S4', phase: 'Localisation et situation', title: 'Situer le quartier',
    activity: 'Préparer les deux plans obligatoires : la ville et l’environnement proche du quartier.',
    deliverable: 'Plan 1 et plan 2'
  },
  {
    id: 'S5', phase: 'Histoire et transformations', title: 'Lire les transformations dans le temps',
    activity: 'Comparer des cartes d’époques différentes et relever les strates et les traces de transformation.',
    deliverable: 'Carte des phases de croissance, tableau des strates et fiches-indices (processus)',
    historyProposal: true
  },
  {
    id: 'S6', phase: 'Structure spatiale', title: 'Viaire, îlots, pleins et vides',
    activity: 'Étudier la trame viaire, sa hiérarchie et sa connectivité, les îlots, les pleins et les vides, puis découper les secteurs.',
    deliverable: 'Cartes viaire et pleins/vides, liste des secteurs et fiches-indices (forme)'
  },
  {
    id: 'S7', phase: 'Restitution 1', title: 'Présenter et critiquer le travail',
    activity: 'Présenter oralement le travail en cours et participer à la critique collective.',
    deliverable: 'Dossier intermédiaire (parties 1 à 4)'
  },
  {
    id: 'S8', phase: 'Terrain 2 · demi-journée', title: 'Relevés ciblés',
    activity: 'Relever les profils de rue, façades, matériaux et comptages, puis compléter les photographies.',
    deliverable: 'Carnet de terrain, mesures et fiches-indices'
  },
  {
    id: 'S9', phase: 'Bâti, parcelles et rues', title: 'Décrire les formes bâties',
    activity: 'Étudier le parcellaire disponible, les implantations, gabarits et typologies, les profils de rue et les rapports H/D.',
    deliverable: 'Carte parcellaire disponible, planches typologiques, profils et fiches-indices (état)',
    caution: 'Les parcelles sont affichées uniquement lorsqu’elles sont cartographiées dans OpenStreetMap. Les rapports H/D nécessitent des mesures ou des valeurs réellement observées ou saisies.'
  },
  {
    id: 'S10', phase: 'Usages, mobilités et perception', title: 'Parcourir et qualifier les usages',
    activity: 'Renseigner la grille d’usages, les parcours, coupures et ambiances, puis repérer les cinq éléments de Lynch.',
    deliverable: 'Carte des usages et parcours, grille remplie et fiches-indices (usage)'
  },
  {
    id: 'S11', phase: 'Environnement et paysage', title: 'Observer les milieux et le paysage',
    activity: 'Documenter le relief, la végétation, l’eau et les sols, ainsi que l’ombrage et les vues observés.',
    deliverable: 'Carte environnementale et fiches-indices (milieux)'
  },
  {
    id: 'S12', phase: 'Acteurs et documents', title: 'Croiser acteurs et sources',
    activity: 'Lister les acteurs et leurs rôles; consigner l’intitulé, la date et le statut des documents consultés; croiser les sources.',
    deliverable: 'Tableau des acteurs, tableau des documents et fiches-indices (processus)'
  },
  {
    id: 'S13', phase: 'Mise en forme et cohérence', title: 'Finaliser les planches',
    activity: 'Vérifier les légendes, échelles et sources, la cohérence graphique et la relecture croisée entre groupes.',
    deliverable: 'Planches finalisées, fichier d’indices et plan de localisation des indices'
  },
  {
    id: 'S14', phase: 'Restitution 2', title: 'Restitution finale',
    activity: 'Préparer la présentation orale finale, l’auto-évaluation et le retour collectif.',
    deliverable: 'Dossier complet, auto-évaluation et dossier de passage (§ 11.5)'
  }
];

function emptyState() {
  return {
    group: 'Groupe n°5',
    neighborhood: '',
    sessions: Object.fromEntries(sessions.map(session => [session.id, { status: 'todo', note: '' }]))
  };
}

function readState() {
  const fallback = emptyState();
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!parsed || typeof parsed !== 'object') return fallback;
    fallback.group = typeof parsed.group === 'string' ? parsed.group.slice(0, 80) : fallback.group;
    fallback.neighborhood = typeof parsed.neighborhood === 'string' ? parsed.neighborhood.slice(0, 120) : '';
    for (const session of sessions) {
      const item = parsed.sessions?.[session.id];
      if (!item || typeof item !== 'object') continue;
      fallback.sessions[session.id] = {
        status: Object.hasOwn(STATUS_LABELS, item.status) ? item.status : 'todo',
        note: typeof item.note === 'string' ? item.note.slice(0, 2000) : ''
      };
    }
  } catch { /* stockage indisponible : le suivi reste utilisable en mémoire */ }
  return fallback;
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

let state = readState();
const sessionList = document.querySelector('#sessionList');
const filter = document.querySelector('#sessionFilter');
const saveStatus = document.querySelector('#saveStatus');

function persist(message = 'Enregistré dans ce navigateur') {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    saveStatus.textContent = message;
  } catch {
    saveStatus.textContent = 'Stockage local indisponible';
  }
}

function renderSessions() {
  const chosen = filter.value;
  const visible = sessions.filter(session => chosen === 'all' || state.sessions[session.id].status === chosen);
  if (!visible.length) {
    sessionList.innerHTML = '<p class="no-sessions">Aucune séance dans ce filtre.</p>';
    return;
  }
  sessionList.innerHTML = visible.map(session => {
    const item = state.sessions[session.id];
    const noteLabel = `Notes du groupe pour ${session.id}`;
    const history = session.historyProposal
      ? '<aside class="history-proposal"><strong>Prochaine évolution à construire :</strong> importer une carte d’époque, la géoréférencer et la comparer à la carte actuelle par transparence ou par balayage. Les tracés historiques resteront datés, sourcés et non cadastraux.</aside>'
      : '';
    const caution = session.caution
      ? `<aside class="history-proposal"><strong>Précaution :</strong> ${session.caution}</aside>`
      : '';
    return `<article class="session-card" data-session="${session.id}" data-status="${item.status}">
      <div class="session-card-head">
        <span class="session-number">${session.id}</span>
        <div class="session-title-wrap"><p class="session-phase">${session.phase}</p><h3>${session.title}</h3></div>
        <label class="visually-hidden" for="status-${session.id}">Avancement ${session.id}</label>
        <select class="session-status" id="status-${session.id}" data-session-status="${session.id}">
          ${Object.entries(STATUS_LABELS).map(([value, label]) => `<option value="${value}"${item.status === value ? ' selected' : ''}>${label}</option>`).join('')}
        </select>
      </div>
      <p class="session-summary">${session.activity}</p>
      <p class="session-deliverable"><span class="deliverable-label">Livrable attendu</span>${session.deliverable}</p>
      ${history}${caution}
      <details><summary>Ouvrir la séance et ajouter une note</summary>
        <p class="session-activity"><strong>Travail en salle / à faire :</strong> ${session.activity}</p>
        <label class="session-note-label" for="note-${session.id}">Note de suivi
          <textarea class="session-note" id="note-${session.id}" data-session-note="${session.id}" maxlength="2000" placeholder="Décisions, éléments à vérifier, prochaine action…">${escapeHTML(item.note)}</textarea>
        </label>
      </details>
    </article>`;
  }).join('');
}

function updateProgress() {
  const values = Object.values(state.sessions);
  const completed = values.filter(item => item.status === 'done').length;
  const doing = values.filter(item => item.status === 'doing').length;
  document.querySelector('#completedCount').textContent = `${completed} / ${sessions.length}`;
  document.querySelector('#progressCaption').textContent = completed === 1 ? 'séance terminée' : 'séances terminées';
  document.querySelector('#inProgressCount').textContent = `${doing} séance${doing === 1 ? '' : 's'} en cours`;
  document.querySelector('#progressFill').style.width = `${completed / sessions.length * 100}%`;
}

const groupName = document.querySelector('#groupName');
const neighborhoodName = document.querySelector('#neighborhoodName');
groupName.value = state.group;
neighborhoodName.value = state.neighborhood;
groupName.addEventListener('input', () => { state.group = groupName.value.slice(0, 80); persist(); });
neighborhoodName.addEventListener('input', () => { state.neighborhood = neighborhoodName.value.slice(0, 120); persist(); });
filter.addEventListener('change', renderSessions);
sessionList.addEventListener('change', event => {
  const id = event.target.dataset.sessionStatus;
  if (!id || !state.sessions[id]) return;
  state.sessions[id].status = Object.hasOwn(STATUS_LABELS, event.target.value) ? event.target.value : 'todo';
  event.target.closest('.session-card').dataset.status = state.sessions[id].status;
  persist();
  updateProgress();
  if (filter.value !== 'all' && filter.value !== state.sessions[id].status) renderSessions();
});
sessionList.addEventListener('input', event => {
  const id = event.target.dataset.sessionNote;
  if (!id || !state.sessions[id]) return;
  state.sessions[id].note = event.target.value.slice(0, 2000);
  persist();
});

document.querySelector('#exportProgress').addEventListener('click', () => {
  const exportData = {
    type: 'urbatrame-workshop-progress',
    version: 1,
    exportedAt: new Date().toISOString(),
    group: state.group,
    neighborhood: state.neighborhood,
    sessions: state.sessions
  };
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'urbatrame-suivi-atelier-analyse.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  saveStatus.textContent = 'Copie du suivi exportée';
});

renderSessions();
updateProgress();
