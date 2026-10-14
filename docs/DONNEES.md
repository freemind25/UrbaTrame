# Données, licences et attribution

Le logiciel est sous licence MIT ; **les données qu'il met en forme ne le sont
pas**. Toute publication d'une carte produite par l'application doit porter
l'attribution correspondante.

## Sources

| Donnée | Source | Licence | Attribution à afficher |
|---|---|---|---|
| Voirie, bâti, usage du sol, points d'intérêt, transports | [OpenStreetMap](https://www.openstreetmap.org/copyright), via Overpass API | ODbL 1.0 | `© OpenStreetMap contributors` |
| Recherche de lieu | [Nominatim](https://nominatim.org/) | ODbL 1.0 (données OSM) | `© OpenStreetMap contributors` |
| Limites administratives et aperçus thématiques | [GADM](https://gadm.org/), versions 4.1, 4.0.4 et 3.6 | Usage commercial et redistribution selon l’autorisation confirmée pour UrbaTrame ; exceptions pays à vérifier | `© GADM` avec la version affichée |
| Altimétrie | [Terrarium](https://registry.opendata.aws/terrain-tiles/) (AWS Open Data ; SRTM, USGS, EU-DEM) | domaine public | mention facultative |
| Climat (températures, pluie, irradiation, vent) | [NASA POWER](https://power.larc.nasa.gov/) | domaine public | `Source : NASA POWER` |

Les données GADM sont utilisées selon l’autorisation commerciale et de redistribution confirmée pour UrbaTrame. GADM signale une licence distincte pour l’Autriche (CC BY-SA 2.0) ; vérifier les conditions nationales applicables dans la [licence officielle](https://gadm.org/license.html). Les aperçus raster thématiques sont servis par le site GADM, et leur version peut différer des archives choisies.

Le cartouche de chaque carte affiche déjà la mention du producteur
(`OSM`, `SRTM+USGS`, `NASA POWER`). Une planche imprimée doit en plus porter la
ligne d'attribution OSM, comme les crédits en pied de page de l'interface.

## Ce que l'ODbL implique

OpenStreetMap est sous *Open Database License* : l'attribution est obligatoire,
et une base dérivée publiée doit rester sous la même licence. Concrètement :

- afficher la mention `© OpenStreetMap contributors` sur toute carte diffusée ;
- ne pas présenter les données comme les vôtres ;
- si vous publiez une base dérivée (par exemple une table de densités calculée
  sur un territoire), la placer sous ODbL.

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

Un déploiement public doit prévoir son propre cache (ou un répartiteur limitant
le débit) : ces quatre services sont gratuits et sans garantie de disponibilité.

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
