import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ARCHI_VERSION, DEMO_SURVEY, normalizeSurvey, surveyWarnings, computeMetrics,
  describeHL, dayOfYear, solarDeclination, sunPosition, solarToLegal, legalOffsetHours,
  formatHour, litWidth, daylightStudy, daylightSummary, demainScenario,
  surveyFromJSON, surveyToJSON
} from '../public/js/archi-rue.mjs';
import { renderAll, svgPlanche, PLANCHE_W, PLANCHE_H } from '../public/js/archi-rue-draw.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const near = (actual, expected, tolerance, message) => {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${message || ''} attendu ${expected} ± ${tolerance}, obtenu ${actual}`);
};

describe('Analyse architecturale · relevé et indicateurs', () => {
  test('le relevé de démonstration est complet et cohérent', () => {
    const s = normalizeSurvey(DEMO_SURVEY);
    assert.equal(s.nom, 'Rue Montorgueil');
    assert.equal(s.largeur_facades, 12.1);
    assert.equal(s.bandes.length, 3);
    const sum = s.bandes.reduce((t, b) => t + b.largeur, 0);
    near(sum, s.largeur_facades, 0.001, 'somme des bandes');
    assert.equal(s.facades.ouest.immeubles.length, 4);
    assert.equal(s.facades.est.immeubles.length, 4);
    assert.ok(s.facades.ouest.hauteur_egout > 15 && s.facades.ouest.hauteur_egout < 20);
  });

  test('les valeurs manquantes sont bornées, jamais NaN', () => {
    const s = normalizeSurvey({ largeur_facades: 'abc', latitude: null, bandes: 'non' });
    assert.ok(Number.isFinite(s.largeur_facades));
    assert.ok(s.largeur_facades >= 2);
    assert.ok(Array.isArray(s.bandes) && s.bandes.length >= 1);
    assert.ok(Number.isFinite(s.bandes[0].largeur));
    assert.ok(Number.isFinite(s.facades.ouest.hauteur_egout));
  });

  test('une découpe d’immeubles absente est signalée comme supposée', () => {
    const s = normalizeSurvey({ nom: 'Rue test', largeur_facades: 12, facades: {} });
    assert.equal(s.facades.ouest.immeubles.length, 3);
    assert.ok(s.facades.ouest.immeubles.every(b => b.suppose === true));
    const messages = surveyWarnings(s).map(w => w.texte).join(' ');
    assert.match(messages, /supposée/);
  });

  test('un écart entre la largeur et la somme des bandes est signalé', () => {
    const s = normalizeSurvey({
      largeur_facades: 12,
      bandes: [{ type: 'terrasse', largeur: 4 }]
    });
    const warnings = surveyWarnings(s);
    assert.ok(warnings.some(w => w.niveau === 'warn' && /écart/.test(w.texte)));
  });

  test('H/L et type de rue suivent la définition, avec le ciel vu de l’axe', () => {
    const m = computeMetrics(DEMO_SURVEY);
    near(m.hl, m.hauteurMoyenne / m.largeur, 1e-9, 'H/L');
    assert.equal(m.typeRue, 'rue en canyon');
    near(m.partTerrasses + m.partPassage + m.partAutre, 100, 1e-6, 'somme des parts');
    assert.match(describeHL(m), /canyon|plus hautes/);
    assert.ok(m.cielDeg > 35 && m.cielDeg < 40);
  });

  test('une rue large et basse est classée « rue ouverte »', () => {
    const m = computeMetrics({
      largeur_facades: 24,
      facades: {
        ouest: { hauteur_egout: 6, hauteur_faitage: 9 },
        est: { hauteur_egout: 6, hauteur_faitage: 9 }
      }
    });
    assert.equal(m.typeRue, 'rue ouverte');
    assert.ok(m.hl < 0.5);
  });
});

describe('Analyse architecturale · astronomie', () => {
  test('le jour de l’année et la déclinaison sont justes aux solstices', () => {
    assert.equal(dayOfYear(2026, 6, 21), 172);
    assert.equal(dayOfYear(2026, 12, 21), 355);
    near(solarDeclination(172), 23.44, 0.4, 'déclinaison au solstice d’été');
    near(solarDeclination(355), -23.44, 0.5, 'déclinaison au solstice d’hiver');
    near(solarDeclination(81), 0, 0.9, 'déclinaison à l’équinoxe');
  });

  test('la hauteur du soleil à midi vaut 90° − latitude + déclinaison', () => {
    for (const [day, lat] of [[172, 48.86], [355, 48.86], [81, 36.36], [172, -33.9]]) {
      const sun = sunPosition({ day, solarHour: 12, latitude: lat });
      const expected = 90 - Math.abs(lat) + (lat >= 0 ? 1 : -1) * solarDeclination(day);
      near(sun.altitude, expected, 0.02, `jour ${day} / latitude ${lat}`);
      near(sun.azimuth, lat >= 0 ? 180 : 0, 0.05, 'azimut à midi');
    }
  });

  test('le matin le soleil est à l’est, le soir à l’ouest', () => {
    const matin = sunPosition({ day: 172, solarHour: 8, latitude: 48.86 });
    const soir = sunPosition({ day: 172, solarHour: 16, latitude: 48.86 });
    assert.ok(matin.azimuth > 45 && matin.azimuth < 135);
    assert.ok(soir.azimuth > 225 && soir.azimuth < 315);
  });

  test('la conversion en heure légale tient compte de la longitude', () => {
    assert.ok(Math.abs(legalOffsetHours({ longitude: 2.347, fuseau: 1 }) - 0.8435) < 0.01);
    const legal = solarToLegal({ longitude: 2.347, fuseau: 1 }, 12);
    near(legal, 12.8435, 0.01, 'midi solaire à Paris');
    assert.equal(formatHour(12.5), '12h30');
    assert.equal(formatHour(9.999), '10h00');
  });

  test('une rue encaissée laisse moins de sol éclairé qu’une rue ouverte', () => {
    const sun = sunPosition({ day: 172, solarHour: 12, latitude: 48.86 });
    const canyon = litWidth(DEMO_SURVEY, sun);
    const large = litWidth({ ...DEMO_SURVEY, largeur_facades: 30 }, sun);
    assert.ok(canyon < large);
  });
});

describe('Analyse architecturale · ensoleillement du sol', () => {
  test('le solstice d’été est plus ensoleillé que celui d’hiver', () => {
    const { summer, winter } = daylightSummary(DEMO_SURVEY);
    assert.ok(summer.anyHours > winter.anyHours);
    assert.ok(summer.meanHours > winter.meanHours);
    assert.ok(summer.anyHours <= 24);
    assert.ok(summer.maxAltitude > 60);
    assert.ok(winter.maxAltitude < 20);
  });

  test('les grandeurs sont cohérentes : moyenne ≤ maximum ≤ 24 h', () => {
    for (const day of [81, 172, 266, 355]) {
      const study = daylightStudy(DEMO_SURVEY, { day });
      assert.ok(study.meanHours <= study.anyHours + 1e-9, `jour ${day}`);
      assert.ok(study.anyHours <= 24 + 1e-9, `jour ${day}`);
      assert.ok(study.series.every(p => Number.isFinite(p.lit) && p.lit >= 0));
      if (study.anyHours > 0) {
        assert.ok(study.firstHour <= study.lastHour);
        assert.ok(study.firstLegal != null && study.lastLegal != null);
      }
    }
  });

  test('une rue orientée est-ouest et large reste éclairée plus longtemps', () => {
    const etoile = normalizeSurvey({ ...DEMO_SURVEY, axe_deg: 90, largeur_facades: 20 });
    const study = daylightStudy(etoile, { day: 172 });
    assert.ok(study.anyHours > 8);
  });
});

describe('Analyse architecturale · scénario « demain »', () => {
  test('le scénario respecte le passage libre minimum et ne supprime pas de terrasse', () => {
    const sc = demainScenario(DEMO_SURVEY);
    assert.ok(sc.freeAfter >= sc.minFree - 1e-9);
    assert.ok(sc.freeAfter <= sc.freeBefore);
    assert.ok(sc.trees > 0);
    near(sc.pleineTerre, sc.trees * sc.pit * sc.pit, 1e-9, 'pleine terre');
    for (const side of sc.sides) {
      assert.ok(side.terraceApres >= 0);
      assert.ok(side.terraceApres <= side.terraceAvant);
    }
    assert.ok(sc.verifications.length >= 3);
    assert.match(sc.verifications.join(' '), /DT-DICT/);
  });

  test('une rue trop étroite refuse les arbres au lieu de casser le passage', () => {
    const etroit = normalizeSurvey({
      nom: 'Ruelle',
      largeur_facades: 2.4,
      bandes: [{ type: 'passage', largeur: 2.4 }],
      facades: { ouest: { hauteur_egout: 10 }, est: { hauteur_egout: 10 } }
    });
    const sc = demainScenario(etroit);
    assert.equal(sc.trees, 0);
    assert.ok(sc.sides.every(s => s.raison));
  });
});

describe('Analyse architecturale · import et export', () => {
  test('l’export puis l’import redonne le même relevé', () => {
    const json = surveyToJSON(DEMO_SURVEY);
    const back = surveyFromJSON(json);
    assert.equal(back.nom, DEMO_SURVEY.nom);
    assert.equal(back.largeur_facades, DEMO_SURVEY.largeur_facades);
    assert.equal(back.facades.ouest.immeubles.length, DEMO_SURVEY.facades.ouest.immeubles.length);
  });

  test('un fichier enveloppé sous « rue » est accepté', () => {
    const s = surveyFromJSON(JSON.stringify({ rue: { largeur_facades: 9, bandes: [{ type: 'passage', largeur: 9 }] } }));
    assert.equal(s.largeur_facades, 9);
  });

  test('un fichier invalide est refusé avec un message clair', () => {
    assert.throws(() => surveyFromJSON('[1,2,3]'), /objet de relevé/);
    assert.throws(() => surveyFromJSON('{'), SyntaxError);
  });
});

describe('Analyse architecturale · planches SVG', () => {
  const drawings = renderAll(DEMO_SURVEY);

  test('les sept planches sont produites, au format 1080 × 1920', () => {
    assert.deepEqual(Object.keys(drawings).sort(),
      ['axo', 'demain', 'fronts', 'ombres', 'planche', 'profil', 'usages']);
    for (const [name, svg] of Object.entries(drawings)) {
      assert.match(svg, new RegExp(`width="${PLANCHE_W}" height="${PLANCHE_H}"`), name);
      assert.ok(svg.startsWith('<svg'), name);
      assert.ok(svg.trimEnd().endsWith('</svg>'), name);
      assert.ok(svg.length > 6000, `${name} : planche trop pauvre`);
    }
  });

  test('aucune valeur NaN, undefined ou texte coupé ne fuit dans les dessins', () => {
    for (const [name, svg] of Object.entries(drawings)) {
      assert.doesNotMatch(svg, /NaN/, name);
      assert.doesNotMatch(svg, /undefined/, name);
      assert.doesNotMatch(svg, />null</, name);
      for (const m of svg.matchAll(/<text x="(-?[\d.]+)" y="(-?[\d.]+)"/g)) {
        const x = Number(m[1]);
        const y = Number(m[2]);
        assert.ok(x > -40 && x < PLANCHE_W + 40, `${name} : texte hors cadre (x=${x})`);
        assert.ok(y > -40 && y < PLANCHE_H + 40, `${name} : texte hors cadre (y=${y})`);
      }
    }
  });

  test('les dessins sont autonomes : aucune ressource externe', () => {
    for (const [name, svg] of Object.entries(drawings)) {
      /* xmlns est un espace de noms XML, pas une ressource : on le retire. */
      const body = svg.replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, '');
      assert.doesNotMatch(body, /https?:\/\//, name);
      assert.doesNotMatch(body, /<image /, name);
      assert.doesNotMatch(body, /url\((?!#)/, name);
    }
  });

  test('le profil affiche H/L et les deux hauteurs à l’égout', () => {
    assert.match(drawings.profil, /H\/L ≈ 1,43/);
    assert.match(drawings.profil, /18,1 m/);
    assert.match(drawings.profil, /16,5 m/);
    assert.match(drawings.profil, /rue en canyon/);
  });

  test('les ombres donnent des heures et les deux saisons', () => {
    assert.match(drawings.ombres, /21 juin/);
    assert.match(drawings.ombres, /21 décembre/);
    assert.match(drawings.ombres, /de soleil direct au sol/);
  });

  test('la planche reprend les six dessins sans les redessiner', () => {
    const planche = drawings.planche;
    for (const titre of ['1 · Usages de la rue', '2 · Profil en travers', '3 · Front bâti',
      '4 · Axonométrie', '5 · Ensoleillement', '6 · Avant / après']) {
      assert.ok(planche.includes(titre), titre);
    }
    const embedded = (planche.match(/<g clip-path=/g) || []).length;
    assert.equal(embedded, 6);
  });
});

describe('Analyse architecturale · page et navigation', () => {
  const pages = ['public/index.html', 'public/atelier.html', 'public/atelier-analyse.html',
    'public/atelier-s5.html', 'public/atelier-cartographique.html', 'public/cadrage-spatial.html',
    'public/bibliotheque-cartes.html'];

  test('l’espace a son propre onglet et il est relié depuis toutes les pages', () => {
    for (const page of pages) {
      const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
      assert.match(html, /href="\/atelier-archi\.html"/, page);
    }
    const home = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
    assert.match(home, /data-fr="Analyse architecturale"/);
    assert.match(home, /data-en="Architectural analysis"/);
  });

  test('la page porte la marque et n’appelle aucune ressource distante', () => {
    const html = fs.readFileSync(path.join(ROOT, 'public/atelier-archi.html'), 'utf8');
    assert.match(html, /UrbaTrame/);
    assert.match(html, /Analyse des sites urbains/);
    assert.match(html, /Designed by M\.SADI/);
    assert.doesNotMatch(html, /https?:\/\//);
    assert.doesNotMatch(html, /<link[^>]+fonts\.googleapis/);
    assert.match(html, /aria-current="page"/);
  });

  test('la page charge le moteur de calcul et les dessins', () => {
    const html = fs.readFileSync(path.join(ROOT, 'public/atelier-archi.html'), 'utf8');
    assert.match(html, /\/js\/archi-rue-ui\.mjs/);
    const ui = fs.readFileSync(path.join(ROOT, 'public/js/archi-rue-ui.mjs'), 'utf8');
    assert.match(ui, /from '\.\/archi-rue\.mjs'/);
    assert.match(ui, /from '\.\/archi-rue-draw\.mjs'/);
    assert.match(ui, /localStorage/);
  });

  test('la page explique les hypothèses et l’usage local', () => {
    const html = fs.readFileSync(path.join(ROOT, 'public/atelier-archi.html'), 'utf8');
    assert.match(html, /hypothèses/i);
    assert.match(html, /aucun envoi|Aucun envoi|reste dans ce navigateur/);
    assert.match(html, /aucune image n’est générée/);
  });

  test('la version du module est datée pour le cache navigateur', () => {
    assert.match(ARCHI_VERSION, /^\d{8}archi\d+$/);
  });
});
