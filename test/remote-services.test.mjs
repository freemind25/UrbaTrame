import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildVectorRequestUrl, buildWmtsTileUrl, fetchPaginatedVectorService, MAX_REMOTE_FEATURES, MAX_REMOTE_PAGES, REMOTE_PAGE_SIZE } from '../public/js/atelier/remote-services.mjs';

describe('UrbaTrame · requêtes vectorielles explicites', () => {
  test('construit une tuile WMTS 1.0.0 en matrice Web Mercator', () => {
    const url = new URL(buildWmtsTileUrl({ url: 'https://tiles.example.org/wmts?token=redacted', layer: 'orthophoto', matrixSet: 'GoogleMapsCompatible', style: 'default', format: 'image/png' }, 12, 1442, 1234));
    assert.equal(url.searchParams.get('SERVICE'), 'WMTS');
    assert.equal(url.searchParams.get('REQUEST'), 'GetTile');
    assert.equal(url.searchParams.get('VERSION'), '1.0.0');
    assert.equal(url.searchParams.get('LAYER'), 'orthophoto');
    assert.equal(url.searchParams.get('TILEMATRIXSET'), 'GoogleMapsCompatible');
    assert.equal(url.searchParams.get('TILEMATRIX'), '12');
    assert.equal(url.searchParams.get('TILEROW'), '1442');
    assert.equal(url.searchParams.get('TILECOL'), '1234');
    assert.throws(() => buildWmtsTileUrl({ url: 'http://tiles.example.org/wmts', layer: 'x' }, 0, 0, 0), error => error.code === 'WMTS_PARAMETERS_INVALID');
    assert.throws(() => buildWmtsTileUrl({ url: 'https://tiles.example.org/wmts', layer: 'x', matrixSet: 'custom' }, 0, 0, 0), error => error.code === 'WMTS_MATRIXSET_UNSUPPORTED');
    assert.throws(() => buildWmtsTileUrl({ url: 'https://tiles.example.org/wmts', layer: 'x' }, 2, 0, 4), error => error.code === 'WMTS_PARAMETERS_INVALID');
  });

  test('prépare un WFS GetFeature avec CRS lon/lat et limite de 1000 enregistrements', () => {
    const url = buildVectorRequestUrl('wfs', 'https://maps.example.org/geoserver/wfs?token=redacted', 'workspace:parks');
    assert.equal(url.searchParams.get('SERVICE'), 'WFS');
    assert.equal(url.searchParams.get('VERSION'), '2.0.0');
    assert.equal(url.searchParams.get('TYPENAMES'), 'workspace:parks');
    assert.equal(url.searchParams.get('SRSNAME'), 'urn:ogc:def:crs:OGC:1.3:CRS84');
    assert.equal(url.searchParams.get('COUNT'), '1000');
    assert.equal(url.searchParams.get('STARTINDEX'), '0');
    assert.equal(buildVectorRequestUrl('wfs', 'https://maps.example.org/geoserver/wfs', 'workspace:parks', 1000).searchParams.get('STARTINDEX'), '1000');
    assert.equal(url.searchParams.get('token'), 'redacted');
  });

  test('prépare une requête ArcGIS FeatureServer JSON et exige un index de couche', () => {
    const url = buildVectorRequestUrl('arcgis', 'https://gis.example.org/arcgis/rest/services/plans/FeatureServer/2');
    assert.match(url.pathname, /FeatureServer\/2\/query$/);
    assert.equal(url.searchParams.get('f'), 'geojson');
    assert.equal(url.searchParams.get('outSR'), '4326');
    assert.equal(url.searchParams.get('where'), '1=1');
    assert.equal(url.searchParams.get('resultRecordCount'), '1000');
    assert.equal(url.searchParams.get('resultOffset'), '0');
    assert.equal(buildVectorRequestUrl('arcgis', 'https://gis.example.org/FeatureServer/2', '', 1000).searchParams.get('resultOffset'), '1000');
    assert.throws(() => buildVectorRequestUrl('arcgis', 'https://gis.example.org/FeatureServer'), error => error.code === 'ARCGIS_FEATURE_LAYER_REQUIRED');
  });

  test('prépare une requête ArcGIS MapServer de couche et son offset', () => {
    const url = buildVectorRequestUrl('arcgis-map', 'https://gis.example.org/rest/services/urban/MapServer/4', '', 1000);
    assert.match(url.pathname, /MapServer\/4\/query$/);
    assert.equal(url.searchParams.get('f'), 'geojson');
    assert.equal(url.searchParams.get('outSR'), '4326');
    assert.equal(url.searchParams.get('resultRecordCount'), '1000');
    assert.equal(url.searchParams.get('resultOffset'), '1000');
    assert.throws(() => buildVectorRequestUrl('arcgis-map', 'https://gis.example.org/rest/services/urban/MapServer'), error => error.code === 'ARCGIS_MAP_LAYER_REQUIRED');
  });

  test('refuse HTTP, typeName manquant et type non pris en charge', () => {
    assert.throws(() => buildVectorRequestUrl('geojson', 'http://example.org/data.json'), error => error.code === 'SERVICE_HTTPS_REQUIRED');
    assert.throws(() => buildVectorRequestUrl('wfs', 'https://example.org/wfs'), error => error.code === 'WFS_TYPE_REQUIRED');
    assert.throws(() => buildVectorRequestUrl('custom', 'https://example.org/data'), error => error.code === 'SERVICE_TYPE_UNSUPPORTED');
    assert.throws(() => buildVectorRequestUrl('wfs', 'https://example.org/wfs', 'ws:layer', -1), error => error.code === 'SERVICE_OFFSET_INVALID');
    assert.throws(() => buildVectorRequestUrl('geojson', 'https://example.org/data.geojson', '', 1000), error => error.code === 'SERVICE_PAGINATION_UNSUPPORTED');
  });
});

function featureCollection(count, start = 0, extras = {}) {
  return JSON.stringify({ type: 'FeatureCollection', ...extras, features: Array.from({ length: count }, (_, index) => ({
    type: 'Feature', id: start + index, properties: { id: start + index }, geometry: { type: 'Point', coordinates: [index / 100, index / 100] }
  })) });
}

describe('UrbaTrame · pagination vectorielle bornée', () => {
  test('récupère les pages WFS jusqu’à la page incomplète et avance par STARTINDEX', async () => {
    const offsets = [];
    const result = await fetchPaginatedVectorService({
      type: 'wfs', rawUrl: 'https://maps.example.org/wfs', typeName: 'ws:parks',
      fetcher: async (rawUrl, options) => {
        assert.equal(options.credentials, 'omit');
        assert.equal(options.mode, 'cors');
        const url = new URL(rawUrl), offset = Number(url.searchParams.get('STARTINDEX'));
        offsets.push(offset);
        return new Response(featureCollection(offset === 0 ? REMOTE_PAGE_SIZE : 25, offset), { status: 200, headers: { 'content-type': 'application/geo+json' } });
      }
    });
    assert.deepEqual(offsets, [0, REMOTE_PAGE_SIZE]);
    assert.equal(result.pages, 2);
    assert.equal(result.features, REMOTE_PAGE_SIZE + 25);
    assert.equal(result.geojson.features.length, result.features);
    assert.equal(result.geojson.remoteTruncated, false);
    assert.equal(result.geojson.remotePages, 2);
  });

  test('honore numberMatched pour reconnaître une page finale pleine', async () => {
    let requests = 0;
    const result = await fetchPaginatedVectorService({
      type: 'wfs', rawUrl: 'https://maps.example.org/wfs', typeName: 'ws:parks',
      fetcher: async () => { requests++; return new Response(featureCollection(REMOTE_PAGE_SIZE, 0, { numberMatched: REMOTE_PAGE_SIZE }), { status: 200 }); }
    });
    assert.equal(requests, 1);
    assert.equal(result.features, REMOTE_PAGE_SIZE);
    assert.equal(result.truncated, false);
  });

  test('suit exceededTransferLimit ArcGIS même si la page est inférieure à 1000 entités', async () => {
    const offsets = [];
    const result = await fetchPaginatedVectorService({
      type: 'arcgis', rawUrl: 'https://gis.example.org/rest/services/parks/FeatureServer/0',
      fetcher: async rawUrl => {
        const url = new URL(rawUrl), offset = Number(url.searchParams.get('resultOffset'));
        offsets.push(offset);
        return new Response(offset === 0
          ? featureCollection(2, 0, { exceededTransferLimit: true })
          : featureCollection(1, 2), { status: 200 });
      }
    });
    assert.deepEqual(offsets, [0, 2]);
    assert.equal(result.features, 3);
    assert.equal(result.truncated, false);
  });

  test('pagine également les couches ArcGIS MapServer queryables', async () => {
    const offsets = [];
    const result = await fetchPaginatedVectorService({
      type: 'arcgis-map', rawUrl: 'https://gis.example.org/rest/services/urban/MapServer/4',
      fetcher: async rawUrl => {
        const offset = Number(new URL(rawUrl).searchParams.get('resultOffset'));
        offsets.push(offset);
        return new Response(offset === 0
          ? featureCollection(2, 0, { exceededTransferLimit: true })
          : featureCollection(1, 2), { status: 200 });
      }
    });
    assert.deepEqual(offsets, [0, 2]);
    assert.equal(result.features, 3);
  });

  test('traite GeoJSON comme une réponse unique de 15 Mo, sans plafond de page WFS', async () => {
    let requests = 0;
    const result = await fetchPaginatedVectorService({
      type: 'geojson', rawUrl: 'https://maps.example.org/data.geojson',
      fetcher: async () => { requests++; return new Response(featureCollection(REMOTE_PAGE_SIZE + 1), { status: 200 }); }
    });
    assert.equal(requests, 1);
    assert.equal(result.features, REMOTE_PAGE_SIZE + 1);
    assert.equal(result.pages, 1);
  });

  test('arrête la pagination à 5 000 entités et signale une suite non demandée', async () => {
    const offsets = [];
    const result = await fetchPaginatedVectorService({
      type: 'wfs', rawUrl: 'https://maps.example.org/wfs', typeName: 'ws:parks',
      fetcher: async rawUrl => {
        const offset = Number(new URL(rawUrl).searchParams.get('STARTINDEX'));
        offsets.push(offset);
        return new Response(featureCollection(REMOTE_PAGE_SIZE, offset, { numberMatched: '9000' }), { status: 200 });
      }
    });
    assert.deepEqual(offsets, [0, 1000, 2000, 3000, 4000]);
    assert.equal(offsets.length, MAX_REMOTE_FEATURES / REMOTE_PAGE_SIZE);
    assert.equal(result.features, MAX_REMOTE_FEATURES);
    assert.equal(result.truncated, true);
    assert.equal(result.truncationReason, 'FEATURE_LIMIT');
    assert.equal(result.geojson.remoteTruncationReason, 'FEATURE_LIMIT');
  });

  test('borne le nombre de pages même si chaque réponse n’apporte qu’une entité', async () => {
    const offsets = [];
    const result = await fetchPaginatedVectorService({
      type: 'arcgis', rawUrl: 'https://gis.example.org/rest/services/parks/FeatureServer/0',
      fetcher: async rawUrl => {
        const offset = Number(new URL(rawUrl).searchParams.get('resultOffset'));
        offsets.push(offset);
        return new Response(featureCollection(1, offset, { exceededTransferLimit: true }), { status: 200 });
      }
    });
    assert.equal(offsets.length, MAX_REMOTE_PAGES);
    assert.deepEqual(offsets, Array.from({ length: MAX_REMOTE_PAGES }, (_, index) => index));
    assert.equal(result.features, MAX_REMOTE_PAGES);
    assert.equal(result.truncated, true);
    assert.equal(result.truncationReason, 'PAGE_LIMIT');
    assert.equal(result.geojson.remoteTruncationReason, 'PAGE_LIMIT');
  });

  test('arrête un service qui ignore les offsets et répète la même page', async () => {
    let requests = 0;
    await assert.rejects(fetchPaginatedVectorService({
      type: 'wfs', rawUrl: 'https://maps.example.org/wfs', typeName: 'ws:parks',
      fetcher: async () => { requests++; return new Response(featureCollection(REMOTE_PAGE_SIZE, 0), { status: 200 }); }
    }), error => error.code === 'REMOTE_PAGINATION_REPEATED');
    assert.equal(requests, 2);
  });

  test('transmet un AbortSignal et impose un délai aux requêtes distantes', async () => {
    await assert.rejects(fetchPaginatedVectorService({
      type: 'geojson', rawUrl: 'https://maps.example.org/data.geojson', timeoutMs: 5,
      fetcher: (_url, options) => new Promise((resolve, reject) => {
        assert.ok(options.signal instanceof AbortSignal);
        options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      })
    }), error => error.code === 'SERVICE_TIMEOUT');
  });

  test('applique une limite agrégée d’octets et une limite de positions', async () => {
    const rawUrl = 'https://maps.example.org/data.geojson';
    await assert.rejects(fetchPaginatedVectorService({
      type: 'geojson', rawUrl, maxTotalBytes: 10,
      fetcher: async () => new Response(featureCollection(0), { status: 200 })
    }), error => error.code === 'REMOTE_TOTAL_TOO_LARGE');
    await assert.rejects(fetchPaginatedVectorService({
      type: 'geojson', rawUrl, maxPositions: 1,
      fetcher: async () => new Response(featureCollection(2), { status: 200 })
    }), error => error.code === 'TOO_MANY_COORDINATES');
  });

  test('refuse une page qui ignore le plafond serveur de 1 000 entités', async () => {
    await assert.rejects(fetchPaginatedVectorService({
      type: 'wfs', rawUrl: 'https://maps.example.org/wfs', typeName: 'ws:parks',
      fetcher: async () => new Response(featureCollection(REMOTE_PAGE_SIZE + 1), { status: 200 })
    }), error => error.code === 'REMOTE_PAGE_FEATURE_LIMIT');
  });
});
