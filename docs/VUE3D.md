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
| Export PNG et SVG | vue interactive (boutons PNG / SVG) |
| Export SVG/PNG de la planche | comme les 35 autres analyses |

## Comment c'est fait

```
public/js/vue3d.js      moteur : soleil, caméra, scène, ombres, SVG, canvas
public/js/vue3d-ui.mjs  fenêtre interactive (canvas 2D, contrôles, exports)
public/js/osm.mjs       + batimentsDepuisOverpass() · batimentsDepuisTuiles()
public/js/plan-2d.mjs   + DEPS.volumes · buildingsQuery()
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

## Limites connues

- **Aucun test de profondeur entre bâtiments** : le tri se fait par face
  (peintre), ce qui suffit pour une maquette à ces angles, mais deux volumes
  imbriqués peuvent se recouvrir de façon approximative.
- **Relief ignoré** : les volumes reposent sur un plan à altitude zéro ;
  l'altimétrie du projet (Terrarium) n'est pas encore appliquée à la vue 3D.
- **Cours intérieures remplies** : les membres `inner` des relations ne sont pas
  évidés (comme dans les renderers 2D existants).
- **Fond de carte** : OpenStreetMap standard, `crossOrigin="anonymous"` exigé
  pour que l'export PNG reste possible (l'image est alors « non souillée »).
  Changer de gabarit de tuiles est une ligne dans `vue3d-ui.mjs`.
