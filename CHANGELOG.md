# Journal des versions

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) ;
versionnage [SemVer](https://semver.org/lang/fr/).

## [0.1.0] — 2026-10-11

Première version utilisable : le moteur de plan, les 35 analyses et le parcours
de licence fonctionnent de bout en bout.

- **Fonctions Vercel durcies** : le corps déjà analysé par la plateforme
  (`req.body`) est pris en charge dans `readBody()`, le runtime partagé sort de
  `api/` (tout fichier de ce dossier est déployé comme une fonction), et le
  budget Overpass passe à 45 s sous Vercel — la fonction étant coupée à 60 s —
  pour répondre `MAP_SOURCE_UNAVAILABLE` au lieu d'expirer.

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
  déploiement — donc le fichier d'exemple (`/data/sample-elkhroub.json`
  renvoyait 404). Tous les motifs sont désormais ancrés à la racine, vérifiés
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
- **Bancs d’essai** — 135 tests hors ligne (139 avec `test:net`) : rendu des 35 analyses et de leurs palettes,
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

[0.1.0]: https://github.com/freemind25/freemap/releases/tag/v0.1.0
