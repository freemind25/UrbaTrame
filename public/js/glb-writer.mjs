/* UrbaTrame · export GLB (glTF 2.0 binaire) — phase D, volet 19
   ─────────────────────────────────────────────────────────────────
   Écrit un fichier .glb autonome, lisible par Blender / QGIS / Windows 3D
   Viewer : un maillage par groupe (BATI, TOITS, ARBRES, SOL), positions
   VEC3 float32, couleurs sommets VEC3 optionnelles, indices uint32.
   Aucun format propriétaire (3DM/IFC/DAE/.lbrn2) n’est produit. */

const GLB_MAGIC = 0x20544C46;   // 'glTF'
const CHUNK_JSON = 0x4E4F534A;  // 'JSON'
const CHUNK_BIN = 0x004E4942;   // 'BIN'

const align4 = n => (4 - (n % 4)) % 4;

/* « #rrggbb », « #rgb », « rgb(r,g,b) » → [r,g,b] en 0..1 ; sinon gris clair. */
export function couleurVersRgb(fill, defaut = [0.8, 0.8, 0.8]) {
  if (typeof fill !== 'string') return defaut;
  let m = fill.match(/^#([0-9a-f]{6})$/i);
  if (m) {
    const v = parseInt(m[1], 16);
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
  }
  m = fill.match(/^#([0-9a-f]{3})$/i);
  if (m) {
    const v = m[1];
    return [parseInt(v[0] + v[0], 16) / 255, parseInt(v[1] + v[1], 16) / 255, parseInt(v[2] + v[2], 16) / 255];
  }
  m = fill.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
  if (m) return [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255];
  return defaut;
}

/* meshes : [{ name, positions: [x,y,z,...], indices: [...], colors?: [r,g,b,...] }]
   → Uint8Array GLB complet et valide (JSON + BIN, alignements 4 octets). */
export function buildGlb(meshes = [], { generator = 'UrbaTrame' } = {}) {
  if (!Array.isArray(meshes) || !meshes.length) {
    const e = new Error('GLB_EMPTY');
    e.code = 'GLB_EMPTY';
    throw e;
  }
  const binParts = [];
  let binLength = 0;
  const bufferViews = [];
  const accessors = [];
  const gltfMeshes = [];
  const gltfNodes = [];
  const pushView = data => {
    const view = { buffer: 0, byteOffset: binLength, byteLength: data.byteLength };
    bufferViews.push(view);
    binParts.push(data);
    binLength += data.byteLength;
    const pad = align4(binLength);
    if (pad) { binParts.push(new Uint8Array(pad)); binLength += pad; }
    return bufferViews.length - 1;
  };
  const pushAccessor = (view, componentType, count, type, extra = {}) => {
    accessors.push({ bufferView: view, componentType, count, type, ...extra });
    return accessors.length - 1;
  };

  meshes.forEach((m, mi) => {
    const name = String(m.name || `mesh${mi}`);
    const posArr = Float32Array.from(m.positions || []);
    if (posArr.length < 9 || posArr.length % 3 !== 0) {
      const e = new Error('GLB_BAD_POSITIONS');
      e.code = 'GLB_BAD_POSITIONS';
      throw e;
    }
    const posView = pushView(new Uint8Array(posArr.buffer, posArr.byteOffset, posArr.byteLength));
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < posArr.length; i += 3) {
      for (let c = 0; c < 3; c++) {
        min[c] = Math.min(min[c], posArr[i + c]);
        max[c] = Math.max(max[c], posArr[i + c]);
      }
    }
    const attributes = { POSITION: pushAccessor(posView, 5126, posArr.length / 3, 'VEC3', { min, max }) };
    const idxArr = Uint32Array.from(m.indices && m.indices.length ? m.indices : Array.from({ length: posArr.length / 3 }, (_, i) => i));
    if (idxArr.some(i => !Number.isInteger(i) || i < 0 || i >= posArr.length / 3)) {
      const e = new Error('GLB_BAD_INDICES');
      e.code = 'GLB_BAD_INDICES';
      throw e;
    }
    const idxView = pushView(new Uint8Array(idxArr.buffer, idxArr.byteOffset, idxArr.byteLength));
    const indices = pushAccessor(idxView, 5125, idxArr.length, 'SCALAR');
    if (m.colors && m.colors.length) {
      const colArr = Float32Array.from(m.colors);
      if (colArr.length !== posArr.length) {
        const e = new Error('GLB_BAD_COLORS');
        e.code = 'GLB_BAD_COLORS';
        throw e;
      }
      const colView = pushView(new Uint8Array(colArr.buffer, colArr.byteOffset, colArr.byteLength));
      attributes.COLOR_0 = pushAccessor(colView, 5126, colArr.length / 3, 'VEC3');
    }
    gltfMeshes.push({ name, primitives: [{ attributes, indices, material: mi, mode: 4 }] });
    gltfNodes.push({ mesh: mi, name });
  });

  const materials = meshes.map((m, i) => ({
    name: String(m.name || `mat${i}`),
    pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 },
    doubleSided: true
  }));
  const json = {
    asset: { version: '2.0', generator },
    scene: 0,
    scenes: [{ name: 'UrbaTrame', nodes: gltfNodes.map((_, i) => i) }],
    nodes: gltfNodes,
    meshes: gltfMeshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binLength }]
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = align4(jsonBytes.length);
  const jsonChunkLen = jsonBytes.length + jsonPad;
  const binPad = align4(binLength);
  const binChunkLen = binLength + binPad;
  const total = 12 + 8 + jsonChunkLen + 8 + binChunkLen;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, GLB_MAGIC, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  let off = 12;
  dv.setUint32(off, jsonChunkLen, true);
  dv.setUint32(off + 4, CHUNK_JSON, true);
  out.set(jsonBytes, off + 8);
  for (let i = off + 8 + jsonBytes.length; i < off + 8 + jsonChunkLen; i++) out[i] = 0x20; // padding espaces
  off += 8 + jsonChunkLen;
  dv.setUint32(off, binChunkLen, true);
  dv.setUint32(off + 4, CHUNK_BIN, true);
  let p = off + 8;
  for (const part of binParts) { out.set(part, p); p += part.byteLength; }
  return out;
}

/* Scène vue 3D (objet retourné par FMVue3D.scene) → maillages GLB.
   faces : [{ pts3: [[x,y,z]…], type, fill }] ; maille : quads du sol { pts, fill }.
   zRef : altitude absolue du zéro local (terrainRef) ajoutée à Z. */
export function scene3dVersMeshes(sc, { zRef = 0 } = {}) {
  const groupes = new Map();
  const groupe = cle => {
    if (!groupes.has(cle)) groupes.set(cle, { positions: [], indices: [], colors: [] });
    return groupes.get(cle);
  };
  const ajouterFace = (cle, pts, fill) => {
    if (!Array.isArray(pts) || pts.length < 3) return;
    for (const p of pts) if (!Array.isArray(p) || p.length < 3 || !p.slice(0, 3).every(Number.isFinite)) return;
    const g = groupe(cle);
    const base = g.positions.length / 3;
    const [r, gg, b] = couleurVersRgb(fill);
    for (const p of pts) {
      g.positions.push(Number(p[0]), Number(p[1]), Number(p[2]) + Number(zRef) || 0);
      g.colors.push(r, gg, b);
    }
    for (let i = 1; i + 1 < pts.length; i++) g.indices.push(base, base + i, base + i + 1);
  };
  for (const f of sc?.faces || []) {
    if (!f?.pts3) continue;
    const cle = f.type === 'arbre' ? 'ARBRES' : (f.type === 'toit' || f.type === 'pan') ? 'TOITS' : 'BATI';
    ajouterFace(cle, f.pts3, f.fill);
  }
  for (const q of sc?.maille || []) ajouterFace('SOL', q.pts, q.fill || '#c9bfa8');
  const meshes = [];
  for (const [name, g] of groupes) {
    if (g.indices.length) meshes.push({ name, positions: g.positions, indices: g.indices, colors: g.colors });
  }
  return meshes;
}
