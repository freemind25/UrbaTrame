/* Pack local de quatre planches SVG : pas de données brutes ni d'envoi réseau. */
import { vectorMapSVG } from './vector-map.mjs';
import { createStoredZip } from './zip-writer.mjs';

export const PACK_MAPS = Object.freeze([
  { theme: 'type', file: '01-type-et-style.svg' },
  { theme: 'height', file: '02-hauteur.svg' },
  { theme: 'floors', file: '03-niveaux.svg' },
  { theme: 'area', file: '04-emprise.svg' }
]);

export function buildSiteMapPack(ctx, options = {}, { generatedAt = new Date().toISOString(), maxBytes = 30 * 1024 * 1024 } = {}) {
  if (!options.layers?.buildings || !(ctx.D?.build?.length > 0)) {
    const error = new Error('PACK_BUILDINGS_REQUIRED'); error.code = 'PACK_BUILDINGS_REQUIRED'; throw error;
  }
  const results = PACK_MAPS.map(({ theme, file }) => ({
    theme, file, result: vectorMapSVG(ctx, { ...options, buildingTheme: theme })
  }));
  if (results.some(item => !item.result.fitsPage)) {
    const error = new Error('PACK_SCALE_OVERFLOW'); error.code = 'PACK_SCALE_OVERFLOW'; throw error;
  }
  const metadata = {
    format: 'UrbaTrame Site Maps 1', generatedAt,
    site: { name: String(ctx.siteName || ''), latitude: ctx.sLat, longitude: ctx.sLng, radiusM: ctx.curR, shape: ctx.shape,
      hasUserBoundary: Array.isArray(ctx.boundary) && ctx.boundary.length >= 3 },
    notes: [
      'Date de génération, pas date des données. L’archive contient les coordonnées du site.',
      'Données OpenStreetMap contributors (ODbL), relief Terrarium si affiché ; couverture variable.',
      'Hauteur : height OSM ou niveau entier × 3,1 m estimé ; niveaux inconnus non inférés.',
      'Emprises approximatives calculées sur le polygone entier, hors cours connues ; pas surface de plancher.',
      'Les valeurs et longueurs comptent les données chargées avant découpe, pas uniquement la surface visible.',
      'SVG de présentation, pas export SIG géoréférencé ; échelle à vérifier à l’impression.'
    ],
    settings: { preset: options.preset, printScale: options.printScale, layers: options.layers,
      roadGroups: options.roadGroups, colorByType: options.colorByType, classColors: options.classColors,
      colors: options.colors, sunAzimuth: options.sunAzimuth, sunHeight: options.sunHeight,
      shadowStrength: options.shadowStrength, hillshadeStrength: options.hillshadeStrength,
      depthMapStrength: options.depthMapStrength, outlineWeight: options.outlineWeight,
      grid: options.grid, gridInterval: options.gridInterval, sunPath: options.sunPath,
      sunDate: options.sunDate, sunHour: options.sunHour },
    maps: results.map(({ theme, file, result }) => ({ theme, file, scale: result.scale, fitsPage: result.fitsPage, stats: result.stats }))
  };
  const readme = `UrbaTrame — pack de cartes du bâti\n\nQuatre planches SVG : type/style, hauteur, niveaux et emprise.\nLes SVG sont des images vectorielles de présentation, pas des données SIG géoréférencées.\nLa légende et les conditions de lecture figurent sur chaque carte.\nLes emprises sont approximatives ; les valeurs manquantes sont en gris.\nHauteur si absente : estimation par niveaux × 3,1 m quand ces niveaux sont connus.\n\n© OpenStreetMap contributors (ODbL). Relief Terrarium si utilisé.\nConservez les attributions et vérifiez la licence des données avant diffusion.\nVoir metadata.json : date de génération, site, filtres et décomptes.\nAttention : ce fichier contient les coordonnées du site.\nLa date de génération ne garantit pas la date des données.\n`;
  const entries = results.map(({ file, result }) => ({ name: file, data: result.svg }));
  entries.push({ name: 'metadata.json', data: JSON.stringify(metadata, null, 2) + '\n' }, { name: 'LISEZMOI.txt', data: readme });
  return { bytes: createStoredZip(entries, { maxBytes }), metadata };
}
