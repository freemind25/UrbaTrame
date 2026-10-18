# Cadrage spatial — documentation technique

## Objectif et place dans UrbaTrame

Le Cadrage spatial est une section de l’interface UrbaTrame, accessible par `/cadrage-spatial.html`. Il fournit un flux de repérage à quatre niveaux :

1. wilaya / pays;
2. ville ou unité administrative / wilaya;
3. quartier / ville;
4. quartier / environnement proche.

Les deux premiers niveaux sont des cartes schématiques de situation. Ils ne définissent pas une emprise d’analyse et ne sont pas soumis au plafond de rayon de la requête cartographique locale. Les niveaux 3–4 utilisent un centre et un périmètre de travail contrôlé à 3 000 m maximum. Aucun niveau ne prétend délimiter juridiquement une parcelle, un quartier ou un zonage réglementaire.

## Architecture

- `public/cadrage-spatial.html` — formulaire, navigation et prévisualisation.
- `public/cadrage-spatial.css` — styles de l’interface et de l’impression.
- `public/js/spatial-framing.mjs` — contrôles d’interface, appels explicites, dessin SVG, imports, persistance locale et exports.
- `public/js/spatial-framing-core.mjs` — constantes, contrôles de géométrie, distances/surfaces, échelles, annotations et validation des projets.
- `api/atelier/cadrage-extract.js` — route Vercel dédiée à l’extraction du nouveau module.
- `server/atelier-api.mjs` et `server/atelier-data.mjs` — requêtes et validation serveur.
- `server/api.mjs` — route équivalente pour le serveur Node local.
- `docs/NOTICE-CADRAGE-SPATIAL.md` et `/cadrage-spatial-notice.html` — notice utilisateur.

Le rendu cartographique est SVG natif, sans bibliothèque CDN. Les coordonnées vectorielles de la carte détaillée sont projetées localement en approximation équirectangulaire WGS 84; les surfaces de polygones et dimensions sont donc des mesures indicatives, non un levé géodésique.

## Limite de périmètre

La constante client `MAX_STUDY_RADIUS_M` vaut 3 000 m. Pour une géométrie de polygone ou de rectangle, la distance est contrôlée pour chacun des sommets par rapport au centre défini dans le formulaire. Pour un cercle, la distance maximale inclut l’écart de son centre au centre de cadrage ainsi que son rayon.

La route `/api/atelier/cadrage-extract` valide à son tour le rayon transmis à l’extraction et le plafonne à `MAX_CADRAGE_RADIUS = 3000`. Les sélecteurs Overpass sont définis côté serveur; le navigateur ne peut pas fournir une requête libre. La route `/api/atelier/extract` utilisée par Altiplan garde `MAX_RADIUS = 3989`. Ces deux limites sont intentionnellement distinctes.

L’extraction historique a un rayon minimal de 200 m. Le dessin d’un périmètre peut être plus petit; dans ce cas la requête de données OSM utilise au minimum 200 m et reste dans l’emprise autorisée. Une requête Cadrage dépassant 3 000 m est refusée côté serveur. Une réponse trop volumineuse est refusée au-dessus de 12 000 éléments, 240 000 positions ou 12 Mo de sérialisation, pour préserver l’affichage navigateur.

## Sources et appels externes

Aucun géocodage, téléchargement GADM, appel Overpass ou chargement de relief n’est lancé au chargement du module.

| Action explicite de l’utilisateur | Route UrbaTrame | Destination / données transmises |
|---|---|---|
| Valider la recherche d’un lieu | `POST /api/atelier/geocode` | Texte saisi transmis par le serveur au service Nominatim/OpenStreetMap; les résultats sont une suggestion à confirmer. |
| Cliquer « Charger les limites GADM » | `GET /api/atelier/gadm` | Code pays, niveau et identifiant de parent transmis au service GADM. La prévisualisation est généralisée. Les couches locales et annotations ne sont pas transmises. |
| Cliquer « Charger les données OSM / relief » | `POST /api/atelier/cadrage-extract` | Latitude, longitude, rayon et identifiants de couches cochées. L’élévation n’est demandée que si la case Relief est cochée. Les fichiers locaux, périmètres dessinés et annotations ne figurent pas dans la requête. |
| Importer GeoJSON/GeoPackage | Aucun appel de données externe | Lecture dans le navigateur; GeoPackage lu avec SQL.js et ses ressources statiques locales. |

Les sources et dates disponibles sont rappelées dans les métadonnées/exports. Les couches absentes ou non disponibles ne sont pas simulées.

### Couches prises en charge

- **GADM 4.1** : pays, niveau administratif 1 et niveau 2 lorsque le pays les fournit. Les unités parentales chargées sont dessinées dans le cadrage détaillé lorsqu’elles croisent l’emprise visible. Les identifiants GADM et intitulés sont conservés avec le cadrage; la géométrie n’est pas sauvegardée.
- **OpenStreetMap / Overpass** : bâtiments, routes principales et locales, parcours piétons/vélos, équipements, transports publics, lieux/centralités, quartiers nommés si cartographiés, espaces verts, eau, rail et barrières.
- **Relief Terrarium** : grille d’altitude optionnelle, colorisée à titre de repérage. Elle n’est pas une carte de pente ni une analyse hydrologique.
- **Données locales** : GeoJSON et tables GeoPackage importés en EPSG:4326 par le lecteur existant. Un contour polygonal choisi par l’utilisateur peut être appliqué après le contrôle de 3 000 m.
- **Annotations** : points, lignes, flèches, zones et textes; catégories d’observation, accès, équipements, centralités, coupures, espaces verts ou autre. Les points/sommets de l’annotation choisie peuvent être déplacés et l’annotation supprimée.

La légende est générée à partir des couches visibles ayant des données chargées. Les parcours piétons restent des voies OSM taguées pour piétons/vélos, pas un calcul de cheminement ni une validation d’accessibilité.

## Modèle de données et sauvegarde

`public/js/spatial-framing-core.mjs` versionne les objets avec `CADRAGE_PROJECT_VERSION = 1` et le type de projet `urbatrame-spatial-framing-project`.

Chaque cadrage sauvegardé conserve :

- identifiant, nom, projet, dates de création/mise à jour et niveau;
- centre WGS 84, code pays, identifiants et noms administratifs sélectionnés;
- périmètre (cercle, rectangle ou polygone) et contrôle de distance;
- rayon visible, échelle numérique, format, orientation, titre et commentaire;
- visibilité des couches, annotations et attribution;
- si la taille reste au plus 1,3 Mo, une copie de la couche locale importée.

Les cadrages sont conservés dans `localStorage` sous la clé `urbatrame:spatial-framings:v1`, jusqu’à 40 enregistrements. Le fichier JSON exporté accepte également jusqu’à 40 cadrages et est limité à 15 Mo à l’import. Les géométries GADM/OSM et l’altitude téléchargées ne sont pas enregistrées par défaut : leur récupération ultérieure exige un nouveau clic. Les références de couches sont rétablies, mais un utilisateur doit vérifier la disponibilité et recharger toute couche externe voulue. Aucun compte, synchronisation ou téléversement de projet n’est utilisé.

Pour un niveau 3 ou 4, l’absence d’un périmètre valide ou une distance supérieure à 3 000 m bloque l’enregistrement. Les niveaux 1–2 peuvent conserver une carte de repérage sans périmètre d’analyse.

## Mise en page et export

- Format A4, A3 ou A2, portrait ou paysage.
- Titre et commentaires éditables; légende, nord, date, sources, centre, CRS et avertissement d’usage sont ajoutés au plan.
- Le repère graphique et l’échelle numérique sont affichés dans les vues détaillées. Les vues administratives schématiques sont explicitement marquées « non à l’échelle » pour éviter une précision fictive.
- Export SVG natif et éditable, conversion PNG/JPEG locale dans le navigateur, et impression du plan via le dialogue d’impression (choisir « Enregistrer au format PDF » pour créer un PDF).
- Les exports bitmap visent 150 dpi. L’impression/PDF dépend aussi de la taille de papier et du réglage « taille réelle » ou « ajuster » du lecteur.

Attribution figurant dans les plans : © OpenStreetMap contributors · ODbL lorsque la couche OSM est utilisée; GADM 4.1 lorsque les limites GADM sont utilisées; attribution du fichier local si applicable. Les données OSM dérivées doivent respecter l’ODbL et les conditions d’attribution applicables.

## Limites et erreurs présentées

- Adresse non trouvée, réponse de géocodage illisible ou service indisponible.
- Limite GADM indisponible pour le niveau, parent ou pays demandé.
- Périmètre absent, incomplet ou trop grand; refus du serveur si l’emprise d’extraction dépasse 3 000 m.
- Données OSM trop nombreuses, source Overpass indisponible ou relief manquant.
- Rayon de données chargé plus petit que le rayon visible; le module avertit l’utilisateur que la carte peut être incomplète.
- Contour local non polygonal, fichier trop volumineux, CRS/format invalide ou stockage du navigateur saturé.
- Export raster ou impression non pris en charge par le navigateur.

Pour l’extraction vectorielle, la requête Overpass dédiée utilise un filtre circulaire `around` centré sur le point choisi plutôt qu’une boîte carrée dont les coins dépasseraient le rayon. La prévisualisation détaillée est également découpée à un cercle visible correspondant au rayon sélectionné; le contour d’étude lui-même reste contrôlé séparément par ses sommets.

Les limites GADM sont des représentations administratives issues d’une source extérieure; les limites OSM reflètent les objets cartographiés. Aucune n’est une preuve cadastrale, juridique ou réglementaire. Le « quartier » peut être une limite nommée OSM lorsqu’elle existe ou une hypothèse de travail explicitement dessinée/importée par l’utilisateur.

## Tests

Les tests unitaires de géométrie/échelle/format projet se trouvent dans `test/spatial-framing.test.mjs`; les contrôles API de plafond et d’isolation par rapport à Altiplan se trouvent dans `test/cadrage-spatial-api.test.mjs`. Les tests automatisés s’exécutent avec `npm test`, la vérification de syntaxe avec `npm run lint`. Les tests emploient des sources simulées et ne déclenchent pas de requête GADM/OSM réelle.
