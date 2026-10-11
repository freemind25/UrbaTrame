/* Banc d'essai des renderers.
   Chaque analyse est rejouée sur un extrait réel (El Khroub, 600 m) et le SVG
   produit est contrôlé : forme, valeurs invalides, filigrane, volume.
   `node --test test/renderers.test.mjs`                                       */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadKernel, render, sample, sampleBuckets } from '../tools/kernel.mjs';

const { catalog } = loadKernel();
const implemented = catalog.filter(a => a.impl);

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

describe('rendu des 35 analyses', () => {
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
