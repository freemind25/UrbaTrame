# Freemap — analyse de site architecturale

Générateur d'analyses de site et d'exports pour la CAO : **35 analyses** SVG,
plans DXF/SVG/PNG, coupes de terrain et maquettes OBJ/STL à partir
d'OpenStreetMap, de NASA POWER et du relief AWS Terrarium. L'**atelier
Topographique Altiplan** est une section intégrée de Freemap — pas une
application ou un dépôt séparé — et fonctionne sans compte ni quota. L'application
principale fonctionne aussi sans réseau grâce à un extrait embarqué.

> **Origine du projet.** Freemap est né d'un travail de rétro-ingénierie :
> comprendre l'architecture d'un générateur de planches d'analyse de site, puis
> en écrire une mise en œuvre indépendante. Aucune ligne de code, aucun texte et
> aucune donnée de ce service n'ont été repris ; le catalogue des analyses, les
> rendus, les textes et le catalogue de licences sont les nôtres. Le projet
> n'est **affilié à aucun éditeur tiers**.

[![licence MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520.11-brightgreen.svg)](package.json)
[![dépendances](https://img.shields.io/badge/d%C3%A9pendances-aucune-informational.svg)](package.json)
[![tests](https://img.shields.io/badge/tests-359%20hors%20ligne-success.svg)](#bancs-d-essai)

[![CI](https://github.com/freemind25/freemap/actions/workflows/ci.yml/badge.svg)](https://github.com/freemind25/freemap/actions/workflows/ci.yml)

![Trois planches de rendus](docs/img/planche-1.png)
![Trois planches de rendus](docs/img/planche-2.png)
![Trois planches de rendus](docs/img/planche-3.png)

*Les 35 analyses sur El Khroub (Constantine, Algérie), rayon 600 m, sans
filigrane — la vue de l'essai gratuit est filigranée.*

## Démarrage

Aucune dépendance à installer : Node.js 20.11 et rien d'autre.

```bash
git clone https://github.com/freemind25/freemap.git
cd freemap
npm start                  # http://localhost:4173
```

Pour voir l'application en action sans attendre Overpass, ouvrez
<http://localhost:4173/?sample=1> : l'exemple embarqué (El Khroub, 600 m,
1 577 éléments réels) se charge immédiatement.

## Ce que fait l'application

- **35 analyses** de 240 × 268 : voirie, tissu urbain, densité, volumétrie
  axonométrique, typologie, trames, orientations, POI, vitalité, mobilité,
  bruit, ensoleillement, relief, climat (températures, pluie, ensoleillement,
  durée du jour).
- **Recherche de lieu** (Nominatim) ou coordonnées directes, rayon de 200 à
  3 000 m, périmètre circulaire ou polygonal.
- **Exports** : SVG unitaire, PNG, « tout exporter », planche A3 pour
  l'impression.
- **Atelier topographique Altiplan**, accessible depuis le bouton « Atelier
  topo » : sélection cartographique, couches OSM (arbres et parcelles seulement
  si elles sont cartographiées), plans, coupes et modèles 3D.
- **Interface bilingue** français/anglais (`?lang=en`), thème clair ou sombre
  selon l'analyse, six palettes de couleurs.
- **Paliers** : 4 analyses en essai gratuit (filigranées), 23 en Pro, 8 en Max.

## Structure du dépôt

```
.
├── public/                  interface servie telle quelle (aucune compilation)
│   ├── index.html           analyses Freemap
│   ├── atelier.html         section Atelier topographique Altiplan
│   ├── styles.css           interface des analyses Freemap
│   ├── atelier.css          styles de la section topographique
│   ├── favicon.svg
│   ├── data/                exemples embarqués (El Khroub)
│   └── js/
│       ├── atelier/         carte, données OSM et exports de l'atelier
│       ├── catalog.js       44 entrées de catalogue, 7 groupes FR/EN
│       ├── engine.js        moteur : wrap(), palettes, géométrie, légendes
│       ├── renderers-core.js  11 analyses gratuites
│       ├── renderers-pro.js   24 analyses sous licence
│       ├── plan-2d.mjs  planificateur partagé navigateur/serveur
│       ├── osm.mjs          normalisation des données OpenStreetMap
│       ├── routes.mjs       client HTTP, codes d'erreur FR/EN, repli direct
│       ├── persist.mjs      cache IndexedDB, préférences locales
│       └── app.js           orchestration, i18n, exports, état
├── api/                     fonctions serverless : analyses et Atelier topographique
├── server/
│   ├── atelier-api.mjs      routes publiques du module Atelier
│   ├── atelier-data.mjs     couches OSM autorisées et filtrage des contacts
│   ├── index.mjs            point d'entrée, createApp(), CLI
│   ├── api.mjs              contrat HTTP (gestionnaires réutilisés par les deux modes)
│   ├── runtime.mjs          où vit l'état : mode « node » ou « vercel »
│   ├── licence.mjs          clés Ed25519, codes, titres signés
│   ├── quota.mjs            une génération en vol par IP
│   ├── runs.mjs             sessions de génération
│   ├── http.mjs             envoi, corps, IP, fichiers statiques
│   ├── config.mjs           chemins, sources, délais
│   └── sources/             overpass · climate · terrain
├── test/                    tests d'API, d'exports et de non-régression
├── tools/                   rendu, exports Freemap et CLI de l'atelier
├── docs/                    architecture, API, données, Atelier, déploiement, journal
└── .github/                 CI, gabarits d'issues et de proposition
```

Le détail des choix se trouve dans **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## API

| Route | Objet |
|---|---|
| `GET /api/status` | version, paliers, plafonds de rayon, clé publique Ed25519 |
| `POST /analysis/2d` | `check` · `begin` · `query` · `end` · `activate` · `terrain` · `climate` |
| `POST /` | `geocode=` · `refcheck=` · `refcode=` |
| `GET /api/atelier/health` | état de la section Atelier topographique |
| `POST /api/atelier/geocode` | recherche de lieu pour l’atelier |
| `POST /api/atelier/extract` | couches OSM autorisées et relief, sans compte ni quota |

Le client n'envoie jamais de requête Overpass : il envoie des identifiants
d'analyse, un rayon et un point ; le serveur reconstruit la requête avec le
planificateur partagé. Contrat complet et codes d'erreur :
**[docs/API.md](docs/API.md)**.

## Licences et paliers

| Palier | Débloque | Obtention |
|---|---|---|
| essai (`free`) | `roads`, `landuse`, `gw`, `fabric` | par défaut, cartes filigranées |
| `pro` | + 15 analyses d'étude | code de licence |
| `max` | les 35 analyses | code de licence |

Codes de démonstration fournis par le dépôt (`DEMO_CODES`) :

| Code | Palier |
|---|---|
| `cs_demo_pro` | pro, 30 jours |
| `cs_demo_max` | max, 30 jours |
| `cs_etude_2026` | max, 90 jours |
| `cs_demo_lifetime` | max, sans expiration |

Un code s'active dans *Tarifs* ; il est lié à un identifiant d'appareil et le
titre signé est vérifié **dans le navigateur** (`crypto.subtle`) avant d'ouvrir
l'accès. Modifier `localStorage` ne donne donc rien. Avant une mise en ligne,
remplacez ces codes et lisez [SECURITY.md](SECURITY.md).

## Vue 3D

Les bâtiments peuvent être affichés **en volume**, avec ombres portées selon
l'heure et le lieu (comme sur `osmbuildings.org`, dont les fonctions ont été
relevées puis réimplémentées sans dépendance) :

- analyse **Volumes 3D** dans le catalogue, exportable comme les autres ;
- **vue interactive** plein écran (bouton `3D` ou `?vue3d=1`) : rotation,
  inclinaison, zoom, curseur d'heure, fiche au clic, fond de carte optionnel,
  export PNG et SVG ;
- **posés sur le terrain réel** (altimétrie Terrarium, la même que l'analyse
  « relief ») et **cours intérieures évidées** : les volumes suivent la pente,
  les toits à cour sont troués.

Deux sources de hauteurs : nos requêtes Overpass (autonome) ou les tuiles
d'osmbuildings.org, qui fournissent une hauteur pour chaque bâtiment.
Détail et limites : **[docs/VUE3D.md](docs/VUE3D.md)**.

## Exports CAO

Le bouton **« Exports CAO »** ouvre un panneau à trois onglets, avec aperçu
avant téléchargement :

| Export | Format | Ce qu'il contient |
|---|---|---|
| Plan topographique | `.dxf` R12 | courbes de niveau (altitude en Z), bâti fermé à sa hauteur, voirie, eau, végétation, POI, emprise, cartouche |
| Coupe | `.dxf`, `.svg` | profil du terrain entre deux points, bâti traversé, cotes |
| Modèle 3D | `.obj`, `.stl` | maillage du relief et bâti, sommets en mètres, altitudes vraies |

Tout est en mètres, X vers l'est, Y vers le nord, Z vers le haut — et le repère
peut être géoréférencé en **UTM (WGS 84)** pour se superposer à un fond
cadastral. Les emprises bâties portent leur hauteur en Z : dans AutoCAD,
`EXTRUDE` en fait des volumes. Hors navigateur :

```bash
node tools/exporter.mjs --out /tmp/freemap        # plan, coupe, modèle, aperçus
node tools/exporter.mjs --quoi plan --geolocate --equi 5
```

Conventions, options, vérifications (relecture des fichiers par `ezdxf` et
`trimesh`) et limites : **[docs/EXPORTS.md](docs/EXPORTS.md)**.

## Atelier topographique Altiplan

Altiplan est le module topographique de Freemap, accessible depuis le bouton
**« Atelier topo »** ou à `/atelier.html`. Il permet de choisir un site sur la
carte, de récupérer les couches OSM et le relief, puis de produire un plan,
une coupe et un modèle 3D. Cette section est **sans compte et sans quota**.
Les parcelles ne sont montrées que si elles existent dans OSM : aucune limite
juridique ou cadastrale n'est inventée.

```bash
npm run atelier:exporter -- --out /tmp/freemap-atelier
npm run atelier:exporter -- --lieu "Constantine, Algérie" --rayon 900 --geolocate
```

Formats, paramètres et limites : **[docs/ALTIPLAN.md](docs/ALTIPLAN.md)**.

![Plan topographique d’exemple pour El Khroub](docs/img/atelier-el-khroub-plan.png)
![Maquette 3D d’exemple pour El Khroub](docs/img/atelier-el-khroub-3d.png)

## Accès : période d'essai ouverte

**Aujourd'hui, tout est ouvert** : les 35 analyses, sans licence, sans
filigrane et sans quota. C'est le mode par défaut.

```
FM_ACCESS=open      # défaut — toutes les analyses pour tout le monde
FM_ACCESS=licence   # 4 analyses gratuites filigranées, Pro/Max sur code, quota par IP
```

Le serveur annonce son mode dans `/api/status` (champ `access`) et le client
s'y adapte seul : catalogue déverrouillé, filigrane retiré, badge « LIBRE ».
Le jour où les abonnements reviennent, il suffit de basculer la variable.
Détail et marche à suivre : **[docs/ACCES.md](docs/ACCES.md)**.

## Bancs d'essai

```bash
npm test          # tests hors ligne (aucun accès réseau requis)
npm run test:net  # + Overpass, Nominatim, NASA POWER, Terrarium
npm run lint      # contrôle de syntaxe de tout le dépôt
npm run svg -- --ids massing,gw --png   # rendus hors navigateur
npm run capture   # recapture l'exemple embarqué depuis les sources réelles
npm run genere-cle   # clé de signature Ed25519 (serveur : fichier · Vercel : variable)
node tools/exporter.mjs --out /tmp/freemap    # exports DXF · coupe · OBJ/STL
```

Les tests couvrent le rendu des 35 analyses et de leurs palettes, la cohérence
du catalogue et du planificateur, les licences (signature vérifiée
indépendamment du serveur), le contrat HTTP, le quota, l'accès libre et le basculement
en régime sous licence, le repli entre miroirs Overpass, la vue 3D (soleil,
caméra, ombres, désignation au clic, lecture des deux sources), le décodeur PNG
des tuiles d'altitude et la projection Mercator, et les exports CAO (projection
UTM comparée à des valeurs de référence, structure du DXF, recadrage à
l'emprise, coupe et bâti traversé, triangulation du STL).

## Déploiement

Deux modes, selon l'endroit où le serveur tourne :

| Mode | Où | Ce que vous obtenez |
|---|---|---|
| **Serveur Node** (défaut) | VPS, Docker, Render, Railway | tout : quota par IP, licences révocables, clé sur disque |
| **Serverless** | Vercel | tout sauf la révocation et le quota global : l'état vit en mémoire d'instance |

À ceci près : en accès libre (le défaut), ni licence ni quota intervient, donc
les deux modes se comportent pareil pour l'utilisateur.

Sur Vercel, l'API est exposée par trois fonctions (`api/`) et le reste est
servi en statique ; il faut poser une variable d'environnement pour que les
licences fonctionnent. Détail, limites et vérifications :
**[docs/VERCEL.md](docs/VERCEL.md)**.

Pour le serveur classique (variables d'environnement, systemd, Docker, points
de vigilance) : **[docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md)**. À retenir avant
toute mise en ligne : sauvegarder la clé privée de signature, remplacer les
codes de démonstration, régler le `User-Agent` sur votre contact, et rendre le
quota partagé si vous lancez plusieurs instances.

## Données et attribution

| Donnée | Source | Licence |
|---|---|---|
| Voirie, bâti, usage, POI, transports | OpenStreetMap via Overpass | ODbL 1.0 — `© OpenStreetMap contributors` |
| Altimétrie | AWS Terrarium (SRTM, USGS, EU-DEM) | domaine public |
| Climat | NASA POWER | domaine public |

Les planches publiées doivent porter l'attribution OSM. Détail et implications
de l'ODbL : **[docs/DONNEES.md](docs/DONNEES.md)**.

## État du projet

Version 0.1.0, voir [CHANGELOG.md](CHANGELOG.md). 9 analyses sur 44 sont
déclarées au catalogue sans rendu (planches composées, vent, réseau radial) et
apparaissent avec le badge « v0.2 ». Le parrainage répond mais n'applique aucune
remise. Les suites prévues sont listées dans
[docs/JOURNAL-DEV.md](docs/JOURNAL-DEV.md#9-reste-à-faire).

## Contribuer

Les propositions sont bienvenues : voir [CONTRIBUTING.md](CONTRIBUTING.md)
(conventions, ajout d'une analyse en trois fichiers) et
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Les défauts se signalent avec le
gabarit d'issue, en précisant l'analyse, le lieu et le rayon.

## Licence

Code sous [MIT](LICENSE). Les données restent sous les licences de leurs
producteurs.
