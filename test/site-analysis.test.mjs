import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromLocalMeters } from '../public/js/spatial-framing-core.mjs';
import {
  buildSiteReportPdf, computeSiteRatios, computeSpacematrix, estimateHeightM, estimateLevels,
  pedestrianIsochrones, polylineProfile, profileToSvg, ratiosChartSvg, ratiosToCsv,
  sectionProfile, skyViewFactor, streetCanyons, sunPosition, threeThirtyThreeHundred
} from '../public/js/site-analysis.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* Centre fictif : Constantine. Les géométries sont construites en mètres
   locaux via fromLocalMeters, comme le fait l'interface. */
const CENTER = { lat: 36.3650, lon: 6.6147, name: 'Constantine, Algérie' };
const square = (x, y, half) => ({
  type: 'Polygon',
  coordinates: [[
    fromLocalMeters(x - half, y - half, CENTER),
    fromLocalMeters(x + half, y - half, CENTER),
    fromLocalMeters(x + half, y + half, CENTER),
    fromLocalMeters(x - half, y + half, CENTER),
    fromLocalMeters(x - half, y - half, CENTER)
  ]]
});
const feature = (layerId, geometry, tags = {}) => ({
  type: 'Feature', geometry, properties: { layerId, ...tags }
});

const PERIMETER = { type: 'circle', center: [CENTER.lon, CENTER.lat], radiusMeters: 500 };

function sampleFeatures() {
  return [
    feature('buildings', square(0, 0, 25), { building: 'yes' }),                    // 50×50 m
    feature('buildings', square(100, 100, 10), { building: 'yes', amenity: 'school' }), // 20×20 m
    feature('roadsSecondary', { type: 'LineString', coordinates: [fromLocalMeters(-500, 0, CENTER), fromLocalMeters(500, 0, CENTER)] }, { highway: 'secondary' }),
    feature('water', square(2000, 2000, 50), { natural: 'water' }),                  // hors périmètre
    feature('equipment', { type: 'Point', coordinates: fromLocalMeters(0, 50, CENTER) }, { amenity: 'hospital' }),
    feature('centralities', { type: 'Point', coordinates: fromLocalMeters(0, 2000, CENTER) }, { place: 'city' }) // hors périmètre
  ];
}

function sampleTerrain() {
  const n = 4;
  const grid = [];
  for (let row = 0; row < n; row++) {
    const line = [];
    for (let col = 0; col < n; col++) line.push(100 + 10 * col + row); // pente montante vers l'est
    grid.push(line);
  }
  return { lat: CENTER.lat, lon: CENTER.lon, radius: 600, grid };
}

describe('Analyse de site — ratios de surface', () => {
  const report = computeSiteRatios({ features: sampleFeatures(), perimeter: PERIMETER, center: CENTER });

  test('calcule la surface du périmètre circulaire (64 segments)', () => {
    assert.ok(report, 'rapport produit');
    const expected = Math.PI * 500 * 500;
    assert.ok(Math.abs(report.studyAreaM2 - expected) / expected < 0.02, `surface ${report.studyAreaM2} ≈ ${expected}`);
    assert.equal(report.perimeterType, 'circle');
  });

  test('agrège surfaces, longueurs et points par catégorie, uniquement dans le périmètre', () => {
    const buildings = report.rows.find(row => row.key === 'buildings');
    assert.equal(buildings.count, 2);
    assert.ok(Math.abs(buildings.areaM2 - 2900) < 1, `surface bâtie ${buildings.areaM2}`);
    assert.ok(buildings.share > 0 && buildings.share < 1);
    const roads = report.rows.find(row => row.key === 'roads');
    assert.ok(Math.abs(roads.lengthM - 1000) < 20, `voirie ${roads.lengthM} m`);
    const water = report.rows.find(row => row.key === 'water');
    assert.equal(water.areaM2, 0);
    assert.equal(water.count, 0, 'le plan d’eau hors périmètre est exclu');
    const equipment = report.rows.find(row => row.key === 'equipment');
    assert.equal(equipment.count, 1);
    const places = report.rows.find(row => row.key === 'places');
    assert.equal(places.count, 0, 'le lieu hors périmètre est exclu');
    assert.equal(report.totals.points, 1);
    assert.ok(report.builtCoverage > 0 && report.builtCoverage < 1);
    assert.equal(report.featureCount, 4);
  });

  test('ventile les usages du bâti (tags amenity / building)', () => {
    const labels = report.usage.map(item => item.label);
    assert.ok(labels.includes('Bâtiment (usage non précisé)'));
    assert.ok(labels.includes('Équipement : school'));
    assert.equal(report.usage.reduce((sum, item) => sum + item.count, 0), 2);
  });

  test('exporte les ratios en CSV (point-virgule, en-têtes français, CRLF)', () => {
    const csv = ratiosToCsv(report);
    const lines = csv.trimEnd().split('\r\n');
    assert.equal(lines[0], 'categorie;surface_m2;longueur_m;nombre;part_de_la_surface_pct');
    assert.equal(lines.length, 1 + report.rows.length + 2, 'en-tête + catégories + TOTAL + taux');
    assert.match(csv, /Bâtiments;2900;0;2;/);
    assert.match(csv, /Voirie \(toutes voies\);0;1000(\.\d)?;1;/);
    assert.match(csv, /^TOTAL;/m);
    assert.match(csv, /Taux d’occupation du sol/);
    assert.ok(csv.endsWith('\r\n'));
  });

  test('retourne null sans centre valide', () => {
    assert.equal(computeSiteRatios({ features: [], perimeter: PERIMETER, center: null }), null);
  });
});

describe('Analyse de site — coupe A→B sur le relief', () => {
  const terrain = sampleTerrain();
  const a = fromLocalMeters(-400, 0, CENTER);
  const b = fromLocalMeters(400, 0, CENTER);
  const profile = sectionProfile(terrain, a, b);

  test('échantillonne le profil et détecte la pente montante vers l’est', () => {
    assert.ok(profile.ok);
    assert.ok(Math.abs(profile.lengthM - 800) / 800 < 0.02, `longueur ${profile.lengthM}`);
    assert.equal(profile.points.length, 80);
    assert.ok(profile.points.every(p => p.distanceM >= 0));
    assert.ok(profile.maxElevation > profile.minElevation);
    assert.ok(profile.riseM > 0);
    assert.ok(profile.maxSlopePct > 0);
    const first = profile.points.find(p => p.elevationM !== null);
    const last = [...profile.points].reverse().find(p => p.elevationM !== null);
    assert.ok(last.elevationM > first.elevationM, 'altitude croissante d’ouest en est');
  });

  test('signale l’absence de relief ou une ligne invalide', () => {
    assert.equal(sectionProfile(null, a, b).reason, 'terrain-not-loaded');
    assert.equal(sectionProfile(terrain, a, a).reason, 'invalid-line');
  });

  test('produit un SVG de profil équilibré', () => {
    const svg = profileToSvg(profile);
    assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'));
    assert.ok(svg.includes('<polyline'));
    assert.equal((svg.match(/<text/g) || []).length, (svg.match(/<\/text>/g) || []).length);
    assert.ok(svg.includes('COUPE ·'));
  });
});

describe('Analyse de site — graphiques et rapport PDF', () => {
  const report = computeSiteRatios({ features: sampleFeatures(), perimeter: PERIMETER, center: CENTER });

  test('le graphique des ratios est un SVG cohérent', () => {
    const svg = ratiosChartSvg(report);
    assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'));
    assert.equal((svg.match(/<text/g) || []).length, (svg.match(/<\/text>/g) || []).length);
    assert.ok(svg.includes('Bâtiments'));
    assert.ok(svg.includes('Équipements et services : 1'));
  });

  test('le rapport PDF est un document A4 valide à 4 pages', () => {
    const profile = sectionProfile(sampleTerrain(), fromLocalMeters(-400, 0, CENTER), fromLocalMeters(400, 0, CENTER));
    const pdf = buildSiteReportPdf({
      title: 'Rapport de site — Constantine',
      projectName: 'Atelier S5',
      centerName: CENTER.name,
      center: CENTER,
      dateText: '06/11/2026',
      perimeterLabel: 'Cercle de 500 m autour du centre',
      studyAreaM2: report.studyAreaM2,
      rows: report.rows,
      totals: report.totals,
      builtCoverage: report.builtCoverage,
      featureCount: report.featureCount,
      usage: report.usage,
      profile
    });
    const text = Buffer.from(pdf).toString('latin1');
    assert.ok(text.startsWith('%PDF-1.4'), 'en-tête PDF');
    assert.ok(text.includes('%%EOF'), 'fin de fichier');
    assert.ok(text.includes('xref') && text.includes('startxref'), 'table xref');
    assert.equal((text.match(/\/Type \/Page[^s]/g) || []).length, 4, '4 pages A4');
    assert.ok(text.includes('/MediaBox [0 0 595 842]'), 'format A4 portrait');
    assert.ok(text.includes('Rapport de site'), 'titre présent');
    assert.ok(text.includes('Limites'), 'page sources et limites');
    assert.ok(pdf.length > 3000, `taille ${pdf.length} octets`);
  });

  test('buildSiteReportPdf exige un rapport', () => {
    assert.throws(() => buildSiteReportPdf(null), /REPORT_REQUIRED/);
  });
});

describe('Indicateurs complémentaires (phase A)', () => {
  test('estimation des hauteurs et niveaux depuis les tags OSM', () => {
    assert.equal(estimateHeightM({ height: '20 m' }), 20);
    assert.equal(estimateHeightM({ 'building:levels': '5' }), 15);
    assert.equal(estimateHeightM({ building: 'yes' }), null);
    assert.equal(estimateLevels({ 'building:levels': '5' }), 5);
    assert.equal(estimateLevels({ height: '9 m' }), 3);
  });

  test('Spacematrix : GSI, OSR, FSI et densité de réseau', () => {
    const feats = [
      feature('buildings', square(0, 0, 25), { building: 'yes', 'building:levels': '4' }),   // 2500 m² × 4
      feature('buildings', square(100, 100, 10), { building: 'yes' })                          // 400 m² × 1
    ];
    const sm = computeSpacematrix({ features: feats, center: CENTER, studyAreaM2: Math.PI * 500 * 500, roadLengthM: 1000, perimeter: PERIMETER });
    assert.ok(sm);
    assert.equal(sm.buildings, 2);
    assert.ok(Math.abs(sm.builtAreaM2 - 2900) < 1);
    assert.equal(sm.floorAreaM2, 2500 * 4 + 400);
    assert.ok(Math.abs(sm.gsi - 2900 / (Math.PI * 500 * 500)) < 1e-3);
    assert.ok(Math.abs(sm.osr - (1 - sm.gsi)) < 1e-3);
    assert.ok(Math.abs(sm.fsi - (10400 / (Math.PI * 500 * 500))) < 1e-3);
    assert.ok(Math.abs(sm.networkDensityKmPerKm2 - (1 / (Math.PI * 0.25))) < 0.05);
  });

  test('canyon de rue : hauteur moyenne des façades / largeur estimée', () => {
    const road = feature('roadsLocal', { type: 'LineString', coordinates: [fromLocalMeters(-300, 0, CENTER), fromLocalMeters(300, 0, CENTER)] }, { highway: 'residential' });
    const b1 = feature('buildings', square(0, 5, 20), { building: 'yes', height: '30 m' });
    const b2 = feature('buildings', square(80, 8, 15), { building: 'yes' }); // hauteur par défaut 6 m
    const canyons = streetCanyons({ features: [road, b1, b2], center: CENTER, perimeter: { type: 'circle', center: [CENTER.lon, CENTER.lat], radiusMeters: 1000 } });
    assert.equal(canyons.length, 1);
    assert.equal(canyons[0].widthM, 8); // residential par défaut
    assert.equal(canyons[0].avgHeightM, 18); // (30 + 6) / 2
    assert.equal(canyons[0].ratio, 2.25);
    assert.equal(canyons[0].class, 'canyon étroit');
    // largeur explicite via tag width
    const roadW = feature('roadsSecondary', { type: 'LineString', coordinates: [fromLocalMeters(-100, 0, CENTER), fromLocalMeters(100, 0, CENTER)] }, { highway: 'secondary', width: '14 m' });
    const c2 = streetCanyons({ features: [roadW, b1], center: CENTER, perimeter: PERIMETER });
    assert.equal(c2[0].widthM, 14);
  });

  test('règle 3-30-300 depuis le centre', () => {
    const trees = [0, 1, 2].map(i => feature('green', { type: 'Point', coordinates: fromLocalMeters(i * 30, 20, CENTER) }, { natural: 'tree' }));
    const wood = feature('green', square(0, 0, 100), { natural: 'wood' });
    const park = feature('green', square(170, 170, 20), { leisure: 'park' });
    const out = threeThirtyThreeHundred({ features: [...trees, wood, park], center: CENTER });
    assert.equal(out.trees, 3);
    assert.ok(out.canopyPct > 0);
    assert.ok(out.parkDistanceM !== null && out.parkDistanceM <= 300);
    assert.deepEqual(out.checks, { trees3: out.trees >= 3, canopy30: out.canopyPct >= 30, park300: true });
    const empty = threeThirtyThreeHundred({ features: [], center: CENTER });
    assert.equal(empty.trees, 0);
    assert.equal(empty.parkDistanceM, null);
    assert.equal(empty.checks.park300, false);
  });

  test('isochrones piétonnes sur le graphe des voies (5 km/h)', () => {
    const seg = (a, b) => feature('roadsLocal', { type: 'LineString', coordinates: [a, b] }, { highway: 'residential' });
    const feats = [
      seg(fromLocalMeters(-500, 0, CENTER), fromLocalMeters(0, 0, CENTER)),
      seg(fromLocalMeters(0, 0, CENTER), fromLocalMeters(500, 0, CENTER)),
      seg(fromLocalMeters(0, -500, CENTER), fromLocalMeters(0, 0, CENTER)),
      seg(fromLocalMeters(0, 0, CENTER), fromLocalMeters(0, 500, CENTER)),
      feature('equipment', { type: 'Point', coordinates: fromLocalMeters(0, 50, CENTER) }, { amenity: 'hospital' })
    ];
    const iso = pedestrianIsochrones({ features: feats, center: CENTER });
    assert.ok(iso.ok);
    assert.equal(iso.nodes, 5);
    const five = iso.times.find(t => t.minutes === 5);
    assert.ok(Math.abs(five.reachableLengthM - 4 * 416.7) < 5, `5 min ≈ 1666.7 m, reçu ${five.reachableLengthM}`);
    assert.equal(five.pois, 1, 'hôpital à 50 m atteignable en 5 min');
    const fifteen = iso.times.find(t => t.minutes === 15);
    assert.ok(Math.abs(fifteen.reachableLengthM - 2000) < 5, '15 min couvre les 2000 m');
    assert.equal(iso.highlight.length, 4);
    assert.ok(iso.highlight.every(e => e.reachMin >= 0));
  });

  test('sky view factor : 1 sur terrain plat, < 1 sur pente forte', () => {
    const flat = { lat: CENTER.lat, lon: CENTER.lon, radius: 900, grid: Array.from({ length: 4 }, () => Array(4).fill(1000)) };
    assert.equal(skyViewFactor(flat, CENTER.lat, CENTER.lon).svf, 1);
    const steep = { lat: CENTER.lat, lon: CENTER.lon, radius: 900, grid: Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => 100 + c * 100)) };
    const svf = skyViewFactor(steep, CENTER.lat, CENTER.lon);
    assert.ok(svf.ok && svf.svf < 1 && svf.svf > 0.5, `svf ${svf.svf}`);
  });

  test('position du soleil : midi à l’équinoxe au sud, matin à l’est, nuit négative', () => {
    const noon = sunPosition(CENTER.lat, CENTER.lon, new Date('2026-03-20T12:00:00Z'));
    assert.ok(noon.elevationDeg > 45 && noon.elevationDeg < 60, `élévation ${noon.elevationDeg}`);
    assert.ok(noon.azimuthDeg > 160 && noon.azimuthDeg < 210, `azimut ${noon.azimuthDeg}`);
    const morning = sunPosition(CENTER.lat, CENTER.lon, new Date('2026-03-20T05:30:00Z'));
    assert.ok(morning.azimuthDeg > 60 && morning.azimuthDeg < 120, `azimut matin ${morning.azimuthDeg}`);
    const night = sunPosition(CENTER.lat, CENTER.lon, new Date('2026-06-21T00:00:00Z'));
    assert.ok(night.elevationDeg < 0);
  });

  test('coupe multi-points le long d’une polyligne en L', () => {
    const profile = polylineProfile(sampleTerrain(), [fromLocalMeters(-400, 0, CENTER), fromLocalMeters(0, 0, CENTER), fromLocalMeters(0, 400, CENTER)]);
    assert.ok(profile.ok);
    assert.ok(Math.abs(profile.lengthM - 800) / 800 < 0.02, `longueur ${profile.lengthM}`);
    assert.ok(profile.samples > 50);
    assert.ok(profile.riseM > 0);
    assert.equal(profile.vertices.length, 3);
    assert.equal(polylineProfile(null, [CENTER ? [CENTER.lon, CENTER.lat] : null]).reason, 'terrain-not-loaded');
    assert.equal(polylineProfile(sampleTerrain(), [[CENTER.lon, CENTER.lat]]).reason, 'invalid-line');
  });

  test('exagération verticale reprise dans le SVG de coupe', () => {
    const profile = sectionProfile(sampleTerrain(), fromLocalMeters(-400, 0, CENTER), fromLocalMeters(400, 0, CENTER));
    assert.ok(!profileToSvg(profile).includes('exagération'));
    assert.ok(profileToSvg(profile, { exaggeration: 5 }).includes('×5'));
  });

  test('le rapport PDF intègre les indicateurs complémentaires', () => {
    const report = computeSiteRatios({ features: sampleFeatures(), perimeter: PERIMETER, center: CENTER });
    const pdf = buildSiteReportPdf({
      title: 'Rapport avec indicateurs', projectName: 'Test', centerName: CENTER.name, center: CENTER,
      dateText: '06/11/2026', perimeterLabel: 'Cercle 500 m', studyAreaM2: report.studyAreaM2,
      rows: report.rows, totals: report.totals, builtCoverage: report.builtCoverage,
      featureCount: report.featureCount, usage: report.usage, profile: null,
      indicators: {
        spacematrix: computeSpacematrix({ features: sampleFeatures(), center: CENTER, studyAreaM2: report.studyAreaM2, roadLengthM: 1000, perimeter: PERIMETER }),
        canyons: streetCanyons({ features: sampleFeatures(), center: CENTER, perimeter: PERIMETER }),
        threeThirtyThreeHundred: threeThirtyThreeHundred({ features: sampleFeatures(), center: CENTER }),
        isochrones: { ok: false, reason: 'no-roads' },
        skyView: { ok: true, svf: 0.97 },
        sun: sunPosition(CENTER.lat, CENTER.lon, new Date('2026-03-20T12:00:00Z'))
      }
    });
    const text = Buffer.from(pdf).toString('latin1');
    assert.ok(text.includes('Spacematrix'));
    assert.ok(text.includes('Règle 3-30-300') || text.includes('3-30-300'));
    assert.ok(text.includes('Sky view factor'));
    assert.ok(text.includes('Soleil'));
    assert.ok((text.match(/\/Type \/Page[^s]/g) || []).length >= 4);
  });
});

describe('Câblage de la page Cadrage spatial', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/cadrage-spatial.html'), 'utf8');
  const js = fs.readFileSync(path.join(ROOT, 'public/js/spatial-framing.mjs'), 'utf8');

  test('la page expose le panneau d’analyse et ses commandes', () => {
    for (const id of ['analyzeSite', 'exportRatiosCsv', 'sunDateTime', 'analysisStatus', 'analysisMetrics', 'analysisChart', 'analysisUsage', 'analysisDetail', 'startSection', 'finishSectionBtn', 'sectionExaggeration', 'exportSectionSvg', 'exportSectionPng', 'sectionStatus', 'sectionChart', 'exportSiteReport'])
      assert.ok(html.includes(`id="${id}"`), id);
    assert.ok(html.includes('06 / ANALYSER LE SITE'));
  });

  test('le module de page importe site-analysis et branche les événements sans fetch externe', () => {
    assert.match(js, /from '\.\/site-analysis\.mjs'/);
    assert.match(js, /\$\('analyzeSite'\)\.addEventListener\('click', analyzeSite\)/);
    assert.match(js, /\$\('startSection'\)\.addEventListener\('click', startSectionTool\)/);
    assert.match(js, /\$\('finishSectionBtn'\)\.addEventListener\('click', finishSection\)/);
    assert.match(js, /polylineProfile\(state\.terrain, points\)/);
    assert.match(js, /pedestrianIsochrones\(\{ features: state\.osmFeatures/);
    assert.match(js, /\$\('exportSiteReport'\)\.addEventListener\('click', exportSiteReport\)/);
    assert.equal(js.includes('fetch("https://'), false);
    assert.equal(js.includes("fetch('https://"), false);
  });
});

describe('Parcours fonctionnel de fin de parcours (données → ratios → CSV → coupe → SVG → PDF)', () => {
  test('le scénario complet produit des artefacts cohérents', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'urbatrame-site-'));
    const features = sampleFeatures();
    const terrain = sampleTerrain();

    // 1. Chargement simulé (comme /api/atelier/cadrage-extract) puis analyse du périmètre
    const report = computeSiteRatios({ features, perimeter: PERIMETER, center: CENTER });
    assert.ok(report && report.featureCount === 4);

    // 2. Export CSV des ratios
    const csvPath = path.join(dir, 'ratios.csv');
    fs.writeFileSync(csvPath, ratiosToCsv(report), 'utf8');
    const csvLines = fs.readFileSync(csvPath, 'utf8').trimEnd().split('\r\n');
    assert.equal(csvLines.length, 12);
    assert.match(csvLines[1], /^Bâtiments;/);

    // 3. Coupe A→B + exports SVG
    const a = fromLocalMeters(-400, 0, CENTER), b = fromLocalMeters(400, 0, CENTER);
    const profile = sectionProfile(terrain, a, b);
    assert.ok(profile.ok);
    const coupePath = path.join(dir, 'coupe-AB.svg');
    fs.writeFileSync(coupePath, profileToSvg(profile), 'utf8');
    assert.ok(fs.readFileSync(coupePath, 'utf8').includes('<polyline'));
    const chartPath = path.join(dir, 'ratios.svg');
    fs.writeFileSync(chartPath, ratiosChartSvg(report), 'utf8');
    assert.ok(fs.readFileSync(chartPath, 'utf8').startsWith('<svg'));

    // 4. Rapport de site PDF complet (avec coupe)
    const pdfPath = path.join(dir, 'rapport-site.pdf');
    fs.writeFileSync(pdfPath, buildSiteReportPdf({
      title: 'Rapport de site — Constantine',
      projectName: 'Parcours fonctionnel',
      centerName: CENTER.name,
      center: CENTER,
      dateText: '06/11/2026',
      perimeterLabel: 'Cercle de 500 m autour du centre',
      studyAreaM2: report.studyAreaM2,
      rows: report.rows,
      totals: report.totals,
      builtCoverage: report.builtCoverage,
      featureCount: report.featureCount,
      usage: report.usage,
      profile
    }));
    const pdf = fs.readFileSync(pdfPath);
    assert.ok(pdf.subarray(0, 8).toString('latin1').startsWith('%PDF-1.4'));
    assert.equal((pdf.toString('latin1').match(/\/Type \/Page[^s]/g) || []).length, 4);

    // 5. Cohérence croisée : le taux d'occupation du CSV rejoint le rapport
    const tauxLine = csvLines.find(line => line.startsWith('Taux d’occupation'));
    const expectedPct = Math.round(report.builtCoverage * 1000) / 10;
    assert.ok(tauxLine.endsWith(`;${expectedPct}`), `${tauxLine} vs ${expectedPct}`);

    console.log(`artefacts écrits dans ${dir} : ratios.csv (${csvLines.length} lignes), coupe-AB.svg, ratios.svg, rapport-site.pdf (${pdf.length} o)`);
  });
});
