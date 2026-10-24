# Essai d’authentification étudiante — UrbaTrame

**État : code intégré et tests locaux réussis; aucune activation ni mise en production.**

## Résultats automatisés

| Vérification | Résultat |
|---|---|
| Service OTP avec dépôt mémoire synthétique et transport e-mail factice | 9/9 tests réussis |
| API HTTP locale : parcours OTP, cookie, accès et révocation | 9/9 tests réussis |
| Configuration runtime : désactivée par défaut, configuration incomplète fermée | 3 tests réussis |
| Fonctions Vercel simulées : statut public et réponses fermées si la configuration requise manque | 2/2 tests réussis |
| Contrôles statiques UI et branchement des routes | 5/5 tests réussis |
| Suite complète du projet (`npm test`) | **622/622 réussis**, aucun échec ni test annulé; le test optionnel des sources réseau est ignoré sans `FM_NET=1` |
| Vérification syntaxique (`npm run lint`) | **161 fichiers contrôlés**, aucun échec |

Les tests ciblés d’authentification sont :

```bash
node --test test/student-access-simulation.test.mjs test/student-auth-api.test.mjs \
  test/student-auth-runtime.test.mjs test/student-auth-vercel.test.mjs test/student-auth-ui.test.mjs
```

## Ce qui est intégré

- La responsable gère la liste blanche exclusivement avec la CLI locale `npm run etudiants -- add|remove|list|import`; aucune route publique ne permet d’ajouter ou retirer une adresse.
- Réponse anti-énumération et limites de renvoi; codes OTP conservés sous HMAC, expiration et blocage après tentatives; retrait d’une adresse révoquant ses sessions.
- Après vérification, l’adresse autorisée obtient automatiquement le niveau **Max**, qui inclut Pro. Le rôle étudiant reste distinct du rôle d’administration.
- Session persistante prévue dans PostgreSQL, cookie de session `HttpOnly`, révocation serveur et quota d’analyse par compte étudiant.
- Écran de connexion partagé sur les pages principales. En régime étudiant, le client ne garde pas de jeton d’authentification dans `localStorage` et n’utilise pas le repli Overpass direct qui contournerait la garde serveur.
- API locales et fonctions Vercel protégées lorsque `FM_STUDENT_AUTH=required`. Cette option est **désactivée par défaut**. Si elle est requise sans base, secret OTP ou SMTP prêt, le statut signale l’indisponibilité et les API protégées échouent fermé; aucun retour silencieux à l’accès ouvert n’est fait.

## Limites importantes — vérifications non exécutées

Tous les essais d’authentification ont utilisé des adresses synthétiques, un dépôt mémoire et un transport e-mail simulé. Aucun compte ou fichier de liste réel n’a été consulté; aucun vrai courriel n’a été envoyé.

- **PostgreSQL : non testé en conditions réelles.** Aucun serveur ni binaire `psql`/`postgres` n’est disponible ici. La migration, les transactions, les rôles et les privilèges de séquence doivent être validés sur une base de préproduction.
- **SMTP : non testé.** La configuration et la délivrabilité d’un fournisseur de courriel restent à établir.
- **Parcours navigateur réel et appareils : non testé.** Les tests UI sont des contrôles statiques, pas un essai manuel ou automatisé de navigateur.
- **Vercel réel : non testé.** Les tests appellent des handlers simulés; aucune variable de projet n’a été modifiée et aucun déploiement n’a eu lieu.
- **Production : inchangée.** Aucune migration, import de liste, création de secret, modification de configuration ni écriture sur un service public n’a été effectuée.

## Avant l’activation

Suivre `docs/ACCES-ETUDIANTS-OTP.md` pour créer la base et ses rôles séparés, préparer les secrets et le relais e-mail, puis effectuer un essai complet sur l’environnement Vercel Preview. La CLI et ses commandes sont documentées par `npm run etudiants -- --help`. Garder `FM_STUDENT_AUTH` désactivé jusqu’à ce que ces validations soient faites; toute bascule en Production ou tout déploiement demande une autorisation explicite.
