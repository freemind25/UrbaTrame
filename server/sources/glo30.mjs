/* Copernicus GLO-30 (AWS Open Data, programme Copernicus — domaine public)
   ── volet 17 de la phase D, ajouté avec consentement explicite ──
   Tuiles COG 1°×1° : Copernicus_DSM_COG_10_N33_00_E003_00_DEM.tif sur le
   bucket public copernicus-dem-30m. Lecture par plages d'octets (Range) et
   décodage TIFF minimal écrit à la main (tuiles, DEFLATE, prédicteurs 1/2/3,
   Int16 ou Float32) : aucun paquet ajouté, même esprit que decodePNG. */
import zlib from 'node:zlib';
import { SOURCES, UA, TIMEOUTS } from '../config.mjs';
import { fetchT } from './overpass.mjs';

const D2R = Math.PI / 180;

export const GLO30_SOURCE_LABEL = 'Copernicus GLO-30 · tuiles COG publiques AWS Open Data (programme Copernicus)';

/* Nom de la tuile 1°×1° contenant (lat, lon) : N33_00_E003_00, S…_W…. */
export function glo30TileName(lat, lon) {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  const la = String(Math.floor(Math.abs(lat))).padStart(2, '0');
  const lo = String(Math.floor(Math.abs(lon))).padStart(3, '0');
  return `Copernicus_DSM_COG_10_${ns}${la}_00_${ew}${lo}_00_DEM.tif`;
}

const TAGS = {
  width: 256, height: 257, bits: 258, compression: 259, spp: 277,
  predictor: 317, tileW: 322, tileH: 323, tileOffsets: 324, tileBytes: 325,
  sampleFormat: 339, pixelScale: 33550, tiepoint: 33922, nodata: 42113
};
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 11: 4, 12: 8 };

function lireValeurs(dv, le, type, count, offset) {
  const size = TYPE_SIZE[type] || 1;
  const out = [];
  for (let i = 0; i < count; i++) {
    const o = offset + i * size;
    if (o + size > dv.byteLength) break;
    switch (type) {
      case 1: out.push(dv.getUint8(o)); break;
      case 2: out.push(String.fromCharCode(dv.getUint8(o))); break;
      case 3: out.push(dv.getUint16(o, le)); break;
      case 4: out.push(dv.getUint32(o, le)); break;
      case 11: out.push(dv.getFloat32(o, le)); break;
      case 12: out.push(dv.getFloat64(o, le)); break;
      default: out.push(dv.getUint8(o));
    }
  }
  return out;
}

/* En-tête TIFF/COG (IFD 0) → descripteur de la tuile. */
export function lireEnTeteCog(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  if (buf.length < 8) throw Object.assign(new Error('COG_SHORT'), { code: 'COG_UNSUPPORTED' });
  const le = buf[0] === 0x49 && buf[1] === 0x49;
  const be = buf[0] === 0x4D && buf[1] === 0x4D;
  if (!le && !be) throw Object.assign(new Error('COG_NOT_TIFF'), { code: 'COG_UNSUPPORTED' });
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const u16 = o => dv.getUint16(o, le);
  const u32 = o => dv.getUint32(o, le);
  if (u16(2) !== 42) throw Object.assign(new Error('COG_NOT_TIFF'), { code: 'COG_UNSUPPORTED' });
  const ifd = u32(4);
  if (ifd + 2 > buf.length) throw Object.assign(new Error('COG_SHORT'), { code: 'COG_UNSUPPORTED' });
  const count = u16(ifd);
  const tags = {};
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > buf.length) break;
    const tag = u16(e), type = u16(e + 2), n = u32(e + 4);
    const size = (TYPE_SIZE[type] || 1) * n;
    const valOff = size > 4 ? u32(e + 8) : e + 8;
    tags[tag] = lireValeurs(dv, le, type, n, valOff);
  }
  const one = t => (Array.isArray(tags[t]) ? tags[t][0] : undefined);
  const cog = {
    le,
    width: one(TAGS.width), height: one(TAGS.height),
    bits: one(TAGS.bits) || 32, compression: one(TAGS.compression) || 1,
    spp: one(TAGS.spp) || 1, predictor: one(TAGS.predictor) || 1,
    sampleFormat: one(TAGS.sampleFormat) || 1,
    tileW: one(TAGS.tileW), tileH: one(TAGS.tileH),
    tileOffsets: tags[TAGS.tileOffsets], tileBytes: tags[TAGS.tileBytes],
    pixelScale: tags[TAGS.pixelScale] && tags[TAGS.pixelScale].length >= 2 ? tags[TAGS.pixelScale] : null,
    tiepoint: tags[TAGS.tiepoint] && tags[TAGS.tiepoint].length >= 6 ? tags[TAGS.tiepoint] : null,
    nodata: tags[TAGS.nodata] ? parseFloat(tags[TAGS.nodata].join('').replace(/\0.*$/, '')) : null
  };
  if (!cog.width || !cog.height || !cog.tileW || !cog.tileH || !Array.isArray(cog.tileOffsets) || !Array.isArray(cog.tileBytes))
    throw Object.assign(new Error('COG_NOT_TILED'), { code: 'COG_UNSUPPORTED' });
  if (cog.spp !== 1) throw Object.assign(new Error('COG_SPP'), { code: 'COG_UNSUPPORTED' });
  if (![16, 32].includes(cog.bits) || ![1, 2, 3].includes(cog.sampleFormat))
    throw Object.assign(new Error('COG_FORMAT'), { code: 'COG_UNSUPPORTED' });
  if (!cog.pixelScale || !cog.tiepoint) throw Object.assign(new Error('COG_NO_GEO'), { code: 'COG_UNSUPPORTED' });
  return cog;
}

/* Décode une tuile (octets bruts de la plage) → Float32Array tileW×tileH. */
export function decoderTuileCog(cog, raw) {
  let data = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  if (cog.compression === 8 || cog.compression === 32946) data = zlib.inflateSync(data);
  else if (cog.compression !== 1) throw Object.assign(new Error('COG_COMPRESSION_' + cog.compression), { code: 'COG_UNSUPPORTED' });
  const bps = cog.bits / 8;
  const stride = cog.spp * bps;
  const w = cog.tileW, h = cog.tileH;
  if (data.length < w * h * stride) throw Object.assign(new Error('COG_TILE_SHORT'), { code: 'COG_UNSUPPORTED' });
  if (cog.predictor === 2 || cog.predictor === 3) {
    if (cog.predictor === 3 && !(cog.sampleFormat === 3 && cog.bits === 32) && cog.bits !== 8) {
      // prédicteur flottant hors Float32 : non supporté proprement
      throw Object.assign(new Error('COG_PREDICTOR'), { code: 'COG_UNSUPPORTED' });
    }
    if (cog.bits === 8) {
      for (let y = 0; y < h; y++) {
        const row = y * w * stride;
        for (let x = cog.spp; x < w * cog.spp; x++) {
          const i = row + x * stride;
          data[i] = (data[i] + data[i - stride]) & 0xff;
        }
      }
    } else if (cog.predictor === 3) {
      // prédicteur 3 (flottant) : différence octet par octet, pas = spp×bps
      for (let y = 0; y < h; y++) {
        const row = y * w * stride;
        for (let i = row + stride; i < row + w * stride; i++)
          data[i] = (data[i] + data[i - stride]) & 0xff;
      }
    } else {
      // prédicteur 2 sur échantillons 16/32 bits : différence arithmétique avec retenue
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      for (let y = 0; y < h; y++) {
        const row = y * w * stride;
        for (let s = cog.spp; s < w * cog.spp; s++) {
          const o = row + s * stride;
          if (cog.bits === 16) {
            const cur = cog.sampleFormat === 2 ? dv.getInt16(o, cog.le) : dv.getUint16(o, cog.le);
            const prev = cog.sampleFormat === 2 ? dv.getInt16(o - stride, cog.le) : dv.getUint16(o - stride, cog.le);
            const sum = cur + prev;
            if (cog.sampleFormat === 2) dv.setInt16(o, Math.max(-32768, Math.min(32767, sum)), cog.le);
            else dv.setUint16(o, sum & 0xffff, cog.le);
          } else {
            const cur = dv.getUint32(o, cog.le), prev = dv.getUint32(o - stride, cog.le);
            dv.setUint32(o, (cur + prev) >>> 0, cog.le);
          }
        }
      }
    }
  } else if (cog.predictor !== 1) {
    throw Object.assign(new Error('COG_PREDICTOR_' + cog.predictor), { code: 'COG_UNSUPPORTED' });
  }
  const out = new Float32Array(w * h);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let p = 0; p < w * h; p++) {
    const o = p * stride;
    let v;
    if (cog.sampleFormat === 3 && cog.bits === 32) v = dv.getFloat32(o, cog.le);
    else if (cog.sampleFormat === 2 && cog.bits === 16) v = dv.getInt16(o, cog.le);
    else if (cog.sampleFormat === 1 && cog.bits === 16) v = dv.getUint16(o, cog.le);
    else if (cog.sampleFormat === 1 && cog.bits === 32) v = dv.getUint32(o, cog.le);
    else throw Object.assign(new Error('COG_FORMAT'), { code: 'COG_UNSUPPORTED' });
    if (Number.isFinite(cog.nodata) && v === cog.nodata) v = NaN;
    out[p] = v;
  }
  return out;
}

/* Échantillonne une grille n×n sur l’emprise (lat, lon, radius), comme terrain(). */
export function echantillonnerCog(cog, tuiles, lat, lon, radius, n) {
  const dy = radius / 111320;
  const dx = dy / Math.max(0.08, Math.cos(lat * D2R));
  const sx = cog.pixelScale[0], sy = cog.pixelScale[1];
  const tieLon = cog.tiepoint[3], tieLat = cog.tiepoint[4];
  const grid = [];
  for (let j = 0; j < n; j++) {
    const row = [];
    const la = (lat + dy) - (j / (n - 1)) * 2 * dy;
    for (let i = 0; i < n; i++) {
      const lo = (lon - dx) + (i / (n - 1)) * 2 * dx;
      const px = (lo - tieLon) / sx;
      const py = (tieLat - la) / sy;
      const tx = Math.floor(px / cog.tileW), ty = Math.floor(py / cog.tileH);
      const tile = tuiles.get(`${tx}/${ty}`);
      let v = NaN;
      if (tile) {
        const ox = Math.floor(px) - tx * cog.tileW;
        const oy = Math.floor(py) - ty * cog.tileH;
        if (ox >= 0 && ox < cog.tileW && oy >= 0 && oy < cog.tileH) v = tile[oy * cog.tileW + ox];
      }
      row.push(Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
    }
    grid.push(row);
  }
  return grid;
}

/* Grille d’altitude GLO-30 autour de (lat, lon), même contrat que terrain(). */
export async function glo30(lat, lon, radius, n = 24) {
  lat = Number(lat); lon = Number(lon); radius = Number(radius); n = Number(n) || 24;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180 ||
      !Number.isFinite(radius) || radius <= 0)
    throw Object.assign(new Error('GLO30_INVALID'), { code: 'GLO30_INVALID' });
  const dy = radius / 111320;
  const dx = dy / Math.max(0.08, Math.cos(lat * D2R));
  let last;
  for (const host of SOURCES.glo30) {
    try {
      const headName = glo30TileName(lat, lon);
      const hr = await fetchT(host + headName, { headers: { 'User-Agent': UA, Range: 'bytes=0-65535' } }, TIMEOUTS.glo30);
      if (!hr.ok && hr.status !== 206) throw new Error('HTTP ' + hr.status);
      const cog = lireEnTeteCog(Buffer.from(await hr.arrayBuffer()));
      const sx = cog.pixelScale[0], sy = cog.pixelScale[1];
      const tieLon = cog.tiepoint[3], tieLat = cog.tiepoint[4];
      const px0 = (lon - dx - tieLon) / sx, px1 = (lon + dx - tieLon) / sx;
      const py0 = (tieLat - (lat + dy)) / sy, py1 = (tieLat - (lat - dy)) / sy;
      const tx0 = Math.max(0, Math.floor(px0 / cog.tileW)), tx1 = Math.floor(px1 / cog.tileW);
      const ty0 = Math.max(0, Math.floor(py0 / cog.tileH)), ty1 = Math.floor(py1 / cog.tileH);
      const across = Math.ceil(cog.width / cog.tileW);
      const tuiles = new Map();
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          const idx = ty * across + tx;
          const start = cog.tileOffsets[idx], len = cog.tileBytes[idx];
          if (!Number.isFinite(start) || !len) continue;
          const laTuile = tieLat - (ty + 0.5) * cog.tileH * sy;
          const loTuile = tieLon + (tx + 0.5) * cog.tileW * sx;
          const name = glo30TileName(laTuile, loTuile);
          const rr = await fetchT(host + name, { headers: { 'User-Agent': UA, Range: `bytes=${start}-${start + len - 1}` } }, TIMEOUTS.glo30);
          if (!rr.ok && rr.status !== 206) throw new Error('HTTP ' + rr.status);
          tuiles.set(`${tx}/${ty}`, decoderTuileCog(cog, Buffer.from(await rr.arrayBuffer())));
        }
      }
      if (!tuiles.size) throw new Error('GLO30_NO_TILE');
      const grid = echantillonnerCog(cog, tuiles, lat, lon, radius, n);
      return { n, lat, lon, radius, grid, source: 'glo30', tuile: headName, zoom: null };
    } catch (e) { last = e; }
  }
  throw last || Object.assign(new Error('GLO30_UNAVAILABLE'), { code: 'GLO30_UNAVAILABLE' });
}
