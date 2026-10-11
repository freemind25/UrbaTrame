/* Altimétrie : tuiles Terrarium (AWS Open Data, SRTM/USGS/EU-DEM, domaine public).
   Élévation = R × 256 + G + B / 256 − 32768 (mètres).
   Le décodeur PNG est écrit à la main : Node n'embarque pas de décodeur, et
   tirer une dépendance pour lire des PNG sans canal alpha serait disproportionné.
   Un banc d'essai vérifie l'aller-retour encodeur/décodeur (test/terrain.test.mjs). */
import zlib from 'node:zlib';
import { SOURCES, UA, TIMEOUTS } from '../config.mjs';
import { fetchT } from './overpass.mjs';

/* Décodage Terrarium : élévation en mètres, arrondie au décimètre. */
export const elevation = (r, g, b) => Math.round((r * 256 + g + b / 256 - 32768) * 10) / 10;

export function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('NOT_PNG');
  let off = 8, w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) throw new Error('PNG_FORMAT');

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = colorType === 2 ? 3 : 4, stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[p++];                                  // filtre de la ligne
    const line = raw.subarray(p, p + stride); p += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[i] = v & 255;
    }
  }
  return { w, h, bpp, data: out };
}

/* Projection Web Mercator (tuiles 256 px). */
export const lonToX = (lon, z) => (lon + 180) / 360 * 2 ** z;
export const latToY = (lat, z) =>
  (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** z;
export const xToLon = (x, z) => x / 2 ** z * 360 - 180;
export const yToLat = (y, z) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 2 ** z))) * 180 / Math.PI;

export const terrainZoom = radius => radius <= 700 ? 14 : radius <= 1600 ? 13 : 12;

export async function terrain(lat, lon, radius, n = 24) {
  const z = terrainZoom(radius);
  const dy = radius / 111320, dx = dy / Math.cos(lat * Math.PI / 180);
  const tiles = new Map();                                 // mémoire de la requête

  async function tile(tx, ty) {
    const k = tx + '/' + ty;
    if (tiles.has(k)) return tiles.get(k);
    let last;
    for (const host of SOURCES.terrain) {
      try {
        const r = await fetchT(host + z + '/' + tx + '/' + ty + '.png',
          { headers: { 'User-Agent': UA } }, TIMEOUTS.tile);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const png = decodePNG(Buffer.from(await r.arrayBuffer()));
        tiles.set(k, png);
        return png;
      } catch (e) { last = e; }
    }
    throw last || new Error('TERRAIN_UNAVAILABLE');
  }

  const grid = [];
  for (let j = 0; j < n; j++) {
    const row = [];
    for (let i = 0; i < n; i++) {
      const la = (lat + dy) - (j / (n - 1)) * 2 * dy;
      const lo = (lon - dx) + (i / (n - 1)) * 2 * dx;
      const px = lonToX(lo, z) * 256, py = latToY(la, z) * 256;
      const png = await tile(Math.floor(px / 256), Math.floor(py / 256));
      const x = Math.min(png.w - 1, Math.max(0, Math.floor(px % 256)));
      const y = Math.min(png.h - 1, Math.max(0, Math.floor(py % 256)));
      const o = (y * png.w + x) * png.bpp;
      row.push(elevation(png.data[o], png.data[o + 1], png.data[o + 2]));
    }
    grid.push(row);
  }
  return { n, zoom: z, lat, lon, radius, grid };
}
