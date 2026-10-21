# Fichiers de test – application de cartographie

Données **synthétiques** : aucune donnée réelle, aucune limite cadastrale. Les parcelles doivent rester issues d'OSM.

## CRS commun aux deux fichiers

- **EPSG:32631** (WGS 84 / UTM zone 31N), unités en mètres
- Emprise : X 500000 → 502560, Y 4058440 → 4061000

## 1. `mnt_test.tif` (raster d'altitude)

| Propriété | Valeur |
|---|---|
| Format | GeoTIFF, 1 bande, float32, compression deflate, tuilé 256×256 |
| Taille | 256 × 256 pixels, résolution 10 m |
| Origine | coin haut-gauche (500000, 4061000) |
| NoData | -9999 (bloc de 12 × 12 px en haut à gauche, pour tester le masque) |
| Valeurs | altitude en mètres, de 104,6 à 193,9 |
| Géoréférencement | intégré au TIFF (CRS + transform). `mnt_test.prj` fourni en complément (WKT ESRI) |

**Usage attendu** : afficher le raster d'altitude en fond (rampe de couleurs ou ombrage), lire l'altitude à un point cliqué, gérer correctement les pixels NoData (transparents).

## 2. `donnees_test.gpkg` (couches vectorielles)

| Couche | Géométrie | Entités | Attributs |
|---|---|---|---|
| `emprise` | Polygon | 1 | nom, surface_m2 |
| `zones_analyse` | Polygon | 3 | id, nom, type, surface_m2 |
| `axes` | LineString | 2 | id, nom, largeur_m, longueur_m |
| `reperes` | Point | 4 | id, nom, categorie, altitude_m |

Toutes les couches sont en EPSG:32631. La colonne géométrie de `reperes` s'appelle `geom` (les autres utilisent le nom par défaut), ce qui permet de tester les deux cas. Les valeurs `altitude_m` des repères sont échantillonnées sur le raster : elles servent de contrôle de cohérence raster/vecteur.

**Usage attendu** : lire plusieurs couches d'un même GeoPackage, les superposer au raster dans un même CRS, afficher les attributs au clic, et reprojeter vers EPSG:3857 / 4326 pour l'affichage web.

## Points de contrôle suggérés

- Le raster et les vecteurs se superposent sans décalage.
- Le point P2 (≈ 185,9 m) tombe sur le sommet de la colline.
- Le coin haut-gauche du raster est transparent (NoData).
