# Déploiement sur Vercel

Le projet se déploie sur Vercel en **mode sans état** : les fonctions
serverless exposent l'API, Vercel sert `public/` en statique. Ce document dit
ce qui fonctionne, ce qui change, et ce qu'il faut configurer.

## Ce qui fonctionne en ligne

| Fonction | État |
|---|---|
| Interface, sélection du site, disposition des cartes | ✅ |
| Exemple embarqué (`?sample=1`) | ✅ |
| Les 46 analyses (dont les 8 planches Max et la couche OpenBuildingMap facultative) | ✅ |
| Recherche de lieu par nom | ✅ (`/api/util` → Nominatim) |
| Relief et climat (Terrarium, NASA POWER) | ✅ |
| Activation d’un fichier `.utlic` signé | ✅ si `FM_SIGNING_KEY` et `FM_LICENSE_PUB` sont configurées |
| Authentification étudiante OTP | ✅ code préparé; **désactivée** tant que DB/SMTP ne sont pas provisionnés |
| Accès étudiant Max (Pro inclus) | ✅ automatiquement après OTP si l’adresse est active dans la liste |
| Codes historiques | ✅ si `FM_CODES` est défini (aucun code de démo en production) |
| Quota d’analyse | ⚠️ au mieux : mémoire par instance; par IP en mode licence, par compte étudiant en régime étudiant |
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

   Conservez cette clé hors de Vercel : la perdre revient à invalider les
   attestations de session déjà émises.

2. **La clé publique de l’émetteur `.utlic` est `FM_LICENSE_PUB`.** Créez le
   coffre local chiffré avec `npm run licence:init`, puis copiez uniquement la
   valeur publique affichée dans l’environnement Vercel. La clé privée du
   coffre reste sur votre ordinateur; elle ne doit jamais être configurée sur
   Vercel ni ajoutée au dépôt. Le fichier `.utlic` est remis au titulaire.
   Voir `docs/LICENCES-PRO-MAX.md` pour le détail et les limites.

3. **Le jeton de session devient le titre lui-même.** En mode serveur, une
   activation crée une session en mémoire que le serveur peut révoquer. Sans
   stockage, il n'y a rien à consulter : le jeton renvoyé est donc le titre
   signé `{ v, t, d, x }`, que le serveur revérifie à chaque appel avec sa clé
   publique. Conséquence assumée : **une licence ne peut plus être révoquée ni
   renouvelée avant sa date d'expiration**, et le quota se limite à ce qu'une
   instance se rappelle. Une base de données (Neon, voir plus bas) lève cette
   limite.

## Authentification étudiante — préparation, non activée

Le chantier ajoute une barrière OTP contrôlée par `FM_STUDENT_AUTH=required`. Elle protège les API d’analyse et des ateliers; les adresses actives de la liste reçoivent automatiquement Max, Pro inclus. `FM_ACCESS` reste un réglage de droits/licences et ne remplace pas cette vérification d’identité.

Le code utilise PostgreSQL via `pg` et SMTP via `nodemailer`. Avant toute activation, créer une base PostgreSQL de préproduction avec connexion TLS/poolée, appliquer `db/migrations/001_student_auth.sql`, puis créer deux rôles séparés :

- `FM_AUTH_DATABASE_URL` : compte applicatif dans Vercel, sans droit d’écriture sur `whitelisted_students` ni `student_whitelist_audit`;
- `FM_AUTH_ADMIN_DATABASE_URL` : compte de la responsable, uniquement dans son environnement local pour `npm run etudiants -- add|remove|list|import`. Ne jamais configurer ce secret dans Vercel.

Pour un environnement Vercel **Preview uniquement**, ajouter aussi `FM_STUDENT_AUTH=required`, `FM_AUTH_OTP_KEY` (au moins 32 octets aléatoires encodés en base64), les paramètres SMTP `FM_AUTH_SMTP_*` et `FM_AUTH_EMAIL_FROM`. Les valeurs d’exemple détaillées figurent dans `docs/ACCES-ETUDIANTS-OTP.md` et `.env.example`. Sans les trois services requis — DB, secret OTP et SMTP — `/api/status` signale `auth.ready=false` et les API protégées répondent 503; aucune ouverture de secours n’est effectuée.

`outputDirectory: public` laisse les pages HTML, le code client et les exemples statiques téléchargeables publiquement; ils ne contiennent pas de secrets. Les contrôles de données et d’opérations sont côté API. L’écran de connexion masque l’interface pour l’expérience utilisateur, mais ne rend pas le JavaScript client confidentiel.

**État de ce chantier :** aucune base n’a été créée, aucune liste réelle importée, aucun secret SMTP/OTP configuré, aucune variable Vercel changée et aucun déploiement effectué. La première activation doit se faire sur Preview après un essai complet avec l’adresse de la responsable, puis faire l’objet d’une décision explicite avant Production.

## Mise en place

```powershell
# FM_SIGNING_KEY : uniquement si elle n’existe pas déjà. Ne la régénérez pas
# si des attestations de session ou licences sont déjà en circulation.
npm run genere-cle
vercel env add FM_SIGNING_KEY production

# Créer le coffre privé de l’émetteur .utlic sur cet ordinateur.
# Copiez la valeur FM_LICENSE_PUB publique affichée, pas le coffre privé.
npm run licence:init
vercel env add FM_LICENSE_PUB production

# Quand vous décidez d’appliquer les paliers payants :
vercel env add FM_ACCESS production   # valeur demandée : licence

# Déployer si nécessaire et vérifier le statut
vercel --prod
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
