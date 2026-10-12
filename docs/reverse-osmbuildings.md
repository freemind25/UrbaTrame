# osmbuildings.org — reverse engineering

> Rapport conservé dans le dépôt : il documente *pourquoi* la vue 3D est
> construite ainsi (voir `docs/VUE3D.md` pour le résultat). Données relevées le
> 12 octobre 2026 sur la page de démonstration du service.

Relevé fait le **12 octobre 2026** sur <https://osmbuildings.org/?lat=36.26037&lon=6.69700&zoom=16.0&tilt=30>
(El Khroub, Constantine, Algérie — les coordonnées de votre lien).

Objectif : savoir **ce que fait ce site, avec quelles données et comment**, pour
reproduire ses fonctionnalités dans Freemap sans deviner.

---

## 1. Ce que fait le site, en clair

Le site affiche une carte **en volume** : les bâtiments d'OpenStreetMap sont
dessinés en trois dimensions, avec leur hauteur réelle, et l'on peut incliner et
faire pivoter la vue comme avec une maquette qu'on prendrait dans la main.

Ses fonctions, une par une :

| Fonction | Ce que ça donne à l'écran |
|---|---|
| **Bâtiments en volume** | chaque emprise est extrudée sur sa hauteur ; les toits plats, dômes et pans sont distingués |
| **Inclinaison** | vue de dessus (0°) ou rasante (jusqu'à ~60°), « tilt » en anglais |
| **Rotation** | on tourne autour du point visé, sans quitter la carte |
| **Soleil et ombres** | `setDate()` place le soleil selon la date et l'heure locales, les bâtiments projettent alors leurs ombres |
| **Fiche d'un bâtiment** | un clic met le bâtiment en jaune et liste ses attributs (hauteur, niveaux, type, nom…) |
| **Recherche de lieu** | champ de recherche → Nominatim → la carte s'y rend |
| **Paramètres dans l'adresse** | `?lat=&lon=&zoom=&tilt=&rotation=&q=` — l'adresse décrit toujours la vue |
| **Fond de carte** | carrelage raster OpenStreetMap (style « HOT ») sous les volumes |
| **Étiquettes** | marqueurs (API `addMarker`) — non utilisés sur la page d'accueil |

## 2. Comment c'est construit

```
osmbuildings.org (page statique)
├── index.html                 page + champ de recherche + barre latérale
├── js/map.js                  l'instance de la carte (position, tilt 30, zoom 16..20)
│                              + l'interaction au clic (highlight + fiche)
├── js/Params.js               synchronise l'adresse du navigateur (lat/lon/zoom/tilt/rotation)
├── js/Search.js               Nominatim : recherche + « où suis-je » inversé
├── js/Events.js               petit bus d'événements
├── js/lib/jquery-3.2.1.min.js
└── cdn.osmbuildings.org/4.1.1/OSMBuildings.js   moteur WebGL (152 Ko minifié)
```

Deux services externes, et c'est **tout** :

1. **Les volumes** : `https://{a|b|c}.data.osmbuildings.org/0.2/<clé>/tile/{z}/{x}/{y}.json`
   (clé publique lue dans le code de la page : `59fcc2e8`, zoom figé à 15) ;
2. **Le fond** : `https://tile-a.openstreetmap.fr/hot/{z}/{x}/{y}.png` ;
3. **La recherche** : `https://nominatim.openstreetmap.org/…` (le même service
   que Freemap utilise déjà).

## 3. Le format des données (le cœur du sujet)

Une réponse = une **collection GeoJSON** (`FeatureCollection`) : un tableau de
bâtiments, chacun avec une emprise et des attributs.

Extrait réel, tuile `15/16993/12838` (El Khroub) :

```json
{
  "type": "FeatureCollection",
  "features": [
    { "type": "Feature",
      "id": "osm-w1147541853",
      "geometry": { "type": "Polygon",
                    "coordinates": [[[6.697731, 36.257812], [6.697528, 36.257694], "…"]] },
      "properties": { "height": 3 } }
  ]
}
```

Points importants :

- les coordonnées sont en **[longitude, latitude]** (ordre GeoJSON), **pas**
  en projection : c'est le code d'affichage qui projette ;
- `id` reprend l'identifiant OSM (`w` = way, `r` = relation — une relation
  signifie souvent un bâtiment à cour intérieure, donc plusieurs anneaux) ;
- les géométries vues : `Polygon` et `MultiPolygon` ;
- **tous** les bâtiments portent une hauteur : le service la calcule en amont à
  partir des étiquettes OSM (`height`, `building:levels`, valeurs par défaut).

### Attributs observés

Sur la tuile d'El Khroub (553 bâtiments) et celle de Berlin (271) :

| Attribut | El Khroub | Berlin | Signification |
|---|---|---|---|
| `height` | 553 / 553 | 271 / 271 | hauteur totale en mètres |
| `minHeight` | — | 52 | bas de volume (ponts, passages couverts) |
| `levels` | — | 169 | nombre de niveaux ; ≈ 3 m par niveau |
| `minLevel` | — | 37 | premier niveau (bâtiment posé sur un socle) |
| `roofHeight` | — | 39 | hauteur du toit seul |
| `roofLevels` | — | 16 | niveaux du toit |
| `roofShape` | — | 88 | `flat`, `dome`, `gabled`… |
| `roofMaterial` | — | 32 | matière du toit |
| `material` | — | 88 | matière des murs |
| `shape` | — | 16 | forme générale (cylindre, etc.) |
| `color` / `roofColor` | — | 59 / 56 | couleurs explicites (`#rrggbb`) |
| `type` | — | 122 | usage (`commerce:office`, `residential`…) |
| `name` | — | 45 | nom du bâtiment |
| `orient` | — | 1 | orientation |

Autrement dit : **l'essentiel (la hauteur) est toujours là ; le détail
(toits, couleurs, usage) n'apparaît que dans les zones bien documentées.**
El Khroub n'a que des hauteurs — c'est la réalité des données OSM locales, pas
une limite du service.

## 4. Conditions d'accès (vérifié, pas supposé)

| Contrôle | Résultat |
|---|---|
| En-tête `Access-Control-Allow-Origin` | `*` → appel possible depuis un navigateur |
| Cache | `public, max-age=14400` (4 h) |
| Sans `User-Agent` de navigateur | **403** (Cloudflare bloque) |
| Avec un simple `User-Agent` de navigateur, sans `Referer` | **200** |
| Sans clé (`/0.2/tile/…`) | **400** |
| Clé employée | celle de la page de démonstration, publique mais **prêtée** |

À retenir pour Freemap : le service fonctionne, mais la clé est celle de leur
démonstration et la page « Copyright » rappelle que **l'attribution
« © OpenStreetMap (ODbL) » est obligatoire** et que leurs conditions d'usage
s'appliquent. Une utilisation de masse depuis un site public n'est donc pas
acquise d'avance — d'où les deux voies proposées plus bas.

## 5. Le calcul des ombres

Le moteur embarque une fonction de position solaire (`suncalc` compilé dedans) :

```js
View.Sun.setDate(date) →
  { azimuth, altitude } = suncalc(date, latitude, longitude)
  direction = [ -sin(azimut)·cos(altitude),          // axe est-ouest
                 cos(azimut)·cos(altitude),          // axe nord-sud
                 sin(altitude) ]                     // hauteur du soleil
```

Deux formules astronomiques classiques (déclinaison du soleil + équation du
temps) suffisent à reproduire cela **sans dépendance** : c'est ce que nous
savons déjà faire dans Freemap pour l'analyse « sun ».

## 6. Ce qui est reproductible dans Freemap

| Fonction du site | Faisabilité | Moyen |
|---|---|---|
| Bâtiments extrudés | oui | projection 3D → polygones, tri par profondeur (pas de WebGL nécessaire) |
| Inclinaison + rotation | oui | deux angles de caméra (glisser-déposer + curseurs) |
| Ombres selon l'heure | oui | position du soleil (formules ci-dessus) + projection des ombres au sol |
| Fiche du bâtiment au clic | oui | test point-dans-polygone sur les emprises |
| Recherche de lieu | déjà en place | `geocode()` existant (Nominatim) |
| Adresse synchronisée | déjà partiellement | Freemap gère déjà `?lat=&lon=&q=&lang=` |
| Fond de carte raster | oui | tuiles OSM (attribution ODbL) sous le dessin |
| Export | **mieux que le site** | Freemap sait déjà exporter SVG/PNG, le site non |

## 7. Ce que nous ne copions pas

- Le moteur WebGL (`OSMBuildings.js`, 152 Ko) : nous n'ajouterons pas de
  dépendance ; notre rendu sera du canvas/SVG maison, dans l'esprit du reste
  du projet ;
- les *shaders* et effets (brouillard, brume) ;
- le service de tuiles comme **source principale** : dépendance à une clé
  prêtée, non garantie dans le temps. Il reste utilisable en option, avec
  attribution, comme source de confort.

## 8. Fichiers relevés

| Fichier | Contenu |
|---|---|
| échantillons relevés le 12/10/2026 | 40 bâtiments d'El Khroub (553 au total) et 40 de Berlin, attributs riches |

Les fichiers bruts (extraits de tuiles, moteur minifié) sont restés hors du
dépôt : seules les conclusions et les mesures sont conservées ici.

*Données : © OpenStreetMap contributors, ODbL.*
