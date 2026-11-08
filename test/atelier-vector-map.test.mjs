import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadKernel, makeCtx } from '../tools/atelier/kernel.mjs';
import { vectorMapSVG, MAP_PRESETS } from '../public/js/atelier/vector-map.mjs';

loadKernel();

describe('carte vectorielle intégrée à l’atelier', () => {
  test('les cinq styles produisent des SVG autonomes et crédités', () => {
    const ctx = makeCtx();
    for (const preset of MAP_PRESETS) {
      const result = vectorMapSVG(ctx, { preset, width: 900, height: 650, printScale: 'fit' });
      assert.match(result.svg, /<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
      assert.match(result.svg, /OpenStreetMap contributors/);
      assert.match(result.svg, /El Khroub/);
      assert.equal(result.preset, preset);
      assert.ok(result.stats.buildings > 0);
      assert.ok(result.stats.roadsKm > 0);
    }
  });

  test('l’emprise carrée et la limite de projet se distinguent dans le dessin', () => {
    const ctx = makeCtx({ shape: 'square' });
    const boundary = [[36.263, 6.696], [36.263, 6.697], [36.264, 6.697], [36.264, 6.696]];
    const result = vectorMapSVG(ctx, { boundary, layers: { siteBoundary: true }, printScale: 'fit' });
    assert.match(result.svg, /clipPath id="fm-map-clip"><rect/);
    assert.match(result.svg, /stroke-dasharray="6 3"/);
    assert.equal(result.shape, 'square');
    assert.equal(result.fitsPage, true);
  });

  test('les étiquettes OSM restent facultatives et les couleurs de classe sont personnalisables', () => {
    const ctx = makeCtx();
    const plain = vectorMapSVG(ctx, { width: 900, height: 650 });
    assert.doesNotMatch(plain.svg, /Mosquée Er-Rahmane/);
    const labeled = vectorMapSVG(ctx, {
      width: 900, height: 650, layers: { labels: true }, classColors: { public: '#123ABC' }
    });
    assert.match(labeled.svg, /Mosquée Er-Rahmane/);
    assert.match(labeled.svg, /Mam&apos;s Pizza/);
    assert.match(labeled.svg, /fill="#123abc"/i);
  });

  test('une échelle fixe signale le débordement plutôt que de changer silencieusement la mesure', () => {
    const result = vectorMapSVG(makeCtx(), { printScale: 1000, width: 900, height: 650 });
    assert.equal(result.fitsPage, false);
    assert.equal(result.scale, 1000);
  });

  test('une scène sans relief peut toujours produire un plan vectoriel', () => {
    const result = vectorMapSVG(makeCtx({ terrain: null }), { preset: 'relief', width: 900, height: 650 });
    assert.match(result.svg, /Vector map|Carte vectorielle/);
    assert.ok(result.svg.length > 1000);
  });
});

describe('style « contexte urbain » (couleurs par catégorie)', () => {
  test('le preset est proposé et les voies/usages prennent leurs couleurs de classe', () => {
    assert.ok(MAP_PRESETS.includes('contexte-urbain'));
    const base = makeCtx();
    const ctx = makeCtx({
      D: {
        ...base.D,
        roads: [{ h: 'motorway', g: [[36.264, 6.696], [36.266, 6.698]] }],
        green: [{ k: 'l', lu: 'park', g: [[36.264, 6.696], [36.264, 6.698], [36.266, 6.698]] }],
        landuse: [{ lu: 'industrial', tags: { landuse: 'industrial' }, g: [[36.264, 6.696], [36.264, 6.697], [36.265, 6.697]] }]
      }
    });
    const result = vectorMapSVG(ctx, { preset: 'contexte-urbain', width: 900, height: 650, printScale: 'fit' });
    assert.equal(result.preset, 'contexte-urbain');
    assert.match(result.svg, /#B3543F/);   /* autoroute */
    assert.match(result.svg, /#A9CBA4/);   /* parc */
    assert.match(result.svg, /#B0A8C0/);   /* industriel */
    assert.match(result.svg, /Autoroute/);
    assert.match(result.svg, /Parc \/ vert/);
  });
});
