# Contribuer

Merci de l'intérêt porté au projet. Ce dépôt est un clone d'étude : le code est
le nôtre, les données viennent d'OpenStreetMap, de la NASA et d'AWS.

## Mise en route

```bash
node --version      # 20.11 ou plus récent, c'est tout : aucune dépendance npm
npm test            # 135 tests, tous hors ligne
npm start           # http://localhost:4173
```

`npm run test:net` ajoute les tests qui interrogent réellement Overpass,
Nominatim, NASA POWER et Terrarium (à lancer avant une livraison).

## Publier votre propre copie du projet

Le dépôt contient des adresses provisoires (`CHANGER-MOI`) tant qu'il n'a pas
de compte GitHub de destination. Pour le personnaliser :

```bash
npm run personnaliser -- --etat                                   # ce qui reste à compléter
npm run personnaliser -- --compte <pseudo> --contact <adresse>     # écrit les adresses,
                                                                   # révèle le badge de CI
                                                                   # et la signature OSM
```

L'outil met à jour `package.json`, `README.md`, `CHANGELOG.md`,
`.github/ISSUE_TEMPLATE/config.yml` et la signature de `server/config.mjs`,
puis affiche les commandes de publication. Il ne touche à aucun autre fichier ;
`--nom` permet de choisir un autre nom de dépôt que `freemap`.

Le dépôt distant doit ensuite exister et être **vide** (sans README, sans
licence, sans `.gitignore`) :

```bash
bash tools/publier.sh --dry-run   # montre ce qui sera fait
bash tools/publier.sh             # SSH, clé déjà configurée
bash tools/publier.sh --https     # HTTPS, jeton d'accès personnel
```

Le script lit l'adresse du dépôt dans `package.json`, refuse de s'exécuter si
la personnalisation n'a pas été faite ou si des modifications ne sont pas
enregistrées, puis pousse la branche `main`. L'intégration continue se déclenche
au premier envoi : le badge du README passe au vert en quelques minutes.

## Conventions

- **Aucune étape de build.** Ce que le navigateur exécute est ce qui est dans
  `public/`. Pas de transpilation, pas de bundler, pas de dépendance runtime :
  cela fait partie du cahier des charges (l'application doit rester lisible et
  vérifiable).
- **JavaScript standard**, modules ES pour tout ce qui est partagé avec le
  serveur (`.mjs`), scripts classiques pour le noyau de rendu (`.js`, évaluable
  tel quel dans le navigateur comme dans Node).
- **Commentaires en français**, expliquant le *pourquoi* plutôt que le *quoi*.
- **Deux langues dans l'interface** : toute chaîne visible passe par les paires
  FR/EN (`L(ctx, 'fr', 'en')` côté rendu, `data-fr`/`data-en` côté HTML).
- Pas de tiret cadratin dans les textes livrés.

## Ajouter une analyse

1. `public/js/catalog.js` — ajouter l'entrée (identifiant, noms FR/EN,
   sous-titre, étiquette, palier, groupe). Tant que le rendu n'existe pas,
   `impl: false`.
2. `public/js/plan-2d.mjs` — déclarer ses couches dans `DEPS` (le plafond de
   rayon est déduit automatiquement ; resserrer la liste `LIMITS` si besoin) et
   ses sélecteurs OverpassQL dans `SELECTORS`, ou dans `POI_SELECTORS` s'il
   s'agit d'un sous-ensemble de points d'intérêt.
3. `public/js/renderers-core.js` (accès gratuit) ou `renderers-pro.js`
   (payant) — écrire le renderer, appelé avec `(ctx, scenery)` et rendu par
   `E.wrap(title, subtitle, body, legend, ctx, options)`.
4. `test/renderers.test.mjs` — rien à faire : le banc d'essai parcourt le
   catalogue et exige un SVG valide, sans `NaN`, filigrané en essai.
5. `docs/ARCHITECTURE.md` — si l'analyse introduit une famille de rendu
   nouvelle, la documenter.

Attention aux pièges connus : `E.wpts()` ne prend qu'un argument ; un axe
`z` négatif monte (l'axonométrie inverse l'axe écran) ; une palette sombre non
déclarée dans `SCH.<famille>[n].bg` produit un cartouche illisible.

## Avant de proposer une modification

```bash
npm run lint        # syntaxe de tous les fichiers JS
npm test            # bancs d'essai hors ligne
npm run test:net    # + sources réelles, si le réseau est disponible
```

Si le changement touche au rendu, joignez une capture : `npm run svg -- --png`
écrit les planches dans `test/out/`.

## Signaler un défaut

Utilisez le gabarit d'issue. Indiquez l'analyse concernée, le lieu et le rayon
(par exemple « massing, El Khroub, 600 m »), le palier, et joignez le SVG
exporté quand c'est un problème de rendu.

## Licence des contributions

En proposant une modification, vous acceptez qu'elle soit publiée sous licence
MIT (voir `LICENSE`).
