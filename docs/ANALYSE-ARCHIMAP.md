# Comparaison publique d’archiMap et intégration dans UrbaTrame

**Consultation : 21 octobre 2026** — pages publiques `https://archimap.masslabs-archi.com/` et `/map`.

L’analyse porte sur les descriptions et commandes visibles sans connexion. Elle ne vérifie ni les fonctions protégées par compte, ni l’exactitude des données ou des chiffres annoncés sur le site.

## Comparaison sans doublons

| Domaine aperçu sur archiMap | Déjà présent dans UrbaTrame | Décision |
|---|---|---|
| Couches cartographiques et analyses urbaines | Catalogue d’analyses, Atelier cartographique, import de couches locales, synthèse du site et planches d’analyse | Conserver les écrans et flux existants; ne pas refaire un catalogue ni un navigateur de couches parallèle. |
| Styles, couleurs et annotations | Palettes, titres de cartes personnalisés, bascule du texte et styles de couches locales | Intégré au mécanisme existant de projets/modèles : ces réglages sont maintenant enregistrés et partagés avec la configuration JSON. Pas de gestionnaire de styles séparé. |
| Ombres et course solaire | Date/heure solaires, course solaire et ombres 2D/3D déjà disponibles | Aucun doublon ajouté. La méthode d’ombre existante reste inchangée. |
| Rapports, proportions, diagrammes et exports | Synthèse quantitative, huit planches composées A3 Max, export SVG/PNG et impression/PDF; exports CAO déjà disponibles | Réutiliser les composants existants plutôt que créer un second générateur de rapports. Aucun clone séparé des modes « Explode/Stacking » n’a été ajouté. |
| Vue 3D | Volumes bâtis sur le relief, sélection de bâtiment, soleil, ombres et exports PNG/SVG | Ajout des quatre projections à la vue 3D existante; pas de seconde visionneuse. |
| Couches/datasets annoncés sur archiMap | Sources UrbaTrame documentées (OSM, OBM facultatif, relief Terrarium, NASA POWER/MERRA-2 et GADM dans les modules concernés) | Aucun jeu de données archiMap, aucune couverture « 195 pays / 100+ couches / 350+ jeux » et aucun accès distant supplémentaire n’ont été importés ou promis. |

Les fonctions publiquement décrites d’analyse thermique, de vues/visibilité ou de sky-view ne sont pas ajoutées à partir de simples libellés : une méthode, des données adaptées et des limites vérifiables seraient nécessaires. Les résultats ne doivent pas être extrapolés à partir du climat régional ou de bâtiments incomplets.

## Ajouts intégrés

### Quatre projections dans la vue 3D existante

Un sélecteur permet de passer entre :

- **Perspective libre** : projection perspective actuelle, ajustable par glisser, curseurs ou flèches;
- **Axonométrie** : projection orthographique isométrique;
- **Perspective à un point**;
- **Perspective à deux points**.

Les deux perspectives architecturales conservent les arêtes verticales parallèles, tandis que le plan horizontal conserve une perspective. Elles sont conçues pour la lecture architecturale, et non comme un calcul photogrammétrique ou une caméra de rendu physique. Le déplacement manuel de la caméra revient au mode perspective libre. Le rendu choisi sert aussi aux exports PNG et SVG.

Le moteur reste un rendu géométrique canvas/SVG sans WebGL. Les ombres portées existantes restent des projections au sol; aucun nouveau « shadow map » ou calcul d’occultation complet n’est revendiqué.

### Apparence incluse dans les projets et modèles existants

Les projets et modèles locaux conservent maintenant les palettes de cartes, les titres personnalisés et les options d’affichage du texte. L’import filtre les identifiants et palettes non valides; les anciens fichiers sans ces réglages restent acceptés. Comme auparavant, le fichier ne contient ni jeux de données chargés ni cartes rendues et doit être relancé pour actualiser les analyses.

## Fichiers concernés

- `public/js/vue3d.js` et `public/js/vue3d-ui.mjs` — projections dans le moteur et la vue interactive;
- `public/styles.css` — sélecteur de projection;
- `public/js/workspace.mjs` et `public/js/app.js` — validation, sauvegarde et restauration des styles avec les projets/modèles;
- `public/index.html`, `README.md`, `docs/VUE3D.md` — textes d’aide et documentation;
- `test/vue3d.test.mjs`, `test/workspace.test.mjs` — tests géométriques, export SVG et compatibilité des fichiers.

## Vérification

- `npm test` : **644 tests passés, 0 échec**.
- `npm run lint` : **170 fichiers contrôlés, 0 échec**.
- Les tests réseau restent opt-in (`FM_NET=1`) et n’ont pas été lancés; aucun parcours visuel sur appareil n’a été exécuté.

Aucune donnée de production, API externe ou déploiement n’a été modifié par ce chantier.
