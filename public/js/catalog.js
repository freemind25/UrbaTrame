/* Freemap · catalogue des analyses
   Les 45 entrées reprises du plan fonctionnel décrit dans le rapport.
   `impl:false` ⇒ sur la feuille de route v0.2 (affichée mais non rendue).
   tier : 'free' (essai, filigrané) · 'pro' · 'max'. */
(function (G) {
  const A = [
    /* ── essai gratuit ── */
    { id: 'roads', nom: 'Voirie & rues', en: 'Roads & streets', sub: 'hiérarchie, largeurs, cheminements', tag: 'OSM', tier: 'free', g: 'site', impl: true },
    { id: 'landuse', nom: 'Zones fonctionnelles', en: 'Functional areas', sub: 'résidentiel, commerce, équipements', tag: 'OSM', tier: 'free', g: 'site', impl: true },
    { id: 'gw', nom: 'Vert & eau', en: 'Green & water', sub: 'parcs, forêts, cours d\'eau', tag: 'OSM', tier: 'free', g: 'site', impl: true },
    { id: 'fabric', nom: 'Tissu urbain', en: 'Urban fabric', sub: 'figure-fond type Nolli', tag: 'OSM', tier: 'free', g: 'site', impl: true },
    { id: 'volumes', nom: 'Volumes 3D', en: '3D volumes', sub: 'bâtiments extrudés, ombres portées', tag: '3D', tier: 'pro', g: 'morpho', impl: true },

    /* ── morphologie ── */
    { id: 'density', nom: 'Densité bâtie', en: 'Building density', sub: 'emprise au sol et volume', tag: 'GÉO', tier: 'pro', g: 'morpho', impl: true },
    { id: 'massing', nom: 'Volumétrie axonométrique', en: 'Massing axonometric', sub: 'hauteurs réelles OSM', tag: '3D', tier: 'pro', g: 'morpho', impl: true },
    { id: 'typology', nom: 'Typologie bâtie', en: 'Building typology', sub: 'pavillonnaire, collectif, équipement', tag: 'GÉO', tier: 'pro', g: 'morpho', impl: true },
    { id: 'isogrid', nom: 'Trame isométrique', en: 'Isometric grid', sub: 'emprises en projection 30°', tag: '3D', tier: 'pro', g: 'morpho', impl: true },
    { id: 'orient', nom: 'Orientation', en: 'Orientation', sub: 'azimuts du bâti et de la voirie', tag: 'GEO', tier: 'pro', g: 'morpho', impl: true },
    { id: 'orientrose', nom: 'Rose des orientations', en: 'Orientation rose', sub: 'distribution directionnelle', tag: 'GEO', tier: 'pro', g: 'morpho', impl: true },

    /* ── usage & vie urbaine ── */
    { id: 'poiheat', nom: 'Chaleur des POI', en: 'POI density heat', sub: 'concentration des services', tag: 'OSM', tier: 'pro', g: 'usage', impl: true },
    { id: 'poitype', nom: 'Types de POI', en: 'POI type map', sub: 'catégories de destinations', tag: 'OSM', tier: 'pro', g: 'usage', impl: true },
    { id: 'vitality', nom: 'Vitalité des rues', en: 'Street vitality', sub: 'activité riveraine par tronçon', tag: 'OSM', tier: 'pro', g: 'usage', impl: true },
    { id: 'nodes', nom: 'Analyse nodale', en: 'Node analysis', sub: 'carrefours et polarités', tag: 'SIG', tier: 'pro', g: 'usage', impl: true },
    { id: 'sitemap', nom: 'Carte annotée', en: 'Annotated site map', sub: 'équipements et distances', tag: 'CARTE', tier: 'pro', g: 'usage', impl: true },
    { id: 'voronoi', nom: 'Territoires de service', en: 'Service territories', sub: 'voronoï des équipements', tag: 'SIG', tier: 'pro', g: 'usage', impl: true },
    { id: 'combined', nom: 'Superposition combinée', en: 'Combined overlay', sub: 'bâti + vert + voirie + POI', tag: 'SYNTHÈSE', tier: 'pro', g: 'usage', impl: true },

    /* ── mobilité ── */
    { id: 'transit', nom: 'Accès transport', en: 'Transit access', sub: 'arrêts et isochrones 5/10 min', tag: 'OSM', tier: 'pro', g: 'mob', impl: true },
    { id: 'pedestrian', nom: 'Réseau piéton', en: 'Pedestrian network', sub: 'cheminements et connectivité', tag: 'OSM', tier: 'pro', g: 'mob', impl: true },
    { id: 'access', nom: 'Accessibilité', en: 'Access analysis', sub: 'distance au réseau structurant', tag: 'SIG', tier: 'pro', g: 'mob', impl: true },
    { id: 'walkroutes', nom: 'Accessibilité piétonne', en: 'Walk accessibility', sub: 'isochrones depuis le site', tag: 'OSM', tier: 'pro', g: 'mob', impl: true },
    { id: 'connectionfield', nom: 'Champ de connexité', en: 'Street connection field', sub: 'proximité des carrefours', tag: 'SIG', tier: 'pro', g: 'mob', impl: true },
    { id: 'noise', nom: 'Bruit routier', en: 'Road noise', sub: 'zones d\'exposition par classe', tag: 'OSM', tier: 'pro', g: 'mob', impl: true },
    { id: 'soundmap', nom: 'Sources sonores', en: 'Sound sources', sub: 'activités émettrices', tag: 'OSM', tier: 'pro', g: 'mob', impl: true },

    /* ── environnement ── */
    { id: 'sun', nom: 'Course solaire & ombres', en: 'Sun path & shadows', sub: 'héliodon calculé sur place', tag: 'CALCUL', tier: 'pro', g: 'env', impl: true },
    { id: 'contour', nom: 'Topographie', en: 'Topography', sub: 'courbes de niveau SRTM', tag: 'MNT', tier: 'pro', g: 'env', impl: true },
    { id: 'aspect', nom: 'Pente & exposition', en: 'Slope & aspect', sub: 'orientations de versant', tag: 'MNT', tier: 'pro', g: 'env', impl: true },
    { id: 'wireframe', nom: 'Trame de terrain', en: 'Terrain wireframe', sub: 'relief en fil de fer', tag: 'MNT', tier: 'pro', g: 'env', impl: true },
    { id: 'context', nom: 'Contexte urbain', en: 'City context', sub: 'couronnes de distance', tag: 'CARTE', tier: 'pro', g: 'env', impl: true },
    { id: 'location', nom: 'Situation', en: 'Location', sub: 'coordonnées, hémisphère, méridien', tag: 'CARTE', tier: 'pro', g: 'env', impl: true },
    { id: 'wind', nom: 'Vent dominant', en: 'Wind flow', sub: 'rose des vents NASA POWER', tag: 'CLIM', tier: 'pro', g: 'env', impl: false },

    /* ── climat ── */
    { id: 'climtemp', nom: 'Températures', en: 'Temperature year', sub: 'max/min mensuelles', tag: 'CLIM', tier: 'pro', g: 'clim', impl: true },
    { id: 'climprecip', nom: 'Précipitations', en: 'Precipitation year', sub: 'cumul mensuel', tag: 'CLIM', tier: 'pro', g: 'clim', impl: true },
    { id: 'climover', nom: 'Climat annuel', en: 'Annual climate', sub: 'synthèse des deux', tag: 'CLIM', tier: 'pro', g: 'clim', impl: true },
    { id: 'climday', nom: 'Heures de jour', en: 'Daylight hours', sub: 'durée du jour par mois', tag: 'CLIM', tier: 'pro', g: 'clim', impl: true },
    { id: 'climsolar', nom: 'Rayonnement', en: 'Solar radiation', sub: 'irradiation journalière', tag: 'CLIM', tier: 'pro', g: 'clim', impl: true },

    /* ── planches (MAX) ── */
    { id: 'mappingboard', nom: 'Planche de contexte', en: 'Context mapping board', sub: 'composition A3 paysage', tag: 'PLANCHE', tier: 'max', g: 'board', impl: true },
    { id: 'urbanstations', nom: 'Données urbaines · Nœuds', en: 'Urban data · nodes', sub: 'pôles OSM, services et arrêts regroupés', tag: 'PLANCHE', tier: 'max', g: 'board', impl: true },
    { id: 'urbangrid', nom: 'Données urbaines · Trame', en: 'Urban data · grid', sub: 'densité quadrillée du bâti et des POI', tag: 'PLANCHE', tier: 'max', g: 'board', impl: true },
    { id: 'axocallout', nom: 'Volumétrie axonométrique annotée', en: 'Annotated axonometric massing', sub: 'bâtiments extrudés et repères OSM', tag: 'PLANCHE', tier: 'max', g: 'board', impl: true },
    { id: 'insetboard', nom: 'Planche d\'insertion', en: 'Site inset board', sub: 'vue générale et détail des mêmes données', tag: 'PLANCHE', tier: 'max', g: 'board', impl: true },
    { id: 'viewcones', nom: 'Cônes de vue indicatifs', en: 'Indicative view cones', sub: 'lignes de visée simplifiées, sans relief', tag: 'PLANCHE', tier: 'max', g: 'board', impl: true },
    { id: 'zoningplan', nom: 'Zonage fonctionnel OSM', en: 'Functional OSM zoning', sub: 'usages cartographiés · non réglementaire', tag: 'PLANCHE', tier: 'max', g: 'board', impl: true },
    { id: 'radialnet', nom: 'Centralité & accès radial', en: 'Radial centrality & access', sub: 'pôles par distance directe et direction', tag: 'PLANCHE', tier: 'max', g: 'board', impl: true }
  ];
  G.FMCatalog = A;
  G.FM_GROUPS = {
    site: ['Le site', 'Site'],
    morpho: ['Morphologie', 'Morphology'],
    usage: ['Usage & vie urbaine', 'Use & urban life'],
    mob: ['Mobilité & environnement sonore', 'Mobility & sound'],
    env: ['Environnement & relief', 'Environment & terrain'],
    clim: ['Climat', 'Climate'],
    board: ['Planches composées (Max)', 'Composed boards (Max)']
  };
})(globalThis);
