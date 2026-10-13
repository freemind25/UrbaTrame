import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { worldPixel, geographicFromWorldPixel, localPixel } from '../public/js/atelier/map.mjs';

describe('projection de la carte web', () => {
  test('le centre du monde tombe au milieu de la tuile z0', () => {
    assert.deepEqual(worldPixel(0, 0, 0), { x: 128, y: 128 });
  });
  test('projection et inversion conservent les lieux du jeu d’essai', () => {
    for (const [lat, lon] of [[36.2642, 6.6969], [48.8566, 2.3522], [-33.87, 151.21]]) {
      const p = worldPixel(lat, lon, 16), g = geographicFromWorldPixel(p.x, p.y, 16);
      assert.ok(Math.abs(g.lat - lat) < 1e-9);
      assert.ok(Math.abs(g.lon - lon) < 1e-9);
    }
  });
  test('les latitudes extrêmes sont bornées à la carte Mercator', () => {
    const p = worldPixel(90, 0, 3), g = geographicFromWorldPixel(p.x, p.y, 3);
    assert.ok(g.lat <= 85.0512 && g.lat > 85);
  });
  test('les entités OSM restent à côté du centre lors d’un passage par la ligne de changement de date', () => {
    const z = 3, center = worldPixel(0, 179, z), origin = { x: center.x - 100, y: center.y - 100 };
    const [x] = localPixel(0, -179, origin, z);
    assert.ok(x > 100 && x < 130);
  });
});
