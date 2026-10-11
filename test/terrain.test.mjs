/* Altimétrie : décodeur PNG écrit à la main et lecture de l'élévation.
   Le banc d'essai encode une tuile de synthèse, la décode avec le code du
   serveur et vérifie les valeurs — c'est le seul moyen de contrôler ce
   décodeur sans dépendre du réseau. */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import {
  decodePNG, elevation, terrainZoom,
  lonToX, latToY, xToLon, yToLat
} from '../server/sources/terrain.mjs';

/* ── encodeur PNG minimal (RGB 8 bits, sans entrelacement) ── */
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = buf => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
/* filter : 0 = aucun · 1 = Sub · 2 = Up */
function makePNG(w, h, pixels, { colorType = 2, filter = 0 } = {}) {
  const bpp = colorType === 2 ? 3 : 4, stride = w * bpp;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    const base = y * (stride + 1);
    raw[base] = filter;
    const line = pixels.subarray(y * stride, (y + 1) * stride);
    if (filter === 1) for (let i = 0; i < stride; i++) raw[base + 1 + i] = (line[i] - (i >= bpp ? line[i - bpp] : 0)) & 255;
    else if (filter === 2) {
      const up = y ? pixels.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
      for (let i = 0; i < stride; i++) raw[base + 1 + i] = (line[i] - up[i]) & 255;
    } else line.copy(raw, base + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = colorType;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
  ]);
}

describe('décodeur PNG', () => {
  test('aller-retour sur une image RVB', () => {
    const px = Buffer.from([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]);
    const png = decodePNG(makePNG(2, 2, px));
    assert.equal(png.w, 2);
    assert.equal(png.h, 2);
    assert.equal(png.bpp, 3);
    assert.deepEqual([...png.data], [...px]);
  });

  test('canal alpha pris en charge', () => {
    const px = Buffer.from([1, 2, 3, 255, 4, 5, 6, 0]);
    const png = decodePNG(makePNG(2, 1, px, { colorType: 6 }));
    assert.equal(png.bpp, 4);
    assert.deepEqual([...png.data], [...px]);
  });

  test('lignes filtrées (Sub et Up)', () => {
    for (const filter of [1, 2]) {
      const px = Buffer.from([128, 0, 0, 128, 5, 7, 128, 200, 0, 128, 99, 255]);
      const png = decodePNG(makePNG(4, 1, px, { filter }));
      assert.deepEqual([...png.data], [...px], 'filtre ' + filter);
    }
  });

  test('refus d\'un fichier qui n\'est pas un PNG', () => {
    assert.throws(() => decodePNG(Buffer.from('<!doctype html>')), /NOT_PNG/);
  });

  test('refus d\'un PNG non géré (niveaux de gris)', () => {
    assert.throws(() => decodePNG(makePNG(1, 1, Buffer.from([1]), { colorType: 0 })), /PNG_FORMAT/);
  });
});

describe('élévation Terrarium', () => {
  test('R×256 + G + B/256 − 32768', () => {
    assert.equal(elevation(128, 0, 0), 0, 'niveau de la mer');
    assert.equal(elevation(128, 128, 0), 128, '128 m');
    assert.equal(elevation(128, 255, 255), 256, 'juste sous 256 m');
    assert.equal(elevation(127, 0, 0), -256, 'dépression');
    assert.equal(elevation(140, 200, 64), 3272.3, "haute montagne");
  });
});

describe('projection Web Mercator', () => {
  test('aller-retour latitude/longitude', () => {
    for (const [lat, lon] of [[36.2642, 6.6969], [0, 0], [-33.87, 151.21], [60, -120]]) {
      assert.ok(Math.abs(yToLat(latToY(lat, 14), 14) - lat) < 1e-6, 'lat ' + lat);
      assert.ok(Math.abs(xToLon(lonToX(lon, 14), 14) - lon) < 1e-6, 'lon ' + lon);
    }
  });

  test('zoom selon le rayon', () => {
    assert.equal(terrainZoom(600), 14);
    assert.equal(terrainZoom(1200), 13);
    assert.equal(terrainZoom(2000), 12);
    assert.equal(terrainZoom(3000), 12);
  });
});
