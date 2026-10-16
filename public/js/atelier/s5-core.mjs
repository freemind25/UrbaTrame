const EARTH_RADIUS = 6378137;
const MAX_MERCATOR_LAT = 85.0511287798066;

function finite(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError('Coordonnée non numérique.');
  return number;
}

export function lonLatToMercator(lonValue, latValue) {
  const lon = finite(lonValue);
  const lat = finite(latValue);
  if (lon < -180 || lon > 180 || lat < -MAX_MERCATOR_LAT || lat > MAX_MERCATOR_LAT) {
    throw new RangeError(`Coordonnée hors limites EPSG:3857 (latitude ±${MAX_MERCATOR_LAT.toFixed(4)}° maximum).`);
  }
  const phi = lat * Math.PI / 180;
  return {
    x: EARTH_RADIUS * lon * Math.PI / 180,
    y: EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + phi / 2))
  };
}

export function mercatorToLonLat(xValue, yValue) {
  const x = finite(xValue);
  const y = finite(yValue);
  const lon = x / EARTH_RADIUS * 180 / Math.PI;
  const lat = (2 * Math.atan(Math.exp(y / EARTH_RADIUS)) - Math.PI / 2) * 180 / Math.PI;
  return { lon, lat };
}

function pixelPair(point) {
  const pair = Array.isArray(point?.pixel) ? point.pixel : [point?.pixel?.x, point?.pixel?.y];
  return [finite(pair[0]), finite(pair[1])];
}

function worldPair(point) {
  const pair = Array.isArray(point?.world) ? point.world : [point?.world?.x, point?.world?.y];
  return [finite(pair[0]), finite(pair[1])];
}

/** Fit an affine pixel-to-EPSG:3857 transform from three or more matched points. */
export function solveAffineTransform(points) {
  const valid = (Array.isArray(points) ? points : []).map(point => {
    const [x, y] = pixelPair(point);
    const [X, Y] = worldPair(point);
    return { x, y, X, Y };
  });
  if (valid.length < 3) throw new RangeError('Il faut au moins trois points communs.');

  const mean = key => valid.reduce((sum, point) => sum + point[key], 0) / valid.length;
  const mx = mean('x'), my = mean('y'), mX = mean('X'), mY = mean('Y');
  let sxx = 0, syy = 0, sxy = 0, sxX = 0, syX = 0, sxY = 0, syY = 0;
  let wxx = 0, wyy = 0, wxy = 0;
  for (const point of valid) {
    const x = point.x - mx, y = point.y - my;
    const X = point.X - mX, Y = point.Y - mY;
    sxx += x * x; syy += y * y; sxy += x * y;
    wxx += X * X; wyy += Y * Y; wxy += X * Y;
    sxX += x * X; syX += y * X; sxY += x * Y; syY += y * Y;
  }
  const determinant = sxx * syy - sxy * sxy;
  const scale = Math.max(1, sxx * syy);
  if (Math.abs(determinant) <= Number.EPSILON * scale * 64) {
    throw new RangeError('Les points image sont alignés ou trop rapprochés; ajoutez des repères mieux répartis.');
  }
  const worldDeterminant = wxx * wyy - wxy * wxy;
  const worldScale = Math.max(1, wxx * wyy);
  if (Math.abs(worldDeterminant) <= Number.EPSILON * worldScale * 64) {
    throw new RangeError('Les coordonnées des repères sont alignées ou trop rapprochées; vérifiez latitude et longitude.');
  }

  const a = (sxX * syy - syX * sxy) / determinant;
  const b = (syX * sxx - sxX * sxy) / determinant;
  const d = (sxY * syy - syY * sxy) / determinant;
  const e = (syY * sxx - sxY * sxy) / determinant;
  const c = mX - a * mx - b * my;
  const f = mY - d * mx - e * my;
  const residuals = valid.map(point => {
    const dx = a * point.x + b * point.y + c - point.X;
    const dy = d * point.x + e * point.y + f - point.Y;
    return Math.hypot(dx, dy);
  });
  const rmse = Math.sqrt(residuals.reduce((sum, value) => sum + value * value, 0) / residuals.length);
  return { a, b, c, d, e, f, rmse, pointCount: valid.length, residuals };
}

export function transformPixel(transform, xValue, yValue) {
  const x = finite(xValue), y = finite(yValue);
  if (!transform || !['a', 'b', 'c', 'd', 'e', 'f'].every(key => Number.isFinite(transform[key]))) {
    throw new TypeError('Transformation affine invalide.');
  }
  return {
    x: transform.a * x + transform.b * y + transform.c,
    y: transform.d * x + transform.e * y + transform.f
  };
}

export function isFreeModel(model, provider = '') {
  const id = String(model?.id || model?.name || '');
  const idDeclaresFree = /:free$/i.test(id) || /^openrouter\/free$/i.test(id) || (provider === 'apinex' && /^free\//i.test(id));
  const pricing = model?.pricing && typeof model.pricing === 'object' ? model.pricing : {};
  const prices = Object.values(pricing).filter(value => value !== null && value !== undefined);
  // Reject a model if any declared input/output/image/request price is nonzero
  // or unreadable, even when its identifier contains a free marker.
  if (prices.some(value => !Number.isFinite(Number(value)) || Number(value) !== 0)) return false;
  const prompt = Number(pricing.prompt ?? pricing.input ?? NaN);
  const completion = Number(pricing.completion ?? pricing.output ?? NaN);
  const zeroPricing = Number.isFinite(prompt) && Number.isFinite(completion) && prompt === 0 && completion === 0;
  return zeroPricing || idDeclaresFree;
}

export function modelImageCapability(model) {
  const candidates = [
    model?.architecture?.input_modalities,
    model?.input_modalities,
    model?.modalities?.input,
    model?.capabilities?.input_modalities
  ];
  for (const value of candidates) {
    if (Array.isArray(value)) return value.some(item => /image|vision|visual/i.test(String(item)));
  }
  if (model?.vision === true || model?.supports_vision === true) return true;
  if (model?.vision === false || model?.supports_vision === false) return false;
  return null;
}

export function freeModelsFromCatalog(payload, provider = '') {
  const models = Array.isArray(payload) ? payload : (payload?.data || payload?.models || []);
  if (!Array.isArray(models)) return [];
  return models.filter(model => isFreeModel(model, provider)).map(model => ({
    id: String(model.id || model.name || ''),
    name: String(model.name || model.id || 'Modèle sans nom'),
    vision: modelImageCapability(model),
    raw: model
  })).filter(model => model.id.length > 0);
}

export function parseAiJson(content) {
  let text = String(content || '').trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try { return JSON.parse(text); } catch { /* chercher l’objet JSON s’il y a une phrase d’introduction */ }
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new SyntaxError('La réponse IA ne contient pas d’objet JSON lisible.');
  return JSON.parse(text.slice(start, end + 1));
}

export function validateAiSynthesis(value) {
  if (!value || typeof value !== 'object') throw new TypeError('Réponse de synthèse invalide.');
  const summary = typeof value.summary === 'string' ? value.summary.trim().slice(0, 1600) : '';
  const allowed = new Set(['viaire', 'bâti', 'eau', 'végétation', 'espace-ouvert', 'autre']);
  const observations = (Array.isArray(value.observations) ? value.observations : []).slice(0, 8).map((item, index) => {
    const x = Number(item?.x), y = Number(item?.y), confidence = Number(item?.confidence);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return null;
    return {
      id: `ai-${Date.now()}-${index}`,
      label: String(item?.label || `Observation ${index + 1}`).trim().slice(0, 100),
      category: allowed.has(item?.category) ? item.category : 'autre',
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5,
      detail: String(item?.detail || '').trim().slice(0, 500),
      x, y,
      confirmed: false,
      origin: 'IA'
    };
  }).filter(Boolean);
  return { summary, observations };
}
