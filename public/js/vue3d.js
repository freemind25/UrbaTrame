/* Freemap · moteur de vue 3D (volumes bâtis)
   ─────────────────────────────────────────────────────────────────────────
   Reprend, sans aucune dépendance, les fonctions observées sur
   osmbuildings.org (voir maptonap/osmbuildings : RAPPORT.md) :

     • position du soleil (azimut, hauteur) à partir d'une heure locale ;
     • caméra : cap (rotation), inclinaison, distance — projection perspective ;
     • bâtiments extrudés : murs + toits, colorés selon l'ensoleillement ;
     • ombres portées projetées au sol ;
     • fond de carte raster (tuiles carrées plaquées en perspective) ;
     • désignation d'un bâtiment au clic (test point-dans-polygone) ;
     • sortie SVG (planches exportables) et sortie canvas (vue interactive).

   Script classique (comme engine.js) : le module s'installe sur globalThis et
   sert à la fois au navigateur, aux renderers et aux bancs d'essai Node.

   Conventions :
     • coordonnées locales en mètres : x = est, y = nord, z = altitude ;
     • cap et azimut en degrés depuis le nord, dans le sens horaire ;
     • inclinaison en degrés : 0 = vue verticale, 90 = rasante.
   ───────────────────────────────────────────────────────────────────────── */
(function (G) {
  'use strict';

  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const norm360 = a => ((a % 360) + 360) % 360;

  /* ═════════════ 1 · position du soleil ═════════════
     Algorithmes classiques (éphéméride abrégée, précision ~0,1°) : longitude
     moyenne, anomalie moyenne, écliptique, déclinaison, ascension droite, temps
     sidéral — puis vecteur du soleil en coordonnées locales est/nord/haut. */
  function soleil(date, lat, lon) {
    const jd = date.getTime() / 86400000 + 2440587.5;
    const n = jd - 2451545.0;

    const L = norm360(280.460 + 0.9856474 * n);
    const g = norm360(357.528 + 0.9856003 * n) * D2R;
    const lambda = norm360(L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * D2R;
    const eps = (23.439 - 4e-7 * n) * D2R;

    const decl = Math.asin(Math.sin(eps) * Math.sin(lambda));           // déclinaison
    const alpha = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
    const gmst = norm360(280.46061837 + 360.98564736629 * n) * D2R;    // temps sidéral Greenwich
    const lst = gmst + lon * D2R;                                       // temps sidéral local

    let H = lst - alpha;                                                // angle horaire
    H = ((H + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;

    const phi = lat * D2R;
    const up = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(H);
    const east = -Math.cos(decl) * Math.sin(H);
    const north = Math.cos(phi) * Math.sin(decl) - Math.sin(phi) * Math.cos(decl) * Math.cos(H);

    return {
      hauteur: Math.asin(Math.max(-1, Math.min(1, up))),                // altitude, radians
      azimut: norm360(Math.atan2(east, north) * R2D),                   // depuis le nord, horaire
      vecteur: [east, north, up]                                        // vers le soleil
    };
  }

  /* Heure locale du site → instant UTC. On assimile le fuseau du site à sa
     longitude (heure solaire) : suffisant pour une ombre, et sans base de
     fuseaux horaires à embarquer. */
  function instantLocal(heure, lat, lon, jour) {
    const j = jour ? new Date(jour + 'T00:00:00Z') : new Date();
    const base = Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate());
    return new Date(base + (heure - lon / 15) * 3600000);
  }

  /* ═════════════ 2 · caméra ═════════════ */
  function camera(o) {
    const W = o.largeur || 480, H = o.hauteur || 480;
    const R = o.rayon || 600;                       // rayon du site, en mètres
    const cap = (o.cap || 0) * D2R;                 // direction visée
    /* Inclinaison : 0 = vue verticale (zénith), 90 = rasante — même convention
       que le site d'origine (`tilt`). L'angle interne est compté depuis
       l'horizontale : inc = 90 − inclinaison. */
    const pente = Math.max(0, Math.min(89, o.inclinaison ?? 50));
    const incl = (90 - pente) * D2R;
    const fov = (o.champ || 45) * D2R;

    const focal = (Math.min(W, H) / 2) / Math.tan(fov / 2);
    const distance = R / Math.tan(fov / 2) * (o.recul || 1.08);

    /* Repère local : cible au centre du site. */
    const lat0 = o.lat, lon0 = o.lon, cosLat = Math.cos(lat0 * D2R);

    /* Direction de visée (du nord vers la cible), puis position de l'œil. */
    const f = [Math.sin(cap) * Math.cos(incl), Math.cos(cap) * Math.cos(incl), -Math.sin(incl)];
    const cible = [0, 0, 0];
    const oeil = [cible[0] - f[0] * distance, cible[1] - f[1] * distance, cible[2] - f[2] * distance];

    /* Base écran : « droite » = horizontale perpendiculaire à la visée,
       « haut » = droite × visée (vérifié : à l'horizontale, r = est, u = zénith). */
    const rl = Math.hypot(f[1], -f[0]) || 1;
    const r = [f[1] / rl, -f[0] / rl, 0];
    const u2 = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];

    const proche = Math.max(1, distance * 0.02);

    /* lat/lon/altitude → coordonnées locales, puis écran + profondeur.
       Renvoie null quand le point est derrière la caméra. */
    function proj(lat, lon, alt) {
      const x = (lon - lon0) * 111320 * cosLat;
      const y = (lat - lat0) * 111320;
      const z = alt || 0;
      const dx = x - oeil[0], dy = y - oeil[1], dz = z - oeil[2];
      const px = dx * r[0] + dy * r[1] + dz * r[2];
      const py = dx * u2[0] + dy * u2[1] + dz * u2[2];
      const pz = dx * f[0] + dy * f[1] + dz * f[2];
      if (pz <= proche) return null;
      return [W / 2 + focal * px / pz, H / 2 - focal * py / pz, pz];
    }

    /* Même transformation, mais en coordonnées locales (pour les tests et le
       découpage des faces). Renvoie [px, py, pz] dans le repère caméra. */
    function projLocal(x, y, z) {
      const dx = x - oeil[0], dy = y - oeil[1], dz = (z || 0) - oeil[2];
      return [
        dx * r[0] + dy * r[1] + dz * r[2],
        dx * u2[0] + dy * u2[1] + dz * u2[2],
        dx * f[0] + dy * f[1] + dz * f[2]
      ];
    }

    function ecran(p) {
      if (p[2] <= proche) return null;
      return [W / 2 + focal * p[0] / p[2], H / 2 - focal * p[1] / p[2], p[2]];
    }

    return {
      proj, projLocal, ecran, oeil, cible, f, r, u: u2,
      focal, distance, proche, W, H, lat0, lon0, cosLat,
      rayon: R, cap: o.cap || 0, inclinaison: o.inclinaison ?? 45,
      toLocal: (lat, lon) => [(lon - lon0) * 111320 * cosLat, (lat - lat0) * 111320]
    };
  }

  /* ═════════════ 3 · découpage contre le plan proche ═════════════
     Indispensable dès qu'on incline fort : sans cela, un polygone qui passe
     derrière la caméra se replie à l'écran (artefact classique). */
  function decouper(points, proche) {
    const out = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      const ain = a[2] > proche, bin = b[2] > proche;
      if (ain) out.push(a);
      if (ain !== bin) {
        const t = (proche - a[2]) / (b[2] - a[2]);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, proche]);
      }
    }
    return out;
  }

  /* ═════════════ 4 · géométrie des bâtiments ═════════════
     Entrée : [{ g: [[lat,lon],…], h, minH, toit, couleur, couleurToit, nom, … }]
     Sortie : faces projetées, triées de la plus lointaine à la plus proche. */
  const H_DEFAUT = 9;                       // hauteur retenue faute de donnée (m)
  const PAL = [
    { ciel: '#E4EBF3', sol: '#F2EFE9', voie: '#D6D2C8', mur: '#C6BEB0', murN: '#9C9386', toit: '#7E7769', ombre: '#2E2E2C', eau: '#B7D3E2' },
    { ciel: '#D8E3EF', sol: '#EDEFF2', voie: '#CFD6DF', mur: '#B4C1D1', murN: '#8797AB', toit: '#63748A', ombre: '#232A33', eau: '#9CC4DC' },
    { ciel: '#F1E7D6', sol: '#F6F2E9', voie: '#DFD6C4', mur: '#D8C9AE', murN: '#B4A184', toit: '#8E7C60', ombre: '#312A1F', eau: '#C0D6DE' },
    { ciel: '#22262E', sol: '#2E3238', voie: '#3B4048', mur: '#4A4F58', murN: '#383C44', toit: '#5A6068', ombre: '#111318', eau: '#2C4652' }
  ];

  /* Couleur de base d'un mur selon l'usage OSM (faible saturation, comme les
     maquettes d'étude). */
  const TEINTE = {
    residential: ['.94', '.90', '.84'], house: ['.95', '.91', '.86'], apartments: ['.90', '.87', '.84'],
    commercial: ['.88', '.90', '.94'], retail: ['.92', '.89', '.86'], office: ['.86', '.89', '.93'],
    industrial: ['.87', '.87', '.85'], school: ['.93', '.89', '.82'], university: ['.90', '.88', '.85'],
    hospital: ['.94', '.92', '.92'], church: ['.92', '.90', '.86'], mosque: ['.91', '.92', '.88'],
    garage: ['.88', '.88', '.88'], shed: ['.86', '.86', '.84'], hut: ['.90', '.86', '.78']
  };

  function rgb(t) {
    const c = t.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255));
    return 'rgb(' + c.join(',') + ')';
  }
  function hex2rgb(h) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '').trim());
    if (!m) return null;
    const v = parseInt(m[1], 16);
    return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255];
  }
  const melange = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  /* Nuance une couleur selon l'ensoleillement de la face.
     amb : lumière ambiante (0 = nuit noire) · diff : part directe du soleil. */
  /* Teinte d'une facette selon sa normale, en valeurs numériques ; `nuance`
     en donne la version texte. */
  function nuanceN(base, normale, soleilV, k) {
    const dir = soleilV || [0, 0, 1];
    const dot = Math.max(0, normale[0] * dir[0] + normale[1] * dir[1] + normale[2] * dir[2]);
    const lum = k.amb + k.diff * dot;
    const ombree = melange(base, [base[0] * .55 + .04, base[1] * .55 + .04, base[2] * .55 + .05], 0.85);
    return melange(ombree, base, Math.min(1, lum));
  }
  const nuance = (base, normale, soleilV, k) => rgb(nuanceN(base, normale, soleilV, k));

  /* Enveloppe convexe (monotone chain) — sert à unir une emprise et son ombre. */
  function enveloppe(points) {
    if (points.length < 3) return points.slice();
    const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const bas = [], haut = [];
    for (const p of pts) {
      while (bas.length >= 2 && cross(bas[bas.length - 2], bas[bas.length - 1], p) <= 0) bas.pop();
      bas.push(p);
    }
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (haut.length >= 2 && cross(haut[haut.length - 2], haut[haut.length - 1], p) <= 0) haut.pop();
      haut.push(p);
    }
    bas.pop(); haut.pop();
    return bas.concat(haut);
  }

  /* Découpe une emprise en anneaux exploitable (ferme le contour). */
  function anneau(g) {
    const p = (g || []).filter(q => Array.isArray(q) && q.length >= 2 && isFinite(q[0]) && isFinite(q[1]));
    if (p.length < 3) return null;
    const q = p.slice();
    if (q[0][0] !== q[q.length - 1][0] || q[0][1] !== q[q.length - 1][1]) q.push(q[0]);
    return q;
  }

  /* ═════════════ 4 bis · relief (modèle numérique de terrain) ═════════════
     Le serveur fournit une grille régulière d'altitudes (tuiles Terrarium) :
     { n, lat, lon, radius, grid[0..n-1][0..n-1] }, la première ligne au nord,
     la première colonne à l'ouest. On en tire :
       • une altitude interpolée en tout point (les bâtiments s'y posent) ;
       • un maillage de quads pour dessiner le sol, ombré par le relief. */
  const RELIEF_MARGE = 4;      // cellules étendues au-delà de la grille

  function prepareTerrain(t, echelleH) {
    if (!t || !Array.isArray(t.grid) || !t.grid.length) return null;
    const n = t.grid.length;
    const dy = (t.radius || 600) / 111320;
    const dx = dy / Math.cos(t.lat * Math.PI / 180);
    const latTop = t.lat + dy, lonLeft = t.lon - dx;

    const ligne = j => t.grid[Math.max(0, Math.min(n - 1, j))];
    const valeur = (j, i) => {
      const r = ligne(j);
      return r[Math.max(0, Math.min(n - 1, i))] || 0;
    };
    /* Altitude interpolée (bilinéaire), bornée aux bords de la grille. */
    function altitude(lat, lon) {
      const y = Math.max(0, Math.min(n - 1, (latTop - lat) / (2 * dy) * (n - 1)));
      const x = Math.max(0, Math.min(n - 1, (lon - lonLeft) / (2 * dx) * (n - 1)));
      const j = Math.min(n - 2, Math.floor(y)), i = Math.min(n - 2, Math.floor(x));
      const fy = y - j, fx = x - i;
      return (valeur(j, i) * (1 - fy) + valeur(j + 1, i) * fy) * (1 - fx) +
             (valeur(j, i + 1) * (1 - fy) + valeur(j + 1, i + 1) * fy) * fx;
    }
    let mini = Infinity, maxi = -Infinity;
    for (const r of t.grid) for (const v of r) { if (v < mini) mini = v; if (v > maxi) maxi = v; }
    /* Repère local : zéro = altitude du centre du site. Sans ce recalage, un
       site à 630 m d'altitude placerait toute la scène 630 m au-dessus de la
       caméra — rien ne serait visible. `z()` donne donc une altitude relative,
       déjà multipliée par l'exagération. */
    const ref = altitude(t.lat, t.lon);
    const z = (la, lo) => (altitude(la, lo) - ref) * echelleH;
    return { n, grid: t.grid, lat: t.lat, lon: t.lon, dy, dx, echelleH, altitude, ref, z, mini, maxi };
  }

  /* Maillage du sol : quads {pts, z, n} en coordonnées locales, prêts à projeter.
     Les cellules sont étendues au-delà de la grille (altitude du bord répétée),
     sinon on verrait la tranche du plateau flotter dans le vide. */
  function maillageRelief(terr) {
    const { n, echelleH, dy, dx, lat, lon } = terr;
    /* La grille est étendue de quelques cellules au-delà de son emprise, pour
       que le sol ne s'arrête pas net au bord du cadre : les positions des nœuds
       sont prolongées, et leur altitude continue la pente du bord en
       s'aplatissant (un simple bord plat ferait une marche visible). */
    const pas = 2 * dx / (n - 1), pasY = 2 * dy / (n - 1);
    const M = RELIEF_MARGE;
    const borne = v => Math.max(terr.mini, Math.min(terr.maxi, v));
    const noeud = (j, i) => {
      const jc = Math.max(0, Math.min(n - 1, j)), ic = Math.max(0, Math.min(n - 1, i));
      const z = terr.grid[jc][ic];
      const la = lat + dy - j * pasY;
      const lo = lon - dx + i * pas;
      return {
        la, lo, z: (z - terr.ref) * echelleH,
        x: (lo - lon) * 111320 * Math.cos(lat * Math.PI / 180),
        y: (la - lat) * 111320
      };
    };
    const quads = [];
    for (let j = -M; j < n - 1 + M; j++) {
      for (let i = -M; i < n - 1 + M; i++) {
        const a = noeud(j, i), b = noeud(j, i + 1), c = noeud(j + 1, i + 1), d = noeud(j + 1, i);
        /* normale du quad, pour l'ombrage (pente est-ouest et nord-sud) */
        const dzdx = ((b.z + c.z) - (a.z + d.z)) / (2 * pas * 111320 * Math.cos(lat * Math.PI / 180));
        const dzdy = ((d.z + c.z) - (a.z + b.z)) / (2 * pasY * 111320);
        const nx = -dzdx, ny = -dzdy, nz = 1, nn = Math.hypot(nx, ny, nz) || 1;
        quads.push({
          pts: [[a.x, a.y, a.z], [b.x, b.y, b.z], [c.x, c.y, c.z], [d.x, d.y, d.z]],
          z: (a.z + b.z + c.z + d.z) / 4,
          n: [nx / nn, ny / nn, nz / nn],
          /* couronne : au-delà de la grille mesurée */
          bord: j < 0 || i < 0 || j > n - 2 || i > n - 2
        });
      }
    }
    return quads;
  }

  /* Construit la scène : sol, ombres, bâtiments — triés pour l'affichage.
     opts.terrain : grille d'altitudes (le bâti s'y pose) — voir docs/VUE3D.md.
     opts.ombreRelief : les ombres suivent-elles la pente ? (par défaut oui) */
  function scene(batiments, cam, opts) {
    opts = opts || {};
    const pal = PAL[(opts.palette || 0) % PAL.length];
    const sun = opts.soleil || { hauteur: 1, azimut: 180, vecteur: [0, 0, 1] };
    const jour = sun.hauteur > 0.02;
    /* Lumière : directe au zénith, rasante à l'horizon ; la nuit, ambiance seule. */
    const k = jour
      ? { amb: 0.46, diff: 0.54 }
      : { amb: 0.50, diff: 0.0 };   /* nuit : clair de lune, la maquette reste lisible */
    const echelleH = opts.echelleH === undefined ? 1 : opts.echelleH;   // exagération verticale
    const terr = opts.terrain ? prepareTerrain(opts.terrain, echelleH) : null;
    const sol = terr ? null : 0;                  // altitude du sol sans relief

    /* Le sol : maillage du relief (ombrage par la pente) ou plan à zéro. */
    let maille = null, solFill = null;
    if (terr) {
      const cSol = hex2rgb(pal.sol);
      maille = maillageRelief(terr).map(q => ({ ...q, fill: nuance(cSol, q.n, sun.vecteur, k) }));
      /* Le fond plat, au-delà du maillage, reprend la teinte moyenne de la
         couronne du maillage : sans cela, la couture entre les deux se verrait
         comme une bande claire. */
      const couronne = maille.filter(q => q.bord);
      const moy = couronne.reduce((acc, q) => {
        const c = nuanceN(cSol, q.n, sun.vecteur, k);
        return [acc[0] + c[0], acc[1] + c[1], acc[2] + c[2]];
      }, [0, 0, 0]).map(v => v / couronne.length);
      solFill = rgb(moy);
    }

    const groupes = [];        // un groupe par bâtiment : ses faces, triées
    const ombres = [];
    const ring = [];

    for (const b of batiments || []) {
      const a = anneau(b.g);
      if (!a) continue;
      const ptsLocal = a.map(p => cam.toLocal(p[0], p[1]));

      /* Centre de l'emprise : centre de gravité de la surface (formule des
         lacets). La moyenne des sommets, elle, se décale vers le point de
         fermeture répété et peut sortir d'un anneau concave — c'est ce centre
         qui décide du côté extérieur des murs. */
      const centre = centroidePoly(ptsLocal);
      const cx = centre[0], cy = centre[1];
      /* Altitude du sol sous le bâtiment. Repère local : zéro = altitude du
         centre du site, sinon un site à 630 m placerait toute la scène 630 m
         au-dessus de la caméra. */
      const la0 = cam.lat0 + cy / 111320;
      const lo0 = cam.lon0 + cx / (111320 * cam.cosLat);
      const zBase = terr ? terr.z(la0, lo0) : sol;
      /* Hauteur dessinée : exagérée pour la lisibilité, mais plafonnée — sans
         cela, un immeuble de 30 m sur un site de 300 m devient une tour. */
      const h = Math.min(120, (Number(b.h) > 0 ? Number(b.h) : H_DEFAUT) * echelleH);
      const h0 = Number(b.minH) > 0 ? Number(b.minH) * echelleH : 0;

      const facesB = [];

      /* ── murs ──
         Un anneau extérieur : la normale sort du bâtiment (donc s'éloigne de
         son centre). Une cour intérieure : la normale pointe vers la cour.
         Écrire le test ainsi évite de dépendre du sens d'enroulement OSM. */
      const parois = [
        { ring: ptsLocal, cible: [cx, cy], dedans: false },
        ...(b.trous || []).map(t => {
          const r = anneau(t);
          if (!r) return null;
          const lt = r.map(p => cam.toLocal(p[0], p[1]));
          return { ring: lt, cible: centroidePoly(lt), dedans: true };
        }).filter(Boolean)
      ];

      for (const { ring: rr, cible, dedans } of parois) {
        const n = rr.length - 1;
        for (let i = 0; i < n; i++) {
          const p = rr[i], q = rr[i + 1];
          const dx = q[0] - p[0], dy = q[1] - p[1];
          const L = Math.hypot(dx, dy);
          if (L < 0.35) continue;
          const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
          let nx = mx - cible[0], ny = my - cible[1];      // vers l'extérieur du matériau
          const nl = Math.hypot(nx, ny) || 1;
          nx /= nl; ny /= nl;
          if (dedans) { nx = -nx; ny = -ny; }              // la cour : vers son centre
          /* Face tournée vers la caméra ? */
          if ((cam.oeil[0] - mx) * nx + (cam.oeil[1] - my) * ny <= 0) continue;
          const camPts = decouper([
            cam.projLocal(p[0], p[1], zBase + h0), cam.projLocal(q[0], q[1], zBase + h0),
            cam.projLocal(q[0], q[1], zBase + h), cam.projLocal(p[0], p[1], zBase + h)
          ], cam.proche);
          if (camPts.length < 3) continue;
          const ecr = camPts.map(cam.ecran).filter(Boolean);
          if (ecr.length !== camPts.length) continue;
          const estime = !(Number(b.h) > 0);
          let base = hex2rgb(b.couleur) || (TEINTE[b.t] ? TEINTE[b.t].map(Number) : [.90, .88, .84]);
          /* Hauteur estimée : teinte plus froide et plus claire, pour que l'œil
             distingue d'emblée le mesuré de l'estimé. */
          if (estime) base = melange(base, [.88, .86, .83], .62);
          const prof = camPts.reduce((s2, p2) => s2 + p2[2], 0) / camPts.length;
          facesB.push({
            type: 'mur', b, prof, ext: !dedans,
            pts: ecr.map(p2 => [p2[0], p2[1]]),
            /* géométrie 3D en mètres locaux (X est, Y nord, Z vers le haut) :
               c'est elle, et non les coordonnées écran, qu'écrivent les exports
               DXF/OBJ. Z est relatif à l'altitude de référence du terrain. */
            pts3: [
              [p[0], p[1], zBase + h0], [q[0], q[1], zBase + h0],
              [q[0], q[1], zBase + h], [p[0], p[1], zBase + h]
            ],
            fill: nuance(base, [nx, ny, 0], sun.vecteur, k)
          });
        }
      }

      /* ── toit ── (évidé des cours intérieures : remplissage « pair-impair ») */
      const hToit = Number(b.hauteurToit) > 0 ? Number(b.hauteurToit) * echelleH : 0;
      const baseToit = hex2rgb(b.couleurToit) ||
        melange(hex2rgb(b.couleur) || [.90, .88, .84], [.62, .60, .56], .42);
      const trousEcr = [];
      for (const t of b.trous || []) {
        const r = anneau(t);
        if (!r) continue;
        /* Attention : projLocal attend des mètres locaux, pas des degrés —
           une cour projetée en degrés se réduirait à un point à l'écran. */
        const lt = r.map(p => cam.toLocal(p[0], p[1]));
        const cp = decouper(lt.map(p => cam.projLocal(p[0], p[1], zBase + h)), cam.proche);
        if (cp.length < 3) continue;
        const ecr = cp.map(cam.ecran).filter(Boolean);
        if (ecr.length === cp.length) trousEcr.push(ecr.map(p => [p[0], p[1]]));
      }
      if (hToit > 0 && ptsLocal.length <= 11) {
        const sommet = cam.projLocal(cx, cy, zBase + h + hToit);
        for (let i = 0; i < ptsLocal.length - 1; i++) {
          const p = ptsLocal[i], q = ptsLocal[i + 1];
          const camPts = decouper([cam.projLocal(p[0], p[1], zBase + h), cam.projLocal(q[0], q[1], zBase + h), sommet], cam.proche);
          if (camPts.length < 3) continue;
          const ecr = camPts.map(cam.ecran).filter(Boolean);
          if (ecr.length !== camPts.length) continue;
          const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy) || 1;
          const nx = dy / L, ny = -dx / L, nz = 0.5;
          const nn = Math.hypot(nx, ny, nz);
          const prof = camPts.reduce((s2, x) => s2 + x[2], 0) / camPts.length;
          facesB.push({
            type: 'pan', b, prof, pts: ecr.map(x => [x[0], x[1]]),
            pts3: [
              [p[0], p[1], zBase + h], [q[0], q[1], zBase + h],
              [cx, cy, zBase + h + hToit]
            ],
            fill: nuance(baseToit, [nx / nn, ny / nn, nz / nn], sun.vecteur, k)
          });
        }
        const sommEcr = cam.ecran(sommet);
        if (sommEcr) facesB.push({
          type: 'pointe', b, prof: sommEcr[2], pts: [[sommEcr[0], sommEcr[1]]],
          fill: nuance(baseToit, [0, 0, 1], sun.vecteur, k)
        });
      } else {
        const camPts = decouper(ptsLocal.map(p => cam.projLocal(p[0], p[1], zBase + h)), cam.proche);
        if (camPts.length >= 3) {
          const ecr = camPts.map(cam.ecran).filter(Boolean);
          if (ecr.length === camPts.length) {
            const prof = camPts.reduce((s2, p2) => s2 + p2[2], 0) / camPts.length;
            facesB.push({
              type: 'toit', b, prof, trous: trousEcr,
              pts: ecr.map(p => [p[0], p[1]]),
              /* anneau extérieur seul : ni l'OBJ ni le STL ASCII ne savent
                 décrire un trou dans une face (les cours restent pleines dans
                 ces deux formats, elles ne le sont pas à l'écran). */
              pts3: ptsLocal.map(p2 => [p2[0], p2[1], zBase + h]),
              fill: nuance(baseToit, [0, 0, 1], sun.vecteur, k)
            });
          }
        }
      }

      /* ── ombre portée ── */
      if (jour && sun.hauteur > 0.06 && h > 1) {
        const hReel = Number(b.h) > 0 ? Number(b.h) : H_DEFAUT;
        const long = Math.min(100, hReel / Math.tan(Math.max(0.08, sun.hauteur)) * 0.55);
        const kx = -long * Math.sin(sun.azimut * D2R);
        const ky = -long * Math.cos(sun.azimut * D2R);
        const hull = enveloppe(ptsLocal.concat(ptsLocal.map(p => [p[0] + kx, p[1] + ky])));
        const pOmbre = hull.map(p => {
          const la = cam.lat0 + p[1] / 111320;                       // retour en géographique
          const lo = cam.lon0 + p[0] / (111320 * cam.cosLat);
          const z = terr ? terr.z(la, lo) + 0.1 : 0.02;
          return cam.projLocal(p[0], p[1], z);
        });
        const camPts = decouper(pOmbre, cam.proche);
        if (camPts.length >= 3) {
          const ecr = camPts.map(cam.ecran).filter(Boolean);
          if (ecr.length === camPts.length)
            ombres.push({ type: 'ombre', b, pts: ecr.map(p => [p[0], p[1]]) });
        }
      }

      /* profondeur du bâtiment : celle de son centre, à mi-hauteur */
      const profB = cam.projLocal(cx, cy, zBase + h / 2)[2];
      groupes.push({ prof: profB, faces: facesB });
      ring.push({ b, c: [cx, cy], h, z: zBase });
    }

    /* Tri : les bâtiments du plus lointain au plus proche, puis leurs faces —
       grouper par bâtiment évite qu'un toit lointain passe devant le mur d'un
       voisin plus proche (le tri face à face, seul, le faisait). */
    groupes.sort((x, y) => y.prof - x.prof);
    for (const gr of groupes) gr.faces.sort((x, y) => y.prof - x.prof);
    const faces = groupes.reduce((acc, gr) => acc.concat(gr.faces), []);

    /* `terrainRef` : altitude absolue du zéro local — les exports s'en servent
       pour écrire des altitudes vraies (celles d'un plan topographique). */
    return {
      pal, ombres, faces, groupes, maille, solFill, sun, k, cam, jour,
      batiments: ring, terrain: terr,
      terrainRef: terr ? terr.ref : 0,
      grille: opts.terrain || null
    };
  }

  /* Centre de gravité de la surface d'un anneau (formule des lacets) ; retombe
     sur la moyenne des sommets si la surface est nulle (anneau dégénéré). */
  function centroidePoly(pts) {
    let aire = 0, cx = 0, cy = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const f = pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
      aire += f;
      cx += (pts[j][0] + pts[i][0]) * f;
      cy += (pts[j][1] + pts[i][1]) * f;
    }
    if (Math.abs(aire) < 1e-9) {
      let mx = 0, my = 0;
      for (const p of pts) { mx += p[0]; my += p[1]; }
      return [mx / pts.length, my / pts.length];
    }
    return [cx / (3 * aire), cy / (3 * aire)];
  }

  /* Point dans un polygone (lancer de rayon, coordonnées écran). */
  function dans(pts, x, y) {
    let dedans = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) dedans = !dedans;
    }
    return dedans;
  }

  /* Désignation : le bâtiment le plus proche sous le curseur. Les faces étant
     triées de la plus lointaine à la plus proche, on parcourt à l'envers. */
  function designer(sc, x, y) {
    if (Array.isArray(sc.groupes)) {
      /* les groupes vont du plus lointain au plus proche : on remonte la liste */
      for (let g = sc.groupes.length - 1; g >= 0; g--)
        for (const f of sc.groupes[g].faces)
          if (f.pts.length >= 3 && dans(f.pts, x, y)) return f.b;
      return null;
    }
    for (let i = sc.faces.length - 1; i >= 0; i--) {
      const f = sc.faces[i];
      if (f.pts.length >= 3 && dans(f.pts, x, y)) return f.b;
    }
    return null;
  }

  /* ═════════════ 5 · sortie SVG (planches) ═════════════ */
  const fmt = n => (Math.round(n * 10) / 10);
  const pts = p => p.map(q => fmt(q[0]) + ',' + fmt(q[1])).join(' ');

  /* Ligne d'horizon à l'écran : image de la direction horizontale, à l'infini.
     Deux directions opposées suffisent à la définir. Renvoie [x1,y1,x2,y2] ou
     null quand la caméra vise le sol à la verticale (aucun horizon visible). */
  function horizon(cam) {
    const { r, u, f, focal, W, H } = cam;
    const projDir = (d) => {
      const py = d[0] * u[0] + d[1] * u[1] + d[2] * u[2];
      const pz = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
      if (Math.abs(pz) < 1e-6) return null;
      return [W / 2 + focal * (d[0] * r[0] + d[1] * r[1] + d[2] * r[2]) / pz, H / 2 - focal * py / pz];
    };
    const a = projDir(r), b = projDir([-r[0], -r[1], -r[2]]);
    if (!a || !b) return null;
    return [a[0], a[1], b[0], b[1]];
  }

  /* Fond : ciel au-dessus de l'horizon, sol en dessous. */
  function fondSVG(cam, pal, solFill) {
    const sol = solFill || pal.sol;
    const W = cam.W, H = cam.H;
    const h = horizon(cam);
    if (!h) return '<rect width="' + W + '" height="' + H + '" fill="' + sol + '"/>';
    const [x1, y1, x2, y2] = h;
    /* On prolonge la droite bien au-delà du cadre, puis on ferme vers le bas. */
    const dx = x2 - x1, dy = y2 - y1;
    const n = Math.hypot(dx, dy) || 1;
    const ex = dx / n * W * 3, ey = dy / n * W * 3;
    const A = [x1 - ex, y1 - ey], B = [x1 + ex, y1 + ey];
    const ymax = H + Math.abs(ey) + H;
    return '<polygon points="' +
      [[A[0], A[1]], [B[0], B[1]], [B[0], B[1] + ymax], [A[0], A[1] + ymax]]
        .map(q => fmt(q[0]) + ',' + fmt(q[1])).join(' ') +
      '" fill="' + sol + '"/>';
  }

  /* Voirie et eau posées sur le sol : sans elles, la maquette flotte et l'on
     ne rattache pas les volumes au tissu. Traits fins, très peu contrastés. */
  const ROUTEW = {
    motorway: 2.2, trunk: 2.0, primary: 1.7, secondary: 1.3, tertiary: 1.0,
    residential: 0.7, living_street: 0.6, unclassified: 0.6, pedestrian: 0.7,
    footway: 0.45, cycleway: 0.5, path: 0.35, service: 0.3, steps: 0.35
  };
  function reseauSVG(cam, sc, o) {
    const pal = sc.pal, out = [];
    /* Voirie et eau se posent sur le relief, comme le bâti. */
    const zSol = sc.terrain ? sc.terrain.z : () => 0.4;
    /* eau d'abord, sous la voirie */
    for (const g of o.eaux || []) {
      if (!g || g.length < 3) continue;
      const p = g.map(q => cam.proj(q[0], q[1], zSol(q[0], q[1])));
      if (p.some(q => !q)) continue;
      out.push('<polygon points="' + pts(p) + '" fill="' + pal.eau + '" fill-opacity=".55"/>');
    }
    for (const r of o.routes || []) {
      if (!r.g || r.g.length < 2) continue;
      const p = r.g.map(q => cam.proj(q[0], q[1], zSol(q[0], q[1])));
      if (p.some(q => !q)) continue;
      const w = ROUTEW[r.h] || 0.5;
      out.push('<path d="' + p.map((q, i) => (i ? 'L' : 'M') + fmt(q[0]) + ',' + fmt(q[1])).join('') +
        '" fill="none" stroke="' + pal.voie + '" stroke-width="' + w + '" stroke-opacity=".75" stroke-linecap="round"/>');
    }
    return out.join('');
  }

  /* Corps SVG de la vue 3D, aux dimensions demandées (par défaut W × H). */
  /* Trait SVG fermé d'un anneau de points écran : « M… L… Z ». */
  const chemin = p => 'M' + p.map(q => fmt(q[0]) + ',' + fmt(q[1])).join('L') + 'Z';

  /* Un toit peut avoir des cours intérieures : on les évide avec la règle
     « pair-impair » au lieu d'empiler des polygones pleins. */
  function toitSVG(f) {
    if (!f.trous || !f.trous.length)
      return '<polygon points="' + pts(f.pts) + '" fill="' + f.fill + '"/>';
    let d = chemin(f.pts);
    for (const t of f.trous) d += chemin(t);
    return '<path d="' + d + '" fill="' + f.fill + '" fill-rule="evenodd"/>';
  }

  function corpsSVG(batiments, o) {
    o = o || {};
    const cam = camera({
      lat: o.lat, lon: o.lon, rayon: o.rayon, cap: o.cap ?? 0,
      inclinaison: o.inclinaison ?? 50, largeur: o.largeur, hauteur: o.hauteur,
      recul: o.recul, champ: o.champ
    });
    const sun = o.soleil || { hauteur: 1, azimut: 180, vecteur: [0, 0, 1] };
    const sc = scene(batiments, cam, {
      palette: o.palette, soleil: sun, echelleH: o.echelleH,
      terrain: o.relief === false ? null : o.terrain
    });
    const W = cam.W, H = cam.H;

    let svg = '<rect width="' + W + '" height="' + H + '" fill="' + sc.pal.ciel + '"/>' +
              fondSVG(cam, sc.pal, sc.solFill);

    /* Sol : maillage du relief, ombré par la pente (sinon : plan uni). */
    if (sc.maille) {
      for (const q of sc.maille) {
        const p = decouper(q.pts.map(v => cam.projLocal(v[0], v[1], v[2])), cam.proche);
        if (p.length < 3) continue;
        const ecr = p.map(cam.ecran).filter(Boolean);
        if (ecr.length === p.length) svg += '<polygon points="' + pts(ecr) + '" fill="' + q.fill + '"/>';
      }
    }

    svg += reseauSVG(cam, sc, o);

    if (sc.ombres.length) {
      svg += '<g opacity="' + (o.opaciteOmbre ?? 0.30) + '">';
      for (const f of sc.ombres) svg += '<polygon points="' + pts(f.pts) + '" fill="' + sc.pal.ombre + '"/>';
      svg += '</g>';
    }
    for (const f of sc.faces) {
      if (f.type === 'pointe') svg += '<circle cx="' + fmt(f.pts[0][0]) + '" cy="' + fmt(f.pts[0][1]) + '" r="1.2" fill="' + f.fill + '"/>';
      else if (f.type === 'toit') svg += toitSVG(f);
      else svg += '<polygon points="' + pts(f.pts) + '" fill="' + f.fill + '"/>';
    }
    if (o.selection) {
      const id = o.selection;
      for (const f of sc.faces)
        if (f.b && (f.b.id === id || f.b === o.selection)) {
          if (f.type === 'toit' && f.trous && f.trous.length) {
            let d = chemin(f.pts);
            for (const t of f.trous) d += chemin(t);
            svg += '<path d="' + d + '" fill="none" fill-rule="evenodd" stroke="#E8B21F" stroke-width="1.1"/>';
          } else {
            svg += '<polygon points="' + pts(f.pts) + '" fill="none" stroke="#E8B21F" stroke-width="1.1"/>';
          }
        }
    }
    return { svg, cam, sc };
  }

  /* Planche complète pour le catalogue : vue oblique au sud, ombres du soleil
     placé à l'heure demandée (ctx.time, 0-23, heure locale du site). */
  function planche(ctx, o) {
    o = o || {};
    const batiments = (ctx.D && ctx.D.build) || [];
    const heure = Number.isFinite(ctx.time) ? ctx.time : 12;
    const sun = soleil(instantLocal(heure, ctx.sLat, ctx.sLng), ctx.sLat, ctx.sLng);
    const W = G.FMEngine ? G.FMEngine.W : 240, H = G.FMEngine ? G.FMEngine.H : 240;
    const D = ctx.D || {};
    const exag = o.echelleH ?? 4;
    /* Relief : la grille d'altitudes du site, quand elle a été récupérée. */
    const relief = (o.relief === false || !ctx.terrain?.grid?.length) ? null : ctx.terrain;
    const r = corpsSVG(batiments, {
      routes: D.roads || [],
      eaux: (D.green || []).filter(x => x.k === 'w').map(x => x.g),
      terrain: relief,
      lat: ctx.sLat, lon: ctx.sLng, rayon: ctx.curR,
      cap: o.cap ?? 0, inclinaison: o.inclinaison ?? 50,
      largeur: W, hauteur: H, recul: 1.12, palette: o.palette || 0,
      /* Exagération verticale : à l'échelle vraie, un bâtiment de 3 m sur un
         site de 600 m ne fait pas un pixel. Les planches 2D du projet font le
         même choix (facteur équivalent), pour rester lisibles. */
      soleil: sun, echelleH: exag
    });
    const mesurés = batiments.filter(b => b.h > 0).length;
    /* La note dit aussi l'amplitude du relief : sans elle, un dessin posé sur
       une pente paraîtrait faux alors qu'il est juste. */
    const reliefTxt = r.sc.terrain
      ? ' · ' + (ctx.lang === 'en' ? 'ground ' : 'sol ') +
        Math.round(r.sc.terrain.mini) + '–' + Math.round(r.sc.terrain.maxi) + ' m'
      : '';
    return {
      svg: r.svg, soleil: sun, batiments: batiments.length, mesures: mesurés,
      heuresoleil: heure,
      relief: r.sc.terrain ? [r.sc.terrain.mini, r.sc.terrain.maxi] : null,
      legende: [
        { type: 'rect', c: '#D6D0C6', s: '#8C8579', l: ctx.lang === 'en' ? 'ROOF' : 'TOIT' },
        { type: 'rect', c: '#CFC8BC', s: '#A89F92', l: ctx.lang === 'en' ? 'SUNLIT WALL' : 'FAÇADE AU SOLEIL' },
        { type: 'rect', c: '#6E6A64', s: '#4A4A48', l: ctx.lang === 'en' ? 'SHADOW' : 'OMBRE PORTÉE' }
      ],
      note: (ctx.lang === 'en' ? '3D · ' : '3D · ') +
        (sun.hauteur <= 0.02 ? (ctx.lang === 'en' ? 'night ' : 'nuit ') : (ctx.lang === 'en' ? 'sun ' : 'soleil ')) +
        heure + ' h · ' + mesurés + '/' + batiments.length +
        (ctx.lang === 'en' ? ' measured heights' : ' hauteurs mesurées') +
        (exag !== 1 ? ' · H ×' + exag : '') + reliefTxt
    };
  }

  /* ═════════════ 6 · tuiles raster (fond de carte) ═════════════ */
  function tuileXY(lat, lon, z) {
    const n = 2 ** z;
    const x = Math.floor((lon + 180) / 360 * n);
    const y = Math.floor((1 - Math.log(Math.tan(lat * D2R) + 1 / Math.cos(lat * D2R)) / Math.PI) / 2 * n);
    return { x, y, z };
  }
  /* Coins géographiques d'une tuile (lat/lon), ordre : NO, NE, SE, SO. */
  function tuileBoite(x, y, z) {
    const g = (xx, yy) => {
      const n = 2 ** z;
      const lon = xx / n * 360 - 180;
      const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * yy / n))) * R2D;
      return [lat, lon];
    };
    return [g(x, y), g(x + 1, y), g(x + 1, y + 1), g(x, y + 1)];
  }
  /* Tuiles nécessaires pour couvrir un cercle (lat, lon, rayon). */
  function tuilesPour(lat, lon, rayon, z) {
    z = z || 16;
    const dLat = rayon / 111320, dLon = dLat / Math.cos(lat * D2R);
    const a = tuileXY(lat + dLat, lon - dLon, z), b = tuileXY(lat - dLat, lon + dLon, z);
    const out = [];
    for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++)
      for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) out.push({ x, y, z });
    return out;
  }
  function urlTuile(gabarit, t, sous) {
    return gabarit.replace('{z}', t.z).replace('{x}', t.x).replace('{y}', t.y)
      .replace('{s}', sous || 'a');
  }

  /* ═════════════ 7 · sortie canvas (vue interactive) ═════════════ */
  function dessiner(g, sc, o) {
    o = o || {};
    const cam = sc.cam, W = cam.W, H = cam.H;
    g.save();
    g.clearRect(0, 0, W, H);
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, sc.pal.ciel);
    grad.addColorStop(1, sc.jour ? (sc.solFill || sc.pal.sol) : sc.pal.ciel);
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);

    /* sol : tout ce qui est sous la ligne d'horizon */
    const hl = horizon(cam);
    if (hl) {
      const [x1, y1, x2, y2] = hl;
      const dx = x2 - x1, dy = y2 - y1, n = Math.hypot(dx, dy) || 1;
      const ex = dx / n * W * 3, ey = dy / n * W * 3;
      g.fillStyle = sc.solFill || sc.pal.sol;
      g.beginPath();
      g.moveTo(x1 - ex, y1 - ey);
      g.lineTo(x1 + ex, y1 + ey);
      g.lineTo(x1 + ex, y1 + ey + H * 3);
      g.lineTo(x1 - ex, y1 - ey + H * 3);
      g.closePath(); g.fill();
    } else {
      g.fillStyle = sc.solFill || sc.pal.sol;
      g.fillRect(0, 0, W, H);
    }

    /* fond de carte : chaque tuile est plaquée par petits carreaux (affine) */
    if (o.fond && o.fond.images) {
      for (const t of o.fond.images) {
        const box = tuileBoite(t.x, t.y, t.z);
        const N = o.fond.subdivisions || 5;
        for (let i = 0; i < N; i++) {
          for (let j = 0; j < N; j++) {
            const c00 = coinMercator(box, i / N, j / N), c10 = coinMercator(box, (i + 1) / N, j / N);
            const c01 = coinMercator(box, i / N, (j + 1) / N);
            const q00 = cam.proj(c00[0], c00[1], 0), q10 = cam.proj(c10[0], c10[1], 0), q01 = cam.proj(c01[0], c01[1], 0);
            if (!q00 || !q10 || !q01) continue;
            const sw = o.fond.taille / N, sh = o.fond.taille / N;
            const a = (q10[0] - q00[0]) / sw, b = (q10[1] - q00[1]) / sw;
            const c = (q01[0] - q00[0]) / sh, d = (q01[1] - q00[1]) / sh;
            g.save();
            g.globalAlpha = o.fond.opacite ?? 0.9;
            g.setTransform(a, b, c, d, q00[0], q00[1]);
            g.drawImage(t.image, i * sw, j * sh, sw, sh, 0, 0, sw, sh);
            g.restore();
          }
        }
      }
      g.setTransform(1, 0, 0, 1, 0, 0);
    }

    /* sol : maillage du relief (ombrage par la pente) */
    if (sc.maille) {
      for (const q of sc.maille) {
        const p2 = decouper(q.pts.map(v => cam.projLocal(v[0], v[1], v[2])), cam.proche);
        if (p2.length < 3) continue;
        const ecr = p2.map(cam.ecran).filter(Boolean);
        if (ecr.length !== p2.length) continue;
        g.beginPath();
        g.moveTo(ecr[0][0], ecr[0][1]);
        for (let k = 1; k < ecr.length; k++) g.lineTo(ecr[k][0], ecr[k][1]);
        g.closePath();
        g.fillStyle = q.fill;
        g.fill();
      }
    }

    /* ombres */
    if (sc.ombres.length) {
      g.globalAlpha = o.opaciteOmbre ?? 0.30;
      g.fillStyle = sc.pal.ombre;
      g.beginPath();
      for (const f of sc.ombres) {
        g.moveTo(f.pts[0][0], f.pts[0][1]);
        for (let k = 1; k < f.pts.length; k++) g.lineTo(f.pts[k][0], f.pts[k][1]);
        g.closePath();
      }
      g.fill();
      g.globalAlpha = 1;
    }

    /* bâtiments, du plus lointain au plus proche */
    g.lineJoin = 'round';
    /* Un anneau écran ajouté au tracé courant (sert aussi aux cours). */
    const anneauTrace = pts2 => {
      g.moveTo(pts2[0][0], pts2[0][1]);
      for (let k = 1; k < pts2.length; k++) g.lineTo(pts2[k][0], pts2[k][1]);
      g.closePath();
    };
    for (const f of sc.faces) {
      if (f.type === 'pointe') {
        g.beginPath(); g.arc(f.pts[0][0], f.pts[0][1], 1.2, 0, 6.2832); g.fillStyle = f.fill; g.fill();
        continue;
      }
      g.beginPath();
      anneauTrace(f.pts);
      if (f.trous) for (const t of f.trous) anneauTrace(t);
      g.fillStyle = f.fill;
      g.fill(f.trous && f.trous.length ? 'evenodd' : 'nonzero');
      /* liseré : détache les volumes voisins, comme sur les maquettes */
      g.strokeStyle = o.liseret || 'rgba(0,0,0,.10)';
      g.lineWidth = 0.5;
      g.stroke();
    }

    if (o.selection) {
      g.strokeStyle = '#E8B21F';
      g.lineWidth = 1.4;
      for (const f of sc.faces)
        if (f.b === o.selection || (o.selection && f.b && f.b.id === o.selection)) {
          g.beginPath();
          anneauTrace(f.pts);
          if (f.trous) for (const t of f.trous) anneauTrace(t);
          g.stroke();
        }
    }
    g.restore();
  }

  /* Point de Mercator (u,v ∈ [0,1]) à l'intérieur d'une boîte de tuile. */
  function coinMercator(box, u, v) {
    const [no, ne, se, so] = box;
    const haut = [no[0] + (ne[0] - no[0]) * u, no[1] + (ne[1] - no[1]) * u];
    const bas = [so[0] + (se[0] - so[0]) * u, so[1] + (se[1] - so[1]) * u];
    /* interpolation en Mercator pour la latitude (sinon les tuiles glissent) */
    const yHaut = latVersMercator(haut[0]), yBas = latVersMercator(bas[0]);
    return [mercatorVersLat(yHaut + (yBas - yHaut) * v), haut[1] + (bas[1] - haut[1]) * v];
  }
  const latVersMercator = lat => Math.log(Math.tan(Math.PI / 4 + lat * D2R / 2));
  const mercatorVersLat = y => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * R2D;

  /* ═════════════ 8 · export SVG de la vue courante ═════════════ */
  function versSVG(batiments, o) {
    o = o || {};
    const r = corpsSVG(batiments, { ...o, largeur: o.largeur || 1200, hauteur: o.hauteur || 900, palette: o.palette || 0 });
    const attribution = o.attribution ? '\n  <text x="10" y="' + (r.cam.H - 8) +
      '" font-family="sans-serif" font-size="9" fill="#5A5A5A">' + o.attribution + '</text>' : '';
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + r.cam.W + '" height="' + r.cam.H +
      '" viewBox="0 0 ' + r.cam.W + ' ' + r.cam.H + '">' + r.svg + attribution + '</svg>';
  }

  G.FMVue3D = {
    soleil, instantLocal, camera, scene, designer, corpsSVG, planche, dessiner,
    versSVG, enveloppe, anneau, dans, nuance, nuanceN, horizon, toitSVG, centroidePoly,
    prepareTerrain, maillageRelief, RELIEF_MARGE, PAL, H_DEFAUT,
    tuileXY, tuileBoite, tuilesPour, urlTuile, coinMercator
  };
})(globalThis);
