/* Contrat NASA POWER Wind Rose : normalisation hors ligne et périodes
   climatologiques de dix années civiles complètes. */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWindrosePayload, windrosePeriod } from '../server/sources/windrose.mjs';

function payload() {
  const parameter = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [
    String(i * 22.5), { WD_PCT: 6.25, WD_AVG: 2 + i / 10 }
  ]));
  parameter.ALL = {};
  return {
    header: { sources: ['merra2'], time_standard: 'LST' },
    properties: { parameter: { WR10M: parameter } }
  };
}

describe('rose des vents NASA POWER', () => {
  test('la période couvre dix années civiles achevées', () => {
    assert.deepEqual(windrosePeriod(new Date('2026-10-15T00:00:00Z')),
      { start: '2016-01-01', end: '2025-12-31', years: 10 });
    assert.deepEqual(windrosePeriod(new Date('2027-01-02T00:00:00Z')),
      { start: '2017-01-01', end: '2026-12-31', years: 10 });
  });

  test('normalise les 16 secteurs, la période et la vitesse pondérée', () => {
    const result = normalizeWindrosePayload(payload(), {
      start: '2016-01-01', end: '2025-12-31', years: 10
    });
    assert.equal(result.ok, true);
    assert.equal(result.source, 'NASA POWER');
    assert.equal(result.dataset, 'MERRA-2');
    assert.equal(result.heightM, 10);
    assert.equal(result.timeStandard, 'LST');
    assert.equal(result.sectors.length, 16);
    assert.deepEqual(result.sectors.map(s => s.bearing),
      Array.from({ length: 16 }, (_, i) => i * 22.5));
    assert.equal(result.period.start, '2016-01-01');
    assert.ok(result.meanSpeedMs > 2 && result.meanSpeedMs < 4);
    assert.ok(Math.abs(result.sectors.reduce((sum, s) => sum + s.frequencyPct, 0) - 100) < 0.01);
  });

  test('rejette une réponse incomplète ou des fréquences incohérentes', () => {
    const incomplete = payload();
    delete incomplete.properties.parameter.WR10M['337.5'];
    assert.throws(() => normalizeWindrosePayload(incomplete), /INVALID_WINDROSE_SECTORS/);

    const invalid = payload();
    invalid.properties.parameter.WR10M['0'].WD_PCT = 110;
    assert.throws(() => normalizeWindrosePayload(invalid), /INVALID_WINDROSE_SECTOR/);
  });
});
