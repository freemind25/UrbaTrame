import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseKmlText, layersToKml } from '../public/js/atelier/kml.mjs';
import { createStoredZip } from '../public/js/atelier/zip-writer.mjs';
import { extractKmlFromZip } from '../public/js/atelier/zip-reader.mjs';

const sampleKml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Terrain</name>
<NetworkLink><Link><href>https://example.invalid/never-fetch.kml</href></Link></NetworkLink>
<Placemark id="point-1"><name>Arbre &amp; banc</name><ExtendedData><Data name="type"><value>arbre</value></Data><Data name="score"><value>3</value></Data></ExtendedData><Point><coordinates>6.7,36.2,15</coordinates></Point></Placemark>
<Placemark id="line-1"><name>Chemin</name><LineString><coordinates>6.7,36.2 6.701,36.201</coordinates></LineString></Placemark>
<Placemark id="area-1"><name>Placette</name><Polygon><outerBoundaryIs><LinearRing><coordinates>6.7,36.2 6.701,36.2 6.701,36.201 6.7,36.2</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
</Document></kml>`;

describe('UrbaTrame · import/export KML/KMZ local', () => {
  test('lit point, ligne, polygone et données étendues sans suivre les NetworkLinks', () => {
    const parsed = parseKmlText(sampleKml, { fileName: 'terrain.kml' });
    assert.equal(parsed.features.length, 3);
    assert.deepEqual(parsed.features[0].geometry.coordinates, [6.7, 36.2, 15]);
    assert.equal(parsed.features[0].properties.name, 'Arbre & banc');
    assert.equal(parsed.features[0].properties.type, 'arbre');
    assert.equal(parsed.sourceCrs, 'EPSG:4326');
    assert.equal(parsed.kml.unsupportedLinksFetched, false);
  });

  test('refuse DTD/entités et coordonnées hors des plages géographiques', () => {
    assert.throws(() => parseKmlText('<!DOCTYPE kml [<!ENTITY x SYSTEM "file:///etc/passwd">]><kml/>'), error => error.code === 'KML_XML_UNSAFE');
    assert.throws(() => parseKmlText('<kml><Placemark><Point><coordinates>181,0</coordinates></Point></Placemark></kml>'), error => error.code === 'KML_COORDINATES_INVALID');
    assert.throws(() => parseKmlText('<kml><Placemark><Point><coordinates>1,2 &external;</coordinates></Point></Placemark></kml>'), error => error.code === 'KML_XML_INVALID');
  });

  test('exporte puis relit les couches et attributs en KML', () => {
    const parsed = parseKmlText(sampleKml);
    const kml = layersToKml([{ name: 'Campagne', source: 'Terrain local', visible: true, kind: 'vector', geojson: parsed }], {
      title: 'Relevé UrbaTrame', now: new Date('2026-10-21T10:00:00.000Z')
    });
    const roundTrip = parseKmlText(kml);
    assert.equal(roundTrip.features.length, 3);
    assert.deepEqual(roundTrip.features[0].geometry.coordinates, [6.7, 36.2, 15]);
    assert.equal(roundTrip.features[0].properties.type, 'arbre');
    assert.match(kml, /EPSG:4326 WGS 84/);
  });

  test('crée un KMZ doc.kml autonome et l’extrait sans extraction générale', async () => {
    const archive = createStoredZip([{ name: 'doc.kml', data: sampleKml }, { name: 'images/icon.png', data: new Uint8Array([1, 2, 3]) }]);
    const file = await extractKmlFromZip(archive);
    assert.equal(file.path, 'doc.kml');
    assert.equal(new TextDecoder().decode(new Uint8Array(file.buffer)), sampleKml);
    assert.equal(parseKmlText(new TextDecoder().decode(new Uint8Array(file.buffer))).features.length, 3);
    assert.throws(() => createStoredZip([{ name: '../doc.kml', data: sampleKml }]), error => error.code === 'ZIP_WRITE_NAME_INVALID');
  });
});
