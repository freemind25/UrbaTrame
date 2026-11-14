# Analyse architecturale — le dossier « commandes-rue » et son intégration

*Document de travail — 15 novembre 2026. Source analysée : dossier Dropbox partagé `commandes-rue(1)` (photo `rue.jpg`, sept fiches `SKILL.md`, sept exemples PNG/MP4).*

---

## 1. Ce que contient le dossier

Le dossier n’est pas un jeu de plans : c’est un **atelier de dessin de rue** composé de sept « commandes », chacune décrite par un `SKILL.md` et illustrée par un rendu d’exemple :

| Commande | Ce qu’elle produit | Ce qu’elle demande |
|---|---|---|
| `usages` | Plan de la rue au 1/200 en couleurs plates : terrasses, passage libre, livraisons, mobilier, passants, barre de répartition en % | largeur, bandes, gens comptés |
| `profil` | Profil en travers « coupe d’urbaniste » : façades coupées, niveaux, sol, cotes, rapport H/L et phrase d’interprétation | hauteurs à l’égout, largeurs de bandes |
| `fronts` | Élévation déroulée du front bâti : travées, étages, lucarnes, RDC commerciaux, égout de toit en rouge coté en mètres | découpe en immeubles, niveaux, hauteurs |
| `axo` | Axonométrie à 30° de la rue, volumes blancs, toits zinc, terrasses orange, passants | mêmes données + profondeur d’îlot |
| `ombres` | Étude d’ombre heure par heure aux solstices, coupe + plan, total d’heures de soleil direct | latitude, orientation, hauteurs |
| `demain` | Avant / après : réaménagement sans toucher aux immeubles, fosses d’arbres, joints ouverts, passage libre coté | largeur disponible par bande |
| `planche-rue` | Planche A3 portrait qui assemble tous les dessins, avec cartouche et date | les six autres dessins |

**La logique commune** — et c’est le vrai contenu du dossier :

1. **une photo de rue** est le seul document d’entrée ;
2. on en tire un **relevé chiffré** (`rue.json`) : largeur entre façades, bandes de sol, hauteurs à l’égout, niveaux, mobilier, personnes ;
3. un **contrôle** reprojette le relevé en rouge sur la photo pour vérifier la lecture ;
4. les dessins sont **calculés en code** (matplotlib/Pillow côté atelier d’origine) — jamais générés par un modèle d’image ;
5. chaque fiche impose une **charte** : 1080 × 1920, dessin ≥ 85 % de la largeur, textes ≥ 26 px, cartouche discret, et l’obligation de **dire ce qui est supposé**.

---

## 2. Décision d’intégration : un espace à part, pas une analyse de plus

UrbaTrame regarde déjà le **quartier** (cadrage, OSM, relief, OpenLandMap, rapport de site). Le dossier travaille à l’**échelle de la rue**, avec une autre grammaire : coupes cotées, élévations, axonométrie, heures de soleil. Le ranger dans le catalogue des 49 analyses l’aurait dilué.

D’où un **espace propre** : `/atelier-archi.html`, ajouté à la navigation de toutes les pages sous le nom **« Analyse architecturale »**. Son angle est explicite dès l’en-tête :

> Ce que l’on voit d’une photo devient des mètres, puis des coupes, des élévations et des heures de soleil.

---

## 3. Ce qui est repris, tel quel ou adapté

### 3.1 Le moteur de calcul — `public/js/archi-rue.mjs`

| Fonction | Rôle |
|---|---|
| `normalizeSurvey()` | valide et borne un `rue.json` : largeur 2–80 m, bandes, immeubles, façades, mobilier, gens. Aucune valeur ne peut produire `NaN`. |
| `computeMetrics()` | largeur, longueur, parts de terrasses / passage, hauteurs à l’égout, **H/L**, **ciel vu de l’axe** (2·atan((L/2)/H)), type de rue. |
| `sunPosition()` | déclinaison (Cooper), équation du temps, azimut et hauteur du soleil pour une heure solaire. |
| `litWidth()` | largeur de sol éclairée, projetée sur l’axe de la rue. |
| `daylightStudy()` / `daylightSummary()` | balayage de la journée par pas de 5 min : première et dernière heure éclairée, durée « au moins un point éclairé » et **durée moyenne** sur la largeur. |
| `demainScenario()` | fosses de 1,50 × 1,50 m à cheval sur la limite terrasse/passage (0,75 m de chaque côté), passage libre jamais sous 1,80 m, aucune terrasse supprimée, refus explicite si la rue est trop étroite. |
| `surveyWarnings()` | liste lisible de ce qui est supposé ou incohérent (écart de bandes, hauteur déduite, orientation non mesurée). |
| `DEMO_SURVEY` | relevé de démonstration : rue Montorgueil, 12,10 m entre façades, 18,1 / 16,5 m à l’égout, 199 personnes vues. |

### 3.2 Les dessins — `public/js/archi-rue-draw.mjs`

Les sept planches sont réécrites en **SVG pur**, sans bibliothèque : mêmes sujets, même charte (1080 × 1920, portrait, cartouche, échelle graphique, nord), mais **vectorielles**, donc nettes à l’impression et lisibles sur téléphone.

| Planche | Ce qui a été porté | Ce qui a été adapté |
|---|---|---|
| Usages | plan, terrasses, passage, livraisons, mobilier, passants, barre de % | les passants sont répartis par tirage **reproductible** (graine fixe) : mêmes points à chaque rendu |
| Profil | coupe, niveaux, cotes, H/L en grand, phrase d’interprétation | le toit est dessiné en brisis/terrasson générique, faute de relevé de toiture |
| Fronts | élévation déroulée, égout rouge coté, lucarnes, RDC commerciaux | niveaux déduits du libellé `R+n+C`, jamais mesurés |
| Axonométrie | volumes, toits zinc, terrasses, passants, numéros de repère | projection oblique alignée sur la rue (30°) au lieu d’une perspective libre |
| Ombres | coupe avec les lignes d’heure, chronogramme, durées en grand | le chronogramme donne **une barre par heure légale entière**, jaune = sol éclairé |
| Demain | avant/après en profil et en plan, trois chiffres qui changent | le scénario est calculé et **refuse** les arbres plutôt que de rogner le passage |
| Planche | A3 portrait, grille, un titre par dessin, cartouche daté | les six dessins sont **insérés tels quels** (aucun redessin), en `<g>` scalé |

### 3.3 L’interface — `public/atelier-archi.html` + `archi-rue-ui.mjs`

- **six panneaux de saisie** : lieu et orientation, largeur et bandes (liste éditable avec somme contrôlée en direct), façades, gens et mobilier, photo de référence, fichier `rue.json` ;
- **sept onglets** de dessins, avec téléchargement **SVG**, **PNG 2160 × 3840** et impression A3 (le PDF s’obtient par la boîte d’impression du navigateur) ;
- **huit indicateurs** recalculés en direct à côté du dessin ;
- **bandeau d’hypothèses** : chaque planche rappelle ce qui est supposé ;
- **photo de référence** chargée localement (FileReader), jamais envoyée, jamais stockée ;
- le relevé est conservé dans `localStorage` et exportable en `rue.json` — le même fichier peut donc venir d’un autre poste ou d’un dossier de projet.

---

## 4. Ce qui n’est pas repris, et pourquoi

| Élément du dossier | Décision | Raison |
|---|---|---|
| **Génération d’images par modèle** (les exemples du dossier sont des rendus IA) | non repris | UrbaTrame reste sur des **dessins calculés** : un chiffre faux doit se voir sur le dessin, pas être lissé par une image plausible. |
| **Vidéo MP4 de 3 s** par planche | non repris en v1 | suppose un encodeur vidéo côté navigateur ; le SVG pourra être animé (SMIL) dans une version ultérieure. |
| **Reprojection automatique du relevé sur la photo** (`controle.png`) | non repris en v1 | demande de poser des points de fuite à la main sur la photo ; le contrôle se fait ici en comparant le profil et les hauteurs affichées. |
| **Lecture automatique de la photo** (vision) | non repris | la page fonctionne hors ligne et sans modèle ; le relevé se saisit ou s’importe. |
| **Gabarit PDF direct** | remplacé par l’impression navigateur | évite une dépendance PDF et donne un A3 portrait exact. |

---

## 5. Règles de qualité tenues

- **Aucune ressource externe** : pas de police distante, pas de CDN, pas d’image liée. Vérifié par test (`https?://` interdit hors `xmlns`).
- **Aucun `NaN`, `undefined` ou texte hors cadre** dans les sept SVG : test dédié, plus un test de position de chaque `<text>`.
- **Tout ce qui est supposé est écrit** : hauteurs déduites marquées « ? », étages de 3,0 m annoncés, orientation non mesurée signalée, profondeur d’îlot déclarée forfaitaire.
- **Cohérence arithmétique** : la somme des bandes est comparée à la largeur entre façades, et l’écart est affiché en orange.
- **Calculs vérifiés** : hauteur du soleil à midi = 90° − latitude + déclinaison (test sur quatre latitudes et quatre dates), azimut à midi, conversion en heure légale.

---

## 6. Utilisation

1. Ouvrir **Analyse architecturale** depuis la navigation.
2. Charger l’exemple Montorgueil pour voir les six planches, puis **« Relevé vide »**.
3. Renseigner le lieu, la largeur, les bandes (leur somme doit égaler la largeur), les hauteurs à l’égout et les niveaux.
4. Vérifier le bandeau d’hypothèses, corriger.
5. Télécharger le SVG ou le PNG d’une planche, exporter `rue.json`, ou imprimer la planche A3.
