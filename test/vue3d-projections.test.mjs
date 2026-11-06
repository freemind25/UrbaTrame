/* Préréglages de projection de la vue 3D (phase B) : axonométries
   directionnelles NW/NE/SW/SE et vue à hauteur d'œil, plus vérification
   que la couche « green » récupère bien les arbres OSM (natural=tree). */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadKernel } from '../tools/kernel.mjs';
import { PROJECTION_PRESETS } from '../public/js/vue3d-ui.mjs';
import { plan } from '../public/js/plan-2d.mjs';

loadKernel();
const V = globalThis.FMVue3D;
const D2R = Math.PI / 180;
const LAT = 36.2642, LON = 6.6969;

describe('préréglages de projection (phase B)', () => {
  test('neuf préréglages : 4 existants + 4 axonométries directionnelles + œil', () => {
    const cles = Object.keys(PROJECTION_PRESETS);
    assert.equal(cles.length, 9);
    for (const k of ['axono-nw', 'axono-ne', 'axono-sw', 'axono-se']) {
      assert.equal(PROJECTION_PRESETS[k].projection, 'axonometric', k);
      assert.ok(Array.isArray(PROJECTION_PRESETS[k].label), 'libellé fr/en de ' + k);
    }
    assert.deepEqual(
      ['axono-nw', 'axono-ne', 'axono-sw', 'axono-se'].map(k => PROJECTION_PRESETS[k].cap),
      [315, 45, 225, 135]
    );
    assert.equal(PROJECTION_PRESETS['oeil'].projection, 'perspective');
    assert.ok(PROJECTION_PRESETS['oeil'].inclinaison <= 20, 'œil rasant');
    assert.ok(PROJECTION_PRESETS['oeil'].champ > 45, 'œil : grand champ');
  });

  test('la caméra applique le cap du préréglage axonométrique', () => {
    for (const [k, cap] of [['axono-nw', 315], ['axono-se', 135]]) {
      const p = PROJECTION_PRESETS[k];
      const cam = V.camera({ lat: LAT, lon: LON, rayon: 400, projection: p.projection, cap: p.cap, inclinaison: p.inclinaison, largeur: 400, hauteur: 400 });
      assert.equal(cam.cap, cap, k + ' cap=' + cam.cap + '°');
      assert.equal(cam.orthographic, true, k + ' = axonométrie orthographique');
    }
    const oeil = V.camera({ lat: LAT, lon: LON, rayon: 400, projection: 'perspective', cap: 0, inclinaison: 14, champ: 62, largeur: 400, hauteur: 400 });
    assert.equal(oeil.orthographic, false, 'œil = perspective');
  });

  test('la couche green des requêtes planifiées inclut les arbres OSM', () => {
    const p = plan(['gw'], 2000, LAT, LON);
    const requetes = p.groups.map(g => g.query || '').join('\n');
    assert.ok(requetes.includes('node["natural"="tree"]'), 'sélecteur arbre présent dans la requête green');
  });
});
