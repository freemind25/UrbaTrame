/* Altiplan · panneau des exports (plan DXF, coupe, modèle 3D)
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
import { vectorMapSVG } from './vector-map.mjs';
import { arbresDepuisRangées } from './osm-data.mjs';

export function ouvrirExports(o) {
  const lang = o.langue === 'en' ? 'en' : 'fr';
  const t = (fr, en) => (lang === 'en' ? en : fr);
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const siteLabel = escapeHTML(o.nom || '');
  const V = globalThis.FMVue3D;

  /* ── contexte de rendu attendu par les exports (même forme que les analyses) ── */
  const ctx = {
    sLat: o.lat, sLng: o.lon, curR: o.rayon, siteName: o.nom || '',
    shape: o.shape === 'square' ? 'square' : 'circle', boundary: Array.isArray(o.boundary) ? o.boundary : [],
    lang, D: o.D || { roads: [], build: [], green: [], pois: [] }, terrain: o.terrain || null
  };

  const racine = document.createElement('div');
  racine.className = 'xpt';
  racine.innerHTML = `
    <div class="xpt-barre">
      <strong>${t('Exports', 'Exports')}</strong>
      <span class="xpt-site">${siteLabel}</span>
      <nav class="xpt-onglets">
        <button data-ong="plan" class="on">${t('Plan DXF', 'DXF plan')}</button>
        <button data-ong="carte">${t('Carte vectorielle', 'Vector map')}</button>
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
            <label><input type="checkbox" data-couche="BATI" checked> ${t('Bâtiments', 'Buildings')}</label>
            <label><input type="checkbox" data-couche="VOIRIE" checked> ${t('Voirie (axes)', 'Road centre lines')}</label>
            <label><input type="checkbox" id="xpt-road-width" checked> ${t('Surfaces · largeur OSM ou estimation', 'Road surfaces · OSM width or estimate')}</label>
            <label><input type="checkbox" data-couche="BRIDGES" checked> ${t('Ponts et ouvrages balisés', 'Mapped bridges and structures')}</label>
            <label><input type="checkbox" data-couche="RAIL" checked> ${t('Réseau ferré', 'Railways')}</label>
            <label><input type="checkbox" data-couche="EAU" checked> ${t('Eau', 'Water')}</label>
            <label><input type="checkbox" data-couche="VERT" checked> ${t('Végétation', 'Green space')}</label>
            <label><input type="checkbox" data-couche="USAGE" checked> ${t('Occupation du sol', 'Land use')}</label>
            <label><input type="checkbox" data-couche="PARCELLES" checked> ${t('Parcelles OSM', 'OSM parcels')}</label>
            <label><input type="checkbox" data-couche="ARBRES" checked> ${t('Arbres OSM', 'OSM trees')}</label>
            <label><input type="checkbox" data-couche="POI" checked> ${t('Points d’intérêt', 'Points of interest')}</label>
            <label><input type="checkbox" data-couche="EMPRISE" checked> ${t('Emprise de calcul', 'Study footprint')}</label>
            <label><input type="checkbox" data-couche="SITE"> ${t('Limite de projet tracée (non cadastrale)', 'User-drawn project boundary (not cadastral)')}</label>
            <label><input type="checkbox" data-couche="TEXTE" checked> ${t('Cartouche', 'Title block')}</label>
          </fieldset>
          <div class="xpt-actions">
            <button class="primary" id="xpt-dxf">${t('Télécharger le plan .dxf', 'Download plan .dxf')}</button>
            <button id="xpt-plan-png">PNG</button>
            <button id="xpt-plan-svg">SVG</button>
          </div>
          <p class="xpt-note" id="xpt-n-plan"></p>
          <p class="xpt-warning">${t('Les parcelles viennent exclusivement d’OpenStreetMap : leur présence est rare et elles n’ont aucune valeur cadastrale ou juridique.',
            'Parcel outlines come only from OpenStreetMap: coverage is sparse and they are not legal cadastral boundaries.')}</p>
          <p class="xpt-note">${t('DXF R12 (AC1009), unités en mètres. Les bâtiments portent leur hauteur en Z ; dans un logiciel de CAO, EXTRUDE en fait des volumes.',
            'DXF R12 (AC1009), in metres. Building footprints carry height in Z; use EXTRUDE in a CAD program to make volumes.')}</p>
        </div>
        <div class="xpt-col xpt-apercu" id="xpt-ap-plan"></div>
      </section>

      <section data-pan="carte" hidden>
        <div class="xpt-col">
          <h4>${t('Carte vectorielle', 'Vector map')}</h4>
          <p class="xpt-note">${t('Composez une planche éditable en SVG ou PNG. Les styles, le relief, les couches et les repères s’appliquent aux mêmes données du site.',
            'Compose an editable SVG or PNG map. Styles, relief, layers and annotations use the same site data.')}</p>
          <label class="xpt-l"><span>${t('Style', 'Preset')}</span>
            <select id="xpt-map-preset"><option value="classic">${t('Classique', 'Classic')}</option><option value="figure-ground">Figure / fond</option><option value="relief">${t('Relief', 'Relief')}</option><option value="night">${t('Nocturne', 'Night')}</option><option value="blueprint">Blueprint</option></select>
          </label>
          <label class="xpt-l"><span>${t('Échelle d’impression', 'Print scale')}</span>
            <select id="xpt-map-scale"><option value="fit">${t('Ajuster à la feuille', 'Fit to page')}</option><option value="2000">1:2 000</option><option value="5000">1:5 000</option><option value="10000">1:10 000</option><option value="25000">1:25 000</option></select>
          </label>
          <fieldset class="xpt-couches"><legend>${t('Couches', 'Layers')}</legend>
            <label><input type="checkbox" data-map-layer="buildings" checked> ${t('Bâtiments', 'Buildings')}</label>
            <label><input type="checkbox" data-map-layer="roads" checked> ${t('Voirie · largeur réelle/estimée', 'Roads · mapped/estimated width')}</label>
            <label><input type="checkbox" data-map-layer="bridges" checked> ${t('Ponts et ouvrages', 'Bridges and structures')}</label>
            <label><input type="checkbox" data-map-layer="rail" checked> ${t('Réseau ferré', 'Rail')}</label>
            <label><input type="checkbox" data-map-layer="water" checked> ${t('Eau', 'Water')}</label>
            <label><input type="checkbox" data-map-layer="green" checked> ${t('Espaces verts', 'Green areas')}</label>
            <label><input type="checkbox" data-map-layer="trees" checked> ${t('Arbres OSM', 'OSM trees')}</label>
            <label><input type="checkbox" data-map-layer="contours" checked> ${t('Courbes de niveau', 'Contours')}</label>
            <label><input type="checkbox" data-map-layer="labels"> ${t('Noms des lieux et bâtiments', 'Place and building labels')}</label>
            <label><input type="checkbox" data-map-layer="siteBoundary"> ${t('Limite de projet tracée · non cadastrale', 'User-drawn project boundary · not cadastral')}</label>
            <label><input type="checkbox" data-map-layer="grid"> ${t('Grille métrique', 'Metric grid')}</label>
          </fieldset>
          <label class="xpt-couches"><input type="checkbox" id="xpt-map-class" checked> ${t('Colorer les bâtiments par type', 'Colour buildings by type')}</label>
          <label class="xpt-l"><span>${t('Direction du soleil', 'Sun direction')}</span><input id="xpt-map-azimuth" type="range" min="0" max="359" value="315"></label>
          <label class="xpt-l"><span>${t('Hauteur solaire', 'Sun height')}</span><input id="xpt-map-sun-height" type="range" min="5" max="85" value="35"></label>
          <label class="xpt-l"><span>${t('Intensité des ombres', 'Shadow strength')}</span><input id="xpt-map-shadow" type="range" min="0" max="70" value="18"></label>
          <label class="xpt-l"><span>${t('Ombrage du relief', 'Hillshade')}</span><input id="xpt-map-hillshade" type="range" min="0" max="100" value="30"></label>
          <label class="xpt-l"><span>${t('Profondeur du relief', 'Terrain depth')}</span><input id="xpt-map-depth" type="range" min="0" max="70" value="18"></label>
          <label class="xpt-l"><span>${t('Couleur des routes', 'Road colour')} <input id="xpt-map-road-color" type="color" value="#D7C8AA"></span></label>
          <label class="xpt-l"><span>${t('Couleur uniforme des bâtiments', 'Single building colour')} <input id="xpt-map-building-color" type="color" value="#BEB8AB"></span></label>
          <fieldset class="xpt-couches xpt-map-colors"><legend>${t('Couleurs par type de bâtiment', 'Building type colours')}</legend>
            <label>${t('Résidentiel', 'Residential')} <input type="color" data-map-class-color="residential" value="#D9C7A7"></label>
            <label>${t('Public', 'Public')} <input type="color" data-map-class-color="public" value="#91B7D3"></label>
            <label>${t('Commercial', 'Commercial')} <input type="color" data-map-class-color="commercial" value="#D5A36C"></label>
            <label>${t('Industriel', 'Industrial')} <input type="color" data-map-class-color="industrial" value="#AFA5C2"></label>
            <label>${t('Annexe', 'Utility')} <input type="color" data-map-class-color="utility" value="#AAB09A"></label>
            <label>${t('Autre', 'Other')} <input type="color" data-map-class-color="other" value="#B7B5AF"></label>
          </fieldset>
          <label class="xpt-l"><span>${t('Épaisseur de trait', 'Outline weight')}</span><input id="xpt-map-outline" type="range" min="0.5" max="3" value="1" step="0.1"></label>
          <div class="xpt-actions"><button id="xpt-map-reset">${t('Réinitialiser', 'Reset colours')}</button><button id="xpt-map-svg" class="primary">SVG</button><button id="xpt-map-png">PNG</button></div>
          <p class="xpt-note" id="xpt-map-note"></p>
          <p class="xpt-warning">${t('Une limite tracée par l’utilisateur est un repère de projet, pas une limite cadastrale. Les largeurs sans valeur OSM sont des estimations par catégorie de voie.',
            'A user-drawn outline is a project marker, not a cadastral boundary. Missing OSM widths are estimated by road class.')}</p>
        </div>
        <div class="xpt-col xpt-apercu" id="xpt-ap-carte"></div>
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
            <label><input type="checkbox" id="xpt-m-bati" checked> ${t('Bâtiments (murs et toits)', 'Buildings (walls and roofs)')}</label>
            <label><input type="checkbox" id="xpt-m-arbres" checked> ${t('Arbres OSM (volumes simplifiés)', 'OSM trees (simplified meshes)')}</label>
          </fieldset>
          <div class="xpt-time"><label for="xpt-heure">${t('Soleil local · ombres', 'Local sun · shadows')}</label><strong id="xpt-heure-v">15:00</strong></div>
          <input id="xpt-heure" type="range" min="5" max="20" step="1" value="15" aria-label="Heure solaire locale">
          <p class="xpt-note" id="xpt-n-modele"></p>
          <div class="xpt-actions">
            <button class="primary" id="xpt-obj">${t('Télécharger .obj', 'Download .obj')}</button>
            <button class="primary" id="xpt-stl">${t('Télécharger .stl', 'Download .stl')}</button>
            <button id="xpt-3d-png">${t('Aperçu .png', 'Preview .png')}</button>
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
  if (Array.isArray(o.include)) {
    const include = new Set(o.include);
    const sourceLayer = {
      BATI: 'buildings', VOIRIE: 'roads', EAU: 'water', VERT: 'landuse',
      USAGE: 'landuse', RAIL: 'rail', PARCELLES: 'parcels', ARBRES: 'trees', POI: 'pois'
    };
    racine.querySelectorAll('input[data-couche]').forEach(box => {
      const source = sourceLayer[box.dataset.couche];
      if (source) box.checked = include.has(source);
    });
    q('#xpt-m-bati').checked = include.has('buildings');
    q('#xpt-m-arbres').checked = include.has('trees');
  }
  const siteBoundaryLayer = q('[data-couche="SITE"]');
  siteBoundaryLayer.disabled = ctx.boundary.length < 3;
  siteBoundaryLayer.checked = ctx.boundary.length >= 3;
  const mapBoundaryLayer = q('[data-map-layer="siteBoundary"]');
  mapBoundaryLayer.disabled = ctx.boundary.length < 3;
  mapBoundaryLayer.checked = ctx.boundary.length >= 3;
  if (!ctx.terrain) { q('#xpt-m-sol').checked = false; q('#xpt-m-sol').disabled = true; }

  /* ── état local ── */
  const et = {
    onglet: 'plan', A: null, B: null, plan: null, coupe: null, scene: null, map: null, mapSvg: '', chargement: false
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
    return 'urbatrame-atelier-' + site + '-' + quoi + '.' + ext;
  };
  const optionsPlan = () => {
    const avec = [...racine.querySelectorAll('[data-couche]')].filter(c => c.checked).map(c => c.dataset.couche);
    const roadWidths = q('#xpt-road-width').checked;
    if (roadWidths) avec.push('ROADS_AREA', 'PATHS_AREA');
    return {
      geolocate: q('#xpt-repere').value === 'utm', shape: ctx.shape, boundary: ctx.boundary,
      roadWidths, bridges: avec.includes('BRIDGES'), equidistance: Number(q('#xpt-equi').value) || 0,
      hauteurBati: Number(q('#xpt-hb').value) || 9, avec, titre: o.nom || 'UrbaTrame · Altiplan'
    };
  };

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

  function vectorMap() {
    const layers = Object.fromEntries([...racine.querySelectorAll('[data-map-layer]')]
      .map(box => [box.dataset.mapLayer, box.checked]));
    const result = vectorMapSVG(ctx, {
      width: 1587, height: 1122, title: o.nom || 'UrbaTrame · Altiplan', lang,
      shape: ctx.shape, boundary: ctx.boundary, preset: q('#xpt-map-preset').value,
      printScale: q('#xpt-map-scale').value, layers,
      colorByType: q('#xpt-map-class').checked,
      sunAzimuth: Number(q('#xpt-map-azimuth').value), sunHeight: Number(q('#xpt-map-sun-height').value),
      shadowStrength: Number(q('#xpt-map-shadow').value) / 100,
      hillshadeStrength: Number(q('#xpt-map-hillshade').value) / 100,
      depthMapStrength: Number(q('#xpt-map-depth').value) / 100,
      outlineWeight: Number(q('#xpt-map-outline').value), grid: layers.grid,
      northArrow: true, scaleBar: true, outline: true,
      classColors: Object.fromEntries([...racine.querySelectorAll('[data-map-class-color]')]
        .map(input => [input.dataset.mapClassColor, input.value])),
      colors: { road: q('#xpt-map-road-color').value, building: q('#xpt-map-building-color').value }
    });
    et.map = result; et.mapSvg = result.svg;
    q('#xpt-ap-carte').innerHTML = result.svg;
    const { buildings, trees, roadsKm } = result.stats;
    q('#xpt-map-note').textContent = [
      `${buildings.toLocaleString(lang === 'en' ? 'en-GB' : 'fr-FR')} ${t('bâtiments', 'buildings')}`,
      `${roadsKm.toFixed(1)} km ${t('de voies', 'of roads')}`,
      `${trees.toLocaleString(lang === 'en' ? 'en-GB' : 'fr-FR')} ${t('arbres OSM', 'OSM trees')}`,
      result.fitsPage ? `${t('échelle', 'scale')} 1:${result.scale.toLocaleString(lang === 'en' ? 'en-GB' : 'fr-FR')}` : t('emprise trop grande à cette échelle · choisissez “Ajuster” ou une échelle plus petite', 'site does not fit at this scale · choose “Fit” or a smaller scale')
    ].join(' · ');
    return result;
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
    for (const p of D.parcels || []) {
      const pts = (p.g || []).map(([la, lo]) => px(la, lo).map(v => v.toFixed(1)).join(','));
      if (pts.length > 2) s += `<polyline points="${pts.join(' ')}" fill="none" stroke="#B77D61" stroke-width=".7"/>`;
    }
    for (const b of D.build || []) {
      const pts = (b.g || []).map(([la, lo]) => px(la, lo).map(v => v.toFixed(1)).join(','));
      if (pts.length > 2) s += `<polygon points="${pts.join(' ')}" fill="#2E2C28" fill-opacity=".82"/>`;
    }
    for (const tree of (D.trees || []).slice(0, 1200)) {
      const [x, y] = px(tree.lat, tree.lon);
      s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.5" fill="#3E8053"/>`;
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
    q('#xpt-ap-coupe').innerHTML = X.coupeSVG(C, { titre: o.nom || 'UrbaTrame · Altiplan', lang, largeur: 760, hauteur: 360 }).svg;
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
    const largeur = 720, hauteur = 520;
    const bati = q('#xpt-m-bati').checked ? ctx.D.build || [] : [];
    const avecRelief = q('#xpt-m-sol').checked && ctx.terrain;
    const arbres = q('#xpt-m-arbres').checked
      ? [...(ctx.D.trees || []), ...arbresDepuisRangées(ctx.D.treeRows || [])] : [];
    const heure = Number(q('#xpt-heure').value) || 15;
    const jour = new Date().toISOString().slice(0, 10);
    const soleil = V.soleil(V.instantLocal(heure, ctx.sLat, ctx.sLng, jour), ctx.sLat, ctx.sLng);
    q('#xpt-heure-v').textContent = String(heure).padStart(2, '0') + ':00';
    const r = V.corpsSVG(bati, {
      routes: ctx.D.roads || [],
      eaux: (ctx.D.green || []).filter(x => x.k === 'w').map(x => x.g),
      terrain: avecRelief ? ctx.terrain : null,
      lat: ctx.sLat, lon: ctx.sLng, rayon: ctx.curR,
      cap: 35, inclinaison: 42, largeur, hauteur, palette: 0, soleil, echelleH: 1
    });
    const sc = r.sc;
    sc.arbres = arbres.map(tree => {
      const [x, y] = r.cam.toLocal(tree.lat, tree.lon);
      return { x, y, z: sc.terrain?.z(tree.lat, tree.lon) || 0, h: Number(tree.h) || 6, r: Math.max(1, (Number(tree.h) || 6) * .22) };
    }).filter(tree => Math.hypot(tree.x, tree.y) <= r.cam.rayon + 1e-6);
    et.scene = sc;
    const M = X.maillageDeScene(sc, { sol: !!avecRelief, arbres: q('#xpt-m-arbres').checked });
    const tri = M.faces.reduce((sum, f) => sum + Math.max(0, f.pts.length - 2), 0);
    q('#xpt-n-modele').textContent = [
      bati.length + t(' bâtiments', ' buildings'),
      sc.arbres.length + t(' arbres', ' trees'),
      M.sommets.length.toLocaleString(lang === 'en' ? 'en-GB' : 'fr-FR') + t(' sommets', ' vertices'),
      M.faces.length.toLocaleString(lang === 'en' ? 'en-GB' : 'fr-FR') + t(' faces', ' faces'),
      tri.toLocaleString(lang === 'en' ? 'en-GB' : 'fr-FR') + t(' triangles STL', ' STL triangles'),
      t('référence ', 'datum ') + (sc.terrainRef || 0).toFixed(1) + ' m'
    ].join(' · ');
    let arbresSVG = '<g fill="#43865a" stroke="#fff" stroke-width=".7">';
    for (const tree of sc.arbres) {
      const p = r.cam.ecran(r.cam.projLocal(tree.x, tree.y, tree.z + tree.h * .62));
      if (p && p[0] >= 0 && p[0] <= largeur && p[1] >= 0 && p[1] <= hauteur)
        arbresSVG += `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${Math.max(2, Math.min(6, tree.h * .35)).toFixed(1)}"/>`;
    }
    arbresSVG += '</g>';
    const label = t('Soleil local ', 'Local solar time ') + String(heure).padStart(2, '0') + ':00 · ' +
      (soleil.hauteur > 0.02 ? t('ombres portées actives', 'shadows on') : t('soleil sous l’horizon', 'sun below horizon'));
    q('#xpt-ap-modele').innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${largeur} ${hauteur}" width="${largeur}" height="${hauteur}" role="img">${r.svg}${arbresSVG}<text x="14" y="${hauteur - 25}" font-family="sans-serif" font-size="10" fill="#4b554e">${label}</text><text x="${largeur - 14}" y="${hauteur - 9}" text-anchor="end" font-family="sans-serif" font-size="8" fill="#59645b">© OpenStreetMap contributors · relief Terrarium</text></svg>`;
    et.modeleSvg = q('#xpt-ap-modele').innerHTML;
    return sc;
  }

  /* ── aiguillage ── */
  function dessiner() {
    if (et.onglet === 'plan') plan();
    else if (et.onglet === 'carte') vectorMap();
    else if (et.onglet === 'coupe') { dessinerMini(); coupe(); }
    else scene3d();
  }

  /* ── actions ── */
  for (const s of ['#xpt-repere', '#xpt-equi', '#xpt-hb'])
    q(s).addEventListener('change', () => { if (et.onglet === 'plan') plan(); });
  for (const c of racine.querySelectorAll('[data-couche]'))
    c.addEventListener('change', () => { if (et.onglet === 'plan') plan(); });
  q('#xpt-road-width').addEventListener('change', () => { if (et.onglet === 'plan') plan(); });
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

  for (const control of racine.querySelectorAll('[data-map-layer], [data-map-class-color], #xpt-map-preset, #xpt-map-scale, #xpt-map-class, #xpt-map-azimuth, #xpt-map-sun-height, #xpt-map-shadow, #xpt-map-hillshade, #xpt-map-depth, #xpt-map-road-color, #xpt-map-building-color, #xpt-map-outline')) {
    control.addEventListener(control.type === 'range' || control.type === 'color' ? 'input' : 'change', () => {
      if (et.onglet === 'carte') vectorMap();
    });
    if (control.type === 'range' || control.type === 'color') control.addEventListener('change', () => {
      if (et.onglet === 'carte') vectorMap();
    });
  }
  q('#xpt-map-reset').addEventListener('click', () => {
    q('#xpt-map-preset').value = 'classic';
    q('#xpt-map-road-color').value = '#D7C8AA';
    q('#xpt-map-building-color').value = '#BEB8AB';
    for (const input of racine.querySelectorAll('[data-map-class-color]')) input.value = ({ residential: '#D9C7A7', public: '#91B7D3', commercial: '#D5A36C', industrial: '#AFA5C2', utility: '#AAB09A', other: '#B7B5AF' })[input.dataset.mapClassColor];
    q('#xpt-map-azimuth').value = 315; q('#xpt-map-sun-height').value = 35;
    q('#xpt-map-shadow').value = 18; q('#xpt-map-hillshade').value = 30; q('#xpt-map-depth').value = 18;
    if (et.onglet === 'carte') vectorMap();
  });
  q('#xpt-map-svg').addEventListener('click', () => {
    const mapResult = vectorMap();
    telecharger(mapResult.svg, nomFichier('carte-vectorielle', 'svg'), 'image/svg+xml');
  });
  q('#xpt-map-png').addEventListener('click', async () => {
    const mapResult = vectorMap();
    await versPNG(mapResult.svg, nomFichier('carte-vectorielle', 'png'), 1);
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
    const s = X.coupeSVG(et.coupe, { titre: o.nom || 'UrbaTrame · Altiplan', lang, largeur: 1600, hauteur: 760 });
    telecharger(s.svg, nomFichier('coupe', 'svg'), 'image/svg+xml');
  });
  q('#xpt-c-dxf').addEventListener('click', () => {
    if (!et.coupe) return;
    telecharger(X.dxfCoupe(et.coupe, { titre: o.nom || 'UrbaTrame · Altiplan' }), nomFichier('coupe', 'dxf'), 'application/dxf');
  });
  q('#xpt-c-png').addEventListener('click', async () => {
    if (!et.coupe) return;
    const s = X.coupeSVG(et.coupe, { titre: o.nom || 'UrbaTrame · Altiplan', lang, largeur: 1600, hauteur: 760 });
    await versPNG(s.svg, nomFichier('coupe', 'png'), 1);
  });
  for (const s of ['#xpt-m-sol', '#xpt-m-bati', '#xpt-m-arbres'])
    q(s).addEventListener('change', scene3d);
  q('#xpt-heure').addEventListener('input', scene3d);
  q('#xpt-obj').addEventListener('click', () => {
    const sc = scene3d();
    if (!sc) return;
    telecharger(X.objDeScene(sc, { arbres: q('#xpt-m-arbres').checked }), nomFichier('modele', 'obj'), 'text/plain');
  });
  q('#xpt-stl').addEventListener('click', () => {
    const sc = scene3d();
    if (!sc) return;
    telecharger(X.stlDeScene(sc, { arbres: q('#xpt-m-arbres').checked }), nomFichier('modele', 'stl'), 'model/stl');
  });
  q('#xpt-3d-png').addEventListener('click', async () => {
    scene3d();
    if (!et.modeleSvg) return;
    await versPNG(et.modeleSvg, nomFichier('vue-3d', 'png'), 1);
  });

  const fermer = () => {
    racine.remove();
    document.body.classList.remove('xpt-ouvert');
    document.removeEventListener('keydown', touche);
  };
  const touche = e => { if (e.key === 'Escape') fermer(); };
  q('#xpt-fermer').addEventListener('click', fermer);
  document.addEventListener('keydown', touche);

  etat.textContent = t('données prêtes', 'data ready');
  dessiner();
  return { fermer, etat: et, dessiner };
}
