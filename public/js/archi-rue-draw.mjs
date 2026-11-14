/* UrbaTrame · Analyse architecturale — dessins SVG
   Rendu déterministe en code, sans générateur d'images ni bibliothèque
   externe : chaque planche est calculée depuis le relevé `rue.json`.
   Format portrait 1080 × 1920 (A3), lisible sur téléphone. */

import {
  normalizeSurvey, computeMetrics, describeHL, daylightSummary, demainScenario,
  sunPosition, fr, formatHour
} from './archi-rue.mjs';

export const PLANCHE_W = 1080;
export const PLANCHE_H = 1920;

const C = {
  paper: '#f7f3ea',
  card: '#fffdf8',
  ink: '#1d1d1f',
  ink2: '#3f3f42',
  grey: '#8d8d89',
  light: '#e6e0d3',
  lighter: '#f0ece3',
  orange: '#e87722',
  orangePale: '#f8d5b6',
  blue: '#2f5f9e',
  bluePale: '#c3d5ea',
  red: '#c0392b',
  yellow: '#f4c430',
  zinc: '#cdd1d5',
  zincDark: '#9aa1a7',
  green: '#4f8a4b',
  greenPale: '#cfe0c8',
  shade: '#2b2b2e'
};

const FONT = "DejaVu Sans, Segoe UI, Helvetica Neue, Arial, sans-serif";

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? Math.round(x * 10) / 10 : 0;
}

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function T(x, y, content, opt = {}) {
  const {
    size = 26, fill = C.ink, anchor = 'start', weight = 400, opacity = 1,
    rotate = 0, letter = 0, italic = false
  } = opt;
  return `<text x="${n(x)}" y="${n(y)}" font-family="${FONT}" font-size="${size}" fill="${fill}" ` +
    `text-anchor="${anchor}" font-weight="${weight}"${opacity !== 1 ? ` opacity="${opacity}"` : ''}` +
    `${rotate ? ` transform="rotate(${n(rotate)} ${n(x)} ${n(y)})"` : ''}` +
    `${letter ? ` letter-spacing="${n(letter)}"` : ''}${italic ? ' font-style="italic"' : ''}>${esc(content)}</text>`;
}

function rect(x, y, w, h, opt = {}) {
  const { fill = 'none', stroke = 'none', sw = 2, opacity = 1, rx = 0 } = opt;
  return `<rect x="${n(x)}" y="${n(y)}" width="${n(Math.max(0, w))}" height="${n(Math.max(0, h))}" ` +
    `fill="${fill}"${stroke !== 'none' ? ` stroke="${stroke}" stroke-width="${n(sw)}"` : ''}` +
    `${opacity !== 1 ? ` opacity="${opacity}"` : ''}${rx ? ` rx="${n(rx)}"` : ''}/>`;
}

function line(x1, y1, x2, y2, opt = {}) {
  const { stroke = C.ink, sw = 2, dash = '', opacity = 1, cap = 'butt' } = opt;
  return `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${stroke}" ` +
    `stroke-width="${n(sw)}"${dash ? ` stroke-dasharray="${dash}"` : ''}` +
    `${opacity !== 1 ? ` opacity="${opacity}"` : ''} stroke-linecap="${cap}"/>`;
}

function poly(points, opt = {}) {
  const { fill = 'none', stroke = 'none', sw = 2, opacity = 1, close = true } = opt;
  const d = points.map(p => `${n(p[0])},${n(p[1])}`).join(' ');
  const paint = `fill="${fill}"${stroke !== 'none' ? ` stroke="${stroke}" stroke-width="${n(sw)}" stroke-linejoin="round"` : ''}` +
    `${opacity !== 1 ? ` opacity="${opacity}"` : ''}`;
  return close ? `<polygon points="${d}" ${paint}/>` : `<polyline points="${d}" ${paint}/>`;
}

function circle(cx, cy, r, opt = {}) {
  const { fill = 'none', stroke = 'none', sw = 2, opacity = 1 } = opt;
  return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${fill}"` +
    `${stroke !== 'none' ? ` stroke="${stroke}" stroke-width="${n(sw)}"` : ''}${opacity !== 1 ? ` opacity="${opacity}"` : ''}/>`;
}

function path(d, opt = {}) {
  const { fill = 'none', stroke = 'none', sw = 2, opacity = 1, dash = '' } = opt;
  return `<path d="${d}" fill="${fill}"${stroke !== 'none' ? ` stroke="${stroke}" stroke-width="${n(sw)}"` : ''}` +
    `${dash ? ` stroke-dasharray="${dash}"` : ''}${opacity !== 1 ? ` opacity="${opacity}"` : ''}/>`;
}

function wrap(text, maxChars) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const w of words) {
    if ((current + ' ' + w).trim().length > maxChars && current) {
      lines.push(current.trim());
      current = w;
    } else {
      current = (current + ' ' + w).trim();
    }
  }
  if (current) lines.push(current.trim());
  return lines;
}

function paragraph(x, y, text, opt = {}) {
  const { size = 24, width = 900, fill = C.ink2, lh = 1.42, weight = 400 } = opt;
  const maxChars = Math.max(10, Math.floor(width / (size * 0.53)));
  return wrap(text, maxChars)
    .map((l, i) => T(x, y + i * size * lh, l, { size, fill, weight }))
    .join('');
}

function dimH(x1, x2, y, label, opt = {}) {
  const { color = C.ink, size = 26, above = true, sw = 1.6, bg = C.paper } = opt;
  const lw = String(label).length * size * 0.56 + 16;
  const mid = (x1 + x2) / 2;
  const parts = [
    line(x1, y, x2, y, { stroke: color, sw }),
    line(x1 - 6, y + 6, x1 + 6, y - 6, { stroke: color, sw }),
    line(x2 - 6, y + 6, x2 + 6, y - 6, { stroke: color, sw })
  ];
  if (Math.abs(x2 - x1) < 70) {
    const dy = above ? -14 : 34;
    parts.push(T(mid, y + dy, label, { size, fill: color, anchor: 'middle', weight: 600 }));
  } else if (above) {
    parts.push(rect(mid - lw / 2, y - size - 5, lw, size + 10, { fill: bg }));
    parts.push(T(mid, y - 9, label, { size, fill: color, anchor: 'middle', weight: 600 }));
  } else {
    parts.push(rect(mid - lw / 2, y + 5, lw, size + 10, { fill: bg }));
    parts.push(T(mid, y + size + 1, label, { size, fill: color, anchor: 'middle', weight: 600 }));
  }
  return parts.join('');
}

function dimV(x, y1, y2, label, opt = {}) {
  const { color = C.ink, size = 23, side = 'left', bg = C.paper } = opt;
  const mid = (y1 + y2) / 2;
  const lw = String(label).length * size * 0.56 + 12;
  return [
    line(x, y1, x, y2, { stroke: color, sw: 1.5 }),
    line(x - 6, y1 + 6, x + 6, y1 - 6, { stroke: color, sw: 1.5 }),
    line(x - 6, y2 + 6, x + 6, y2 - 6, { stroke: color, sw: 1.5 }),
    rect(x - (side === 'left' ? lw + 3 : 3), mid - size / 2 - 3, lw + 3, size + 6, { fill: bg }),
    T(x + (side === 'left' ? -9 : 9), mid + size * 0.35, label, {
      size, fill: color, anchor: side === 'left' ? 'end' : 'start', weight: 600
    })
  ].join('');
}

function scaleBar(x, y, pxPerM, opt = {}) {
  const { maxMeters = 10, color = C.ink, label = '', stepM = 1 } = opt;
  const parts = [];
  let cursor = x;
  let meter = 0;
  while (meter < maxMeters) {
    const w = stepM * pxPerM;
    parts.push(rect(cursor, y, w, 13, { fill: meter / stepM % 2 === 0 ? color : C.paper, stroke: color, sw: 1 }));
    parts.push(T(cursor, y + 32, String(meter), { size: 18, fill: C.ink2, anchor: 'middle' }));
    cursor += w;
    meter += stepM;
  }
  parts.push(T(cursor, y + 32, String(meter), { size: 18, fill: C.ink2, anchor: 'middle' }));
  if (label) parts.push(T(cursor + 16, y + 13, label, { size: 21, fill: C.ink2 }));
  return parts.join('');
}

function northArrow(cx, cy, angleDeg = 0, size = 30) {
  return `<g transform="rotate(${n(angleDeg)} ${n(cx)} ${n(cy)})">` +
    poly([[cx, cy - size], [cx - size * 0.36, cy + size * 0.62], [cx, cy + size * 0.3]], { fill: C.ink }) +
    poly([[cx, cy - size], [cx + size * 0.36, cy + size * 0.62], [cx, cy + size * 0.3]], { fill: C.card, stroke: C.ink, sw: 1.6 }) +
    T(cx, cy - size - 10, 'N', { size: 22, fill: C.ink, anchor: 'middle', weight: 700 }) +
    '</g>';
}

function person(x, baseY, heightPx, color = C.ink2) {
  const head = Math.max(3, heightPx * 0.12);
  const top = baseY - heightPx;
  return [
    circle(x, top + head, head, { fill: color }),
    path(`M ${n(x - heightPx * 0.1)} ${n(top + head * 2)} L ${n(x + heightPx * 0.1)} ${n(top + head * 2)} ` +
      `L ${n(x + heightPx * 0.08)} ${n(baseY)} L ${n(x - heightPx * 0.08)} ${n(baseY)} Z`, { fill: color })
  ].join('');
}

function treePlan(cx, cy, r) {
  return circle(cx, cy, r, { fill: C.greenPale, stroke: C.green, sw: 2 }) +
    circle(cx, cy, r * 0.72, { fill: 'none', stroke: C.green, sw: 1.2, opacity: 0.75 }) +
    circle(cx, cy, r * 0.13, { fill: '#8a6a45' });
}

function treeElevation(x, baseY, hM, pxPerM) {
  const h = hM * pxPerM;
  const crown = h * 0.66;
  return [
    rect(x - h * 0.04, baseY - h * 0.5, h * 0.08, h * 0.5, { fill: '#8a6a45' }),
    circle(x, baseY - h * 0.63, crown / 2, { fill: C.greenPale, stroke: C.green, sw: 2 }),
    circle(x - crown * 0.17, baseY - h * 0.68, crown * 0.34, { fill: 'none', stroke: C.green, sw: 1, opacity: 0.6 }),
    circle(x + crown * 0.19, baseY - h * 0.6, crown * 0.3, { fill: 'none', stroke: C.green, sw: 1, opacity: 0.6 })
  ].join('');
}

function legendRow(x, y, items, opt = {}) {
  const { size = 22, gap = 28 } = opt;
  let cursor = x;
  const parts = [];
  for (const it of items) {
    if (it.solid) {
      parts.push(rect(cursor, y - 15, 28, 19, { fill: it.solid, stroke: it.stroke || 'none', sw: 1.4 }));
    } else if (it.dash) {
      parts.push(line(cursor, y - 5, cursor + 32, y - 5, { stroke: it.dash, sw: 3, dash: '7 4' }));
    } else if (it.dot) {
      parts.push(circle(cursor + 14, y - 5, 8, { fill: it.dot, stroke: it.stroke || 'none', sw: 1.4 }));
    } else if (it.symbol === 'cut') {
      parts.push(rect(cursor, y - 15, 28, 19, { fill: 'url(#hatch)', stroke: C.ink, sw: 1.2 }));
    } else if (it.symbol === 'tree') {
      parts.push(treePlan(cursor + 14, y - 5, 11));
    } else if (it.symbol === 'person') {
      parts.push(person(cursor + 14, y + 9, 28));
    }
    parts.push(T(cursor + 38, y, it.label, { size, fill: C.ink2 }));
    cursor += 38 + String(it.label).length * size * 0.55 + gap;
  }
  return parts.join('');
}

function frame({ numero, categorie, titre, sousTitre, corps, legende = '', cartouche, note = '', date = '' }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PLANCHE_W}" height="${PLANCHE_H}" viewBox="0 0 ${PLANCHE_W} ${PLANCHE_H}">` +
    `<defs>
      <pattern id="hatch" width="9" height="9" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
        <rect width="9" height="9" fill="#fbf8f1"/><line x1="0" y1="0" x2="0" y2="9" stroke="#8a8a8a" stroke-width="2.2"/>
      </pattern>
      <pattern id="paves" width="24" height="16" patternUnits="userSpaceOnUse">
        <rect width="24" height="16" fill="#ded8ca"/><path d="M0 0V16M12 0V16" stroke="#c8c1b1" stroke-width="1"/>
      </pattern>
      <pattern id="diag" width="11" height="11" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
        <rect width="11" height="11" fill="${C.lighter}"/><line x1="0" y1="0" x2="0" y2="11" stroke="#c9c2b4" stroke-width="1.8"/>
      </pattern>
    </defs>` +
    rect(0, 0, PLANCHE_W, PLANCHE_H, { fill: C.paper }) +
    T(48, 58, categorie || 'ANALYSE ARCHITECTURALE', { size: 20, fill: C.grey, letter: 2 }) +
    T(1032, 58, numero, { size: 20, fill: C.grey, anchor: 'end', weight: 600 }) +
    T(48, 104, titre, { size: 38, weight: 700 }) +
    (sousTitre ? T(48, 136, sousTitre, { size: 21, fill: C.ink2 }) : '') +
    corps +
    legende +
    rect(40, 1772, 1000, 112, { fill: C.card, stroke: C.ink, sw: 2 }) +
    rect(40, 1772, 12, 112, { fill: C.ink }) +
    T(74, 1814, cartouche || titre, { size: 26, weight: 700 }) +
    T(74, 1848, note, { size: 19, fill: C.ink2 }) +
    T(1006, 1814, date, { size: 21, fill: C.ink2, anchor: 'end' }) +
    T(48, 1912, 'UrbaTrame · analyse architecturale · dessin calculé en code depuis rue.json — aucune image générée', {
      size: 16, fill: C.grey
    }) +
    '</svg>';
}

/* ------------------------------------------------------------------ */
/* 2 · Profil en travers                                               */
/* ------------------------------------------------------------------ */

export function levelsOf(facade, totalHeight) {
  const label = String(facade.niveaux || 'R+4+C');
  const m = label.match(/R\+\s*(\d)/i);
  const floors = m ? Number(m[1]) : 4;
  const hasAttic = /C/i.test(label);
  const attic = hasAttic ? Math.min(3.2, Math.max(1.4, totalHeight * 0.14)) : 0;
  let rdc = totalHeight - floors * 3.0 - attic;
  rdc = Math.min(5.0, Math.max(3.2, rdc));
  const levels = [{ name: 'RDC', z0: 0, z1: rdc }];
  let z = rdc;
  const names = ['1er', '2e', '3e', '4e', '5e', '6e', '7e'];
  for (let i = 0; i < floors; i++) {
    const h = Math.max(0.4, Math.min(3.2, totalHeight - z - attic));
    levels.push({ name: names[i] || `${i + 1}e`, z0: z, z1: z + h });
    z += h;
  }
  if (hasAttic && totalHeight - z > 0.5) levels.push({ name: 'combles', z0: z, z1: totalHeight });
  return levels;
}

export function svgProfil(survey) {
  const s = normalizeSurvey(survey);
  const m = computeMetrics(s);
  const L = s.largeur_facades;
  const hMax = Math.max(s.facades.ouest.hauteur_faitage, s.facades.est.hauteur_faitage);
  const groundY = 1340;
  const topY = 330;
  const wall = 30;
  const pxPerM = Math.min((groundY - topY) / (hMax + 1.2), 820 / (L + 4.4));
  const x0 = 540 - (L * pxPerM) / 2;
  const x1 = x0 + L * pxPerM;
  const parts = [];

  /* Ciel */
  parts.push(rect(x0 - wall, topY, L * pxPerM + wall * 2, groundY - topY, { fill: '#dfeaf2' }));
  /* Sol */
  parts.push(rect(x0 - wall - 8, groundY, L * pxPerM + wall * 2 + 16, 26, { fill: 'url(#paves)', stroke: C.ink2, sw: 1.4 }));
  parts.push(rect(x0 - wall - 8, groundY + 26, L * pxPerM + wall * 2 + 16, 20, { fill: 'url(#hatch)', opacity: 0.5 }));

  /* Bandes de sol */
  let cursorM = 0;
  for (const b of s.bandes) {
    const bx = x0 + cursorM * pxPerM;
    const bw = b.largeur * pxPerM;
    if (b.type.includes('terrasse')) {
      parts.push(rect(bx, groundY - 5, bw, 5, { fill: C.orange }));
    }
    cursorM += b.largeur;
  }

  const drawFacade = (side, xInner, dir) => {
    const f = s.facades[side];
    const hE = f.hauteur_egout;
    const hF = f.hauteur_faitage;
    const wallX = dir < 0 ? xInner - wall : xInner;
    const levels = levelsOf(f, hE);
    const roofDepth = 2.6 * pxPerM;

    parts.push(rect(wallX, groundY - hE * pxPerM, wall, hE * pxPerM, { fill: 'url(#hatch)', stroke: C.ink, sw: 2.4 }));

    /* toit : brisis + terrasson */
    const ridgeX = xInner + dir * roofDepth;
    parts.push(poly([
      [xInner, groundY - hE * pxPerM],
      [ridgeX, groundY - hF * pxPerM],
      [ridgeX + dir * 0.5 * pxPerM, groundY - hF * pxPerM],
      [ridgeX + dir * 0.5 * pxPerM, groundY - hE * pxPerM]
    ], { fill: C.zinc, stroke: C.ink, sw: 2 }));

    /* lignes de niveaux */
    for (let i = 1; i < levels.length; i++) {
      const y = groundY - levels[i].z0 * pxPerM;
      parts.push(line(xInner, y, xInner + dir * 24, y, { stroke: C.ink, sw: 1.1 }));
    }
    for (const lv of levels) {
      const yLine = groundY - lv.z0 * pxPerM;
      parts.push(T(xInner + dir * 32, yLine + 7, lv.name, {
        size: 19, fill: C.ink2, anchor: dir < 0 ? 'end' : 'start', weight: lv.name === 'RDC' ? 700 : 400
      }));
    }
  };
  drawFacade('ouest', x0, -1);
  drawFacade('est', x1, 1);

  /* Réverbère */
  const lampX = x0 + 0.9 * pxPerM;
  parts.push(line(lampX, groundY, lampX, groundY - 4.4 * pxPerM, { stroke: C.ink2, sw: 3 }));
  parts.push(path(`M ${n(lampX)} ${n(groundY - 4.4 * pxPerM)} q 0 -22 22 -22`, { stroke: C.ink2, sw: 3 }));
  parts.push(rect(lampX + 14, groundY - 4.4 * pxPerM - 20, 15, 10, { fill: C.ink2 }));
  parts.push(poly([[lampX + 8, groundY - 4.4 * pxPerM - 10], [lampX + 34, groundY - 4.4 * pxPerM - 10],
    [lampX + 42, groundY - 4.4 * pxPerM + 10], [lampX, groundY - 4.4 * pxPerM + 10]], { fill: C.yellow, opacity: 0.28 }));

  /* Personnes */
  const people = 9;
  for (let i = 0; i < people; i++) {
    const px = x0 + ((i + 0.8) / people) * L * pxPerM;
    parts.push(person(px, groundY - 4, 1.72 * pxPerM, i === 3 || i === 7 ? C.red : C.ink2));
  }

  /* Cotes */
  const bandeLabels = s.bandes.map(b => (b.type.includes('terrasse') ? `${fr(b.largeur)} terrasse` : `${fr(b.largeur)} passage`)).join(' · ');
  parts.push(dimH(x0, x1, groundY + 88, `L = ${fr(L)} m entre façades`, { size: 25, above: false }));
  parts.push(T(540, groundY + 148, bandeLabels, { size: 21, fill: C.ink2, anchor: 'middle' }));
  parts.push(dimV(x0 - wall - 30, groundY - s.facades.ouest.hauteur_egout * pxPerM, groundY,
    `${fr(s.facades.ouest.hauteur_egout, 1)} m`, { size: 23, side: 'left' }));
  parts.push(dimV(x1 + wall + 30, groundY - s.facades.est.hauteur_egout * pxPerM, groundY,
    `${fr(s.facades.est.hauteur_egout, 1)} m`, { size: 23, side: 'right' }));

  /* Bloc H/L */
  parts.push(T(540, 236, `H/L ≈ ${fr(m.hl, 2)}`, { size: 84, weight: 700, anchor: 'middle' }));
  parts.push(T(540, 276, m.typeRue, { size: 29, fill: C.red, anchor: 'middle', weight: 700 }));
  const expl = `Ciel vu de l’axe ≈ ${fr(m.cielDeg, 0)}°. ${describeHL(m)}`;
  const lines = wrap(expl, 62);
  const boxH = 20 + lines.length * 30;
  parts.push(rect(150, 292, 780, boxH, { fill: C.card, stroke: C.light, sw: 1.4, rx: 8 }));
  lines.forEach((l, i) => {
    parts.push(T(540, 318 + i * 30, l, { size: 21, fill: C.ink2, anchor: 'middle' }));
  });

  const legend = legendRow(48, 1600, [
    { symbol: 'cut', label: 'coupe du mur' },
    { solid: C.zinc, stroke: C.ink, label: 'toit zinc (supposé)' },
    { solid: C.orange, label: 'terrasse' },
    { symbol: 'person', label: '1,70 m' }
  ], { size: 22 }) +
    T(48, 1646, 'Étages de 3,0 m et rez-de-chaussée de 3,2 à 5,0 m supposés', { size: 19, fill: C.ink2 }) +
    T(48, 1674, `Hauteurs à l’égout relevées sur photo · sol : ${s.sol}.`, { size: 19, fill: C.ink2 });

  return frame({
    numero: '2/6',
    categorie: 'PROFIL EN TRAVERS · COUPE D’URBANISTE AU 1/200',
    titre: 'Profil en travers de la rue',
    sousTitre: `${s.nom} · les deux façades qui se font face, coupées`,
    corps: parts.join(''),
    legende: legend,
    cartouche: `${s.nom.toUpperCase()} · PROFIL EN TRAVERS`,
    note: `${s.lieu} · largeur relevée sur photo, ± 1,5 m`,
    date: s.date
  });
}

/* ------------------------------------------------------------------ */
/* 3 · Front bâti déroulé                                              */
/* ------------------------------------------------------------------ */

function buildingElevation(x, baseY, b, pxPerM, opt = {}) {
  const { detail = true, small = false } = opt;
  const w = b.largeur * pxPerM;
  const hE = b.hauteur_egout * pxPerM;
  const hF = b.hauteur_faitage * pxPerM;
  const levels = levelsOf({ niveaux: b.niveaux }, b.hauteur_egout);
  const s2 = small ? 0.8 : 1;
  const parts = [];

  parts.push(rect(x, baseY - hE, w, hE, { fill: '#fffdf8', stroke: C.ink, sw: 2.2 }));
  parts.push(poly([
    [x, baseY - hE], [x + w * 0.07, baseY - hF], [x + w * 0.93, baseY - hF], [x + w, baseY - hE]
  ], { fill: C.zinc, stroke: C.ink, sw: 2 }));

  const bays = Math.max(1, Math.round(b.largeur / 2.4));
  const bayW = (w / bays);
  const floorLevels = levels.filter(l => l.name !== 'combles' && l.name !== 'RDC');
  const rdcZ = levels[0].z1;

  if (detail) {
    for (const lv of floorLevels) {
      const winH = Math.min(1.55, (lv.z1 - lv.z0) * 0.52) * pxPerM;
      const yTop = baseY - (lv.z0 + (lv.z1 - lv.z0) * 0.42) * pxPerM;
      const idx = floorLevels.indexOf(lv);
      for (let cIdx = 0; cIdx < bays; cIdx++) {
        const cx = x + (cIdx + 0.5) * bayW;
        const ww = Math.min(1.05, bayW / pxPerM * 0.44) * pxPerM;
        parts.push(rect(cx - ww / 2, yTop, ww, winH, { fill: '#e9eff2', stroke: C.ink, sw: 1.5 }));
        parts.push(line(cx, yTop, cx, yTop + winH, { stroke: C.ink, sw: 0.9 }));
        parts.push(line(cx - ww / 2, yTop + winH * 0.42, cx + ww / 2, yTop + winH * 0.42, { stroke: C.ink, sw: 0.8 }));
        if (idx === 0 || idx === 2) {
          parts.push(line(cx - ww / 2 - 3, yTop + winH, cx + ww / 2 + 3, yTop + winH, { stroke: C.ink, sw: 2.4 }));
          for (let k = 1; k < 6; k++) {
            const bx = cx - ww / 2 + (k / 6) * ww;
            parts.push(line(bx, yTop + winH, bx, yTop + winH + 9 * s2, { stroke: C.ink, sw: 0.9 }));
          }
        }
      }
    }
    if (/C/i.test(String(b.niveaux))) {
      const luc = Math.min(3, Math.max(2, Math.round(b.largeur / 3.2)));
      for (let i = 0; i < luc; i++) {
        const lx = x + ((i + 1) / (luc + 1)) * w;
        parts.push(rect(lx - 11, baseY - hF - 2, 22, 24, { fill: '#fffdf8', stroke: C.ink, sw: 1.5 }));
        parts.push(line(lx, baseY - hF + 10, lx, baseY - hF + 22, { stroke: C.ink, sw: 0.8 }));
      }
    }

    /* rez-de-chaussée commercial */
    const rdcH = rdcZ * pxPerM;
    const rdcTop = baseY - rdcH;
    parts.push(rect(x + 1.5, rdcTop, w - 3, rdcH - 1.5, { fill: '#2f2f31', stroke: C.ink, sw: 1.4 }));
    const glassTop = rdcTop + Math.min(18, rdcH * 0.16);
    parts.push(rect(x + 4, glassTop, w - 8, Math.min(26, rdcH * 0.3), { fill: '#6d7b84', opacity: 0.85 }));
    for (let mx = x + 4 + 26; mx < x + w - 6; mx += 26) {
      parts.push(line(mx, glassTop, mx, glassTop + Math.min(26, rdcH * 0.3), { stroke: '#2f2f31', sw: 1.4 }));
    }
    /* auvent rayé */
    for (let ax = x + 2; ax < x + w - 4; ax += 18) {
      const wSegment = Math.min(9, x + w - 4 - ax);
      parts.push(rect(ax, rdcTop - 2, wSegment, 10, { fill: ax % 36 < 18 ? C.ink2 : C.card, opacity: 0.9 }));
    }
    parts.push(line(x + 1.5, rdcTop + 10, x + w - 1.5, rdcTop + 10, { stroke: C.ink, sw: 1.2 }));
  }

  if (!small) {
    parts.push(T(x + w / 2, baseY - hF - 12, `${fr(b.hauteur_egout, 1)}${b.suppose ? ' ?' : ''}`, {
      size: 20, fill: C.red, anchor: 'middle', weight: 700
    }));
    parts.push(T(x + w / 2, baseY + 30, b.niveaux, { size: 21, anchor: 'middle', weight: 700 }));
    parts.push(T(x + w / 2, baseY + 56, b.nom, { size: 19, fill: C.ink2, anchor: 'middle' }));
  }
  return parts.join('');
}

export function svgFronts(survey) {
  const s = normalizeSurvey(survey);
  const m = computeMetrics(s);
  const west = s.facades.ouest;
  const east = s.facades.est;
  const baseY = 890;
  const pxPerM = Math.min(950 / west.largeur_totale, 566 / west.hauteur_faitage);
  const totalW = west.largeur_totale * pxPerM;
  let x = 540 - totalW / 2;

  const parts = [];
  parts.push(T(48, 186, 'FRONT OUEST · élévation déroulée, redressée à plat', { size: 20, fill: C.grey }));

  const gutter = [];
  for (const b of west.immeubles) {
    parts.push(buildingElevation(x, baseY, b, pxPerM));
    gutter.push([x, baseY - b.hauteur_egout * pxPerM], [x + b.largeur * pxPerM, baseY - b.hauteur_egout * pxPerM]);
    x += b.largeur * pxPerM;
  }
  parts.push(poly(gutter, { stroke: C.red, sw: 4, close: false }));
  parts.push(T(48, baseY - west.hauteur_faitage * pxPerM - 26, 'égout de toit', { size: 20, fill: C.red, weight: 700 }));

  parts.push(line(48, baseY, 1032, baseY, { stroke: C.ink, sw: 2.6 }));
  for (let i = 0; i < 40; i++) parts.push(line(64 + i * 24, baseY, 54 + i * 24, baseY + 12, { stroke: C.grey, sw: 1 }));
  parts.push(T(48, baseY + 30, 'S', { size: 22, fill: C.ink2, weight: 700 }));
  parts.push(T(1032, baseY + 30, 'N', { size: 22, fill: C.ink2, anchor: 'end', weight: 700 }));

  /* front est, plus petit */
  const baseE = 1428;
  const pxE = pxPerM * 0.5;
  const totalE = east.largeur_totale * pxE;
  let xe = 540 - totalE / 2;
  parts.push(T(48, 1120, 'FRONT EST · vu de biais, lecture moins sûre', { size: 20, fill: C.grey }));
  const gutterE = [];
  for (const b of east.immeubles) {
    parts.push(buildingElevation(xe, baseE, b, pxE, { small: true }));
    gutterE.push([xe, baseE - b.hauteur_egout * pxE], [xe + b.largeur * pxE, baseE - b.hauteur_egout * pxE]);
    xe += b.largeur * pxE;
  }
  parts.push(poly(gutterE, { stroke: C.red, sw: 3, close: false }));
  parts.push(line(48, baseE, 1032, baseE, { stroke: C.ink, sw: 2.2 }));
  for (let i = 0; i < 40; i++) parts.push(line(64 + i * 24, baseE, 54 + i * 24, baseE + 10, { stroke: C.grey, sw: 1 }));
  parts.push(T(48, baseE + 30, 'S', { size: 20, fill: C.ink2, weight: 700 }));
  parts.push(T(1032, baseE + 30, 'N', { size: 20, fill: C.ink2, anchor: 'end', weight: 700 }));
  parts.push(T(540, baseE + 66, 'hauteurs et découpes est supposées — à vérifier sur place', {
    size: 19, fill: C.ink2, anchor: 'middle', italic: true
  }));

  parts.push(T(1032, 186, `H/L ≈ ${fr(m.hl, 2)}`, { size: 22, fill: C.ink2, anchor: 'end', weight: 700 }));

  const legend = legendRow(48, 1548, [
    { dash: C.red, label: 'égout de toit, coté en m' },
    { solid: C.zinc, stroke: C.ink, label: 'combles' },
    { solid: '#2f2f31', label: 'rez-de-chaussée commercial' }
  ], { size: 21, gap: 22 }) +
    T(48, 1592, 'R+5+C = rez-de-chaussée + 5 étages + combles', { size: 19, fill: C.ink2 }) +
    T(48, 1620, 'étages de 3,0 m supposés · enseignes non dessinées', { size: 19, fill: C.ink2 });

  return frame({
    numero: '3/6',
    categorie: 'FRONT BÂTI · ÉLÉVATION DÉROULÉE',
    titre: 'Front bâti déroulé',
    sousTitre: `${s.nom} · immeuble par immeuble, du sol à la corniche`,
    corps: parts.join(''),
    legende: legend,
    cartouche: `${s.nom.toUpperCase()} · FRONT OUEST`,
    note: 'largeurs estimées · « ? » signale une hauteur supposée',
    date: s.date
  });
}

/* ------------------------------------------------------------------ */
/* 1 · Plan des usages                                                 */
/* ------------------------------------------------------------------ */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function scatterPeople(count, zones, rand) {
  const points = [];
  const totalArea = zones.reduce((t, z) => t + z.w * z.h, 0);
  if (!totalArea) return points;
  let guard = 0;
  while (points.length < count && guard < count * 80) {
    guard++;
    let pick = rand() * totalArea;
    let zone = zones[0];
    for (const z of zones) {
      if (pick <= z.w * z.h) { zone = z; break; }
      pick -= z.w * z.h;
    }
    const px = zone.x + rand() * zone.w;
    const py = zone.y + rand() * zone.h;
    if (points.every(p => Math.hypot(p.x - px, p.y - py) > 12)) points.push({ x: px, y: py });
  }
  return points;
}

export function svgUsages(survey) {
  const s = normalizeSurvey(survey);
  const m = computeMetrics(s);
  const L = s.largeur_facades;
  const len = s.longueur_relevee;
  const top = 196;
  const bottom = 1396;
  const pxPerM = Math.min((bottom - top) / len, 940 / (L + 9));
  const streetW = L * pxPerM;
  const blockW = 4.5 * pxPerM;
  const bx = 540 - (streetW + blockW * 2) / 2;
  const x0 = bx + blockW;
  const x1 = x0 + streetW;
  const yTop = top;
  const yBot = top + len * pxPerM;
  const parts = [];

  const buildingBlock = (xLeft, side) => {
    const f = s.facades[side];
    const out = [rect(xLeft, yTop, blockW, yBot - yTop, { fill: C.card, stroke: C.ink, sw: 2.4 })];
    let y = yTop;
    for (const b of f.immeubles) {
      const hh = (b.largeur / f.largeur_totale) * (yBot - yTop);
      if (y > yTop + 1) out.push(line(xLeft, y, xLeft + blockW, y, { stroke: C.ink, sw: 1.6 }));
      const cx = xLeft + blockW / 2;
      out.push(T(cx, y + hh / 2 - 2, String(b.rdc || f.rdc).toUpperCase(), { size: 22, anchor: 'middle', weight: 700 }));
      out.push(T(cx, y + hh / 2 + 22, b.niveaux, { size: 17, anchor: 'middle', fill: C.ink2 }));
      y += hh;
    }
    return out.join('');
  };

  parts.push(buildingBlock(bx, 'ouest'));
  parts.push(buildingBlock(x0 + streetW, 'est'));

  parts.push(rect(x0, yTop, streetW, yBot - yTop, { fill: '#e4ded1' }));
  parts.push(rect(x0, yTop, streetW, yBot - yTop, { fill: 'none', stroke: C.ink, sw: 2.4 }));

  let cursor = x0;
  const zones = [];
  for (const b of s.bandes) {
    const w = b.largeur * pxPerM;
    if (b.type.includes('terrasse')) {
      parts.push(rect(cursor, yTop, w, yBot - yTop, { fill: C.orange, opacity: 0.92 }));
      zones.push({ x: cursor + 4, y: yTop + 6, w: Math.max(0, w - 8), h: yBot - yTop - 86 });
    } else if (b.type.includes('passage') || b.type.includes('piéton')) {
      zones.push({ x: cursor + 6, y: yTop + 6, w: Math.max(0, w - 12), h: yBot - yTop - 86 });
    }
    cursor += w;
  }

  parts.push(rect(x0, yBot - 64, streetW, 58, { fill: C.blue, opacity: 0.9 }));
  parts.push(T((x0 + x1) / 2, yBot - 26, 'desserte · livraisons', { size: 22, fill: '#fff', anchor: 'middle', weight: 700 }));
  parts.push(rect(x0 + streetW * 0.23, yTop + 70, streetW * 0.32, yBot - yTop - 170, {
    fill: 'none', stroke: C.blue, sw: 2.4, dash: '10 8'
  }));
  parts.push(`<g transform="rotate(-90 ${n(x0 + streetW * 0.39)} ${n((yTop + yBot) / 2)})">` +
    T(x0 + streetW * 0.39, (yTop + yBot) / 2, 'couloir de livraison (supposé)', {
      size: 19, fill: C.blue, anchor: 'middle'
    }) + '</g>');

  const count = Math.min(170, Math.max(0, Math.round(s.gens.en_plan)));
  const rand = mulberry32(20261115);
  for (const p of scatterPeople(count, zones, rand)) {
    parts.push(circle(p.x, p.y, 6, { fill: '#fffdf8', stroke: C.ink, sw: 1.8 }));
  }
  parts.push(T(x0 + 10, yBot - 78, `${Math.round(s.gens.vus)} vues · ${Math.round(s.gens.en_plan)} placées`, {
    size: 17, fill: C.ink2, weight: 600
  }));

  const bollards = Math.min(12, Math.round(s.mobilier.bornes));
  for (let i = 0; i < bollards; i++) {
    const y = yTop + ((i + 0.5) / bollards) * (yBot - yTop - 110);
    parts.push(rect(x0 + 5, y, 7, 7, { fill: C.ink }));
  }
  for (let i = 0; i < Math.min(4, Math.round(s.mobilier.reverberes)); i++) {
    const y = yTop + ((i + 0.6) / 4) * (yBot - yTop - 110);
    parts.push(circle(x0 + 20, y, 7, { fill: C.yellow, stroke: C.ink, sw: 1.6 }));
  }
  if (s.mobilier.poubelles >= 1) {
    parts.push(rect(x1 - 30, yBot - 120, 15, 15, { fill: C.green, stroke: C.ink, sw: 1.4 }));
    parts.push(T(x1 - 38, yBot - 106, 'bac', { size: 16, anchor: 'end', fill: C.ink2 }));
  }

  parts.push(northArrow(x1 + blockW + 34, yTop + 40, s.axe_deg, 26));
  parts.push(scaleBar(x0 + 4, yBot + 42, pxPerM, { maxMeters: 10, label: 'm · 1/200' }));

  /* Barre de répartition */
  const barY = 1500;
  let bxCur = 48;
  const partsBar = [];
  const shares = [
    { label: `terrasses ${fr(m.partTerrasses, 0)} %`, part: m.partTerrasses, fill: C.orange, color: '#fff' },
    { label: `passage libre ${fr(m.partPassage, 0)} %`, part: m.partPassage, fill: '#cfc8b9', color: C.ink },
    { label: `reste ${fr(m.partAutre, 0)} %`, part: m.partAutre, fill: C.ink2, color: '#fff' }
  ].filter(x => x.part > 0.6);
  for (const sh of shares) {
    const w = (sh.part / 100) * 984;
    partsBar.push(rect(bxCur, barY, w, 44, { fill: sh.fill, stroke: C.paper, sw: 2 }));
    partsBar.push(T(bxCur + w / 2, barY + 30, sh.label, { size: 21, fill: sh.color, anchor: 'middle', weight: 700 }));
    bxCur += w;
  }
  parts.push(partsBar.join(''));
  parts.push(T(48, barY + 74, `Largeur entre façades : ${fr(L)} m · longueur relevée : ${fr(len, 0)} m`, {
    size: 22, fill: C.ink2
  }) + T(48, barY + 100, `Bandes : ${s.bandes.map(b => fr(b.largeur) + ' m').join(' · ')}`, {
    size: 19, fill: C.grey
  }));

  const legend =
    legendRow(48, 1636, [
      { solid: C.orange, label: 'terrasse' },
      { solid: '#cfc8b9', label: 'passage piéton libre' },
      { solid: C.blue, label: 'livraisons · accès' }
    ], { size: 21, gap: 22 }) +
    legendRow(48, 1676, [
      { dot: '#fffdf8', stroke: C.ink, label: 'personne' },
      { solid: C.ink, label: 'borne' },
      { solid: C.green, label: 'bac' },
      { symbol: 'tree', label: 'arbre' }
    ], { size: 20, gap: 30 });

  return frame({
    numero: '1/6',
    categorie: 'PLAN DES USAGES · 1/200',
    titre: 'Qui occupe quoi dans la rue',
    sousTitre: `${s.nom} · ${Math.round(s.gens.vus)} personnes vues, ${Math.round(s.gens.en_plan)} placées, ${Math.round(s.mobilier.bornes)} bornes`,
    corps: parts.join(''),
    legende: legend,
    cartouche: `${s.nom.toUpperCase()} · USAGES`,
    note: `${s.lieu} · occupations relevées sur photo, report approximatif`,
    date: s.date
  });
}


/* ------------------------------------------------------------------ */
/* 4 · Axonométrie                                                     */
/* ------------------------------------------------------------------ */

/*
   Projection oblique alignée sur la rue : la rue s’enfonce vers le haut
   à droite (30°), la hauteur monte verticalement. On dessine du plus
   lointain au plus proche pour que les volumes se recouvrent juste.
*/
const AXO_ANG = 30 * Math.PI / 180;

function makeAxo(px, cx, groundY, L) {
  const ca = Math.cos(AXO_ANG);
  const sa = Math.sin(AXO_ANG);
  return (a, c, z) => ({
    x: cx + (c - L / 2) * px + a * ca * px,
    y: groundY - a * sa * px - z * px
  });
}

function axoQuad(project, pts, style) {
  return poly(pts.map(p => {
    const q = project(p[0], p[1], p[2]);
    return [q.x, q.y];
  }), style);
}

function axoWindows(project, a0, a1, c, z0, z1, bays, floors) {
  const out = [];
  const bw = (a1 - a0) / Math.max(1, bays);
  const fh = (z1 - z0) / Math.max(1, floors);
  for (let f = 1; f < floors - 0.2; f++) {
    const wz0 = z0 + f * fh + fh * 0.28;
    const wz1 = wz0 + fh * 0.46;
    for (let b = 0; b < bays; b++) {
      const wa0 = a0 + bw * (b + 0.24);
      const wa1 = a0 + bw * (b + 0.76);
      out.push(axoQuad(project, [[wa0, c, wz0], [wa1, c, wz0], [wa1, c, wz1], [wa0, c, wz1]], {
        fill: '#dbe4ea', stroke: C.ink2, sw: 0.8
      }));
    }
  }
  return out.join('');
}

export function svgAxo(survey) {
  const s = normalizeSurvey(survey);
  const L = s.largeur_facades;
  const len = s.longueur_relevee;
  const depth = 5.5;
  const maxH = Math.max(s.facades.ouest.hauteur_faitage, s.facades.est.hauteur_faitage);
  const px = Math.min(900 / (len * Math.cos(AXO_ANG) + L + 2), 1190 / (len * Math.sin(AXO_ANG) + maxH + 3));
  const projectBase = makeAxo(px, 0, 0, L);

  const corners = [
    [0, 0, 0], [len, 0, 0], [0, L, 0], [len, L, 0],
    [0, -depth, 0], [len, -depth, 0], [0, L + depth, 0], [len, L + depth, 0],
    [0, 0, maxH], [len, 0, maxH], [0, L, maxH], [len, L, maxH]
  ].map(c => projectBase(c[0], c[1], c[2]));
  const minX = Math.min(...corners.map(p => p.x));
  const maxX = Math.max(...corners.map(p => p.x));
  const minY = Math.min(...corners.map(p => p.y));
  const maxY = Math.max(...corners.map(p => p.y));
  const cx = 540 - (minX + maxX) / 2;
  const groundY = 330 - minY + (1190 - (maxY - minY)) * 0.5;
  const P = makeAxo(px, cx, groundY, L);

  const parts = [];

  /* Sol de la rue */
  parts.push(axoQuad(P, [[0, 0, 0], [len, 0, 0], [len, L, 0], [0, L, 0]], { fill: '#e8e2d5', stroke: C.ink, sw: 1.8 }));
  for (let a = 0; a <= len; a += 1.4) {
    parts.push(axoQuad(P, [[a, 0, 0], [a, L, 0]], { stroke: '#d2cbbc', sw: 0.8 }));
  }
  for (let c = 0; c <= L; c += 1.4) {
    parts.push(axoQuad(P, [[0, c, 0], [len, c, 0]], { stroke: '#d2cbbc', sw: 0.8 }));
  }

  /* Terrasses */
  let cCur = 0;
  for (const b of s.bandes) {
    if (b.type.includes('terrasse')) {
      parts.push(axoQuad(P, [[0, cCur + 0.05, 0.04], [len, cCur + 0.05, 0.04],
        [len, cCur + b.largeur - 0.05, 0.04], [0, cCur + b.largeur - 0.05, 0.04]], {
        fill: C.orange, opacity: 0.9
      }));
    }
    cCur += b.largeur;
  }

  /* Volumes, du plus lointain au plus proche */
  const drawBlock = (side, cInner, cOuter, dirIn) => {
    const f = s.facades[side];
    const segs = [];
    let a = 0;
    for (const b of f.immeubles) {
      segs.push({ a0: a, a1: a + b.largeur, b });
      a += b.largeur;
    }
    for (let i = segs.length - 1; i >= 0; i--) {
      const { a0, a1, b } = segs[i];
      const zE = b.hauteur_egout;
      const zF = b.hauteur_faitage;
      const roofIn = cInner + dirIn * 1.1;

      /* massif du rez-de-chaussée au toit */
      parts.push(axoQuad(P, [[a0, cIn(cOuter), 0], [a1, cOuter, 0], [a1, cOuter, zE], [a0, cOuter, zE]], {
        fill: '#ffffff', stroke: C.ink, sw: 1.6
      }));

      /* façade sur rue */
      parts.push(axoQuad(P, [[a0, cInner, 0], [a1, cInner, 0], [a1, cInner, zE], [a0, cInner, zE]], {
        fill: '#fbf8f1', stroke: C.ink, sw: 1.8
      }));
      const bays = Math.max(2, Math.round(b.largeur / 2.3));
      const floors = Math.max(2, (String(b.niveaux).match(/R\+\s*(\d)/) || [, '4'])[1] * 1 + 1);
      parts.push(axoWindows(P, a0, a1, cInner, 0, zE, bays, floors));

      /* rez-de-chaussée commercial */
      parts.push(axoQuad(P, [[a0 + 0.1, cInner, 0], [a1 - 0.1, cInner, 0], [a1 - 0.1, cInner, 3.6], [a0 + 0.1, cInner, 3.6]], {
        fill: '#333336', stroke: 'none'
      }));
      parts.push(axoQuad(P, [[a0 + 0.2, cInner, 2.5], [a1 - 0.2, cInner, 2.5], [a1 - 0.2, cInner, 3.4], [a0 + 0.2, cInner, 3.4]], {
        fill: '#6d7b84', opacity: 0.8
      }));

      /* pignon côté proche */
      parts.push(axoQuad(P, [[a1, cOuter, 0], [a1, cInner, 0], [a1, cInner, zE], [a1, cOuter, zE]], {
        fill: '#f0ebdf', stroke: C.ink, sw: 1.4
      }));

      /* toit : brisis côté rue + faîtage + arête arrière */
      parts.push(axoQuad(P, [[a0, cInner, zE], [a1, cInner, zE], [a1, roofIn, zF], [a0, roofIn, zF]], {
        fill: C.zinc, stroke: C.ink, sw: 1.4
      }));
      parts.push(axoQuad(P, [[a0, roofIn, zF], [a1, roofIn, zF], [a1, cOuter, zF - 0.4], [a0, cOuter, zF - 0.4]], {
        fill: '#dde1e4', stroke: C.ink, sw: 1.2
      }));
      parts.push(axoQuad(P, [[a1, cInner, zE], [a1, roofIn, zF], [a1, cOuter, zF - 0.4], [a1, cOuter, zE]], {
        fill: '#c2c8cd', stroke: C.ink, sw: 1.2
      }));

      /* souche de cheminée */
      const chA = a0 + b.largeur * 0.62;
      parts.push(axoQuad(P, [[chA, roofIn - 0.5, zF], [chA + 0.8, roofIn - 0.5, zF], [chA + 0.8, roofIn - 0.5, zF + 1.1], [chA, roofIn - 0.5, zF + 1.1]], {
        fill: '#c9bda9', stroke: C.ink2, sw: 0.9
      }));
    }
  };
  /* petites aides de lisibilité : cIn() borne la profondeur côté rue */
  function cIn(v) { return v; }

  drawBlock('ouest', 0, -depth, -1);
  drawBlock('est', L, L + depth, 1);

  /* Passants et arbres */
  const rand = mulberry32(4242);
  for (let i = 0; i < 40; i++) {
    const a = rand() * len;
    const c = rand() * L;
    const base = P(a, c, 0);
    const top = P(a, c, 1.72);
    parts.push(line(base.x, base.y, top.x, top.y, { stroke: i % 5 === 0 ? C.red : C.ink2, sw: 3, cap: 'round' }));
    parts.push(circle(top.x, top.y - 1.5, 2.4, { fill: C.ink2 }));
  }
  for (const t of [0.16, 0.48, 0.8]) {
    const a = len * t;
    const c = L * 0.5;
    const base = P(a, c, 0);
    const top = P(a, c, 4.6);
    parts.push(line(base.x, base.y, top.x, top.y, { stroke: '#7a5c3c', sw: 3 }));
    parts.push(circle(top.x, top.y - 8, 15, { fill: C.greenPale, stroke: C.green, sw: 1.6 }));
    parts.push(circle(top.x - 9, top.y - 16, 10, { fill: C.greenPale, stroke: C.green, sw: 1.1 }));
    parts.push(circle(top.x + 9, top.y - 14, 10, { fill: C.greenPale, stroke: C.green, sw: 1.1 }));
  }

  /* Repères numérotés */
  const badges = [
    { a: len * 0.15, c: 0.2, z: 9, n: 1 },
    { a: len * 0.2, c: L - 0.2, z: 9, n: 2 },
    { a: len * 0.55, c: L * 0.5, z: 1.5, n: 3 },
    { a: len * 0.72, c: L * 0.8, z: 0.6, n: 4 },
    { a: len * 0.42, c: -1.5, z: s.facades.ouest.hauteur_faitage + 1.2, n: 5 },
    { a: len * 0.9, c: L * 0.3, z: 0.6, n: 6 }
  ];
  for (const b of badges) {
    const q = P(b.a, b.c, b.z);
    parts.push(circle(q.x, q.y, 17, { fill: C.ink }));
    parts.push(T(q.x, q.y + 7, String(b.n), { size: 21, fill: '#fff', anchor: 'middle', weight: 700 }));
  }

  parts.push(scaleBar(48, 1568, px, { maxMeters: 10, label: 'm' }));
  parts.push(northArrow(1000, 1568, s.axe_deg, 28));
  parts.push(dimH(P(0, 0, 0).x, P(0, L, 0).x, P(0, 0, 0).y + 26, `${fr(L)} m`, { size: 19, above: false }));

  const legend =
    legendRow(48, 1612, [
      { solid: '#fbf8f1', stroke: C.ink, label: 'façades' },
      { solid: C.zinc, stroke: C.ink, label: 'toits zinc' },
      { solid: C.orange, label: 'terrasses' }
    ], { size: 19, gap: 26 }) +
    legendRow(48, 1650, [
      { dot: C.ink2, label: 'passants' },
      { symbol: 'tree', label: 'arbre' },
      { solid: '#333336', label: 'RDC commercial' }
    ], { size: 19, gap: 26 });

  return frame({
    numero: '4/6',
    categorie: 'AXONOMÉTRIE · VOLUMES',
    titre: 'La rue en volume',
    sousTitre: `${s.nom} · volumes calculés depuis le relevé, profondeur d’îlot forfaitaire`,
    corps: parts.join(''),
    legende: legend,
    cartouche: `${s.nom.toUpperCase()} · AXONOMÉTRIE`,
    note: '1 Pointe St-Eustache · 2 Esplanade · 3 plateau · 4 terrasses · 5 toits · 6 mobilier',
    date: s.date
  });
}

/* ------------------------------------------------------------------ */
/* 5 · Étude d'ombre                                                   */
/* ------------------------------------------------------------------ */

function formatDuration(hours) {
  const h = Math.max(0, hours);
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  if (mm === 60) return `${hh + 1} h 00`;
  return `${hh} h ${String(mm).padStart(2, '0')}`;
}

/* Une ligne par heure légale entière, de 6 h à 21 h. */
function hourRows(study, from = 6, to = 21) {
  const rows = [];
  for (let hour = from; hour <= to; hour++) {
    let best = study.series[0];
    for (const point of study.series) {
      if (Math.abs(point.legal - hour) < Math.abs(best.legal - hour)) best = point;
    }
    rows.push({ ...best, legal: hour });
  }
  return rows;
}

export function svgOmbres(survey) {
  const s = normalizeSurvey(survey);
  const { summer, winter } = daylightSummary(s);
  const L = s.largeur_facades;
  const hMax = Math.max(s.facades.ouest.hauteur_faitage, s.facades.est.hauteur_faitage);
  const groundY = 830;
  const pxPerM = Math.min((groundY - 300) / (hMax + 1), 780 / (L + 4.6));
  const x0 = 500 - (L * pxPerM) / 2;
  const x1 = x0 + L * pxPerM;
  const wall = 26;
  const parts = [];

  parts.push(T(48, 184, 'COUPE · course du soleil, 21 juin et 21 décembre', { size: 20, fill: C.grey }));
  parts.push(rect(x0 - wall, 268, L * pxPerM + wall * 2, groundY - 268, { fill: '#111114' }));
  parts.push(rect(40, groundY, 1000, 24, { fill: '#3a3a3c' }));

  const hO = s.facades.ouest.hauteur_egout;
  const hE = s.facades.est.hauteur_egout;
  parts.push(rect(x0 - wall, groundY - hO * pxPerM, wall, hO * pxPerM, { fill: '#2e2e31', stroke: '#e8e2d6', sw: 1 }));
  parts.push(rect(x1, groundY - hE * pxPerM, wall, hE * pxPerM, { fill: '#2e2e31', stroke: '#e8e2d6', sw: 1 }));
  parts.push(T(x0 - wall - 9, groundY - hO * pxPerM - 10, `égout ${fr(hO, 1)} m*`, { size: 19, fill: '#f7f3ea', anchor: 'end' }));
  parts.push(T(x1 + wall + 9, groundY - hE * pxPerM - 10, `égout ${fr(hE, 1)} m*`, { size: 19, fill: '#f7f3ea' }));

  const ray = (day, color, fromHour = 7, toHour = 20) => {
    const out = [];
    const labelXs = [];
    for (let hour = fromHour; hour <= toHour; hour += 1) {
      const sun = sunPosition({ day, solarHour: hour, latitude: s.latitude });
      if (sun.altitude <= 2.5) continue;
      const c = Math.sin((sun.azimuth - s.axe_deg) * Math.PI / 180);
      if (Math.abs(c) < 0.02) continue;
      const lenM = (c >= 0 ? hE : hO) / Math.tan(sun.altitude * Math.PI / 180);
      if (lenM > L) continue;
      const fromX = c >= 0 ? x1 : x0;
      const fromY = groundY - (c >= 0 ? hE : hO) * pxPerM;
      const toX = c >= 0 ? x1 - lenM * pxPerM : x0 + lenM * pxPerM;
      out.push(line(fromX, fromY, toX, groundY, { stroke: color, sw: 1.6, opacity: 0.92 }));
      out.push(circle(toX, groundY, 3, { fill: color }));
      /* une étiquette seulement si la place est libre, décalée une fois sur deux */
      if (labelXs.every(x => Math.abs(x - toX) > 46)) {
        labelXs.push(toX);
        out.push(T(toX + (c >= 0 ? -7 : 7), groundY - 20 - (hour % 2) * 18, `${hour}h`, {
          size: 15, fill: color, anchor: c >= 0 ? 'end' : 'start', weight: 700
        }));
      }
    }
    return out.join('');
  };
  parts.push(ray(172, C.orange));
  parts.push(ray(355, C.blue));
  parts.push(dimH(x0, x1, groundY + 46, `${fr(L)} m entre façades`, { size: 20, above: false }));

  /* Graphiques horaires : une barre par heure, jaune = sol éclairé */
  const charts = [
    { study: summer, y: 930, color: C.orange, label: '21 juin' },
    { study: winter, y: 1262, color: C.blue, label: '21 décembre' }
  ];
  for (const chart of charts) {
    const rows = hourRows(chart.study, 6, 21);
    const chartX = 252;
    const chartW = 480;
    const rowH = 16;
    const top = chart.y + 46;
    const boxH = 46 + rows.length * rowH + 16;
    parts.push(rect(160, chart.y - 4, 850, boxH, { fill: '#141416' }));
    const range = chart.study.firstLegal != null
      ? `${formatHour(chart.study.firstLegal)} → ${formatHour(chart.study.lastLegal)}`
      : 'aucun soleil direct';
    parts.push(T(176, chart.y + 26, `${chart.label} · ${range}`, { size: 20, fill: chart.color, weight: 700 }));
    const heures = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const y = top + i * rowH;
      parts.push(line(chartX, y, chartX + chartW, y, { stroke: '#2c2c30', sw: 1 }));
      const label = formatHour(r.legal);
      if (!heures.includes(label)) {
        heures.push(label);
        parts.push(T(chartX - 12, y + 5, label, {
          size: 15, fill: r.altitude > 0 ? '#f0ece3' : '#8a8a8e', anchor: 'end'
        }));
      }
      if (r.fraction > 0.005) {
        const c = Math.sin((r.azimuth - s.axe_deg) * Math.PI / 180);
        const w = Math.max(2, Math.min(1, r.fraction) * chartW);
        const x = c >= 0 ? chartX : chartX + chartW - w;
        parts.push(rect(x, y - 6, w, 12, { fill: C.yellow }));
      }
    }
    parts.push(T(chartX + chartW + 26, top + 34, formatDuration(chart.study.anyHours), {
      size: 38, fill: C.yellow, weight: 700
    }));
    parts.push(T(chartX + chartW + 26, top + 62, 'de soleil direct au sol', { size: 17, fill: '#f0ece3' }));
    parts.push(T(chartX + chartW + 26, top + 104, `${formatDuration(chart.study.meanHours)} en moyenne`, {
      size: 16, fill: '#b9b6ae'
    }));
    parts.push(T(chartX + chartW + 26, top + 126, 'sur la largeur', { size: 16, fill: '#b9b6ae' }));
  }

  const legend =
    legendRow(48, 1620, [
      { solid: C.orange, label: '21 juin' },
      { solid: C.blue, label: '21 décembre' },
      { solid: C.yellow, label: 'sol éclairé' }
    ], { size: 21, gap: 24 }) +
    T(48, 1668, `Axe de la rue pris à ${fr(s.axe_deg, 0)}° du nord (hypothèse) · latitude ${fr(s.latitude, 2)}° · heure légale · * hauteurs supposées`, {
      size: 18, fill: C.ink2
    });

  return frame({
    numero: '5/6',
    categorie: 'ÉTUDE D’OMBRE · 21 JUIN ET 21 DÉCEMBRE',
    titre: 'L’ombre dans la rue, heure par heure',
    sousTitre: `${s.nom} · combien d’heures de soleil direct reçoit le sol`,
    corps: parts.join(''),
    legende: legend,
    cartouche: `${s.nom.toUpperCase()} · ENSEILLEMENT DU SOL`,
    note: 'calcul astronomique réel (déclinaison + équation du temps) · rue supposée longue et droite',
    date: s.date
  });
}


/* ------------------------------------------------------------------ */
/* 6 · Demain (avant / après)                                          */
/* ------------------------------------------------------------------ */

function miniProfil(s, o) {
  const { x, y, w, h, apres, scenario } = o;
  const L = s.largeur_facades;
  const hMax = Math.max(s.facades.ouest.hauteur_faitage, s.facades.est.hauteur_faitage);
  const px = Math.min(w / (L + 4.4), (h - 66) / (hMax + 1));
  const gx = x + (w - L * px) / 2;
  const gy = y + h - 46;
  const wall = 16;
  const parts = [rect(x, y, w, h, { fill: C.card, stroke: C.light, sw: 1.4 })];

  parts.push(rect(gx - wall, y + 34, L * px + wall * 2, gy - y - 34, { fill: '#e6eff5' }));
  parts.push(rect(gx - wall, gy, L * px + wall * 2, 12, { fill: 'url(#paves)' }));
  for (const [side, xInner, dir] of [['ouest', gx, -1], ['est', gx + L * px, 1]]) {
    const f = s.facades[side];
    parts.push(rect(dir < 0 ? xInner - wall : xInner, gy - f.hauteur_egout * px, wall, f.hauteur_egout * px, {
      fill: 'url(#hatch)', stroke: C.ink, sw: 1.3
    }));
    parts.push(poly([
      [xInner, gy - f.hauteur_egout * px],
      [xInner + dir * 1.5 * px, gy - f.hauteur_faitage * px],
      [xInner + dir * 2.0 * px, gy - f.hauteur_faitage * px],
      [xInner + dir * 2.0 * px, gy - f.hauteur_egout * px]
    ], { fill: C.zinc, stroke: C.ink, sw: 1 }));
    for (let z = 3.2; z < f.hauteur_egout; z += 3) {
      parts.push(line(xInner, gy - z * px, xInner + dir * 9, gy - z * px, { stroke: C.ink2, sw: 0.7 }));
    }
  }

  let cursor = 0;
  for (const b of s.bandes) {
    const bxp = gx + cursor * px;
    if (b.type.includes('terrasse')) parts.push(rect(bxp, gy - 4, b.largeur * px, 4, { fill: C.orange }));
    cursor += b.largeur;
  }

  if (apres) {
    for (const side of scenario.sides) {
      if (!side.trees) continue;
      const baseX = side.side === 'ouest'
        ? gx + 0.75 * px
        : gx + L * px - 0.75 * px;
      parts.push(treeElevation(baseX, gy, 5.4, px));
      parts.push(rect(baseX - 0.75 * px, gy - 2, 1.5 * px, 5, { fill: C.greenPale }));
    }
    parts.push(rect(gx, gy + 1, L * px, 4, { fill: '#c9b98a', opacity: 0.7 }));
  } else {
    for (let i = 0; i < 7; i++) {
      parts.push(person(gx + (i + 0.8) * L * px / 7, gy - 2, 1.7 * px, C.ink2));
    }
  }

  parts.push(T(x + 14, y + 28, apres ? 'APRÈS · profil' : 'AVANT · profil', {
    size: 19, fill: apres ? C.green : C.grey, weight: 700, letter: 1
  }));
  parts.push(T(x + w - 14, y + 28, apres ? 'fosses 1,50 × 1,50 m' : 'ni arbre ni pleine terre', {
    size: 16, fill: C.ink2, anchor: 'end'
  }));
  parts.push(dimH(gx, gx + L * px, gy + 28, `${fr(L)} m`, { size: 18, above: false, bg: C.card }));
  return parts.join('');
}

function miniPlan(s, o) {
  const { x, y, w, h, apres, scenario } = o;
  const L = s.largeur_facades;
  const len = s.longueur_relevee;
  const px = Math.min((h - 70) / len, (w - 24) / L);
  const sx = x + (w - L * px) / 2;
  const sy = y + 34;
  const parts = [rect(x, y, w, h, { fill: C.card, stroke: C.light, sw: 1.4 })];

  const band = (bxp, bw, fill) => rect(bxp, sy, bw, len * px, { fill });
  parts.push(rect(sx, sy, L * px, len * px, { fill: '#ece6d8', stroke: C.ink, sw: 1.4 }));
  let cursor = 0;
  for (const b of s.bandes) {
    if (b.type.includes('terrasse')) parts.push(band(sx + cursor * px, b.largeur * px, C.orange));
    else if (b.type.includes('passage')) parts.push(band(sx + cursor * px, b.largeur * px, '#dcd5c6'));
    cursor += b.largeur;
  }

  if (apres) {
    for (const tree of scenario.placeTrees) {
      const tx = tree.side === 'ouest' ? sx + 0.75 * px : sx + L * px - 0.75 * px;
      const ty = sy + tree.at * px;
      parts.push(rect(tx - scenario.pit / 2 * px, ty - scenario.pit / 2 * px,
        scenario.pit * px, scenario.pit * px, { fill: C.greenPale, stroke: C.green, sw: 1 }));
      parts.push(treePlan(tx, ty, 0.85 * px));
    }
    const free = scenario.freeAfter;
    const fx = sx + L * px - free * px - 1;
    parts.push(line(fx, sy + 4, fx, sy + len * px - 4, { stroke: C.red, sw: 2.4 }));
    parts.push(`<g transform="rotate(-90 ${n(fx - 8)} ${n(sy + len * px / 2)})">` +
      T(fx - 8, sy + len * px / 2, `passage libre ${fr(free)} m`, {
        size: 16, fill: C.red, anchor: 'middle', weight: 700
      }) + '</g>');
  } else {
    const free = s.bandes.filter(b => b.type.includes('passage')).reduce((t, b) => t + b.largeur, 0);
    const fx = sx + L * px - free * px;
    parts.push(line(fx, sy + 4, fx, sy + len * px - 4, { stroke: C.red, sw: 2, dash: '7 5' }));
    parts.push(`<g transform="rotate(-90 ${n(fx - 8)} ${n(sy + len * px / 2)})">` +
      T(fx - 8, sy + len * px / 2, `passage libre ${fr(free)} m`, {
        size: 16, fill: C.red, anchor: 'middle'
      }) + '</g>');
  }

  parts.push(T(x + 14, y + 24, apres ? 'APRÈS · plan' : 'AVANT · plan', {
    size: 18, fill: apres ? C.green : C.grey, weight: 700
  }));
  parts.push(scaleBar(sx, sy + len * px + 12, px, { maxMeters: 5, label: 'm' }));
  return parts.join('');
}

export function svgDemain(survey) {
  const s = normalizeSurvey(survey);
  const sc = demainScenario(s);
  const parts = [];

  parts.push(miniProfil(s, { x: 48, y: 196, w: 480, h: 430, apres: false }));
  parts.push(miniProfil(s, { x: 552, y: 196, w: 480, h: 430, apres: true, scenario: sc }));
  parts.push(miniPlan(s, { x: 48, y: 646, w: 480, h: 470, apres: false }));
  parts.push(miniPlan(s, { x: 552, y: 646, w: 480, h: 470, apres: true, scenario: sc }));

  parts.push(T(48, 1170, 'CE QUI CHANGE', { size: 20, fill: C.grey, letter: 2 }));
  const figures = [
    { avant: '0', apres: String(sc.trees), unite: 'arbres d’alignement', color: C.green, sous: 'fosses de 1,50 × 1,50 m' },
    { avant: '0', apres: fr(sc.pleineTerre, 1), unite: 'm² de pleine terre', color: C.green, sous: 'une fosse par arbre' },
    { avant: fr(sc.freeBefore), apres: fr(sc.freeAfter), unite: 'm de passage libre', color: C.red, sous: `minimum ${fr(sc.minFree)} m tenu` }
  ];
  figures.forEach((f, i) => {
    const x = 48 + i * 328;
    parts.push(rect(x, 1194, 312, 150, { fill: C.card, stroke: C.light, sw: 1.4 }));
    parts.push(T(x + 18, 1244, f.avant, { size: 30, fill: C.grey, weight: 600 }));
    const wAvant = String(f.avant).length * 20;
    parts.push(T(x + 18 + wAvant + 10, 1242, '→', { size: 26, fill: C.ink2 }));
    parts.push(T(x + 18 + wAvant + 52, 1252, f.apres, { size: 40, fill: f.color, weight: 700 }));
    parts.push(T(x + 18, 1294, f.unite, { size: 19, fill: C.ink2 }));
    parts.push(T(x + 18, 1326, f.sous, { size: 16, fill: C.grey }));
  });

  parts.push(T(48, 1400, 'À VÉRIFIER SUR PLACE', { size: 20, fill: C.grey, letter: 2 }));
  parts.push(sc.verifications.map((v, i) => T(66, 1438 + i * 34, '• ' + v, { size: 21, fill: C.ink2 })).join(''));
  parts.push(T(48, 1548, `Hypothèses : fosse à cheval sur la limite terrasse / passage (0,75 m de chaque côté) ·`, {
    size: 18, fill: C.grey
  }));
  parts.push(T(48, 1574, `arbres tous les ${fr(sc.spacing, 0)} m · hauteur d’arbre à 15 ans relevée à 4,00 m · terrasses non supprimées.`, {
    size: 18, fill: C.grey
  }));

  const legend = legendRow(48, 1650, [
    { solid: '#ece6d8', stroke: C.ink, label: 'pavés jointoyés' },
    { solid: '#c9b98a', label: 'joints ouverts' },
    { solid: C.greenPale, stroke: C.green, label: 'pleine terre' },
    { dash: C.red, label: 'passage libre' }
  ], { size: 20, gap: 18 });

  return frame({
    numero: '6/6',
    categorie: 'DEMAIN · AVANT / APRÈS (PROPOSITION)',
    titre: 'La même rue, réaménagée',
    sousTitre: `${s.nom} · sans toucher aux immeubles ni aux rez-de-chaussée`,
    corps: parts.join(''),
    legende: legend,
    cartouche: `${s.nom.toUpperCase()} · PROPOSITION`,
    note: 'scénario indicatif · à valider par un relevé de terrain et les services techniques',
    date: s.date
  });
}

/* ------------------------------------------------------------------ */
/* Planche A3                                                          */
/* ------------------------------------------------------------------ */

function innerSvg(svg) {
  const text = String(svg);
  const open = text.indexOf('>');
  const close = text.lastIndexOf('</svg>');
  let inner = open > -1 && close > open ? text.slice(open + 1, close) : text;
  inner = inner.replace(/<defs>[\s\S]*?<\/defs>/g, '');
  return inner;
}

export function svgPlanche(drawings, survey) {
  const s = normalizeSurvey(survey);
  const items = [
    { svg: drawings.usages, titre: '1 · Usages de la rue', sous: 'plan 1/200' },
    { svg: drawings.profil, titre: '2 · Profil en travers', sous: 'coupe 1/200' },
    { svg: drawings.fronts, titre: '3 · Front bâti', sous: 'élévation déroulée' },
    { svg: drawings.axo, titre: '4 · Axonométrie', sous: '30°' },
    { svg: drawings.ombres, titre: '5 · Ensoleillement', sous: 'coupe et plan' },
    { svg: drawings.demain, titre: '6 · Avant / après', sous: 'proposition' }
  ].filter(it => it.svg);

  const parts = [];
  parts.push(rect(0, 0, PLANCHE_W, PLANCHE_H, { fill: C.paper }));
  parts.push(T(48, 70, 'PLANCHE DE RENDU · A3 PORTRAIT', { size: 20, fill: C.grey, letter: 2 }));
  parts.push(T(48, 118, s.nom.toUpperCase(), { size: 42, weight: 700 }));
  parts.push(T(48, 150, `${s.lieu} · ${items.length} dessins · ${s.date}`, { size: 20, fill: C.ink2 }));
  parts.push(line(48, 170, 1032, 170, { stroke: C.ink, sw: 2 }));

  const cols = 2;
  const rows = Math.ceil(items.length / cols);
  const cellW = 470;
  const cellH = 466;
  const gapX = 22;
  const gridX = (PLANCHE_W - cols * cellW - (cols - 1) * gapX) / 2;
  const gridY = 196;
  const thumbH = 396;
  const thumbW = thumbH * (PLANCHE_W / PLANCHE_H);
  const scale = thumbW / PLANCHE_W;

  items.forEach((it, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = gridX + col * (cellW + gapX);
    const cy = gridY + row * cellH;
    const tx = cx + (cellW - thumbW) / 2;
    parts.push(rect(cx, cy, cellW, cellH - 22, { fill: C.card, stroke: C.light, sw: 1.4 }));
    parts.push(`<clipPath id="clip-${i}"><rect x="0" y="0" width="${PLANCHE_W}" height="${PLANCHE_H}"/></clipPath>`);
    parts.push(`<g clip-path="url(#clip-${i})" transform="translate(${n(tx)} ${n(cy + 12)}) scale(${scale.toFixed(4)})">` +
      innerSvg(it.svg) + '</g>');
    parts.push(T(cx + 12, cy + cellH - 34, it.titre, { size: 20, weight: 700 }));
    parts.push(T(cx + cellW - 12, cy + cellH - 34, it.sous, { size: 17, fill: C.ink2, anchor: 'end' }));
  });

  const cartY = Math.min(gridY + rows * cellH + 4, 1732);
  parts.push(rect(48, cartY, 984, 118, { fill: C.card, stroke: C.ink, sw: 2 }));
  parts.push(rect(48, cartY, 12, 118, { fill: C.ink }));
  parts.push(T(78, cartY + 40, 'RUE · planche de rendu — 6 dessins', { size: 26, weight: 700 }));
  parts.push(T(78, cartY + 72, `${s.nom} · ${s.lieu}`, { size: 19, fill: C.ink2 }));
  parts.push(T(78, cartY + 98, 'Dessins calculés en code depuis rue.json · mesures supposées signalées', {
    size: 17, fill: C.grey
  }));
  parts.push(T(1006, cartY + 40, 'Date', { size: 17, fill: C.grey, anchor: 'end' }));
  parts.push(T(1006, cartY + 70, s.date, { size: 22, anchor: 'end', weight: 700 }));
  parts.push(T(48, 1898, 'UrbaTrame · analyse architecturale · ' + s.note, { size: 16, fill: C.grey }));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PLANCHE_W}" height="${PLANCHE_H}" viewBox="0 0 ${PLANCHE_W} ${PLANCHE_H}">` +
    `<defs>
      <pattern id="hatch" width="9" height="9" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
        <rect width="9" height="9" fill="#fbf8f1"/><line x1="0" y1="0" x2="0" y2="9" stroke="#8a8a8a" stroke-width="2.2"/>
      </pattern>
      <pattern id="paves" width="24" height="16" patternUnits="userSpaceOnUse">
        <rect width="24" height="16" fill="#ded8ca"/><path d="M0 0V16M12 0V16" stroke="#c8c1b1" stroke-width="1"/>
      </pattern>
    </defs>` + parts.join('') + '</svg>';
}

/* Toutes les planches d'un relevé, prêtes à prévisualiser ou exporter. */
export function renderAll(survey) {
  const s = normalizeSurvey(survey);
  const drawings = {
    usages: svgUsages(s),
    profil: svgProfil(s),
    fronts: svgFronts(s),
    axo: svgAxo(s),
    ombres: svgOmbres(s),
    demain: svgDemain(s)
  };
  drawings.planche = svgPlanche(drawings, s);
  return drawings;
}


