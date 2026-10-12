# Déploiement sur Vercel

Le projet se déploie sur Vercel en **mode sans état** : les fonctions
serverless exposent l'API, Vercel sert `public/` en statique. Ce document dit
ce qui fonctionne, ce qui change, et ce qu'il faut configurer.

## Ce qui fonctionne en ligne

| Fonction | État |
|---|---|
| Interface, sélection du site, disposition des cartes | ✅ |
| Exemple embarqué (`?sample=1`) | ✅ |
| Les 35 analyses | ✅ |
| Recherche de lieu par nom | ✅ (`/api/util` → Nominatim) |
| Relief et climat (Terrarium, NASA POWER) | ✅ |
| Activation d'un code de licence | ✅ si `FM_SIGNING_KEY` est définie |
| Quota par IP | ⚠️ au mieux : en mémoire, donc une limite par instance |
| Révocation d'une licence | ❌ impossible avant expiration |
| Journal des générations | ❌ aucun stockage |

## Pourquoi ces différences

Vercel n'offre ni disque durable ni état partagé entre instances. Le projet
s'adapte de deux façons, sans modifier le code métier :

1. **La clé de signature vit dans l'environnement.** Au lieu de lire
   `data/keys.json`, le mode Vercel lit la variable `FM_SIGNING_KEY`
   (base64 d'une clé JWK Ed25519). Elle se génère avec :

   ```bash
   npm run genere-cle
   ```

   Puis, sur Vercel : *Project → Settings → Environment Variables* →
   `FM_SIGNING_KEY` = la valeur affichée, pour l'environnement *Production*.
   Ou en ligne de commande : `vercel env add FM_SIGNING_KEY production`.

   **Sans cette variable**, l'application reste utilisable : elle tourne en
   essai gratuit et l'activation d'un code répond `NO_SIGNING_KEY`. Rien ne
   plante, mais les analyses sous licence restent fermées.

   Conservez cette clé hors de Vercel : la perdre revient à invalider toutes
   les licences délivrées.

2. **Le jeton de session devient le titre lui-même.** En mode serveur, une
   activation crée une session en mémoire que le serveur peut révoquer. Sans
   stockage, il n'y a rien à consulter : le jeton renvoyé est donc le titre
   signé `{ v, t, d, x }`, que le serveur revérifie à chaque appel avec sa clé
   publique. Conséquence assumée : **une licence ne peut plus être révoquée ni
   renouvelée avant sa date d'expiration**, et le quota se limite à ce qu'une
   instance se rappelle. Une base de données (Neon, voir plus bas) lève cette
   limite.

## Mise en place

```bash
# 1. Générer la clé et la poser dans l'environnement Vercel
npm run genere-cle
vercel env add FM_SIGNING_KEY production

# 2. Déployer (la liaison GitHub déploie déjà à chaque push sur main)
vercel --prod          # déploiement manuel, si besoin

# 3. Vérifier
curl https://<votre-domaine>/api/status
```

`vercel.json` déclare l'essentiel :

- `outputDirectory: public` — Vercel sert le dossier `public/` tel quel ;
- deux réécritures : `/analysis/2d` → `/api/analysis/2d` (le client garde le
  contrat d'origine) et `/api/util` ;
- `maxDuration: 60` et `memory: 512` pour les fonctions (une requête Overpass
  dépasse facilement les 10 secondes accordées par défaut).

### Piège : ancrer les motifs de `.vercelignore`

`.vercelignore` suit la syntaxe de `.gitignore` : un dossier nommé sans barre
oblique initiale est exclu **à n'importe quelle profondeur**. Le motif `data`
excluait donc aussi `public/data/`, et l'exemple de carte répondait 404 en
ligne (`/data/sample-elkhroub.json`). Tous les motifs de dossier sont désormais
ancrés (`/data`, `/docs`, `/test`, `/tools`…), la règle est vérifiée avec
`git check-ignore` et gardée par deux tests dans `test/vercel.test.mjs`.

Sur les 77 fichiers suivis par git, 38 partent chez Vercel : `public/` au
complet, `api/`, `server/`, `package.json`, et les fichiers de dépôt utiles.

### Piège : ne pas renseigner `runtime` dans `functions`

Un déploiement a échoué avec :

```
Error: Function Runtimes must have a valid version, for example `now-php@1.0.0`.
```

Cause : `functions.runtime` n'accepte pas un identifiant de plateforme du type
`nodejs22.x`. D'après le schéma officiel, ce champ attend **le nom d'un paquet
npm de runtime avec sa version** (`@vercel/node@3.0.0`) et sert aux runtimes
communautaires : pour du Node.js, on le laisse vide.

La version de Node.js se choisit ailleurs :

1. `engines.node` dans `package.json` — c'est ce que fait ce dépôt (`>=20.11`
   se résout sur la dernière version disponible, 24.x ; nos tests couvrent
   Node 20, 22 et 24) ;
2. à défaut, *Project Settings → Build and Deployment → Node.js Version*.

`vercel.json` est validé contre le schéma officiel
(`https://openapi.vercel.sh/vercel.json`) : `functions` n'y contient que
`maxDuration` et `memory`.

Le client, lui, poste désormais ses utilitaires sur `/api/util` : sur Vercel,
`/` doit rester l'interface, alors que le serveur Node accepte les deux.

## Deux pièges de la plateforme, déjà traités

**Le corps des requêtes arrive parfois déjà analysé.** Le runtime Node de Vercel
(@vercel/node) fournit `req.body` en objet et le flux brut n'est pas toujours
relisible. `readBody()` (server/http.mjs) utilise donc `req.body` quand il est
présent, et retombe sur la lecture du flux sinon : le même code sert le serveur
Node et les fonctions, sans branche spécifique ailleurs.

**Tout fichier de `api/` est déployé comme une fonction.** Un module partagé
placé là (`api/_lib/runtime.mjs`) aurait été traité comme un gestionnaire sans
export par défaut. Le runtime des fonctions vit donc dans
`server/vercel.mjs`, hors de `api/`.

**Budget Overpass réduit.** Une fonction Vercel est interrompue à 60 s (offre
gratuite). Le budget Overpass passe donc de 60 s à 45 s dès que la variable
d'environnement `VERCEL` est présente, pour répondre proprement
`MAP_SOURCE_UNAVAILABLE` plutôt que d'être coupée en plein vol. Réglable par
`FM_OVERPASS_TIMEOUT`.

## La source cartographique peut tomber (message « Source cartographique injoignable »)

C'est la panne la plus probable : les instances publiques d'Overpass renvoient
régulièrement `504` quand elles sont surchargées. Depuis des fonctions Vercel,
le risque est plus élevé qu'en local, car les IP de sortie sont **mutualisées**
entre tous les utilisateurs de la plateforme, et Overpass limite par IP.

Mesures en place (`server/config.mjs` + `server/sources/overpass.mjs`) :

- **quatre miroirs** au lieu de deux, essayés dans l'ordre :
  `overpass-api.de`, `overpass.osm.ch`, `overpass.kumi.systems`,
  `maps.mail.ru` ; la liste se remplace sans toucher au code :
  `FM_OVERPASS_ENDPOINTS=url1,url2` ;
- **budget partagé** : chaque miroir restant garde une part (4 s) du temps
  disponible, un échec rapide (504 en 1 s) laisse donc le temps plein (20 s)
  aux suivants, et on rend `MAP_SOURCE_UNAVAILABLE` avant la coupure de 60 s
  de la plateforme plutôt que d'être interrompu ;
- **mémoire du dernier miroir qui a répondu** : il passe en tête à la requête
  suivante (une panne d'instance dure des heures, inutile de la repayer) ;
- **repli du navigateur** : si le serveur échoue tout de même, le client
  interroge les mêmes miroirs en direct (`public/js/routes.mjs`), depuis l'IP
  de l'utilisateur — souvent épargnée quand celle de Vercel est limitée.

Ce qui n'est **pas** fait, volontairement : aucune mise en cache de résultats
OSM côté serveur (les données OpenStreetMap doivent rester fraîches) et aucun
autre service de repli (Vector tiles, etc.) — hors périmètre.

## Ce qui ne change pas

Le planificateur reste dans `public/js/plan-2d.mjs`, partagé par le navigateur
et le serveur : le serveur, même serverless, n'exécute que les requêtes qu'il a
planifiées à partir d'un identifiant d'analyse, d'un rayon et d'un point.
Aucune route n'accepte de requête Overpass arbitraire.

## Vérifier un déploiement

```bash
curl -s https://<domaine>/api/status | head -c 200        # clé publique + paliers
curl -s -o /dev/null -w '%{http_code}\n' https://<domaine>/   # interface
curl -s -X POST https://<domaine>/analysis/2d \
  -H 'Content-Type: application/json' \
  -d '{"action":"check","device":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"}'
```

Le troisième appel doit renvoyer `{"ok":true,"tier":"free",...,"pub":"…"}`. Si
`pub` est vide, la clé d'environnement est absente.

## Où en vient la limite du mode sans état

Le mode Vercel convient à une démonstration ou à un site vitrine : l'application
est complète, mais un code partagé fonctionne sur plusieurs appareils et un
quota réel n'est pas tenable. Dès qu'il faut vendre des licences, ajouter une
base :

| Besoin | Ce qu'il faut |
|---|---|
| Licences révocables, quota global, journal d'usage | une base (Neon Postgres) et un mode `database` dans `server/runtime.mjs` |
| Sessions partagées entre instances | idem |
| Statistiques d'utilisation | une table `generations` |

Le point d'insertion est unique : `server/runtime.mjs` décide où vit l'état, et
`server/licence.mjs` accepte déjà deux modes de session. Ajouter `database` ne
demande pas de toucher aux renderers, à l'API ni au client.
