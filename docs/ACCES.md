# Accès : période d'essai ouverte, puis abonnements

Ce document explique **ce qui est ouvert aujourd'hui et comment rétablir les
paliers plus tard**, sans toucher aux analyses, aux rendus ni au client.

## Aujourd'hui : accès libre

Toutes les analyses (les 4 « gratuites » et les 31 Pro/Max) sont ouvertes à
tout le monde. Concrètement :

| Élément | Régime sous licence | Accès libre (aujourd'hui) |
|---|---|---|
| Analyses accessibles | 4 (voirie, zones fonctionnelles, vert & eau, tissu urbain) | **les 35** |
| Filigrane d'essai | sur les 4 gratuites | **retiré** |
| Quota par IP | une génération en vol, puis refroidissement | **aucun** |
| Code de licence | nécessaire pour Pro/Max | **inutile** |
| Badge en haut à droite | ESSAI / PRO ✓ / MAX ✓ | **LIBRE** |

Ce qui ne change pas, volontairement :

- **l'identifiant d'appareil** reste demandé : c'est le contrat de l'API, pas
  une limitation commerciale ;
- **les rayons maximaux par analyse** (`LIMITS` dans `public/js/plan-2d.mjs`)
  restent en place : ils garantissent que le plan reste juste (au-delà, la
  requête Overpass devient énorme et le dessin illisible) ;
- **les fonctions serverless Vercel** peuvent toujours être coupées par la
  plateforme : au-delà de 60 s, l'analyse se rabat sur les miroirs publics
  interrogés par le navigateur.

## L'interrupteur

Une seule variable d'environnement :

```
FM_ACCESS=open      # défaut : tout ouvert (période d'essai)
FM_ACCESS=licence   # découpage 4 gratuites / Pro / Max + quota + filigrane
```

Elle est lue **à chaque requête** : le changement prend effet au redémarrage
du serveur, sans reconstruire le code.

- Serveur Node : `FM_ACCESS=licence npm start`
- Vercel : *Settings → Environment Variables* → `FM_ACCESS` = `licence`, puis
  redéployer.

Le serveur annonce son mode dans `/api/status` (champ `access`), et le client
s'y adapte tout seul : catalogue déverrouillé, filigrane retiré, panneau
« Tarifs » remplacé par une note d'accès libre. Rien d'autre à synchroniser.

## Le jour où les abonnements reviennent

1. Poser `FM_ACCESS=licence` (une variable à changer, aucun déploiement de
   code n'est nécessaire).
2. Vérifier que les codes de démonstration fonctionnent encore :
   `cs_demo_pro`, `cs_demo_max`, `cs_demo_lifetime`.
3. Pour encaisser de vrais paiements, il reste à faire — c'est un chantier, pas
   un réglage : un moyen de paiement, la délivrance des codes, et un stockage
   partagé (Neon) pour la révocation et un quota global. Le plan est décrit
   dans `docs/VERCEL.md` (section Neon) ; `server/runtime.mjs` est le seul
   fichier à compléter pour la partie base de données.

## Où c'est implémenté

| Fichier | Rôle |
|---|---|
| `server/config.mjs` | `accessMode()` / `isOpenAccess()` — lisent `FM_ACCESS` |
| `server/api.mjs` | `begin` : branche « accès libre » (aucune licence, aucun quota), `status.access` |
| `public/js/app.js` | `S.access`, `unlocked()`, `isPaid()`, filigrane, badge, panneau |
| `test/acces.test.mjs` | les deux régimes, vérifiés hors ligne (13 cas) |
