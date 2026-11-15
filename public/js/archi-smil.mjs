/* UrbaTrame · Animation SMIL des planches SVG (natif, aucune bibliothèque).
   animateSvg(svg, kind) renvoie le SVG enrichi d'animations <animate> :
   - balayage lumineux (toutes les planches, en boucle) ;
   - apparition en cascade des éléments de contenu (tous sauf la planche A3) ;
   - planche « ombres » : les rayons de soleil apparaissent un par un, comme la course du soleil.
   Pur et testable : entrée/sortie = chaîne SVG. */

const SHAPES = /<(rect|line|circle|polygon|path|text)\b([^>]*?)\/>/g;

function svgSize(svg) {
  const m = String(svg).match(/<svg[^>]*\bwidth="([\d.]+)"[^>]*\bheight="([\d.]+)"/);
  return m ? { w: Number(m[1]), h: Number(m[2]) } : { w: 1080, h: 1920 };
}

function opacityOf(attrs) {
  const m = attrs.match(/\bopacity="([\d.]+)"/);
  return m ? m[1] : '1';
}

/* Balayage lumineux horizontal, en boucle infinie. */
function sweep(svg, color) {
  const { w, h } = svgSize(svg);
  const bar = `<g pointer-events="none" aria-hidden="true">` +
    `<rect x="-90" y="0" width="70" height="${h}" fill="${color}" opacity="0.13">` +
    `<animate attributeName="x" from="-90" to="${w + 20}" dur="5.5s" repeatCount="indefinite"/>` +
    `</rect></g>`;
  return String(svg).replace('</svg>', bar + '</svg>');
}

/* Apparition douce en cascade : chaque forme pulse dans un cycle de 4 s, décalé.
   Les <defs> (patterns, dégradés) sont laissés intacts. */
function cascade(svg, cycle = 4, step = 0.045) {
  let i = 0;
  const anim = (all, tag, attrs) => {
    const to = opacityOf(attrs);
    const begin = (-((i * step) % cycle)).toFixed(2);
    i += 1;
    return `<${tag}${attrs}><animate attributeName="opacity" values="0;${to};${to}" ` +
      `keyTimes="0;0.18;1" dur="${cycle}s" begin="${begin}s" repeatCount="indefinite"/></${tag}>`;
  };
  return String(svg)
    .split(/(<defs>[\s\S]*?<\/defs>)/)
    .map(seg => (seg.startsWith('<defs>') ? seg : seg.replace(SHAPES, anim)))
    .join('');
}

/* Rayons de soleil (ombres) : apparition heure par heure, en boucle de 8 s. */
function sunRays(svg) {
  let i = 0;
  return String(svg).replace(/<line\b([^>]*stroke="#(?:e87722|2f5f9e)"[^>]*?)\/>/g, (all, attrs) => {
    const begin = (-((i * 0.35) % 8)).toFixed(2);
    i += 1;
    return `<line${attrs}><animate attributeName="opacity" values="0;0.92;0.92;0" ` +
      `keyTimes="0;0.12;0.85;1" dur="8s" begin="${begin}s" repeatCount="indefinite"/></line>`;
  });
}

export function animateSvg(svg, kind) {
  let out = String(svg);
  if (kind === 'ombres') out = sunRays(out);
  if (kind !== 'planche') out = cascade(out);
  out = sweep(out, kind === 'ombres' ? '#e87722' : '#ffffff');
  return out;
}

export const SMIL_KINDS = ['usages', 'profil', 'fronts', 'axo', 'ombres', 'demain', 'planche'];
