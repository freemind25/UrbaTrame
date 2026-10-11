# Architecture

## Vue d'ensemble

```
                 ┌──────────────────────── navigateur ────────────────────────┐
                 │  public/index.html + styles.css                            │
                 │                                                            │
   OpenStreetMap │  app.js  ── orchestration, état, i18n, cartes, exports    │
   (Overpass)  ◄──┤    │                                                       │
   Nominatim    ◄──┤    ├── mtn-2d-plan.mjs   planificateur (module partagé)  │
   NASA POWER   ◄──┤    ├── renderers-core.js 11 analyses gratuites            │
   Terrarium    ◄──┤    ├── renderers-pro.js  24 analyses sous licence        │
                 │    ├── engine.js         wrap(), palettes, géométrie       │
                 │    ├── osm.mjs           normalisation OSM                 │
                 │    ├── routes.mjs        client HTTP + repli direct        │
                 │    └── persist.mjs       cache IndexedDB, préférences      │
                 └────────────────────────────┬───────────────────────────────┘
                                              │  JSON (analyse, rayon, point)
                 ┌────────────────────────────┴───────────────────────────────┐
                 │  server/index.mjs   http + routes                          │
                 │    api.mjs        contrat de l'API                         │
                 │    licence.mjs    clés Ed25519, codes, titres              │
                 │    quota.mjs      une génération en vol par IP             │
                 │    runs.mjs       sessions de génération                   │
                 │    sources/       overpass · climate · terrain             │
                 │    ────────────────────────────────►  sources externes      │
                 └────────────────────────────────────────────────────────────┘
```

## La propriété de sûreté centrale

Le serveur **n'exécute jamais une requête qu'il n'a pas lui-même écrite**.

Le client envoie `{ ids: ['massing', 'gw'], radius, lat, lon }` ; le serveur
appelle `plan()` — le même module que celui chargé par le navigateur — qui
reconstruit les requêtes OverpassQL à partir de tables internes, puis les
exécute. Aucune route n'accepte de requête Overpass arbitraire : le service ne
peut pas servir de proxy ouvert, et un utilisateur ne peut pas demander autre
chose que ce que le catalogue autorise.

Trois conséquences pratiques :

- ajouter une analyse ne demande aucune modification du serveur (ni de sa
  liste blanche) : elle se déclare dans `DEPS`, `SELECTORS` et `LIMITS` ;
- les plafonds de rayon et la fenêtre géographique sont recalculés côté serveur
  à partir du point et du rayon, jamais repris du client ;
- le quota s'applique là où le coût est réel, c'est-à-dire à l'exécution.

## Le planificateur

`public/js/mtn-2d-plan.mjs` contient les données de référence :

| Table | Rôle |
|---|---|
| `DEPS` | couches OSM nécessaires à chaque analyse (graphe orienté) |
| `LIMITS` | rayon maximal par analyse (déduit de familles de coût) |
| `SELECTORS` | sélecteurs OverpassQL par couche |
| `POI_SELECTORS` | sous-ensemble de POI propre à certaines analyses |
| `FREE_IDS`, `MAX_IDS` | paliers |

L'union des dépendances des analyses sélectionnées donne les couches à
télécharger. Ces couches sont ensuite réparties en **au plus trois lots**
(`base`, `areas`, `points`) choisis pour maximiser les chances de toucher le
cache Overpass d'un appel à l'autre ; sous 1 500 m, `base` et `areas` sont
fusionnés en une seule requête. Enfin, un lot dont la requête serait vide est
supprimé — et une analyse qui aurait dû le nourrir est écartée du rendu plutôt
que de produire une carte muette.

## Le rendu

Chaque renderer reçoit un contexte et retourne une chaîne SVG posée par
`E.wrap(titre, sous-titre, corps, légende, ctx, options)` sur une toile de
240 × 268 unités — la taille des cartes du service d'origine, reprise du
rapport.

- `engine.js` fournit la géométrie (projection, axonométrie, grilles, contours,
  diagrammes de Voronoï, régression de segments), les palettes par famille de
  rendu, le cartouche, l'échelle, la rosace et le filigrane.
- Les renderers ne calculent jamais de projection eux-mêmes : ils passent par
  les aides du moteur, ce qui garantit une échelle identique d'une carte à
  l'autre.
- Les légendes s'adaptent : le corps typographique est calculé d'après la place
  disponible, faute de quoi cinq entrées à mots longs se chevauchent.
- Aucune dépendance externe, aucune police distante, aucun appel réseau au
  moment du rendu : un SVG produit reste identique hors ligne.

## Modèle de licence

Un code active une session : le serveur renvoie `account`, `token` et un titre
`ent` signé Ed25519 contenant `{ v, t: palier, d: appareil, x: expiration }`.
Le navigateur vérifie la signature avec la clé publique publiée, ainsi que le
palier, l'appareil et la date. Le serveur, lui, ne fait jamais confiance au
titre pour autoriser une requête payante : il vérifie le couple
`account`/`token` dans ses sessions.

Ce partage est assumé : le verrouillage côté client est un confort (messages,
interface), pas une protection. Voir `SECURITY.md`.

## Persistance

- **Serveur** : `data/keys.json` (paire Ed25519, 0600). La régénérer invaliderait
  les licences déjà émises. Les sessions de génération vivent en mémoire et
  expirent après 5 minutes ; l'enregistrement des licences également (un
  redémarrage déconnecte les sessions, les titres signés restant valides).
- **Navigateur** : cache IndexedDB par texte de requête (TTL 7 jours) et
  préférences `localStorage` préfixées `mtn_`. Le cache est volontairement
  silencieux en navigation privée.

## Choix de structure

- **Pas d'étape de build.** Ce que le navigateur exécute est ce qui est dans
  `public/` : pas de bundler, pas de transpilation, pas de `node_modules`. Cela
  se paie en importations explicites et en quelques scripts classiques, mais
  cela rend le comportement observable et le dépôt vérifiable.
- **Zéro dépendance.** Le serveur tient en modules de la bibliothèque standard ;
  le décodeur PNG des tuiles d'altitude est écrit à la main, faute d'équivalent
  intégré — et il est couvert par un banc d'essai qui rejoue l'encodage inverse.
- **Les scripts classiques du noyau** (`catalog.js`, `engine.js`,
  `renderers-*.js`) s'installent sur `globalThis` : c'est ce qui permet au banc
  d'essai de les évaluer tels quels dans Node, sans transformation.
