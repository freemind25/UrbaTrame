# Journal des versions

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) ;
versionnage [SemVer](https://semver.org/lang/fr/).

## [Non publié]

### Corrigé — diagnostic de disponibilité de l'authentification étudiante

- Sonde `SELECT 1` bornée (4 s ; cache de 15 s sur succès, 3 s sur échec) avant chaque route qui touche la base : une base injoignable est désormais détectée avant toute tentative d'envoi, réponse `503` avec `Retry-After` et journal `UT_AUTH_DB_UNAVAILABLE` limité à l'étape et au code (jamais l'URL, l'identifiant ni une adresse).
- Diagnostic intégré à `GET /api/status` : test SQL réel (`SELECT 1`) au lieu de la simple présence des variables. L'étape (`dns`, `tcp`, `tls`, `auth`, …) et le code d'échec ne sont exposés qu'en aperçon (`VERCEL_ENV=preview`, champ `auth.db`), la réponse restant minimale en production. Aucune fonction serverless supplémentaire : la limite de douze de l'offre Hobby est respectée.
- Classification des échecs sans SQLSTATE : la chaîne de causes (`cause`, 4 niveaux) est parcourue et un vocabulaire fermé dérivé du message remplace le `UNKNOWN` opaque — `SASL_PASSWORD_MISSING` (mot de passe absent de `FM_AUTH_DATABASE_URL`), `SASL_CHANNEL_BINDING`, `SASL_MECHANISM`, `SASL_SIGNATURE`, `SASL_ERROR`, `AUTH_FAILED`, `CONNECTION_TERMINATED`, `CLIENT_ERROR`, `TLS_ERROR` — le repli final devenant `UNKNOWN_<classe>` (ex. `UNKNOWN_TYPEERROR`). Le message brut n'est jamais renvoyé ni journalisé.
- Documentation du piège des variables Vercel liées à une branche : elles écrasent la variable d'aperçon du même nom sans effet sur les déploiements existants, ce qui peut rendre un aperçu inopérant alors qu'un autre branche fonctionne.
- Correction du conflit `ssl`/`sslmode` : un `sslmode=` déjà présent dans `FM_AUTH_DATABASE_URL` n'est plus superposé à un objet `ssl` contradictoire (brianc/node-postgres#3355), et `enableChannelBinding` reste conditionné à `pg` ≥ 8.14.
- 18 tests dédiés ; 658/660 au total sur Windows/Node 25, les 2 échecs résiduels de `licence-ui.test.mjs` étant préexistants (chemin de travail et bits de permissions 0600) et sans rapport avec l'authentification.

### Ajouté — couche OpenBuildingMap dans UrbaTrame

- Analyse facultative d’occupation bâtie, séparée des groupes OSM/Overpass : tuiles vectorielles publiques, rendu cartographique catégorisé, catégories inconnues explicites et synthèse de la part classée.
- Aperçu local du zoom et du nombre estimé de tuiles; aucune prédiction du nombre d’objets ou de la taille téléchargée.
- Attribution OBM/GFZ et OpenStreetMap dans les cartes et exports, référence ODbL 1.0 et limites documentées. La part classée n’est pas un taux de complétude; les empreintes ne sont pas des parcelles et l’absence de données renvoyées ne prouve pas l’absence de bâtiments.
- **453 tests hors ligne** et contrôle de syntaxe sans erreur.

### Ajouté — atelier topographique Altiplan intégré à UrbaTrame

- L’atelier est une section d’UrbaTrame, accessible depuis « Atelier topo ».
- Sélection de site et couches OSM, exports DXF/SVG/PNG, coupe, modèle OBJ/STL, UTM, aperçu 3D et ombres réglables.
- Routes `/api/atelier/*` sans compte ni quota ; les informations de contact OSM sont filtrées.
- Commande `npm run atelier:exporter` pour produire ensemble les dix livrables.
- **359 tests hors ligne** et contrôle de syntaxe sans erreur.

## [0.1.1] — 2026-10-12

Exports pour la CAO, et le rapport de rétro-ingénierie qui les a motivés.

### Ajouté — exports CAO

- **Panneau « Exports CAO »** (bouton du panneau de droite) : trois onglets —
  plan topographique DXF, coupe, modèle 3D — avec aperçu avant téléchargement,
  choix des calques, de l'équidistance, de la hauteur par défaut du bâti, du
  repère (local ou **UTM WGS 84**) et de l'axe de coupe (clic sur l'aperçu).
- **Plan topographique DXF** (`public/js/exports.mjs`) : **R12/AC1009** (la
  version la plus largement lue), mètres, huit calques — `COURBES` (altitude de
  la courbe en Z), `BATI` (**hauteur du bâtiment en Z**, emprises fermées, cours
  intérieures en anneaux), `VOIRIE`, `EAU`, `VERT`, `POI`, `EMPRISE`, `TEXTE`
  (cartouche : site, altitudes, équidistance, repère, sources). Les tracés sont
  **recadrés à l'emprise** (un tracé qui sort du site est coupé à la limite), les
  noms de POI sont facultatifs et translittérés (la R12 se lit en ANSI).
- **Coupe topographique** : deux points sur l'aperçu, profil échantillonné
  (161 points par kilomètre), altitude interpolée dans la grille, bâti traversé
  détecté par changement de signe de l'écart perpendiculaire de ses murs ;
  sortie SVG (profil coté) ou DXF (`TERRAIN`, `BATI`, `AXE`, `TEXTE`).
- **Modèle 3D** OBJ et STL : maillage du relief et bâti, groupes
  `TERRAIN`/`BATI`/`TOIT`, sommets en mètres, **altitudes vraies** (l'altitude de
  référence du relief est ajoutée), triangulation à normales unitaires.
- **`tools/exporter.mjs`** : les mêmes fichiers en ligne de commande, hors
  navigateur (`--quoi`, `--avec`, `--equi`, `--hauteur`, `--geolocate`,
  `--coupe`, `--sans-sol`).
- La scène 3D expose désormais sa géométrie : `pts3` (sommets en mètres locaux)
  sur chaque face, `terrainRef` (altitude du zéro local) et `grille` — c'est ce que
  lisent les exports.
- **51 tests** (281 hors ligne) : projection UTM comparée à des valeurs de
  référence, structure du DXF relue par un lecteur minimal (sections, tables,
  entités, `EOF`, polylignes, textes), recadrage à l'emprise, équidistance,
  fermeture des anneaux et cours intérieures, cohérence du profil (longueur,
  échantillonnage, bornes d'altitude, extrémités), bâti traversé, maillage,
  triangulation et normales du STL.

### Ajouté — rapport

- **`docs/reverse-topoexport.md`** : ce que fait le service TopoExport
  (cartes vectorielles, modèles 3D, coupes), son architecture, ses jeux de
  données et leur sélection, la forme de son `POST /compute`, ses formats et
  sa grille de prix — relevé sans compte, sur des ressources publiques. Ce qui en
  a été retenu est dans les exports ci-dessus ; ce qui en a été écarté (DWG, RVT, SKP,
  IFC, LoD2, arbres « IA », comptes et quotas) est expliqué dans
  **`docs/EXPORTS.md`**.

### Notes

- Les exports sont produits par le moteur du projet, sans aucune dépendance :
  DXF, OBJ et STL sont du texte, écrit ici.
- Les fichiers ont été relus par des bibliothèques tierces (ezdxf 1.4.4,
  trimesh 5.1.1) en plus des tests : aucune erreur d'audit, aucune facette
  dégénérée.

## [0.1.0] — 2026-10-11

Première version utilisable : le moteur de plan, les 35 analyses et le parcours
de licence fonctionnent de bout en bout.

- **Fonctions Vercel durcies** : le corps déjà analysé par la plateforme
  (`req.body`) est pris en charge dans `readBody()`, le runtime partagé sort de
  `api/` (tout fichier de ce dossier est déployé comme une fonction), et le
  budget Overpass passe à 45 s sous Vercel — la fonction étant coupée à 60 s —
  pour répondre `MAP_SOURCE_UNAVAILABLE` au lieu d'expirer.

### Ajouté — vue 3D

- **Analyse « Volumes 3D »** : bâtiments extrudés, ombres portées selon l'heure
  du site, exportable en SVG/PNG comme les autres analyses.
- **Vue interactive** (bouton `3D` sur la fiche, ou `?vue3d=1`) : rotation,
  inclinaison, zoom à la molette, curseur d'heure, fiche d'un bâtiment au clic,
  fond de carte OpenStreetMap optionnel, export PNG et SVG.
- **Moteur maison** (`public/js/vue3d.js`, aucune dépendance) : position du
  soleil (éphéméride abrégée), caméra perspective avec découpage du plan proche,
  murs et toits triés par profondeur, désignation au clic, export SVG et canvas.
  Lue (cours, ombres portées, surfaces) : voir `docs/reverse-osmbuildings.md`,
  mode d'emploi dans `docs/VUE3D.md`.
- **Deux sources de bâtiments** : Overpass via une requête composée par le
  serveur (nouvelle action `buildings`, même modèle de sûreté que `begin`) et,
  en option, les tuiles d'osmbuildings.org — toutes pourvues d'une hauteur.
- 42 tests supplémentaires (217 au total, hors ligne) : course du soleil dans
  les quatre saisons, géométrie de la caméra (centre, cardinales, plan proche),
  tri des faces, ombres (longueur, côté, absence la nuit), désignation au clic,
  lecture des deux formats, requête de bâtiments.

### Ajouté — la 3D tient compte du relief et des cours

- **Les volumes se posent sur le terrain** : l'altimétrie du projet (tuiles
  Terrarium, action `terrain`, jusqu'ici réservée aux analyses « relief »,
  « courbes de niveau », « exposition ») est appliquée à la vue 3D. La grille
  est maillée en quadrilatères ombrés par la pente, prolongée au-delà de son
  emprise pour que le sol ne s'arrête net au bord du cadre ; voirie et ombres
  suivent la pente. Le zéro du dessin est l'altitude du centre du site —
  sans ce recalage, un site à 630 m placerait toute la scène à 630 m au-dessus
  de la caméra. Case *Relief* dans la vue interactive (acquise par défaut, une
  requête au premier affichage), amplitude annoncée dans la note de la planche
  (`sol 589–665 m`). `DEPS.volumes` demande désormais `buildings` **et**
  `terrain`.
- **Cours intérieures évidées** : les membres `inner` des relations OSM deviennent
  des **trous** du toit (chemin unique, règle « pair-impair »), rattachés à
  l'emprise qui les contient ; les murs de la cour sont dessinés avec la bonne
  orientation. Le centre qui décide du côté extérieur d'un mur est maintenant
  le centre de gravité de la surface (formule des lacets) : la moyenne des
  points se décalait vers le point de fermeture répété et pouvait tomber hors
  d'un anneau concave.
- **Tri par bâtiment** : les bâtiments sont groupés par classe, les groupes
  rangés du plus lointain au plus proche. Un bâtiment lointain ne passe plus
  devant le mur d'un voisin proche, et le clic rend le bâtiment le plus
  proche du curseur.
- 13 tests supplémentaires (230 au total, hors ligne) : repère local du relief,
  débord du maillage et altitude du bord, assise du bâti sur la pente, indice de
  relief dans la note, taille de la cour à l'écran, toit évité, murs de cours,
  rattachement d'une cour à la bonne emprise, lecture groupée, désignation du plus
  proche, rendu sur canvas.

### Ajouté

- **Période d'essai ouverte** (`FM_ACCESS=open`, le défaut) : toutes les
  analyses sont accessibles à tout le monde, sans licence, sans filigrane et
  sans quota. Le serveur annonce son mode dans `/api/status` (`access`) et le
  client s'y adapte seul — catalogue déverrouillé, badge « LIBRE », panneau
  « Tarifs » remplacé par une note d'accès libre, échec du serveur jamais
  bloquant (repli sur les miroirs publics dans le navigateur).
  `FM_ACCESS=licence` rétablit exactement le régime précédent (4 gratuites,
  Pro/Max sur code, quota, filigrane) : une variable, aucun code à changer.
  Voir `docs/ACCES.md`.

### Modifié

- **Repli entre miroirs Overpass** : la source cartographique publique tombe
  régulièrement (`504`). Quatre miroirs sont désormais essayés dans l'ordre
  (au lieu de deux), le dernier à avoir répondu passe en tête, le budget est
  partagé entre les essais pour rendre la main avant la coupure de 60 s de
  Vercel, et chaque échec est journalisé avec le miroir, l'erreur et la durée.
  Liste remplaçable par `FM_OVERPASS_ENDPOINTS` ; banc dédié hors ligne
  (`test/overpass.test.mjs`, 7 cas : 504, serveur muet, `remark` d'erreur,
  format de requête, repli du navigateur).

- **Exemple de carte 404 en ligne** : `.vercelignore` portait un motif `data`
  sans barre oblique initiale, qui excluait aussi `public/data/` du
  déploiement — donc le fichier d'exemple (`/data/sample-elkhroub.json`)
  renvoyait 404. Tous les motifs sont désormais ancrés à la racine, vérifiés
  avec `git check-ignore`, et deux tests interdisent le retour du défaut.

### Corrigé

- **`vercel.json` refusé au build** (`Error: Function Runtimes must have a valid
  version`) : le champ `functions.runtime` n'accepte pas `nodejs22.x` — il
  attend un paquet de runtime communautaire (`@vercel/node@…`) et se laisse vide
  pour du Node.js. La version de Node vient de `engines.node` dans
  `package.json`. Le fichier est désormais validé contre le schéma officiel de
  Vercel, et le piège est documenté dans docs/VERCEL.md.

### Ajouté

- **Moteur de rendu** — 35 analyses rendues en SVG 240 × 268 (`wrap()`), six
  palettes, cartouche, rosace, légende adaptative, filigrane en mode essai.
- **Planificateur partagé** (`public/js/plan-2d.mjs`) — graphe de
  dépendances, plafonds de rayon, sélecteurs OverpassQL, fusion des lots ;
  utilisé par le navigateur et par le serveur.
- **Serveur** — `POST /analysis/2d` (check, begin, query, end, activate,
  terrain, climate), `POST /` (géocodage, parrainage), `GET /api/status`,
  fichiers statiques de `public/`.
- **Licences** — titres signés Ed25519 liés à l'identifiant d'appareil,
  vérifiés dans le navigateur par `crypto.subtle`, quatre codes de
  démonstration, clé privée conservée dans `data/keys.json` (0600).
- **Quota** — une génération en vol par IP, puis temps de refroidissement de
  20 s, avec `429` et en-tête `Retry-After`.
- **Sources** — Overpass (deux miroirs), Nominatim, NASA POWER (5 séries sur
  3 ans), tuiles d'altitude Terrarium (zoom 14/13/12) avec décodeur PNG écrit
  à la main.
- **Interface** — quatre panneaux, catalogue groupé par palier, mini-carte,
  exports SVG/PNG, impression de planche A3, interface FR/EN, paramètres
  d'URL (`lang`, `free`, `sample`, `q`, `upgrade`).
- **Exemple embarqué** — El Khroub 600 m (élément OSM, relief, climat) :
  l'application fonctionne sans réseau.
- **Outils** — `tools/capture-sample.mjs` (recapture l'exemple depuis les
  sources réelles), `tools/render-svg.mjs` (rendu hors navigateur),
  `tools/check-syntax.mjs`, `tools/run-tests.mjs`.
- **Bancs d'essai** — 135 tests hors ligne (139 avec `test:net`) : rendu des 35 analyses et de leurs palettes,
  planificateur, licences, API HTTP, décodeur PNG, projection Mercator.

### Corrigé

Dix défauts trouvés pendant la mise au point — détail dans
[docs/JOURNAL-DEV.md](docs/JOURNAL-DEV.md) :

- les données d'un lot écrasaient celles du lot précédent à la normalisation ;
- le lot « points » partait avec une requête vide quand une analyse dépendait
  des POI sans avoir de sélecteurs propres ;
- une réponse Overpass vide mais accompagnée d'un `remark` d'erreur passait
  pour un résultat ;
- `terrain` et `climate` étaient appelés avec un identifiant d'appareil fictif
  et refusés par le serveur ;
- le cumul de précipitations était triplé (totaux journaliers sommés sur 3 ans) ;
- légendes qui se chevauchaient, rose des orientations difforme, trame
  altimétrique hors cadre, thème solaire illisible, bouton de restauration
  inopérant.

### Ajouté

- **Déploiement serverless** — trois fonctions dans `api/` (analyse, état,
  utilitaires), un `vercel.json` (dossier de sortie `public`, réécriture de
  `/analysis/2d`) et un mode de session **sans état** :
  le jeton renvoyé à l'activation est le titre signé, que le serveur revérifie
  avec sa clé publique. Permet de faire tourner l'application sans disque ni
  base, avec deux limites documentées (pas de révocation, quota par instance).
- `server/runtime.mjs` : un seul endroit décide où vit l'état (`node` ou
  `vercel`), partagé par le serveur et les fonctions.
- `FM_SIGNING_KEY` (clé de signature par variable d'environnement) et
  `FM_CODES` (catalogue de licences en JSON).
- `npm run genere-cle` : génère la paire de clés, l'écrit ou l'affiche pour la
  coller dans une variable d'environnement.
- 18 tests supplémentaires (153 hors ligne, 157 avec les sources réelles) :
  sessions sans état, jeton falsifié ou expiré, fonctions serverless appelées
  directement, en-têtes CORS, méthodes refusées.
- `docs/VERCEL.md` : ce qui fonctionne en ligne, ce qui change, mise en place,
  vérifications et chemin pour lever les limites.

### Modifié

- **Nom du projet : Freemap.** Le filigrane des cartes d'essai, les noms de
  fichiers exportés (`freemap-<analyse>.svg`), les identifiants internes
  (`FMEngine`, `FMCatalog`, `FMRender`), les préfixes de stockage local (`fm_`)
  et les variables d'environnement (`FM_DATA_DIR`, `FM_PUBLIC_DIR`, `FM_HOST`,
  `FM_NET`) suivent ce nom. Le module partagé `mtn-2d-plan.mjs` devient
  `public/js/plan-2d.mjs`.
- La signature envoyée à OpenStreetMap porte désormais l'adresse du dépôt et
  une adresse de contact.
- Fichier `LICENSE` ramené au texte MIT seul (GitHub n'identifiait pas la
  licence à cause du paragraphe ajouté à la fin) ; la note sur les licences des
  données est déplacée dans `NOTICE`.

### Notes

- 9 analyses sur 44 restent déclarées au catalogue sans rendu (`impl:false`,
  badge « v0.2 ») : planches composées, vent, réseau radial.
- L'enregistrement des licences vit en mémoire : un redémarrage invalide les
  jetons de session (les titres signés, eux, restent valables).

[0.1.1]: https://github.com/freemind25/UrbaTrame/releases/tag/v0.1.1
[0.1.0]: https://github.com/freemind25/UrbaTrame/releases/tag/v0.1.0
