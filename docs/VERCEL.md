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
- runtime `nodejs22.x` et `maxDuration: 60` pour les fonctions (une requête
  Overpass peut dépasser les 10 secondes par défaut).

Le client, lui, poste désormais ses utilitaires sur `/api/util` : sur Vercel,
`/` doit rester l'interface, alors que le serveur Node accepte les deux.

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
