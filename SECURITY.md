# Sécurité

## Signaler une vulnérabilité

N'ouvrez pas d'issue publique : écrivez à l'adresse indiquée dans le profil du
dépôt, ou utilisez l'onglet *Security → Report a vulnerability* de GitHub.
Comptez quelques jours pour une première réponse.

## Modèle de menace et choix assumés

Ce projet a été écrit pour comprendre et reproduire le fonctionnement d'un
service commercial. Certains choix sont volontairement simples : ils sont
documentés ici pour qu'aucun utilisateur ne les prenne pour des garanties.

### La licence est vérifiée dans le navigateur

Le titre (`ent`) est un JWT signé Ed25519, que le navigateur valide avec la clé
publique publiée par `GET /api/status`. Un utilisateur qui contrôle son
navigateur peut neutraliser cette vérification : il n'obtient alors que le
*rendu local* des analyses, jamais de données supplémentaires (les données
viennent d'API publiques d'OpenStreetMap, de la NASA et d'AWS).

En conséquence :

- le serveur ne considère une requête payante comme licenciée que si le couple
  `account`/`token` existe côté serveur — le titre seul ne suffit pas ;
- le droit d'auteur porte sur le logiciel et sur le catalogue de codes, pas sur
  le verrouillage côté client ;
- ne confiez jamais un secret au navigateur. La clé privée ne quitte pas
  `data/keys.json`.

### Le fichier de clés est critique

`data/keys.json` contient la clé privée Ed25519. Le publier ou le régénérer
invalide toutes les licences déjà émises. Il est créé en `0600`, ignoré par Git,
et doit être sauvegardé séparément du reste du déploiement.

### Le quota est en mémoire et par IP

`server/quota.mjs` limite à une génération simultanée par IP, avec 20 s de
refroidissement. L'état vit dans le processus : derrière plusieurs instances ou
un répartiteur, il faut un magasin partagé pour que la limite soit globale.
L'IP est lue dans `X-Forwarded-For` quand elle est présente : derrière un proxy,
ne faites confiance à cet en-tête que s'il est posé par le proxy lui-même.

### Le serveur n'est pas un proxy Overpass

Le point clé de l'architecture : le client envoie des identifiants d'analyse,
un rayon et un point ; le serveur reconstruit la requête avec le planificateur
partagé (`public/js/plan-2d.mjs`). Il n'existe aucune route acceptant une
requête Overpass arbitraire. Les identifiants d'analyse hors catalogue sont
refusés (`INVALID_ANALYSES`), les rayons bornés à 200-3000 m, et la fenêtre
géographique recalculée côté serveur.

### Entrées et sorties

- Corps limité à 4 Mo ; JSON illisible refusé (`BAD_JSON`).
- Identifiants d'appareil validés par expression régulière (`INVALID_DEVICE`).
- Le rendu est produit en SVG par concaténation de chaînes : les légendes
  proviennent de nos propres tables, mais les noms de lieux et les libellés OSM
  destinés à être dessinés **doivent** passer par l'échappement du moteur
  (`esc()`), car ils viennent d'une source externe.
- Les fichiers statiques sont servis depuis `public/` uniquement, après
  normalisation du chemin (aucune remontée de répertoire).
