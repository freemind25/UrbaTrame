import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as GeoTIFF from 'geotiff';
import {
  MAX_RASTER_BYTES, MAX_RASTER_PIXELS, MAX_TOTAL_RASTER_PIXELS,
  parseGeoTiff
} from '../public/js/atelier/geotiff-raster.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = new Uint8Array(fs.readFileSync(path.join(ROOT, 'test/fixtures/geodata/mnt_test.tif')));

function fakeApi(image) {
  return { fromArrayBuffer: async () => ({ getImage: async () => image }) };
}
function fakeImage(overrides = {}) {
  return {
    getWidth: () => 1, getHeight: () => 1, getSamplesPerPixel: () => 1,
    getGeoKeys: () => ({ ProjectedCSTypeGeoKey: 32631 }),
    getFileDirectory: () => ({ Orientation: 1 }),
    getBoundingBox: () => [500000, 4060000, 500010, 4060010],
    getResolution: () => [10, -10, 0], getOrigin: () => [500000, 4060010, 0],
    getGDALNoData: () => null, readRasters: async () => new Float32Array([7]),
    ...overrides
  };
}

describe('UrbaTrame · import et aperçu GeoTIFF', () => {
  test('lit le MNT synthétique tuilé, Float32, Deflate, EPSG:32631 et NoData', async () => {
    const raster = await parseGeoTiff(fixture, GeoTIFF, { fileName: 'mnt_test.tif' });
    assert.equal(raster.format, 'GeoTIFF');
    assert.equal(raster.width, 256); assert.equal(raster.height, 256);
    assert.equal(raster.samplesPerPixel, 1);
    assert.equal(raster.dataType, 'Float32Array');
    assert.equal(raster.sourceCrs, 'EPSG:32631');
    assert.equal(raster.crs, 'EPSG:4326');
    assert.equal(raster.noData, -9999);
    assert.equal(raster.validPixels, 65392);
    assert.ok(Math.abs(raster.bands[0].min - 104.599) < 0.001);
    assert.ok(Math.abs(raster.bands[0].max - 193.9109) < 0.001);
    assert.deepEqual(raster.pixelSize, [10, 10]);
    assert.deepEqual(raster.sourceBounds, [500000, 4058440, 502560, 4061000]);
    assert.ok(Math.abs(raster.boundsWgs84.west - 3) < 1e-8);
    assert.ok(raster.boundsWgs84.north > raster.boundsWgs84.south);
    assert.ok(raster.cornersWgs84.every(point => point.length === 2 && point.every(Number.isFinite)));
  });

  test('refuse les rasters trop volumineux, trop détaillés ou illisibles', async () => {
    assert.equal(MAX_RASTER_BYTES, 15 * 1024 * 1024);
    assert.equal(MAX_RASTER_PIXELS, 1_000_000);
    assert.equal(MAX_TOTAL_RASTER_PIXELS, 4_000_000);
    await assert.rejects(() => parseGeoTiff(new Uint8Array(MAX_RASTER_BYTES + 1), GeoTIFF), error => error.code === 'FILE_TOO_LARGE');
    await assert.rejects(() => parseGeoTiff(new Uint8Array([1, 2, 3]), GeoTIFF), error => error.code === 'RASTER_INVALID');
    const large = fakeImage({ getWidth: () => MAX_RASTER_PIXELS + 1 });
    await assert.rejects(() => parseGeoTiff(new Uint8Array([0]), fakeApi(large)), error => error.code === 'RASTER_TOO_MANY_PIXELS');
  });

  test('exige un CRS pris en charge, un raster nord en haut et 1 ou 3/4 bandes', async () => {
    await assert.rejects(() => parseGeoTiff(new Uint8Array([0]), fakeApi(fakeImage({ getSamplesPerPixel: () => 2 }))), error => error.code === 'RASTER_BANDS_UNSUPPORTED');
    await assert.rejects(() => parseGeoTiff(new Uint8Array([0]), fakeApi(fakeImage({ getGeoKeys: () => ({ ProjectedCSTypeGeoKey: 26910 }) }))), error => error.code === 'RASTER_CRS_UNSUPPORTED');
    await assert.rejects(() => parseGeoTiff(new Uint8Array([0]), fakeApi(fakeImage({ getGeoKeys: () => ({}) }))), error => error.code === 'RASTER_CRS_REQUIRED');
    await assert.rejects(() => parseGeoTiff(new Uint8Array([0]), fakeApi(fakeImage({ getFileDirectory: () => ({ ModelTransformation: [1, 0.2, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }) }))), error => error.code === 'RASTER_ROTATED_UNSUPPORTED');
  });
});
