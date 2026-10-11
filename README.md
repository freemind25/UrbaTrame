# MapToNap · clone — analyse de site architecturale

Générateur de planches d'analyse de site : **35 analyses** rendues en SVG à
partir d'OpenStreetMap, de NASA POWER et des tuiles d'altitude AWS Terrarium.
Le plan est calculé par un module partagé entre le navigateur et le serveur,
les licences sont des titres signés Ed25519 liés à l'appareil, et l'application
fonctionne sans réseau grâce à un extrait embarqué.

> Projet d'étude : reproduction d'architecture d'après un rapport de
> rétro-ingénierie. **Sans lien avec l'éditeur du service d'origine**, dont ni
> le code ni les données ne sont repris. Le catalogue des analyses, les textes
> et les rendus sont les nôtres.

[![licence MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520.11-brightgreen.svg)](package.json)
[![dépendances](https://img.shields.io/badge/d%C3%A9pendances-aucune-informational.svg)](package.json)
[![tests](https://img.shields.io/badge/tests-135%20hors%20ligne-success.svg)](#bancs-d-essai)

<!-- Badge de CI : remplacez CHANGER-MOI par votre compte GitHub, puis retirez ce commentaire.
[![CI](https://github.com/CHANGER-MOI/maptonap-clone/actions/workflows/ci.yml/badge.svg)](https://github.com/CHANGER-MOI/maptonap-clone/actions/workflows/ci.yml)
-->

![Trois planches de rendus](docs/img/planche-1.png)
![Trois planches de rendus](docs/img/planche-2.png)
![Trois planches de rendus](docs/img/planche-3.png)

*Les 35 analyses sur El Khroub (Constantine, Algérie), rayon 600 m, sans
filigrane — la vue de l'essai gratuit est filigranée.*

## Démarrage

Aucune dépendance à installer : Node.js 20.11 et rien d'autre.

```bash
git clone https://github.com/CHANGER-MOI/maptonap-clone.git
cd maptonap-clone
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
- **Interface bilingue** français/anglais (`?lang=en`), thème clair ou sombre
  selon l'analyse, six palettes de couleurs.
- **Paliers** : 4 analyses en essai gratuit (filigranées), 23 en Pro, 8 en Max.

## Structure du dépôt

```
.
├── public/                  interface servie telle quelle (aucune compilation)
│   ├── index.html           coquille : panneaux, grille de cartes, modales
│   ├── styles.css           chrome sombre, impression A3 paysage
│   ├── favicon.svg
│   ├── data/                exemple embarqué (El Khroub, 855 Ko)
│   └── js/
│       ├── catalog.js       44 entrées de catalogue, 7 groupes FR/EN
│       ├── engine.js        moteur : wrap(), palettes, géométrie, légendes
│       ├── renderers-core.js  11 analyses gratuites
│       ├── renderers-pro.js   24 analyses sous licence
│       ├── mtn-2d-plan.mjs  planificateur partagé navigateur/serveur
│       ├── osm.mjs          normalisation des données OpenStreetMap
│       ├── routes.mjs       client HTTP, codes d'erreur FR/EN, repli direct
│       ├── persist.mjs      cache IndexedDB, préférences locales
│       └── app.js           orchestration, i18n, exports, état
├── server/
│   ├── index.mjs            point d'entrée, createApp(), CLI
│   ├── api.mjs              contrat HTTP
│   ├── licence.mjs          clés Ed25519, codes, titres signés
│   ├── quota.mjs            une génération en vol par IP
│   ├── runs.mjs             sessions de génération
│   ├── http.mjs             envoi, corps, IP, fichiers statiques
│   ├── config.mjs           chemins, sources, délais
│   └── sources/             overpass · climate · terrain
├── test/                    5 fichiers de bancs d'essai, 135 tests
├── tools/                   capture d'exemple, rendu SVG, contrôle de syntaxe
├── docs/                    architecture, API, données, déploiement, journal
└── .github/                 CI, gabarits d'issues et de proposition
```

Le détail des choix se trouve dans **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## API

| Route | Objet |
|---|---|
| `GET /api/status` | version, paliers, plafonds de rayon, clé publique Ed25519 |
| `POST /analysis/2d` | `check` · `begin` · `query` · `end` · `activate` · `terrain` · `climate` |
| `POST /` | `geocode=` · `refcheck=` · `refcode=` |

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

## Bancs d'essai

```bash
npm test          # 135 tests, hors ligne (aucun accès réseau requis)
npm run test:net  # + Overpass, Nominatim, NASA POWER, Terrarium
npm run lint      # contrôle de syntaxe de tout le dépôt
npm run svg -- --ids massing,gw --png   # rendus hors navigateur
npm run capture   # recapture l'exemple embarqué depuis les sources réelles
```

Les tests couvrent le rendu des 35 analyses et de leurs palettes, la cohérence
du catalogue et du planificateur, les licences (signature vérifiée
indépendamment du serveur), le contrat HTTP, le quota, le décodeur PNG des
tuiles d'altitude et la projection Mercator.

## Déploiement

Variables d'environnement, service systemd, image Docker et points de vigilance :
**[docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md)**. À retenir avant toute mise en
ligne : sauvegarder `data/keys.json` (clé privée de signature), remplacer les
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
