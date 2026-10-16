/* Rose des vents NASA POWER : statistique régionale MERRA-2 à 10 m.
   L'API fournit 16 secteurs (direction d'où vient le vent), une fréquence
   directionnelle et une vitesse moyenne par secteur. Ce n'est pas un modèle
   de vent local autour des bâtiments. */
import { SOURCES, UA, TIMEOUTS } from '../config.mjs';
import { fetchT } from './overpass.mjs';

export const WINDROSE_YEARS = 10;

/* Dix années civiles complètes : la dernière est toujours l'année achevée,
   afin de ne pas mélanger une climatologie avec une année partielle. */
export function windrosePeriod(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(date.getTime())) throw new Error('INVALID_DATE');
  const endYear = date.getUTCFullYear() - 1;
  const startYear = endYear - WINDROSE_YEARS + 1;
  return {
    start: `${startYear}-01-01`,
    end: `${endYear}-12-31`,
    years: WINDROSE_YEARS
  };
}

function validLocation(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) &&
    Math.abs(lat) <= 85 && Math.abs(lon) <= 180;
}

/* Normalise et valide le contrat NASA. Exportée pour les tests hors ligne. */
export function normalizeWindrosePayload(payload, period = windrosePeriod()) {
  const sources = payload?.header?.sources;
  if (!Array.isArray(sources) || !sources.some(s => String(s).toLowerCase() === 'merra2'))
    throw new Error('NO_WINDROSE_SOURCE');

  const raw = payload?.properties?.parameter?.WR10M;
  if (!raw || typeof raw !== 'object') throw new Error('NO_WINDROSE_DATA');
  const rows = Object.entries(raw).filter(([key]) => key.toUpperCase() !== 'ALL');
  if (rows.length !== 16) throw new Error('INVALID_WINDROSE_SECTORS');

  const sectors = rows.map(([key, value]) => {
    const bearing = Number(key);
    const frequencyPct = Number(value?.WD_PCT);
    const meanSpeedMs = Number(value?.WD_AVG);
    const sectorIndex = Math.round(bearing / 22.5);
    const expectedBearing = sectorIndex * 22.5;
    if (!Number.isFinite(bearing) || bearing < 0 || bearing >= 360 ||
        Math.abs(bearing - expectedBearing) > 0.01 ||
        !Number.isFinite(frequencyPct) || frequencyPct < 0 || frequencyPct > 100 ||
        !Number.isFinite(meanSpeedMs) || meanSpeedMs < 0 || meanSpeedMs > 100)
      throw new Error('INVALID_WINDROSE_SECTOR');
    return { bearing, frequencyPct, meanSpeedMs };
  }).sort((a, b) => a.bearing - b.bearing);

  if (new Set(sectors.map(s => s.bearing)).size !== 16 ||
      sectors.some((s, i) => Math.abs(s.bearing - i * 22.5) > 0.01))
    throw new Error('INVALID_WINDROSE_SECTORS');

  const totalPct = sectors.reduce((sum, s) => sum + s.frequencyPct, 0);
  if (totalPct < 90 || totalPct > 110) throw new Error('INVALID_WINDROSE_TOTAL');
  const meanSpeedMs = sectors.reduce((sum, s) => sum + s.frequencyPct * s.meanSpeedMs, 0) / totalPct;
  const startYear = String(period.start || '').slice(0, 4);
  const endYear = String(period.end || '').slice(0, 4);
  const timeStandard = String(payload?.header?.time_standard || 'LST');

  return {
    ok: true,
    source: 'NASA POWER',
    product: 'Wind Rose API',
    dataset: 'MERRA-2',
    heightM: 10,
    timeStandard,
    period: {
      start: period.start,
      end: period.end,
      years: Number(period.years) || WINDROSE_YEARS
    },
    meanSpeedMs: Number(meanSpeedMs.toFixed(3)),
    sectors
  };
}

export async function windrose(lat, lon, { now = new Date() } = {}) {
  lat = Number(lat); lon = Number(lon);
  if (!validLocation(lat, lon)) throw new Error('INVALID_LOCATION');

  const period = windrosePeriod(now);
  const params = new URLSearchParams({
    longitude: lon.toFixed(4),
    latitude: lat.toFixed(4),
    start: period.start.replaceAll('-', ''),
    end: period.end.replaceAll('-', ''),
    format: 'JSON'
  });
  const response = await fetchT(SOURCES.windrose + '?' + params.toString(), {
    headers: { 'User-Agent': UA, Accept: 'application/json' }
  }, TIMEOUTS.windrose);
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return normalizeWindrosePayload(await response.json(), period);
}
