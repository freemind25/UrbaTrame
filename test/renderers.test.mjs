/* Banc d'essai des renderers.
   Chaque analyse est rejouée sur un extrait réel (El Khroub, 600 m) et le SVG
   produit est contrôlé : forme, valeurs invalides, filigrane, volume.
   `node --test test/renderers.test.mjs`                                       */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadKernel, render, sample, sampleBuckets } from '../tools/kernel.mjs';
import { normalizeElements } from '../public/js/osm.mjs';

const { catalog } = loadKernel();
const implemented = catalog.filter(a => a.impl);
const maxBoards = ['mappingboard', 'urbanstations', 'urbangrid', 'axocallout', 'insetboard', 'viewcones', 'zoningplan', 'radialnet'];

describe('jeu de données du banc d\'essai', () => {
  test('l\'extrait embarqué est exploitable', () => {
    const d = sampleBuckets();
    assert.ok(d.roads.length > 50, 'tronçons');
    assert.ok(d.build.length > 500, 'emprises');
    assert.ok(d.pois.length > 20, 'points d\'intérêt');
    assert.ok(sample.terrain?.grid?.length, 'grille altimétrique');
    assert.ok(sample.climate?.params?.T2M_MAX, 'série climatique');
  });

  test('l\'extrait contient des hauteurs de bâtiment', () => {
    const withH = sampleBuckets().build.filter(b => b.h > 0);
    assert.ok(withH.length > 50, 'hauteurs renseignées : ' + withH.length);
  });
});

describe('planches Max A3 paysage', () => {
  test('les huit entrées du catalogue sont actives et produisent des planches distinctes, alimentées par les données', () => {
    const outputs = maxBoards.map(id => {
      const meta = catalog.find(a => a.id === id);
      assert.ok(meta, id + ' est au catalogue');
      assert.equal(meta.tier, 'max', id + ' est réservé au niveau Max');
      assert.equal(meta.impl, true, id + ' est activé');
      const svg = render(id);
      assert.match(svg, /^<svg viewBox="0 0 420 297" width="420mm" height="297mm"/, id + ' a un viewBox A3 paysage');
      assert.match(svg, /<title>UrbaTrame — .+ — El Khroub, Constantine/, id + ' nomme la planche et le site');
      assert.notEqual(svg, render(id, { D: { roads: [], build: [], green: [], pois: [], rail: [], coast: [] } }), id + ' réagit aux données du site');
      assert.ok((svg.match(/<polygon\b/g) || []).length > 0, id + ' dessine des géométries');
      return svg;
    });
    assert.equal(new Set(outputs).size, maxBoards.length, 'les huit planches ont un rendu distinct');
    assert.match(render('zoningplan'), /non réglementaire|non-cadastrale/i, 'le zonage reste explicitement indicatif');
  });
});

describe('métriques des planches dans l’emprise étudiée', () => {
  test('compte les objets dans la forme du site et ne mesure que la voirie qui la traverse', () => {
    const geo = (east, north) => [north / 111320, east / 111320];
    const square = (east, north, half=4) => [
      geo(east-half,north-half), geo(east+half,north-half),
      geo(east+half,north+half), geo(east-half,north+half)
    ];
    const data = {
      roads: [
        { h: 'residential', g: [geo(-200,75),geo(200,75)] },
        { h: 'service', g: [geo(-40,150),geo(40,150)] }
      ],
      build: [{ g:square(0,0) },{ g:square(75,75) },{ g:square(0,150) }],
      green: [{ k:'g',g:square(0,0) },{ k:'g',g:square(75,75) },{ k:'g',g:square(0,150) }],
      pois: [
        { k:'n',a:'school',y:geo(0,0)[0],x:geo(0,0)[1] },
        { k:'n',a:'school',y:geo(75,75)[0],x:geo(75,75)[1] },
        { k:'n',a:'school',y:geo(0,150)[0],x:geo(0,150)[1] }
      ],
      rail: [{ h:'tram',g:[geo(-50,0),geo(50,0)] }],
      coast: [{ g:[geo(-40,10),geo(40,10)] }]
    };
    const circle = render('mappingboard',{sLat:0,sLng:0,curR:100,shape:'circle',D:data,isPro:true});
    const squareSite = render('mappingboard',{sLat:0,sLng:0,curR:100,shape:'square',D:data,isPro:true});
    const metric = (svg,x,y) => svg.match(new RegExp('<text x="'+x+'\\.00" y="'+y+'\\.00"[^>]*>([^<]*)</text>'))?.[1];

    assert.equal(metric(circle,312,84),'1','un seul bâtiment est dans le cercle');
    assert.equal(metric(circle,361,84),'1','une seule route touche le cercle');
    assert.equal(metric(circle,312,115),'1','un seul POI est dans le cercle');
    assert.equal(metric(circle,361,115),'1','une seule emprise verte est dans le cercle');
    assert.match(circle,/>0\.14 km<\/text>/,'la longueur est coupée à la corde du cercle');
    assert.equal(metric(squareSite,312,84),'2','le carré inclut son angle diagonal');
    assert.equal(metric(squareSite,361,84),'1','la route extérieure ne compte pas');
    assert.equal(metric(squareSite,312,115),'2','le POI diagonal est dans le carré');
    assert.equal(metric(squareSite,361,115),'2','l’emprise verte diagonale est dans le carré');
    assert.match(squareSite,/>0\.20 km<\/text>/,'la longueur est coupée aux côtés du carré');

    const gridCircle = render('urbangrid',{sLat:0,sLng:0,curR:100,shape:'circle',D:data,isPro:true});
    const gridSquare = render('urbangrid',{sLat:0,sLng:0,curR:100,shape:'square',D:data,isPro:true});
    assert.equal(metric(gridCircle,312,75),'1','la trame ne compte que le bâti du cercle');
    assert.equal(metric(gridCircle,359,75),'1','la trame ne compte que les POI du cercle');
    assert.equal(metric(gridSquare,312,75),'2','la trame inclut le bâti diagonal du carré');
    assert.equal(metric(gridSquare,359,75),'2','la trame inclut le POI diagonal du carré');

    const axo = render('axocallout',{sLat:0,sLng:0,curR:100,shape:'circle',D:data,isPro:true});
    assert.equal(metric(axo,312,75),'1','la volumétrie ne compte que les bâtiments dans le cercle');
    assert.match(axo,/stroke="#D97559" stroke-width="0\.8" stroke-dasharray="2\.1 1\.2"/,'le rail est dessiné sur l’axonométrie');
    assert.match(axo,/stroke="#9EC5CF" stroke-width="0\.9"/,'le trait de côte est dessiné sur l’axonométrie');
  });
});

describe('couches ferroviaires et côtières OSM', () => {
  test('normalise le rail et le trait de côte séparément, puis les dessine sur la planche de contexte', () => {
    const raw = [
      { type: 'way', id: 901, geometry: [{ lat: 36.2642, lon: 6.6969 }, { lat: 36.2650, lon: 6.6969 }], tags: { railway: 'tram', name: 'Tramway central' } },
      { type: 'way', id: 902, geometry: [{ lat: 36.2642, lon: 6.6969 }, { lat: 36.2642, lon: 6.6975 }], tags: { natural: 'coastline', name: 'Trait côtier' } }
    ];
    const d = normalizeElements(null, raw);
    assert.equal(d.rail.length, 1);
    assert.deepEqual(d.rail[0], { h: 'tram', n: 'Tramway central', g: [[36.2642, 6.6969], [36.2650, 6.6969]] });
    assert.equal(d.coast.length, 1);
    assert.deepEqual(d.coast[0], { n: 'Trait côtier', g: [[36.2642, 6.6969], [36.2642, 6.6975]] });
    assert.equal(d.roads.length, 0, 'le rail n’est pas reclassé en voirie');
    assert.equal(d.green.length, 0, 'le trait de côte n’est pas avalé par la couche verte');
    const svg = render('mappingboard', { D: d });
    assert.match(svg, /stroke="#D97559" stroke-width="0\.8" stroke-dasharray="2\.1 1\.2"/);
    assert.match(svg, /stroke="#9EC5CF" stroke-width="0\.9"/);
  });
});

describe('rendu de toutes les analyses implémentées', () => {
  for (const meta of implemented) {
    test(meta.id + ' — ' + meta.nom, () => {
      const svg = render(meta.id);
      assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'), 'SVG bien formé');
      assert.ok(svg.length > 900, 'sortie non vide (' + svg.length + ' o)');
      for (const bad of ['NaN', 'undefined', 'Infinity'])
        assert.ok(!svg.includes(bad), 'aucune valeur « ' + bad + ' »');
      assert.ok(svg.includes('data-fm-watermark'), 'filigrane en mode essai');
    });
  }
});

describe('palettes', () => {
  for (const meta of implemented) {
    test(meta.id + ' — 4 palettes valides', () => {
      for (let s = 0; s < 4; s++) {
        const svg = render(meta.id, {}, s);
        assert.ok(svg.startsWith('<svg'), 'palette ' + s);
        assert.ok(!svg.includes('NaN'), 'palette ' + s);
      }
    });
  }
});

describe('modes et langues', () => {
  test('le filigrane disparaît sous licence', () => {
    for (const meta of implemented)
      assert.ok(!render(meta.id, { isPro: true }).includes('data-fm-watermark'), meta.id);
  });

  test('les légendes passent en anglais', () => {
    assert.match(render('climprecip', { lang: 'en' }), /RAIN|PRECIP/);
    assert.match(render('roads', { lang: 'en' }), /LOCAL|SECONDARY|STRUCTURAL/);
  });

  test('aucune analyse ne dépend du réseau', () => {
    /* un contexte vide ne doit pas faire échouer le rendu : c'est le cas
       rencontré quand terrain ou climat n'ont pas pu être récupérés */
    for (const meta of implemented) {
      const svg = render(meta.id, { D: { roads: [], build: [], green: [], pois: [] }, terrain: null, climate: null });
      assert.ok(svg.startsWith('<svg') && !svg.includes('NaN'), meta.id + ' sans données');
    }
  });
});
