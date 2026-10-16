# API HTTP

Toutes les réponses sont en JSON (`Content-Type: application/json; charset=utf-8`)
sauf les fichiers statiques. Chaque réponse porte un en-tête `X-EM-Trace`
commun à l'instance, qui permet de rattacher un incident à un journal serveur.

## `GET /api/status`

État du service et paramètres publics. Le champ `access` dit le régime en
vigueur : `open` (période d'essai ouverte — toutes les analyses, sans licence
ni quota) ou `licence` (5 analyses gratuites / Pro / Max). Voir `docs/ACCES.md`.

```json
{
  "ok": true,
  "version": "0.1.0",
  "trace": "9f2c1a4e",
  "pub": "…",                       // clé publique Ed25519 (base64, 32 octets)
  "access": "open",                 // « open » (période d'essai) ou « licence »
  "free": ["roads", "landuse", "gw", "fabric", "obmoccupancy"],
  "max": ["mappingboard", "…"],
  "limits": { "roads": 3000, "poiheat": 1500, "…" },
  "sources": { "overpass": "2 miroirs", "nominatim": true, "nasa": true, "windrose": true, "terrain": true, "openBuildingMap": true },
  "codes": ["cs_demo_pro", "cs_demo_max", "cs_demo_lifetime", "cs_etude_2026"]
}
```

## `POST /analysis/2d`

Corps JSON. Le champ `device` est obligatoire partout : c'est un identifiant
d'appareil stable (UUID), conservé par le client dans `localStorage`.

### `action: "check"`

| Champ | Type | |
|---|---|---|
| `device` | chaîne | obligatoire |
| `account`, `token` | chaîne | facultatif (session à vérifier) |

Réponse : `{ ok, tier, plan?, expiresAt?, ent?, pub }`. Sans identifiants, le
palier `free` est renvoyé.

### `action: "begin"`

Ouvre une session de génération et renvoie les lots planifiés.

| Champ | Type | |
|---|---|---|
| `device` | chaîne | obligatoire |
| `ids` | tableau | identifiants d'analyse du catalogue |
| `radius` | nombre | 200 à 3 000 mètres |
| `lat`, `lon` | nombres | centre de la fenêtre |
| `account`, `token` | chaîne | requis pour les analyses hors essai (sans objet en accès libre) |
| `public` | booléen | force le palier gratuit (utilisé par l'essai) |

```json
{
  "ok": true,
  "run": "3f5c…",
  "tier": "open",                    // « open » en accès libre, sinon « free », « pro » ou « max »
  "access": "open",
  "groups": [
    { "id": "base", "fr": "Lecture : voirie, emprises bâties", "en": "Fetching roads + building footprints" }
  ]
}
```

Le client n'a pas accès aux requêtes OverpassQL : elles restent côté serveur.

### `action: "query"`

| Champ | Type | |
|---|---|---|
| `device`, `run`, `group` | chaîne | lot renvoyé par `begin` |
| `account`, `token` | chaîne | si session payante |

Réponse : `{ ok, group, elements }` — les éléments bruts d'Overpass
(normalisation faite par le client, `public/js/osm.mjs`). Les réponses sont
mises en cache par le navigateur, pas par le serveur.

### `action: "end"`

Ferme la session et libère le quota : `{ ok: true }`.

### `action: "activate"`

| Champ | Type | |
|---|---|---|
| `code` | chaîne | code de licence |
| `device` | chaîne | appareil auquel la licence est liée |

```json
{
  "ok": true,
  "account": "acc_9b7e7c4c7fa0",
  "token": "…",
  "plan": "max",
  "tier": "max",
  "expiresAt": 1799517372887,
  "ent": "<base64url(payload)>.<base64url(signature)>",
  "ref": "MTN-5532F",
  "pub": "…"
}
```

### `action: "buildings"`

Emprises bâties avec leurs hauteurs, pour la vue 3D. La requête Overpass est
composée par le serveur (`buildingsQuery`) : le client ne transmet que le point
et le rayon. Hors accès libre, une licence est exigée.

| Champ | Type | |
|---|---|---|
| `device` | chaîne | obligatoire |
| `lat`, `lon` | nombres | centre de la fenêtre |
| `radius` | nombre | 200 à 3 000 mètres |
| `account`, `token` | chaîne | requis hors accès libre |

Réponse : `{ ok, elements, source }` — `elements` au format Overpass (`out geom`).
Le client les normalise (`batimentsDepuisOverpass`) ou lit les tuiles
osmbuildings.org (`batimentsDepuisTuiles`). Erreurs : `MAP_SOURCE_UNAVAILABLE`
(502) si aucun miroir ne répond, `RADIUS_200_3000`, `INVALID_LOCATION`.

### `action: "terrain"`

Grille d'altitudes. `device`, `lat`, `lon`, `radius`, `n` (12 à 40 points de
côté ; zoom de tuile choisi d'après le rayon). Réponse :
`{ ok, n, zoom, lat, lon, radius, grid }` — altitude en mètres, ligne du nord
en premier.

### `action: "climate"`

Séries journalières NASA POWER sur trois ans : `{ ok, source, params }` avec
`params = { T2M_MAX, T2M_MIN, PRECTOTCORR, ALLSKY_SFC_SW_DWN, WS10M }`, chaque
série indexée par date `AAAAMMJJ`. **Attention : ce sont des valeurs
journalières** (totaux pour la pluie et l'irradiation), pas des cumuls mensuels.

### `action: "windrose"`

Rose des vents NASA POWER / MERRA-2 pour les dix dernières années civiles
complètes, à 10 m. Le client envoie `device`, `lat` et `lon`; aucune requête
cartographique OSM n'est planifiée pour cette analyse. La réponse contient
`{ ok, source, dataset, heightM, timeStandard, period, meanSpeedMs, sectors }`;
`sectors` a 16 entrées `{ bearing, frequencyPct, meanSpeedMs }`. Les directions
indiquent d'où vient le vent. C'est une statistique régionale de la grille
MERRA-2, pas une simulation locale du vent entre les bâtiments.

### `action: "obmoccupancy"`

Charge la couche publique d’empreintes et de classes d’occupation
OpenBuildingMap, séparément des groupes Overpass/OSM. Le client envoie
`device`, `lat`, `lon`, `radius` (200 à 3 000 m) et `shape` (`circle`, `square`
ou `rect`). Le serveur choisit des tuiles d’occupation au zoom 14, en abaissant
jusqu’au zoom 12 pour rester sous 16 tuiles; les réponses de tuiles sont mises
en cache en mémoire cinq minutes.

La réponse contient notamment les champs `ok`, `source`, `license`,
`attribution`, `site`, `tileZoom`, `tilesRequested`, `tilesLoaded`, `tilesFailed`,
`partial`, `featureCount`, `returnedFeatureCount`, `featuresTruncated`,
`knownOccupancyCount`, `unknownOccupancyCount`, `classifiedOccupancyPct`,
`occupancyCounts` et `features`. `classifiedOccupancyPct` est la part des empreintes
OBM retournées dont la
classe d’occupation est renseignée — **pas** un taux de complétude cartographique
ni une confiance par bâtiment. Les comptes utilisent le centroïde des polygones;
la géométrie de tuile peut être généralisée ou coupée aux bords.

Le flux public inspecté fournit les classes `occupancy`, l’identifiant `osm_id`
et les empreintes; il ne fournit pas ici les hauteurs, surfaces de plancher ou
la provenance par bâtiment. Les empreintes OBM ne sont pas des parcelles ou des
limites cadastrales. Une classe inconnue ne signifie pas qu’il n’existe pas de
bâtiment. Erreurs : `OBM_SOURCE_UNAVAILABLE` (502), `OBM_TILE_LIMIT` (400),
`INVALID_SHAPE` (400), ainsi que les erreurs de coordonnées et de rayon.
L’attribution est visible dans l’interface et les exports; les données sont
sous ODbL 1.0 même pour un usage non commercial.

## `POST /` (ou `/api/util`)

Corps `application/x-www-form-urlencoded`.

| Champ | Réponse |
|---|---|
| `geocode=lieu` | tableau Nominatim (limité à 3 résultats) |
| `refcheck=MTN-XXXXX` | `{ ok, ref, percent }` |
| `refcode=code` | `{ ok, ref, plan, tier, expiresAt, count }` |

## Codes d'erreur

| Code | HTTP | Sens |
|---|---|---|
| `BAD_JSON` | 400 | corps illisible |
| `INVALID_DEVICE` | 400 | identifiant d'appareil absent ou mal formé |
| `INVALID_ANALYSES` | 400 | identifiant d'analyse inconnu ou sélection vide |
| `INVALID_LOCATION` | 400 | coordonnées hors bornes |
| `RADIUS_200_3000` | 400 | rayon hors des bornes admises |
| `SITE_CROSSES_DATELINE` | 400 | fenêtre à cheval sur l'antiméridien |
| `UNKNOWN_GROUP` | 400 | lot inconnu pour ce run |
| `INVALID_CODE` | 400 | code de licence inconnu |
| `LICENCE_REQUIRED` | 401 | analyses hors essai sans licence |
| `DEVICE_REVOKED` | 403 | session inconnue ou appareil différent |
| `EXPIRED` | 403 | licence expirée |
| `RUN_EXPIRED` | 409 | run inconnu ou périmé (5 minutes) |
| `RATE_LIMITED` | 429 | refroidissement en cours (`Retry-After`) |
| `GENERATION_IN_PROGRESS` | 429 | une génération est déjà en vol pour cette IP |
| `EMPTY_PLAN` | 500 | lot sans requête exploitable (garde-fou interne) |
| `MAP_SOURCE_UNAVAILABLE` | 502 | Overpass injoignable ou en erreur |
| `TERRAIN_UNAVAILABLE` | 502 | tuiles d'altitude indisponibles |
| `NO_CLIMATE` | 502 | série climatique indisponible |
| `NO_WINDROSE` | 502 | rose des vents régionale indisponible |
| `OBM_SOURCE_UNAVAILABLE` | 502 | tuiles d’occupation OpenBuildingMap indisponibles |
| `OBM_TILE_LIMIT` | 400 | emprise au-delà du plafond de tuiles |
| `INVALID_SHAPE` | 400 | forme d’emprise non prise en charge |

Les codes sont traduits en français et en anglais dans
`public/js/routes.mjs` (`ERR`), qui porte aussi les délais d'attente par
action.
