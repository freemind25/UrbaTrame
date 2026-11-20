# Atelier topographique Altiplan dans UrbaTrame

**Altiplan est une section intégrée à UrbaTrame.** Ouvrez-la depuis le bouton **« Atelier topo »** de la page principale ou directement à `/atelier.html`.

## Parcours

1. Recherchez un lieu, saisissez ses coordonnées ou déplacez le centre sur la carte.
2. Choisissez un rayon et les couches OpenStreetMap à récupérer : bâtiments, voirie, occupation du sol, eau, rail, arbres, parcelles OSM et points d’intérêt.
3. Prévisualisez le plan et réglez les calques, l’axe de coupe ou l’heure solaire.
4. Placez des repères personnels et des notes sur la carte. Ils restent dans ce navigateur et peuvent être exportés en GeoJSON.
5. Téléchargez les livrables directement depuis l’aperçu.

L’exemple embarqué d’El Khroub permet d’essayer l’atelier sans attendre les services externes. L’atelier ne demande **ni compte ni abonnement et n’applique pas de quota**.

## Repères et notes cartographiques

Ouvrez **« Repères & notes locales »**, choisissez une catégorie, saisissez un titre et placez le point dans l’emprise affichée. Les notes et leurs coordonnées sont stockées dans `localStorage` sur cet appareil; elles ne sont pas synchronisées ni envoyées au serveur. Vous pouvez supprimer un repère, effacer ceux de l’emprise courante ou exporter les points en **GeoJSON**. Ces annotations sont des données personnelles de travail, distinctes d’OpenStreetMap, et ne constituent pas des limites foncières ou cadastrales.

L’atelier comprend aussi un **atlas administratif GADM** : navigation pays → subdivisions, fiches de métadonnées, aperçus thématiques et téléchargements par pays ou pour le monde. Voir [la documentation GADM](GADM.md) pour les formats, versions et limites.

## Fichiers produits

- **Plan** : DXF R12, SVG et PNG, avec courbes de niveau, bâtiments et couches sélectionnées. Choix entre mètres locaux et coordonnées UTM WGS 84.
- **Coupe** : profil du terrain et bâtiments traversés, export DXF, SVG et PNG.
- **Maquette 3D** : terrain, bâtiments et arbres OSM, export OBJ et STL, avec aperçu PNG et heure solaire réglable pour visualiser les ombres.
- **CLI** : tous les livrables sont générés ensemble depuis l’exemple local ou un site demandé.

```bash
npm run atelier:exporter -- --out /tmp/freemap-atelier
npm run atelier:exporter -- --lieu "Constantine, Algérie" --rayon 900 --geolocate --out /tmp/freemap-atelier
npm run atelier:exporter -- --help
```

La commande en ligne a besoin d’un accès Internet pour interroger OpenStreetMap et les tuiles d’altitude. L’exemple embarqué fonctionne hors ligne.

## API et structure

Les routes réservées à ce module sont publiques et n’utilisent pas le système de licence ou de quota des analyses d’UrbaTrame :

| Route | Usage |
|---|---|
| `GET /api/atelier/health` | Couches, sources et limites prises en charge |
| `POST /api/atelier/geocode` | Recherche de lieu |
| `POST /api/atelier/extract` | Extraction des couches autorisées et du relief |
| `GET /api/atelier/gadm` | Aperçu GeoJSON de limites administratives, avec validation et filtrage parent |

Implémentation : `public/atelier.html`, `public/js/atelier/`, `server/atelier-api.mjs`, `server/atelier-data.mjs` et `tools/atelier/`. Les sorties CLI par défaut sont écrites dans `exports/` à la racine du projet.

## Limites et protection des données

Les couches dépendent de la couverture d’OpenStreetMap et peuvent être vides. Une parcelle ne s’affiche que si une limite correspondante existe dans OSM; Altiplan ne crée ni ne complète de limites juridiques ou cadastrales. Les fichiers ne remplacent pas un relevé de géomètre.

Les coordonnées de contact inutiles (courriel, téléphone, site web et horaires) sont retirées des résultats renvoyés au navigateur. Le jeu d’exemple est également filtré. Les attributions ODbL et les limites de précision figurent dans [DONNEES.md](DONNEES.md).

## Cartes thématiques du bâti

Le bouton **Cartes du bâti** ouvre directement l’onglet Carte vectorielle. Après
chargement de l’exemple ou extraction du site, choisissez dans « Carte du bâti »
le type, la hauteur, le nombre de niveaux ou la surface d’emprise. Les couches,
le style et l’échelle se règlent dans le même panneau. L’aperçu peut être exporté
en SVG ou PNG, avec sa légende ; l’échelle fixe doit tenir sur la feuille et
être conservée lors de l’impression.

- Hauteur : valeur OSM `height` numérique en mètres, ou estimation à 3,1 m par
  niveau entier OSM en l’absence de hauteur. Les valeurs indisponibles ou de
  format non reconnu sont grises, jamais remplacées par la hauteur 3D par défaut.
  Les décomptes indiquent les valeurs estimées et inconnues dans les données
  chargées, pas uniquement les bâtiments visibles après découpe.
- Niveaux : seules les valeurs entières positives `building:levels` sont
  représentées. Une hauteur ne permet pas de déduire le nombre de niveaux.
- Surface : superficie approximative de l’emprise entière en projection locale,
  cours intérieures connues soustraites ; elle peut inclure des parties hors de
  l’emprise d’affichage. Ce n’est ni la surface de plancher, ni une mesure
  cadastrale, ni un relevé de géomètre.

Les classes et la couverture dépendent des données OSM. Les valeurs grises
indiquent des données manquantes ou non exploitables et non une valeur nulle.

### Catégories de voies et pack SVG

Dans **Cartes du bâti → Carte vectorielle**, la rubrique « Catégories de voirie
OSM » permet de masquer individuellement les classes de voies dans l’aperçu et
les SVG/PNG de cette carte. Les tronçons de type inconnu ou non couvert par les
classes sont dans « Autres ou inconnues ». Les longueurs indiquées portent sur
les tronçons chargés et sélectionnés, avant découpe à la limite de la carte.
Ces filtres ne modifient ni le plan DXF ni le modèle 3D, dont les réglages sont
indépendants.

Le bouton **Pack SVG · 4 cartes** prépare localement un ZIP contenant les quatre
planches (type/style actuel, hauteur, niveaux et emprise), une notice et un
fichier JSON de métadonnées. Le style, l’échelle et les couches actuellement
choisis sont repris pour les quatre planches ; si l’emprise déborde de la feuille
à l’échelle choisie, le pack est refusé plutôt que de masquer le problème.
L’archive est limitée à 30 Mo et nécessite des bâtiments chargés et affichés.

Le JSON contient le nom, les coordonnées, le rayon et les réglages du site :
contrôlez-le avant tout partage. La date indiquée est la date de génération, pas
celle du relevé. Les SVG sont des planches vectorielles de présentation, non des
données SIG géoréférencées ; ils ne constituent ni un relevé cadastral, ni un
ensemble d’exports CAO par calques. Conservez les attributions OSM et vérifiez
l’échelle à l’impression. Le pack ne contient ni PNG, ni DXF, ni maquette 3D.
