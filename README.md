# UrbaTrame — lecture et analyse urbaine

![Bannière UrbaTrame — cartographie, topographie et modèles 3D](docs/img/urbatrame-banner.png)

**UrbaTrame** aide à lire et analyser un site urbain à partir de données cartographiques et territoriales. L’application rassemble des planches d’analyse, une visualisation 3D interactive et un atelier intégré pour explorer un lieu, consulter l’atlas administratif GADM et produire des livrables exploitables.

[![Licence MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)

## Fonctionnalités

### Analyser le tissu urbain

- **46 analyses cartographiques** : voirie, occupation du sol, tissu urbain, densité, volumes bâtis, orientations, points d’intérêt, mobilité, bruit, ensoleillement, relief, climat et rose des vents NASA POWER/MERRA-2 à 10 m.
- **Occupation des bâtiments OpenBuildingMap** : empreintes coloriées par classe d’usage, parts classées/inconnues et synthèse des catégories, dans une couche facultative distincte des données OSM.
- **8 planches composées Max au format A3 paysage** : carte de contexte, pôles urbains, grille de densité, axonométrie annotée, encarts d’insertion, cônes de vue indicatifs, zonage fonctionnel OSM non réglementaire et analyse radiale.
- **Synthèse quantitative du site** : emprises bâties, espaces verts, linéaires de voirie, équipements, transports, relief et climat disponibles.
- **Scénario de capacité indicatif** : l’utilisateur saisit la surface du terrain, le FAR/COS, l’emprise et le nombre de niveaux; le coût n’est calculé que si un coût unitaire est fourni. Ces hypothèses ne valent pas autorisation réglementaire.
- **Choisir un site** par recherche de lieu ou coordonnées, puis définir un rayon de 200 à 3 000 m et une emprise circulaire ou polygonale.
- **Comparer la course solaire et les ombres** selon la date et l’heure choisies, dans les simulations 2D et 3D. La rose des vents est une statistique régionale à 10 m; elle ne simule pas le vent local entre les bâtiments.
- **Consulter les résultats** sous forme de planches lisibles et les exporter individuellement ou en planche A3.

### Importer des couches locales

L’**atelier cartographique** importe des couches GeoJSON, CSV/TSV, Shapefile local (`.shp/.dbf/.prj`, fichiers associés ou ZIP standard) et GeoPackage (`.gpkg`). Le GeoPackage peut fournir jusqu’à 12 tables d’entités; attributs et géométries WKB ordinaires (Point, MultiPoint, lignes, polygones et collections) sont convertis vers WGS 84. Les courbes et extensions géométriques ne sont pas prises en charge. GeoTIFF (`.tif/.tiff`) est accepté en 1 bande ou RGB/RGBA s’il est géoréférencé, nord en haut, avec CRS EPSG dans ses propres métadonnées. Le raster est affiché avec transparence NoData et une palette pour les valeurs à une bande; la table indique dimensions, résolution, CRS, minimum/maximum et emprise. Il s’agit d’un aperçu affine de l’emprise transformée, sans rééchantillonnage pixel par pixel; les valeurs raster ne sont pas analysées ni modifiées. Pour GeoJSON, CSV, Shapefile, GeoPackage et GeoTIFF, les CRS convertibles sont EPSG:4326, EPSG:3857 et UTM WGS 84 (EPSG:326xx/327xx); le CRS source est conservé. Le Shapefile exige une confirmation du CRS; si aucun `.prj` exploitable n’est fourni, l’utilisateur doit saisir un EPSG pris en charge. Les couches vectorielles peuvent être superposées, masquées, réordonnées par flèches accessibles, recolorées, filtrées par attribut, stylées par catégorie, étiquetées et consultées dans une table; un raster se règle par opacité et son aperçu figure dans les plans SVG/PNG. Un tableau de bord local présente les effectifs par géométrie, les longueurs/contours, les surfaces approximatives et une répartition par attribut, en suivant le filtre de la couche choisie; il n’invente pas de seuil d’accessibilité ou de zonage et n’envoie aucune donnée. L’édition locale permet d’ajouter des points, lignes et polygones, d’insérer/déplacer/supprimer des sommets, de supprimer des entités et de gérer les attributs JSON; annulation/rétablissement est limité aux 50 dernières actions et à 4 Mo par couche, et l’historique n’est pas inclus dans le projet sauvegardé. Les données vectorielles modifiées, elles, sont exportables. Mesures indicatives, sélection des points dans un polygone ou à proximité d’une autre couche de points (distance de grand cercle approximée sur une sphère, jusqu’à 100 km), tampons sphériques indicatifs de points et de lignes (rayon 1 à 5 000 m; segments de ligne ≤100 km, pièces non dissoutes et recouvrements possibles), recettes JSON à opérations autorisées et export SVG/PNG/impression sont disponibles. Un projet local `.urbatrame.json` conserve couches, styles, filtres, provenance et données GeoTIFF originales; il ne restaure pas les fonds externes. L’export GeoJSON concerne les couches vectorielles uniquement. Les services XYZ/WMS/WMTS (matrices Web Mercator standard), WFS 2.0, ArcGIS FeatureServer/MapServer interrogeables et GeoJSON distant sont facultatifs et inactifs par défaut; chaque requête part uniquement après clic et envoie l’URL/l’emprise au fournisseur, jamais les couches locales. WFS/ArcGIS sont paginés à 1 000 entités/page, au plus 5 000 entités, 10 pages et 30 Mo cumulés, avec un délai de 30 secondes par page et un arrêt si le service répète une page; un GeoJSON distant est limité à une réponse de 15 Mo. Le catalogue OpenRouter peut être consulté par action distincte pour vérifier le prix du modèle. L’IA reste désactivée par défaut; le service choisi ne reçoit que les couches sélectionnées (20 premières entités chacune) et la consigne après consentement. La clé personnelle n’est ni enregistrée ni ajoutée au projet. Limites : 15 Mo par fichier (lot Shapefile 30 Mo), 20 000 entités et 100 000 positions par couche; GeoTIFF 1 million de pixels/fichier, 4 millions au total et 15 Mo cumulés; projet 30 Mo, 12 couches, 60 000 entités et 300 000 positions au total; aperçu vectoriel 8 000 entités/20 000 symboles. UrbaTrame ne crée ni limite cadastrale/juridique ni zonage réglementaire.

### Explorer la ville en 3D

La vue 3D interactive permet de faire pivoter et d’incliner la scène, de zoomer, de choisir la date et l’heure solaires et d’examiner les bâtiments sur le relief. Les ombres, les fiches de bâtiments et l’export d’images sont accessibles depuis la vue.

Le rapport de site propose aussi un **générateur de volumes 3D conceptuels** : à partir de la capacité calculée selon les hypothèses saisies, l’utilisateur choisit le nombre de volumes, la hauteur d’étage, le rapport largeur/profondeur et l’écartement. La maquette en rangée peut être tournée à l’écran puis exportée en SVG, OBJ ou STL. Elle est schématique, non géoréférencée, ne représente aucune limite foncière et ne vérifie pas le zonage ni la réglementation.

### Utiliser l’atelier topographique Altiplan

**Altiplan est une section intégrée à UrbaTrame**, accessible depuis le bouton « Atelier topo » — ce n’est pas une application séparée. Elle permet de sélectionner un site sur la carte, de choisir les couches utiles, de prévisualiser les résultats et de préparer :

- un **plan topographique** avec courbes de niveau et couches cartographiques sélectionnées ;
- une **coupe de terrain** entre deux points ;
- une **maquette 3D** du terrain et des éléments cartographiés;
- des **repères et notes personnels** placés sur la carte, conservés dans le navigateur et exportables en GeoJSON.

L’atelier est accessible sans compte ni quota. Les notes restent locales à ce navigateur; elles ne sont ni synchronisées ni envoyées au serveur. Un exemple d’El Khroub est intégré pour découvrir l’interface sans attendre les services cartographiques externes.

L’**atlas administratif GADM**, ajouté dans l’Atelier Altiplan, permet de parcourir les pays et leurs subdivisions, de sélectionner les limites et leurs métadonnées, de consulter les aperçus thématiques GADM (altitude, température, précipitations et éclairage nocturne), puis de télécharger les données par pays ou pour le monde. Les téléchargements proposent les versions 4.1, 4.0.4 et 3.6 selon les formats officiels disponibles.

### Cadrer un site · du territoire au quartier

Le **Cadrage spatial**, accessible depuis la navigation principale, organise le repérage en quatre niveaux : wilaya dans le pays, ville dans la wilaya, quartier dans la ville, puis quartier et environnement proche. Les cartes de niveaux 1–2 sont schématiques et séparées des emprises d’analyse détaillée. Aux niveaux 3–4, le centre, le cercle, le rectangle, le polygone et chaque sommet sont contrôlés par rapport à une limite maximale de **3 000 m**; le serveur applique son propre plafond, indépendant de la limite d’Altiplan. Le module propose les limites administratives GADM, la recherche de lieux, des couches OSM disponibles (routes, chemins, équipements, centralités, espaces verts, eau, rail, quartiers cartographiés et barrières), le relief optionnel, l’import local GeoJSON/GeoPackage, les annotations, la légende automatique, le nord, l’échelle, les coordonnées et les mises en page A4/A3/A2. Les cadrages et leurs annotations se sauvegardent dans le navigateur et peuvent être exportés en projet JSON, SVG, PNG, JPEG ou imprimés en PDF. Une recherche, une requête GADM ou un chargement OSM/relief ne part qu’après une action explicite; les contours locaux ne sont pas téléversés. Les données OSM/GADM doivent être vérifiées et ne valent jamais limites cadastrales, juridiques ou réglementaires. Voir la [notice courte](docs/NOTICE-CADRAGE-SPATIAL.md) et la [documentation technique](docs/CADRAGE-SPATIAL.md).

### Comparer les cartes historiques · séance S5

Le comparateur S5 de l’atelier d’analyse accepte deux cartes raster (PNG, JPEG ou WebP), conserve leurs métadonnées de période, échelle, source et droits, puis les aligne à partir d’au moins trois points communs dont les coordonnées WGS84 et les positions sur chaque image sont saisies par l’étudiant. La transformation affine est calculée en EPSG:3857; son RMSE et les résidus par point (mètres planimétriques dans cette projection) sont visibles et exportés pour vérification. La superposition se consulte par transparence ou balayage, avec des observations manuelles et un texte de synthèse relu par le groupe; seul le texte confirmé est inclus au plan PNG sourcé et daté. Les points, résidus, métadonnées et annotations peuvent aussi être exportés en JSON (sans les images).

L’analyse reste locale par défaut. L’aide IA est facultative et nécessite le choix d’un fournisseur, la clé API personnelle de l’étudiant et un consentement explicite. La clé n’est pas enregistrée; le chargement d’un catalogue transmet une requête authentifiée sans carte, tandis qu’une analyse envoie les deux images réduites et les métadonnées de période, d’échelle et de source directement au fournisseur choisi. Les modèles gratuits, leurs quotas et leur capacité image peuvent changer; les coûts éventuels, la rétention et l’usage pour l’entraînement dépendent du fournisseur et du modèle. OpenAlex est une API de données scientifiques, pas un fournisseur d’inférence. Les suggestions IA doivent être validées pour figurer parmi les observations retenues; elles ne créent jamais de parcelles, de limites cadastrales ou de zonage juridique.

### Exporter et partager

| Contenu | Formats disponibles |
|---|---|
| Analyses cartographiques | SVG, PNG, planche A3 |
| Plan topographique | DXF, SVG, PNG |
| Coupe de terrain | DXF, SVG, PNG |
| Maquette 3D du terrain et des éléments cartographiés | OBJ, STL, aperçu PNG |
| Volumes 3D conceptuels | SVG, OBJ, STL |

Les exports topographiques peuvent être exprimés en mètres locaux ou géoréférencés en UTM WGS 84. Les analyses et les livrables peuvent être consultés dans les logiciels compatibles avec ces formats, notamment les outils de DAO/CAO.

### Adapter l’affichage

L’interface est disponible en français et en anglais. Elle propose un thème clair ou sombre, plusieurs palettes de couleur et des aperçus avant téléchargement.

## Exemples

Les exemples ci-dessous montrent des planches d’analyse et des livrables de l’atelier topographique pour El Khroub, Constantine.

![Exemple de planches d’analyse urbaine](docs/img/planche-1.png)
![Autres exemples de planches d’analyse](docs/img/planche-2.png)
![Exemples complémentaires de rendus](docs/img/planche-3.png)

![Plan topographique d’exemple pour El Khroub](docs/img/atelier-el-khroub-plan.png)
![Maquette 3D d’exemple pour El Khroub](docs/img/atelier-el-khroub-3d.png)

## Données et limites

UrbaTrame s’appuie sur des données cartographiques d’**OpenStreetMap**, des empreintes et classes d’occupation **OpenBuildingMap**, des limites administratives **GADM**, des données de relief **AWS Terrarium**, des séries climatiques **NASA POWER** et une rose des vents issue de **MERRA-2**. La rose décrit le flux régional à 10 m; elle ne modélise pas les effets locaux des bâtiments et des rues. OpenBuildingMap est une couche facultative distincte des objets OSM; le flux public d’occupation ne fournit pas ici les hauteurs, surfaces de plancher ou la provenance par bâtiment. Les données OBM sont sous ODbL 1.0 : l’usage non commercial n’exonère ni d’attribution ni des conditions de partage à l’identique applicables aux bases dérivées publiées. Les données GADM sont utilisées selon l’autorisation commerciale et de redistribution confirmée pour UrbaTrame. La disponibilité et le niveau de détail varient selon les lieux et les sources consultées.

Les parcelles ne sont affichées que si leurs limites sont présentes dans OpenStreetMap. UrbaTrame **ne crée ni ne complète de limites juridiques ou cadastrales** : les cartes et maquettes ne remplacent pas un relevé de géomètre. Toute publication utilisant des données OpenStreetMap doit conserver l’attribution **© OpenStreetMap contributors**.

## Accès

L’exemple intégré d’El Khroub permet de découvrir les analyses et les exports. Dans la configuration actuelle, les **46 analyses sont accessibles sans compte, code de licence ni quota**.

## Documentation

- [Rapport de présentation](docs/UrbaTrame_Rapport_de_presentation.docx) · [Notice d’utilisation](docs/UrbaTrame_Notice_d_utilisation.docx)
- [Atelier topographique Altiplan](docs/ALTIPLAN.md) · [Comparateur historique S5](docs/ATELIER-S5.md) · [Atlas administratif GADM](docs/GADM.md)
- [Cadrage spatial — notice](docs/NOTICE-CADRAGE-SPATIAL.md) · [Cadrage spatial — documentation technique](docs/CADRAGE-SPATIAL.md)
- [Exports topographiques et CAO](docs/EXPORTS.md)
- [Visualisation 3D](docs/VUE3D.md)
- [Données, sources et attribution](docs/DONNEES.md)
- [API](docs/API.md)
- [Déploiement](docs/DEPLOIEMENT.md) · [Vercel](docs/VERCEL.md)

## Licence

Le code de l’application est sous licence [MIT](LICENSE). Les données restent soumises aux licences et conditions de leurs producteurs. Les avis des composants de lecture GeoPackage/GeoTIFF sont dans [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
