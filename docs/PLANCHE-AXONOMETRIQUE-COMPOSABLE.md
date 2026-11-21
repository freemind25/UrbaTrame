# Composer la planche axonométrique éclatée

## Dans UrbaTrame

Sélectionner « Analyse axonométrique éclatée » dans le catalogue, choisir un site et charger ses données, ou ouvrir l'exemple El Khroub embarqué. Sous la carte, ouvrir **Composer les couches de la planche**. Cocher ou décocher sol/usages, voirie/rail, emprises bâties et points d'intérêt ; au moins une couche reste affichée. Les flèches réordonnent les quatre catégories **du bas vers le haut**, y compris celles provisoirement masquées. Les numéros correspondent aux seules couches visibles dans le dessin. Choisir un espacement graphique rapproché, moyen ou éclaté. La légende et le nombre de couches se mettent à jour ; les boutons SVG et PNG exportent la composition affichée.

La composition est enregistrée localement dans ce navigateur. Elle est aussi incluse dans les projets et modèles locaux et dans leur export JSON. Les anciens fichiers restent lisibles : sans composition enregistrée, l'agencement par défaut est rétabli lors de l'ouverture. Les projets enregistrent des paramètres, pas les données ni l'image : il faut relancer les analyses après ouverture. Les coordonnées du site figurent dans l'export de projet ; vérifier avant partage. L'export PNG ne comporte pas de métadonnées détaillées de provenance.

## Ce que le dessin représente — et ne représente pas

- Ces quatre familles proviennent des données OSM déjà chargées et normalisées par UrbaTrame, non des données du site archiMap. Masquer une couche change uniquement la représentation, pas les données chargées ni les autres cartes.
- Les quatre plans partagent emprise et projection ; leur espacement et leur ordre sont **graphiques**, pas des altitudes ni une chronologie. Les bâtiments sont des emprises planes, sans hauteur ; il ne s'agit pas d'une maquette 3D ni d'un modèle de découpe laser. La représentation peut masquer des chevauchements en mode rapproché.
- La projection est schématique, non cadastrale ; les données OSM peuvent être incomplètes, anciennes ou mal classées et les trous de polygones ne sont pas restitués. La mention OSM/ODbL et les précautions restent sur la planche. Un fond clair n'est pas une preuve d'absence d'usage ou d'objet.
- SVG/PNG sont des images de présentation et non des couches SIG géoréférencées. Vérifier les résultats et les sources avant usage ou diffusion ; rien ne remplace un relevé ou une analyse réglementaire.
- La configuration ne crée ni classes personnalisées, ni import des couches de l'atelier, ni sauvegarde des données OSM. Les analyses thermique, acoustique ou de visibilité, ainsi que la découpe laser, ne sont pas ajoutées ici.

## Périmètre et vérifications

L'idée de composer et d'espacer des couches est inspirée des descriptions publiques d'[archiMap](https://archimap.masslabs-archi.com/), sans copie de son code, de ses styles, de ses cartes ou de ses jeux de données. L'application concurrente n'a pas été testée avec un compte ; sa couverture locale et la précision de ses analyses ne sont pas vérifiées.

Les tests `test/axoexploded.test.mjs` et `test/workspace.test.mjs` couvrent les 15 sous-ensembles de couches, trois espacements, l'ordre, la normalisation, les exports SVG et la persistance des configurations valides ou anciennes. Vérification navigateur de bureau et mobile : configuration, export SVG/PNG et export de projet ; le statut d'accès est simulé localement, l'authentification réelle n'est pas testée dans ce parcours.
