import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import {
  glo30TileName, lireEnTeteCog, decoderTuileCog, echantillonnerCog, GLO30_SOURCE_LABEL
} from '../server/sources/glo30.mjs';
import { createAtelierHandlers } from '../server/atelier-api.mjs';

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 11: 4, 12: 8 };

function ecrireValeur(dvw, o, type, v, le) {
  switch (type) {
    case 2: dvw.setUint8(o, String(v).charCodeAt(0)); break;
    case 3: dvw.setUint16(o, v, le); break;
    case 4: dvw.setUint32(o, v, le); break;
    case 12: dvw.setFloat64(o, v, le); break;
    default: dvw.setUint8(o, v);
  }
}

/* Fabrique un COG TIFF little-endian à UNE tuile (tileW=width, tileH=height). */
function fabriquerCog({
  width = 8, height = 8, bits = 32, sampleFormat = 3, compression = 1, predictor = 1,
  nodata = null, pixelScale = [0.0005, 0.0005, 0], tiepoint = [0, 0, 0, 3.0, 36.004, 0], values
}) {
  const bps = bits / 8, stride = bps;
  const raw = Buffer.alloc(width * height * stride);
  const dv = new DataView(raw.buffer);
  const orig = new Float32Array(width * height);
  for (let p = 0; p < width * height; p++) {
    orig[p] = values[p];
    const o = p * stride;
    if (sampleFormat === 3 && bits === 32) dv.setFloat32(o, values[p], true);
    else if (sampleFormat === 2 && bits === 16) dv.setInt16(o, values[p], true);
    else if (sampleFormat === 1 && bits === 8) dv.setUint8(o, values[p]);
  }
  if (predictor === 3 && bits === 32) {
    /* encodage conforme : différence avec l'échantillon ORIGINAL précédent (par octet) */
    const origBytes = Buffer.from(raw);
    for (let y = 0; y < height; y++) {
      const row = y * width * stride;
      for (let i = row + stride; i < row + width * stride; i++) raw[i] = (raw[i] - origBytes[i - stride]) & 0xff;
    }
  } else if (predictor === 2 && bits === 16) {
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let s = 1; s < width; s++) dv.setInt16((row + s) * stride, (orig[row + s] - orig[row + s - 1]) | 0, true);
    }
  }
  const tileData = compression === 8 ? zlib.deflateSync(raw) : raw;
  const entries = [
    { tag: 256, type: 4, values: [width] }, { tag: 257, type: 4, values: [height] },
    { tag: 258, type: 3, values: [bits] }, { tag: 259, type: 3, values: [compression] },
    { tag: 277, type: 3, values: [1] }, { tag: 317, type: 3, values: [predictor] },
    { tag: 322, type: 4, values: [width] }, { tag: 323, type: 4, values: [height] },
    { tag: 324, type: 4, values: [0] }, { tag: 325, type: 4, values: [tileData.length] },
    { tag: 339, type: 3, values: [sampleFormat] },
    { tag: 33550, type: 12, values: pixelScale }, { tag: 33922, type: 12, values: tiepoint }
  ];
  if (nodata !== null) entries.push({ tag: 42113, type: 2, values: String(nodata).split('').concat('\0') });
  entries.sort((a, b) => a.tag - b.tag);
  const ifdOff = 8;
  const ifdSize = 2 + entries.length * 12 + 4;
  let extraOff = ifdOff + ifdSize;
  for (const e of entries) {
    const size = (TYPE_SIZE[e.type] || 1) * e.values.length;
    if (size > 4 && e.tag !== 324) { e.offset = extraOff; extraOff += size + (size % 2); }
  }
  const tileOff = extraOff;
  const buf = Buffer.alloc(tileOff + tileData.length);
  const dvw = new DataView(buf.buffer);
  buf[0] = 0x49; buf[1] = 0x49;
  dvw.setUint16(2, 42, true);
  dvw.setUint32(4, ifdOff, true);
  dvw.setUint16(ifdOff, entries.length, true);
  entries.forEach((e, i) => {
    const o = ifdOff + 2 + i * 12;
    dvw.setUint16(o, e.tag, true);
    dvw.setUint16(o + 2, e.type, true);
    dvw.setUint32(o + 4, e.values.length, true);
    const size = (TYPE_SIZE[e.type] || 1) * e.values.length;
    if (size <= 4) {
      let p = o + 8;
      const vals = e.tag === 324 ? [tileOff] : e.values;
      for (const v of vals) { ecrireValeur(dvw, p, e.type, v, true); p += TYPE_SIZE[e.type]; }
    } else {
      dvw.setUint32(o + 8, e.offset, true);
      let p = e.offset;
      for (const v of e.values) { ecrireValeur(dvw, p, e.type, v, true); p += TYPE_SIZE[e.type]; }
    }
  });
  dvw.setUint32(ifdOff + 2 + entries.length * 12, 0, true);
  tileData.copy(buf, tileOff);
  return buf;
}

const valeurs8x8 = Array.from({ length: 64 }, (_, p) => 100 + Math.floor(p / 8) * 10 + (p % 8));

function response() {
  return {
    statusCode: 200, headers: {}, body: '',
    writeHead(status, headers = {}) { this.statusCode = status; this.headers = headers; },
    end(body = '') { this.body = String(body); },
    get json() { try { return JSON.parse(this.body); } catch { return null; } }
  };
}
async function call(handler, { method = 'POST', body = {} } = {}) {
  const req = { method, url: '/', body, headers: { 'content-type': 'application/json' }, socket: { remoteAddress: '127.0.0.1' } };
  const res = response();
  await handler(req, res);
  return res;
}

describe('GLO-30 Copernicus (phase D, volet 17)', () => {
  test('glo30TileName : tuiles 1° nommées N/S + E/W', () => {
    assert.equal(glo30TileName(33.2, 3.1), 'Copernicus_DSM_COG_10_N33_00_E003_00_DEM.tif');
    assert.equal(glo30TileName(-33.7, -3.2), 'Copernicus_DSM_COG_10_S33_00_W003_00_DEM.tif');
    assert.equal(glo30TileName(0, 0), 'Copernicus_DSM_COG_10_N00_00_E000_00_DEM.tif');
  });

  test('COG Float32 non compressé : en-tête, tuile, échantillonnage', () => {
    const buf = fabriquerCog({ values: valeurs8x8 });
    const cog = lireEnTeteCog(buf);
    assert.equal(cog.width, 8);
    assert.equal(cog.bits, 32);
    assert.equal(cog.sampleFormat, 3);
    assert.deepEqual(cog.pixelScale.slice(0, 2), [0.0005, 0.0005]);
    assert.deepEqual(cog.tiepoint.slice(3, 5), [3.0, 36.004]);
    const tile = decoderTuileCog(cog, buf.subarray(cog.tileOffsets[0], cog.tileOffsets[0] + cog.tileBytes[0]));
    assert.equal(tile.length, 64);
    assert.ok(Math.abs(tile[0] - 100) < 1e-6);
    assert.ok(Math.abs(tile[63] - 177) < 1e-6);
    const tuiles = new Map([['0/0', tile]]);
    /* centre (36.002, 3.002), rayon 100 m : toute la grille tombe dans la tuile 8×8 */
    const grid = echantillonnerCog(cog, tuiles, 36.002, 3.002, 100, 3);
    assert.equal(grid.length, 3);
    assert.ok(grid.flat().every(v => Number.isFinite(v)), 'tous les échantillons résolus');
    /* j=0,i=0 : la≈36.0029 → py≈2.2 → oy=2 ; lo≈3.0009 → px≈1.8 → ox=1 → 100+20+1 = 121 */
    assert.ok(Math.abs(grid[0][0] - 121) < 0.05, `grid[0][0]=${grid[0][0]}`);
  });

  test('COG DEFLATE + prédicteur 3 (flottant) : aller-retour exact', () => {
    const buf = fabriquerCog({ values: valeurs8x8, compression: 8, predictor: 3 });
    const cog = lireEnTeteCog(buf);
    assert.equal(cog.compression, 8);
    assert.equal(cog.predictor, 3);
    const tile = decoderTuileCog(cog, buf.subarray(cog.tileOffsets[0], cog.tileOffsets[0] + cog.tileBytes[0]));
    for (let p = 0; p < 64; p++) assert.ok(Math.abs(tile[p] - valeurs8x8[p]) < 1e-5, `pixel ${p}`);
  });

  test('COG Int16 + nodata : -32768 devient null dans la grille', () => {
    const vals = valeurs8x8.map((v, p) => (p === 10 ? -32768 : v));
    const buf = fabriquerCog({ values: vals, bits: 16, sampleFormat: 2, nodata: -32768 });
    const cog = lireEnTeteCog(buf);
    assert.equal(cog.nodata, -32768);
    const tile = decoderTuileCog(cog, buf.subarray(cog.tileOffsets[0], cog.tileOffsets[0] + cog.tileBytes[0]));
    assert.ok(Number.isNaN(tile[10]));
    assert.ok(Math.abs(tile[11] - 113) < 1e-6);
    const grid = echantillonnerCog(cog, new Map([['0/0', tile]]), 36.002, 3.002, 100, 3);
    assert.ok(grid.flat().every(v => v === null || Number.isFinite(v)));
  });

  test('prédicteur 2 sur Int16 : différence par échantillon inversée', () => {
    const vals = Array.from({ length: 64 }, (_, p) => 200 + (p % 8) * 3); // croissant en x
    const buf = fabriquerCog({ values: vals, bits: 16, sampleFormat: 2, predictor: 2 });
    const cog = lireEnTeteCog(buf);
    const tile = decoderTuileCog(cog, buf.subarray(cog.tileOffsets[0], cog.tileOffsets[0] + cog.tileBytes[0]));
    for (let p = 0; p < 64; p++) assert.ok(Math.abs(tile[p] - vals[p]) < 1e-6, `pixel ${p}: ${tile[p]} vs ${vals[p]}`);
  });

  test('compression non supportée (LZW=5) → COG_UNSUPPORTED', () => {
    const buf = fabriquerCog({ values: valeurs8x8, compression: 5 });
    const cog = lireEnTeteCog(buf);
    assert.throws(() => decoderTuileCog(cog, buf.subarray(cog.tileOffsets[0], cog.tileOffsets[0] + cog.tileBytes[0])), e => e.code === 'COG_UNSUPPORTED');
  });

  test('fichier non TIFF → COG_UNSUPPORTED', () => {
    assert.throws(() => lireEnTeteCog(Buffer.from('pas un tiff')), e => e.code === 'COG_UNSUPPORTED');
  });

  test('API cadrage : terrainSource=glo30 appelle la source GLO-30 et nomme la provenance', async () => {
    const gridFor = n => Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => 400 + r + c));
    let appelGlo = null, appelTerrarium = 0;
    const handlers = createAtelierHandlers({
      overpass: async () => ({ elements: [] }),
      terrain: async () => { appelTerrarium++; return { n: 12, grid: gridFor(12) }; },
      glo30: async (lat, lon, radius, n) => { appelGlo = { lat, lon, radius, n }; return { n, lat, lon, radius, grid: gridFor(n), source: 'glo30' }; },
      now: () => 1_700_000_000_000,
      log: () => {}
    });
    const res = await call(handlers.extractCadrage, {
      body: { lat: 36.2642, lon: 6.6969, radius: 500, include: ['buildings'], terrain: true, terrainN: 12, terrainSource: 'glo30' }
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json.ok, true);
    assert.deepEqual(appelGlo, { lat: 36.2642, lon: 6.6969, radius: 500, n: 12 });
    assert.equal(appelTerrarium, 0, 'Terrarium non appelé quand glo30 est demandé');
    assert.match(res.json.source.elevation, /GLO-30/);
    assert.equal(res.json.terrain.n, 12);
    assert.equal(res.json.terrain.source, 'glo30');

    const res2 = await call(handlers.extractCadrage, {
      body: { lat: 36.2642, lon: 6.6969, radius: 500, include: ['buildings'], terrain: true, terrainN: 12 }
    });
    assert.equal(res2.statusCode, 200);
    assert.equal(appelTerrarium, 1, 'Terrarium reste la source par défaut');
    assert.match(res2.json.source.elevation, /Terrarium/);
  });

  test('API terrain dédiée : source=glo30', async () => {
    const handlers = createAtelierHandlers({
      terrain: async () => ({ n: 16, grid: [] }),
      glo30: async (lat, lon, radius, n) => ({ n, lat, lon, radius, grid: [[420]], source: 'glo30' }),
      now: () => 1_700_000_000_000,
      log: () => {}
    });
    const res = await call(handlers.terrain, { body: { lat: 36.2, lon: 6.6, radius: 300, n: 16, source: 'glo30' } });
    assert.equal(res.statusCode, 200);
    assert.match(res.json.source.elevation, /GLO-30/);
    assert.equal(res.json.terrain.source, 'glo30');
    assert.match(GLO30_SOURCE_LABEL, /Copernicus GLO-30/);
  });
});
