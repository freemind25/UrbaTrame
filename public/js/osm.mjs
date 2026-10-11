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
