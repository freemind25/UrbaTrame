/* Offline tests for the public OpenBuildingMap vector-tile integration. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OBM_CATEGORIES,
  decodeMvt,
  getObmTilePlan,
  obmCategory,
  obmTileUrl,
  tilePointToLonLat
} from '../public/js/openbuildingmap.mjs';
import { fetchOpenBuildingMap } from '../server/sources/openbuildingmap.mjs';

function varint(value) {
  let n = BigInt(value);
  const out = [];
  while (n > 0x7fn) { out.push(Number((n & 0x7fn) | 0x80n)); n >>= 7n; }
  out.push(Number(n));
  return out;
}
function field(number, wire, data) {
  const head = varint((number << 3) | wire);
  if (wire === 2) return [...head, ...varint(data.length), ...data];
  return [...head, ...varint(data)];
}
function stringValue(value) { return field(1, 2, [...new TextEncoder().encode(value)]); }
function packed(values) { return values.flatMap(varint); }
function zigzag(value) { return value < 0 ? -value * 2 - 1 : value * 2; }
function polygonCommands(ring) {
  const out = [9, zigzag(ring[0][0]), zigzag(ring[0][1]), 8 * (ring.length - 1) + 2];
  let x = ring[0][0], y = ring[0][1];
  for (const point of ring.slice(1)) {
    out.push(zigzag(point[0] - x), zigzag(point[1] - y));
    [x, y] = point;
  }
  out.push(15);
  return packed(out);
}
function makeTile({ z, x, y }, site, features) {
  const extent = 4096, n = 2 ** z;
  const worldX = (site.lon + 180) / 360 * n;
  const latRad = site.lat * Math.PI / 180;
  const worldY = (1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2 * n;
  const centerX = (worldX - x) * extent;
  const centerY = (worldY - y) * extent;
  const keys = ['osm_id', 'occupancy'];
  const valueTable = [];
  const valueIndexes = new Map();
  const addValue = value => {
    const key = String(value);
    if (!valueIndexes.has(key)) {
      valueIndexes.set(key, valueTable.length);
      valueTable.push(field(1, 2, [...new TextEncoder().encode(key)]));
    }
    return valueIndexes.get(key);
  };
  const featureMessages = features.map((feature, index) => {
    const cx = Math.round(centerX + (feature.offsetX || 0));
    const cy = Math.round(centerY + (feature.offsetY || 0));
    const r = 18;
    const ring = [[cx - r, cy - r], [cx + r, cy - r], [cx + r, cy + r], [cx - r, cy + r]];
    const osmIndex = addValue(feature.id);
    const occupancyIndex = addValue(feature.occupancy);
    const tags = packed([0, osmIndex, 1, occupancyIndex]);
    return [
      ...field(1, 0, index + 1),
      ...field(2, 2, tags),
      ...field(3, 0, 3),
      ...field(4, 2, polygonCommands(ring))
    ];
  });
  const layer = [
    ...field(1, 2, [...new TextEncoder().encode('buildings_occupancy')]),
    ...featureMessages.flatMap(message => field(2, 2, message)),
    ...keys.flatMap(key => field(3, 2, [...new TextEncoder().encode(key)])),
    ...valueTable.flatMap(value => field(4, 2, value)),
    ...field(5, 0, extent),
    ...field(15, 0, 2)
  ];
  return new Uint8Array(field(3, 2, layer));
}

function siteAtTileCenter({ z, x, y }) {
  const n = 2 ** z;
  const lon = (x + .5) / n * 360 - 180;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + .5) / n))) * 180 / Math.PI;
  return { lat, lon, radius: 200 };
}

function mockResponse(bytes, ok = true, status = 200) {
  return {
    ok, status,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  };
}

describe('helpers OpenBuildingMap', () => {
  test('choisit une grille de tuiles bornée et réduit le zoom des grandes emprises', () => {
    const small = getObmTilePlan(36.2311, 6.7006, 600);
    const large = getObmTilePlan(36.2311, 6.7006, 3000);
    assert.equal(small.z, 14);
    assert.ok(small.tiles.length <= 16);
    assert.ok(large.tiles.length <= 16);
    assert.ok(large.z <= small.z);
    assert.match(obmTileUrl(small.tiles[0]), /\/occupancy\/14\//);
  });

  test('borne les coordonnées, l’antiméridien et les codes de taxonomie', () => {
    assert.throws(() => getObmTilePlan(91, 0, 600), /INVALID_LOCATION/);
    assert.throws(() => getObmTilePlan(0, 179.999, 3000), /SITE_CROSSES_DATELINE/);
    assert.equal(obmCategory('RES2A'), 'RES');
    assert.equal(obmCategory('EDU3'), 'CIV');
    assert.equal(obmCategory('UNK'), 'UNK');
    assert.equal(obmCategory('OC99'), 'UNK');
    assert.equal(obmCategory('OCO'), 'OTHER');
    assert.equal(OBM_CATEGORIES.length, 8);
  });

  test('décode les couches, propriétés et polygones MVT utiles', () => {
    const tile = getObmTilePlan(36.2311, 6.7006, 200).tiles[0];
    const bytes = makeTile(tile, siteAtTileCenter(tile), [{ id: 1234, occupancy: 'RES1' }]);
    const layer = decodeMvt(bytes).find(item => item.name === 'buildings_occupancy');
    assert.equal(layer.extent, 4096);
    assert.equal(layer.features.length, 1);
    assert.equal(layer.features[0].properties.osm_id, '1234');
    assert.equal(layer.features[0].properties.occupancy, 'RES1');
    assert.equal(layer.features[0].type, 3);
    assert.equal(layer.features[0].geometry[0].length, 4);
    assert.deepEqual(tilePointToLonLat(tile, [0, 0]).map(Number.isFinite), [true, true]);
    assert.deepEqual(decodeMvt(new Uint8Array()), []);
    assert.throws(() => decodeMvt(new Uint8Array([0x1a, 0x80])), /INVALID_MVT/);
  });
});

describe('lecture OBM sur tuiles simulées', () => {
  test('filtre par centroïde, dédoublonne osm_id et calcule uniquement la part classée', async () => {
    const lat = 36.2311, lon = 6.7006, radius = 600, shape = 'circle';
    const site = { lat, lon, radius };
    const tiles = getObmTilePlan(lat, lon, radius).tiles;
    const requests = [];
    const fetchImpl = async url => {
      const match = url.match(/\/(\d+)\/(\d+)\/(\d+)\.pbf$/);
      const tile = { z: +match[1], x: +match[2], y: +match[3] };
      requests.push(url);
      const bytes = makeTile(tile, site, [
        { id: 1001, occupancy: 'RES1' },
        { id: 1002, occupancy: 'UNK' },
        { id: 1003, occupancy: 'COM1', offsetX: 1700 }
      ]);
      return mockResponse(bytes);
    };
    const result = await fetchOpenBuildingMap(site, { fetchImpl, cache: false });
    assert.equal(requests.length, tiles.length);
    assert.equal(result.tilesLoaded, tiles.length);
    assert.equal(result.tilesFailed, 0);
    assert.equal(result.partial, false);
    assert.equal(result.featureCount, 2, 'le troisième centroïde est hors du cercle');
    assert.equal(result.knownOccupancyCount, 1);
    assert.equal(result.unknownOccupancyCount, 1);
    assert.equal(result.classifiedOccupancyPct, 50);
    assert.equal(result.occupancyCounts.RES, 1);
    assert.equal(result.occupancyCounts.UNK, 1);
    assert.equal(result.returnedFeatureCount, 2);
    assert.equal(result.features[0].rings[0].length, 4);
    assert.match(result.attribution, /OpenBuildingMap.*ODbL 1\.0/);
    assert.equal(result.license, 'ODbL 1.0');
  });

  test('accepte les tuiles HTTP 204 vides sans conclure à une complétude', async () => {
    const site = { lat: 36.2311, lon: 6.7006, radius: 600 };
    const result = await fetchOpenBuildingMap(site, {
      fetchImpl: async () => mockResponse(new Uint8Array(), true, 204), cache: false
    });
    assert.equal(result.tilesFailed, 0);
    assert.equal(result.partial, false);
    assert.equal(result.featureCount, 0);
    assert.equal(result.classifiedOccupancyPct, null);
  });

  test('renvoie un avertissement si certaines tuiles échouent et échoue si aucune ne répond', async () => {
    const site = { lat: 36.2311, lon: 6.7006, radius: 600 };
    const tiles = getObmTilePlan(site.lat, site.lon, site.radius).tiles;
    const partialFetcher = async url => {
      if (url === obmTileUrl(tiles[0])) return mockResponse(new Uint8Array(), false, 503);
      const match = url.match(/\/(\d+)\/(\d+)\/(\d+)\.pbf$/);
      const tile = { z: +match[1], x: +match[2], y: +match[3] };
      return mockResponse(makeTile(tile, site, [{ id: 2001, occupancy: 'COM1' }]));
    };
    const partial = await fetchOpenBuildingMap(site, { fetchImpl: partialFetcher, cache: false });
    assert.equal(partial.partial, true);
    assert.equal(partial.tilesFailed, 1);
    assert.ok(partial.tilesLoaded > 0);
    await assert.rejects(
      () => fetchOpenBuildingMap(site, { fetchImpl: async () => mockResponse(new Uint8Array(), false, 503), cache: false }),
      /OBM_SOURCE_UNAVAILABLE/
    );
  });
});
