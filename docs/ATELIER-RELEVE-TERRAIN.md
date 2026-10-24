# Relevé terrain dans l’Atelier cartographique

Le relevé est une section de l’Atelier cartographique existant d’UrbaTrame; il ne crée pas une application séparée. L’interface propose des gabarits d’attributs, une couche vectorielle vide, une lecture de position par le navigateur, les outils de dessin déjà présents et des exports cartographiques courants.

## Démarrer une collecte

1. Ouvrez l’Atelier cartographique et développez **Fiche de collecte GNSS**.
2. Gardez le gabarit **Relevé urbain**, modifiez son nom/champs ou chargez un gabarit local. Les champs peuvent être du texte, un nombre, une date, oui/non ou une liste. Une clé doit commencer par une lettre; les clés `gps_`, `height_`, `geoid_` et `_urbaTrame` sont réservées aux métadonnées de capture.
3. Pour conserver le schéma sur cet appareil, choisissez **Enregistrer**. **Exporter le gabarit** crée un fichier JSON de schéma, sans valeurs d’observation. Un projet local enregistre également le gabarit actif avec les couches.
4. Choisissez **Créer une couche vide « Relevé terrain »**. La vue initiale utilise les coordonnées visibles dans le panneau; modifiez-les, sélectionnez **Afficher ce centre**, ou lisez une position GNSS. Le cadrage numérique reste limité à une largeur de 3 000 m; ce plafond d’analyse existant n’est pas relevé.
5. Choisissez **Lire ma position GNSS**. C’est cette action qui demande l’autorisation du navigateur. Vérifiez les coordonnées, l’horodatage et la précision annoncée, puis choisissez **Capturer un point GPS**. Les champs obligatoires doivent être remplis.
6. Pour saisir une géométrie à la main, sélectionnez la couche et utilisez les outils Point, Ligne ou Polygone de l’Atelier. Les valeurs de la fiche active sont appliquées aux nouvelles entités.
7. Exportez les couches vectorielles visibles en GeoJSON, CSV (WKT), KML, KMZ ou GeoPackage. Le projet `.urbatrame.json` est une autre option pour sauvegarder les couches, les sources, les styles et le gabarit.

Les valeurs saisies sont conservées dans les entités du projet ou dans les exports demandés; la bibliothèque de gabarits ne conserve que les définitions de champs. Aucun relevé ni fichier local n’est téléversé à UrbaTrame par cette interface. Si un fond cartographique en ligne est activé, son fournisseur reçoit toutefois des requêtes de tuiles ou de carte et peut déduire l’emprise consultée et l’adresse IP, selon ses propres conditions.

## Position GNSS et limites du navigateur

La position vient de l’API de géolocalisation du navigateur et est exprimée en WGS 84. L’appareil détermine le récepteur utilisé et la précision réellement obtenue; la précision affichée est celle annoncée par le système, pas un contrôle topographique. Une altitude n’est enregistrée que si le navigateur en fournit une. L’affichage de la permission ou du GNSS nécessite les autorisations et le contexte pris en charge par le navigateur.

Un récepteur externe ne peut fournir une position que si le téléphone/système la rend disponible au navigateur. Cette page ne met pas directement en œuvre le jumelage Bluetooth ou USB, NTRIP, l’enregistrement brut UBX, la conversion UBX→RINEX ni le post-traitement. Utilisez un logiciel de terrain/GNSS adapté pour ces opérations, puis importez les formats pris en charge dans UrbaTrame.

## Géoïde GTX facultatif

L’utilisateur peut charger un fichier GTX depuis l’appareil. Le fichier est analysé localement, gardé en mémoire dans l’onglet courant, puis supprimé de cette mémoire à sa fermeture ou à son rechargement. UrbaTrame ne fournit et ne télécharge aucun modèle et n’intègre pas le GTX dans le projet.

La conversion n’est activée qu’après confirmation par l’utilisateur de la couverture géographique et du datum vertical du modèle. Pour une capture qui fournit une hauteur ellipsoïdale et qui se trouve dans la grille, l’application interpole l’ondulation `N` et calcule `H = h − N`. Le nom du modèle, `N`, la hauteur de départ et le résultat sont conservés dans les attributs de l’entité. Une grille hors couverture ou une altitude absente ne donne pas de hauteur orthométrique. Les variantes d’en-tête GTX reconnues doivent être vérifiées avec le fichier réellement utilisé; l’exemple de test synthétique ne certifie pas l’interopérabilité avec tous les modèles publiés.

## Formats et sécurité

- **KML/KMZ** : import/export vectoriel WGS 84. Le parseur n’active ni DTD ni entités externes, ne suit aucun `NetworkLink` et n’accède pas à des ressources référencées. L’export KMZ contient un `doc.kml` autonome.
- **GeoPackage** : export des couches vectorielles visibles en EPSG:4326; les couches raster ne sont pas incluses. La taille et le nombre de couches restent soumis aux limites de l’Atelier.
- **CSV** : attributs, géométrie WKT, couche, source et date d’export. Les nombres négatifs restent des nombres; les cellules textuelles commençant par un marqueur de formule sont neutralisées pour l’ouverture dans un tableur.
- **Gabarit JSON** : schéma de champs seulement; l’import rejette les clés réservées et les listes invalides.

Les bases de tuiles hors ligne **MBTiles** et les fichiers bureautiques natifs XLS/ODS ne sont pas importés/exportés par ce chantier. Pour les données tabulaires, l’export CSV s’ouvre dans un tableur; pour les fonds web existants, l’Atelier conserve ses connexions explicites XYZ, WMS et WMTS. Le choix d’un format d’échange ne modifie ni les données locales ni la limite d’analyse de 3 000 m.

Les données de couches déjà importées continuent d’obéir aux limites de taille, d’entités et de positions indiquées dans l’interface et le README UrbaTrame. Un fond XYZ/WMS/WMTS n’est pas incorporé au projet ni aux exports KML/KMZ.
