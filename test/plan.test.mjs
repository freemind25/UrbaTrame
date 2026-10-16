/* Planificateur de requêtes : cohérence du catalogue, limites de rayon,
   forme des requêtes produites, fusion des lots. Tests hors ligne. */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { plan, DEPS, LIMITS, FREE_IDS, MAX_IDS, VERSION } from '../public/js/plan-2d.mjs';
import { loadKernel, ROOT } from '../tools/kernel.mjs';

const { catalog } = loadKernel();
const allIds = Object.keys(DEPS);
const RADII = [200, 600, 1200, 1500, 2000, 2500, 3000];

describe('catalogue ↔ planificateur', () => {
  test('chaque entrée du catalogue est déclarée dans DEPS', () => {
    const missing = catalog.filter(a => !Object.hasOwn(DEPS, a.id)).map(a => a.id);
    assert.deepEqual(missing, []);
  });

  test('chaque clé de DEPS correspond à une entrée du catalogue', () => {
    const ids = catalog.map(a => a.id);
    assert.deepEqual(allIds.filter(id => !ids.includes(id)), []);
  });

  test('chaque analyse est plafonnée à un rayon plausible', () => {
    for (const id of allIds) {
      assert.ok(Number.isFinite(LIMITS[id]), id + ' sans plafond');
      assert.ok(LIMITS[id] >= 1000 && LIMITS[id] <= 3000, id + ' : ' + LIMITS[id]);
    }
  });

  test('les paliers gratuits et Max existent au catalogue', () => {
    const byId = new Map(catalog.map(a => [a.id, a]));
    for (const id of [...FREE_IDS, ...MAX_IDS]) {
      assert.ok(byId.has(id), id + ' absent du catalogue');
    }
    for (const id of FREE_IDS) assert.equal(byId.get(id).tier, 'free', id);
    for (const id of MAX_IDS) assert.equal(byId.get(id).tier, 'max', id);
  });

  test('la version du plan et celle du paquet coïncident', () => {
    const pkg = JSON.parse(fs.readFileSync(ROOT + '/package.json', 'utf8'));
    assert.equal(VERSION, pkg.version);
  });

  test('la rose des vents NASA régionale ne dépend d’aucune couche OSM locale', () => {
    assert.deepEqual(DEPS.wind, []);
    const p = plan(['wind'], 3000, 36.2642, 6.6969);
    assert.deepEqual(p.groups, []);
    assert.equal(p.climate, false, 'la rose ne télécharge pas inutilement les séries climatiques quotidiennes');
    assert.equal(p.windrose, true);
    assert.deepEqual(p.selected, ['wind']);
  });
});

describe('requêtes produites', () => {
  test('aucun plan ne produit de lot vide, à tous les rayons', () => {
    for (const radius of RADII) {
      for (const id of allIds) {
        const p = plan([id], radius, 36.365, 6.6146);
        for (const g of p.groups) {
          assert.ok(g.query.length > 60, id + ' @' + radius + ' m → lot ' + g.id + ' vide');
          assert.ok(g.query.startsWith('[out:json]'), g.id);
          assert.ok(g.query.endsWith('out geom;'), g.id);
        }
      }
      const full = plan(allIds.slice(0, 44), radius, 36.365, 6.6146);
      for (const g of full.groups) assert.ok(g.query.length > 60, 'sélection complète @' + radius);
    }
  });

  test('la sélection complète tient en trois lots au plus', () => {
    for (const radius of RADII) {
      const p = plan(allIds, radius, 36.365, 6.6146);
      assert.ok(p.groups.length >= 1 && p.groups.length <= 3, 'lots : ' + p.groups.length);
      assert.deepEqual([...new Set(p.groups.map(g => g.id))].sort(),
        p.groups.map(g => g.id).sort(), 'identifiants de lot uniques');
    }
  });

  test('les planches qui dessinent rail et côte demandent réellement ces couches OSM', () => {
    for (const id of ['mappingboard', 'urbanstations', 'axocallout', 'insetboard', 'viewcones', 'zoningplan', 'radialnet']) {
      const query = plan([id], 600, 36.2642, 6.6969).groups.map(g => g.query).join(' ');
      assert.match(query, /way\["railway"/, id + ' récupère les voies ferrées');
      assert.match(query, /way\["natural"="coastline"\]/, id + ' récupère le trait de côte');
    }
  });

  test('sous 1500 m, deux lots sont fusionnés en un seul', () => {
    const p = plan(['roads', 'gw'], 800, 36.365, 6.6146);
    assert.equal(p.groups.length, 1);
    assert.equal(p.groups[0].id, 'base');
    assert.ok(p.groups[0].keys.includes('roads') && p.groups[0].keys.includes('green'));
  });

  test('aucun sélecteur répété dans une requête', () => {
    const p = plan(allIds, 900, 36.365, 6.6146);
    for (const g of p.groups) {
      const sels = [...g.query.matchAll(/(?:way|node|relation)\[[^\]]+\](?=\()/g)].map(m => m[0]);
      assert.equal(new Set(sels).size, sels.length, 'doublons dans le lot ' + g.id);
    }
  });

  test('la fenêtre géographique correspond au rayon demandé', () => {
    const p = plan(['roads'], 600, 36.2642, 6.6969);
    const [s, w, n, e] = p.bbox.split(',').map(Number);
    assert.ok(Math.abs((n - s) * 111320 - 1200) < 5, 'hauteur ≈ 2 × rayon');
    assert.ok(Math.abs((e - w) * 111320 * Math.cos(36.2642 * Math.PI / 180) - 1200) < 5, 'largeur corrigée');
  });
});

describe('limites et garde-fous', () => {
  test('une analyse au-delà de son plafond est écartée, pas refusée', () => {
    const p = plan(['roads', 'poiheat'], 2500, 36.365, 6.6146);
    assert.ok(p.selected.includes('roads'));
    assert.ok(!p.selected.includes('poiheat'));
    assert.deepEqual(p.skipped, ['poiheat']);
  });

  test('rayon hors bornes', () => {
    for (const r of [0, 100, 199, 3001, NaN, Infinity])
      assert.throws(() => plan(['roads'], r, 36.365, 6.6146), /RADIUS_200_3000/, String(r));
  });

  test('coordonnées invalides', () => {
    for (const [lat, lon] of [[NaN, 0], [86, 6], [0, 181]])
      assert.throws(() => plan(['roads'], 600, lat, lon), /INVALID_LOCATION/, lat + '/' + lon);
  });

  test('analyse inconnue', () => {
    for (const ids of [[], ['nope'], ['__proto__'], ['constructor'], null])
      assert.throws(() => plan(ids, 600, 36.365, 6.6146), /INVALID_ANALYSES/, JSON.stringify(ids));
  });

  test('site à cheval sur l\'antiméridien', () => {
    assert.throws(() => plan(['roads'], 2000, 0, 179.99), /SITE_CROSSES_DATELINE/);
  });

  test('climat et relief ne sont demandés que si nécessaire', () => {
    assert.equal(plan(['roads'], 600, 36.365, 6.6146).climate, false);
    assert.equal(plan(['climtemp'], 600, 36.365, 6.6146).climate, true);
    assert.equal(plan(['contour'], 600, 36.365, 6.6146).terrain, true);
    assert.equal(plan(['gw'], 600, 36.365, 6.6146).terrain, false);
  });
});
