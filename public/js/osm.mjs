/* Freemap · normalisation OpenStreetMap
   Transforme les « elements » bruts renvoyés par Overpass (ways, relations,
   nodes) en quatre listes simples consommées par les renderers :
     roads[{h,n,g}]  build[{t,h,u,g}]  green[{k,n,lu,g}]  pois[{k,n,x,y,a,s,l,to}]
   Reprend les correctifs constatés dans l'application d'origine :
     • les relations bâtiment sont recousues à partir de leurs membres `outer`
       (Overpass ne fournit pas d'anneau au niveau de la relation) ;
     • les hauteurs viennent de `height`, sinon `building:levels × 3,1 m` ;
     • un utilisateur sans hauteur explicite reste à 0 et sera dessiné à 9 m
       par les renderers, qui le signalent dans leur note. */

export function normalizeElements(into, elements) {
  const out = into || { roads: [], build: [], green: [], pois: [] };
  const relationGeoms = [];

  for (const e of elements) {
    const t = e.tags || {};
    if (e.type === 'relation' && (t.building || t.natural === 'water' || t.water) && e.members) {
      for (const m of e.members) {
        if (m.geometry && m.geometry.length > 2 && m.role !== 'inner')
          relationGeoms.push({ tags: t, geometry: m.geometry });
      }
      continue;
    }
    if (e.type === 'node') {
      const transit = t.highway === 'bus_stop' || t.railway || t.public_transport;
      out.pois.push({
        k: transit ? 'transit' : 'poi', n: t.name || '',
        x: e.lon, y: e.lat,
        a: t.amenity || '', s: t.shop || '', l: t.leisure || '', to: t.tourism || ''
      });
      continue;
    }
    if (!e.geometry || e.geometry.length < 2) continue;
    const g = e.geometry.map(p => [p.lat, p.lon]);

    if (t.highway) { out.roads.push({ h: t.highway, n: t.name || '', g }); continue; }

    if (t.building) {
      out.build.push({ t: t.building, h: heightOf(t), u: t.amenity || t.shop || t.office || '', g });
      continue;
    }
    const isGreen = t.natural || t.waterway || t.leisure ||
      ['forest', 'grass', 'meadow', 'recreation_ground', 'basin', 'reservoir', 'cemetery'].includes(t.landuse);
    if (isGreen) {
      const water = t.natural === 'water' || t.waterway || t.natural === 'wetland' || t.water ||
        ['basin', 'reservoir'].includes(t.landuse);
      out.green.push({ k: water ? 'w' : 'g', n: t.name || '', g });
      continue;
    }
    if (t.landuse || t.leisure) out.green.push({ k: 'l', lu: t.landuse || t.leisure, n: t.name || '', g });
  }

  for (const w of relationGeoms) {
    const g = w.geometry.map(p => [p.lat, p.lon]);
    if (w.tags.building)
      out.build.push({ t: w.tags.building, h: heightOf(w.tags), u: '', g });
    else out.green.push({ k: 'w', n: w.tags.name || '', g });
  }
  return out;
}

export function heightOf(tags) {
  const h = parseFloat(String(tags.height || '').replace(/m$/, ''));
  if (Number.isFinite(h)) return h;
  const lv = parseFloat(tags['building:levels']);
  return Number.isFinite(lv) ? lv * 3.1 : 0;
}

/* Déduplication inter-groupes (une même voie peut apparaître dans deux lots). */
export function dedupe(elements) {
  const seen = new Map();
  for (const e of elements) seen.set(e.type + ':' + e.id, e);
  return [...seen.values()];
}

/* ── Vue 3D ────────────────────────────────────────────────────────────────
   Deux sources possibles, mêmes données de sortie :
     • Overpass : nos requêtes habituelles (autonome) ;
     • tuiles osmbuildings.org : hauteurs déjà calculées par le service.
   Sortie normalisée : { g, h, minH, hauteurToit, t, couleur, couleurToit,
   nom, id, source } — « h » en mètres, 0 quand la hauteur n'est pas connue. */
function hauteurEtage(tags) {
  const lv = parseFloat(tags['building:levels']);
  return Number.isFinite(lv) && lv > 0 ? lv * 3.1 : 0;
}

/* Le point (lat, lon) est-il à l'intérieur de l'anneau ? (lancer de rayon)
   Sert à rattacher une cour intérieure à la bonne emprise extérieure. */
function dansAnneau(lat, lon, ring) {
  let dedans = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i], [yj, xj] = ring[j];
    if (((xi > lon) !== (xj > lon)) && (lat < (yj - yi) * (lon - xi) / (xj - xi) + yi))
      dedans = !dedans;
  }
  return dedans;
}
const centroide = ring => {
  let la = 0, lo = 0;
  for (const p of ring) { la += p[0]; lo += p[1]; }
  return [la / ring.length, lo / ring.length];
};

export function batimentsDepuisOverpass(elements) {
  const out = [];
  const pousse = (tags, geometry, id, trous) => {
    const g = geometry.map(p => [p.lat, p.lon]);
    if (g.length < 3) return;
    const h = heightOf(tags) || hauteurEtage(tags);
    out.push({
      g, h, id: 'osm-' + id,
      /* Cours intérieures : anneaux évidés au rendu (règle pair-impair). */
      trous: (trous || []).map(r => r.map(p => [p[0], p[1]])),
      minH: parseFloat(tags['building:min_height']) || 0,
      hauteurToit: parseFloat(tags['roof:height']) || 0,
      t: tags.building === 'yes' ? (tags.amenity || tags.shop || tags.office || 'yes') : (tags.building || 'yes'),
      couleur: tags['building:colour'] || tags['building:color'] || '',
      couleurToit: tags['roof:colour'] || '',
      nom: tags.name || '', source: 'overpass'
    });
  };
  for (const e of elements || []) {
    const t = e.tags || {};
    if (!t.building) continue;
    if (e.type === 'relation' && e.members) {
      /* Une relation peut décrire plusieurs emprises et des cours intérieures.
         Chaque cours revient à l'emprise qui la contient (sinon elle serait
         silencieusement perdue, ou pire, rattachée au mauvais bâtiment). */
      const outers = [], inners = [];
      for (const m of e.members) {
        if (!m.geometry || m.geometry.length <= 3) continue;
        const ring = m.geometry.map(p => [p.lat, p.lon]);
        if (m.role === 'inner') inners.push(ring);
        else outers.push(ring);
      }
      outers.forEach((ring, i) => {
        const trous = inners.filter(inr => dansAnneau(...centroide(inr), ring));
        pousse(t, ring.map(p => ({ lat: p[0], lon: p[1] })), e.id + (outers.length > 1 ? '-' + i : ''), trous);
      });
      continue;
    }
    if (e.geometry && e.geometry.length > 3) pousse(t, e.geometry, e.id);
  }
  return out;
}

export function batimentsDepuisTuiles(geojson) {
  const out = [];
  for (const f of (geojson && geojson.features) || []) {
    const p = f.properties || {};
    const anneaux = f.geometry?.type === 'Polygon' ? f.geometry.coordinates
      : f.geometry?.type === 'MultiPolygon' ? f.geometry.coordinates.flat() : [];
    let i = 0;
    for (const a of anneaux) {
      const g = a.map(c => [c[1], c[0]]);        // GeoJSON : [lon, lat] → [lat, lon]
      if (g.length < 4) continue;
      const h = parseFloat(p.height) || (parseFloat(p.levels) || 0) * 3.1 || 0;
      out.push({
        g, h, id: f.id + (i ? '-' + i++ : ''),
        minH: parseFloat(p.minHeight) || 0,
        hauteurToit: parseFloat(p.roofHeight) || 0,
        t: (p.type || '').split(':')[0] || 'yes',
        couleur: p.color || '', couleurToit: p.roofColor || '',
        nom: p.name || '', source: 'osmbuildings'
      });
    }
  }
  return out;
}
