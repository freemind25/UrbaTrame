# API HTTP

Toutes les réponses sont en JSON (`Content-Type: application/json; charset=utf-8`)
sauf les fichiers statiques. Chaque réponse porte un en-tête `X-EM-Trace`
commun à l'instance, qui permet de rattacher un incident à un journal serveur.

## `GET /api/status`

État du service et paramètres publics. Le champ `access` dit le régime de licences en vigueur (`open` ou `licence`). Le champ `auth` indique si la barrière universitaire est requise et prête. Quand `FM_STUDENT_AUTH=required`, les API d’application exigent un cookie de session étudiant valide; les utilisateurs autorisés reçoivent automatiquement Max (Pro inclus). Voir `docs/ACCES.md` et `docs/ACCES-ETUDIANTS-OTP.md`.

```json
{
  "ok": true,
  "version": "0.1.0",
  "trace": "9f2c1a4e",
  "pub": "…",                       // clé publique Ed25519 (base64, 32 octets)
  "access": "open",                 // mode de licences
  "auth": { "required": false, "ready": true }, // barrière universitaire (désactivée par défaut)
  "free": ["roads", "landuse", "gw", "fabric", "obmoccupancy"],
  "max": ["mappingboard", "…"],
  "limits": { "roads": 3000, "poiheat": 1500, "…" },
  "licenses": { "signedFileActivation": false, "publicKey": "" },
  "sources": { "overpass": "4 miroirs", "nominatim": true, "nasa": true, "windrose": true, "terrain": true, "openBuildingMap": true }
}
```

## Authentification étudiante (si `FM_STUDENT_AUTH=required`)

Ces routes sont publiques afin d’établir une session; toutes les opérations métier listées plus bas exigent ensuite cette session. Les opérations d’écriture vérifient l’origine web. Aucun jeton de session n’est retourné dans le JSON.

### `POST /api/auth/request-otp`

Corps JSON `{ "email": "...@univ-constantine3.dz" }`. Réponse `202` avec le même message générique si l’adresse n’est pas autorisée, est autorisée, ou est limitée. Un code est envoyé uniquement si l’adresse exacte figure active dans `whitelisted_students`. Les limites actuelles sont 10 minutes, 5 essais, 60 secondes entre renvois, 3 envois par heure et par adresse et 20 requêtes par heure et par IP.

### `POST /api/auth/verify-otp`

Corps JSON `{ "email": "...", "code": "123456" }`. Réponse de succès `{ ok, user: { email, role, tier, emailVerified, entitlements } }` et cookie de session `HttpOnly; SameSite=Lax; Secure` en HTTPS. Les comptes sont créés automatiquement au premier succès avec `tier: "max"`, qui inclut Pro. Code incorrect, expiré, consommé ou adresse inactive : `INVALID_OR_EXPIRED_CODE`.

### `GET /api/auth/session` et `POST /api/auth/logout`

La première route renvoie `{ required, ready, authenticated, user }`; la seconde révoque la session et efface le cookie. Le jeton aléatoire brut n’est connu que du navigateur via le cookie HttpOnly et du serveur à la création; la base ne conserve que son empreinte SHA-256.

## `POST /analysis/2d`

Corps JSON. Le champ `device` est obligatoire partout : c'est un identifiant
d'appareil stable (UUID), conservé par le client dans `localStorage`.

### `action: "check"`

| Champ | Type | |
|---|---|---|
| `device` | chaîne | obligatoire |
| `account`, `token` | chaîne | facultatif (session à vérifier) |

Réponse : `{ ok, tier, plan?, expiresAt?, ent?, pub }`. Sans identifiants, le
palier `free` est renvoyé. `token` peut être soit une session signée, soit le
titre signé du fichier `.utlic`; le serveur vérifie ce dernier avec la clé
publique `licenses.publicKey` annoncée par `/api/status`.

### `action: "activateLicense"`

Échange facultativement un titre `.utlic` contre une attestation de session.
L’interface peut également conserver et présenter directement le titre signé;
le serveur le revérifie dans `check` et `begin`.

| Champ | Type | |
|---|---|---|
| `device` | chaîne | obligatoire |
| `license` | chaîne | jeton signé contenu dans le fichier `.utlic` |

Réponse : `{ ok, account, token, tier, expiresAt, ent, pub }`. Si
`FM_LICENSE_PUB` n’est pas configurée, l’action renvoie
`LICENSE_ISSUER_UNCONFIGURED`.

### `action: "begin"`

Ouvre une session de génération et renvoie les lots planifiés. Avec
`FM_STUDENT_AUTH=required`, le cookie de session HttpOnly identifie l’étudiant;
`account` et `token` de licence ne sont alors pas envoyés. Exemple de réponse
pour une session étudiante vérifiée :

| Champ | Type | |
|---|---|---|
| `device` | chaîne | obligatoire |
| `ids` | tableau | identifiants d'analyse du catalogue |
| `radius` | nombre | 200 à 3 000 mètres |
| `lat`, `lon` | nombres | centre de la fenêtre |
| `account`, `token` | chaîne | pour les sessions de licence historique; en régime étudiant, le cookie de session serveur remplace cette paire |
| `public` | booléen | force le palier gratuit (utilisé par l'essai) |

```json
{
  "ok": true,
  "run": "3f5c…",
  "tier": "max",                     // compte étudiant vérifié : Max, Pro inclus
  "access": "student",               // accès issu de la session universitaire
  "groups": [
    { "id": "base", "fr": "Lecture : voirie, emprises bâties", "en": "Fetching roads + building footprints" }
  ]
}
```

En régime étudiant, `access` vaut `student`; en accès libre, il vaut `open`. Le flux historique sous licence ne remplit pas ce champ sur cette route. Le client n'a pas accès aux requêtes OverpassQL : elles restent côté serveur.

### `action: "query"`

| Champ | Type | |
|---|---|---|
| `device`, `run`, `group` | chaîne | lot renvoyé par `begin` |
| `account`, `token` | chaîne | si session de licence; inutile avec un cookie étudiant valide |

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
et le rayon. Hors accès libre, une licence historique est exigée; en régime
étudiant, le cookie de session Max suffit.

| Champ | Type | |
|---|---|---|
| `device` | chaîne | obligatoire |
| `lat`, `lon` | nombres | centre de la fenêtre |
| `radius` | nombre | 200 à 3 000 mètres |
| `account`, `token` | chaîne | requis hors accès libre, sauf avec un cookie étudiant valide |

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

## Routes cartographiques de l’atelier et du Cadrage spatial

Ces routes sont distinctes de `/analysis/2d` et ne nécessitent ni `device` ni licence. Quand `FM_STUDENT_AUTH=required`, elles exigent toutefois le même cookie de session étudiant valide. Les appels de géocodage, de GADM et d’extraction du Cadrage spatial sont déclenchés par une action explicite de l’utilisateur.

### `POST /api/atelier/geocode`

Corps JSON `{ "q": "lieu recherché" }`. La route transmet la recherche au service Nominatim, applique un cache et une limitation de débit, puis renvoie `{ ok, results: [{ name, lat, lon, type }] }`. Le service est sollicité uniquement à la soumission du formulaire.

### `GET /api/atelier/gadm`

Paramètres `country`, `level`, `version` (4.1 par défaut), et optionnellement `parent` / `parentLevel`. Renvoie un aperçu GeoJSON généralisé et mis en cache. Les limites administratives GADM ne sont pas des limites cadastrales/juridiques.

### `POST /api/atelier/cadrage-extract`

Corps JSON :

| Champ | Type | Règle |
|---|---|---|
| `lat`, `lon` | nombre | centre WGS 84 valide |
| `radius` | nombre | 200 à **3 000 m maximum** |
| `include` | tableau | `buildings`, `roads`, `landuse`, `water`, `rail`, `trees`, `pois`, `barriers`, `places` |
| `terrain` | booléen | optionnel; le relief est demandé seulement si `true` |
| `terrainN` | entier | optionnel; 12–40, valeur par défaut 24 |

Le serveur compose les sélecteurs Overpass; le client ne fournit pas de requête libre. Réponse : `{ ok, lat, lon, radius, maxRadius: 3000, include, elements, terrain, warnings, source, extractedAt }`. Une réponse supérieure à 12 000 éléments, 240 000 positions ou 12 Mo est refusée avec `CADRAGE_DATA_LIMIT` (413).

**Séparation de la limite Altiplan :** `/api/atelier/extract` continue à utiliser `MAX_RADIUS = 3989` m. Cette route historique n’est pas utilisée par le nouveau module; `/api/atelier/cadrage-extract` valide son propre plafond de 3 000 m. Les deux réglages ne se modifient pas mutuellement.

## Codes d'erreur

| Code | HTTP | Sens |
|---|---|---|
| `STUDENT_AUTH_REQUIRED` | 401 | session universitaire absente, expirée ou révoquée (si l’authentification est activée) |
| `STUDENT_AUTH_UNAVAILABLE` | 503 | authentification requise mais DB, secret ou relais e-mail non prêt |
| `INVALID_OR_EXPIRED_CODE` | 400 | OTP incorrect, expiré, consommé ou adresse retirée de la liste |
| `ORIGIN_NOT_ALLOWED` | 403 | origine web différente de celle de l’application |
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
| `GENERATION_IN_PROGRESS` | 429 | une génération est déjà en vol (compte en régime étudiant, IP dans l’ancien mode licence) |
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
