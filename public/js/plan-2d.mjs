/* Freemap · planificateur de requêtes
   ─────────────────────────────────────────────────────────────────────────
   Ce module est importé À LA FOIS par le navigateur (public/index.html) et
   par le serveur (server/api.mjs). C'est la propriété de sûreté décrite dans le
   rapport : le serveur n'accepte jamais une requête Overpass arbitraire, il
   n'exécute que les requêtes qu'il a lui-même planifiées à partir d'un
   identifiant d'analyse, d'un rayon et d'un point.

   Aucune dépendance DOM : utilisable en Node comme en ESM navigateur.
   ───────────────────────────────────────────────────────────────────────── */

export const FREE_IDS = ['roads', 'landuse', 'gw', 'fabric'];

export const MAX_IDS = [
  'mappingboard', 'urbanstations', 'urbangrid', 'axocallout',
  'insetboard', 'viewcones', 'zoningplan', 'radialnet'
];

/* Couches primitives : tout ce qui peut être demandé à OpenStreetMap. */
export const LAYER_NAMES = {
  roads:      ['voirie', 'roads'],
  buildings:  ['emprises bâties', 'building footprints'],
  landuse:    ['zones d\'usage', 'land use'],
  green:      ['vert & eau', 'green space and water'],
  poi:        ['points d\'intérêt', 'points of interest'],
  transit:    ['arrêts de transport', 'transit stops'],
  sound:      ['sources sonores', 'sound sources'],
  destinations:['destinations piétonnes', 'walking destinations'],
  rail:       ['voies ferrées', 'railway lines'],
  coast:      ['trait de côte', 'coastline'],
  industrial: ['zones industrielles', 'industrial areas'],
  climate:    ['données climatiques', 'climate records'],
  terrain:    ['altimétrie', 'terrain elevation']
};

/* Graphe de dépendances : chaque analyse déclare les couches dont elle a
   besoin. Union des dépendances ⇒ jamais de couche téléchargée inutilement. */
export const DEPS = {
  /* ── Analyses livrées ── */
  roads: ['roads'],
  landuse: ['buildings', 'green', 'landuse'],
  gw: ['green'],
  fabric: ['roads', 'buildings'],
  density: ['roads', 'buildings'],
  massing: ['roads', 'buildings', 'green'],
  poiheat: ['roads', 'poi'],
  poitype: ['roads', 'poi'],
  combined: ['roads', 'buildings', 'green', 'poi'],
  orient: ['buildings', 'roads'],
  noise: ['roads'],
  vitality: ['roads', 'poi'],
  transit: ['roads', 'transit'],
  access: ['roads'],
  pedestrian: ['roads'],
  typology: ['buildings'],
  isogrid: ['buildings'],
  nodes: ['roads', 'poi'],
  soundmap: ['roads', 'poi', 'green', 'sound'],
  walkroutes: ['roads', 'green', 'destinations'],
  voronoi: ['roads', 'poi'],
  sitemap: ['roads', 'buildings', 'green', 'poi'],
  context: ['roads', 'buildings'],
  connectionfield: ['roads'],
  orientrose: ['roads'],
  sun: ['roads', 'buildings', 'green', 'climate'],
  location: [],
  climtemp: ['climate'],
  climprecip: ['climate'],
  climover: ['climate'],
  climday: ['climate'],
  climsolar: ['climate'],
  contour: ['buildings', 'terrain'],
  aspect: ['buildings', 'terrain'],
  wireframe: ['buildings', 'terrain'],

  /* ── Sur la feuille de route (v0.2) ──
     Déclarées pour que le quota, les limites et l'interface soient déjà
     exacts ; le rendu n'est pas encore branché. */
  wind: ['roads', 'buildings', 'green', 'climate'],
  mappingboard: ['roads', 'buildings', 'green'],
  urbanstations: ['roads', 'buildings', 'poi', 'transit'],
  urbangrid: ['roads', 'buildings', 'poi', 'transit'],
  axocallout: ['roads', 'buildings', 'green', 'poi', 'transit', 'rail', 'coast'],
  insetboard: ['roads', 'buildings', 'landuse', 'green', 'transit', 'rail', 'poi', 'coast'],
  viewcones: ['roads', 'buildings', 'landuse', 'green', 'rail', 'coast'],
  zoningplan: ['roads', 'buildings', 'landuse', 'green', 'poi', 'transit', 'rail', 'coast'],
  radialnet: ['roads', 'buildings', 'green', 'terrain', 'destinations', 'transit', 'coast']
};

/* Plafonds de rayon par analyse : au-delà, l'analyse est retirée et
   remplacée par une carte explicative (jamais d'échec silencieux). */
export const LIMITS = Object.fromEntries(Object.keys(DEPS).map(id => [id,
  ['nodes', 'vitality', 'poiheat', 'poitype', 'voronoi', 'sitemap', 'urbanstations',
   'urbangrid', 'soundmap', 'walkroutes', 'axocallout', 'zoningplan', 'radialnet']
    .includes(id) ? 1500 :
  ['landuse', 'transit', 'typology', 'isogrid', 'wind', 'massing', 'contour', 'aspect',
   'wireframe', 'insetboard', 'viewcones', 'climtemp', 'climprecip', 'climover',
   'climday', 'climsolar'].includes(id) ? 2000 : 3000]));

const SELECTORS = {
  roads: ['way["highway"~"motorway|trunk|primary|secondary|tertiary|residential|living_street|unclassified|pedestrian|footway|cycleway|path|service|steps"]'],
  buildings: ['way["building"]', 'relation["building"]'],
  landuse: [
    'way["landuse"]',
    'way["leisure"~"park|garden|pitch|playground"]',
    'way["amenity"~"school|university|college|hospital|clinic|library|theatre|cinema|place_of_worship|marketplace"]'
  ],
  green: [
    'way["natural"~"wood|water|scrub|wetland"]',
    'way["waterway"]',
    'way["leisure"~"park|garden|nature_reserve"]',
    'way["landuse"~"forest|grass|meadow|recreation_ground|basin|reservoir"]',
    'relation["natural"="water"]'
  ],
  transit: [
    'node["highway"="bus_stop"]',
    'node["railway"~"station|tram_stop|subway_entrance|halt"]',
    'node["public_transport"~"stop_position|station"]'
  ],
  poi: ['node["amenity"]', 'node["shop"]', 'node["leisure"]', 'node["tourism"]'],
  sound: [
    'node["amenity"~"bar|pub|nightclub|restaurant|cafe|fast_food|marketplace|school|university|kindergarten|college|cinema|theatre|arts_centre|community_centre|fuel"]',
    'node["leisure"~"playground|pitch|sports_centre|stadium|fitness_centre"]',
    'node["shop"="car_repair"]'
  ],
  destinations: [
    'node["amenity"~"school|university|college|library|hospital|clinic|doctors|pharmacy|marketplace|theatre|cinema|museum|townhall"]',
    'node["shop"~"supermarket|mall"]'
  ],
  industrial: ['way["landuse"~"industrial|construction|railway"]', 'way["man_made"~"works|wastewater_plant"]'],
  rail: ['way["railway"~"^(rail|subway|light_rail|tram|monorail|narrow_gauge)$"]'],
  coast: ['way["natural"="coastline"]']
};

/* Sélecteurs POI resserrés : seules les analyses de densité ont besoin de
   l'ensemble complet ; une carte de services ne doit pas télécharger les bureaux. */
const POI_SELECTORS = {
  nodes: ['node["amenity"]', 'node["shop"]', 'node["leisure"="park"]',
          'node["railway"~"station|tram_stop"]', 'node["highway"="bus_stop"]'],
  vitality: [
    'node["amenity"~"restaurant|cafe|bar|fast_food|pub|food_court|ice_cream|school|university|library|theatre|cinema|museum|place_of_worship|arts_centre|bus_stop|station|subway_entrance"]',
    'node["shop"]',
    'node["leisure"~"sports_centre|fitness_centre|park|garden|playground"]',
    'node["public_transport"]', 'node["railway"]'
  ],
  poiheat: SELECTORS.poi,
  poitype: [
    'node["amenity"~"restaurant|cafe|bar|fast_food|pub|school|university|college|library|kindergarten|hospital|clinic|doctors|pharmacy|theatre|cinema|arts_centre"]',
    'node["shop"]', 'node["leisure"]', 'node["tourism"]'
  ],
  voronoi: ['node["amenity"]', 'node["shop"]', ...SELECTORS.transit],
  sitemap: [
    'node["amenity"~"school|university|college|kindergarten|hospital|clinic|pharmacy|doctors|marketplace"]',
    'node["shop"~"supermarket|convenience|mall"]',
    'node["leisure"~"park|garden"]',
    'node["railway"~"station|subway_entrance"]',
    'node["public_transport"="station"]'
  ],
  soundmap: [...SELECTORS.sound],
  walkroutes: [...SELECTORS.destinations]
};

/* ─────────────────────────── le plan ─────────────────────────── */
export function plan(ids, radius, lat, lon) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 50) throw new Error('INVALID_ANALYSES');
  if (ids.some(id => !Object.hasOwn(DEPS, id))) throw new Error('INVALID_ANALYSES');
  if (!Number.isFinite(radius) || radius < 200 || radius > 3000) throw new Error('RADIUS_200_3000');
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180)
    throw new Error('INVALID_LOCATION');

  const unique = [...new Set(ids)];
  const skipped = unique.filter(id => radius > LIMITS[id]);
  const selected = unique.filter(id => radius <= LIMITS[id]);

  const deps = new Set(selected.flatMap(id => DEPS[id]));

  /* Bbox équirectangulaire : degrés de latitude, puis correction de longitude. */
  const dy = radius / 111320;
  const dx = dy / Math.cos(lat * Math.PI / 180);
  if (lon - dx < -180 || lon + dx > 180) throw new Error('SITE_CROSSES_DATELINE');
  const bbox = [lat - dy, lon - dx, lat + dy, lon + dx].map(n => n.toFixed(7)).join(',');

  const groups = [];
  function group(id, keys) {
    keys = keys.filter(k => deps.has(k));
    if (!keys.length) return;
    /* Une analyse peut dépendre de `poi` sans avoir de sélecteurs propres
       (c'est le cas de `combined`) : on retombe alors sur le jeu POI complet,
       sinon le groupe partirait avec une requête vide — et Overpass répondrait
       « 0 élément » sans que rien ne le signale. */
    let selectors = keys.flatMap(k => {
      if (k !== 'poi') return SELECTORS[k] || [];
      const perAnalysis = selected.flatMap(a => POI_SELECTORS[a] || []);
      return perAnalysis.length ? perAnalysis : SELECTORS.poi;
    });
    if (keys.includes('sound'))
      selectors.push('node["railway"~"station|tram_stop"]', 'node["public_transport"="station"]', 'node["highway"="bus_stop"]');
    if (keys.includes('destinations'))
      selectors.push('node["railway"~"station|subway_entrance"]', 'node["public_transport"="station"]');
    selectors = [...new Set(selectors)];
    if (!selectors.length) return;
    /* Un sélecteur large rend inutiles les sélecteurs plus étroits du même tag. */
    selectors = selectors.filter(s => {
      const m = s.match(/^node\["([^"]+)"[=~]/);
      return !m || !selectors.includes('node["' + m[1] + '"]');
    });
    groups.push({
      id, keys,
      en: 'Fetching ' + keys.map(k => LAYER_NAMES[k][1]).join(' + '),
      fr: 'Lecture : ' + keys.map(k => LAYER_NAMES[k][0]).join(', '),
      query: '[out:json][timeout:25][maxsize:67108864];(' +
             selectors.map(s => s + '(' + bbox + ');').join('') + ');out geom;'
    });
  }

  group('base', ['roads', 'buildings']);
  group('areas', ['landuse', 'green', 'industrial', 'rail', 'coast']);
  group('points', ['poi', 'transit', 'sound', 'destinations']);

  /* Fusion base+areas : une seule requête quand il n'en reste que deux. */
  if (radius <= 1500 && groups.length === 2 && groups.every(g => g.id !== 'points')) {
    const [a, b] = groups;
    groups.splice(0, 2, {
      id: 'base', keys: [...a.keys, ...b.keys],
      en: a.en + ' + ' + b.en.replace('Fetching ', ''),
      fr: a.fr + ' ; ' + b.fr.replace('Lecture : ', ''),
      query: a.query.replace(');out geom;', b.query.split(';(')[1])
    });
  }

  return {
    selected, skipped, groups, bbox,
    climate: deps.has('climate'),
    terrain: deps.has('terrain')
  };
}

export const VERSION = '0.1.0';
