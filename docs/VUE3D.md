# Vue 3D : volumes bâtis, ombres et fond de carte

Fonctions reprises de <https://osmbuildings.org> après démontage (voir
`docs/reverse-osmbuildings.md`, rapport de reverse engineering du
12 octobre 2026).

## Ce que ça fait

| Fonction | Où |
|---|---|
| **Analyse « Volumes 3D »** dans le catalogue | liste des analyses → Morphologie → *Volumes 3D* |
| **Vue interactive plein écran** | bouton `3D` sur la fiche de cette analyse, ou `?vue3d=1` dans l'adresse |
| Bâtiments extrudés (hauteur réelle, sinon 9 m) | partout |
| Ombres portées selon l'heure du site | partout (curseur d'heure, 0–23 h) |
| Rotation, inclinaison, zoom | vue interactive : glisser, glisser vertical, molette |
| Fiche d'un bâtiment au clic | vue interactive |
| Fond de carte raster (OpenStreetMap) | vue interactive : case *Fond de carte* |
| **Posé sur le terrain réel** (altimétrie) | partout ; case *Relief* dans la vue interactive |
| **Cours intérieures évidées** | partout (relations OSM, membres `inner`) |
| Export PNG et SVG | vue interactive (boutons PNG / SVG) |
| Export SVG/PNG de la planche | comme les 35 autres analyses |

## Comment c'est fait

```
public/js/vue3d.js      moteur : soleil, caméra, scène, ombres, SVG, canvas
public/js/vue3d-ui.mjs  fenêtre interactive (canvas 2D, contrôles, exports)
public/js/osm.mjs       + batimentsDepuisOverpass() · batimentsDepuisTuiles()
public/js/plan-2d.mjs   + DEPS.volumes (bâti + altimétrie) · buildingsQuery()
server/api.mjs          + action « buildings » (requête composée par le serveur)
public/js/renderers-pro.js  + R.volumes (la planche du catalogue)
```

Aucune dépendance : le moteur est écrit à la main, comme le reste du projet
(pas de WebGL, pas de bibliothèque de rendu).

### Repères mathématiques (identiques au site d'origine)

- **Soleil** : éphéméride abrégée — longitude moyenne, anomalie, écliptique,
  déclinaison, ascension droite, temps sidéral — puis vecteur est/nord/haut.
  Heure locale du site assimilée à l'heure solaire (pas de base de fuseaux).
- **Caméra** : perspective (focale = demi-diagonale / tan(champ/2)), cap,
  inclinaison, distance. Découpage contre le plan proche : sans lui, un
  polygone passant derrière la caméra se replie à l'écran.
- **Inclinaison** : 0 = vue verticale, 90 = rasante (convention du site) ;
  la planche du catalogue est à 50°.
- **Ombres** : même convention que l'analyse « soleil » du projet — longueur =
  hauteur réelle / tan(hauteur du soleil), × 0,55, plafonnée à 100 m.
- **Exagération verticale = ×4** : à l'échelle vraie, un bâtiment de 3 m sur un
  site de 600 m ne fait pas un pixel. Le facteur est **écrit dans la légende**
  (`H ×4`) pour que la lecture reste honnête.

### Deux sources de bâtiments

1. **Overpass (défaut, autonome)** : la requête est composée par le
   planificateur (`buildingsQuery`), jamais transmise par le client — même
   modèle de sûreté que le reste de l'API. Hauteurs lues dans `height`, sinon
   `building:levels × 3,1 m`.
2. **Tuiles osmbuildings.org (option)** : `data.osmbuildings.org/0.2/…` renvoie
   des emprises **toutes pourvues d'une hauteur**, avec parfois la forme du
   toit, la couleur et l'usage. Le service exige un `User-Agent` de navigateur,
   autorise les appels depuis un navigateur (CORS `*`), et la clé employée est
   celle de leur page de démonstration. **Attribution obligatoire** : c'est
   rappelé dans la vue et dans les exports.

Sur El Khroub, la différence est nette et instructive :

| Source | Emprises (600 m) | Avec hauteur |
|---|---|---|
| Overpass | 1 335 | 200 (15 %) |
| Tuiles osmbuildings.org | 553 | 553 (100 %) |

Les bâtiments sans hauteur sont dessinés à 9 m, dans une teinte légèrement
différente, et la légende indique leur nombre (`1136 à 9 m`).

### Relief : les volumes se posent sur le terrain

L'altimétrie est celle du projet (tuiles Terrarium, action `terrain`, déjà
utilisée par les analyses « relief », « courbes de niveau », « exposition ») :
une grille carrée d'altitudes centrée sur le site, première ligne au nord,
première colonne à l'ouest. `DEPS.volumes` demande donc `buildings` **et**
`terrain` : les volumes ne peuvent pas se poser sur un sol qu'on n'a pas.

Trois points font la différence entre « ça marche » et « ça se voit » :

1. **Repère local.** Le zéro du dessin est l'altitude du **centre du site**
   (`prepareTerrain` renvoie `ref` et `z(lat, lon)`). Sans ce recalage, un site
   à 630 m d'altitude placerait toute la scène 630 m au-dessus de la caméra :
   rien ne serait visible. La note de la planche annonce l'amplitude réelle
   (`sol 589–665 m`) pour que la pente affichée reste interprétable.
2. **Maillage étendu.** `maillageRelief` découpe la grille en quadrilatères
   (normale calculée par différences finies, pour l'ombrage). La grille est
   prolongée de `RELIEF_MARGE = 4` cellules au-delà de son emprise — positions
   prolongées, altitude du bord répétée — sinon le sol s'arrêterait net au
   bord du cadre. Le fond plat reçoit la **teinte moyenne de cette couronne**,
   pour que la couture entre maillage et fond ne se voie pas.
3. **Voirie, eau et ombres suivent la pente.** Chaque sommet est projeté à
   l'altitude du terrain sous lui ; les ombres se posent de même, et ne
   s'enfoncent plus dans un coteau.

L'assise d'un bâtiment est l'altitude du terrain **sous son centre de gravité**,
lue en interpolation bilinéaire (bornée aux bords de la grille). L'exagération
verticale (`H ×4` sur la planche) s'applique au relief comme aux volumes : un
site de 76 m de dénivelé se lit donc sur 300 m de dessin.

### Cours intérieures : évidées, et à la bonne emprise

Une relation OSM `building` peut décrire plusieurs emprises (`outer`) et des
cours (`inner`). Le lecteur (`batimentsDepuisOverpass`) rend désormais, pour
chaque emprise, la liste de ses `trous` :

- chaque cour est rattachée à l'emprise **qui la contient** (test
  point-dans-anneau sur son centre) — une cour n'est ni perdue, ni attribuée au
  voisin ;
- le toit est tracé en **un seul chemin**, emprise puis cours, rempli selon la
  règle « pair-impair » (`fill-rule="evenodd"` en SVG, `fill('evenodd')` sur
  canvas) : les cours sont des vrais trous, pas des polygones superposés ;
- les **murs de la cour** sont dessinés, et leur normale pointe vers l'intérieur
  de la cour — autrement dit, on voit les parois du puits de lumière, et
  seulement celles qui regardent la caméra. Le sens d'enroulement OSM n'est
  jamais supposé : pour une cour, la normale est simplement retournée.

Au passage, le centre qui décide du côté « extérieur » d'un mur n'est plus la
moyenne des sommets (faussée par le point de fermeture répété, et parfois hors
d'un anneau concave) mais le **centre de gravité de la surface** (formule des
lacets) : `centroidePoly`.

### Tri des volumes

Le tri reste du type peintre (pas de tampon de profondeur), mais il se fait
maintenant **par bâtiment** : les groupes sont rangés du plus lointain au plus
proche, puis les faces à l'intérieur de chaque groupe. Un toit lointain ne peut
donc plus passer devant le mur d'un voisin plus proche, ce que le tri face à
face laissait faire. La désignation au clic (`designer`) suit le même ordre et
rend le bâtiment **le plus proche** sous le curseur.

## Limites connues

- **Pas de tampon de profondeur** : le tri se fait par bâtiment puis par face
  (peintre). Deux bâtiments **entrelacés** (une passerelle qui traverse un
  volume, par exemple) resteront approximatifs : c'est le prix d'un moteur sans
  WebGL.
- **Relief en escalier** : la grille est échantillonnée à 24 × 24 (un point tous
  ~50 m au rayon 600) et les quadrilatères sont plats ; la couronne du maillage
  prolonge l'altitude du bord, donc le sol du cadre reste plat au-delà de la
  zone mesurée. Dépressions et crêtes plus fines que le pas passent inaperçues.
- **Bâtiments sans hauteur** : ils sont dessinés à 9 m (teinte plus claire,
  nombre annoncé dans la note). Aucune tentative de déduction depuis les
  hauteurs voisines.
- **Bâtiments sur l'eau ou en encorbellement** : l'assise est celle du terrain,
  pas de gestion des pilotis ni des `building:min_level` hors du dessin.
- **Fond de carte** : OpenStreetMap standard, `crossOrigin="anonymous"` exigé
  pour que l'export PNG reste possible (l'image est alors « non souillée »).
  Changer de gabarit de tuiles est une ligne dans `vue3d-ui.mjs`.
