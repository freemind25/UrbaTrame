# CARTO / UrbaTrame — comparaison fonctionnelle et premier lot

## Méthode

Référence CARTO : documentation et pages publiques [Builder](https://carto.com/builder/), [widgets](https://docs.carto.com/carto-user-manual/maps/widgets), [widget catégoriel](https://docs.carto.com/carto-user-manual/maps/widgets/category-widget), [Workflows](https://carto.com/workflows/) et [opérations spatiales](https://docs.carto.com/carto-user-manual/workflows/components/spatial-operations). Ce sont des fonctionnalités documentées par l'éditeur ; aucun compte CARTO ou parcours interactif n'a été testé. Il ne s'agit ni d'une copie du code ni d'une affirmation de parité.

Référence UrbaTrame : code de l'atelier cartographique et des modules d'analyse du dépôt, à partir de `main` commit bc226b3. Une capacité présente dans le code n'est pas une garantie de précision ou de couverture des données.

| Domaine | CARTO annoncé/documenté | UrbaTrame avant ce lot | Écart / priorité |
|---|---|---|---|
| Cartes, couches, styles | Builder et plusieurs couches | Carte SVG, couches, visibilité, filtres texte, styles et étiquettes | Pas de parité visuelle ou de performance revendiquée |
| Widgets | Catégories, indicateurs, histogrammes, séries, table, filtres croisés | KPI et graphique descriptif de la couche sélectionnée | Priorité 1 : catégorie → carte/table/KPI, local |
| Étendue des widgets | Global ou fenêtre de carte selon la source ; inter-sources sous conditions | Ensemble de la couche après filtre texte | Pas de filtre par viewport ni inter-couches dans ce lot |
| Workflows | Éditeur visuel, composants, planification et exécution cloud | Recettes JSON et analyses guidées locales | Priorité 2 : composition visuelle locale bornée ; pas de DAG CARTO à ce stade |
| Analyses | Buffer, distance, intersection, découpage et autres composants | Tampons indicatifs, proximité entre points, points dans un polygone, filtre numérique | Intersection/découpage géométriques non implémentés ; ne pas confondre avec sélection |
| Catalogue / cloud | Données et connexions cloud suivant les offres | Fichiers locaux, OSM et services externes facultatifs | Couverture/licences Algérie et coûts à vérifier ; aucun raccordement CARTO |
| IA / agents | Agents interagissant avec cartes et analyses | Assistants facultatifs séparés, sorties à valider | Pas d'agent autonome équivalent |
| Échelle | Calcul cloud et tuiles annoncés | Calcul navigateur borné ; aperçu à 8 000 entités / 20 000 symboles | Pas d'équivalence de performances |

## Lot 1 : filtre catégoriel interactif

Atelier cartographique → Tableau de bord de la couche : choisir une couche vectorielle et un attribut, puis activer une catégorie. La carte, la table et les indicateurs utilisent le filtre texte existant **ET** la catégorie choisie. Le graphique affiche la répartition après filtre texte mais avant son propre filtre pour garder le choix des autres catégories. Un second clic ou le bouton d'effacement supprime la sélection. La sélection concerne uniquement la couche choisie et reste temporaire, non sauvegardée dans le projet.

Les types des valeurs **après import** sont distingués : certains lecteurs peuvent convertir des types à l’import ; vérifier la table et la source. 1 numérique n'est pas « 1 » texte ; absence et null sont regroupés, texte vide distinct ; les valeurs complexes sont comptées mais non filtrables. Les huit premières catégories sont proposées ; les autres sont regroupées, sans bouton. Les calculs portent sur les entités chargées, pas uniquement le cadrage visible. Le nombre d'entités calculé peut dépasser le nombre dessiné lorsque l'aperçu est plafonné.

**Exports :** les exports de données (GeoJSON, CSV, KML/KMZ, GeoPackage, projet) et les analyses guidées continuent d'utiliser les couches entières selon leurs règles existantes, pas la sélection du graphique. Les exports visuels de carte reflètent l'affichage. La source n'est pas modifiée. Ces statistiques sont descriptives, non réglementaires et conditionnées par la qualité des données.

## Suites envisagées

1. Histogramme numérique et filtrage par intervalle, avec distinction des valeurs manquantes.
2. Filtres croisés multi-couches explicites et export filtré séparé, après définition des règles de correspondance et de provenance.
3. Compositeur de recettes visuel : étapes autorisées, aperçu, validations, limites de calcul, sauvegarde et réexécution ; sans code arbitraire.
4. Intersection et découpage seulement après choix d'un moteur géométrique robuste, tests de topologie, systèmes de coordonnées et licences.
