import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { svgElementToPngBlob } from '../public/js/png-export.mjs';

describe('export PNG des cartes SVG', () => {
  test('rasterise le viewBox A3 à ×3, sur fond blanc, puis renvoie un Blob PNG', async () => {
    const state = { width: 0, height: 0, draw: null, fill: null, source: '' };
    const svg = {
      getAttribute: key => key === 'viewBox' ? '0 0 420 297' : null,
      xml: '<svg viewBox="0 0 420 297"><text>UrbaTrame été</text></svg>'
    };
    class SerializerStub {
      serializeToString(node) { return node.xml; }
    }
    class ImageStub {
      set src(value) {
        state.source = Buffer.from(value.split(',')[1], 'base64').toString('utf8');
        this.onload();
      }
    }
    const context = {
      fillStyle: '',
      fillRect(x, y, width, height) { state.fill = [this.fillStyle, x, y, width, height]; },
      drawImage(image, x, y, width, height) { state.draw = [image, x, y, width, height]; }
    };
    const documentStub = {
      createElement(tag) {
        assert.equal(tag, 'canvas');
        return {
          set width(value) { state.width = value; },
          set height(value) { state.height = value; },
          getContext(kind) { assert.equal(kind, '2d'); return context; },
          toBlob(callback, type) {
            assert.equal(type, 'image/png');
            callback(new Blob(['mock PNG bytes'], { type }));
          }
        };
      }
    };

    const blob = await svgElementToPngBlob(svg, {
      scale: 3, background: '#fff', ImageCtor: ImageStub,
      SerializerCtor: SerializerStub, documentRef: documentStub
    });

    assert.equal(state.width, 1260);
    assert.equal(state.height, 891);
    assert.deepEqual(state.fill, ['#fff', 0, 0, 1260, 891]);
    assert.deepEqual(state.draw.slice(1), [0, 0, 1260, 891]);
    assert.equal(state.source, svg.xml, 'le SVG Unicode survit à l’encodage data URI');
    assert.equal(blob.type, 'image/png');
    assert.equal(await blob.text(), 'mock PNG bytes');
  });

  test('signale un échec de chargement au lieu de télécharger une image vide', async () => {
    const svg = { getAttribute: () => '0 0 420 297', xml: '<svg/>' };
    class SerializerStub { serializeToString(node) { return node.xml; } }
    class FailedImage { set src(_value) { this.onerror(); } }
    await assert.rejects(svgElementToPngBlob(svg, {
      ImageCtor: FailedImage, SerializerCtor: SerializerStub,
      documentRef: { createElement() { throw new Error('ne doit pas être appelé'); } }
    }), /PNG_IMAGE_LOAD_FAILED/);
  });

  test('garde les dimensions de repli et rejette un canvas qui ne produit aucun Blob', async () => {
    const svg = { getAttribute: () => 'viewBox invalide', xml: '<svg/>' };
    class SerializerStub { serializeToString(node) { return node.xml; } }
    class ImageStub { set src(_value) { this.onload(); } }
    let dimensions;
    const documentStub = {
      createElement() {
        return {
          set width(value) { dimensions = [value, dimensions?.[1]]; },
          set height(value) { dimensions = [dimensions?.[0], value]; },
          getContext() { return { fillRect() {}, drawImage() {} }; },
          toBlob(callback) { callback(null); }
        };
      }
    };
    await assert.rejects(svgElementToPngBlob(svg, {
      scale: 2, ImageCtor: ImageStub, SerializerCtor: SerializerStub,
      documentRef: documentStub
    }), /PNG_BLOB_ABSENT/);
    assert.deepEqual(dimensions, [480, 536]);
  });
});
