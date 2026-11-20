/* Recettes visuelles sans code : chaque étape lit une couche source, pas les sorties précédentes. */
export const VISUAL_OPERATIONS = {
  'measure': ['layer'], 'filter':['layer','field','match','value'], 'within-polygon':['layer','polygonLayer','polygonFeature'],
  'within-distance':['layer','referenceLayer','distanceMeters'], 'buffer-points':['layer','radiusMeters','segments'],
  'buffer-lines':['layer','radiusMeters','segments'], 'export-layer':['layer'], 'export-visible':[]
};
export function validateVisualRecipe(recipe, layers = null) {
  const fail = message => { throw new Error(message); };
  if (!recipe || recipe.version !== 1 || !Array.isArray(recipe.steps) || !recipe.steps.length || recipe.steps.length > 20 || Object.keys(recipe).some(k=>!['version','steps'].includes(k))) fail('Recette : 1 à 20 étapes, version 1 uniquement.');
  let artifacts=0;
  for (const [i,s] of recipe.steps.entries()) {
    const allowed=VISUAL_OPERATIONS[s?.op];
    if (!allowed || Object.keys(s).some(k=>k!=='op'&&!allowed.includes(k)) || allowed.some(k=>!Object.hasOwn(s,k))) fail(`Étape ${i+1} : opération ou paramètres non autorisés.`);
    for (const k of ['layer','polygonLayer','referenceLayer']) if (allowed.includes(k) && (typeof s[k]!=='string' || !s[k].trim() || s[k].length>100)) fail(`Étape ${i+1} : nom de couche invalide.`);
    if (s.op==='filter' && (typeof s.field!=='string' || !s.field.trim() || s.field.length>120 || ['__proto__','constructor','prototype'].includes(s.field.trim()) || !['equals','contains','not-equals'].includes(s.match) || typeof s.value!=='string' || s.value.length>500)) fail(`Étape ${i+1} : filtre invalide.`);
    if (s.op==='within-polygon' && (!Number.isInteger(s.polygonFeature) || s.polygonFeature<0)) fail(`Étape ${i+1} : indice polygonal invalide.`);
    if (s.op==='within-distance' && (!Number.isFinite(s.distanceMeters) || s.distanceMeters<0 || s.distanceMeters>100000)) fail(`Étape ${i+1} : distance hors de 0–100 000 m.`);
    if (['buffer-points','buffer-lines'].includes(s.op) && (!Number.isFinite(s.radiusMeters) || s.radiusMeters<1 || s.radiusMeters>5000 || !Number.isInteger(s.segments) || s.segments<12 || s.segments>64)) fail(`Étape ${i+1} : rayon 1–5 000 m et 12–64 segments requis.`);
    if (s.op!=='measure' && ++artifacts>10) fail('Limite de 10 fichiers résultants par recette.');
    if (layers) for (const key of ['layer','polygonLayer','referenceLayer']) if (allowed.includes(key)) {
      const matching=layers.filter(l=>l.kind!=='raster' && l.name===s[key]);
      if (matching.length!==1) fail(`Étape ${i+1} : couche « ${s[key]} » absente ou nom ambigu.`);
      if (key==='polygonLayer') {
        const geo=matching[0].geojson.features[s.polygonFeature]?.geometry;
        const polygon=g=>g && (['Polygon','MultiPolygon'].includes(g.type) || (g.type==='GeometryCollection' && g.geometries.some(polygon)));
        if (!polygon(geo)) fail(`Étape ${i+1} : entité polygonale inexistante à cet indice.`);
      }
    }
  }
  return { steps:recipe.steps.length, artifacts, note:'Validation préalable ; les limites géométriques et de calcul sont aussi vérifiées au lancement.' };
}
