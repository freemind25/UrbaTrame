# Comparateur historique · séance S5

Le comparateur S5 est intégré à l’atelier d’analyse UrbaTrame. Il sert à examiner deux cartes d’époques différentes et à préparer une synthèse de travail; il ne remplace ni une source historique ni un relevé de géomètre.

## 1. Importer les documents

1. Depuis le suivi de l’atelier, ouvrir **S5 — Lire les transformations dans le temps**, puis **Ouvrir le comparateur S5**.
2. Importer une image historique et une image actuelle au format PNG, JPEG ou WebP (12 Mo maximum chacune; 35 mégapixels maximum).
3. Renseigner pour chaque carte la période, l’échelle indiquée, la référence/source et les droits ou la licence. Ces informations sont reportées dans les exports. Vérifier que vous avez le droit d’utiliser et de transmettre le document avant toute analyse IA.

Les fichiers restent dans le navigateur pour le travail local. Ils ne sont pas ajoutés à l’export JSON.

## 2. Géoréférencer et vérifier

1. Ajouter au moins trois repères visibles sur les deux cartes, aussi bien répartis que possible et non alignés.
2. Pour chaque repère, saisir la **latitude**, puis la **longitude**, en degrés WGS84.
3. Cliquer sur **Pointer historique**, puis sur l’emplacement du repère dans l’image historique; répéter sur la carte actuelle.
4. Examiner l’erreur quadratique moyenne (RMSE) et le résidu de chaque point, en mètres, pour les deux images. Un RMSE élevé, des résidus très différents ou des repères concentrés sur une petite zone invitent à vérifier les points et les coordonnées.

Le calcul est un ajustement affine en EPSG:3857 à partir des points saisis. Les RMSE et résidus sont exprimés en mètres de projection, non corrigés de la distorsion au sol. Les résultats et points de contrôle sont inspectables dans l’interface et exportables en JSON; ils ne garantissent pas à eux seuls l’exactitude de la carte source.

## 3. Comparer et composer

- Choisir **Transparence** ou **Balayage**, puis régler le curseur.
- Pour annoter manuellement, saisir un type et un intitulé, choisir **Placer un repère sur le plan**, puis cliquer sur la superposition.
- Relire les intitulés, sources, périodes et droits avant l’export.
- Rédiger le **texte de synthèse du groupe**. Un brouillon IA peut être copié dans ce champ par une action explicite; le texte doit être relu et confirmé pour apparaître dans le plan PNG.
- **Exporter le plan PNG** produit une synthèse avec la superposition, les dates, les sources, les droits renseignés, la méthode, les RMSE, les observations retenues et, si confirmé, le texte du groupe. Les propositions IA non validées n’y sont pas incluses.
- **Exporter les points et annotations JSON** fournit les coordonnées de contrôle, les résidus, les métadonnées et les observations retenues. Les propositions IA encore en attente sont conservées séparément et identifiées comme non validées; les images et les clés API en sont exclues. La provenance IA (fournisseur, modèle et date) est incluse si l’IA a été utilisée.

Une carte provenant d’OpenStreetMap doit conserver l’attribution © OpenStreetMap contributors et respecter la licence applicable. L’utilisateur est responsable de l’attribution et des droits des cartes importées.

## 4. Aide IA facultative

Le mode local est le défaut. L’assistance IA n’est activée qu’après sélection d’un fournisseur, saisie de la clé personnelle de l’étudiant et consentement explicite.

- **Charger les modèles gratuits** envoie au fournisseur choisi une requête authentifiée de catalogue, sans image. La liste et les capacités annoncées peuvent évoluer.
- **Proposer une synthèse** transmet directement au fournisseur choisi deux JPEG réduits (côté le plus long limité à 1 400 pixels), l’invite d’analyse et les métadonnées de période, d’échelle et de source. Ne pas envoyer de document confidentiel.
- La clé reste dans la page pendant la session, n’est pas sauvegardée dans le navigateur et n’est jamais exportée. Elle est effacée lors du changement de fournisseur et à la fermeture de la page.
- UrbaTrame ne tente aucun basculement vers un modèle payant. La gratuité, les quotas, la disponibilité de l’entrée image, les frais éventuels, les pratiques de rétention et l’utilisation pour l’entraînement dépendent des conditions du fournisseur et du modèle; les vérifier avant l’envoi. OpenRouter peut appliquer les règles du fournisseur amont; APInex indique que les prompts et réponses peuvent être traités par le service et ses fournisseurs amont; sa politique précise que le service n’est pas destiné aux moins de 16 ans. Pour un endpoint personnalisé, vérifier sa propre politique.
- Les réponses IA sont des pistes de lecture, pas des faits établis. Les marqueurs apparaissent en pointillés tant qu’ils ne sont pas validés. Chaque observation doit être vérifiée et cochée par l’étudiant pour être retenue dans la synthèse. Le résumé IA reste un brouillon distinct.

**OpenAlex** est une API de littérature et de métadonnées scientifiques, non un fournisseur de modèles de vision. **OmniRoute** est une passerelle dont le coût et le traitement dépendent des fournisseurs amont. RouteMe n’est pas proposé comme API d’inférence dans cet outil.

## Limites d’usage

Les interprétations sont indicatives et dépendent de la qualité des cartes et de leur géoréférencement. Le comparateur ne fabrique pas de limites cadastrales, de limites de propriété ni de zonage juridique. Utiliser les observations et faisabilités avec des données vérifiées et les règles réellement applicables au site.
