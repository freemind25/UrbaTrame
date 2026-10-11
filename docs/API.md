# API HTTP

Toutes les réponses sont en JSON (`Content-Type: application/json; charset=utf-8`)
sauf les fichiers statiques. Chaque réponse porte un en-tête `X-EM-Trace`
commun à l'instance, qui permet de rattacher un incident à un journal serveur.

## `GET /api/status`

État du service et paramètres publics.

```json
{
  "ok": true,
  "version": "0.1.0",
  "trace": "9f2c1a4e",
  "pub": "…",                       // clé publique Ed25519 (base64, 32 octets)
  "free": ["roads", "landuse", "gw", "fabric"],
  "max": ["mappingboard", "…"],
  "limits": { "roads": 3000, "poiheat": 1500, "…" },
  "sources": { "overpass": "2 miroirs", "nominatim": true, "nasa": true, "terrain": true },
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
| `account`, `token` | chaîne | requis pour les analyses hors essai |
| `public` | booléen | force le palier gratuit (utilisé par l'essai) |

```json
{
  "ok": true,
  "run": "3f5c…",
  "tier": "free",
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

Les codes sont traduits en français et en anglais dans
`public/js/routes.mjs` (`ERR`), qui porte aussi les délais d'attente par
action.
