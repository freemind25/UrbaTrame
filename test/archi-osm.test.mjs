import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { surveyFromOSM, fetchSurveyOSM } from '../public/js/archi-osm.mjs';

/* Rue est-ouest à lat 36.0 (lon 6.000 → 6.010), largeur taguée 8 m. */
const road = {
  type: 'way', tags: { highway: 'residential', width: '8' },
  geometry: [{ lat: 36.0, lon: 6.000 }, { lat: 36.0, lon: 6.005 }, { lat: 36.0, lon: 6.010 }]
};
const bNorth = {
  type: 'way', tags: { building: 'yes', height: '18', 'building:levels': '5', shop: 'cafe' },
  geometry: [{ lat: 36.0001, lon: 6.002 }, { lat: 36.0001, lon: 6.004 }, { lat: 36.00005, lon: 6.004 }, { lat: 36.00005, lon: 6.002 }]
};
const bSouthNoH = {
  type: 'way', tags: { building: 'apartments', 'building:levels': '3' },
  geometry: [{ lat: 35.9999, lon: 6.006 }, { lat: 35.9999, lon: 6.008 }, { lat: 35.99995, lon: 6.008 }, { lat: 35.99995, lon: 6.006 }]
};

describe('surveyFromOSM', () => {
  test('renvoie null sans route', () => {
    assert.equal(surveyFromOSM([], { lat: 36, lon: 6 }), null);
    assert.equal(surveyFromOSM([bNorth], { lat: 36, lon: 6 }), null);
  });

  test('relève la rue principale : largeur, axe, bandes cohérentes', () => {
    const s = surveyFromOSM([road, bNorth, bSouthNoH], { lat: 36.0, lon: 6.005, nom: 'Test', lieu: 'Testville' });
    assert.ok(s);
    assert.equal(s.nom, 'Test');
    assert.equal(s.largeur_facades, 8);
    assert.ok(Math.abs(s.axe_deg - 90) < 3, 'axe ≈ est (90°), lu ' + s.axe_deg);
    assert.equal(s.axe_hypothese, true);
    const sum = s.bandes.reduce((t, b) => t + b.largeur, 0);
    assert.ok(Math.abs(sum - 8) < 0.05, 'bandes sommées = largeur : ' + sum);
    assert.ok(s.bandes.some(b => b.type === 'passage'));
    assert.equal(s.bandes.filter(b => b.type === 'trottoir').length, 2);
  });

  test('immeubles répartis est/ouest avec hauteurs OSM et hypothèses', () => {
    const s = surveyFromOSM([road, bNorth, bSouthNoH], { lat: 36.0, lon: 6.005 });
    const all = [...s.facades.ouest.immeubles, ...s.facades.est.immeubles];
    assert.equal(all.length, 2);
    const withH = all.find(b => b.hauteur_egout === 18);
    assert.ok(withH, 'hauteur taguée 18 m reprise');
    assert.equal(withH.rdc, 'commerce');
    const noH = all.find(b => b.hauteur_egout !== 18);
    assert.ok(noH && noH.suppose === true, 'sans hauteur OSM → niveaux × 3,1 supposés');
    assert.ok(Math.abs(noH.hauteur_egout - 3 * 3.1) < 0.01);
    assert.equal(s.facades.ouest.immeubles.length + s.facades.est.immeubles.length, 2);
    assert.equal(s.facades.ouest.immeubles.length, 1, 'un immeuble à l’ouest');
    assert.equal(s.facades.est.immeubles.length, 1, 'un immeuble à l’est');
  });

  test('voie piétonne → bande passage unique', () => {
    const ped = { type: 'way', tags: { highway: 'pedestrian' }, geometry: road.geometry };
    const s = surveyFromOSM([ped], { lat: 36.0, lon: 6.005 });
    assert.ok(s);
    assert.equal(s.bandes.length, 1);
    assert.equal(s.bandes[0].type, 'passage');
  });

  test('largeur par défaut selon la classe si pas de tag width', () => {
    const tertiary = { type: 'way', tags: { highway: 'tertiary' }, geometry: road.geometry };
    const s = surveyFromOSM([tertiary], { lat: 36.0, lon: 6.005 });
    assert.equal(s.largeur_facades, 7);
  });
});

describe('relais serveur /api/atelier/archi', () => {
  const road = {
    type: 'way', tags: { highway: 'residential', width: '8' },
    geometry: [{ lat: 36.0, lon: 6.000 }, { lat: 36.0, lon: 6.010 }]
  };
  const b1 = {
    type: 'way', tags: { building: 'yes', height: '12' },
    geometry: [{ lat: 36.0001, lon: 6.002 }, { lat: 36.0001, lon: 6.004 }, { lat: 36.00005, lon: 6.004 }, { lat: 36.00005, lon: 6.002 }]
  };
  async function withFetch(mock, fn) {
    const old = globalThis.fetch;
    globalThis.fetch = mock;
    try { return await fn(); } finally { globalThis.fetch = old; }
  }

  test('fetchSurveyOSM passe d’abord par le relais serveur', async () => {
    const calls = [];
    const s = await withFetch(async (url, opts) => {
      calls.push({ url, body: JSON.parse(opts.body) });
      return { ok: true, status: 200, json: async () => ({ ok: true, elements: [road, b1] }) };
    }, () => fetchSurveyOSM({ overpassDirect: async () => { throw new Error('overpassDirect ne doit pas être appelé'); } }, 36.0, 6.005));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/atelier/archi');
    assert.deepEqual(calls[0].body, { kind: 'rue', lat: 36.0, lon: 6.005, radius: 150 });
    assert.ok(s && s.largeur_facades === 8, 'relevé construit depuis les éléments du relais');
  });

  test('relais 404 (page sans serveur) → repli sur overpassDirect', async () => {
    let direct = 0;
    const s = await withFetch(async () => ({ ok: false, status: 404, json: async () => ({ error: 'NOT_FOUND' }) }), () =>
      fetchSurveyOSM({
        overpassDirect: async (q) => { direct += 1; assert.ok(q.includes('around:150,36,6.005')); return { elements: [road, b1] }; }
      }, 36.0, 6.005));
    assert.equal(direct, 1, 'overpassDirect appelé une fois en repli');
    assert.ok(s && s.largeur_facades === 8);
  });

  test('relais 401 (auth requise) → repli sur overpassDirect', async () => {
    let direct = 0;
    const s = await withFetch(async () => ({ ok: false, status: 401, json: async () => ({ error: 'STUDENT_AUTH_REQUIRED' }) }), () =>
      fetchSurveyOSM({
        overpassDirect: async () => { direct += 1; return { elements: [road, b1] }; }
      }, 36.0, 6.005));
    assert.equal(direct, 1, 'overpassDirect appelé en repli après 401');
    assert.ok(s && s.largeur_facades === 8);
  });

  test('relais 502 + miroirs KO → erreur du relais propagée avec retryAfter', async () => {
    await withFetch(async () => ({
      ok: false, status: 502,
      json: async () => ({ ok: false, error: 'MAP_DATA_UNAVAILABLE', retryAfter: 30 })
    }), async () => {
      await assert.rejects(
        () => fetchSurveyOSM({ overpassDirect: async () => { throw new Error('MAP_SOURCE_UNAVAILABLE'); } }, 36.0, 6.005),
        (e) => e.code === 'MAP_DATA_UNAVAILABLE' && e.retryAfter === 30
      );
    });
  });
});
