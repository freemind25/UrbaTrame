/* Freemap · vue 3D interactive
   ─────────────────────────────────────────────────────────────────────────
   Fenêtre plein écran qui affiche les volumes bâtis d'un site, avec :

     • rotation (glisser horizontalement) et inclinaison (glisser verticalement) ;
     • curseur d'heure : le soleil se déplace, les ombres suivent ;
     • molette : rapprochement ;
     • clic sur un bâtiment : sa fiche (hauteur, usage, nom…), mise en évidence ;
     • fond de carte raster (option), avec attribution OpenStreetMap ;
     • export : PNG (image du canevas) et SVG (géométrie vectorielle).

   Deux sources de bâtiments :
     • Overpass (défaut) : nos requêtes, autonome ;
     • tuiles osmbuildings.org : hauteurs déjà calculées (attribution requise).
   ───────────────────────────────────────────────────────────────────────── */
import { batimentsDepuisOverpass, batimentsDepuisTuiles } from './osm.mjs';

const FR = {
  titre: 'Vue 3D', heure: 'Heure', cap: 'Rotation', pente: 'Inclinaison',
  source: 'Source', fond: 'Fond de carte', export: 'Export',
  fermer: 'Fermer', aide: 'glisser : tourner · molette : zoom · clic : fiche',
  png: 'PNG', svg: 'SVG', palette: 'Palette', chargement: 'Chargement des bâtiments…',
  aucune: 'Aucun bâtiment sur ce site.', fiche: 'Fiche', hauteur: 'hauteur',
  estimee: 'estimée', niveaux: 'niveaux', usage: 'usage', toit: 'toit', nom: 'nom',
  ombres: 'ombres', ombresOff: 'sans ombre'
};

export function ouvrir3D(o) {
  const lang = o.langue === 'en' ? 'en' : 'fr';
  const t = (fr, en) => (lang === 'en' ? en : fr);

  const racine = document.createElement('div');
  racine.className = 'v3d';
  racine.innerHTML = `
    <div class="v3d-barre">
      <strong>${t('Vue 3D', '3D view')} · ${o.nom || ''}</strong>
      <label class="v3d-c"><span>${t('Heure', 'Hour')}</span>
        <input type="range" id="v3d-h" min="0" max="23" step="1" value="${o.heure ?? 12}">
        <output id="v3d-hv">${o.heure ?? 12} h</output></label>
      <label class="v3d-c"><span>${t('Rotation', 'Rotation')}</span>
        <input type="range" id="v3d-cap" min="-180" max="180" step="2" value="0"></label>
      <label class="v3d-c"><span>${t('Inclinaison', 'Tilt')}</span>
        <input type="range" id="v3d-inc" min="0" max="80" step="1" value="${o.inclinaison ?? 50}"></label>
      <label class="v3d-c"><span>${t('Palette', 'Palette')}</span>
        <input type="range" id="v3d-pal" min="0" max="3" step="1" value="0"></label>
      <label class="v3d-c v3d-case"><input type="checkbox" id="v3d-fond" ${o.fondParDefaut ? 'checked' : ''}> ${t('Fond de carte', 'Basemap')}</label>
      <label class="v3d-c v3d-case"><input type="checkbox" id="v3d-ombres" checked> ${t('Ombres', 'Shadows')}</label>
      <label class="v3d-c v3d-case"><input type="checkbox" id="v3d-relief" checked> ${t('Relief', 'Terrain')}</label>
      <span class="v3d-spacer"></span>
      <button id="v3d-png" title="${t('Image PNG de la vue', 'PNG image of the view')}">PNG</button>
      <button id="v3d-svg" title="${t('Géométrie vectorielle', 'Vector geometry')}">SVG</button>
      <button id="v3d-fermer" class="fermer">✕</button>
    </div>
    <div class="v3d-scene">
      <canvas id="v3d-cv"></canvas>
      <div class="v3d-aide">${t(FR.aide, 'drag: rotate · wheel: zoom · click: info')}</div>
      <div class="v3d-attr" id="v3d-attr"></div>
      <div class="v3d-alt" id="v3d-alt"></div>
      <div class="v3d-etat" id="v3d-etat">${t(FR.chargement, 'Loading buildings…')}</div>
      <aside class="v3d-fiche" id="v3d-fiche" hidden></aside>
    </div>`;

  document.body.appendChild(racine);
  document.body.classList.add('v3d-ouvert');

  const cv = racine.querySelector('#v3d-cv');
  const g = cv.getContext('2d');
  const fiche = racine.querySelector('#v3d-fiche');
  const etat = racine.querySelector('#v3d-etat');
  const q = id => racine.querySelector(id);

  /* ── état ── */
  const V = globalThis.FMVue3D;
  const et = {
    cap: 0, inclinaison: o.inclinaison ?? 50, heure: o.heure ?? 12,
    palette: 0, rayon: o.rayon, fond: !!o.fondParDefaut, ombres: true,
    selection: null, batiments: o.batiments || [], routes: o.routes || [],
    terrain: o.terrain || null, relief: true,   // le relief est acquis par défaut ; la case le débraye
    eaux: o.eaux || [], images: new Map(), chargement: 0
  };

  /* ── taille du canevas ── */
  function dimensionner() {
    const r = racine.querySelector('.v3d-scene').getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.max(320, Math.floor(r.width * dpr));
    cv.height = Math.max(240, Math.floor(r.height * dpr));
    cv.style.width = r.width + 'px';
    cv.style.height = r.height + 'px';
  }

  /* ── fond de carte : tuiles OSM carrées, plaquées en perspective ── */
  const ZOOM_TUILE = rayon => rayon <= 400 ? 17 : rayon <= 800 ? 16 : rayon <= 1600 ? 15 : 14;
  const GABARIT = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

  function chargerFond() {
    const z = ZOOM_TUILE(et.rayon);
    for (const tuile of V.tuilesPour(o.lat, o.lon, et.rayon * 1.15, z)) {
      const cle = z + '/' + tuile.x + '/' + tuile.y;
      if (et.images.has(cle)) continue;
      const img = new Image();
      img.crossOrigin = 'anonymous';                 // indispensable pour l'export PNG
      et.images.set(cle, { ...tuile, image: img, taille: 256, z });
      img.onload = () => dessiner();
      img.src = V.urlTuile(GABARIT, tuile);
    }
  }

  /* ── rendu ── */
  let dernier = null;
  function dessiner() {
    if (!V) return;
    const cam = V.camera({
      lat: o.lat, lon: o.lon, rayon: et.rayon, cap: et.cap,
      inclinaison: et.inclinaison, largeur: cv.width, hauteur: cv.height, recul: 1.08
    });
    const soleil = V.soleil(V.instantLocal(et.heure, o.lat, o.lon), o.lat, o.lon);
    const sc = V.scene(et.batiments, cam, {
      palette: et.palette, soleil, echelleH: 4,
      terrain: et.relief ? et.terrain : null,
      /* sans ombre : le soleil monte au zénith, les ombres disparaissent */
      ...(et.ombres ? {} : { soleil: { hauteur: Math.PI / 2, azimut: 180, vecteur: [0, 0, 1] } })
    });
    dernier = { cam, sc, soleil };
    const fond = et.fond && et.images.size
      ? { images: [...et.images.values()].filter(x => x.image.complete && x.image.naturalWidth), taille: 256, opacite: 0.92, subdivisions: 4 }
      : null;
    V.dessiner(g, sc, {
      fond, selection: et.selection,
      opaciteOmbre: 0.30,
      routes: et.routes.length ? et.routes : null
    });
    /* voirie et eau : le moteur les trace en SVG, on les redessine ici */
    if (et.routes.length || et.eaux.length) {
      g.save();
      g.globalAlpha = 0.6;
      g.strokeStyle = sc.pal.voie;
      g.fillStyle = sc.pal.eau;
      for (const eau of et.eaux) {
        const p = eau.map(c => cam.proj(c[0], c[1], 0));
        if (p.some(x => !x)) continue;
        g.beginPath(); g.moveTo(p[0][0], p[0][1]);
        for (let i = 1; i < p.length; i++) g.lineTo(p[i][0], p[i][1]);
        g.closePath(); g.fill();
      }
      g.lineCap = 'round';
      for (const r of et.routes) {
        const p = r.g.map(c => cam.proj(c[0], c[1], 0));
        if (p.some(x => !x)) continue;
        g.lineWidth = 1.4 * cam.focal / cam.distance;
        g.beginPath(); g.moveTo(p[0][0], p[0][1]);
        for (let i = 1; i < p.length; i++) g.lineTo(p[i][0], p[i][1]);
        g.stroke();
      }
      g.restore();
    }
    q('#v3d-attr').innerHTML = et.fond
      ? '© ' + t('contributeurs OpenStreetMap', 'OpenStreetMap contributors')
      : '';
  }

  /* ── interactions ── */
  let glisse = null;
  cv.addEventListener('pointerdown', e => {
    glisse = { x: e.clientX, y: e.clientY, cap: et.cap, inc: et.inclinaison, bouge: false };
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointermove', e => {
    if (!glisse) return;
    const dx = e.clientX - glisse.x, dy = e.clientY - glisse.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) glisse.bouge = true;
    et.cap = Math.max(-180, Math.min(180, glisse.cap - dx * 0.35));
    et.inclinaison = Math.max(0, Math.min(80, glisse.inc + dy * 0.25));
    q('#v3d-cap').value = et.cap;
    q('#v3d-inc').value = et.inclinaison;
    dessiner();
  });
  cv.addEventListener('pointerup', e => {
    if (glisse && !glisse.bouge) cliquer(e);
    glisse = null;
  });
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    et.rayon = Math.max(200, Math.min(3000, et.rayon * (e.deltaY > 0 ? 1.12 : 0.89)));
    if (et.fond) chargerFond();
    dessiner();
  }, { passive: false });

  function cliquer(e) {
    if (!dernier) return;
    const r = cv.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width * cv.width;
    const y = (e.clientY - r.top) / r.height * cv.height;
    const b = V.designer(dernier.sc, x, y);
    et.selection = b;
    afficherFiche(b, x, y);
    dessiner();
  }

  function afficherFiche(b, x, y) {
    if (!b) { fiche.hidden = true; return; }
    const lignes = [];
    lignes.push(['ID', b.id]);
    lignes.push([t('hauteur', 'height'), (b.h > 0 ? b.h.toFixed(1) + ' m' : t('estimée (9 m)', 'estimated (9 m)'))]);
    if (b.minH) lignes.push([t('socle', 'base'), b.minH.toFixed(1) + ' m']);
    if (b.hauteurToit) lignes.push([t('toit', 'roof'), b.hauteurToit.toFixed(1) + ' m']);
    if (b.t && b.t !== 'yes') lignes.push([t('usage', 'use'), b.t]);
    if (b.couleur) lignes.push([t('couleur', 'colour'), b.couleur]);
    if (b.nom) lignes.push([t('nom', 'name'), b.nom]);
    lignes.push([t('source', 'source'), b.source === 'osmbuildings' ? 'osmbuildings.org' : 'OpenStreetMap (Overpass)']);
    fiche.hidden = false;
    fiche.innerHTML = '<h4>' + t('Fiche du bâtiment', 'Building info') + '</h4>' +
      lignes.map(([k, v]) => '<div class="v3d-l"><span>' + k + '</span><b>' + String(v) + '</b></div>').join('') +
      '<button id="v3d-ff">' + t('Fermer la fiche', 'Close') + '</button>';
    fiche.querySelector('#v3d-ff').addEventListener('click', () => { et.selection = null; fiche.hidden = true; dessiner(); });
  }

  /* ── contrôles ── */
  q('#v3d-h').addEventListener('input', e => {
    et.heure = Number(e.target.value);
    q('#v3d-hv').textContent = et.heure + ' h';
    dessiner();
  });
  q('#v3d-cap').addEventListener('input', e => { et.cap = Number(e.target.value); dessiner(); });
  q('#v3d-inc').addEventListener('input', e => { et.inclinaison = Number(e.target.value); dessiner(); });
  q('#v3d-pal').addEventListener('input', e => { et.palette = Number(e.target.value); dessiner(); });
  q('#v3d-ombres').addEventListener('change', e => { et.ombres = e.target.checked; dessiner(); });
  q('#v3d-relief').addEventListener('change', async e => {
    et.relief = e.target.checked;
    if (et.relief && !et.terrain) await chargerRelief();
    dessiner();
  });
  q('#v3d-fond').addEventListener('change', e => {
    et.fond = e.target.checked;
    if (et.fond) chargerFond();
    dessiner();
  });

  q('#v3d-svg').addEventListener('click', () => {
    const svg = V.versSVG(et.batiments, {
      lat: o.lat, lon: o.lon, rayon: et.rayon, cap: et.cap, inclinaison: et.inclinaison,
      palette: et.palette, largeur: 1600, hauteur: 1200, echelleH: 4,
      routes: et.routes, eaux: et.eaux, terrain: et.relief ? et.terrain : null,
      soleil: V.soleil(V.instantLocal(et.heure, o.lat, o.lon), o.lat, o.lon),
      attribution: et.fond ? '© OpenStreetMap contributors (ODbL)' : '© OpenStreetMap contributors (ODbL) · UrbaTrame'
    });
    telecharger(new Blob([svg], { type: 'image/svg+xml' }), 'urbatrame-vue3d.svg');
  });
  q('#v3d-png').addEventListener('click', () => {
    cv.toBlob(b => telecharger(b, 'urbatrame-vue3d.png'), 'image/png');
  });
  q('#v3d-fermer').addEventListener('click', fermer);
  racine.addEventListener('keydown', e => { if (e.key === 'Escape') fermer(); });
  const surTouche = e => {
    if (e.key === 'Escape') { fermer(); return; }
    if (e.key === 'ArrowLeft') { et.cap -= 5; q('#v3d-cap').value = et.cap; dessiner(); }
    if (e.key === 'ArrowRight') { et.cap += 5; q('#v3d-cap').value = et.cap; dessiner(); }
    if (e.key === 'ArrowUp') { et.inclinaison = Math.min(80, et.inclinaison + 3); q('#v3d-inc').value = et.inclinaison; dessiner(); }
    if (e.key === 'ArrowDown') { et.inclinaison = Math.max(0, et.inclinaison - 3); q('#v3d-inc').value = et.inclinaison; dessiner(); }
  };
  window.addEventListener('keydown', surTouche);
  const surRedim = () => { dimensionner(); dessiner(); };
  window.addEventListener('resize', surRedim);

  function telecharger(blob, nom) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nom;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  function fermer() {
    window.removeEventListener('keydown', surTouche);
    window.removeEventListener('resize', surRedim);
    racine.remove();
    document.body.classList.remove('v3d-ouvert');
    if (o.onFermer) o.onFermer();
  }

  /* ── données : Overpass d'abord, tuiles en option ── */
  async function charger(source) {
    etat.hidden = false;
    etat.textContent = t(FR.chargement, 'Loading buildings…');
    try {
      if (source === 'tuiles') {
        const z = ZOOM_TUILE(et.rayon);
        const tuiles = V.tuilesPour(o.lat, o.lon, et.rayon * 1.05, z);
        const lots = await Promise.all(tuiles.map(async tuile => {
          const r = await fetch(V.urlTuile('https://a.data.osmbuildings.org/0.2/59fcc2e8/tile/{z}/{x}/{y}.json', tuile));
          return r.ok ? batimentsDepuisTuiles(await r.json()) : [];
        }));
        et.batiments = lots.flat();
        if (!et.batiments.length) throw new Error('VIDE');
        etat.textContent = t('source : tuiles osmbuildings.org', 'source: osmbuildings.org tiles') +
          ' · ' + et.batiments.length + ' ' + t('bâtiments', 'buildings');
      } else {
        if (o.batiments && o.batiments.length) {
          et.batiments = o.batiments;
          etat.textContent = et.batiments.length + ' ' + t('bâtiments', 'buildings') +
            ' · ' + et.batiments.filter(b => b.h > 0).length + ' ' + t('avec hauteur', 'with height');
        } else {
          const r = await fetch('/analysis/2d', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'buildings', device: o.device, lat: o.lat, lon: o.lon, radius: et.rayon,
              account: o.compte, token: o.jeton
            })
          });
          const d = await r.json();
          if (!d.ok) throw Object.assign(new Error(d.error || 'ÉCHEC'), d);
          et.batiments = batimentsDepuisOverpass(d.elements);
          etat.textContent = et.batiments.length + ' ' + t('bâtiments', 'buildings') +
            ' · ' + et.batiments.filter(b => b.h > 0).length + ' ' + t('avec hauteur', 'with height');
        }
      }
      if (et.relief && !et.terrain) await chargerRelief();
      etat.hidden = true;
    } catch (e) {
      etat.hidden = false;
      etat.className = 'v3d-etat erreur';
      etat.textContent = (e.error === 'MAP_SOURCE_UNAVAILABLE' || e.message === 'ÉCHEC')
        ? t('Source cartographique injoignable — réessayez dans une minute.',
            'Map source unreachable — try again in a minute.')
        : t('Bâtiments indisponibles : ', 'Buildings unavailable: ') + (e.error || e.message);
    }
    dessiner();
  }

  /* Relief : grille d'altitudes (tuiles Terrarium), servie par l'action
     `terrain` — la même que l'analyse « relief » du catalogue. */
  async function chargerRelief() {
    if (et.terrain) return;
    try {
      const r = await fetch('/analysis/2d', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'terrain', device: o.device, lat: o.lat, lon: o.lon,
          radius: et.rayon, n: 24, account: o.compte, token: o.jeton
        })
      });
      const d = await r.json();
      if (d.ok && d.grid?.length) {
        et.terrain = d;
        q('#v3d-relief').checked = true;
        et.relief = true;
        const v = d.grid.flat();
        q('#v3d-alt').textContent = Math.round(Math.min(...v)) + '–' + Math.round(Math.max(...v)) + ' m';
      } else {
        q('#v3d-relief').checked = false;
        et.relief = false;
      }
    } catch { q('#v3d-relief').checked = false; et.relief = false; }
  }

  dimensionner();
  charger(o.source || 'overpass');
  q('#v3d-alt').textContent = et.terrain
    ? (() => { const v = et.terrain.grid.flat(); return Math.round(Math.min(...v)) + '–' + Math.round(Math.max(...v)) + ' m'; })()
    : '';
  if (et.fond) chargerFond();
  dessiner();

  return { fermer, recharger: charger, etat: et, dessiner };
}
