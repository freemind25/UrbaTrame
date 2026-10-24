# Accès et licences UrbaTrame

Ce document distingue l’accès libre par défaut, les droits Pro/Max, les titres `.utlic` et la nouvelle barrière d’authentification universitaire. Les licences ne déclenchent aucun paiement; l’authentification étudiante est désactivée par défaut tant que la base et le courrier ne sont pas configurés.

## Mode d’accès actuel : libre

Toutes les analyses sont ouvertes à tout le monde. Concrètement :

| Élément | Régime sous licence | Accès libre actuel |
|---|---|---|
| Analyses accessibles | 5 gratuites, puis Pro/Max | **les 46** |
| Filigrane d’essai | selon le palier | **retiré** |
| Quota par IP | génération licenciée limitée | **aucun quota commercial** |
| Code ou fichier de licence | selon le palier | **inutile pour utiliser les analyses** |
| Connexion universitaire | seulement si `FM_STUDENT_AUTH=required` | **désactivée par défaut** |
| Badge | ESSAI / PRO / MAX | **LIBRE** |

Ce qui ne change pas, volontairement :

- **l’identifiant d’appareil** reste demandé : c’est le contrat de l’API, pas une limitation commerciale;
- **les rayons maximaux propres à chaque analyse** (`LIMITS` dans `public/js/plan-2d.mjs`) restent en place : ce sont des limites techniques de calcul et de taille de requête, non des plafonds commerciaux;
- les délais et quotas techniques de la plateforme ou des services cartographiques restent applicables.

## Interrupteur d’accès

Une variable d’environnement contrôle l’application des paliers :

```text
FM_ACCESS=open      # défaut : tout ouvert
FM_ACCESS=licence   # 5 analyses gratuites, Pro/Max contrôlés, quota et filigrane
```

- Serveur Node : `FM_ACCESS=licence npm start`.
- Vercel : *Project → Settings → Environment Variables* → `FM_ACCESS=licence`, puis redéployer.

Aucun changement de ce paramètre ni déploiement Vercel n’a été fait lors de la préparation du générateur. Tant que le mode reste `open`, importer une licence est possible, mais le badge reste « LIBRE » et les analyses sont ouvertes **si l’authentification universitaire est désactivée**.

## Barrière universitaire par liste blanche + OTP

`FM_STUDENT_AUTH=required` est un contrôle d’identité distinct de `FM_ACCESS`. Il protège les API d’analyse et des ateliers. Une adresse active de `whitelisted_students`, vérifiée par OTP, reçoit automatiquement le niveau **Max (Pro inclus)**; aucun `.utlic` individuel n’est requis. La liste est administrée uniquement par l’outil local de la responsable.

La barrière est **désactivée par défaut**. Elle ne doit être activée qu’après configuration d’une base PostgreSQL et d’un relais SMTP en préproduction. Sans configuration requise, les API protégées échouent fermées en 503. Le HTML et les ressources statiques restent accessibles sur Vercel; les opérations serveur sont protégées. Voir [`ACCES-ETUDIANTS-OTP.md`](ACCES-ETUDIANTS-OTP.md) pour le schéma, les rôles de base et les étapes de préparation.

## Activation par fichier signé `.utlic`

Lorsque l’authentification universitaire est désactivée, le panneau Tarifs permet d’importer un fichier `.utlic`. Le navigateur vérifie localement sa signature Ed25519, le produit, le palier, l’identifiant et les dates. Pour les analyses payantes, le serveur vérifie à nouveau le titre et renvoie une attestation liée à l’appareil. Le fichier de licence ne contient aucune donnée de site ou de projet. En régime étudiant, le panneau indique que Max (Pro inclus) est fourni automatiquement après connexion.

Le nouveau générateur privé et la matrice détaillée des droits sont décrits dans [`LICENCES-PRO-MAX.md`](LICENCES-PRO-MAX.md). Il faut configurer `FM_LICENSE_PUB` côté serveur avant que l’import puisse aboutir. `FM_SIGNING_KEY`, utilisée pour signer les sessions, est une autre clé privée : ne pas la confondre, l’exposer ou la régénérer si des licences sont déjà en circulation.

Les titres `.utlic` n’ont toujours pas de registre central : un fichier `.utlic` n’est pas révocable immédiatement et n’a pas de limite d’appareils. Le nouveau schéma de comptes étudiants est préparé, mais aucune base n’est provisionnée ni configurée. Les fichiers `.utlic` restent indépendants de l’accès étudiant.

## Codes historiques

Le catalogue `FM_CODES` reste accepté pour compatibilité. Les codes de démonstration intégrés au code ne sont disponibles qu’en développement local; ils ne sont pas chargés par défaut en production ou sur Vercel. Le statut public `/api/status` ne révèle jamais le catalogue des codes.

## Paiements et offres

Aucun paiement réel, prestataire de paiement, compte client ou abonnement n’est branché. Les durées se choisissent lors de l’émission d’un fichier (`--days N` ou `--lifetime`); les prix et conditions commerciales ne sont pas définis par le générateur. La définition effective des analyses de chaque palier est documentée dans [`LICENCES-PRO-MAX.md`](LICENCES-PRO-MAX.md).

## Où c’est implémenté

| Fichier | Rôle |
|---|---|
| `server/config.mjs` | `accessMode()` / `isOpenAccess()` |
| `server/licence.mjs` | catalogue historique, émission des attestations de session et activation `.utlic` |
| `server/licence-token.mjs` | format et vérification des licences signées |
| `server/api.mjs` | vérification des droits d’analyse et statut public sans liste de codes |
| `tools/licence-manager.mjs` | coffre local chiffré et émission des fichiers `.utlic` |
| `public/js/app.js` / `public/js/licence-client.mjs` | statut du palier, importation, vérification WebCrypto et restauration locale |
| `server/student-auth.mjs` / `server/student-auth-postgres.mjs` | OTP, session, accès Max et stockage PostgreSQL |
| `server/student-auth-http.mjs` / `public/js/student-auth-ui.mjs` | cookie de session, garde API et écran de connexion |
| `db/migrations/001_student_auth.sql` / `tools/student-whitelist.mjs` | schéma de comptes et gestion locale de la liste |
| `test/student-auth-*.test.mjs` | tests unitaires, HTTP et de configuration sans données réelles |
