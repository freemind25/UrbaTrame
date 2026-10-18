# Analyse fonctionnelle publique de GISCARTA et intégration dans UrbaTrame

**Relevé : 18 octobre 2026.** Cette note documente une analyse « boîte noire » des pages publiques et de la documentation publique de GISCARTA, suivie d’une comparaison avec les composants déjà présents dans UrbaTrame. Il ne s’agit ni d’une copie du code, ni d’un accès à une API privée, ni d’une reproduction de la marque ou des écrans de GISCARTA. Les éléments retenus sont des modèles généraux d’interaction cartographique, réimplémentés avec les modules et les règles de confidentialité d’UrbaTrame.

## Ce qui ressort des pages publiques

La page de la solution urbanisme présente un enchaînement de travail autour d’un projet de ville : réunir les couches, les organiser, les comparer, consulter des indicateurs par zone, noter les décisions et partager un résultat. La documentation précise notamment :

- une liste de couches avec recherche, visibilité, ordre, paramètres et regroupement;
- l’ajout de fichiers, d’un catalogue, de services externes ou d’une couche créée manuellement;
- le style, les propriétés, les étiquettes, les filtres et l’accès à la table attributaire;
- des widgets optionnels et des tableaux de bord par couche/attribut, avec graphiques, statistiques et effets de filtres;
- des cartes de base configurables et des fonctions de mesure;
- pour l’urbanisme, l’usage de couches de transport, d’équipements et d’espaces verts, avec notes de décision et indicateurs.

Les sources consultées sont la [page Urbanisme](https://giscarta.com/fr/solutions/gis-for-urban-planning), [Données](https://giscarta.com/fr/docs/map-data), [Calques](https://giscarta.com/fr/docs/map-layers), [Tableaux de bord](https://giscarta.com/fr/docs/dashboards), [Table attributaire](https://giscarta.com/fr/docs/attribute-table-widget), [Édition](https://giscarta.com/fr/docs/editing-widget), [Cartes de référence](https://giscarta.com/fr/docs/basemaps-widget) et [Modifier l’ordre des calques](https://giscarta.com/fr/docs/change-layer-order-widget). La [galerie](https://giscarta.com/fr/map-gallery) donne aussi des exemples publics de cartes de densité, d’accessibilité et d’inventaire urbain.

## Comparaison avec UrbaTrame

L’**Atelier cartographique existant** couvre déjà l’essentiel de l’éditeur de données : import local GeoJSON, CSV/TSV, Shapefile, GeoPackage et GeoTIFF; couches XYZ/WMTS/WMS et import vectoriel WFS/ArcGIS; visibilité, couleurs et style catégoriel, étiquettes, filtres, table attributaire, édition avec annulation/rétablissement, mesure, tampons et proximité déterministes, sauvegarde locale de projet et exports. Les services et l’IA restent des actions explicites; les fichiers locaux ne sont pas téléversés par défaut.

Le contrôle des sections existantes confirme qu’il n’y a pas de tableau de bord par attribut à reproduire : l’Atelier d’analyse urbaine sert au suivi des séances et livrables, tandis que les indicateurs de l’analyse principale portent sur ses propres données générées. Le nouveau widget décrit, lui, les couches importées dans l’Atelier cartographique.

Il était donc préférable de ne pas recréer un « Map Builder » séparé ni de dupliquer ces fonctions. Les apports immédiatement utiles et manquants ont été intégrés **dans la page existante `/atelier-cartographique.html`** :

1. **Ordre des couches** : commandes accessibles pour déplacer une couche au-dessus/en dessous. L’ordre est conservé dans la liste déjà sérialisée du projet local et détermine l’ordre de rendu, y compris lorsque rasters et vecteurs sont mélangés.
2. **Tableau de bord local** : indicateurs de la couche sélectionnée (entités après filtre, points, lignes, polygones, longueurs/contours et surface approximative), plus une répartition par valeur d’un attribut. Les calculs restent dans le navigateur et le filtre de couche s’applique au graphique.
3. **Transparence explicative** : le tableau de bord décrit uniquement les données chargées. Il ne prétend pas mesurer l’accessibilité à un parc, la conformité à un zonage ou une norme si ces paramètres et données n’ont pas été explicitement fournis.

Le tableau de bord raster se limite aux métadonnées descriptives déjà disponibles (dimensions, pixels valides, minimum et maximum); aucun traitement pixel-par-pixel n’est ajouté.

## Limites volontaires et suite possible

Les rôles d’organisation, l’hébergement partagé, le partage par lien, la publication de portails, la facturation et les fonctions « IA de données » d’un service SaaS ne sont pas importés. Ils nécessiteraient une décision de produit, une architecture serveur et une analyse de confidentialité distinctes. Les fonctions futures qui conviendraient à UrbaTrame seraient plutôt : une comparaison de scénarios locaux; une synthèse par polygone à partir de couches que l’étudiant choisit; et des séries temporelles uniquement si une vraie date est présente dans le fichier. Toute mesure d’accessibilité ou de densité devra utiliser des données et seuils fournis ou confirmés par l’utilisateur, sans créer de zonage réglementaire ni de frontière cadastrale.

Le lecteur de pages publiques a exposé la description et la documentation, mais pas le contenu dynamique des widgets du visualiseur public. Cette implémentation ne revendique donc pas une reproduction pixel par pixel de l’interface GISCARTA ni une rétro-ingénierie de son application privée.
