/* OpenBuildingMap occupancy renderer — separate source, separate layer. */
(function (G) {
  'use strict';
  const E = G.FMEngine, R = G.FMRender;
  const COLORS = {
    RES: '#C85D50', COM: '#E0A43B', MIX: '#9A69B5', IND: '#54769D',
    AGR: '#68A66D', CIV: '#35A19A', OTHER: '#8B8B87', UNK: '#C8C8C3'
  };
  const LEGEND = [
    { key: 'RES', fr: 'RES', en: 'RES' },
    { key: 'COM', fr: 'COM', en: 'COM' },
    { key: 'MIX', fr: 'MIX', en: 'MIX' },
    { key: 'IND', fr: 'IND', en: 'IND' },
    { key: 'AGR', fr: 'AGR', en: 'AGR' },
    { key: 'CIV', fr: 'CIV', en: 'CIV' },
    { key: 'OTHER', fr: 'AUT', en: 'OTH' },
    { key: 'UNK', fr: 'UNK', en: 'UNK' }
  ];

  function matchesSite(data, ctx) {
    const site = data?.site;
    if (!site) return true;
    return Math.abs(Number(site.lat) - ctx.sLat) < 1e-6 &&
      Math.abs(Number(site.lon) - ctx.sLng) < 1e-6 &&
      Number(site.radius) === Number(ctx.curR) &&
      (!site.shape || site.shape === ctx.shape);
  }

  function ringPath(ring, bounds) {
    if (!Array.isArray(ring) || ring.length < 3) return '';
    const points = ring.map(point => E.proj(Number(point[0]), Number(point[1]), bounds));
    if (points.some(point => !point.every(Number.isFinite))) return '';
    return 'M' + points.map(point => point.map(value => value.toFixed(1)).join(',')).join('L') + 'Z';
  }

  R.obmoccupancy = function (ctx) {
    const data = ctx.obm;
    if (!data?.ok) return E.blank(ctx,
      ctx.lang === 'en' ? 'OpenBuildingMap data unavailable' : 'Données OpenBuildingMap indisponibles');
    if (!matchesSite(data, ctx)) return E.blank(ctx,
      ctx.lang === 'en' ? 'OBM results are for the previous extent' : 'Résultats OBM de l’emprise précédente');

    const bounds = E.getBounds(ctx);
    let body = '<rect width="' + E.W + '" height="' + E.H + '" fill="#FFFFFF"/>';
    let drawn = 0;
    for (const feature of data.features || []) {
      const category = Object.hasOwn(COLORS, feature.category) ? feature.category : 'OTHER';
      const paths = (feature.rings || []).map(ring => ringPath(ring, bounds)).filter(Boolean);
      if (!paths.length) continue;
      body += '<path d="' + paths.join(' ') + '" fill="' + COLORS[category] +
        '" fill-rule="evenodd" stroke="#FFFFFF" stroke-width=".35" stroke-linejoin="round"/>';
      drawn++;
    }
    body += E.siteMark(ctx, bounds);
    if (!drawn) {
      body += '<text x="' + (E.W / 2) + '" y="' + (E.H / 2) + '" text-anchor="middle" font-size="8" fill="#8B8B87">' +
        (ctx.lang === 'en' ? 'No OBM footprints returned' : 'Aucune empreinte OBM renvoyée') + '</text>';
    }
    if (data.partial || data.featuresTruncated) {
      body += '<text x="' + (E.W / 2) + '" y="' + (E.H - E.PAD + 10) + '" text-anchor="middle" font-size="5.5" fill="#A64632">' +
        (ctx.lang === 'en' ? 'Partial tile set / display capped' : 'Tuiles partielles / affichage plafonné') + '</text>';
    }
    const legend = LEGEND.map(item => ({ type: 'rect', c: COLORS[item.key], l: item[ctx.lang === 'en' ? 'en' : 'fr'] }));
    const attribution = [
      'OpenBuildingMap · GFZ Data Services · © OpenStreetMap contributors · ODbL 1.0',
      ctx.lang === 'en' ? 'Unknown class ≠ no building' : 'Classe inconnue ≠ absence de bâtiment'
    ];
    return E.wrap(ctx, body, legend, attribution, { noteFontSize: 5.1, fitNote: true });
  };
})(globalThis);
