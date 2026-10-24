# Audit d’UrbaTrame — 18 octobre 2026

**État : terminé** — audit du code source, exécution des tests locaux et contrôles ciblés avec données synthétiques. Aucun service public n’a reçu de requête de test; aucune donnée de production n’a été modifiée. Aucun code applicatif n’a été corrigé.

**Référence de la copie auditée :** snapshot associé au commit `c4de4702156017dc55b63fe625846f7aa5941eb8`, d’après le contexte de travail. Le dossier d’audit ne contient pas `.git`; l’identifiant n’a donc pas pu être recalculé ni comparé à un HEAD local. `data/keys.json` et les autres données/clefs locales ont été exclus de l’inspection.

## 1. Résumé exécutif

UrbaTrame est une **application d’analyse territoriale et SIG**, et non un système de gestion universitaire. Le code contient notamment l’analyse de sites, la visualisation 3D, un atelier cartographique local, l’atelier topographique Altiplan intégré, un atlas GADM, le Cadrage spatial et un comparateur de cartes historiques S5. Les fonctions de gestion d’enseignants, d’étudiants, de notes, de jurys, de présences, de thèses ou de tutorat **ne sont pas présentes ou démontrées par cette copie**; elles ne sont donc pas évaluées comme si elles existaient.

**Résultats de qualité :** 575 tests réussis sur 575, 99 suites sans échec; la commande de lint/syntaxe a contrôlé 138 fichiers sans échec. `npm audit` n’a signalé aucune vulnérabilité dans le verrouillage racine. Le verrou Windows/Electron signale **8 vulnérabilités modérées** dans l’arbre d’outils de construction, aucune de gravité haute ou critique. Un contrôle de tableau de bord sur 20 000 points GeoJSON synthétiques a pris environ 40 ms sous Node; ce microbenchmark ne mesure ni le rendu du navigateur ni un appareil mobile.

**Risques à traiter en premier :**

1. Un identifiant de type clé/jeton est inclus dans une URL de service de tuiles du code 3D public, ainsi que dans une note technique. Sa validité et son statut contractuel n’ont pas été testés; la valeur n’est pas reproduite dans ce rapport. À vérifier et, s’il s’agit d’un secret ou d’un quota privé, à retirer et révoquer.
2. L’API de statut renvoie le catalogue complet des codes de licence; les codes d’activation sont aussi journalisés en clair. L’impact sur de vrais codes dépend du catalogue effectivement configuré, qui n’a pas été consulté.
3. Plusieurs routes cartographiques publiques appellent Overpass et/ou le service d’altitude sans limitation partagée visible. Des appels synthétiques répétés ont été acceptés et ont déclenché autant d’appels amont simulés.
4. Dans le wrapper Android, aucun sélecteur de fichier WebView n’est implémenté, alors que des flux essentiels utilisent `<input type="file">`. Selon la documentation Android, le comportement par défaut annule les demandes de fichiers.
5. Le répertoire de livraison référence un installeur Windows absent; son entrée dans `SHA256SUMS.txt` échoue. L’APK Android, lui, est présent et son empreinte correspond.
6. Les projets S5 sont conservés en mémoire de la page; l’export JSON ne contient pas les images et aucun parcours de réimport S5 n’a été trouvé. Une actualisation peut donc faire perdre une séance de travail exploitable.

**Note globale indicative pour UrbaTrame dans son périmètre SIG : 3,1/5 (62/100).** Cette note n’est ni une certification, ni une note de conformité GradAssist. La disponibilité des fonctions académiques citées plus haut est **0/5 dans le code examiné**.

## 2. Périmètre et règles d’audit

### Inclus

- Code client, API Node/Vercel, configuration et documentation fournis dans le snapshot.
- Persistance locale, import/export, validation des géométries, traitement IA facultatif et interfaces des plateformes Android/Windows.
- Tests existants, vérification syntaxique et audit des dépendances verrouillées.
- Vérifications ciblées statiques et petites démonstrations avec fausses dépendances ou données géométriques synthétiques.

### Exclus ou non démontrés

- Aucune modification ou écriture de données en production; aucun test de charge contre Overpass, NASA, Terrarium, Nominatim, GADM ou un autre service public.
- Pas d’appel à un fournisseur IA, de clé IA, de clé de licence réelle ou de catalogue de production.
- Pas de test fonctionnel dans un navigateur graphique : aucun Chromium, Chrome ou Firefox n’était installé.
- Pas de compilation/exécution Android : Java était présent, mais pas Android SDK, ADB, Gradle ou `apksigner`; `ANDROID_HOME` était absent.
- Pas de compilation ni d’exécution Windows dans un environnement Windows. Le build Windows n’a pas été lancé.
- Pas de vérification fraîche du déploiement Vercel ni de lecture de ses variables d’environnement. Les observations de déploiement antérieures constituent une baseline historique seulement.
- Pas d’analyse SAST/DAST, de scan de secrets de l’historique Git, d’essai avec lecteur d’écran ou de mesure de couverture automatisée. L’absence de `.git` empêche l’examen de l’historique du dépôt.

Les niveaux « constaté », « risque conditionnel » et « non testé » sont distingués dans les constats. L’audit n’a pas ouvert `data/keys.json` et n’a pas appelé les URLs contenant un identifiant de service.

## 3. Méthode et résultats vérifiables

| Vérification | Résultat | Portée / limite |
|---|---|---|
| Installation racine (`FM_NET=1 npm ci`) | 10 paquets installés; l’installation a annoncé zéro vulnérabilité | Ne remplace pas l’audit NPM formel |
| `npm test` | **575 réussis, 0 échec, 0 annulé, 0 ignoré**; 99 suites; environ 14,8 s | Tests locaux; pas d’e2e graphique |
| `npm run lint` | **138 fichiers contrôlés; 0 échec** | Le script est un contrôle de syntaxe/modules, pas une suite ESLint/formatage complète |
| `npm audit --package-lock-only` à la racine | **0** vulnérabilité signalée | Audit du verrou racine |
| `npm audit --package-lock-only` sous `installers/windows` | **8 modérées; 0 haute; 0 critique** | Arbre de construction Electron; aucun `npm ci` Windows ni build n’a été réalisé |
| Test de `/api/status` avec catalogue fictif | La réponse comprend `codes` et restitue l’entrée synthétique | Aucune valeur réelle n’a été lue ni reproduite |
| Test de route Cadrage avec source Overpass fictive | 3 POST synthétiques ont reçu HTTP 200 et déclenché 3 appels amont simulés; aucun champ d’authentification requis | Pas de requête réelle à Overpass; test de la route en isolation |
| Test géométrique synthétique | Le polygone auto-croisé décrit en §6 est accepté avec une aire calculée de 20 000 m²; un sommet hors plage a été écarté silencieusement | Résultat direct de `validatePerimeter` |
| Microbenchmark synthétique | 20 000 points GeoJSON, résumé de tableau de bord en **40,41 ms** | Node 20.20.2; sans DOM, carte, données raster ni appareil mobile |
| Contrôle des livrables | Empreinte APK : OK; installeur Windows listé mais absent | Le manifeste n’a pas pu valider l’installeur absent |

## 4. Évaluation par domaine

Échelle : 0 = absent; 1 = très insuffisant; 2 = risques importants; 3 = utilisable avec réserves; 4 = solide; 5 = très solide et vérifié. Les pondérations sont indicatives et portent sur **le produit SIG réel**.

| Domaine | Note | Poids | Motif principal |
|---|---:|---:|---|
| Fonctionnalités SIG dans le périmètre UrbaTrame | 4,0/5 | 20 % | Couverture large, avec plafonds, sources et limites souvent explicités |
| Tests / qualité technique | 4,0/5 | 15 % | Suite locale étendue et syntaxe vérifiée; pas de navigateur/e2e, CI ou couverture mesurée dans ce snapshot |
| Sécurité applicative et API | 2,0/5 | 15 % | Catalogue de licences renvoyé, codes journalisés et API publiques sans limite globale visible |
| Confidentialité | 3,0/5 | 10 % | Plusieurs divulgations de consentement explicites; requêtes de lieu et codes apparaissent dans les journaux, stockage local non chiffré |
| Intégrité / sauvegarde / restauration | 2,5/5 | 10 % | Imports/export bornés sur plusieurs modules; S5 non restaurable et écritures localStorage parfois silencieuses |
| Performance | 3,5/5 | 10 % | Limites de fichiers, entités et rendu; pas de charge navigateur/mobile ni de tests de charge Vercel |
| Ergonomie / accessibilité | 2,5/5 | 10 % | Responsive et attributs ARIA présents; petits textes, contraste insuffisant sur certains libellés, gestes cartographiques non alternatifs au clavier |
| Plateformes / livraison / exploitation | 2,5/5 | 10 % | Web, wrapper Windows et APK documentés; upload Android absent, installeur Windows manquant, plateformes non compilées ici |
| **Total pondéré** | **3,1/5 ≈ 62/100** | **100 %** | Indicateur de risque, pas certification |

L’IA optionnelle et la documentation SIG obtiennent une appréciation séparée plutôt favorable (**environ 4/5**) pour le choix explicite du fournisseur, la clé personnelle en mémoire, les avertissements et la validation humaine. Cela ne compense pas les défauts de sécurité, d’export/restauration ou de plateformes.

## 5. Matrice de couverture fonctionnelle

| Domaine demandé / attendu | État constaté dans UrbaTrame | Conclusion d’audit |
|---|---|---|
| Analyse de site | 46 analyses déclarées, catalogue et planification partagés; analyses de voirie, usages cartographiés, bâti, climat, relief, etc. | Présent; les conclusions dépendent de la couverture réelle des sources OSM/OBM/NASA |
| Faisabilité | Scénarios paramétrés par l’utilisateur; calcul indicatif de capacité; coûts seulement si un coût unitaire est saisi | Présent et borné; ne prouve pas un zonage ni un droit à construire |
| SIG local / couches / tableaux | GeoJSON, CSV/TSV, Shapefile, GeoPackage, GeoTIFF; tableaux, filtres, styles, ordre de couches, édition locale et exports | Présent, avec plafonds documentés; fonctionnement mobile Android incomplet pour l’import |
| Altiplan | Section intégrée : extraction OSM/relief, plans, coupes, maquette et notes locales; atlas GADM | Présent comme partie intégrée d’UrbaTrame, pas comme application distincte |
| Cadrage spatial | Quatre niveaux, GADM/OSM, couches locales, annotations, sauvegarde JSON, SVG/PNG/JPEG et impression navigateur | Présent; validation des polygones à renforcer; PDF = impression/enregistrement PDF du navigateur, pas générateur PDF autonome |
| Comparaison historique S5 | Deux images, géoréférencement affine manuel par points de contrôle, superposition, annotations, PNG/JSON | Présent mais session volatile et JSON sans images ni réimport |
| IA | Assistant principal local déterministe; IA externe optionnelle avec fournisseur, clé, consentement, divulgation des données et contrôle étudiant | Gouvernance plutôt bonne; S5 IA n’effectue pas elle-même le géoréférencement ni la superposition |
| Exports | SVG/PNG, DXF, OBJ/STL, GeoJSON et projets JSON selon les modules; impression vers PDF dans le navigateur | Bon choix de formats SIG/DAO; formats Office/rapport automatiques non constatés |
| Gestion universitaire | Pas de modèle d’enseignants, comptes d’étudiants, notes, présence, jury, thèse, tutorat ou notifications | **Absent/non démontré**; ne pas présenter le suivi des 14 séances comme un système de gestion académique |
| Hors-ligne et synchronisation | Pas de service worker repéré; wrappers Android/Windows chargent le service distant; données locales non synchronisées | « Local » décrit surtout le stockage et le traitement de certaines données, pas un fonctionnement hors-ligne complet |
| iOS / mobile | APK Android disponible; pas d’application iOS constatée | iOS non démontré; Android à corriger et tester sur appareil |

## 6. Constats et anomalies détaillés

### UT-SEC-01 — Identifiant de service de tuiles intégré au code public

- **Gravité :** moyenne à majeure selon la nature et les droits associés à l’identifiant. **Priorité : P0 pour vérification. Statut : présence confirmée; validité/influence non testées. Effort : 1–4 h, hors procédure fournisseur.
- **Preuve :** `public/js/vue3d-ui.mjs:320` et `docs/reverse-osmbuildings.md:51` contiennent une URL de tuiles avec un segment fixe ressemblant à une clé/jeton. L’URL peut être lue par tout utilisateur téléchargeant le JavaScript. La valeur est volontairement masquée dans ce rapport.
- **Reproduction sûre :** inspecter les deux lignes du snapshot; aucune requête n’a été faite au fournisseur et aucune valeur n’est reproduite ici.
- **Impact possible :** si le segment confère un quota ou un accès privé, il est exposé et peut être réutilisé; sinon, il reste contraire à la règle de ne pas embarquer de jeton dans le code.
- **Action :** confirmer auprès du fournisseur s’il s’agit d’un identifiant public documenté. Dans le doute, le révoquer/remplacer, retirer des fichiers publics et de la documentation; utiliser un proxy serveur configuré par variable d’environnement, ou une méthode officiellement sans secret. Vérifier l’historique Git complet dès qu’une copie avec `.git` est disponible.

### UT-SEC-02 — Catalogue de licences public et codes d’activation journalisés en clair

- **Gravité au moment de l’audit :** majeure si le catalogue contenait des codes réels. **Statut : corrigé dans le snapshot courant; déploiement Vercel et éventuels codes d’environnement non vérifiés.**
- **Constat initial :** `GET /api/status` exposait `licence.knownCodes()`, les journaux contenaient le code fourni et le démarrage énumérait le catalogue. L’audit n’a consulté aucun catalogue de production.
- **Correction locale :** le champ `codes` a été supprimé de `/api/status`; les journaux n’écrivent plus la valeur des codes ni la liste au démarrage; les codes de démonstration ne sont pas chargés par défaut en production/Vercel. Les paliers Pro/Max disposent maintenant d’un fichier `.utlic` signé, vérifié par une clé publique d’émetteur distincte.
- **Validation :** tests API et tests `.utlic` confirment l’absence de liste publique, le refus des titres altérés et l’activation locale d’un titre synthétique. Aucun vrai code ni secret de production n’a été consulté.
- **À vérifier avant mise en vente :** variables `FM_CODES`, `FM_LICENSE_PUB`, `FM_SIGNING_KEY`, l’historique des journaux de l’hébergeur et toute émission antérieure. Une révocation centralisée n’est pas incluse dans le modèle actuel.

### UT-SEC-03 — Routes publiques d’extraction sans limitation globale visible

- **Gravité :** majeure pour le coût, la disponibilité et les quotas des services amont. **Priorité : P0 avant forte exposition publique. Statut : confirmé dans le code et avec sources factices. Effort : 1–3 jours.**
- **Preuve :** `server/atelier-api.mjs:43–70` valide la requête puis appelle directement `overpassSource` et, sauf option, `terrainSource`; les routes Altiplan/Cadrage sont déclarées publiques et hors du quota principal (`:1–3`). Les limites de taille Cadrage (`:82–100`) sont calculées **après** la réponse d’Overpass. Aucune limite partagée par IP/compte n’est visible dans ce gestionnaire. Le refroidissement principal de `server/quota.mjs` protège les analyses `/analysis/2d`, pas ces routes. Sur Vercel, les états en mémoire ne fournissent pas une limite globale.
- **Reproduction sûre :** trois requêtes synthétiques valides sur le gestionnaire Cadrage, avec un faux fournisseur, ont toutes obtenu HTTP 200 et déclenché trois appels amont simulés; aucun service cartographique public n’a été contacté.
- **Impact :** balayage automatisé de coordonnées, coûts/invocations serverless, surcharge d’Overpass/du relief et dégradation pour les utilisateurs légitimes.
- **Action :** ajouter un limiteur partagé ou un contrôle de débit au niveau d’un edge/WAF, avec budget quotidien par route, plafond de concurrence, cache de requêtes identiques à durée courte et circuit-breaker. Garder les usages publics légitimes mais monitorer coûts et taux d’erreur. CORS restrictif peut réduire l’usage depuis les navigateurs, mais ne remplace pas le rate limiting.

### UT-CONF-01 — Le mode d’accès par défaut ouvre toutes les analyses sans quota

- **Gravité :** majeure uniquement si une restriction commerciale ou une limite d’usage est attendue; sinon décision de produit explicitement documentée. **Priorité : P0 avant vente/licences; risque accepté si l’accès libre est voulu. Statut : confirmé dans la configuration du code; déploiement réel non vérifié. Effort : <1 h pour valider la configuration, davantage pour un quota partagé.**
- **Preuve :** `server/config.mjs:20–28` utilise `FM_ACCESS=open` par défaut; `docs/ACCES.md` indique l’ouverture de toutes les analyses sans licence, quota ni filigrane. `FM_ACCESS=licence` rétablit le découpage prévu, mais le quota demeure en mémoire selon `docs/VERCEL.md`.
- **Impact :** si le mode attendu n’est pas l’essai public, des analyses et appels amont restent ouverts; le client ne constitue pas une barrière de protection. La variable Vercel de production n’a pas été consultée.
- **Action :** choisir explicitement le mode dans chaque environnement et vérifier le champ `access` lors d’une revue contrôlée; si l’ouverture est intentionnelle, la traiter comme une API publique et mettre en place les limites du constat UT-SEC-03. Avant de rétablir les licences commerciales, ajouter quota partagé, révocation et livraison sûre des codes.

### UT-PRIV-01 — Requêtes de géocodage conservées dans les journaux serveur

- **Gravité :** moyenne. **Priorité : P2. Statut : confirmé statiquement; rétention de l’hébergeur non vérifiée. Effort : 2–4 h.**
- **Preuve :** `server/api.mjs:46–50` journalise la requête de lieu complète après géocodage. Une recherche peut contenir une adresse, un lieu de travail ou un renseignement personnel. Les journaux de quota peuvent aussi inclure l’IP cliente (`server/api.mjs` et `server/http.mjs`).
- **Reproduction :** lire la branche `geocode` et son appel `log`; aucune recherche personnelle n’a été envoyée pendant l’audit.
- **Impact :** conservation involontaire d’indices de localisation dans les logs, hors du contrôle de l’interface « local » et potentiellement plus longtemps que le cache local.
- **Action :** supprimer la chaîne de recherche des logs; préférer un code de résultat, une durée et un identifiant de trace. Publier un tableau consolidé indiquant destinataires, données transmises, durée de conservation et moyens d’effacement.

### UT-PLAT-01 — Le wrapper Android ne fournit pas de sélecteur de fichiers WebView

- **Gravité :** majeure pour les parcours SIG et S5 sous Android. **Priorité : P1 avant nouvelle distribution Android. Statut : omission confirmée dans le code; comportement non reproduit sur appareil. Effort : 0,5–1,5 jour, tests compris.**
- **Preuve :** `installers/android/app/src/main/java/com/urbatrame/app/MainActivity.java:77–84` crée un `WebChromeClient` qui ne surcharge que `onProgressChanged`; aucune méthode `onShowFileChooser` n’est présente. Or l’import SIG et S5 reposent sur des `<input type="file">`, notamment `public/atelier-s5.html:52–53,69–70` et l’atelier cartographique.
- **Reproduction attendue :** dans l’APK, toucher « choisir une image » ou l’import d’une couche locale. L’audit ne l’a pas exécuté sur téléphone. La documentation Android précise que le comportement WebView par défaut **annule toutes les demandes de fichiers** quand le client ne traite pas `onShowFileChooser`.
- **Impact :** les utilisateurs Android ne peuvent pas charger les cartes et données locales qui fondent ces fonctionnalités; l’export de fichiers, lui, dispose d’un pont natif distinct.
- **Action :** implémenter `onShowFileChooser` avec `ACTION_OPEN_DOCUMENT`/`FileChooserParams`, gestion du callback, annulation et types multiples adaptés; valider les URI et tester PNG/JPEG/WebP, GeoJSON, ZIP Shapefile et GeoPackage sur versions Android supportées.
- **Référence :** [Android — WebChromeClient.onShowFileChooser](https://developer.android.com/reference/android/webkit/WebChromeClient#onShowFileChooser(android.webkit.WebView,android.webkit.ValueCallback,android.webkit.WebChromeClient.FileChooserParams)).

### UT-PLAT-02 — L’installeur Windows est annoncé mais absent des livrables

- **Gravité :** majeure pour la distribution Windows. **Priorité : P1 avant de communiquer cette livraison. Statut : confirmé par inventaire et checksum. Effort : 0,5–2 jours, hors obtention d’un certificat.**
- **Preuve :** `release-files/INSTALLATION.txt:8–13` annonce `windows/UrbaTrame-Setup-1.0.1.exe`; `release-files/SHA256SUMS.txt` contient aussi son empreinte. Le fichier `release-files/windows/` est absent. `sha256sum -c` valide l’APK Android mais échoue à ouvrir le fichier Windows.
- **Impact :** la procédure d’installation Windows ne peut pas être suivie à partir de ces fichiers; la somme publiée ne vérifie aucun binaire Windows. Le binaire n’a pas été reconstruit dans le cadre de cet audit.
- **Action :** construire sur une chaîne Windows/CI contrôlée, examiner l’artefact, générer à nouveau le checksum et le publier au chemin attendu; envisager une signature éditeur. À défaut, retirer temporairement l’étape Windows du manifeste de téléchargement.

### UT-DATA-01 — La session S5 n’a pas de sauvegarde restaurable complète

- **Gravité :** majeure pour une séance de travail longue. **Priorité : P1. Statut : confirmé par le modèle d’état/export; pas de session graphique simulée. Effort : 2–4 jours.**
- **Preuve :** `public/js/atelier/s5-comparison.mjs:10–31` conserve images, points, transformations, observations et synthèses dans un objet en mémoire; aucun usage de `localStorage`/IndexedDB n’a été trouvé dans ce module. L’export JSON `:899–965` dit explicitement que les images n’y figurent pas; aucun contrôle d’import S5 n’est présent dans `public/atelier-s5.html`. `pagehide` révoque les URL et efface notamment les observations (`:1059–1063`).
- **Reproduction :** charger deux cartes, saisir les points de contrôle et des annotations, puis recharger/fermer l’onglet; la session vivante n’est pas restaurée. L’export JSON seul ne reconstitue pas les images ni l’état d’édition.
- **Impact :** perte de calibration/annotations à la fermeture, restauration manuelle coûteuse et impossibilité de reprendre fidèlement un projet à partir de ses exports actuels. Le suivi des 14 séances peut exporter son JSON, mais aucun import de restauration n’a été repéré non plus; sa sauvegarde locale reste liée au navigateur.
- **Action :** ajouter un format de projet versionné importable, conserver métadonnées/points/résidus/état validé, et fournir les images en pièce jointe/paquet local ou référencer des fichiers choisis avec réassociation explicite. Prévoir autosauvegarde locale avec avertissement de capacité, effacement et export de secours. Ajouter un import contrôlé du suivi des séances si la restauration sur un autre navigateur/appareil est requise. Ne pas téléverser les images sans consentement séparé.

### UT-DATA-02 — Échec d’écriture `localStorage` silencieux, malgré un message de succès

- **Gravité :** moyenne. **Priorité : P2. Statut : confirmé dans le code; cas de quota plein/non autorisé non reproduit dans un navigateur. Effort : 2–4 h.**
- **Preuve :** `public/js/persist.mjs:61–64` intercepte puis ignore toute erreur de `localStorage.setItem`. `public/js/app.js:1345–1350` affiche ensuite « Projet enregistré dans ce navigateur » sans vérifier l’écriture; le même motif est employé pour les modèles et l’import.
- **Impact :** en stockage plein, restreint ou désactivé, l’utilisateur peut quitter la page en croyant que son projet est conservé alors qu’il ne l’est qu’en mémoire.
- **Action :** faire retourner un résultat explicite par `store.set`, vérifier la relecture après écriture, afficher un statut d’échec et proposer immédiatement un export JSON. Ajouter un test avec un faux `localStorage` qui lève `QuotaExceededError`.

### UT-GEO-01 — Les polygones auto-croisés et sommets invalides ne sont pas refusés proprement

- **Gravité :** moyenne pour l’intégrité des mesures/export. **Priorité : P2. Statut : confirmé par test synthétique. Effort : 4–8 h avec tests.**
- **Preuve :** `public/js/spatial-framing-core.mjs:89–94` filtre les positions invalides dans `openRing`; `validatePerimeter` contrôle le nombre de sommets, l’aire signée et la distance, mais pas l’auto-intersection (`:145–165`).
- **Reproduction :** autour d’un centre WGS84 `(lat 36,75; lon 3,04)`, prendre les sommets exprimés en mètres locaux `[(0,0),(400,300),(0,400),(300,0)]` puis les convertir en WGS84. Les segments se croisent; `validatePerimeter` renvoie `ok: true` et une aire signée de 20 000 m². En ajoutant au tableau un sommet hors plage `[999,999]`, il est écarté sans avertissement et le contour restant est accepté.
- **Impact :** un cadrage qui semble valide peut avoir une surface erronée, changer silencieusement à l’import et produire une carte ou un export trompeur. Ce constat porte sur l’intégrité géométrique, pas sur une frontière juridique ou cadastrale.
- **Action :** refuser tout sommet invalide au lieu de le supprimer silencieusement; tester les auto-intersections, segments nuls, doublons et anneaux dégénérés avant calcul/export. Afficher une erreur localisée à l’utilisateur.

### UT-A11Y-01 — Lisibilité, cible de commande et interaction clavier à compléter

- **Gravité :** moyenne; conformité WCAG globale non mesurée. **Priorité : P1 avant une diffusion largement accessible. Statut : problèmes statiques identifiés; aucun test lecteur d’écran. Effort : 2–4 jours avec revue manuelle.**
- **Preuves :** `public/atelier-analyse.css:15,59,74–75` définit certains libellés à 7–8 px en gris clair; `#8e9990` sur blanc vaut environ **2,95:1**, `#879288` environ **3,23:1**. `public/atelier-cartographique.css:162–163` rend les boutons de réordonnancement 22×14 px. `public/atelier-s5.html:112` expose la carte de comparaison via un canvas; les points de calage/annotations sont placés par clic. Dans `public/js/app.js:1234–1247`, l’ouverture d’une boîte de dialogue place le focus et sa fermeture le rend, mais aucun confinement du focus n’est visible; les dialogues portent `aria-modal="true"` dans `public/index.html`.
- **Impact :** libellés très petits/faiblement contrastés difficiles à lire; commandes rapprochées difficiles au tactile; la calibration et le placement sur canvas ne sont pas équivalents au clavier; le focus peut quitter une boîte de dialogue déclarée modale.
- **Action :** augmenter taille et contraste des textes informatifs, viser au moins 4,5:1 pour le texte courant, agrandir/espacer les commandes, fournir des contrôles alternatifs clavier pour les points image et les observations, rendre l’arrière-plan inerte et confiner le focus dans les dialogues. Tester zoom 200 %, clavier seul, lecteur d’écran et tailles mobiles.
- **Références :** [WCAG 2.2 — contraste minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html); [WCAG 2.2 — taille minimale des cibles](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html); [WAI-ARIA APG — boîte de dialogue modale](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/). Les critères de cible ont des exceptions de taille/espacement; ce constat appelle un vrai contrôle des espacements, pas seulement une comparaison des dimensions.

### UT-SEC-04 — En-têtes de sécurité de navigateur incomplets ou non configurés ici

- **Gravité :** moyenne (durcissement; aucun exploit XSS/clickjacking n’a été établi). **Priorité : P2. Statut : absence dans la configuration fournie confirmée; en-têtes éventuellement ajoutés par l’hébergeur non vérifiés. Effort : 2–6 h.**
- **Preuve :** `vercel.json:21–61` ne configure que des en-têtes de cache et de type WASM. `server/http.mjs:32–46` ajoute `nosniff` aux réponses JSON, mais `serveStatic` (`:88–98`) ne définit que le type, une trace, CORS et cache. Aucun CSP, `frame-ancestors`, politique de référent ou politique de fonctionnalités n’est configuré dans les fichiers examinés; HSTS dépend de l’hébergeur et n’a pas été contrôlé en ligne.
- **Impact :** défense en profondeur réduite contre une injection de script, un affichage en iframe ou des accès de fonctionnalités navigateur non nécessaires. L’absence de CSP ne démontre pas une faille XSS.
- **Action :** déployer d’abord CSP en mode `Report-Only`, inventorier les scripts/styles/données cartographiques autorisés, puis appliquer une politique compatible; ajouter `frame-ancestors`, `Referrer-Policy`, `Permissions-Policy` et `Strict-Transport-Security` au niveau approprié. Revalider les téléchargements et les fournisseurs IA après changement.

### UT-DEP-01 — Vulnérabilités modérées dans la chaîne de construction Windows

- **Gravité :** modérée, limitée au graphe de construction Electron selon le verrou audité. **Priorité : P2. Statut : signal NPM confirmé le 18/10/2026. Effort : 2–4 h de mise à niveau et vérification.**
- **Preuve :** `npm audit --package-lock-only` sous `installers/windows` compte 8 vulnérabilités modérées, 0 haute et 0 critique. Le graphe passe notamment par `sprintf-js` (DoS par précision non bornée, GHSA-hp3w-g68c-fv3c) et des paquets `electron-builder`/`app-builder-lib`. La dépendance concernée est de construction et n’est pas utilisée par les analyses Node racine.
- **Impact :** exposition de l’environnement qui fabrique l’installeur si des entrées malveillantes atteignent la chaîne; pas de vulnérabilité de dépendance runtime racine signalée par le même contrôle.
- **Action :** examiner l’avis et la version corrective proposée par NPM, valider compatibilité du builder puis mettre à jour le verrou. Ne pas appliquer automatiquement un downgrade sans test. Réexécuter `npm audit` et le build Windows après la correction.
- **Référence :** [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c).

### UT-FUNC-01 — La contribution IA au géoréférencement/superposition S5 est partielle

- **Gravité :** moyenne comme écart fonctionnel à la demande, pas comme défaut de sécurité. **Priorité : P2 / arbitrage produit. Statut : comportement du code confirmé. Effort : 1–3 jours selon le périmètre.**
- **Preuve :** le géoréférencement et la superposition sont manuels et vérifiables par points de contrôle. Le prompt IA de `public/js/atelier/s5-comparison.mjs:750–754` demande explicitement au modèle de ne pas géoréférencer ni prétendre à l’exactitude; il propose au plus six observations sur l’image historique. Les suggestions restent non validées jusqu’à revue humaine.
- **Impact :** la comparaison et la synthèse IA existent, mais l’IA ne propose ni points de calage, ni alignement, ni carte/overlay de synthèse généré par IA. La partie « aide IA à la superposition » n’est donc pas satisfaite par le code courant.
- **Action :** soit documenter que la superposition reste entièrement manuelle, soit ajouter une proposition facultative de points/transformations indicatifs, avec résidus mesurables, sources et dates affichés, aucune géométrie automatique publiée, et validation explicite par l’étudiant. Aucun contour cadastral ou juridique ne doit être inféré.

### UT-DOC-01 — Quelques nombres documentaires et messages de démarrage sont obsolètes

- **Gravité au moment de l’audit :** mineure. **Statut : corrigé dans le snapshot courant; déploiement non vérifié.**
- **Constat initial :** les commentaires de configuration et l’exemple API annonçaient des nombres différents du catalogue/runtime.
- **Correction locale :** commentaires actualisés à 5 analyses gratuites; l’exemple `docs/API.md` affiche désormais 4 miroirs Overpass et le schéma de statut sans catalogue de codes.
- **Validation :** matrice Pro/Max et comptage du catalogue ajoutés aux tests; l’exemple et les commentaires ont été relus localement.

## 7. Contrôles positifs et mesures de protection déjà en place

- L’assistant spatial principal est une correspondance déterministe locale; il ne fait pas d’appel de modèle ou de géocodage implicite.
- Les appels IA externes sont facultatifs, déclenchés par action et consentement; la clé est saisie en mémoire et n’est pas enregistrée dans les projets. S5 réduit les images pour l’envoi, affiche fournisseur/modèle/données, n’effectue pas de bascule automatique et demande une validation des propositions.
- Les interfaces et guides expliquent les coûts, quotas, rétention et conditions variables des fournisseurs; OpenAlex y est distingué d’un service d’inférence.
- Les règles de produit interdisent de fabriquer limites cadastrales/juridiques et zonage réglementaire. La faisabilité utilise les paramètres entrés par l’utilisateur.
- Les imports SIG sont limités par taille, nombre d’entités, positions et pixels; le rendu vectoriel est plafonné et prévient lorsque l’aperçu est tronqué.
- Les projets principaux ont des formats versionnés et validés; le Cadrage spatial propose import/export JSON; le projet de couches locales a une sauvegarde de projet. Certains exports signalent les éléments absents.
- La persistance principale et les notes Altiplan restent locales; un cache de requêtes possède un TTL de sept jours et une action d’effacement du cache existe.
- Les sources et attributions OpenStreetMap/OBM/GADM sont documentées; le GeoTIFF et `sql.js` sont vendoriés avec leurs licences/avis tiers, sans CDN pour ces lecteurs.
- Le wrapper Windows active `contextIsolation`, `sandbox` et `webSecurity` et désactive `nodeIntegration` (`installers/windows/main.cjs`). Android désactive le trafic HTTP en clair et la sauvegarde automatique, et possède un chemin d’export natif.
- L’APK présent correspond au checksum fourni. Le Dockerfile exécute l’application sous un utilisateur non privilégié.

## 8. Plan d’action priorisé

| Échéance | Actions | Critère de clôture |
|---|---|---|
| **P0 — avant l’usage de vrais codes ou d’un quota fournisseur privé** | Confirmer/retirer le jeton de service embarqué (UT-SEC-01); **corriger localement** l’exposition des codes et les journaux (UT-SEC-02), puis vérifier les paramètres d’environnement et journaux Vercel; ajouter limites partagées et budget aux routes publiques (UT-SEC-03); confirmer explicitement `FM_ACCESS` et les budgets de production (UT-CONF-01). | Aucun secret dans code public/logs; `/api/status` sans code; charges répétées contrôlées; environnement de production vérifié par une personne autorisée. |
| **P1 — prochaine distribution** | Ajouter le file picker Android (UT-PLAT-01), livrer ou retirer l’installeur Windows absent (UT-PLAT-02), fournir sauvegarde/import complet S5 (UT-DATA-01), corriger les interactions accessibles de base (UT-A11Y-01). | Imports réellement exécutés sur appareil Android; binaire/checksum Windows cohérents; S5 exporté puis réimporté avec images et annotations; parcours clavier/zoom vérifié. |
| **P2 — sprint technique suivant** | Valider/faire échouer les polygones invalides (UT-GEO-01), signaler les erreurs de stockage local (UT-DATA-02), limiter les logs de géocodage (UT-PRIV-01), ajouter les en-têtes de sécurité (UT-SEC-04), traiter l’audit des dépendances Windows (UT-DEP-01). | Tests automatisés nouveaux; erreurs visibles; politique d’en-têtes validée en staging; audit NPM sans avis non accepté. |
| **P3 — cohérence et finalisation produit** | Aligner les nombres d’analyses/miroirs dans les docs (UT-DOC-01); décider/documenter le périmètre exact d’IA S5 (UT-FUNC-01); publier une page centrale des flux, stockage, effacement et rétention. | Documentation vérifiée contre le code et les configurations de déploiement. |

## 9. Informations à fournir pour la phase de validation suivante

Aucune information n’est nécessaire pour clôturer cet audit du snapshot. Pour la prochaine validation avant publication, il faudra disposer de :

1. Un environnement de staging avec ses variables visibles à un administrateur autorisé — sans publier de codes de licence, clé privée ou jeton dans le dépôt ou le rapport.
2. Un téléphone Android 10+ et le SDK Android pour construire/tester le file picker et tous les formats d’import/export.
3. Un environnement Windows contrôlé pour produire et tester l’installeur, puis signer le fichier si une signature commerciale est disponible.
4. Une copie Git complète, si l’on souhaite analyser aussi l’historique des secrets et la provenance des changements.
5. Un choix produit explicite : accès volontairement ouvert avec limites anti-abus, ou activation de paliers et quotas réellement partagés.

**Livrable :** `docs/AUDIT-URBATRAME-2026-10-18.md`. Seul ce rapport est ajouté par cette tâche; les sources applicatives restent inchangées.
