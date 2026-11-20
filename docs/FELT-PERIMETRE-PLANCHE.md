# Périmètre et première planche cartographique

Inspiré de principes documentés par Felt, sans parité ni appel au service : <https://help.felt.com/analysis-and-dashboards/spatial-analysis> et <https://help.felt.com/export-and-print/print-layouts>.

## Analyses guidées et exports de données

Le choix initial est **toutes les entités** ; « après filtres » applique le filtre textuel et la catégorie du tableau de bord à chaque couche concernée. Le compte utilisé / total apparaît avant l'opération, y compris pour la couche de référence. Le filtre est attributaire : la visibilité et l'emprise de la carte ne limitent pas l'analyse. L'export vectoriel ne contient que les couches visibles et exclut les rasters. Pour une sélection dans une zone, le menu ne propose que les polygones du périmètre et conserve leur indice original, puis le convertit pour l'analyse. Les 2 000 premières entités surfaciques au maximum sont proposées.

Les résultats sont des copies, accompagnées des comptes, filtres, sources, paramètres et date dans leur provenance. Le GeoJSON conserve le périmètre d'export dans ses métadonnées ; CSV, KML/KMZ et GeoPackage contiennent les entités sélectionnées mais ne garantissent pas la conservation de tous les détails du filtre : noter ceux-ci séparément si nécessaire. Le fichier projet reste complet ; la sélection du graphique est temporaire et non sauvegardée. Les recettes autonomes et les autres outils gardent leurs propres règles, ce choix ne les affecte pas. Aucune entité ne correspond peut produire un export vide ou être refusée selon le format ; aucune substitution silencieuse à la couche entière.

## Planche SVG et PNG

Export de l'aperçu cartographique existant en A4 ou A3 paysage : titre, date, nord, barre d'échelle indicative, liste des douze premières couches visibles et sources abrégées. Une case vide (*) signifie que les couleurs détaillées du style catégoriel ou raster ne sont pas représentées dans la légende. Les filtres actifs sont signalés sur la planche ; leurs détails et les sources complètes figurent dans les métadonnées du SVG, pas du PNG. Fond externe exclu ; avertissement en cas de troncature de l'aperçu. SVG est un dessin, pas un SIG géoréférencé ; aucun carroyage ni carte de situation. Les éléments peuvent être limités ou abrégés, vérifier l'aperçu et les sources avant diffusion.

La barre mesure une distance approximative sur une sphère à la latitude de son emplacement dans la projection affichée ; elle peut varier fortement ailleurs dans la carte et ne constitue pas une échelle de précision ni un relevé foncier. Les dimensions physiques du SVG sont nominales, contrôlez « taille réelle » à l'impression. L'impression de la page via le bouton existant reste distincte de l'export de planche ; pour imprimer la planche, ouvrir le SVG/PNG dans un outil adapté. Les rasters sont des aperçus et les données peuvent être incomplètes, anciennes ou imprécises.
