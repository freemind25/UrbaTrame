/* UrbaTrame · connecteur OpenLandMap (OpenGeoHub) — lecture directe navigateur.
   Les couches sont des COG publics servis via le titiler public d'OpenGeoHub
   (CORS « * » vérifié) : aucune clé, aucun compte, aucune donnée envoyée ailleurs
   que la paire (lon, lat) du point interrogé. Licence des données : CC-BY 4.0.
   Doc : https://docs.openlandmap.org · catalogue STAC : https://stac.opengeohub.org
   Légendes GHLC : SLD officiels v2.0 publiés avec le produit
   (s3.ecodatacube.eu/ifad/land.cover_ifad.mcdt_10m_lv{1,2}_v2.0.sld). */

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

/* Colormap OFFICIEL GHLC niveau 2 (44 classes) — SLD lv2 v2.0. */
export const OLM_COLORMAP = Object.freeze({"1": "#d73027", "2": "#614d1a", "3": "#f9a41a", "4": "#f9e79f", "5": "#ffd700", "6": "#9e7c2d", "7": "#6e4b3a", "8": "#a1887f", "9": "#d4ac0d", "10": "#81c784", "11": "#a5d86a", "12": "#526140", "13": "#66d16a", "14": "#1b9e77", "15": "#388e3c", "16": "#006e00", "17": "#4db6ac", "18": "#00897b", "19": "#80cbc4", "20": "#00796b", "21": "#8bc34a", "22": "#558b2f", "23": "#26a69a", "24": "#009688", "25": "#00695c", "26": "#9e9d24", "27": "#e67e22", "28": "#c98804", "29": "#e0cda9", "30": "#c0a46b", "31": "#ac5f3a", "32": "#f0f0f0", "33": "#d7ccc8", "34": "#c9b1c9", "35": "#1ed9b4", "36": "#1abc9c", "37": "#00897b", "38": "#2c5747", "39": "#4169e1", "40": "#4189e1", "41": "#6c5ce7", "42": "#9a8cff", "43": "#f5deb3", "44": "#f5deb3"});

/* Libellés FR niveau 2, regroupement officiel niveau 2 → niveau 1, libellés FR niveau 1. */
export const OLM_LV2_LABELS = Object.freeze({"1": "Bâti", "2": "Cultures annuelles - soja", "3": "Cultures annuelles - maïs", "4": "Cultures annuelles - riz", "5": "Cultures annuelles - autres", "6": "Cultures pérennes - café", "7": "Cultures pérennes - cacao", "8": "Cultures pérennes - hévéa", "9": "Cultures pérennes - palmier", "10": "Prairie cultivée", "11": "Prairie naturelle", "12": "Autre prairie", "13": "Forêt de feuillus sempervirents, ouverte", "14": "Forêt de feuillus sempervirents, fermée", "15": "Forêt de feuillus caducs, ouverte à fermée", "16": "Forêt de feuillus caducs, fermée", "17": "Forêt de conifères sempervirents, ouverte à fermée", "18": "Forêt de conifères sempervirents, fermée", "19": "Forêt de conifères caducs, ouverte à fermée", "20": "Forêt de conifères caducs, fermée", "21": "Forêt mixte, ouverte", "22": "Forêt mixte, fermée", "23": "Forêt inondée, ouverte", "24": "Forêt inondée, fermée", "25": "Autre forêt inondée", "26": "Autre forêt", "27": "Lande et garrigue", "28": "Autre lande", "29": "Vrai désert", "30": "Semi-aride", "31": "Steppe arbustive semi-aride", "32": "Neige et glace", "33": "Rochers et sommets", "34": "Mousses et lichens", "35": "Zone humide - végétation clairsemée", "36": "Zone humide - prairie", "37": "Zone humide - lande", "38": "Autre zone humide", "39": "Eau - permanente", "40": "Eau - saisonnière", "41": "Mangrove", "42": "Marais côtier", "43": "Plages et dunes", "44": "Aquaculture"});
export const OLM_LV2_TO_LV1 = Object.freeze({"1": 1, "2": 2, "3": 2, "4": 2, "5": 2, "6": 2, "7": 2, "8": 2, "9": 2, "10": 3, "11": 3, "12": 3, "13": 4, "14": 4, "15": 4, "16": 4, "17": 4, "18": 4, "19": 4, "20": 4, "21": 4, "22": 4, "23": 4, "24": 4, "25": 4, "26": 4, "27": 5, "28": 5, "29": 6, "30": 6, "31": 6, "32": 6, "33": 6, "34": 6, "35": 7, "36": 7, "37": 7, "38": 7, "39": 8, "40": 8, "41": 9, "42": 9, "43": 9, "44": 10});
export const OLM_LV1_LABELS = Object.freeze({"1": "Bâti (surfaces artificielles)", "2": "Terres cultivées", "3": "Prairies", "4": "Forêt, plantations et boisements", "5": "Landes et broussailles", "6": "Végétation clairsemée", "7": "Milieux humides intérieurs", "8": "Plans d’eau", "9": "Écosystèmes côtiers", "10": "Aquaculture"});
/* Libellés officiels anglais du SLD niveau 2 (ex. « 1.1 Built-up »). */
export const OLM_LV2_LABELS_EN = Object.freeze({"1": "1.1 Built-up", "2": "2.1 Annual crops - soybean", "3": "2.2 Annual crops - maize", "4": "2.3 Annual crops - rice", "5": "2.4 Annual crops - other", "6": "2.5 Perennial crops - coffee", "7": "2.6 Perennial crops - cocoa", "8": "2.7 Perennial crops - rubber", "9": "2.8 Perennial crops - palm", "10": "3.1 Cultivated grassland", "11": "3.2 Natural grassland", "12": "3.3 Other grassland", "13": "4.1 Tree cover, broadleaved, evergreen, open", "14": "4.2 Tree cover, broadleaved, evergreen, closed", "15": "4.3 Tree cover, broadleaved, deciduous, closed to open (>15%)", "16": "4.4 Tree cover, broadleaved, deciduous, closed (>40%)", "17": "4.5 Tree cover, needleleaved, evergreen, closed to open (>15%)", "18": "4.6 Tree cover, needleleaved, evergreen, closed (>40%)", "19": "4.7 Tree cover, needleleaved, deciduous, closed to open (>15%)", "20": "4.8 Tree cover, needleleaved, deciduous closed (>40%)", "21": "4.9 Tree cover, mixed leaf type, open (broadleaved and needleleaved)", "22": "4.10 Tree cover, mixed leaf type, closed (broadleaved and needleleaved)", "23": "4.11 Flooded tree cover open", "24": "4.12 Flooded tree cover closed", "25": "4.13 Other flooded tree cover", "26": "4.14 Other tree cover", "27": "5.1 Shrubland and heathland", "28": "5.2 Other shrubland", "29": "6.1 True desert", "30": "6.2 Semi-arid", "31": "6.3 Semi-arid shrubland", "32": "6.5 Snow and ice", "33": "6.4 Rocks and mountain peaks", "34": "6.6 Moss and lichen", "35": "7.1 Wetland - sparse vegetation", "36": "7.2 Wetland - grassland", "37": "7.3 Wetland - shrubland", "38": "7.4 Wetland - other wetlands", "39": "8.1 Water - permanent", "40": "8.2 Water - seasonal", "41": "9.1 Mangrove", "42": "9.2 Coastal wetlands", "43": "9.3 Beaches and dunes", "44": "10.1 Aquaculture"});
/* Couleur de chaque famille niveau 1 (celle de sa première sous-classe, SLD officiel). */
export const OLM_LV1_COLORS = Object.freeze({"1": "#d73027", "2": "#ffd700", "3": "#e49f2e", "4": "#228b22", "5": "#e67e22", "6": "#c0a46b", "7": "#1abc9c", "8": "#4169e1", "9": "#6c5ce7", "10": "#add8e6"});

/* Libellé d'une classe GHLC : niveau 2 détaillé + niveau 1. */
export const landCoverLabel = v => {
  const n = Math.round(Number(v));
  if (n === 0 || n === 255) return 'hors données';
  const l2 = OLM_LV2_LABELS[String(n)] || ('classe n°' + n);
  const l1 = OLM_LV2_TO_LV1[String(n)];
  const t1 = l1 != null ? OLM_LV1_LABELS[String(l1)] : null;
  return t1 ? (l2 + ' — ' + t1) : l2;
};

export const OLM_ATTRIBUTION = 'Occupation du sol © OpenLandMap · GHLC-10m (CC-BY 4.0)';

/* Tuile raster WebMercatorQuad de la couche GHLC 10 m, colormap officiel niveau 2. */
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
