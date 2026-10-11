# Journal de mise au point — 11/10/2026

Relevé des corrections et vérifications de la première version. Il sert de
mémoire technique : chaque défaut listé a été constaté, expliqué, corrigé et
couvert par un test ou une vérification manuelle.

## 1. Contrôle de syntaxe

Le projet n'ayant aucune étape de build, `npm run lint`
(`tools/check-syntax.mjs`) passe `node --check` sur tous les fichiers `.js` et
`.mjs` du dépôt. Les modules ES portant l'extension `.js`
(`public/js/app.js`) sont recopiés en `.mjs` dans un dossier temporaire, sinon
Node les refuse à cause de l'extension.

## 2. Extraction de la normalisation OSM

`mergeNormalized()` vivait dans `app.js` **et** dans le serveur, et ignorait son
premier argument : `generate()` faisait `Object.assign(acc, …)`, si bien qu'un
plan à plusieurs lots (`base` puis `points`) écrasait les données du lot
précédent. La normalisation est désormais dans `public/js/osm.mjs`
(`normalizeElements(into, elements)`) : elle écrit **dans** l'accumulateur, et
le serveur renvoie les éléments bruts, conformément à l'architecture voulue.

## 3. Bancs d'essai

| Fichier | Objet |
|---|---|
| `test/renderers.test.mjs` | les 35 analyses, leurs 4 palettes, les deux langues, les modes essai/licence, le cas « aucune donnée » |
| `test/plan.test.mjs` | cohérence catalogue ↔ planificateur, bornes de rayon, forme des requêtes, fusion des lots |
| `test/licence.test.mjs` | clés persistantes, codes, signature vérifiée hors ligne, sessions expirées |
| `test/api.test.mjs` | contrat HTTP, paliers, quota, refroidissement, statiques, traversée de répertoire |
| `test/terrain.test.mjs` | encodeur PNG de synthèse, décodeur, élévation, projection Mercator |

Le chargeur commun (`tools/kernel.mjs`) évalue les quatre scripts du noyau
exactement comme le navigateur, sans transformation.

## 4. Défauts trouvés et corrigés

| # | Symptôme | Cause | Correctif |
|---|---|---|---|
| 1 | Données d'un lot perdues | `mergeNormalized` sans accumulateur | `public/js/osm.mjs` + `normalizeElements(acc, …)` |
| 2 | `terrain`/`climate` refusés (`INVALID_DEVICE`) | identifiant d'appareil factice codé en dur côté client | `Routes.terrain/climate` transmettent l'identifiant réel |
| 3 | Lot `points` vide (0 élément) | `combined` dépend de la couche `poi` sans avoir de sélecteurs POI : la requête partait vide | repli sur le jeu POI complet + garde-fou : un lot sans sélecteur n'est plus créé |
| 4 | Réponse Overpass vide mais « réussie » | Overpass signale ses pannes par un `remark` avec `elements: []` | contrôle du `remark` côté serveur et côté client |
| 5 | Légendes qui se chevauchent | corps typographique fixe (6,5 px) dans des colonnes étroites | `wrap()` calcule le corps d'après la place disponible (4,1 → 6,5 px), libellés abrégés |
| 6 | Rose des orientations difforme | secteurs dessinés en traits d'épaisseur variable | vrais secteurs annulaires (`path` à deux arcs) |
| 7 | Trame altimétrique hors du cadre | projection appliquée à une grille 16 × 16 occupant toute la toile | grille repliée dans un losange de 158 px, exagération recalculée |
| 8 | Cumul de pluie triplé | NASA POWER renvoie des totaux **journaliers**, sommés tels quels sur trois ans | moyenne par mois, puis moyenne journalière × 365 |
| 9 | Carte `sun` illisible par défaut | première palette sombre pour une scène de midi | palettes claires en premier, indices sombres mis à jour dans le renderer |
| 10 | Bouton « Restaurer » inopérant, `#radiusWrap` absent | modale Tarifs régénérée sans réattacher les écouteurs | écouteurs rebranchés, identifiant rétabli, accès défensif |
| 11 | `cooldownMs: 0` sans effet | test de véracité sur une valeur numérique (`0` est faux en JavaScript) | `typeof cooldownMs === 'number'` dans `createApp` — trouvé par `test/api.test.mjs` |

## 5. Découpage du serveur

Le serveur tenait en un fichier de 502 lignes. Il est désormais découpé en
modules d'une responsabilité : `config`, `http`, `licence`, `quota`, `runs`,
`api`, `sources/*`, plus `index.mjs` qui les assemble et expose `createApp()`.
Ce découpage est ce qui rend le serveur testable en cours de processus : les
bancs d'essai lancent une instance sur un port éphémère, avec un dossier de
données temporaire, sans toucher à la clé de signature du dépôt.

## 6. Vérification du backend (serveur en marche)

| Essai | Résultat |
|---|---|
| `GET /api/status` | 200, paliers, limites, clé publique, codes |
| `POST /` `geocode=El Khroub` | 1 résultat Nominatim |
| `begin` gratuit (`public:true`) | run créé, 1 requête |
| `query base` | 1 529 éléments |
| `end` | `{ok:true}` |
| Requête payante sans licence | `401 LICENCE_REQUIRED` |
| `activate cs_demo_max` | jeton + titre signé (référence `MTN-F4DAC`) |
| `begin` licencié, rayon 2 000 m | 3 lots planifiés |
| `query base / areas / points` | 4 390 / 332 / 224 éléments |
| Deuxième `begin` simultané | `429 GENERATION_IN_PROGRESS` + `Retry-After: 5` |
| `activate cs_faux` | `INVALID_CODE` |
| `begin` rayon 50 m | `RADIUS_200_3000` |
| `begin` analyse inconnue | `INVALID_ANALYSES` |
| `terrain` 16 × 16, zoom 14 | 588,7 → 664,6 m en 1,3 s |
| `climate` | 1 096 jours × 5 séries en 0,6 s |
| Vérification Ed25519 du titre | signature valide, charge `{v:1,t:'max',d:…,x:…}` |
| Fichiers statiques | 13 routes en 200, types MIME corrects |
| `data/keys.json` | clé publique inchangée après redémarrage, droits 0600 |
| Traversée de répertoire (`/../server/config.mjs`) | 404 |

## 7. Balayage du planificateur

252 plans générés (35 analyses isolées × 7 rayons, plus la sélection complète à
chaque rayon) : **aucune requête vide**, requête la plus longue 893 caractères.
Cohérence catalogue ↔ planificateur : 44 entrées, 44 clés `DEPS`, aucun écart.

## 8. Exemple embarqué

`public/data/sample-elkhroub.json` (855 Ko) est recapturable à l'identique :

```bash
npm run capture -- --out /tmp/essai.json
# → 1 577 éléments, 836 Ko, même contenus
```

Il est branché sur le bouton *Exemple* et sur `?sample=1` : l'application
produit un plan complet sans réseau ni serveur, ce qui permet aussi de la
présenter dans un aperçu isolé où Overpass et NASA POWER sont inaccessibles.

## 9. Reste à faire

- 9 analyses sont déclarées au catalogue sans rendu (`impl:false`, badge
  « v0.2 ») : planches composées, vent, réseau radial.
- Le parrainage répond (`refcheck`, `refcode`) mais n'applique aucune remise.
- L'impression d'une planche multi-cartes en A3 n'a pas été vérifiée sur une
  imprimante réelle.
- Le quota et les sessions d'activation vivent en mémoire : à rendre partagés
  avant toute exploitation à plusieurs instances.
