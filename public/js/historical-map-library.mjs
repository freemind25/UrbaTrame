export const HISTORICAL_MAP_RESOURCES = Object.freeze([
  Object.freeze({
    id: 'senatus-algeria',
    title: 'Cartes et plans historiques — SENATUS',
    description: 'Catalogue de 29 cartes et plans anciens consacrés à l’Algérie, avec des documents sur Alger, Oran, Constantine, Guelma, Sétif et d’autres territoires.',
    source: 'SENATUS · Algérie',
    url: 'https://www.senatus-dz.com/recherche/carte/carte.html',
    regions: ['algeria', 'constantine'],
    period: 'Dates variables selon les documents',
    scale: 'Échelles variables',
    formats: ['JPG', 'PNG'],
    formatGroup: 'catalogue',
    kind: 'Catalogue historique',
    actionLabel: 'Parcourir les cartes',
    keywords: ['plans', 'Constantine 1854', 'Constantine 1860', 'Constantine 1865', 'Constantine 1881', 'Guelma', 'Sétif'],
    note: 'Le site présente notamment des cartes issues de Gallica et des Archives nationales d’outre-mer.'
  }),
  Object.freeze({
    id: 'ams-algeria-50k',
    title: 'Algérie topographique — série AMS 1:50 000',
    description: 'Collection de feuilles topographiques de l’U.S. Army Map Service, série P741, avec index et images de feuilles individuelles.',
    source: 'Perry-Castañeda Map Collection · UT Austin',
    url: 'https://maps.lib.utexas.edu/maps/ams/algeria/',
    regions: ['algeria', 'constantine'],
    period: 'Série publiée à partir de 1941',
    scale: '1:50 000',
    formats: ['JPG'],
    formatGroup: 'images',
    kind: 'Cartes topographiques',
    actionLabel: 'Ouvrir l’index des feuilles',
    keywords: ['armée américaine', 'U.S. Army Map Service', 'AMS', 'Constantine', 'Constantine sheet 73'],
    note: 'La collection comprend une feuille nommée Constantine. Le site de la bibliothèque est une collection historique archivée.'
  }),
  Object.freeze({
    id: 'ams-algeria-200k',
    title: 'Algérie topographique — série AMS 1:200 000',
    description: 'Collection de feuilles de l’U.S. Army Map Service, série P541 (GSGS 4180), avec index et accès aux cartes par zone.',
    source: 'Perry-Castañeda Map Collection · UT Austin',
    url: 'https://maps.lib.utexas.edu/maps/ams/algeria_200k/',
    regions: ['algeria', 'constantine'],
    period: 'Série de 1941',
    scale: '1:200 000',
    formats: ['JPG'],
    formatGroup: 'images',
    kind: 'Cartes topographiques',
    actionLabel: 'Ouvrir l’index des feuilles',
    keywords: ['armée américaine', 'U.S. Army Map Service', 'AMS', 'Constantine', 'Constantine sheet 17'],
    note: 'La collection comprend une feuille nommée Constantine. Les feuilles sont proposées depuis le catalogue universitaire.'
  }),
  Object.freeze({
    id: 'ams-world-index',
    title: 'Séries topographiques mondiales de l’Army Map Service',
    description: 'Index général des cartes topographiques produites par l’U.S. Army Map Service, classées par pays et par région : Afrique, Amériques, Asie, Europe, Moyen-Orient et monde entier, avec les séries de l’Algérie (P741 1:50 000, P541 1:200 000, plans de villes).',
    source: 'Perry-Castañeda Map Collection · UT Austin',
    url: 'https://maps.lib.utexas.edu/maps/ams/',
    regions: ['algeria', 'world'],
    period: 'Séries de 1937 à 1968 selon les régions',
    scale: 'De 1:25 000 à 1:2 000 000 selon les séries',
    formats: ['JPG', 'KMZ (index Google Earth)'],
    formatGroup: 'images',
    kind: 'Cartes topographiques',
    actionLabel: 'Ouvrir l’index mondial AMS',
    keywords: ['armée américaine', 'U.S. Army Map Service', 'AMS', 'Algérie', 'séries topographiques mondiales', 'index KMZ'],
    note: 'Le site de la bibliothèque est archivé depuis 2021 ; les portails Texas GeoData et Collections de l’UT Austin sont indiqués comme relais pour les fichiers cartographiques.'
  }),
  Object.freeze({
    id: 'anom-cartotheque',
    title: 'La cartothèque des Archives nationales d’outre-mer',
    description: 'Point d’accès aux cartes, plans, atlas et croquis conservés par les ANOM, pour l’Algérie et d’autres territoires.',
    source: 'Archives nationales d’outre-mer · France',
    url: 'https://archives-nationales-outre-mer.culture.gouv.fr/faire-une-recherche/la-cartotheque',
    regions: ['algeria', 'world'],
    period: 'Collections de plusieurs périodes',
    scale: 'Échelles variables',
    formats: ['Catalogue'],
    formatGroup: 'catalogue',
    kind: 'Archives publiques',
    actionLabel: 'Consulter la cartothèque',
    keywords: ['ANOM', 'Aix-en-Provence', 'cartes', 'plans', 'atlas'],
    note: 'Les notices d’archives permettent de retrouver les références et les conditions associées aux documents.'
  }),
  Object.freeze({
    id: 'gallica-maps',
    title: 'Gallica — Bibliothèque nationale de France',
    description: 'Bibliothèque numérique pour rechercher des cartes, plans et documents anciens liés à l’Algérie, à la France et au monde.',
    source: 'Bibliothèque nationale de France · BnF',
    url: 'https://gallica.bnf.fr/',
    regions: ['algeria', 'world'],
    period: 'Collections de plusieurs périodes',
    scale: 'Échelles variables',
    formats: ['Images', 'Documents numériques'],
    formatGroup: 'catalogue',
    kind: 'Bibliothèque numérique',
    actionLabel: 'Rechercher dans Gallica',
    keywords: ['cartes', 'plans', 'BnF', 'Gallica', 'Algérie'],
    note: 'Les conditions de réutilisation et les crédits sont précisés par Gallica et, pour certains documents, par les institutions partenaires.'
  }),
  Object.freeze({
    id: 'loc-algeria-maps',
    title: 'Cartes historiques de l’Algérie — Library of Congress',
    description: 'Recherche de cartes de l’Algérie dans le catalogue cartographique de la bibliothèque du Congrès des États-Unis.',
    source: 'Library of Congress · États-Unis',
    url: 'https://www.loc.gov/maps/?all=true&fa=subject:military+maps%7Clocation:algeria',
    regions: ['algeria'],
    period: 'Dates variables selon les notices',
    scale: 'Échelles variables',
    formats: ['Catalogue'],
    formatGroup: 'catalogue',
    kind: 'Catalogue de cartes',
    actionLabel: 'Afficher les notices',
    keywords: ['cartes militaires', 'Army Map Service', 'Alger', 'Algérie'],
    note: 'La recherche mène aux notices et aux documents numériques disponibles dans la collection.'
  }),
  Object.freeze({
    id: 'usgs-topo-access-points',
    title: 'Points d’accès aux cartes topographiques — USGS',
    description: 'Portail de l’USGS pour rechercher, consulter et télécharger les cartes topographiques historiques et actuelles des États-Unis : topoView pour les cartes historiques, le National Map Downloader, topoBuilder pour des cartes à la demande et la boutique USGS.',
    source: 'U.S. Geological Survey · The National Map',
    url: 'https://www.usgs.gov/the-national-map-data-delivery/topographic-map-access-points',
    regions: ['us'],
    period: 'Cartes historiques et actuelles',
    scale: 'Échelles variables selon les produits',
    formats: ['GeoTIFF', 'PDF géoréférencé', 'JPEG', 'KMZ'],
    formatGroup: 'images',
    kind: 'Cartes topographiques',
    actionLabel: 'Ouvrir les points d’accès USGS',
    keywords: ['USGS', 'topoView', 'cartes historiques', 'États-Unis', 'The National Map', 'topoBuilder', 'National Map Downloader'],
    note: 'topoView permet de télécharger des cartes topographiques historiques en plusieurs formats (PDF géoréférencé, GeoTIFF, JPEG, KMZ). La couverture concerne les États-Unis.'
  }),
  Object.freeze({
    id: 'mediafire-topographic-archive',
    title: 'Topographic.rar — cartes d’Algérie et du monde',
    description: 'Archive proposée par le lien partagé pour récupérer un ensemble de cartes topographiques d’Algérie et du monde.',
    source: 'MediaFire · archive RAR',
    url: 'https://www.mediafire.com/file/pltquqx6rs2n0ik/Topographic.rar/file',
    regions: ['algeria', 'world'],
    period: 'Cartes de plusieurs périodes',
    scale: 'Échelles variables',
    formats: ['RAR', 'Google Earth (annoncé)'],
    formatGroup: 'archive',
    kind: 'Archive téléchargeable',
    actionLabel: 'Ouvrir le téléchargement',
    keywords: ['Département de la Défense des États-Unis', 'US DOD', 'Google Earth', 'topographie', 'monde'],
    note: 'La description associée au lien annonce une provenance des archives du Département de la Défense des États-Unis et une compatibilité avec Google Earth.'
  })
]);

export function normalizeHistoricalMapText(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr-FR').trim();
}

export function filterHistoricalMapResources(resources = HISTORICAL_MAP_RESOURCES, filters = {}) {
  const query = normalizeHistoricalMapText(filters.query);
  const region = filters.region || 'all';
  const format = filters.format || 'all';
  return resources.filter(resource => {
    if (region !== 'all' && !resource.regions.includes(region)) return false;
    if (format !== 'all' && resource.formatGroup !== format) return false;
    if (!query) return true;
    const searchable = [
      resource.title, resource.description, resource.source, resource.period,
      resource.scale, resource.kind, ...(resource.formats || []), ...(resource.keywords || [])
    ].join(' ');
    return normalizeHistoricalMapText(searchable).includes(query);
  });
}

function makeMeta(label, value) {
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = value;
  return [dt, dd];
}

function makeCard(resource) {
  const article = document.createElement('article');
  article.className = 'resource-card';
  article.dataset.resourceId = resource.id;

  const header = document.createElement('div');
  header.className = 'resource-card-head';
  const kind = document.createElement('span');
  kind.className = 'resource-kind';
  kind.textContent = resource.kind;
  const source = document.createElement('span');
  source.className = 'resource-source';
  source.textContent = resource.source;
  header.append(kind, source);

  const title = document.createElement('h3');
  title.textContent = resource.title;
  const description = document.createElement('p');
  description.className = 'resource-description';
  description.textContent = resource.description;

  const regionLabels = { algeria: 'Algérie', constantine: 'Constantine', world: 'Monde', us: 'États-Unis' };
  const tags = document.createElement('div');
  tags.className = 'resource-tags';
  for (const region of resource.regions) {
    const tag = document.createElement('span');
    tag.className = 'resource-tag';
    tag.textContent = regionLabels[region] || region;
    tags.append(tag);
  }
  for (const format of resource.formats) {
    const tag = document.createElement('span');
    tag.className = 'resource-tag';
    tag.textContent = format;
    tags.append(tag);
  }

  const meta = document.createElement('dl');
  meta.className = 'resource-meta';
  for (const node of makeMeta('Période', resource.period)) meta.append(node);
  for (const node of makeMeta('Échelle', resource.scale)) meta.append(node);
  for (const node of makeMeta('Source', resource.source)) meta.append(node);

  const note = document.createElement('p');
  note.className = 'resource-note';
  note.textContent = resource.note;

  const link = document.createElement('a');
  link.className = 'resource-action';
  link.href = resource.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = resource.actionLabel;
  link.setAttribute('aria-label', `${resource.actionLabel} : ${resource.title} (nouvel onglet)`);

  article.append(header, title, description, tags, meta, note, link);
  return article;
}

function initHistoricalMapLibrary() {
  const grid = document.getElementById('resourceGrid');
  const search = document.getElementById('resourceSearch');
  const regionFilter = document.getElementById('regionFilter');
  const formatFilter = document.getElementById('formatFilter');
  const count = document.getElementById('resourceCount');
  const empty = document.getElementById('emptyResults');
  if (!grid || !search || !regionFilter || !formatFilter || !count || !empty) return;

  const render = () => {
    const matches = filterHistoricalMapResources(HISTORICAL_MAP_RESOURCES, {
      query: search.value, region: regionFilter.value, format: formatFilter.value
    });
    grid.replaceChildren(...matches.map(makeCard));
    count.textContent = `${matches.length} ressource${matches.length === 1 ? '' : 's'}`;
    empty.hidden = matches.length > 0;
  };

  search.addEventListener('input', render);
  regionFilter.addEventListener('change', render);
  formatFilter.addEventListener('change', render);
  render();
}

if (typeof document !== 'undefined') initHistoricalMapLibrary();
