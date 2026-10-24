# Licences UrbaTrame — paliers Pro et Max

## Matrice des droits actuellement codée

Le catalogue contient **46 analyses**. La matrice ci-dessous reprend les paliers réellement affectés aux fonctions dans `public/js/catalog.js` — ce n’est pas une nouvelle grille commerciale.

| Palier | Contenu du catalogue | Nombre |
|---|---|---:|
| Accès gratuit | Voirie & rues; Zones fonctionnelles; Vert & eau; Tissu urbain; Occupation des bâtiments | 5 |
| Pro | Les 5 gratuites, plus les 33 analyses Pro ci-dessous | 33 Pro |
| Max | Tout Pro, plus les 8 planches Max ci-dessous | 8 Max |

### Pro — 33 analyses

- **Morphologie (7)** : Volumes 3D, Densité bâtie, Volumétrie axonométrique, Typologie bâtie, Trame isométrique, Orientation, Rose des orientations.
- **Usage et vie urbaine (7)** : Chaleur des POI, Types de POI, Vitalité des rues, Analyse nodale, Carte annotée, Territoires de service, Superposition combinée.
- **Mobilité (7)** : Accès transport, Réseau piéton, Accessibilité, Accessibilité piétonne, Champ de connexité, Bruit routier, Sources sonores.
- **Environnement (7)** : Course solaire & ombres, Topographie, Pente & exposition, Trame de terrain, Contexte urbain, Situation, Rose des vents.
- **Climat (5)** : Températures, Précipitations, Climat annuel, Heures de jour, Rayonnement.

### Max — 8 planches supplémentaires

Planche de contexte; Données urbaines · Nœuds; Données urbaines · Trame; Volumétrie axonométrique annotée; Planche d’insertion; Cônes de vue indicatifs; Zonage fonctionnel OSM; Centralité & accès radial.

Le module **Cadrage spatial** et les ateliers intégrés ont leur propre périmètre fonctionnel; cette grille ne leur attribue pas automatiquement un droit Pro/Max. Il faudra décider explicitement si ces modules doivent être inclus dans une offre commerciale.

## Fichier de licence `.utlic`

Un `.utlic` est un petit document JSON qui contient un titre signé Ed25519 : identifiant aléatoire, palier Pro/Max, date d’émission et expiration éventuelle. Aucun nom, courriel, projet, site étudié ou donnée cartographique n’est inclus par défaut.

Le générateur émet une licence à durée choisie (`--days N`) ou sans expiration (`--lifetime`). Il ne crée pas de paiement et ne décide pas des prix. Les conditions et durées commerciales restent à fixer.

### Générateur privé

Les commandes s’exécutent **sur votre ordinateur**, dans PowerShell ou un terminal interactif, depuis une copie du projet :

```powershell
npm run licence:init
npm run licence:public
npm run licence:issue -- --tier pro --days 30 --out "$HOME\Documents\UrbaTrame-Licences\client-pro.utlic"
npm run licence:issue -- --tier max --days 365 --out "$HOME\Documents\UrbaTrame-Licences\client-max.utlic"
```

Pour une licence sans date d’expiration, remplacer `--days N` par `--lifetime`.

- `licence:init` crée le coffre émetteur chiffré par mot de passe dans le profil utilisateur (Windows : `%APPDATA%\UrbaTrame\licence-issuer.enc.json`; Linux/macOS : `~/.config/UrbaTrame/licence-issuer.enc.json`). Le coffre n’est pas créé dans le dossier du projet.
- `licence:public` redemande le mot de passe, vérifie le coffre et réaffiche la **clé publique** à configurer; elle n’est pas secrète.
- `licence:issue` demande le mot de passe sans l’écrire en clair et crée le `.utlic`. Le fichier de licence est écrit dans Documents ou au chemin indiqué.
- Le générateur refuse d’écraser un coffre ou un fichier existant. Sauvegardez le coffre chiffré et son mot de passe dans des emplacements sûrs; sans eux, vous ne pourrez plus émettre de nouvelles licences avec cette identité.

**Ne transmettez jamais le coffre privé ni son mot de passe.** Le fichier `.utlic`, lui, est le titre à remettre au bénéficiaire. Il peut être partagé ou copié; la version actuelle ne limite pas le nombre d’appareils et ne permet pas la révocation immédiate. Une licence expirée cesse toutefois d’être acceptée.

## Configuration du serveur

Deux clés différentes interviennent :

1. `FM_LICENSE_PUB` : clé publique issue du nouveau coffre; le serveur l’utilise pour vérifier les `.utlic`. Elle peut être placée dans Vercel → Project → Settings → Environment Variables. Elle n’est pas secrète. En PowerShell local, définissez `$env:FM_LICENSE_PUB = '<clé publique affichée>'` et `$env:FM_ACCESS = 'licence'` avant `npm start` pour appliquer les paliers.
2. `FM_SIGNING_KEY` : clé privée de signature des sessions du serveur, distincte du coffre d’émission. Elle doit rester dans l’environnement serveur et ne jamais être ajoutée au code ou envoyée dans une conversation. Ne la régénérez pas si des titres sont déjà en circulation.

Pour que les paliers soient **effectivement appliqués**, `FM_ACCESS=licence` doit être défini sur le serveur. Par défaut, UrbaTrame conserve son mode d’accès libre; ce changement n’est pas fait ici et aucun paramètre Vercel n’est modifié. Après configuration des variables, redémarrez le serveur local ou redéployez sur Vercel. Le statut public indique seulement si l’import signé est configuré; il n’expose pas la liste des codes.

Le panneau Tarifs accepte le `.utlic`; le navigateur vérifie la signature localement à l’import. Lorsqu’une analyse Pro/Max est demandée, le titre est transmis avec cette requête et le serveur le vérifie à nouveau. Aucune donnée du projet n’est envoyée lors de la seule importation. Le navigateur conserve le titre pour restaurer l’activation sur le même appareil.

## Limites et état

- Les codes historiques `FM_CODES` sont conservés pour compatibilité. Les codes de démonstration sont disponibles uniquement en développement local; en production/Vercel, aucun code de démo n’est accepté par défaut.
- Le catalogue Pro/Max peut être vérifié côté serveur pour les analyses; le mode d’accès reste `open` jusqu’à configuration explicite.
- Pas de paiement, de compte client, de base de données de licences, de comptabilité, de limitation d’appareils ou de révocation en ligne dans cette première version.
- Le serveur vérifie la signature, le produit, le palier, les dates et l’identifiant. La licence de base n’est pas liée à l’empreinte d’un navigateur; l’attestation de session est, elle, associée à l’identifiant d’appareil déjà utilisé par l’application.
- Les fonctions client exécutées localement ne peuvent pas être protégées contre toute modification du navigateur; l’activation sert surtout à gérer proprement les droits de la version publiée. Les traitements/API serveur restent soumis aux contrôles côté serveur.
