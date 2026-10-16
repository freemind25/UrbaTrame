# Données, licences et attribution

Le logiciel est sous licence MIT ; **les données qu'il met en forme ne le sont
pas**. Toute publication d'une carte produite par l'application doit porter
l'attribution correspondante.

## Sources

| Donnée | Source | Licence | Attribution à afficher |
|---|---|---|---|
| Voirie, bâti, usage du sol, points d'intérêt, transports | [OpenStreetMap](https://www.openstreetmap.org/copyright), via Overpass API | ODbL 1.0 | `© OpenStreetMap contributors` |
| Empreintes bâties et classes d’occupation OBM (analyse facultative) | [OpenBuildingMap](https://www.openbuildingmap.org/), tuiles vectorielles de la couche d’occupation | ODbL 1.0 | `OpenBuildingMap · GFZ Data Services · © OpenStreetMap contributors · ODbL 1.0` |
| Recherche de lieu | [Nominatim](https://nominatim.org/) | ODbL 1.0 (données OSM) | `© OpenStreetMap contributors` |
| Limites administratives et aperçus thématiques | [GADM](https://gadm.org/), versions 4.1, 4.0.4 et 3.6 | Usage commercial et redistribution selon l’autorisation confirmée pour UrbaTrame ; exceptions pays à vérifier | `© GADM` avec la version affichée |
| Altimétrie | [Terrarium](https://registry.opendata.aws/terrain-tiles/) (AWS Open Data ; SRTM, USGS, EU-DEM) | domaine public | mention facultative |
| Climat (températures, pluie, irradiation, vent) | [NASA POWER](https://power.larc.nasa.gov/) | domaine public | `Source : NASA POWER` |

Les données GADM sont utilisées selon l’autorisation commerciale et de redistribution confirmée pour UrbaTrame. GADM signale une licence distincte pour l’Autriche (CC BY-SA 2.0) ; vérifier les conditions nationales applicables dans la [licence officielle](https://gadm.org/license.html). Les aperçus raster thématiques sont servis par le site GADM, et leur version peut différer des archives choisies.

OpenBuildingMap (OBM) assemble des empreintes issues d’OpenStreetMap, Google Open Buildings et Microsoft Global ML Building Footprints; le flux public d’occupation utilisé ici ne fournit que la géométrie, `osm_id` et la classe `occupancy`. Il n’expose pas les hauteurs, surfaces de plancher ou la provenance de chaque empreinte. Les empreintes OBM restent une couche distincte des objets OSM chargés par UrbaTrame. Elles ne constituent ni des parcelles ni des limites cadastrales.

La part d’empreintes OBM avec une classe `occupancy` renseignée est calculée uniquement parmi les empreintes retournées dans l’emprise demandée. Ce n’est pas un taux global de complétude de la carte, une mesure de précision ou un niveau de confiance; une classe inconnue ne prouve pas l’absence d’un bâtiment. Le flux peut être partiel ou généralisé aux bords des tuiles.

Citation du jeu : Oostwegel, L. J. N.; Schorlemmer, D.; Lingner, L.; Evaz Zadeh, T. (2025), *OpenBuildingMap*, GFZ Data Services, [doi:10.5880/GFZ.LKUT.2025.002](https://doi.org/10.5880/GFZ.LKUT.2025.002). Les empreintes et classes OBM sont sous ODbL 1.0. Un usage non commercial ne supprime ni l’attribution requise ni les conditions de partage à l’identique applicables aux bases dérivées publiées.

Le cartouche de chaque carte affiche déjà la mention du producteur
(`OSM`, `SRTM+USGS`, `NASA POWER`). Une planche imprimée doit en plus porter la
ligne d'attribution OSM, comme les crédits en pied de page de l'interface.

## Ce que l'ODbL implique

OpenStreetMap est sous *Open Database License* : l'attribution est obligatoire,
et une base dérivée publiée doit rester sous la même licence. Concrètement :

- afficher la mention `© OpenStreetMap contributors` sur toute carte diffusée ;
- ne pas présenter les données comme les vôtres ;
- si vous publiez une base dérivée (par exemple une table de densités calculée
  sur un territoire), la placer sous ODbL;
- pour une carte utilisant OpenBuildingMap, faire apparaître l’attribution
  OBM/GFZ et OpenStreetMap, et indiquer ODbL 1.0.

Les résultats produits par l'application sont des **cartes** (images, SVG, PDF) :
leur diffusion demande l'attribution, non la mise sous ODbL de votre document.

## Appels réseau et quotas des fournisseurs

L'application interroge des services publics : elle doit rester sobre.

- **Overpass** — au plus trois requêtes par génération, bornées à 3 km de rayon,
  avec deux miroirs de repli. Le serveur n'exécute que les requêtes qu'il a
  planifiées.
- **Nominatim** — une recherche par action utilisateur, avec un `User-Agent`
  identifiant le déploiement (voir `UA` dans `server/config.mjs` : **modifiez-le**
  pour y mettre votre contact, c'est la règle d'usage de Nominatim).
- **Terrarium** — tuiles mises en cache le temps d'une requête (zoom 14, 13 ou
  12 selon le rayon).
- **NASA POWER** — une requête par génération, trois ans de séries journalières.
- **OpenBuildingMap** — analyse facultative, jusqu’à 16 tuiles d’occupation
  (zoom 12 à 14), avec cache serveur en mémoire de cinq minutes. Aucun quota,
  SLA ou garantie de disponibilité du fournisseur n’a été vérifié.

Un déploiement public doit prévoir son propre cache (ou un répartiteur limitant
le débit) : ces sources publiques sont accessibles sans clé, mais sans garantie
de disponibilité.

## L'exemple embarqué

`public/data/sample-elkhroub.json` (≈ 855 Ko) est un extrait réel figé :

- 1 577 éléments OpenStreetMap autour d'El Khroub (Constantine, Algérie), 600 m ;
- grille d'altitude 16 × 16, zoom 14 ;
- cinq séries climatiques sur trois ans.

Il est reproductible, aux évolutions d'OSM près :

```bash
npm run capture -- --lat 36.2642 --lon 6.6969 --radius 600 \
  --name "El Khroub, Constantine (Algérie)"
```

Les bancs d'essai s'appuient dessus : c'est ce qui permet à `npm test` de
vérifier les 35 rendus sans accès réseau. Si vous changez ce fichier, relancez
`npm test` (les tests comparent les volumes attendus) et mettez à jour le nom
et le rayon du bouton *Exemple* dans `public/js/app.js`.
