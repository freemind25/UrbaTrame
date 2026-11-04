const MAX_MERCATOR_LATITUDE = 85;

export function parseCoordinateQuery(value) {
  const text = String(value ?? '').trim();
  const match = text.match(/^(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return { matched: false, valid: false };

  const lat = Number(match[1]);
  const lon = Number(match[2]);
  const valid = Number.isFinite(lat) && Number.isFinite(lon) &&
    Math.abs(lat) <= MAX_MERCATOR_LATITUDE && Math.abs(lon) <= 180;
  return { matched: true, valid, lat, lon };
}

export function normalizeGeocodeResults(payload, limit = 8) {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.results) ? payload.results : [];
  const maxResults = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 20) : 8;
  const normalized = [];

  for (const row of rows) {
    if (!row || typeof row !== 'object' || row.lat == null || row.lon == null ||
        String(row.lat).trim() === '' || String(row.lon).trim() === '') continue;
    const lat = Number(row.lat);
    const lon = Number(row.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) ||
        Math.abs(lat) > MAX_MERCATOR_LATITUDE || Math.abs(lon) > 180) continue;

    const name = String(row.display_name || row.name || '').trim().replace(/\s+/g, ' ') ||
      `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    normalized.push({ lat, lon, name });
    if (normalized.length >= maxResults) break;
  }
  return normalized;
}
