# TopoExport — reverse engineering

> Rapport conservé dans le dépôt : il documente *pourquoi* de nouvelles
> fonctions sont construites ainsi. Relevé fait le **12 octobre 2026** sur le
> site public <https://topoexport.com/fr> et sur son application
> <https://app.topoexport.com>.
>
> Aucun code, aucune image ni aucun fichier de ce service n'est repris dans
> Freemap : ce document ne décrit que des **comportements observés** (pages et
> fichiers publics, appels d'API sans jeton). Tout ce qui est réutilisé est
> réécrit à la main, comme pour le reste du projet.

Objectif : savoir **ce que fait ce service, avec quelles données et comment**,
pour en reprendre les idées utiles sans deviner — comme cela a été fait pour
`docs/reverse-osmbuildings.md`.

---

## 1. Ce que fait le service, en clair

TopoExport rend un **relevé topographique prêt à dessiner**. On choisit une
emprise sur une carte, on coche les couches voulues, et on télécharge :

- une **carte vectorielle 2D** (bâtiments, parcelles, routes, voies ferrées,
  hydrographie, arbres, **courbes de niveau**) ;
- un **modèle 3D** du même lieu (terrain + bâti, parfois arbres) ;
- ou les **données brutes** ayant servi à les produire.

Le tout dans les formats attendus par les logiciels de CAO et de BIM. La
dernière fonction annoncée est **TopoSection** : une **coupe topographique**
entre deux points, avec le bâti traversé.

| Fonction | Ce que ça donne |
|---|---|
| **Emprise à l'écran** | rectangle déplaçable sur une carte vectorielle, surface affichée en km² |
| **Calques** | bâtiments, parcelles, routes, voies ferrées, hydrographie, arbres, ombres, canopée, espaces verts, haies, courbes de niveau, terrain |
| **Courbes de niveau** | équidistance réglable (5 m par défaut, jusqu'à 0,1 m) |
| **Terrain** | modèle numérique en maillage, pas de terrain réglable (20 m par défaut, jusqu'à 0,5 m) |
| **Ombres portées** | angle de soleil et hauteur de bâti par défaut paramétrables |
| **Hauteur par défaut** | 6 m pour les bâtiments sans hauteur mesurée |
| **TopoSection** | coupe entre deux points, profondeur réglable, téléchargement par lien |
| **Historique** | liste des exports passés, avec leur emprise, leur coût et leurs jeux de données |
| **Aperçu** | rendu 3D immédiat dans le navigateur (selon l'abonnement) |

Repères publics affichés par le site : **+100 000 utilisateurs par mois**,
exports **jusqu'à 50 km²**, gratuité annoncée jusqu'à 1 km² (« bis zu einem
Quadratkilometer » dans un témoignage), compatibilité Revit/AutoCAD mise en
avant, et comparaison assumée avec Cadmapper (concurrent direct).

## 2. Comment c'est construit

```
topoexport.com          vitrine : Nuxt 3 (SSR), pages /fr, /blog, /api
app.topoexport.com      l'application : Vue 3 + Vite (SPA, un seul bundle d'entrée)
api.topoexport.com      l'API (tout derrière authentification)
manager.topoexport.com  administration
basemap.topoexport.com  fond de plan vectoriel
```

| Brique | Ce qui a été relevé |
|---|---|
| Carte 2D | **MapLibre GL** (chaîne `maplibre.org` et code du moteur dans le bundle) |
| Fond de plan | **basemaps Protomaps** — l'attribution affichée renvoie à `github.com/protomaps/basemaps` et à OpenStreetMap ; les tuiles sont servies par leur propre hôte `basemap.topoexport.com` |
| Vue 3D | **TresJS** (three.js sous forme de composants Vue), nuances et matériaux three.js, **GLTFExporter** embarqué pour l'export glTF côté navigateur |
| Authentification | **Supertokens** (lien par e-mail, code, Google) ; toutes les pages d'espace sont protégées |
| Paiement | **Stripe** côté serveur (session de paiement, portail d'abonnement) |
| Mesure et erreurs | PostHog, Plausible, Sentry |
| Structure | vues « espace » : carte, export, jeux de données, historique, coupes, offres, API, à propos |

L'application charge ses vues à la demande (un fichier par écran) ; le moteur de
carte et three.js sont dans le bundle principal.

## 3. Les données : des jeux typés, choisis par couverture puis précision

Chaque source est un **jeu de données** décrit par un identifiant, un **type**,
un `productId`, une `precision`, une `regionIsoCode` (`WORLD` ou un pays), et
une géométrie de couverture éventuelle. Types relevés :

| Type | Contenu |
|---|---|
| `IMAGERY` | image satellite (fonds d'écran) |
| `RASTER_DTM` | modèle numérique de terrain — **courbes de niveau et maillage** |
| `RASTER_DSM` | modèle numérique de surface (avec bâti et végétation) |
| `BUILDINGS_2D` / `BUILDINGS_3D` | emprises, extrudées ou non |
| `FLOORS`, `ROOFS`, `WALLS` | morceaux de bâtiment pour le **LoD2** (murs et toits fins) |
| `PARCELS` | parcelles cadastrales |
| `ROADS`, `ROADS_OUTLINE` | voirie, et son contour |
| `RAILWAYS`, `WATERWAYS` | voies ferrées, hydrographie |
| `TREES`, `CANOPY`, `GREEN_AREAS`, `HEDGES` | arbres, couvert arboré, espaces verts, haies |

Deux appels publics (mais sous authentification) décident de ce qui est
proposé :

- `GET /regions/whereami?x=…&y=…` → région reconnue, jeux disponibles, prix ;
- `GET /datasets/check-covering?datasetIds[]=…&point[x]=…&point[y]=…` →
  pour chaque jeu, `covers` (vrai/faux) et `hasCoverageGeometry`. L'interface ne
  montre que ce qui couvre réellement le point choisi — et retire ensuite ce qui
  ne couvre pas, sans le dire à l'utilisateur.

**Sélection d'un jeu pour un type donné** (fonction `Wr`/`Xz` du bundle) :
tri par `priority` décroissante, puis par `precision` (et pour `BUILDINGS_3D`,
c'est la précision **la plus fine** qui gagne : on soustrait dans l'autre sens),
puis les jeux **régionaux avant `WORLD`**. Autrement dit : une donnée locale
précise l'emporte toujours sur une donnée mondiale grossière.

Ce qui est annoncé publiquement : **LoD2 en Allemagne et en Suisse** seulement,
arbres **issus d'OpenStreetMap** (« OSM trees », mondial), arbres « IA » à part
(productId dédié, badge, tarif majoré).

Vérifié le 12/10/2026 : `api.topoexport.com/config`, `/datasets`,
`/regions/whereami` répondent **401 « unauthorised »** sans jeton. Aucun compte
n'a été créé : les données elles-mêmes n'ont pas été consultées, seule la
structure des appels a pu être relevée.

## 4. Un export = un seul appel

Le client compose **un corps unique** et le poste à `POST /compute`. Reconstitution
du corps (noms de champs relevés tels quels) :

```jsonc
{
  "northEast": { "latitude": 0, "longitude": 0 },
  "southWest": { "latitude": 0, "longitude": 0 },
  "language": "fr", "currencyCode": "EUR",
  "clientRender": true,                 // rendu d'aperçu confié au navigateur
  "satellite": true,
  "satelliteOptions":  { "format": "JPEG", "datasetIds": ["…"] },
  "vectorial": true,
  "vectorialOptions": {
    "format": "DXF", "geolocate": false,
    "buildings": true, "parcels": true, "roads": true, "railways": true,
    "waterways": true, "trees": true, "aiTrees": false,
    "shadows": true, "shadowsAngle": 45, "shadowsBuildingsDefaultHeight": 6,
    "contours": true, "contourStep": 5
  },
  "modeling": true,
  "modelingOptions": {
    "format": "DXF", "geolocate": false,
    "buildings": true, "buildingsDefaultHeight": 6, "aiBuildings": false,
    "parcels": true, "roads": true,
    "contours": true, "contourStep": 5,
    "terrain": true, "terrainSpacing": 20
  },
  "raw": false,
  "rawOptions": { "contours": false, "contourStep": 5, "terrain": false, "terrainSpacing": 20 }
}
```

Quatre familles d'options, indépendamment activables : **satellite**,
**vectoriel 2D**, **modélisation 3D**, **brut**. Un export peut donc contenir
plusieurs livrables d'un coup.

Le reste de la vie d'un export :

| Appel | Rôle |
|---|---|
| `POST /compute` | lance le calcul, renvoie l'export (emprise, coût, jeux, statut) |
| `GET /compute` | historique, du plus récent au plus ancien |
| `GET /compute/{id}` | détail d'un export : `computeExport` avec `southWest`/`northEast`, `rate`, `cost`, `datasets` |
| `GET /me/plan`, `GET /me/balances` | abonnement en cours, et compteurs par usage (`export`, `section`) |
| `POST /subscriptions/checkout-session` | passage à une offre payante (Stripe) |
| `GET /api-usage/*` | statistiques de l'API publique |

Les réponses sont chiffrées en unités du service (`cost`), pas directement en
euros : le prix est calculé et formaté côté client à partir de la grille.

## 5. Coupes topographiques (TopoSection)

```
POST /sections
  { "start": {"latitude":…, "longitude":…},
    "end":   {"latitude":…, "longitude":…},
    "depth": …, "datasetIds": ["…"] }
  → { "sectionJobId": "…" }

GET /sections/{sectionJobId}/download-link   → { "url": "…" }
```

Le calcul est **asynchrone** (une tâche), et le résultat se récupère par un lien
de téléchargement signé. Deux compteurs distincts le protègent : un **crédit de
coupe** par période (`balances.section.remaining/max/resetAt`) et une **longueur
maximale** de coupe (refus `longerSections` / `moreSectionCredits` selon le cas).

## 6. Formats, niveaux et tarification

| Famille | Formats relevés | Niveau requis |
|---|---|---|
| Satellite | JPEG | libre |
| Carte vectorielle 2D | DXF, DWG, PDF, SVG, SKP, 3DM (`THREEDM`), RVT | RVT en `proplus` ; RVT et SKP plafonnés à 10 km² |
| Modèle 3D | DXF, SKP, 3DM, OBJ, glTF (`GLB`), STL, IFC, RVT | IFC et RVT en `proplus` |
| Brut | GeoJSON, TIFF, TXT | libre |

**Surfaces par niveau** : `basic` = 1 km², `pro` = 10 km², `proplus` = 50 km².
Au-delà de 1 km², l'export devient « PRO » (relevé de haute précision ou
surface supérieure) — payable à l'unité ou inclus dans un abonnement.

**Prix** = `coef × surface (km²) + forfait`, coefficients relevés :

| Cas | 2D (vectoriel) | 3D (modélisation) |
|---|---|---|
| base | 1,4 × S + 10 | 2,2 × S + 13 |
| courbes ≤ 1 m | 2,2 × S + 14 | 2,8 × S + 16 |
| courbes = 2 m | 1,6 × S + 12 | 2,6 × S + 14 |
| courbes < 5 m | 1,4 × S + 12 | 2,2 × S + 14 |
| terrain < 10 m | — | 2,2 × S + 13 |
| arbres IA | 2,2 × S + 14 | 2,8 × S + 16 |

Majorations : IFC et RVT **× 2** ; surface > 10 km² **× 1,1**. Le niveau le plus
exigeant demandé par l'export (précision, format, géolocalisation) fixe le
niveau de l'export entier.

**Bornes relevées** : équidistance minimale **0,1 m** (1 m conseillé), pas de
terrain minimal **0,5 m**, surface maximale de calcul **100** (unité interne),
plafond commercial **50 km²**, RVT/SKP **10 km²**. Le site conseille de découper
les très grandes emprises en plusieurs exports.

**Abonnements** : Stripe, renouvellement mensuel, compteurs remis à zéro à date
(`resetAt`), illimité affiché par une icône ∞ quand le plafond dépasse 999.
Argumentaire de l'offre haute : « 20 exports PRO+ par mois, jusqu'à 50 km²,
format IFC ».

## 7. Ce que Freemap peut en reprendre — et ce qu'il laisse

**Repris (réécrit, sans dépendance ni compte) :**

| Idée | Pourquoi c'est à notre portée |
|---|---|
| **Courbes de niveau** depuis une grille d'altitudes | l'altimétrie est déjà là (tuiles Terrarium, action `terrain`) ; l'analyse `contour` est déjà déclarée au catalogue, sans rendu |
| **Plan 2D vectoriel** (bâti, voirie, courbes) exportable en **DXF** et **SVG** | DXF en texte est un format simple ; SVG est déjà notre sortie native |
| **Modèle 3D** terrain + bâti en **OBJ** et **STL** | le moteur 3D produit déjà les volumes et le maillage du terrain |
| **Coupe topographique** entre deux points, avec le bâti en travers | se déduit de la grille d'altitudes et des emprises |
| **Rayon de recherche et couverture** | remplacer `regions/whereami` par notre propre logique : une seule source mondiale (OSM) + une grille d'altitudes globale, donc pas de « couverture » à vérifier |

**Laissé de côté, volontairement** : DWG, RVT, SKP, 3DM, IFC (formats
propriétaires ou hors de portée sans dépendance), le BIM et le LoD2, les arbres
« IA », les exports raster (TIFF) et l'imagerie satellite payante, les comptes,
Stripe et les quotas.

**Différences de fond assumées** : Freemap n'a **ni compte ni quota** (période
d'essai ouverte), **aucune dépendance**, des sources **publiques uniquement**
(OpenStreetMap, Terrarium, NASA POWER), et un catalogue d'analyses plutôt qu'un
configurateur d'export. Là où le service vend la précision, nous montrons la
provenance.

## 8. Méthode, et ce qui reste incertain

**Méthode.** Tout a été relevé sur des ressources **publiques** : pages HTML,
feuilles de style, fichiers JavaScript servis au navigateur, et quelques appels
`GET` sur des adresses publiques **sans jeton** (qui ont répondu 401). Aucun
compte n'a été créé, aucune donnée privée n'a été consultée. Les bundles sont
minifiés : l'analyse porte sur les **chaînes lisibles, les constantes et la
forme des appels**, pas sur le code source.

**Incertain, et signalé comme tel :**

- les algorithmes serveur (génération des courbes de niveau, simplification des
  géométries, construction des maillages) : invisibles depuis le navigateur ;
- le contenu exact des tuiles de fond de plan et les sources derrière les jeux
  régionaux (le site ne publie pas la liste complète, et les jeux sont choisis
  côté serveur) ;
- les prix en euros : portés par Stripe côté serveur, seuls les coefficients
  internes ont été relevés ;
- le comportement réel derrière un compte (aperçu client, files d'attente,
  qualité des exports).

**Ce que ce rapport autorise** : reprendre des **idées** et des **formats
ouverts**. Ce qu'il n'autorise pas : reprendre du code, des gabarits, des
images, ni les données du service.
