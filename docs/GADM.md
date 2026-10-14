# Atlas administratif GADM dans UrbaTrame

L’atlas est une **composante de l’Atelier topographique Altiplan**, lui-même intégré à UrbaTrame. Il n’ouvre pas une application distincte.

## Parcours et consultation

- Choisir un pays et un niveau administratif, puis filtrer les unités par nom, identifiant ou type.
- Sélectionner une unité dans la liste ou sur la carte, consulter son `GID`, ses noms, types, codes et dates lorsqu’ils sont disponibles.
- Descendre vers le niveau administratif inférieur et remonter à l’unité parent.
- Consulter les aperçus nationaux GADM : limites, altitude, température moyenne annuelle, précipitations annuelles et éclairage nocturne, avec leurs variantes « masque ».
- Utiliser le zoom de l’aperçu vectoriel pour examiner les contours.

Les aperçus thématiques sont des images raster de visualisation servies par le site GADM à l’échelle nationale. Ils ne suivent pas nécessairement la version historique sélectionnée pour le téléchargement. Les limites interactives affichées par défaut utilisent les données GeoJSON GADM 4.1. Lorsque la taille d’une réponse l’exige, seule la géométrie de l’aperçu est généralisée ; les fichiers directs téléchargés conservent les géométries officielles.

## Téléchargements

Les liens ouvrent les fichiers hébergés par GADM / UC Davis, sans les reconditionner :

| Version | Par pays | Monde |
|---|---|---|
| 4.1 | GeoJSON par niveau, GeoJSON ZIP, KML, KMZ, GeoPackage du pays et Shapefile ZIP | GeoPackage, geodatabase ou couches par niveau |
| 4.0.4 (archive 4.0) | GeoJSON par niveau, GeoJSON ZIP, KMZ, GeoPackage du pays et Shapefile ZIP | GeoPackage, Shapefile ou couches par niveau |
| 3.6 | KMZ par niveau, GeoPackage ZIP du pays, Shapefile ZIP du pays | GeoPackage, Shapefile ou couches séparées |

Les GeoPackage et Shapefile par pays regroupent plusieurs niveaux. Les archives mondiales sont volumineuses (de plusieurs centaines de mégaoctets à plusieurs gigaoctets) ; un téléchargement par pays est généralement plus pratique. Les anciens fichiers 3.6 ne proposent pas les mêmes formats que 4.1.

## Métadonnées et limites

L’atlas expose, selon le niveau et le pays, les champs GADM : `GID`, `NAME`, `VARNAME`, `NL_NAME`, `TYPE`, `ENGTYPE`, `CC`, `HASC`, `ISO`, `VALIDFR`, `VALIDTO` et `REMARKS`. Le [dictionnaire officiel des attributs](https://gadm.org/metadata.html) décrit leur sens et les règles d’identifiant.

Les frontières GADM décrivent des unités administratives et ne sont **pas** des limites cadastrales. Elles ne remplacent pas un plan foncier ni un document juridique. Le composant conserve la version et l’attribution GADM visibles et pointe vers la [licence officielle](https://gadm.org/license.html). L’autorisation confirmée pour UrbaTrame couvre l’usage commercial et la redistribution des données aux utilisateurs. GADM signale une condition particulière pour l’Autriche (CC BY-SA 2.0) ; les conditions nationales indiquées par le producteur restent à respecter.

## Sources officielles

- [Télécharger par pays — 4.1](https://gadm.org/download_country.html) · [télécharger le monde — 4.1](https://gadm.org/download_world.html)
- [Anciennes versions](https://gadm.org/old_versions.html) · [formats](https://gadm.org/formats.html) · [métadonnées](https://gadm.org/metadata.html)
- Aperçu vectoriel : `GET /api/atelier/gadm?country=DZA&level=1&version=4.1`
