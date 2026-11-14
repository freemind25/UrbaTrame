/* UrbaTrame · indicateurs de site et scénario de faisabilité
   Calculs locaux à partir des couches OSM déjà chargées et des séries
   NASA POWER / Terrarium déjà utilisées par l'application. Le scénario de
   capacité ne déduit aucun règlement : toutes ses hypothèses sont saisies
   explicitement par l'utilisateur. */

const EARTH_METERS_PER_DEGREE = 111320;

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function geoPoint(point) {
  if (Array.isArray(point)) return { lat: finite(point[0], NaN), lon: finite(point[1], NaN) };
  return {
    lat: finite(point?.lat, NaN),
    lon: finite(point?.lon ?? point?.lng, NaN)
  };
}

function localPoint(point, center) {
  const p = geoPoint(point);
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return null;
  return {
    x: (p.lon - center.lon) * EARTH_METERS_PER_DEGREE * center.cosLat,
    y: (p.lat - center.lat) * EARTH_METERS_PER_DEGREE
  };
}

function openRing(geometry, center) {
  if (!Array.isArray(geometry)) return [];
  const points = geometry.map(p => localPoint(p, center)).filter(Boolean);
  if (points.length > 1) {
    const a = points[0], b = points.at(-1);
    if (Math.hypot(a.x - b.x, a.y - b.y) < 0.01) points.pop();
  }
  return points;
}

function ringStats(points) {
  if (!Array.isArray(points) || points.length < 3) return { area: 0, x: 0, y: 0 };
  let twiceArea = 0, cx = 0, cy = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const cross = a.x * b.y - b.x * a.y;
    twiceArea += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  if (Math.abs(twiceArea) < 1e-8) {
    return {
      area: 0,
      x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
      y: points.reduce((sum, p) => sum + p.y, 0) / points.length
    };
  }
  return { area: Math.abs(twiceArea) / 2, x: cx / (3 * twiceArea), y: cy / (3 * twiceArea) };
}

function pointInRing(point, ring) {
  if (ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    const crosses = (a.y > point.y) !== (b.y > point.y) &&
      point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function makeExtent({ center, radius, shape, polygon }) {
  const custom = openRing(polygon, center);
  const hasPolygon = custom.length >= 3;
  let areaM2;
  if (hasPolygon) areaM2 = ringStats(custom).area;
  else if (shape === 'square' || shape === 'rect') areaM2 = (radius * 2) ** 2;
  else areaM2 = Math.PI * radius ** 2;

  function contains(point) {
    if (hasPolygon) return pointInRing(point, custom);
    if (shape === 'square' || shape === 'rect') return Math.abs(point.x) <= radius && Math.abs(point.y) <= radius;
    return Math.hypot(point.x, point.y) <= radius;
  }
  return { areaM2, contains, custom, hasPolygon };
}

function segmentLengthInCircle(a, b, radius) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const A = dx * dx + dy * dy;
  if (A < 1e-12) return 0;
  const B = 2 * (a.x * dx + a.y * dy);
  const C = a.x * a.x + a.y * a.y - radius * radius;
  const discriminant = B * B - 4 * A * C;
  if (discriminant < 0) return C <= 0 ? Math.sqrt(A) : 0;
  const root = Math.sqrt(discriminant);
  const lo = Math.max(0, (-B - root) / (2 * A));
  const hi = Math.min(1, (-B + root) / (2 * A));
  return hi > lo ? Math.sqrt(A) * (hi - lo) : 0;
}

function segmentLengthInSquare(a, b, radius) {
  const dx = b.x - a.x, dy = b.y - a.y;
  let lo = 0, hi = 1;
  for (const [p, q] of [
    [-dx, a.x + radius], [dx, radius - a.x],
    [-dy, a.y + radius], [dy, radius - a.y]
  ]) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return 0;
      continue;
    }
    const t = q / p;
    if (p < 0) lo = Math.max(lo, t);
    else hi = Math.min(hi, t);
    if (hi <= lo) return 0;
  }
  return Math.hypot(dx, dy) * (hi - lo);
}

function lineLengthInExtent(geometry, center, extent, radius, shape) {
  const points = (Array.isArray(geometry) ? geometry : []).map(p => localPoint(p, center)).filter(Boolean);
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (!extent.hasPolygon && (shape === 'square' || shape === 'rect')) {
      length += segmentLengthInSquare(a, b, radius);
    } else if (!extent.hasPolygon) {
      length += segmentLengthInCircle(a, b, radius);
    } else {
      const segment = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.max(1, Math.ceil(segment / 10));
      for (let j = 0; j < steps; j++) {
        const f = (j + 0.5) / steps;
        const sample = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
        if (extent.contains(sample)) length += segment / steps;
      }
    }
  }
  return length;
}

function seriesValues(series) {
  const values = Array.isArray(series) ? series : Object.values(series || {});
  return values.filter(v => v != null && v !== '' && Number.isFinite(Number(v)))
    .map(Number).filter(v => v > -900);
}

function mean(values) {
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
}

function climateSummary(climate) {
  const p = climate?.params || {};
  const tmax = seriesValues(p.T2M_MAX);
  const tmin = seriesValues(p.T2M_MIN);
  const rain = seriesValues(p.PRECTOTCORR);
  const wind = seriesValues(p.WS10M);
  const solar = seriesValues(p.ALLSKY_SFC_SW_DWN);
  const rainDaily = mean(rain);
  return {
    source: climate?.source || (climate ? 'NASA POWER' : ''),
    days: Math.max(tmax.length, tmin.length, rain.length, wind.length, solar.length),
    meanMaxC: mean(tmax),
    meanMinC: mean(tmin),
    estimatedAnnualRainMm: rainDaily == null ? null : rainDaily * 365,
    meanWind10mMs: mean(wind),
    meanSolarKwhM2Day: mean(solar)
  };
}

function terrainSummary(terrain) {
  const values = (terrain?.grid || []).flat()
    .filter(v => v != null && v !== '' && Number.isFinite(Number(v))).map(Number);
  if (!values.length) return { source: '', minM: null, maxM: null, reliefM: null, samples: 0 };
  const minM = Math.min(...values), maxM = Math.max(...values);
  return {
    source: 'Terrarium · SRTM/USGS', minM, maxM,
    reliefM: maxM - minM, samples: values.length
  };
}

function countCategories(points) {
  const counts = new Map();
  for (const p of points) {
    const category = String(p.a || p.s || p.l || p.to || '').trim();
    if (category) counts.set(category, (counts.get(category) || 0) + 1);
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 8);
}

/** Calcule des métriques transparentes, à l'échelle de l'emprise d'analyse. */
export function summarizeSite({
  D = {}, terrain = null, climate = null, lat = 0, lon = 0,
  radius = 600, shape = 'circle', polygon = null
} = {}) {
  const centerLat = finite(lat), centerLon = finite(lon);
  const r = Math.max(1, finite(radius, 600));
  const center = {
    lat: centerLat,
    lon: centerLon,
    cosLat: Math.max(1e-6, Math.cos(centerLat * Math.PI / 180))
  };
  const extent = makeExtent({ center, radius: r, shape, polygon });

  let buildingCount = 0, buildingAreaM2 = 0, knownHeightCount = 0;
  let knownHeightTotalM = 0, knownHeightMaxM = null, knownVolumeM3 = 0;
  for (const building of D.build || []) {
    const ring = openRing(building.g, center), stats = ringStats(ring);
    if (!stats.area || !extent.contains({ x: stats.x, y: stats.y })) continue;
    buildingCount++;
    buildingAreaM2 += stats.area;
    const h = finite(building.h);
    if (h > 0) {
      knownHeightCount++;
      knownHeightTotalM += h;
      knownHeightMaxM = knownHeightMaxM == null ? h : Math.max(knownHeightMaxM, h);
      knownVolumeM3 += stats.area * h;
    }
  }

  let greenCount = 0, greenAreaM2 = 0, waterCount = 0, waterAreaM2 = 0, landuseCount = 0;
  for (const feature of D.green || []) {
    const ring = openRing(feature.g, center), stats = ringStats(ring);
    if (!stats.area || !extent.contains({ x: stats.x, y: stats.y })) continue;
    if (feature.k === 'g') { greenCount++; greenAreaM2 += stats.area; }
    else if (feature.k === 'w') { waterCount++; waterAreaM2 += stats.area; }
    else if (feature.k === 'l') landuseCount++;
  }

  const points = (D.pois || []).filter(p => {
    const point = localPoint([p.y, p.x], center);
    return point && extent.contains(point);
  });
  const transitCount = points.filter(p => p.k === 'transit').length;
  const amenityCount = points.filter(p => p.k !== 'transit').length;
  let roadLengthM = 0, roadCount = 0;
  for (const road of D.roads || []) {
    const lengthM = lineLengthInExtent(road.g, center, extent, r, shape);
    if (lengthM > 0) roadCount++;
    roadLengthM += lengthM;
  }

  return {
    areaM2: extent.areaM2,
    shape: extent.hasPolygon ? 'polygon' : (shape === 'square' || shape === 'rect' ? 'square' : 'circle'),
    buildings: {
      count: buildingCount,
      footprintM2: buildingAreaM2,
      coveragePct: extent.areaM2 ? buildingAreaM2 / extent.areaM2 * 100 : 0,
      heightsKnown: knownHeightCount,
      heightsKnownPct: buildingCount ? knownHeightCount / buildingCount * 100 : 0,
      meanKnownHeightM: knownHeightCount ? knownHeightTotalM / knownHeightCount : null,
      maxKnownHeightM: knownHeightMaxM,
      knownVolumeM3
    },
    green: {
      count: greenCount,
      areaM2: greenAreaM2,
      coveragePct: extent.areaM2 ? greenAreaM2 / extent.areaM2 * 100 : 0
    },
    water: {
      count: waterCount,
      areaM2: waterAreaM2,
      coveragePct: extent.areaM2 ? waterAreaM2 / extent.areaM2 * 100 : 0
    },
    landuseCount,
    roads: { count: roadCount, lengthM: roadLengthM },
    points: { total: points.length, amenities: amenityCount, transit: transitCount, categories: countCategories(points) },
    terrain: terrainSummary(terrain),
    climate: climateSummary(climate)
  };
}

/**
 * « Lecture du site » : texte interprétatif généré localement (déterministe,
 * sans IA cloud) à partir des métriques. Toujours indicatif : jamais de
 * conclusion réglementaire ou cadastrale.
 * Retourne un tableau de paragraphes (fr ou en selon `lang`).
 */
export function siteReading({ m, olm = null, olmEnv = null, windrose = null, lang = 'fr', siteName = '' } = {}) {
  if (!m) return [];
  const fr = lang !== 'en';
  const T = (a, b) => (fr ? a : b);
  const pct = v => (v == null || !Number.isFinite(v) ? '—' : Math.round(v) + ' %');
  const km = v => (v == null ? '—' : v >= 1000 ? (v / 1000).toFixed(1) + ' km' : Math.round(v) + ' m');
  const m2 = v => (v == null ? '—' : v >= 10000 ? (Math.round(v / 1000) / 10) + ' ha' : Math.round(v) + ' m²');
  const out = [];
  const name = siteName ? `« ${siteName} »` : T('le site', 'the site');

  /* 1 · morphologie : bâti + voirie */
  const b = m.buildings || {}, r = m.roads || {};
  if (b.count || r.count) {
    const dense = (b.coveragePct || 0) >= 25;
    const moyen = (b.coveragePct || 0) >= 10;
    const qualite = dense ? T('plutôt dense', 'rather dense') : moyen ? T('en transition', 'mixed') : T('plutôt ouvert', 'rather open');
    out.push(T(
      `Morphologie : ${name} présente un tissu ${qualite} — ${b.count || 0} empreinte(s) bâtie(s) pour ${pct(b.coveragePct)} de l’emprise (${m2(b.footprintM2)} cumulés) et ${km(r.lengthM)} de voirie (${r.count || 0} tronçons).`,
      `Morphology: ${name} shows a ${qualite} fabric — ${b.count || 0} building footprint(s) covering ${pct(b.coveragePct)} of the extent (${m2(b.footprintM2)} summed) and ${km(r.lengthM)} of roads (${r.count || 0} segments).`));
  }

  /* 2 · vert et eau */
  const g = m.green || {}, w = m.water || {};
  if ((g.count || 0) > 0 || (w.count || 0) > 0) {
    const parts = [];
    if (g.count) parts.push(T(`${g.count} espace(s) vert(s), ${pct(g.coveragePct)} de l’emprise (${m2(g.areaM2)})`, `${g.count} green space(s), ${pct(g.coveragePct)} of the extent (${m2(g.areaM2)})`));
    if (w.count) parts.push(T(`${w.count} surface(s) en eau (${m2(w.areaM2)})`, `${w.count} water surface(s) (${m2(w.areaM2)})`));
    out.push(T(`Trame verte et bleue : ${parts.join(' ; ')}.`, `Green and blue network: ${parts.join('; ')}.`));
  }

  /* 3 · relief */
  const t = m.terrain || {};
  if (t.reliefM != null && t.samples > 0) {
    out.push(T(
      `Relief : de ${Math.round(t.minM)} m à ${Math.round(t.maxM)} m, soit ${Math.round(t.reliefM)} m de dénivelé sur l’emprise${t.reliefM >= 40 ? ' — un site marqué, à prendre en compte pour l’implantation et les écoulements' : t.reliefM >= 12 ? ' — une pente sensible' : ' — un terrain globalement plat'}.`,
      `Relief: ${Math.round(t.minM)} m to ${Math.round(t.maxM)} m, i.e. ${Math.round(t.reliefM)} m of elevation range across the extent${t.reliefM >= 40 ? ' — a marked site, to consider for siting and runoff' : t.reliefM >= 12 ? ' — a noticeable slope' : ' — overall flat ground'}.`));
  }

  /* 4 · climat */
  const c = m.climate || {};
  if (c.days > 0 && (c.meanMaxC != null || c.meanMinC != null)) {
    const bits = [];
    if (c.meanMaxC != null && c.meanMinC != null) bits.push(T(`étés chauds (max. moyen ${c.meanMaxC.toFixed(1)} °C), hivers ${c.meanMinC.toFixed(1)} °C en moyenne`, `hot summers (mean max ${c.meanMaxC.toFixed(1)} °C), winters averaging ${c.meanMinC.toFixed(1)} °C`));
    if (c.estimatedAnnualRainMm != null) bits.push(T(`précipitations ~${Math.round(c.estimatedAnnualRainMm)} mm/an`, `rainfall ~${Math.round(c.estimatedAnnualRainMm)} mm/year`));
    if (c.meanSolarKwhM2Day != null) bits.push(T(`ensoleillement ~${c.meanSolarKwhM2Day.toFixed(1)} kWh/m²/jour`, `sunshine ~${c.meanSolarKwhM2Day.toFixed(1)} kWh/m²/day`));
    out.push(T(`Climat (NASA POWER, ${c.days} jours) : ${bits.join(', ')}.`, `Climate (NASA POWER, ${c.days} days): ${bits.join(', ')}.`));
  }

  /* 5 · vent dominant */
  const sect = Array.isArray(windrose?.sectors) ? windrose.sectors : [];
  if (sect.length) {
    const dom = sect.reduce((a, x) => (x.frequencyPct > a.frequencyPct ? x : a), sect[0]);
    const compass = fr ? ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSO','SO','OSO','O','ONO','NO','NNO'] : ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
    out.push(T(`Vent dominant à 10 m : secteur ${compass[Math.round(dom.bearing / 22.5) % 16]} (${Math.round(dom.frequencyPct)} % du temps, ${Number(dom.speedMs ?? 0).toFixed(1)} m/s en moyenne).`, `Dominant wind at 10 m: ${compass[Math.round(dom.bearing / 22.5) % 16]} sector (${Math.round(dom.frequencyPct)} % of the time, ${Number(dom.speedMs ?? 0).toFixed(1)} m/s on average).`));
  }

  /* 6 · lecture satellite OpenLandMap + cohérence */
  if (olm && olm.ok) {
    const lv1 = Number((olm.label || '').match(/classe (\d+) \/ 10/)?.[1] || 0);
    const isBuilt = lv1 === 1, isGreen = lv1 === 3 || lv1 === 4 || lv1 === 5;
    const builtPct = b.coveragePct || 0;
    const coherent = (isBuilt && builtPct >= 10) || (isGreen && builtPct < 25) || (!isBuilt && !isGreen);
    out.push(T(
      `Lecture satellite (OpenLandMap GHLC 10 m) : au centre, le sol est classé « ${olm.label} ». ${coherent ? 'Cela va dans le sens des données OSM (bâti cartographié ici).' : 'À recouper avec les données OSM : la classe satellite et le bâti vectoriel ne concordent pas forcément au même point (10 m vs objets OSM).'}`,
      `Satellite read (OpenLandMap GHLC 10 m): at the centre, the ground is classed "${olm.label}". ${coherent ? 'This matches the OSM data (buildings mapped here).' : 'Cross-check with OSM: the satellite class and the vector buildings do not necessarily agree at the same point (10 m vs OSM objects).'}`));
  }

  /* 6b · environnement satellite : NO₂, température de surface, population */
  if (Array.isArray(olmEnv) && olmEnv.some(r => r.ok)) {
    const bits = [];
    const no2 = olmEnv.find(r => r.layer === 'no2ltm' && r.ok);
    const lst = olmEnv.find(r => r.layer === 'lstDay' && r.ok);
    const pop = olmEnv.find(r => r.layer === 'popGhs' && r.ok);
    const msz = olmEnv.find(r => r.layer === 'mszGhs' && r.ok);
    const dem = olmEnv.find(r => r.layer === 'demGedtm' && r.ok);
    const evi = olmEnv.find(r => r.layer === 'eviMod' && r.ok);
    const wat = olmEnv.find(r => r.layer === 'waterJrc' && r.ok);
    const bio = olmEnv.find(r => r.layer === 'biome' && r.ok);
    if (no2) {
      const v = no2.value;
      const niveau = v < 100 ? T('faible', 'low') : v < 500 ? T('modérée', 'moderate') : T('élevée', 'high');
      bits.push(T(`NO₂ troposphérique ~${Math.round(v)} µmol/m² (niveau ${niveau}, moyenne 2018-2022)`, `tropospheric NO₂ ~${Math.round(v)} µmol/m² (${niveau} level, 2018-2022 mean)`));
    }
    if (lst) bits.push(T(`température de surface (jour, percentile froid annuel) ~${(lst.value * 0.02 - 273.15).toFixed(1)} °C — à ne pas confondre avec un îlot de chaleur estival`, `land surface temperature (daytime, cold-annual percentile) ~${(lst.value * 0.02 - 273.15).toFixed(1)} °C — not an summer heat-island peak`));
    if (pop) bits.push(T(`population GHS 2025 ~${Math.round(pop.value)} hab/100 m²`, `GHS 2025 population ~${Math.round(pop.value)} people/100 m²`));
    if (dem) bits.push(T(`altitude (MNT satellite GEDTM 30 m) ~${Math.round(dem.value)} m`, `elevation (GEDTM 30 m satellite DEM) ~${Math.round(dem.value)} m`));
    if (msz) {
      const c = Math.round(msz.value);
      const lib = lang === 'en'
        ? ({ 0: 'non built-up', 1: 'low-vegetation open space', 2: 'medium-vegetation open space', 3: 'high-vegetation open space', 4: 'water', 5: 'roads', 11: 'residential ≤3 m', 12: 'residential 3–6 m', 13: 'residential 6–15 m', 14: 'residential 15–30 m', 15: 'residential >30 m', 21: 'non-residential ≤3 m', 22: 'non-residential 3–6 m', 23: 'non-residential 6–15 m', 24: 'non-residential 15–30 m', 25: 'non-residential >30 m' }[c] || 'unknown class')
        : ({ 0: 'non bâti', 1: 'espace ouvert végétation basse', 2: 'espace ouvert végétation moyenne', 3: 'espace ouvert végétation haute', 4: 'eau', 5: 'voirie', 11: 'résidentiel ≤ 3 m', 12: 'résidentiel 3–6 m', 13: 'résidentiel 6–15 m', 14: 'résidentiel 15–30 m', 15: 'résidentiel > 30 m', 21: 'non résidentiel ≤ 3 m', 22: 'non résidentiel 3–6 m', 23: 'non résidentiel 6–15 m', 24: 'non résidentiel 15–30 m', 25: 'non résidentiel > 30 m' }[c] || 'classe inconnue');
      bits.push(T(`tissu urbain GHS-MSZ (10 m) : ${lib}`, `GHS-MSZ urban fabric (10 m): ${lib}`));
    }
    if (evi) {
      const e = evi.value * 0.0001;
      const niveau = e < 0.2 ? T('très faible (sol nu dominant)', 'very low (mostly bare soil)') : e < 0.35 ? T('faible', 'low') : e < 0.5 ? T('modérée', 'moderate') : T('forte', 'high');
      bits.push(T(`végétation EVI ~${e.toFixed(2)} (niveau ${niveau}, MODIS 250 m)`, `EVI vegetation ~${e.toFixed(2)} (${niveau} level, MODIS 250 m)`));
    }
    if (wat) bits.push(T(`eau de surface à proximité : ${Math.round(wat.value)} % de présence sur 1984–2016 (JRC 250 m)`, `surface water nearby: ${Math.round(wat.value)} % occurrence over 1984–2016 (JRC 250 m)`));
    if (bio) {
      const c = Math.round(bio.value);
      const lib = lang === 'en'
        ? ({ 1: 'tropical evergreen broadleaf forest', 4: 'warm-temperate evergreen broadleaf and mixed forest', 13: 'temperate deciduous broadleaf forest', 16: 'temperate sclerophyll woodland and shrubland', 18: 'tropical savanna', 22: 'steppe', 27: 'desert' }[c] || 'other biome')
        : ({ 1: 'forêt tropicale sempervirente', 4: 'forêt sempervirente tempérée chaude (méditerranéenne)', 13: 'forêt décidue tempérée', 16: 'garrigue/maquis', 18: 'savane', 22: 'steppe', 27: 'désert' }[c] || 'autre biome');
      bits.push(T(`grand biome ~« ${lib} » (BIOME6K, 1 km — très grossier)`, `broad biome ~"${lib}" (BIOME6K, 1 km — very coarse)`));
    }
    if (bits.length) out.push(T(`Environnement et population (satellite, OpenLandMap) : ${bits.join(' ; ')}.`, `Environment and population (satellite, OpenLandMap): ${bits.join('; ')}.`));
  }

  /* 7 · avertissement */
  out.push(T(
    'Lecture indicative, générée automatiquement à partir de données publiques (OSM, NASA POWER, Terrarium, OpenLandMap) : elle ne remplace ni une visite de terrain, ni les documents officiels (POS/PLU, cadastre, étude géotechnique).',
    'Indicative reading, generated automatically from public data (OSM, NASA POWER, Terrarium, OpenLandMap): it does not replace a site visit or official documents (zoning plan, cadastre, geotechnical study).'));
  return out;
}

/** Scénario de capacité indicatif : aucune règle n'est fournie ou déduite. */
export function calculateFeasibility({
  siteAreaM2, far, coveragePct, floors, costPerM2 = null
} = {}) {
  const area = Number(siteAreaM2), ratio = Number(far), coverage = Number(coveragePct), levels = Number(floors);
  if (![area, ratio, coverage, levels].every(Number.isFinite) || area <= 0 || area > 1e9 || ratio < 0 || ratio > 100 || coverage < 0 || coverage > 100 || levels <= 0 || levels > 300)
    return null;
  const areaByFarM2 = area * ratio;
  const footprintLimitM2 = area * coverage / 100;
  const areaByCoverageM2 = footprintLimitM2 * levels;
  const floorAreaM2 = Math.min(areaByFarM2, areaByCoverageM2);
  const footprintM2 = Math.min(footprintLimitM2, floorAreaM2 / levels);
  const cost = costPerM2 == null || costPerM2 === '' ? null : Number(costPerM2);
  if (cost != null && (!Number.isFinite(cost) || cost < 0 || cost > 1e12)) return null;
  return {
    areaByFarM2,
    footprintLimitM2,
    areaByCoverageM2,
    floorAreaM2,
    footprintM2,
    bindingConstraint: areaByFarM2 <= areaByCoverageM2 ? 'far' : 'coverage',
    costEstimate: cost == null ? null : floorAreaM2 * cost
  };
}
