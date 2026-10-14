/* Freemap · panneau des exports (plan DXF, coupe, modèle 3D)
   ─────────────────────────────────────────────────────────────────────────
   Trois onglets, une seule fenêtre :

     • Plan DXF    — courbes de niveau, bâti, voirie, eau, végétation, POI,
                     emprise, cartouche ; repère local ou UTM.
     • Coupe       — deux points à cliquer sur l'aperçu, profil du terrain et
                     bâti traversé ; export SVG, DXF ou PNG.
     • Modèle 3D   — OBJ et STL, relief compris, altitudes vraies.

   L'aperçu est dessiné dans la fenêtre (SVG), pour vérifier avant d'ouvrir un
   logiciel de CAO. Aucune bibliothèque : tout est calculé ici.
   ───────────────────────────────────────────────────────────────────────── */
import * as X from './exports.mjs';

export function ouvrirExports(o) {
  const lang = o.langue === 'en' ? 'en' : 'fr';
  const t = (fr, en) => (lang === 'en' ? en : fr);
  const V = globalThis.FMVue3D;

  /* ── contexte de rendu attendu par les exports (même forme que les analyses) ── */
  const ctx = {
    sLat: o.lat, sLng: o.lon, curR: o.rayon, siteName: o.nom || '',
    shape: 'circle', lang, D: o.D || { roads: [], build: [], green: [], pois: [] },
    terrain: o.terrain || null
  };

  const racine = document.createElement('div');
  racine.className = 'xpt';
  racine.innerHTML = `
    <div class="xpt-barre">
      <strong>${t('Exports', 'Exports')}</strong>
      <span class="xpt-site">${o.nom || ''}</span>
      <nav class="xpt-onglets">
        <button data-ong="plan" class="on">${t('Plan DXF', 'DXF plan')}</button>
        <button data-ong="coupe">${t('Coupe', 'Section')}</button>
        <button data-ong="modele">${t('Modèle 3D', '3D model')}</button>
      </nav>
      <span class="xpt-spacer"></span>
      <span class="xpt-etat" id="xpt-etat"></span>
      <button id="xpt-fermer" class="fermer" title="${t('Fermer', 'Close')}">✕</button>
    </div>
    <div class="xpt-corps">

      <section data-pan="plan">
        <div class="xpt-col">
          <h4>${t('Plan topographique', 'Topographic plan')}</h4>
          <label class="xpt-l"><span>${t('Repère', 'Datum')}</span>
            <select id="xpt-repere">
              <option value="local">${t('local (mètres, centre du site)', 'local (metres, site centre)')}</option>
              <option value="utm">${t('géoréférencé UTM (WGS 84)', 'georeferenced UTM (WGS 84)')}</option>
            </select></label>
          <label class="xpt-l"><span>${t('Équidistance', 'Contour interval')}</span>
            <select id="xpt-equi">
              <option value="0">${t('automatique', 'automatic')}</option>
              <option value="1">1 m</option><option value="2">2 m</option>
              <option value="5">5 m</option><option value="10">10 m</option>
              <option value="20">20 m</option><option value="50">50 m</option>
            </select></label>
          <label class="xpt-l"><span>${t('Hauteur du bâti sans donnée', 'Default building height')}</span>
            <select id="xpt-hb">
              <option value="6">6 m</option><option value="9" selected>9 m</option>
              <option value="12">12 m</option><option value="15">15 m</option>
            </select></label>
          <fieldset class="xpt-couches"><legend>${t('Calques', 'Layers')}</legend>
            <label><input type="checkbox" data-couche="COURBES" checked> ${t('Courbes de niveau', 'Contours')}</label>
            <label><input type="checkbox" data-couche="BATI" checked> ${t('Bâti', 'Buildings')}</label>
            <label><input type="checkbox" data-couche="VOIRIE" checked> ${t('Voirie', 'Roads')}</label>
            <label><input type="checkbox" data-couche="EAU" checked> ${t('Eau', 'Water')}</label>
            <label><input type="checkbox" data-couche="VERT" checked> ${t('Végétation', 'Green')}</label>
            <label><input type="checkbox" data-couche="POI" checked> ${t('Points d’intérêt', 'Points of interest')}</label>
            <label><input type="checkbox" data-couche="EMPRISE" checked> ${t('Emprise', 'Site boundary')}</label>
            <label><input type="checkbox" data-couche="TEXTE" checked> ${t('Cartouche', 'Title block')}</label>
          </fieldset>
          <div class="xpt-actions">
            <button class="primary" id="xpt-dxf">${t('Télécharger le plan .dxf', 'Download plan .dxf')}</button>
            <button id="xpt-plan-png">PNG</button>
            <button id="xpt-plan-svg">SVG</button>
          </div>
          <p class="xpt-note" id="xpt-n-plan"></p>
          <p class="xpt-note">${t('Le DXF est en version R12 (AC1009) : la plus largement lue. Les emprises portent leur hauteur en Z — un lecteur CAO peut les extruder d’un geste.',
            'The DXF is release 12 (AC1009), the most widely read. Footprints carry their height in Z — a CAD reader can extrude them in one move.')}</p>
        </div>
        <div class="xpt-col xpt-apercu" id="xpt-ap-plan"></div>
      </section>

      <section data-pan="coupe" hidden>
        <div class="xpt-col">
          <h4>${t('Coupe topographique', 'Topographic section')}</h4>
          <p class="xpt-note">${t('Cliquez sur l’aperçu pour placer A, puis B. Le profil et le bâti traversé se tracent aussitôt.',
            'Click the preview to place A, then B. The profile and the buildings crossed are drawn at once.')}</p>
          <div class="xpt-mini" id="xpt-mini"></div>
          <div class="xpt-ab" id="xpt-ab"></div>
          <div class="xpt-actions">
            <button id="xpt-axe-ew">${t('Axe est-ouest', 'East–west axis')}</button>
            <button id="xpt-axe-ns">${t('Axe nord-sud', 'North–south axis')}</button>
            <button id="xpt-axe-inv">⇄ ${t('Inverser', 'Reverse')}</button>
          </div>
          <label class="xpt-l"><span>${t('Bâti sans hauteur', 'Buildings without height')}</span>
            <select id="xpt-hc">
              <option value="6">6 m</option><option value="9" selected>9 m</option>
              <option value="12">12 m</option><option value="15">15 m</option>
            </select></label>
          <div class="xpt-actions">
            <button class="primary" id="xpt-c-dxf">DXF</button>
            <button id="xpt-c-svg">SVG</button>
            <button id="xpt-c-png">PNG</button>
          </div>
          <p class="xpt-note" id="xpt-n-coupe"></p>
        </div>
        <div class="xpt-col xpt-apercu" id="xpt-ap-coupe"></div>
      </section>

      <section data-pan="modele" hidden>
        <div class="xpt-col">
          <h4>${t('Modèle 3D', '3D model')}</h4>
          <p class="xpt-note">${t('Sommets en mètres, X vers l’est, Y vers le nord, Z vers le haut — le repère des logiciels de CAO. Les altitudes sont vraies (l’altitude de référence du relief est ajoutée).',
            'Vertices in metres, X east, Y north, Z up — the CAD convention. Elevations are real (the terrain reference elevation is added).')}</p>
          <fieldset class="xpt-couches"><legend>${t('Contenu', 'Contents')}</legend>
            <label><input type="checkbox" id="xpt-m-sol" checked> ${t('Terrain (maillage du relief)', 'Terrain (relief mesh)')}</label>
            <label><input type="checkbox" id="xpt-m-bati" checked> ${t('Bâti (murs et toits)', 'Buildings (walls and roofs)')}</label>
          </fieldset>
          <p class="xpt-note" id="xpt-n-modele"></p>
          <div class="xpt-actions">
            <button class="primary" id="xpt-obj">${t('Télécharger .obj', 'Download .obj')}</button>
            <button class="primary" id="xpt-stl">${t('Télécharger .stl', 'Download .stl')}</button>
          </div>
          <p class="xpt-note">${t('OBJ : un seul fichier, groupes TERRAIN / BATI / TOIT, faces polygonales. STL : facettes triangulaires, normales calculées — pour l’impression 3D. Les cours intérieures sont évidées à l’écran, mais ni l’OBJ ni le STL ASCII ne savent décrire un trou dans une face : elles y restent pleines.',
            'OBJ: one file, TERRAIN / BATI / TOIT groups, polygonal faces. STL: triangular facets, computed normals — for 3D printing. Courtyards are hollowed on screen, but neither OBJ nor ASCII STL can describe a hole in a face: they stay filled there.')}</p>
        </div>
        <div class="xpt-col xpt-apercu" id="xpt-ap-modele"></div>
      </section>
    </div>`;

  document.body.appendChild(racine);
  document.body.classList.add('xpt-ouvert');
  const q = s => racine.querySelector(s);
  const etat = q('#xpt-etat');

  /* ── état local ── */
  const et = {
    onglet: 'plan', A: null, B: null, plan: null, coupe: null, scene: null, chargement: false
  };

  /* ── utilitaires ── */
  const telecharger = (texte, nom, type) => {
    const u = URL.createObjectURL(new Blob([texte], { type: type + ';charset=utf-8' }));
    const a = document.createElement('a');
    a.href = u; a.download = nom; a.click();
    setTimeout(() => URL.revokeObjectURL(u), 4000);
    etat.textContent = t('écrit : ', 'written: ') + nom;
  };
  /* SVG → PNG : le navigateur fait la conversion, on récupère le canevas. */
  const versPNG = (svg, nom, ech) => new Promise((ok, ko) => {
    const img = new Image();
    const k = ech || 2;
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width * k; c.height = img.height * k;
      const g = c.getContext('2d');
      g.fillStyle = '#FBF9F5'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(b => {
        const u = URL.createObjectURL(b);
        const a = document.createElement('a');
        a.href = u; a.download = nom; a.click();
        setTimeout(() => URL.revokeObjectURL(u), 4000);
        ok();
      }, 'image/png');
    };
    img.onerror = () => ko(new Error('PNG'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
  const nomFichier = (quoi, ext) => {
    const site = (o.nom || 'urbatrame').split(',')[0].trim().replace(/[^\wÀ-ÿ -]/g, '').replace(/\s+/g, '-').toLowerCase();
    return 'urbatrame-' + site + '-' + quoi + '.' + ext;
  };
  const optionsPlan = () => ({
    geolocate: q('#xpt-repere').value === 'utm',
    equidistance: Number(q('#xpt-equi').value) || 0,
    hauteurBati: Number(q('#xpt-hb').value) || 9,
    avec: [...racine.querySelectorAll('[data-couche]')].filter(c => c.checked).map(c => c.dataset.couche),
    titre: o.nom || 'UrbaTrame'
  });

  /* ── onglets ── */
  for (const b of racine.querySelectorAll('.xpt-onglets button')) {
    b.addEventListener('click', () => {
      et.onglet = b.dataset.ong;
      for (const x of racine.querySelectorAll('.xpt-onglets button')) x.classList.toggle('on', x === b);
      for (const s of racine.querySelectorAll('[data-pan]')) s.hidden = s.dataset.pan !== et.onglet;
      dessiner();
    });
  }

  /* ── plan ── */
  function plan() {
    const r = X.dxfTopo(ctx, optionsPlan());
    et.plan = r;
    q('#xpt-ap-plan').innerHTML = X.apercuSVG(r.entites, { largeur: 720, hauteur: 560 }).svg;
    const km = (2 * o.rayon / 1000).toFixed(2);
    q('#xpt-n-plan').textContent = [
      r.nbEntites + ' ' + t('entités', 'entities'),
      r.courbes + ' ' + t('courbes (équidistance ', 'contours (interval ') + r.equidistance + ' m)',
      r.min != null ? t('altitudes ', 'elevations ') + r.min.toFixed(1) + '–' + r.max.toFixed(1) + ' m' : '',
      t('emprise ', 'boundary ') + km + ' km · ' + r.repere.note
    ].filter(Boolean).join(' · ');
  }

  /* ── coupe ── */
  const mini = q('#xpt-mini');
  function dessinerMini() {
    const W = 420, H = 240, pad = 8;
    const R = o.rayon, dl = R / (111320 * Math.cos(o.lat * Math.PI / 180)), dy = R / 111320;
    const px = (lat, lon) => [
      pad + (lon - (o.lon - dl)) / (2 * dl) * (W - pad * 2),
      pad + ((o.lat + dy) - lat) / (2 * dy) * (H - pad * 2)
    ];
    const D = ctx.D;
    let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" id="xpt-carte">`;
    s += `<rect width="${W}" height="${H}" fill="#F4F1EA"/>`;
    /* fond de carte : vert, voirie, bâti, POI — comme l'aperçu de la barre latérale */
    for (const g of D.green || []) {
      const pts = (g.g || []).map(([la, lo]) => px(la, lo).map(v => v.toFixed(1)).join(','));
      if (pts.length > 2) s += `<polygon points="${pts.join(' ')}" fill="${g.k === 'w' ? '#B7D3E2' : '#D6E8CB'}"/>`;
    }
    for (const r of D.roads || []) {
      const pts = (r.g || []).map(([la, lo]) => px(la, lo).map(v => v.toFixed(1)).join(','));
      const gros = /motorway|trunk|primary/.test(r.h || '');
      if (pts.length > 1) s += `<polyline points="${pts.join(' ')}" fill="none" stroke="${gros ? '#8A857C' : '#CFCAC1'}" stroke-width="${gros ? 2 : 1}"/>`;
    }
    for (const b of D.build || []) {
      const pts = (b.g || []).map(([la, lo]) => px(la, lo).map(v => v.toFixed(1)).join(','));
      if (pts.length > 2) s += `<polygon points="${pts.join(' ')}" fill="#2E2C28" fill-opacity=".82"/>`;
    }
    for (const p of D.pois || []) {
      const [x, y] = px(p.y ?? p.lat, p.x ?? p.lon);
      s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.6" fill="#C0392B"/>`;
    }
    const c = px(o.lat, o.lon);
    s += `<circle cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" r="3" fill="none" stroke="#C0392B" stroke-width="1.2"/>`;
    if (et.A && et.B) {
      const a = px(et.A[0], et.A[1]), b = px(et.B[0], et.B[1]);
      s += `<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" stroke="#1E7A5A" stroke-width="2"/>` +
        `<circle cx="${a[0].toFixed(1)}" cy="${a[1].toFixed(1)}" r="4" fill="#1E7A5A"/>` +
        `<circle cx="${b[0].toFixed(1)}" cy="${b[1].toFixed(1)}" r="4" fill="#1E7A5A"/>` +
        `<text x="${a[0].toFixed(1)}" y="${(a[1] - 6).toFixed(1)}" font-size="11" fill="#1E7A5A" font-family="sans-serif">A</text>` +
        `<text x="${b[0].toFixed(1)}" y="${(b[1] - 6).toFixed(1)}" font-size="11" fill="#1E7A5A" font-family="sans-serif">B</text>`;
    }
    s += '</svg>';
    mini.innerHTML = s;
  }

  function clicMini(ev) {
    const c = mini.querySelector('#xpt-carte');
    if (!c) return;
    const r = c.getBoundingClientRect();
    const W = 420, H = 240, pad = 8;
    const x = (ev.clientX - r.left) / r.width * W, y = (ev.clientY - r.top) / r.height * H;
    const R = o.rayon, dl = R / (111320 * Math.cos(o.lat * Math.PI / 180)), dy = R / 111320;
    const lon = (o.lon - dl) + (x - pad) / (W - pad * 2) * (2 * dl);
    const lat = (o.lat + dy) - (y - pad) / (H - pad * 2) * (2 * dy);
    if (!et.A || (et.A && et.B)) { et.A = [lat, lon]; et.B = null; } else { et.B = [lat, lon]; }
    coupe();
  }

  function coupe() {
    if (!et.A || !et.B) { q('#xpt-ab').textContent = t('Placez A puis B.', 'Place A, then B.'); return; }
    const C = X.coupe(ctx, et.A, et.B, { hauteurBati: Number(q('#xpt-hc').value) || 9 });
    et.coupe = C;
    const fmt = (p, n) => n + ' ' + p[0].toFixed(5) + ', ' + p[1].toFixed(5);
    q('#xpt-ab').textContent = fmt(et.A, 'A') + t('  →  ', '  →  ') + fmt(et.B, 'B');
    q('#xpt-ap-coupe').innerHTML = X.coupeSVG(C, { titre: o.nom || 'UrbaTrame', lang, largeur: 760, hauteur: 360 }).svg;
    const bas = C.bati.map(b => b.h).sort((a, b) => b - a).slice(0, 3);
    q('#xpt-n-coupe').textContent = [
      Math.round(C.longueur) + ' m',
      t('sol ', 'ground ') + C.zMin.toFixed(1) + '–' + C.zMax.toFixed(1) + ' m',
      t('dénivelé ', 'relief ') + (C.zMax - C.zMin).toFixed(1) + ' m',
      C.bati.length + t(' bâtiments traversés', ' buildings crossed'),
      bas.length ? t('plus hauts : ', 'tallest: ') + bas.join(', ') + ' m' : '',
      C.pts.length + t(' points d’échantillonnage', ' samples')
    ].filter(Boolean).join(' · ');
    dessinerMini();
  }

  /* ── modèle 3D ── */
  function scene3d() {
    if (!V) return null;
    const cam = V.camera({
      lat: o.lat, lon: o.lon, rayon: o.rayon, cap: 35, inclinaison: 42,
      largeur: 640, hauteur: 480
    });
    const bati = q('#xpt-m-bati').checked ? ctx.D.build || [] : [];
    const avecRelief = q('#xpt-m-sol').checked && ctx.terrain;
    const sc = V.scene(bati, cam, { terrain: avecRelief ? ctx.terrain : null, palette: 0 });
    et.scene = sc;
    const M = X.maillageDeScene(sc, { sol: !!avecRelief });
    const tri = M.faces.reduce((s, f) => s + Math.max(0, f.pts.length - 2), 0);
    q('#xpt-n-modele').textContent = [
      bati.length + t(' emprises', ' footprints'),
      M.sommets.length.toLocaleString(lang === 'en' ? 'en-GB' : 'fr-FR') + t(' sommets', ' vertices'),
      M.faces.length.toLocaleString(lang === 'en' ? 'en-GB' : 'fr-FR') + t(' faces', ' faces'),
      tri.toLocaleString(lang === 'en' ? 'en-GB' : 'fr-FR') + t(' triangles dans le STL', ' triangles in the STL'),
      t('altitude de référence ', 'datum elevation ') + (sc.terrainRef || 0).toFixed(1) + ' m'
    ].join(' · ');
    return sc;
  }

  /* ── aiguillage ── */
  function dessiner() {
    if (et.onglet === 'plan') plan();
    else if (et.onglet === 'coupe') { dessinerMini(); coupe(); }
    else scene3d();
  }

  /* ── actions ── */
  for (const s of ['#xpt-repere', '#xpt-equi', '#xpt-hb'])
    q(s).addEventListener('change', () => { if (et.onglet === 'plan') plan(); });
  for (const c of racine.querySelectorAll('[data-couche]'))
    c.addEventListener('change', () => { if (et.onglet === 'plan') plan(); });
  q('#xpt-dxf').addEventListener('click', () => {
    if (!et.plan) plan();
    telecharger(et.plan.dxf, nomFichier('plan', 'dxf'), 'application/dxf');
  });
  q('#xpt-plan-svg').addEventListener('click', () => {
    if (!et.plan) plan();
    const a = X.apercuSVG(et.plan.entites, { largeur: 1600, hauteur: 1200 });
    telecharger(a.svg, nomFichier('plan', 'svg'), 'image/svg+xml');
  });
  q('#xpt-plan-png').addEventListener('click', async () => {
    if (!et.plan) plan();
    const a = X.apercuSVG(et.plan.entites, { largeur: 1600, hauteur: 1200 });
    await versPNG(a.svg, nomFichier('plan', 'png'), 1);
  });

  mini.addEventListener('click', clicMini);
  const axe = (da, db) => {
    const m = (dx, dy) => [o.lat + dy / 111320, o.lon + dx / (111320 * Math.cos(o.lat * Math.PI / 180))];
    et.A = m(...da); et.B = m(...db);
    coupe();
  };
  q('#xpt-axe-ew').addEventListener('click', () => axe([-o.rayon, 0], [o.rayon, 0]));
  q('#xpt-axe-ns').addEventListener('click', () => axe([0, -o.rayon], [0, o.rayon]));
  q('#xpt-axe-inv').addEventListener('click', () => {
    if (et.A && et.B) { const a = et.A; et.A = et.B; et.B = a; coupe(); }
  });
  q('#xpt-hc').addEventListener('change', coupe);
  q('#xpt-c-svg').addEventListener('click', () => {
    if (!et.coupe) return;
    const s = X.coupeSVG(et.coupe, { titre: o.nom || 'UrbaTrame', lang, largeur: 1600, hauteur: 760 });
    telecharger(s.svg, nomFichier('coupe', 'svg'), 'image/svg+xml');
  });
  q('#xpt-c-dxf').addEventListener('click', () => {
    if (!et.coupe) return;
    telecharger(X.dxfCoupe(et.coupe, { titre: o.nom || 'UrbaTrame' }), nomFichier('coupe', 'dxf'), 'application/dxf');
  });
  q('#xpt-c-png').addEventListener('click', async () => {
    if (!et.coupe) return;
    const s = X.coupeSVG(et.coupe, { titre: o.nom || 'UrbaTrame', lang, largeur: 1600, hauteur: 760 });
    await versPNG(s.svg, nomFichier('coupe', 'png'), 1);
  });
  for (const s of ['#xpt-m-sol', '#xpt-m-bati'])
    q(s).addEventListener('change', scene3d);
  q('#xpt-obj').addEventListener('click', () => {
    const sc = scene3d();
    if (!sc) return;
    telecharger(X.objDeScene(sc, {}), nomFichier('modele', 'obj'), 'text/plain');
  });
  q('#xpt-stl').addEventListener('click', () => {
    const sc = scene3d();
    if (!sc) return;
    telecharger(X.stlDeScene(sc, {}), nomFichier('modele', 'stl'), 'model/stl');
  });

  const fermer = () => {
    racine.remove();
    document.body.classList.remove('xpt-ouvert');
    document.removeEventListener('keydown', touche);
  };
  const touche = e => { if (e.key === 'Escape') fermer(); };
  q('#xpt-fermer').addEventListener('click', fermer);
  document.addEventListener('keydown', touche);

  /* ── chargements manquants : bâti et relief, comme les analyses ── */
  (async () => {
    try {
      if (!(ctx.D.build || []).length) {
        etat.textContent = t('chargement du bâti…', 'loading buildings…');
        const r = await fetch('/analysis/2d', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'buildings', device: o.device, lat: o.lat, lon: o.lon, radius: o.rayon, account: o.compte, token: o.jeton })
        });
        const d = await r.json();
        if (!d.ok) throw Object.assign(new Error(d.error || 'ÉCHEC'), d);
        const { batimentsDepuisOverpass } = await import('./osm.mjs');
        ctx.D.build = batimentsDepuisOverpass(d.elements);
      }
      if (!ctx.terrain) {
        etat.textContent = t('chargement du relief…', 'loading terrain…');
        const r = await fetch('/analysis/2d', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'terrain', device: o.device, lat: o.lat, lon: o.lon, radius: o.rayon, n: 24, account: o.compte, token: o.jeton })
        });
        const d = await r.json();
        if (d.ok && d.grid?.length) ctx.terrain = d;
      }
      etat.textContent = t('données prêtes', 'data ready');
      setTimeout(() => { if (etat.textContent === t('données prêtes', 'data ready')) etat.textContent = ''; }, 3000);
    } catch (e) {
      etat.textContent = (e.error === 'MAP_SOURCE_UNAVAILABLE')
        ? t('source cartographique injoignable', 'map source unreachable')
        : t('données indisponibles : ', 'data unavailable: ') + (e.error || e.message);
    }
    dessiner();
  })();

  dessiner();
  return { fermer, etat: et, dessiner };
}
