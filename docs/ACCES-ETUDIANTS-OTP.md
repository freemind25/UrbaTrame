# Accès étudiant — liste blanche, OTP et niveau Max

## Règle métier

- La liste `whitelisted_students` est établie et modifiée **uniquement par la responsable** au moyen de l’outil local `tools/student-whitelist.mjs`. Aucune route publique de l’application ne permet de la modifier.
- L’adresse doit être syntaxiquement valide, finir exactement par `@univ-constantine3.dz` et figurer comme active dans la liste. Le format de l’adresse seul ne confère aucun accès.
- Lors de la première vérification réussie par OTP, le compte étudiant est créé avec le niveau **Max**, qui inclut **Pro**. Il n’y a pas de fichier `.utlic` individuel à distribuer aux étudiants.
- Le retrait d’une adresse désactive le compte, invalide les OTP en attente et révoque les sessions.

## Protections implémentées

- OTP numérique aléatoire à 6 chiffres, valable 10 minutes, à usage unique, au plus 5 essais.
- Codes persistés sous HMAC avec un secret serveur (`FM_AUTH_OTP_KEY`), jamais en clair; le jeton de session n’est persisté que sous forme de SHA-256.
- Même réponse visible pour les adresses autorisées et non autorisées.
- Délai de renvoi de 60 secondes, au plus 3 envois par heure et par adresse et 20 demandes par heure et par IP (IP conservée sous forme HMAC).
- Session de 8 heures, cookie `HttpOnly`, `SameSite=Lax`, `Secure` sur HTTPS; aucun jeton de session dans `localStorage` ou la réponse JSON.
- API de l’analyse urbaine et API des ateliers intégrés vérifient la session côté serveur. Le quota de génération est par compte étudiant, et non par adresse IP partagée du campus.
- `FM_STUDENT_AUTH=required` ferme les routes étudiant si la base, le secret OTP ou l’envoi SMTP ne sont pas configurés. Le mode étudiant est **désactivé par défaut** (`off`).
- L’accès du propriétaire est séparé : `FM_OWNER_AUTH=required` active une connexion par mot de passe seul sur `POST /api/auth/session`. Le serveur compare un vérificateur scrypt (`FM_OWNER_PASSWORD_HASH`), jamais le mot de passe en clair; la session admin signée utilise un cookie distinct, `HttpOnly`, `SameSite=Strict`, de 8 heures. Aucun e-mail ni OTP étudiant n’est demandé au propriétaire; les étudiants restent sur le parcours OTP et leur rôle reste distinct de `admin`.
- Le formulaire propriétaire n’est affiché que si sa configuration est prête. En cas d’échec, aucune session n’est créée. Cinq erreurs par IP et par fenêtre de 15 minutes déclenchent un blocage temporaire; sur Vercel cette limitation est en mémoire d’instance (elle n’est pas globale/persistante). Choisir un mot de passe unique et long (au moins 16 caractères), et configurer les variables d’accès propriétaire **Preview seulement** si la Production doit rester inchangée.

## Base de données et séparation des rôles

Le schéma se trouve dans `db/migrations/001_student_auth.sql` (PostgreSQL 14+ recommandé). Il crée la liste, les comptes, les défis OTP, les événements de limitation, les sessions et l’audit de gestion de liste.

Utiliser deux connexions PostgreSQL distinctes :

1. `FM_AUTH_DATABASE_URL`, rôle applicatif installé dans Vercel : lecture de `whitelisted_students`; lecture/écriture des tables de compte, OTP, événements et sessions. **Aucun droit INSERT/UPDATE/DELETE sur `whitelisted_students` ou `student_whitelist_audit`.**
2. `FM_AUTH_ADMIN_DATABASE_URL`, rôle de gestion utilisé uniquement dans le terminal local de la responsable : droits de gestion de la liste et d’audit. Ne jamais le placer dans les variables Vercel, dans `.env.example`, dans le code ou dans une conversation.

Après création des rôles par le fournisseur PostgreSQL, attribuer les privilèges au rôle applicatif (adapter les noms des rôles à la base) :

```sql
GRANT USAGE ON SCHEMA public TO urbatrame_app;
GRANT SELECT ON whitelisted_students TO urbatrame_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON otp_verifications TO urbatrame_app;
GRANT SELECT, INSERT, DELETE ON otp_send_events TO urbatrame_app;
GRANT USAGE, SELECT ON SEQUENCE otp_send_events_id_seq TO urbatrame_app;
GRANT SELECT, INSERT, UPDATE ON student_users TO urbatrame_app;
GRANT SELECT, INSERT, UPDATE ON student_sessions TO urbatrame_app;
```

Le rôle administrateur, conservé hors de Vercel, doit pouvoir gérer `whitelisted_students`, écrire `student_whitelist_audit` et désactiver/révoquer les comptes, OTP et sessions lors d’un retrait. Exemple de droits supplémentaires (adapter le nom du rôle) :

```sql
GRANT USAGE ON SCHEMA public TO urbatrame_admin;
GRANT SELECT, INSERT, UPDATE ON whitelisted_students TO urbatrame_admin;
GRANT SELECT, UPDATE ON student_users, otp_verifications, student_sessions TO urbatrame_admin;
GRANT INSERT ON student_whitelist_audit TO urbatrame_admin;
GRANT USAGE, SELECT ON SEQUENCE student_whitelist_audit_id_seq TO urbatrame_admin;
```

Ne pas utiliser le rôle propriétaire/superutilisateur de la base pour les requêtes normales de l’application. Les verrous de ligne (`FOR SHARE`, `FOR UPDATE`, `LOCK TABLE … IN SHARE MODE`) exigent eux un privilège d’écriture sur la table visée : c’est pourquoi le code se contente d’un `SELECT` simple sur `whitelisted_students`, la sérialisation étant assurée par les verrous advisory par adresse et par IP.

## Gestion privée de la liste

Les commandes nécessitent `FM_AUTH_ADMIN_DATABASE_URL` dans l’environnement local. Exemples PowerShell :

```powershell
$env:FM_AUTH_ADMIN_DATABASE_URL = 'CHAÎNE_DE_CONNEXION_ADMINISTRATEUR'
npm run etudiants -- add 202600000001@univ-constantine3.dz
npm run etudiants -- list
npm run etudiants -- remove 202600000001@univ-constantine3.dz
npm run etudiants -- import 'C:\chemin\liste.csv'
```

L’import lit la première colonne d’un fichier texte/CSV, ajoute ou réactive les adresses valides et **ne retire jamais** les adresses qui ne figurent pas dans le fichier. Le compte admin n’est pas une fonction de l’interface étudiante.

## Variables serveur

- `FM_STUDENT_AUTH=required` active la barrière étudiante; garder `off` hors de l’environnement où elle doit s’appliquer.
- `FM_OWNER_AUTH=required` active en option l’accès propriétaire/admin par mot de passe seul. À définir **Preview uniquement** pour préserver Production.
- `FM_OWNER_PASSWORD_HASH` : vérificateur au format `scrypt$16384$8$1$<salt-base64url>$<hash-base64url>`, jamais le mot de passe. Pour en créer un depuis un fichier privé d’une seule ligne (minimum 16 caractères), utiliser `node tools/owner-password-hash.mjs <fichier-mot-de-passe> <fichier-verificateur>`; le script n’affiche pas le mot de passe et refuse d’écraser sa sortie. Conserver/supprimer les fichiers localement avec soin et ne commiter ni l’entrée ni le vérificateur.
- L’accès propriétaire réutilise `FM_AUTH_OTP_KEY` pour signer ses cookies (séparation de domaine HMAC); aucun nouveau secret de session n’est nécessaire.
- `FM_AUTH_DATABASE_URL` : URL PostgreSQL du rôle applicatif.
- `FM_AUTH_OTP_KEY` : secret aléatoire d’au moins 32 octets, encodé en Base64. Génération locale possible : `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`.
- `FM_AUTH_DB_SSL=true` par défaut. Pour une base de développement strictement locale sans TLS seulement, `FM_AUTH_DB_SSL=false`.
- `FM_AUTH_SMTP_HOST`, `FM_AUTH_SMTP_PORT`, `FM_AUTH_SMTP_SECURE`, `FM_AUTH_SMTP_USER`, `FM_AUTH_SMTP_PASSWORD`, `FM_AUTH_EMAIL_FROM` : paramètres du relais SMTP institutionnel ou du fournisseur choisi. Le compte expéditeur doit être autorisé par ce fournisseur; configurer SPF/DKIM/DMARC selon ses instructions.

Aucun fournisseur d’e-mail n’est imposé par le code : SMTP permet de choisir après vérification de la délivrabilité vers les boîtes étudiantes, des tarifs/quotas et des conditions de traitement/rétention. Les identifiants SMTP et chaînes PostgreSQL sont des secrets et ne doivent pas être partagés. Aucun message n’est envoyé si la configuration SMTP est absente.

## Diagnostic de disponibilité

La présence des variables ne prouve pas qu'une connexion aboutit : `ready` ne teste que la configuration. Trois dispositifs complémentaires permettent d'observer l'état réel :

- **Sonde SELECT 1** : chaque route qui touche la base (`request-otp`, `verify-otp`, `session`, les actions protégées) vérifie d'abord la disponibilité avec un `SELECT 1` borné à 4 s, dont le résultat est mis en cache 15 s en cas de succès et 3 s en cas d'échec. Si la base est injoignable, la réponse est `503 STUDENT_AUTH_UNAVAILABLE` avec l'en-tête `Retry-After`, **avant** toute tentative d'envoi.
- **Diagnostic dans `GET /api/status`** : en aperçu (`VERCEL_ENV=preview`), le champ `auth.db` expose l'étape et le code du dernier `SELECT 1` — jamais l'URL, l'identifiant ou le mot de passe :

  ```json
  { "auth": { "required": true, "ready": true,
    "db": { "ok": false, "latencyMs": 842, "stage": "auth", "code": "28P01" } } }
  ```

  En production, `auth` reste minimal (`required`, `ready`) : aucune sonde n'est exécutée et l'échec n'est signalé que par le code HTTP des routes concernées. Le diagnostic est intégré à une route existante plutôt qu'à sa propre fonction : l'offre Hobby limite le déploiement à douze fonctions serverless.
- **Journalisation** : les échecs sont tracés sans donnée personnelle ni secret — `UT_AUTH_DB_UNAVAILABLE <étape> <code> <durée_ms>` à la sonde, `UT_AUTH_REQUEST_OTP_FAILED <étape> <code>` sur une erreur levée pendant le traitement.

Lecture de l'étape :

| Étape | Signification | Piste typique |
| --- | --- | --- |
| `dns` | hôte introuvable | `ENOTFOUND` : hostname de l'endpoint renommé ou supprimé, faute de frappe |
| `tcp` | connexion refusée ou expirée | port du pooler incorrect, endpoint suspendu, `CONNECT_TIMEOUT` |
| `tls` | échec du certificat/TLS | `sslmode` contradictoire avec l'objet `ssl` du code |
| `auth` | refus d'authentification | `28P01` : mot de passe absent/invalide, rôle ou `channel_binding` refusé |
| `privilege` | droit SQL manquant | `42501` : le rôle n'a pas le droit exigé — ex. `FOR SHARE` sur `whitelisted_students`, qui exige un privilège d'écriture et dont le code se passe (les verrous advisory par email/IP sérialisent déjà) |
| `database` | base inexistante | `3D000` : nom de base incorrect |
| `capacity` | connectivité saturée | `53300` : trop de connexions pour le pool |
| `connection` | protocole cassé | `08P01` : message de protocole invalide (typiquement sur un port de pooler) |
| `query` | autre erreur SQL | voir le code renvoyé |

## Ce qui reste à faire avant un essai réel

1. Choisir et créer une base PostgreSQL de **préproduction**, puis appliquer la migration.
2. Créer les rôles DB distincts et vérifier leurs droits effectifs.
3. Choisir un relais SMTP et configurer les secrets uniquement dans un environnement de préproduction.
4. Confirmer avec l’Université le domaine exact et la provenance/l’autorisation d’utilisation de la liste. Importer uniquement votre liste, par l’outil privé.
5. D’abord tester avec votre propre adresse universitaire; ne pas activer les inscriptions étudiantes avant validation de bout en bout et accord pour la liste réelle.
6. Après les tests, définir les variables de préproduction. **Aucun réglage Vercel, base réelle, liste étudiante, envoi réel ou déploiement n’a été modifié par ce chantier.**

Le HTML, les scripts et les fichiers d’exemple statiques restent téléchargeables publiquement sur l’hébergement statique; ils ne contiennent pas de secrets. Les actions et données de service fournies par les API sont protégées côté serveur. Si l’objectif est de cacher aussi le code source ou les exemples statiques, il faudra une barrière supplémentaire au niveau de l’hébergement, sachant que le code du navigateur ne peut jamais être rendu secret.
