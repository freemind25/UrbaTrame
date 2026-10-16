/* Génération de volumes architecturaux conceptuels à partir d'hypothèses
   saisies par l'utilisateur. Aucun fond de carte, parcelle, zonage ou règle
   juridique n'est produit par ce module. Les coordonnées du modèle sont
   locales et graphiques (X/Y), en mètres, sans orientation géographique. */

const numberFrom = value => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * Prépare un ensemble de parallélépipèdes égaux pour une maquette indicative.
 * `floorAreaM2` et `footprintM2` doivent provenir du scénario de capacité;
 * les autres paramètres décrivent explicitement la forme et la composition.
 */
export function buildConceptMassing({
  siteAreaM2, floorAreaM2, footprintM2, floors, floorHeightM,
  volumeCount, aspectRatio, gapM
} = {}) {
  const siteArea = numberFrom(siteAreaM2);
  const floorArea = numberFrom(floorAreaM2);
  const footprint = numberFrom(footprintM2);
  const levels = numberFrom(floors);
  const storey = numberFrom(floorHeightM);
  const count = numberFrom(volumeCount);
  const ratio = numberFrom(aspectRatio);
  const gapInput = numberFrom(gapM);
  const gap = count === 1 && (gapM == null || gapM === '') ? 0 : gapInput;

  if (![siteArea, floorArea, footprint, levels, storey, count, ratio, gap].every(Number.isFinite)) return null;
  if (siteArea <= 0 || siteArea > 1e9 || footprint <= 0 || footprint > siteArea || floorArea <= 0) return null;
  if (!Number.isInteger(levels) || levels < 1 || levels > 300) return null;
  if (storey < 1 || storey > 20 || !Number.isInteger(count) || count < 1 || count > 24) return null;
  if (ratio < 0.1 || ratio > 10 || gap < 0 || gap > 1000) return null;
  if (count > 1 && (gapM == null || String(gapM).trim() === '')) return null;
  if (Math.abs(footprint * levels - floorArea) > Math.max(0.01, floorArea * 1e-6)) return null;

  const areaPerVolumeM2 = footprint / count;
  const widthM = Math.sqrt(areaPerVolumeM2 * ratio);
  const depthM = Math.sqrt(areaPerVolumeM2 / ratio);
  const heightM = levels * storey;
  const totalWidthM = count * widthM + (count - 1) * gap;
  const blocks = Array.from({ length: count }, (_, index) => ({
    index: index + 1,
    xM: index * (widthM + gap),
    yM: 0,
    widthM,
    depthM,
    heightM,
    floorAreaM2: areaPerVolumeM2 * levels,
    footprintM2: areaPerVolumeM2
  }));

  return {
    siteAreaM2: siteArea,
    floorAreaM2: floorArea,
    footprintM2: footprint,
    floors: levels,
    floorHeightM: storey,
    heightM,
    volumeCount: count,
    aspectRatio: ratio,
    gapM: gap,
    widthM,
    depthM,
    totalWidthM,
    totalDepthM: depthM,
    blocks
  };
}

const fmt = (value, lang = 'fr') => new Intl.NumberFormat(lang === 'en' ? 'en-GB' : 'fr-FR', {
  maximumFractionDigits: 1
}).format(value);
const fixed = value => Number(value).toFixed(2);

/** Rendu SVG axonométrique autonome : les valeurs ne sont jamais injectées comme du texte brut. */
export function renderConceptMassingSvg(model, { lang = 'fr', viewAngleDeg = 45 } = {}) {
  if (!model || !Array.isArray(model.blocks) || !model.blocks.length) return '';
  const W = 760, H = 500;
  const angle = ((numberFrom(viewAngleDeg) ?? 45) % 360 + 360) % 360 * Math.PI / 180;
  const elevation = 30 * Math.PI / 180;
  const cosA = Math.cos(angle), sinA = Math.sin(angle);
  const sinE = Math.sin(elevation), cosE = Math.cos(elevation);
  const projectRaw = ([x, y, z]) => [x * cosA - y * sinA, (x * sinA + y * cosA) * sinE - z * cosE];

  const corners = [];
  for (const b of model.blocks) {
    const x0 = b.xM, x1 = x0 + b.widthM, y0 = b.yM, y1 = y0 + b.depthM, z = b.heightM;
    corners.push([x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0],
      [x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]);
  }
  const raw = corners.map(projectRaw);
  const minX = Math.min(...raw.map(p => p[0])), maxX = Math.max(...raw.map(p => p[0]));
  const minY = Math.min(...raw.map(p => p[1])), maxY = Math.max(...raw.map(p => p[1]));
  const plot = { x: 30, y: 62, w: 700, h: 365 };
  const scale = Math.min(plot.w / Math.max(1e-9, maxX - minX), plot.h / Math.max(1e-9, maxY - minY));
  const xPad = plot.x + (plot.w - (maxX - minX) * scale) / 2;
  const yPad = plot.y + (plot.h - (maxY - minY) * scale) / 2;
  const P = (x, y, z) => {
    const [u, v] = projectRaw([x, y, z]);
    return [xPad + (u - minX) * scale, yPad + (v - minY) * scale];
  };
  const pts = coords => coords.map(([x, y]) => `${fixed(x)},${fixed(y)}`).join(' ');
  const colors = [
    { top: '#D5A86C', x: '#9C6C39', y: '#B9864E' },
    { top: '#A8C2A0', x: '#597B55', y: '#78996F' },
    { top: '#9BB9C8', x: '#557989', y: '#7298A7' },
    { top: '#C6A0B6', x: '#835D77', y: '#A17B94' },
    { top: '#E0A394', x: '#A45C4E', y: '#C17C6D' },
    { top: '#A9B3D2', x: '#626C95', y: '#828DB5' }
  ];
  const faces = [];
  for (const b of model.blocks) {
    const x0 = b.xM, x1 = x0 + b.widthM, y0 = b.yM, y1 = y0 + b.depthM, z = b.heightM;
    const colorsForBlock = colors[(b.index - 1) % colors.length];
    const p000 = P(x0, y0, 0), p100 = P(x1, y0, 0), p110 = P(x1, y1, 0), p010 = P(x0, y1, 0);
    const p001 = P(x0, y0, z), p101 = P(x1, y0, z), p111 = P(x1, y1, z), p011 = P(x0, y1, z);
    const midX = (x0 + x1) / 2, midY = (y0 + y1) / 2;
    const cameraX = sinA, cameraY = -cosA, sides = [];
    if (Math.abs(cameraX) > 1e-8) {
      const positiveX = cameraX > 0;
      sides.push({
        depth: (positiveX ? x1 : x0) * cameraX + midY * cameraY,
        color: colorsForBlock.x,
        points: positiveX ? [p100, p110, p111, p101] : [p000, p010, p011, p001]
      });
    }
    if (Math.abs(cameraY) > 1e-8) {
      const negativeY = cameraY < 0;
      sides.push({
        depth: midX * cameraX + (negativeY ? y0 : y1) * cameraY,
        color: colorsForBlock.y,
        points: negativeY ? [p000, p100, p101, p001] : [p010, p110, p111, p011]
      });
    }
    sides.sort((a, b) => a.depth - b.depth);
    for (const side of sides)
      faces.push(`<polygon class="concept-face" points="${pts(side.points)}" fill="${side.color}"/>`);
    faces.push(`<polygon class="concept-face concept-face-top" points="${pts([p001, p101, p111, p011])}" fill="${colorsForBlock.top}"/>`);
    if (model.volumeCount > 1) {
      const label = P((x0 + x1) / 2, (y0 + y1) / 2, z);
      faces.push(`<text class="concept-block-label" x="${fixed(label[0])}" y="${fixed(label[1])}" text-anchor="middle">${b.index}</text>`);
    }
  }

  const english = lang === 'en';
  const title = english ? 'Conceptual 3D massing' : 'Volumes 3D conceptuels';
  const subtitle = english
    ? 'Schematic row · not georeferenced · no land boundary'
    : 'Rangée schématique · non géoréférencée · sans limite foncière';
  const metrics = english
    ? `Combined footprint: ${fmt(model.footprintM2, lang)} m²  ·  Floor area: ${fmt(model.floorAreaM2, lang)} m²  ·  Height: ${fmt(model.heightM, lang)} m`
    : `Emprise cumulée : ${fmt(model.footprintM2, lang)} m²  ·  Surface de plancher : ${fmt(model.floorAreaM2, lang)} m²  ·  Hauteur : ${fmt(model.heightM, lang)} m`;
  const detail = english
    ? `${model.volumeCount} volume(s) · ${model.floors} floor(s) · per-floor height ${fmt(model.floorHeightM, lang)} m · width/depth ${fmt(model.aspectRatio, lang)} · gap ${fmt(model.gapM, lang)} m`
    : `${model.volumeCount} volume(s) · ${model.floors} niveau(x) · hauteur d’étage ${fmt(model.floorHeightM, lang)} m · largeur/profondeur ${fmt(model.aspectRatio, lang)} · écart ${fmt(model.gapM, lang)} m`;
  const disclaimer = english
    ? 'User-entered assumptions only · no cadastral geometry, zoning or regulatory compliance check'
    : 'Hypothèses saisies uniquement · aucune géométrie cadastrale, aucun zonage ni contrôle réglementaire';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="conceptTitle conceptDesc">
  <title id="conceptTitle">${title}</title><desc id="conceptDesc">${subtitle}. ${metrics}. ${detail}. ${disclaimer}.</desc>
  <style>
    .concept-title{font:700 19px Arial,sans-serif;fill:#20342C}
    .concept-subtitle,.concept-detail,.concept-disclaimer{font:12px Arial,sans-serif;fill:#647168}
    .concept-metric{font:700 13px Arial,sans-serif;fill:#29463A}
    .concept-block-label{font:700 12px Arial,sans-serif;fill:#26372F;paint-order:stroke;stroke:#FFF;stroke-width:3px;stroke-linejoin:round}
    .concept-face{stroke:#344A3C;stroke-width:1.1;stroke-linejoin:round}
  </style>
  <rect width="${W}" height="${H}" rx="16" fill="#FBFCF9" stroke="#DCE4DC"/>
  <text class="concept-title" x="22" y="30">${title}</text>
  <text class="concept-subtitle" x="22" y="49">${subtitle}</text>
  ${faces.join('\n  ')}
  <line x1="22" y1="438" x2="738" y2="438" stroke="#E1E6E0"/>
  <text class="concept-metric" x="22" y="460">${metrics}</text>
  <text class="concept-detail" x="22" y="480">${detail}</text>
  <text class="concept-disclaimer" x="22" y="496">${disclaimer}</text>
</svg>`;
}

/** Convertit les blocs en faces 3D compatibles avec objDeScene/stlDeScene. */
export function conceptMeshScene(model) {
  if (!model || !Array.isArray(model.blocks) || !model.blocks.length) return null;
  const boxes = model.volumeCount > 1 && model.gapM === 0
    ? [{ xM: 0, yM: 0, widthM: model.totalWidthM, depthM: model.totalDepthM, heightM: model.heightM }]
    : model.blocks;
  const faces = [];
  for (const b of boxes) {
    const x0 = b.xM, x1 = x0 + b.widthM, y0 = b.yM, y1 = y0 + b.depthM, z = b.heightM;
    faces.push(
      { type: 'mur', pts3: [[x0, y0, 0], [x0, y1, 0], [x1, y1, 0], [x1, y0, 0]] },
      { type: 'mur', pts3: [[x0, y0, 0], [x0, y0, z], [x0, y1, z], [x0, y1, 0]] },
      { type: 'mur', pts3: [[x1, y0, 0], [x1, y1, 0], [x1, y1, z], [x1, y0, z]] },
      { type: 'mur', pts3: [[x0, y0, 0], [x1, y0, 0], [x1, y0, z], [x0, y0, z]] },
      { type: 'mur', pts3: [[x0, y1, 0], [x0, y1, z], [x1, y1, z], [x1, y1, 0]] },
      { type: 'toit', pts3: [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]] }
    );
  }
  return { terrainRef: 0, maille: [], faces };
}
