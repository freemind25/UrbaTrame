# Exports CAO — plan DXF, coupe, modèle OBJ/STL

UrbaTrame produit des fichiers cartographiques et topographiques à partir des
données OpenStreetMap et du relief Terrarium, ainsi qu'une maquette de volumes
conceptuels calculée à partir des hypothèses saisies par l'utilisateur :

| Fichier | Format | Usage |
| --- | --- | --- |
| Plan topographique | `.dxf` (R12 / AC1009) | AutoCAD, QCAD, Illustrator, Inkscape, Blender |
| Coupe topographique | `.dxf`, `.svg` | dessin d'axe, profil en long, planche de présentation |
| Modèle 3D du terrain et du bâti cartographié | `.obj`, `.stl` | Blender, SketchUp, Rhino, impression 3D |
| Volumes 3D conceptuels | `.svg`, `.obj`, `.stl` | maquette indicative depuis les hypothèses du scénario |

Deux façons de les obtenir :

- **Dans l'application** : bouton **« Exports CAO (DXF · coupe · OBJ/STL) »** du
  panneau de droite pour le plan, la coupe et la maquette du terrain. Pour les
  volumes conceptuels, ouvrez **Synthèse & scénario**, complétez les hypothèses,
  générez la maquette, puis choisissez SVG, OBJ ou STL.
- **En ligne de commande** : `node tools/exporter.mjs` écrit les fichiers à
  partir de l'exemple embarqué, sans navigateur ni réseau.

```bash
node tools/exporter.mjs                          # tout, dans test/out/
node tools/exporter.mjs --out /tmp/freemap
node tools/exporter.mjs --quoi plan --geolocate --equi 5 --avec COURBES,BATI
node tools/exporter.mjs --coupe 0,-400,0,400 --hauteur 9
node tools/exporter.mjs --quoi modele --sans-sol
```

## Conventions

**Unités et repère.** Tout est en mètres. Par défaut le repère est local :
origine au centre du site, X vers l'est, Y vers le nord, Z vers le haut — la
convention des logiciels de CAO. L'option `--geolocate` écrit en **UTM (WGS 84)**,
la projection de Krüger étant calculée dans le projet : les fichiers se
superposent alors à un fond cadastral ou à un relevé de géomètre. El Khroub, par
exemple, tombe dans le fuseau 32 N (est ≈ 293 105, nord ≈ 4 015 713).

**DXF.** Version **R12 (AC1009)**, la plus largement lue ; `$INSUNITS = 6`
(unités : mètres). Les polylignes sont écrites en `POLYLINE/VERTEX/SEQEND` — la
forme lue par tous les logiciels, anciens compris (`LWPOLYLINE` n'existe qu'à
partir de la R13). Les calques du plan :

| Calque | Contenu |
| --- | --- |
| `COURBES` | courbes de niveau ; l'altitude de la polyligne (Z) est celle de la courbe |
| `BATI` | emprises bâties fermées ; **Z porte la hauteur** du bâtiment (mesurée, sinon 9 m) |
| `VOIRIE` | voirie, un tronçon par polyligne |
| `EAU` | hydrographie |
| `VERT` | végétation et espaces verts |
| `POI` | points d'intérêt (`POINT`), noms en `TEXT` si l'option est activée |
| `EMPRISE` | cercle du site étudié |
| `TEXTE` | cartouche : site, altitudes, équidistance, repère, sources |

Le bâti porte donc sa hauteur en Z : dans AutoCAD, `EXTRUDE` (ou l'outil
d'extrusion de QCAD) en fait des volumes d'un seul geste. Un plan écrit sans
l'option `recadrer` contient toute la donnée récupérée, même au-delà du site ;
par défaut, les tracés sont coupés à la limite du cercle d'emprise.

**OBJ.** Un seul fichier, trois groupes : `TERRAIN` (maillage du relief),
`BATI`, `TOIT`. Les sommets sont en mètres, **altitudes vraies** (l'altitude de
référence du relief est ajoutée) : un toit à Z = 640 m est bien à 640 m
d'altitude. Ni l'OBJ ni le STL ASCII ne savent décrire un trou dans une face :
les **cours intérieures restent donc pleines** dans ces deux formats, alors
qu'elles sont évidées à l'écran et dans le plan (anneau intérieur).

**STL.** ASCII, facettes triangulaires, normales calculées. C'est le format de
l'impression 3D ; le maillage est ouvert (le terrain est une nappe, pas un
solide), les outils de découpe le traitent bien, mais un calcul de volume
suppose de fermer la base.

**Volumes conceptuels.** La surface de plancher et l'emprise proviennent du
scénario de capacité; l'utilisateur renseigne le nombre de blocs, la hauteur
d'étage, le rapport largeur/profondeur et, pour plusieurs blocs, leur écart.
Les volumes égaux sont rangés le long d'un axe graphique, au même nombre de
niveaux. Ils ne sont **ni géoréférencés ni placés sur une parcelle**; aucun
zonage, règle ou contrôle réglementaire n'est déduit. Les exports OBJ/STL sont
des solides fermés, en mètres, avec Z vers le haut et une origine locale
arbitraire. Une rangée de blocs contigus est exportée comme un seul solide sans
faces internes. Ces fichiers n'ajoutent pas de données OSM ni de limites
foncières.

**Coupe.** Le profil est échantillonné le long de l'axe (161 points pour 1 km),
l'altitude est interpolée bilinéairement dans la grille. Le DXF de coupe place
la distance vers l'est et l'altitude vers le nord, avec quatre calques :
`TERRAIN` (polyligne du sol), `BATI` (un rectangle par bâtiment traversé),
`AXE` (ligne de base), `TEXTE` (titre). Un bâtiment est « traversé » si son
emprise est coupée par l'axe — test par changement de signe de l'écart
perpendiculaire de ses murs.

## Options

| Option | Effet |
| --- | --- |
| `--out DIR` | dossier de sortie (défaut : `test/out`) |
| `--quoi LISTE` | `plan`, `coupe`, `modele`, `apercus` (défaut : tout) |
| `--avec LISTE` | calques du plan à écrire (défaut : tous) |
| `--equi N` | équidistance des courbes en mètres (défaut : automatique, ~10 lignes) |
| `--hauteur N` | hauteur du bâti sans donnée (défaut : 9 m ; le service, lui, écrit 6 m) |
| `--geolocate` | écrire en UTM plutôt qu'en repère local |
| `--coupe n,e,n,e` | axe de coupe, en mètres depuis le centre du site (défaut : −500,0,500,0) |
| `--sans-sol` | modèle 3D sans le maillage du relief |
| `--inclinaison`, `--cap` | angles de la scène 3D qui sert à construire le modèle |

Dans l'application, les mêmes réglages sont proposés en cases et listes :
repère, équidistance, hauteur par défaut, calques, noms de POI, axe de coupe
(clic sur l'aperçu), relief et bâti du modèle.

## Vérifications

Les fichiers produits ont été relus par des bibliothèques tierces, pas
seulement par nos tests :

- **ezdxf 1.4.4** — plan et coupe : `AC1009`, unités 6, **aucune erreur ni
  correction** à l'audit, puis relecture des entités (polylignes, points,
  textes) et des calques ;
- **trimesh 5.1.1** — OBJ et STL : 11 911 triangles, **0 facette dégénérée**,
  étendue 1 840 × 1 840 m × 84 m de relief, altitudes absolues correctes.

Le banc d'essai du projet (`test/exports.test.mjs`, 51 cas) vérifie en plus,
hors ligne : la projection UTM contre des valeurs de référence, la structure du
DXF (sections, tables, entités, `EOF`), le recadrage à l'emprise, l'équidistance,
la fermeture des anneaux, la cohérence du profil (longueur, échantillonnage,
bornes d'altitude), la détection du bâti traversé, la triangulation et les
normales unitaires.

## Limites assumées

- **Pas de `DWG`, `RVT`, `SKP`, `3DM`, `IFC`.** Les trois premiers sont des
  formats propriétaires (l'écriture demande une bibliothèque sous licence ou un
  logiciel installé) ; l'IFC est un format BIM, hors du périmètre d'un plan de
  site produit depuis OpenStreetMap.
- **Pas de LoD2** (modèles de toiture détaillés) : il n'en existe pas
  d'équivalent libre et mondial ; le catalogue loD2 allemand est le seul
  exploitable, et il ne couvre pas l'Algérie.
- **Le bâti est extrudé, pas modélisé** : un volume par emprise, hauteur
  mesurée ou valeur par défaut. Les toits sont plats, sauf hauteur de toiture
  renseignée dans la donnée.
- **Les noms non translittérables sont écartés** du DXF : la R12 se lit en ANSI,
  un texte arabe ou cyrillique y serait illisible. Les tracés, eux, sont
  conservés.
- **Les courbes sont des polylignes** (pas d'arcs ni de splines) : c'est ce que
  produisent les analyses, et tous les lecteurs les acceptent.
- Les données restent celles d'OpenStreetMap : leur précision est celle du
  relevé bénévole.

## Sources et licences

Les fichiers issus des données cartographiques portent l'attribution dans
leur cartouche (plan) ou leur en-tête (OBJ) : **données © OpenStreetMap
(ODbL)** et **relief Terrarium**. Si vous publiez ou diffusez ces livrables,
gardez cette mention — c'est la condition de l'ODbL. Les volumes conceptuels
ne proviennent que des hypothèses saisies et n'embarquent ni fond de carte ni
limite foncière. Le logiciel lui-même est sous licence MIT.
