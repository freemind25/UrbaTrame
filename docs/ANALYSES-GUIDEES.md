# Analyses spatiales guidées

Premier lot inspiré des descriptions publiques d'Aino : https://ainoworld.gitbook.io/aino-docs/advanced-analysis/find-whats-within-a-distance et https://ainoworld.gitbook.io/aino-docs/advanced-analysis/filter-and-select-features. Il s'agit d'une implémentation indépendante, sans code Aino, compte, connecteur, service externe, IA ou crédit. Les descriptions documentées n'ont pas été vérifiées par un test d'Aino connecté.

Dans Atelier cartographique → Analyses guidées, importer des couches vectorielles puis choisir une opération :

- tampons ponctuels (1 à 5 000 m, disques approchés à 32 segments) ;
- tampons de lignes (1 à 5 000 m, capsules par segment) ;
- sélection de Point/MultiPoint proches de Point/MultiPoint (0 à 100 km à vol d'oiseau) ;
- sélection de Point/MultiPoint dans une entité Polygon/MultiPolygon ou collection contenant un polygone (trous exclus ; au plus les 2 000 premières entités surfaciques proposées dans le menu) ;
- comparaison numérique (>, ≥, <, ≤, =) d'un attribut, en excluant valeurs absentes et non numériques ; les chaînes numériques doivent utiliser le point décimal.

Chaque résultat non vide est ajouté comme nouvelle couche, sans modifier les sources. Les données de toutes les entités sont utilisées, indépendamment des filtres d'affichage ou de la visibilité ; sauvegarder le projet pour conserver les couches. La provenance, les paramètres et la date sont dans les métadonnées `urbatrameDerivation` du GeoJSON de la couche, et les sources sont mentionnées dans sa description. L'export global des couches visibles reprend les métadonnées de dérivation dans les informations de source ; les autres formats n'en préservent pas nécessairement l'ensemble.

Distances et tampons reposent sur une approximation sphérique, non sur des itinéraires ; les tampons ne sont pas dissous, et les capsules de ligne peuvent se chevaucher : ne pas additionner leurs surfaces. Les multipoints sont sélectionnés entiers si au moins un point correspond. Une sélection dans un polygone n'est ni un découpage ni une intersection de surfaces ; la frontière des trous est exclue par le moteur existant. La précision dépend des données importées ; rien n'est cadastral, réglementaire ou un relevé fiable. Le chargement OSM, les services de géocodage et l'IA existants ont leurs propres conditions, distinctes de ces calculs locaux.

Les mêmes limites que les recettes s'appliquent, notamment 2 000 points ou segments pour les tampons, 100 000 positions de sortie, et 5 millions de comparaisons spatiales maximum. Les limites générales de l'atelier peuvent empêcher l'ajout. Le traitement synchrone peut être lent sur de gros jeux de données. Pas de tampon de polygones, d'intersection géométrique, de PostGIS, d'isochrone voiture/vélo ni de lecture en langage naturel dans ce lot.
