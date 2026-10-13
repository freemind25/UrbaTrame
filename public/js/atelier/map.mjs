const TILE = 256;
const R2D = 180 / Math.PI;
const D2R = Math.PI / 180;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

function world(lat, lon, z) {
  const scale = TILE * 2 ** z;
  const phi = clamp(lat, -85.05112878, 85.05112878) * D2R;
  return {
    x: (lon + 180) / 360 * scale,
    y: (1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2 * scale
  };
}
function geographic(x, y, z) {
  const scale = TILE * 2 ** z;
  return {
    lon: x / scale * 360 - 180,
    lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * y / scale))) * R2D
  };
}
const fmt = n => Number.isFinite(n) ? n.toFixed(1) : '0';
const mod = (n, m) => ((n % m) + m) % m;
export const worldPixel = world;
export const geographicFromWorldPixel = geographic;
export function localPixel(lat, lon, origin, z) {
  const p = world(lat, lon, z);
  const width = TILE * 2 ** z;
  let dx = p.x - origin.x;
  if (dx > width / 2) dx -= width;
  if (dx < -width / 2) dx += width;
  return [dx, p.y - origin.y];
}

export function createMap(root, options = {}) {
  const tiles = root.querySelector('.map-tiles');
  const svg = root.querySelector('.map-overlay');
  const scaleLabel = root.querySelector('#mapScale');
  const state = { lat: options.lat || 36.2642, lon: options.lon || 6.6969, zoom: options.zoom || 15, radius: options.radius || 600, data: null };
  const cache = new Map();
  let dimensions = { w: 0, h: 0 };
  let drawPending = false, drag = null, suppressClick = false;

  function setStateLabel() {
    const mpp = Math.cos(state.lat * D2R) * 40075016.686 / (TILE * 2 ** state.zoom);
    const span = mpp * 55;
    const power = 10 ** Math.floor(Math.log10(Math.max(1, span)));
    const digit = span / power;
    const nice = (digit >= 5 ? 5 : digit >= 2 ? 2 : 1) * power;
    scaleLabel.textContent = nice >= 1000 ? `${(nice / 1000).toFixed(nice % 1000 ? 1 : 0)} km` : `${Math.round(nice)} m`;
  }
  function featurePath(list, origin, z, stroke, width, fill, closed = false) {
    let out = '';
    for (const f of (list || []).slice(0, 5000)) {
      if (!Array.isArray(f.g) || f.g.length < 2) continue;
      const ps = f.g.map(p => localPixel(p[0], p[1], origin, z));
      if (ps.some(p => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) continue;
      const d = 'M' + ps.map(p => fmt(p[0]) + ',' + fmt(p[1])).join('L') + (closed ? 'Z' : '');
      out += `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
    }
    return out;
  }
  function drawOverlay(origin) {
    const w = dimensions.w, h = dimensions.h;
    const c = Math.cos(state.lat * D2R);
    const mpp = c * 40075016.686 / (TILE * 2 ** state.zoom);
    const radius = clamp(state.radius / mpp, 8, Math.max(w, h) * 4);
    const parts = [`<defs><clipPath id="siteClip"><circle cx="${w / 2}" cy="${h / 2}" r="${fmt(radius)}"/></clipPath></defs>`];
    if (state.data) {
      parts.push('<g clip-path="url(#siteClip)">');
      parts.push(featurePath(state.data.landuse, origin, state.zoom, '#97ad8f', 1, 'rgba(184,207,171,.22)', true));
      parts.push(featurePath(state.data.green, origin, state.zoom, '#85a778', .9, 'rgba(159,196,138,.28)', true));
      parts.push(featurePath(state.data.waterways, origin, state.zoom, '#67a0bb', 1.8, 'none'));
      parts.push(featurePath(state.data.treeRows, origin, state.zoom, '#358459', 2, 'none'));
      parts.push(featurePath(state.data.rail, origin, state.zoom, '#846b95', 1.5, 'none'));
      parts.push(featurePath(state.data.roads, origin, state.zoom, '#b9996c', 1.1, 'none'));
      parts.push(featurePath(state.data.build, origin, state.zoom, '#6f756e', .7, 'rgba(106,111,105,.54)', true));
      const trees = (state.data.trees || []).slice(0, 2200);
      parts.push('<g fill="#358459" stroke="#fff" stroke-width=".7">');
      for (const tree of trees) {
        const p = localPixel(tree.lat, tree.lon, origin, state.zoom);
        if (Math.abs(p[0] - w / 2) <= radius && Math.abs(p[1] - h / 2) <= radius)
          parts.push(`<circle cx="${fmt(p[0])}" cy="${fmt(p[1])}" r="2.4"/>`);
      }
      parts.push('</g></g>');
    }
    parts.push(`<circle cx="${w / 2}" cy="${h / 2}" r="${fmt(radius)}" fill="rgba(40,107,78,.06)" stroke="#1f6c53" stroke-width="2" stroke-dasharray="7 5" vector-effect="non-scaling-stroke"/>`);
    parts.push(`<line x1="${w / 2 - 12}" y1="${h / 2}" x2="${w / 2 + 12}" y2="${h / 2}" stroke="#14543f" stroke-width="1"/><line x1="${w / 2}" y1="${h / 2 - 12}" x2="${w / 2}" y2="${h / 2 + 12}" stroke="#14543f" stroke-width="1"/>`);
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.innerHTML = parts.join('');
  }
  function draw() {
    drawPending = false;
    const rect = root.getBoundingClientRect();
    dimensions = { w: Math.max(1, rect.width), h: Math.max(1, rect.height) };
    const center = world(state.lat, state.lon, state.zoom);
    const origin = { x: center.x - dimensions.w / 2, y: center.y - dimensions.h / 2 };
    const minX = Math.floor(origin.x / TILE), maxX = Math.floor((origin.x + dimensions.w) / TILE);
    const minY = Math.floor(origin.y / TILE), maxY = Math.floor((origin.y + dimensions.h) / TILE);
    const count = 2 ** state.zoom;
    const frag = document.createDocumentFragment();
    for (let ty = minY; ty <= maxY; ty++) {
      if (ty < 0 || ty >= count) continue;
      for (let tx = minX; tx <= maxX; tx++) {
        const wrapped = mod(tx, count), key = `${state.zoom}/${wrapped}/${ty}`;
        let img = cache.get(key);
        if (!img) {
          img = document.createElement('img');
          img.alt = ''; img.draggable = false; img.decoding = 'async';
          img.src = `https://tile.openstreetmap.org/${key}.png`;
          img.addEventListener('error', () => img.classList.add('tile-missing'), { once: true });
          cache.set(key, img);
          if (cache.size > 96) cache.delete(cache.keys().next().value);
        }
        img.style.left = `${tx * TILE - origin.x}px`;
        img.style.top = `${ty * TILE - origin.y}px`;
        frag.append(img);
      }
    }
    tiles.replaceChildren(frag);
    drawOverlay(origin);
    setStateLabel();
  }
  function schedule() { if (!drawPending) { drawPending = true; requestAnimationFrame(draw); } }
  function centerAt(lat, lon, notify = true) {
    state.lat = clamp(Number(lat), -85, 85);
    state.lon = clamp(Number(lon), -180, 180);
    schedule();
    if (notify) options.onCenter?.(state.lat, state.lon);
  }
  function fitRadius(radius) {
    state.radius = radius;
    const min = Math.max(280, Math.min(root.clientWidth || 800, root.clientHeight || 560));
    const targetMpp = Math.max(.25, radius / (min * .30));
    const z = Math.round(Math.log2(Math.cos(state.lat * D2R) * 40075016.686 / (TILE * targetMpp)));
    state.zoom = clamp(z, 3, 19);
    schedule();
  }
  root.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, start: world(state.lat, state.lon, state.zoom), moved: false };
    root.setPointerCapture?.(e.pointerId);
  });
  root.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.hypot(dx, dy) > 4) drag.moved = true;
    if (!drag.moved) return;
    const p = geographic(drag.start.x - dx, drag.start.y - dy, state.zoom);
    centerAt(p.lat, p.lon, true);
  });
  root.addEventListener('pointerup', () => {
    if (drag?.moved) suppressClick = true;
    drag = null;
  });
  root.addEventListener('pointercancel', () => { drag = null; });
  root.addEventListener('click', e => {
    if (suppressClick) { suppressClick = false; return; }
    const r = root.getBoundingClientRect();
    const c = world(state.lat, state.lon, state.zoom);
    const p = geographic(c.x + e.clientX - r.left - r.width / 2, c.y + e.clientY - r.top - r.height / 2, state.zoom);
    centerAt(p.lat, p.lon, true);
  });
  root.addEventListener('wheel', e => {
    e.preventDefault();
    const old = state.zoom;
    state.zoom = clamp(old + (e.deltaY < 0 ? 1 : -1), 3, 19);
    schedule();
  }, { passive: false });
  const observer = new ResizeObserver(schedule);
  observer.observe(root);

  return {
    setCenter: centerAt,
    setRadius: fitRadius,
    setData(data) { state.data = data; schedule(); },
    zoomBy(n) { state.zoom = clamp(state.zoom + n, 3, 19); schedule(); },
    getState() { return { ...state }; },
    destroy() { observer.disconnect(); root.replaceChildren(); }
  };
}
