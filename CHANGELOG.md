# Journal des versions

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) ;
versionnage [SemVer](https://semver.org/lang/fr/).

## [0.1.0] — 2026-10-11

Première version utilisable : le moteur de plan, les 35 analyses et le parcours
de licence fonctionnent de bout en bout.

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

### Modifié

- **Nom du projet : Freemap.** Le filigrane des cartes d'essai, les noms de
  fichiers exportés (`freemap-<analyse>.svg`), les identifiants internes
  (`FMEngine`, `FMCatalog`, `FMRender`), les préfixes de stockage local (`fm_`)
  et les variables d'environnement (`FM_DATA_DIR`, `FM_PUBLIC_DIR`, `FM_HOST`,
  `FM_NET`) suivent ce nom. Le module partagé `mtn-2d-plan.mjs` devient
  `public/js/plan-2d.mjs`.
- La signature envoyée à OpenStreetMap porte désormais l'adresse du dépôt et
  une adresse de contact.

### Notes

- 9 analyses sur 44 restent déclarées au catalogue sans rendu (`impl:false`,
  badge « v0.2 ») : planches composées, vent, réseau radial.
- L'enregistrement des licences vit en mémoire : un redémarrage invalide les
  jetons de session (les titres signés, eux, restent valables).

[0.1.0]: https://github.com/freemind25/freemap/releases/tag/v0.1.0
