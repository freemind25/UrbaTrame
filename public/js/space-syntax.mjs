/* UrbaTrame · space syntax simplifié (phase D, volet 18)
   ─────────────────────────────────────────────────────────
   Intégration calculée sur le graphe des rues OSM : profondeur topologique
   (nombre de sauts) depuis chaque nœud, asymétrie relative RA = 2(MD−1)/(k−2),
   score d’intégration = 1/RA. C’est une APPROXIMATION PÉDAGOGIQUE documentée
   comme telle : pas de lignes axiales, pas de table de benchmark D(n), pas de
   pondération par la longueur — ce n’est pas un calcul space syntax certifié. */

const D2R = Math.PI / 180;

export const SPACE_SYNTAX_LABEL =
  'Space syntax simplifié (approximation pédagogique : graphe des rues OSM, profondeurs topologiques, sans lignes axiales)';

/* Types de voies exclus du graphe de mobilité (piétons / chantier /ÉRÉ) : ils
   ne structurent pas le réseau viaire. « service » est conservé (ruelles). */
export const SPACE_SYNTAX_EXCLUSIONS = Object.freeze(new Set([
  'footway', 'cycleway', 'path', 'steps', 'pedestrian', 'corridor',
  'construction', 'proposed', 'raceway', 'elevator', 'bus_stop', 'platform'
]));

export const SPACE_SYNTAX_LIMITS = Object.freeze({
  maxGraphNodes: 4000,   // construction du graphe
  maxNodes: 1500         // calcul d’intégration (BFS depuis chaque nœud)
});

export function distanceMeters(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return Infinity;
  const la1 = Number(a[1]) * D2R, la2 = Number(b[1]) * D2R;
  const dLa = la2 - la1, dLo = (Number(b[0]) - Number(a[0])) * D2R;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLo / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const coordValide = p => Array.isArray(p) && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1]));

/* Graphe des rues : nœuds = extrémités / intersections (coord. arrondies à 1e-6°),
   arêtes = tronçons entre nœuds consécutifs, avec longueur et nom OSM. */
export function buildStreetGraph(features = [], { maxNodes = SPACE_SYNTAX_LIMITS.maxGraphNodes } = {}) {
  const nodeIndex = new Map();
  const nodes = [];
  const edges = [];
  let tronconsIgnores = 0, typesExcl = 0;
  const node = p => {
    const key = `${Number(p[0]).toFixed(6)},${Number(p[1]).toFixed(6)}`;
    if (!nodeIndex.has(key)) {
      if (nodes.length >= maxNodes) return -1;
      nodeIndex.set(key, nodes.length);
      nodes.push([Number(p[0]), Number(p[1])]);
    }
    return nodeIndex.get(key);
  };
  for (const f of features || []) {
    const tags = f?.properties || {};
    const highway = String(tags.highway || '');
    if (!highway) continue;
    if (SPACE_SYNTAX_EXCLUSIONS.has(highway)) { typesExcl++; continue; }
    const lignes = f.geometry?.type === 'LineString' ? [f.geometry.coordinates]
      : f.geometry?.type === 'MultiLineString' ? (f.geometry.coordinates || [])
      : [];
    for (const coords of lignes) {
      if (!Array.isArray(coords) || coords.length < 2) continue;
      for (let i = 1; i < coords.length; i++) {
        const a = coords[i - 1], b = coords[i];
        if (!coordValide(a) || !coordValide(b)) { tronconsIgnores++; continue; }
        const u = node(a), v = node(b);
        if (u < 0 || v < 0) return { nodes, edges, truncated: true, maxNodes };
        const len = distanceMeters(a, b);
        if (u === v || !(len > 0)) { tronconsIgnores++; continue; }
        edges.push({ u, v, len, name: String(tags.name || ''), highway });
      }
    }
  }
  return { nodes, edges, truncated: false, tronconsIgnores, typesExcl, maxNodes };
}

/* Intégration simplifiée : BFS en nombre de sauts depuis chaque nœud.
   RA = 2(MD−1)/(k−2) avec k = nœuds atteignables (soi compris) ;
   score = 1/RA (RA nul → score = k, nœud complètement connecté localement). */
export function integrationSimplifiee(graph, { maxNodes = SPACE_SYNTAX_LIMITS.maxNodes } = {}) {
  const nodes = graph?.nodes || [], edges = graph?.edges || [];
  if (!nodes.length) return { ok: false, reason: 'no-nodes' };
  if (!edges.length) return { ok: false, reason: 'no-edges', nodes: nodes.length };
  if (nodes.length > maxNodes) return { ok: false, reason: 'graph-too-large', nodes: nodes.length, maxNodes };
  const n = nodes.length;
  const adj = Array.from({ length: n }, () => []);
  for (const e of edges) {
    adj[e.u].push(e.v);
    adj[e.v].push(e.u);
  }
  const ra = new Array(n).fill(null);
  const md = new Array(n).fill(null);
  const score = new Array(n).fill(0);
  let sumRA = 0, sumScore = 0, compte = 0, bestNode = -1, bestRA = Infinity;
  for (let s = 0; s < n; s++) {
    const profondeur = new Array(n).fill(-1);
    profondeur[s] = 0;
    const file = [s];
    let somme = 0, k = 1;
    for (let tete = 0; tete < file.length; tete++) {
      const u = file[tete];
      for (const v of adj[u]) {
        if (profondeur[v] >= 0) continue;
        profondeur[v] = profondeur[u] + 1;
        somme += profondeur[v];
        k++;
        file.push(v);
      }
    }
    const profondeurMoyenne = k > 1 ? somme / (k - 1) : 0;
    md[s] = profondeurMoyenne;
    const raNode = k > 2 ? (2 * (profondeurMoyenne - 1)) / (k - 2) : 0;
    ra[s] = raNode;
    score[s] = raNode > 0 ? 1 / raNode : k;
    sumRA += raNode; sumScore += score[s]; compte++;
    if (raNode < bestRA) { bestRA = raNode; bestNode = s; }
  }
  const aretes = edges.map(e => ({
    u: e.u, v: e.v, len: e.len, name: e.name, highway: e.highway,
    score: (score[e.u] + score[e.v]) / 2
  }));
  aretes.sort((a, b) => b.score - a.score);
  const topEdges = aretes.slice(0, 5).map(e => ({
    name: e.name, highway: e.highway, lenM: Math.round(e.len * 10) / 10,
    score: Math.round(e.score * 1000) / 1000,
    coords: [nodes[e.u], nodes[e.v]]
  }));
  return {
    ok: true, nodes: n, edges: edges.length,
    meanRA: Math.round((sumRA / compte) * 1000) / 1000,
    meanIntegration: Math.round((sumScore / compte) * 1000) / 1000,
    bestNode, bestRA: Math.round(bestRA * 1000) / 1000,
    topEdges, label: SPACE_SYNTAX_LABEL
  };
}

/* Point d’entrée haut niveau : features OSM + centre → rapport affichable. */
export function spaceSyntaxRapport({ features = [], center = null, maxNodes } = {}) {
  const graph = buildStreetGraph(features, { maxNodes: maxNodes ?? SPACE_SYNTAX_LIMITS.maxGraphNodes });
  if (graph.truncated) return { ok: false, reason: 'graph-too-large', nodes: graph.nodes.length, label: SPACE_SYNTAX_LABEL };
  const res = integrationSimplifiee(graph, { maxNodes: maxNodes ?? SPACE_SYNTAX_LIMITS.maxNodes });
  if (!res.ok) return { ...res, label: SPACE_SYNTAX_LABEL };
  const totalLengthM = graph.edges.reduce((somme, e) => somme + e.len, 0);
  return {
    ...res,
    center: center ? { lat: Number(center.lat), lon: Number(center.lon) } : null,
    totalLengthM: Math.round(totalLengthM),
    label: SPACE_SYNTAX_LABEL
  };
}
