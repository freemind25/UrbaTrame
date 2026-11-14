/* UrbaTrame · connecteur OpenLandMap (OpenGeoHub) — lecture directe navigateur.
   Les couches sont des COG publics servis via le titiler public d'OpenGeoHub
   (CORS « * » vérifié) : aucune clé, aucun compte, aucune donnée envoyée ailleurs
   que la paire (lon, lat) du point interrogé. Licence des données : CC-BY 4.0.
   Doc : https://docs.openlandmap.org · catalogue STAC : https://stac.opengeohub.org */

const TITILER = 'https://titiler.opengeohub.org';

export const OLM_LAYERS = Object.freeze({
  landcover10m: {
    id: 'landcover10m',
    title: 'Occupation du sol GHLC 10 m (2020)',
    cog: 'https://ceph.opengeohub.org/arco/lclu/ghlc_lcvmcdt_c_10m_sg_20200101_20201231_go01_epsg4326_v1.2.0_srl04.tif',
    unit: 'classe',
    source: 'OpenLandMap · GHLC-10m (CC-BY 4.0)'
  }
});

/* Légende GHLC niveau 1 (10 classes) — voir portail openlandmap.org. */
export const LANDCOVER_CLASSES = Object.freeze({
  1: 'Bâti (surfaces artificielles)',
  2: 'Terres cultivées',
  3: 'Prairies',
  4: 'Forêt, plantations et boisements',
  5: 'Landes et broussailles',
  6: 'Végétation clairsemée',
  7: 'Milieux humides intérieurs',
  8: 'Plans d’eau',
  9: 'Écosystèmes côtiers',
  10: 'Aquaculture'
});
export const landCoverLabel = v => {
  const n = Math.round(Number(v));
  if (LANDCOVER_CLASSES[n]) return LANDCOVER_CLASSES[n];
  /* codes > 10 = légende détaillée GHLC niveau 2 (le COG contient les 2 niveaux) */
  return n === 0 || n === 255 ? 'hors données' : ('classe détaillée n°' + n + ' (GHLC niveau 2)');
};

/* Tuile raster WebMercatorQuad de la couche GHLC 10 m, colorée (niveau 1 en
   couleurs, sous-classes détaillées >10 en niveau de gris par titiler). */
export const OLM_COLORMAP = Object.freeze({
  '1': '#d73027', '2': '#fdae61', '3': '#a6d96a', '4': '#1a9641', '5': '#d9ef8b',
  '6': '#f46d43', '7': '#74add1', '8': '#4575b4', '9': '#313695', '10': '#abd9e9'
});
export const OLM_ATTRIBUTION = 'Occupation du sol © OpenLandMap · GHLC-10m (CC-BY 4.0)';
export function olmTileUrl(z, x, y) {
  const cog = encodeURIComponent(OLM_LAYERS.landcover10m.cog);
  const cm = encodeURIComponent(JSON.stringify(OLM_COLORMAP));
  return TITILER + '/cog/tiles/WebMercatorQuad/' + z + '/' + x + '/' + y +
    '.png?url=' + cog + '&colormap=' + cm;
}

/* Valeur de la couche au point (lon, lat). Renvoie { ok, value, label, layer }.
   Ne lève jamais : en cas d'échec réseau renvoie { ok:false, error }. */
export async function olmPoint(layerKey, lon, lat, { timeout = 20_000 } = {}) {
  const layer = OLM_LAYERS[layerKey];
  if (!layer) return { ok: false, error: 'COUCHE_INCONNUE' };
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return { ok: false, error: 'COORDONNEES_INVALIDES' };
  const url = TITILER + '/cog/point/' + lon + ',' + lat + '?url=' + encodeURIComponent(layer.cog);
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ac.signal, cache: 'no-store' });
    if (!r.ok) return { ok: false, error: 'HTTP_' + r.status };
    const j = await r.json();
    const value = Array.isArray(j.values) ? j.values[0] : undefined;
    if (value == null || Number.isNaN(Number(value))) return { ok: false, error: 'VALEUR_VIDE' };
    return {
      ok: true, layer: layerKey, value: Number(value), lon, lat,
      label: layerKey === 'landcover10m' ? landCoverLabel(value) : String(value),
      unit: layer.unit, title: layer.title, source: layer.source
    };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'TIMEOUT' : 'RESEAU_INJOIGNABLE' };
  } finally { clearTimeout(t); }
}
