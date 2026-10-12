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

---

# Vue 3D : relief et cours intérieures — 12/10/2026

Suite de la mise au point, sur les deux limites annoncées dans
`docs/VUE3D.md` : « relief ignoré » (les volumes reposaient sur un plan à
altitude zéro) et « cours intérieures remplies ». Même méthode : chaque défaut
est constaté, expliqué, corrigé, puis couvert par un test.

## 10. Défauts trouvés et corrigés

| # | Défaut | Cause | Correctif |
|---|---|---|---|
| 1 | La cour intérieure se réduisait à un point à l'écran (5 px au lieu de 63) | `projLocal` attend des **mètres locaux** ; la cour lui était passée en degrés (lat/lon ≈ 36 et 6,7, soit deux « mètres » du centre) | conversion `toLocal` avant projection ; test qui vérifie que le trou occupe 16/40 de l'emprise à l'écran |
| 2 | Avec le relief, presque tout disparaissait : 4 677 faces → **218** | la grille d'altitudes était appliquée en altitude **absolue** : un site à 629 m plaçait toute la scène à 2 516 m au-dessus de la caméra, hors du plan proche | repère local : `prepareTerrain` renvoie `ref` (altitude du centre) et `z()` = altitude **relative**, déjà multipliée par l'exagération |
| 3 | Assise du bâti dépendante du point de fermeture de l'anneau | le centre retenu était la moyenne des sommets ; le point répété en fin d'anneau la décalait (et la sortait d'un anneau concave) | `centroidePoly`, centre de gravité de la surface (formule des lacets) ; test : même assise avec et sans le point répété |
| 4 | Normales `NaN` aux coins du maillage du sol | les indices de nœuds étant bornés, les quatre coins du maillage prolongé se réduisaient au **même point** (quad dégénéré) | positions prolongées au-delà de la grille (altitude du bord répétée) et garde-fou `|| 1` sur la norme de la normale |
| 5 | `rgb(NaN,NaN,NaN)` sur les 529 cases du maillage | la teinte du sol (`pal.sol`, **texte** hexadécimal) était passée à `melange`, qui attend des valeurs numériques | `hex2rgb()` puis extraction de `nuanceN()` (noyau numérique), `nuance()` en dérivant le texte |
| 6 | Moyenne de teinte impossible | `hex2rgb()` ne sait pas relire une couleur produite par `rgb()` (il renvoie `null`) | la moyenne de la couronne passe par `nuanceN()`, jamais par la chaîne de caractères |
| 7 | Membres `inner` perdus (ou remplis) | la lecture 3D écartait les membres `inner` des relations, et une relation à plusieurs `outer` ne savait pas où rattacher une cour | chaque cour rejoint l'emprise **qui la contient** (test point-dans-anneau sur son centre) ; test à deux emprises |

## 11. Choix de rendu du sol

Trois raccords ont été essayés, puis comparés en image :

| Essai | Résultat |
|---|---|
| Prolongement par la pente du bord | longues bandes obliques au-delà de la grille |
| Raccord vers le plan général | falaise sombre du côté où le terrain s'éloigne du plan |
| **Altitude du bord répétée** (retenu) | couronne plate, sans falaise ; le fond plat reçoit la **teinte moyenne de cette couronne** (304 cases sur 529), donc la couture ne se voit pas |

La voirie, l'eau et les ombres sont projetées à l'altitude du terrain sous
elles : un coteau les fait monter et descendre, et les ombres ne s'enfoncent
plus dans la pente.

## 12. Vérifications

| Contrôle | Résultat |
|---|---|
| `npm test` | **230 / 230** (217 avant, +13 : repère local, débord du maillage, assise sur la pente, note de relief, taille de la cour, toit évité, murs de cour, rattachement de la cour, tri groupé, clic du plus proche, canevas) |
| `npm run test:net` | **234 / 234** |
| `npm run lint` | 42 fichiers, aucun échec |
| Serveur réel, El Khroub 600 m | altimétrie 24 × 24, zoom 14 : **595,1 → 661,2 m** ; scène 3 762 faces, 1 017 ombres, 961 cases de sol ; assises de −112 m à +133 m ; SVG 563 936 o, aucune valeur invalide |
| Échantillon 800 m, H ×3 | 4 677 faces, 1 336 ombres, 529 cases, amplitude relative 75,9 m, teinte de couronne `rgb(227,224,219)` |
| Cas à cour (fabriqué) | toit évité (tracé à deux anneaux), murs de cour visibles côté caméra, trou à 40 % de l'emprise à l'écran |

El Khroub ne possède **aucune** cour intérieure dans OSM (vérifié sur
l'échantillon embarqué et par une requête Overpass directe) : le cas à cour est
donc fabriqué dans les tests et dans l'aperçu (emprises de 40 m et 120 m).

## 13. Différence voulue avec les rendus 2D

Les renderers 2D continuent de **remplir** les cours : `normalizeElements`
(`public/js/osm.mjs`) écarte toujours les membres `inner`, comportement commun
aux 35 analyses existantes. Seul le chemin 3D (lecture dédiée
`batimentsDepuisOverpass`) les évide. Modifier le jeu normalisé changerait le
tracé de toutes les planches 2D — ce n'est pas l'objet de cette étape, et le
comportement est désormais écrit noir sur blanc dans les deux fichiers.
