# Journal des modifications — 3ᵉ passe de corrections ciblées

**Dossier** : `/home/user/audit/` · **Date** : 2026-11-06 · **Commit audité** : `fb2defa618f82a176cb58627feffe2a2b6d67391` (main, `freemind25/UrbaTrame`, dépôt public MIT)
**Source des preuves** : clone frais anonyme `git clone --depth 1 https://github.com/freemind25/UrbaTrame.git /home/user/urbatrame-fb2defa` (HEAD = `fb2defa` vérifié) — le bac à sable ayant été réinitialisé ~15:10 (perte du `.git` et de `public/js/` locaux), les références fichier:ligne ont été re-relevées sur ce clone du commit audité. Prod : `https://freemap-rose.vercel.app` (lecture seule, inchangée — l'application elle-même n'est PAS modifiée ; la CSP est une proposition).
**Avis externe** : les 3 fichiers d'avis reçus ont le même MD5 (`bff008d91ce126e572e4d2cf66c54f09`) → aucun nouvel avis ; cette passe applique les 5 points demandés + le nettoyage.

| Point | Fichier modifié | Avant → Après | Commande / preuve (commit `fb2defa`, 2026-11-06) |
|---|---|---|---|
| 1 · Solaire 18 cas | `precision-calculs.csv` | 2 lignes solaires contradictoires (doublon « 88,13° vs 88,0° → EoT négligée ») → **1 ligne unique** : 18 cas (3 dates × 2 lat × 3 h UTC), écart max app↔NOAA+EoT = **0,43° élév. / 0,64° azim.** (hors zénith) ; sans EoT l'écart atteindrait 2,05°/3,39° → **EoT incluse** | `node scripts/calcul-soleil-18cas.mjs` → `scripts/resultat-soleil-18cas.csv` (18 lignes + max) |
| 1 · Preuve code EoT | `registre-constats.csv` → `constats-positifs.csv` (A-13) | A-13 « suggestion : EoT négligée (~±2°/±4°) » → **A-13 positif : EoT incluse via l'ascension droite**, preuve `site-analysis.mjs:611` « `let H = gmst + lon * D2R - alpha ;` » (même modèle `vue3d.js:47`) | grep/sed sur le clone `fb2defa` |
| 1 · Harmonisation | `matrice-tests.csv` T-28, T-43 (+ nouveau T-52) | « app néglige l'EoT » → « écart max 0,43°/0,64° vs NOAA+EoT ; sans EoT 2,05°/3,39° → EoT incluse » | idem |
| 1 · Harmonisation | `rapport-audit.md` point clé n°7 + note axe 1 | « soleil 88,13° vs 88,0°, EoT négligée (A-13 suggestion) » → « 18 cas, écart ≤0,5°, EoT incluse (`site-analysis.mjs:611`), A-13 levé » | idem |
| 2 · Journal réseau complet | `securite-confidentialite.md` (réécrit) | journal à 9 lignes « 3 flux tiers » → **journal complet en 4 blocs** : (A) 3 flux auto navigateur (OSM `map.mjs:148`/`vue3d-ui.mjs:137,148`, GADM `gadm.mjs:377,401`, Overpass direct `routes.mjs:11-16,122,159` si mode licence) ; (B) flux sur action (`a.data.osmbuildings.org` `vue3d-ui.mjs:391`, IA `local-layers-ui.mjs:1482,1545`, services perso, liens) ; (C) 7 amonts du proxy same-origin (incl. **`vectortiles.openbuildingmap.org` côté serveur uniquement** `server/sources/openbuildingmap.mjs:43`) ; (D) **`openfreemap.org` cité (`index.html:281-282`) mais jamais appelé** → crédit à corriger. Chaque ligne : fichier:ligne, déclencheur (auto/action), canal (fetch/image/tuiles vectorielles/navigation), données transmises. Méthode marquée **« statique seulement »** (pas de navigateur ici) ; `page.on('request')` reste demandé dans le second prompt | `grep -rnoE 'https?://…' public/ server/` + script Python d'extraction hôte/fichier:ligne/contexte sur le clone |
| 2 · Décompte corrigé | `rapport-audit.md` point clé n°3 + note axe 7 ; `matrice-tests.csv` T-41 (+T-49) ; `dependances-apis-quotas.csv` | « aucun appel de données vers l'extérieur / 3 flux tiers / routes.mjs:121 » → « 0 appel de données métier externe **hors flux documentés** ; 3 flux auto navigateur + flux sur action + 7 amonts proxy ; en prod open l'essai gratuit passe par le proxy serveur ; openfreemap.org : aucun appel » ; références de lignes corrigées (`routes.mjs:122,159` et non :121) | grep + curl `/api/status` |
| 3 · CSP réaliste | `securite-confidentialite.md` §CSP (nouveau) ; `registre-constats.csv` A-02 ; `feuille-de-route.md` item 1 ; `matrice-tests.csv` T-51 | « CSP default-src 'self' + img-src OSM » → **CSP complète par directive** : `script-src 'self' 'wasm-unsafe-eval'` (sql.js wasm : `local-layers-ui.mjs:76-78` + `vendor/sql.js`, MIME wasm déjà OK dans `vercel.json`), `style-src 'self' 'unsafe-inline'` (`<style>` inline), `img-src 'self' data: blob: tile.openstreetmap.org gadm.org`, `connect-src 'self'` + 5 miroirs Overpass + `a.data.osmbuildings.org` + `openrouter.ai`/`api.apinex.bond` (+ note endpoint perso), `worker-src 'self' blob:` (0 Worker trouvé), `font-src 'self'` (0 police externe), `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`, `form-action 'self'` + nosniff/Referrer-Policy/Permissions-Policy. **Déploiement : `Content-Security-Policy-Report-Only` 1 semaine puis bloquant.** Proposition uniquement — appli non modifiée | greps sur le clone (`sql.js`, `new Worker`, `fonts.googleapis`, `createObjectURL`, `toDataURL`, `<style`, hosts) |
| 4 · Chemin essai gratuit | `registre-constats.csv` A-06 (réécrit) + **A-14 reclassé mineur → MAJEUR** ; `rapport-audit.md` point clé n°6 + axe 14 ; `matrice-tests.csv` T-46 (+T-50) ; `dependances-apis-quotas.csv` ; `inventaire-fonctionnel.csv` F-016/F-052 | « free non throttlé, contournable, mineur » → « prod `access:"open"` (curl `/api/status` 2026-11-06) : essai gratuit servi par le **proxy serveur sans aucun quota** (begin open sans gate `api.mjs:177-190`, free = liste blanche seule `api.mjs:199-204`, `quota.gate` licences/étudiants seuls `:155,205`, **`query` sans gate `api.mjs:227-242`**, TTL 5 min `config.mjs:81`) → risque de **bannissement de l'IP Vercel** par les miroirs Overpass = indisponibilité pour tous → **A-14 majeur**. Overpass direct navigateur (`routes.mjs:122,159`, `app.js:1250`) si `FM_ACCESS=licence` (`config.mjs:26-30`, `app.js:1192`) ou repli serveur en échec (`app.js:1244-1252`) | lecture `app.js:1187-1205,1234-1260`, `api.mjs:128-242`, `config.mjs`, `quota.mjs` + `curl -s …/api/status` |
| 5 · Second prompt | `prompt-verifications-dynamiques.md` §1/§2/§5 | test « SSRF » → **« sécurité des services distants (CORS, contenu mixte, accès réseau local depuis le navigateur) »** + note « SSRF serveur écarté par audit statique (`server/gadm.mjs:15-45`) » ; ajout **environnement de test OTP** (instance locale/adresse de test, jamais de vrais e-mails ni verrouillage IP prod) ; attentes réseau mises à jour (liste des domaines attendus, `page.on('request')` ou « statique seulement », openfreemap.org absent attendu) | édition du fichier |
| Nettoyage | `rapport-audit.md` §4 | « 42 scénarios » → **53 scénarios** (T-01…T-53) | `grep -c '^T-' matrice-tests.csv` = 53 |
| Nettoyage | `registre-constats.csv` | **A-11/A-12 ajoutés comme numéros réservés** (aucun constat ; numérotation conservée pour les références de l'avis) | édition |
| Nettoyage | `constats-positifs.csv` (nouveau) | constats « Positif » (A-15…A-18) **séparés du registre des anomalies** ; A-13 (levé) y est aussi rangé | copie depuis registre + A-13 |
| Nettoyage | `precision-calculs.csv` | **doublons supprimés** (2ᵉ ligne « distance 1° lat/lon » WGS84-méridien et 2ᵉ ligne solaire remplacées par les lignes Vincenty/NOAA uniques + ligne 18 cas) | réécriture du CSV |
| Nettoyage | `audit-UrbaTrame-complet.md` + `Rapport de vérification UrbaTrame — 2026-11-06.md` (régénérés) | en-tête « second prompt … (section 12) » → **(section 11)** (le prompt est la 11ᵉ section du sommaire) ; sommaire refait avec 13 sections (ajout `constats-positifs.csv` et `journal-des-modifications.md`) ; tout le contenu resynchronisé | script Python de concaténation (voir ci-dessous) |
| Nettoyage | `annexes-commandes.md` | ajout note source (clone `urbatrame-fb2defa` @ `fb2defa` après réinitialisation du bac) + **section A-07** : commandes et résultats de la 3ᵉ passe, chacune avec commit `fb2defa` et date 2026-11-06 | `git clone --depth 1 …` + `git log -1` + commandes listées |
| Livrable | `journal-des-modifications.md` (ce fichier) | créé | — |

**Points impossibles ici et pourquoi** : capture réseau navigateur réelle (Playwright `page.on('request')`) — pas de navigateur dans le bac à sable → marqué « statique seulement » et délégué dans `prompt-verifications-dynamiques.md` §1 ; modification de l'application (CSP, rate-limit) — audit en **lecture seule** sur le dépôt → la CSP et le correctif A-14 restent des **propositions** dans ce dossier.

**Régénération des bundles** (2026-11-06) :
```
python3 - <<'PY'   # concaténation dans l'ordre du sommaire, séparateurs « # ## N. … »
ordre = [rapport-audit.md, registre-constats.csv, constats-positifs.csv, matrice-tests.csv,
         precision-calculs.csv, inventaire-fonctionnel.csv, securite-confidentialite.md,
         dependances-apis-quotas.csv, feuille-de-route.md, fonctionnalites-mortes-ou-manquantes.csv,
         annexes-commandes.md, prompt-verifications-dynamiques.md, journal-des-modifications.md]
→ audit-UrbaTrame-complet.md  puis  copie  « Rapport de vérification UrbaTrame — 2026-11-06.md »
PY
```

## 2026-11-06 — P2 polish + vérification navigateur (branche `design/p2-polish`, commit `a21749d`, parent `30f61a0`)

| Fichier | Avant → Après | Preuve |
|---|---|---|
| `public/js/renderers-boards.js` | 6 palettes UI : texte < 4,5:1 et traits < 3:1 → hue-preserving, texte ≥ 4,6:1, traits ≥ 3,1:1 vs fond carte | script contraste Python, tests 799/799 |
| `test/renderers.test.mjs` | 2 hex épinglés (`#D97559`…) → nouveaux hex | `node --test test/` 799/799 |
| `public/tokens.css` | + `h1,h2{text-wrap:balance}`, `p,.lede,.lead{text-wrap:pretty}`, tokens `--trigger-amber/--trigger-green` | commit `a21749d` |
| `public/styles.css` + 6 feuilles page | skip-link `outline:#2e6b52` (2,73:1 sombre) → `var(--ring)` (11,08:1) ; badge/header/inputs/boutons contrastés les 2 thèmes ; `html{scrollbar-gutter:stable}` ; min-hauteurs `#log`/`#dataPreview`/`#catalog` ; `.tool-hint` ligne fixe ; `.sr-only` + h1 | axe-core 0 violation, CLS 0,36→0,003 |
| `public/index.html` | labels réels `#radius/#shape/#time`, aria-label `#q/#workspaceName`, h1 sr-only dans `<main>` | axe 0 violation |
| 6 pages html | `aria-label` marque retiré (texte visible suffit) | axe 0 violation |
| `public/atelier.html` | svg GADM `role="img"` → `role="group"` ; `aria-label="Rechercher"` retiré du submit | axe 0 violation |
| `public/js/atelier/gadm.mjs` | `createMetaRow` div → `<dl>` | axe 0 violation |
| `public/js/atelier/s5-comparison.mjs` | aria-label boutons pick = texte visible + action | axe 0 violation |
| `package.json`, `package-lock.json` | devDeps `playwright-core`/`axe-core` ajoutées pour la vérif puis **revertées** avant commit (contrainte) | `git diff` vide sur ces fichiers au commit |
| `audit/verif-navigateur.mjs`, `audit/rapport-verifications-dynamiques.md`, `audit/verif-navigateur-resultats.json`, annexe A-09 | script + rapport + JSON brut de la passe navigateur (8 pages × 2 thèmes) | commande annexe A-09 |

Vérifications finales : `node --test test/` **799/799 pass**, `npm run lint` **189 fichiers / 0 échec**, vérif navigateur **0 violation axe**, patch cumulé exporté : `/home/user/patch-design-p2-urbatrame.patch` (2 183 lignes, `fb2defa..a21749d`). Push à faire depuis une machine authentifiée : `git push -u origin design/accessibilite-p0 design/tokens-p1 design/p2-polish`.

## 2026-11-06 — P3 perf (branche `design/perf-p3`, commits `413ed70` `aa43d21` `52ac77f` `d88c597`, parent `a21749d`)

Passe des 31 règles de performance (revue règle par règle, 5 absentes validées et corrigées une par une, vérif après chaque : tests 799/799 + lint + navigateur) :

| Règle | Fichier | Avant → Après | Preuve |
|---|---|---|---|
| 27 cache versionné | `server/http.mjs` `cacheControlFor()`, `server/api.mjs:440` (query transmise), 8 pages (`?v=20261106p3` ×54), `vercel.json` (blocs `has query v`) | max-age=300 partout → `max-age=31536000, immutable` si `?v=`, html `no-store` | curl -D : immutable avec ?v, 300 sans |
| 9 compression | `server/http.mjs` (zlib brotli/gzip, seuil 1 Ko, Vary) | aucun Content-Encoding local → br/gzip | app.js 118 Ko→30 Ko br ; sample JSON 856 Ko→145 Ko |
| 22 JS 3D lazy | `public/js/lazy-vue3d.mjs` (nouveau), `index.html`, `app.js` (vue3D/generate/init/coche), `exports-ui.mjs` | `<script js/vue3d.js>` eager 52 Ko → chargement à la demande | navigateur : 0 requête vue3d.js au chargement, FMVue3D OK après ensure |
| 2 WebP | `public/urbatrame-emblem.webp` (128×134 q90, nouveau), PNG 488×509 supprimé, 7 pages (`width/height` 40), `test/api.test.mjs` | 114 496 o PNG → 8 042 o WebP (−93 %) | curl 200, tests 799/799 |
| 31 throttling | `audit/verif-navigateur.mjs` : pass 3G (400 ms/400 kbit/s) + CPU ×4 via CDP | pas de throttling → mesures 3G/CPU lent | `verif-navigateur-resultats-p3.json` : LCP 5,75 s, CLS 0,034, 0 violation axe en 3G+CPU×4 |

Résultats navigateur post-P3 (`rapport-perf-p3.md`) : 0 violation axe (8 pages × 2 thèmes), LCP desktop 48–680 ms, CLS ≤ 0,055, 49/49 cibles ≥ 44 px, 0 scroll horizontal, 0 domaine tiers hors tuiles OSM. Patch : `/home/user/patch-design-p3-urbatrame.patch`.

## 2026-11-06 — P3 règle 26/23 (branche `design/perf-p4`, commit `7cf0132`, parent `d88c597`)

| Fichier | Avant → Après | Preuve |
|---|---|---|
| `public/js/app.js` | `renderCatalog()` reconstruit les 46 lignes à chaque coche/bouton tout/aucun → `syncRow(id)` + `syncGroupCount(g)` : 1 ligne + compteur mis à jour ; `renderCatalog()` gardé pour init/langue/palier | navigateur : 1 clic = 2 mutations DOM (classe `.item` + `h3 span`), avant = 46 lignes reconstruites ; bouton « Générer (n) » et compteurs à jour |

Vérifs : tests 799/799, lint 190/0, passe navigateur rejouée (`verif-navigateur-resultats-p4.json`) : 0 violation axe, CLS ≤ 0,055, 3G+CPU×4 LCP 5,75 s CLS 0,034, 49/49 cibles ≥ 44 px, 0 domaine tiers hors tuiles OSM. Patch P3 à jour : `/home/user/patch-design-p3-urbatrame.patch` (5 commits `a21749d..7cf0132`).

## 2026-11-06 — P3 règle 7 (branche `design/perf-p5`, commit `fb6da40`, parent `7cf0132`)

| Fichier | Avant → Après | Preuve |
|---|---|---|
| `server/student-auth.mjs` `requestOtp` | `await sendOtpEmail(...)` dans le chemin de requête (latence SMTP = latence HTTP) → envoi déclenché immédiatement, plus awaité ; `.catch` : `invalidateOtpChallenge` (fail closed) + log `UT_AUTH_EMAIL_DELIVERY_FAILED` sans adresse ni code | node : réponse en 2 ms avec mailer simulé à 600 ms, mail envoyé, échec → challenge invalidé ; tests 799/799, lint 190/0 |

Patch P3 régénéré : `/home/user/patch-design-p3-urbatrame.patch` (6 commits `a21749d..fb6da40`).

## 2026-11-06 — P3 règles 3, 1, 14 (branche `design/perf-p6`, commits `1e7f683` `2fc546a` `4061b56`, parent `fb6da40`)

| Règle | Fichier | Avant → Après | Preuve |
|---|---|---|---|
| 3 dédup en vol | `public/js/routes.mjs` | appels simultanés identiques = N fetch → promesse partagée via `Map this.inflight` (`_dedup`), vidée au règlement | node : 3 post2d simultanés = 1 fetch ; tests 799/799 |
| 1 squelettes | `public/js/app.js`, `public/styles.css` | « Recherche en cours… » texte seul → 3 `.skel-row` ; cartes en `.skel-card` pendant `S.busy` | navigateur : 3 skel pendant la recherche puis résultats ; reduced-motion = pas d'animation |
| 14 optimiste | `public/js/app.js` `generate()` | `S.busy`/bouton après `await ensureVue3D()` → verrou + bouton désactivé dès l'entrée, restauré sur tous les retours | navigateur : triple-clic = 1 seul POST begin |

Règles 18 (OTel) et 30 (RUM) documentées « non retenues » (infra hors bac à sable ; RUM contraire au choix RGPD). Vérif navigateur finale `verif-navigateur-resultats-p6.json` : 0 violation axe (8 pages × 2 thèmes), CLS ≤ 0,055, 3G+CPU×4 LCP 5,75 s CLS 0,034, 49/49 cibles ≥ 44 px, 0 domaine tiers hors tuiles OSM. Lint 190/0, tests 799/799. Patch : `/home/user/patch-design-p3-urbatrame.patch` (9 commits `a21749d..4061b56`).

## 2026-11-06 — PUSH effectué (branches design uniquement, main/prod inchangé)

`git push origin design/accessibilite-p0 design/tokens-p1 design/p2-polish design/perf-p3 design/perf-p4 design/perf-p5 design/perf-p6` — authentifié par jeton jetable fourni en pièce jointe (jamais affiché/journalisé ; la commande a été filtrée pour masquer le jeton).

`git ls-remote` après push :
- `refs/heads/main` = `fb2defa` (inchangé, prod intacte)
- `design/accessibilite-p0` = `5b3348a` · `design/tokens-p1` = `30f61a0` · `design/p2-polish` = `a21749d`
- `design/perf-p3` = `d88c597` · `design/perf-p4` = `7cf0132` · `design/perf-p5` = `fb6da40` · `design/perf-p6` = `4061b56`

Les 7 branches sont des « new branch » côté GitHub ; aucune fusion sur main demandée (revue/PR côté GitHub à faire par le propriétaire).

## 2026-11-06 — Revue + PR #5 + fusion vers main

- Revue : diff `fb2defa..4061b56` = 31 fichiers, +713/−450, 12 commits linéaires ; scan secrets négatif (seul match = classe CSS `api-key-field`) ; tests 799/799 et lint 190/0 sur chaque branche.
- **PR #5** créée via API : `design/perf-p6` → `main` (base `fb2defa`), titre « design: accessibilité (P0/P1/P2) + performance (P3) — 12 commits, tests 799/799, 0 violation axe en navigateur », `mergeable: true`.
- **Fusion effectuée** : merge commit **`e3fd76a`** sur `main` (méthode merge, PR #5 fermée/merged).
- Vérifié après fusion : `git fetch origin main` → `origin/main = e3fd76a`, diff `origin/main` vs `design/perf-p6` = 0, `node --test test/` sur main = **799/799**, lint = **190/0**.
- Déploiement Vercel : déclenché automatiquement depuis main (branche par défaut).
- Le jeton jetable n'a servi qu'aux appels API (masqué dans toutes les sorties, non persisté).

## 2026-11-06 — Durcissement du relais CodeCraft (branche `design/codecraft-relay`, commit `173a98b`, PR #6, merge `a906ec3b` sur main)

| Fichier | Avant → Après | Preuve |
|---|---|---|
| `server/api.mjs` | relais inline non protégé : `fetch(..., {timeout:30000})` ignoré par undici (pas de timeout), pas de quota, pas de validation, détail erreur amont renvoyé → `createCodecraftRelay()` : `AbortSignal.timeout(30s)`, regex modèle + rejet `://`/espaces, route chat\|catalog, prompt 1..100 000, `relayQuota` par IP (cooldown 60 s), plafond réponse 1 Mo, 502 générique (log du seul statut HTTP), 503 sans clé | tests +2 (801/801) ; live : 400 INVALID_MODEL/ROUTE/PROMPT, 502 sans détail amont en 0,3 s, 2ᵉ appel → 429 RATE_LIMITED retryAfter 60 |
| `public/js/atelier/s5-comparison.mjs` | statut « Requête authentifiée vers OpenRouter » affiché pour CodeCraft → étiquette correcte (relais serveur, clé côté serveur) | commit |
| `test/vercel-api-consolidation.test.mjs` | mock fetch `.json()` → `.text()` + 2 tests de durcissement | 801/801, lint 190/0 |

Après fusion sur main (`a906ec3b`) : tests 801/801, lint 190/0. Patch : `/home/user/patch-design-codecraft-relay.patch`.

## 2026-11-06 (soir) — CodeCraft : durcissement + diagnostic WAF (PR #6..#11, main = `675a1d8`)

| Étape | Commit/PR | Détail | Preuve |
|---|---|---|---|
| Durcissement relais | `173a98b` PR #6 | timeout réel, validation, quota IP, anti-fuite, 503 sans clé | tests 801/801, live local 400/429/502 |
| Clé aussi sur le catalogue | `83ef24b` PR #7 | amont exige la clé pour GET /v1/models (401 sinon) | test 802/802 ; prod avant : 502 |
| Diagnostic 502 | `d2bd207` PR #8 | 502 inclut upstreamStatus + content-type, jamais le corps | prod : `403 text/html` |
| UA explicite | `566ffa7` PR #9 | UA `UrbaTrame/0.1 (+...)` — insuffisant (blocage par IP) | prod toujours 403 html |
| Message client WAF | `601187e` PR #10 | `CODECRAFT_UPSTREAM_BLOCKED_BY_WAF` + message actionnable dans s5 et cartographique | — |
| Détection WAF avant parse | `de6dc32` PR #11 | 403/html détecté avant JSON.parse, headers défensifs | prod : `502 CODECRAFT_UPSTREAM_BLOCKED_BY_WAF upstreamStatus 403` |

Cause racine : Cloudflare bloque la sortie Vercel/AWS vers codecraftapi.com (403 html). **Action requise côté compte CodeCraft/Cloudflare** : autoriser AS16509 (AWS) ou baisser le WAF sur /v1/*. Alternative : OpenRouter/APInex/endpoint perso (direct navigateur). Patch : `/home/user/patch-design-codecraft-relay.patch`. main re-testée : 802/802, lint 190/0.

## 2026-11-07 — Import SIG local via terrio-js/core (branche `design/terrio-import`, commit `07701de`, PR #12, merge `b298504` sur main)

**Source évaluée** : `github.com/opengeos/terrio` (terrio-js 0.7.0, module `core`) — I/O géospatiale pure Rust compilée en WASM. Licence MIT + composants Apache-2.0 ; le solveur MPL-2.0 (nuages de points) du paquet complet n'est PAS dans le module `core` servi. Vendored (auto-hébergé, aucun CDN) sous `public/vendor/terrio/` avec LICENSE/NOTICE/LICENSE-THIRD-PARTY.md.

| Fichier | Avant → Après | Preuve |
|---|---|---|
| `public/vendor/terrio/core/` (nouveau) | — → `terrio.js` (157 803 o) + `terrio_bg.wasm` (15 039 244 o, ~5,7 Mo gzip) + licences | `npm pack terrio-js@0.7.0` ; servi en `application/wasm` (vercel.json + `server/http.mjs:22`) |
| `public/js/atelier/terrio-import.mjs` (nouveau) | — → chargement à la demande du wasm ; vecteur (gpkg/fgb/geojson/json/kml/kmz/gml/gpx) réexporté en WGS 84 par le moteur PROJ de terrio (`toBytes tSrs`) puis validé par `parseGeoJSONText` ; raster (tif/tiff) en bandes entrelacées, mêmes codes d'erreur que `parseGeoTiff` | `test/terrio-import.test.mjs` |
| `public/js/atelier/geotiff-raster.mjs` | `rasterRange` non exporté → **exporté** (réutilisé par terrio, statistiques identiques) | diff |
| `public/js/atelier/local-layers-ui.mjs` | `handleFile` : pour les extensions terrio, lecture d'abord via terrio, **repli automatique** sur sql.js/geotiff.js/parseurs maison si `TERRIO_PARSE_FAILED`/`ENGINE_UNAVAILABLE` ; limites (`RASTER_*`, `TOO_MANY_*`) remontées telles quelles ; nouveaux codes `TERRIO_TOO_MANY_LAYERS`, `TERRIO_NO_VECTOR_LAYERS` + messages | diff |
| `vercel.json` | nouvelle règle `/vendor/terrio/core/terrio_bg.wasm` : `application/wasm`, cache 86400 | curl local : `200 application/wasm 15039244` |
| `THIRD-PARTY-NOTICES.md` | entrée terrio-js 0.7.0 core (MIT/Apache-2.0, MPL-2.0 hors module core) | diff |
| `test/terrio-import.test.mjs` (nouveau) | — → parité avec sql.js (`donnees_test.gpkg` : 4 couches, mêmes entités/positions WGS84 <1e-6/attributs, EPSG:32631→4326) et geotiff.js (`mnt_test.tif` : 256×256, NoData −9999, validPixels 65392, min/max, emprise WGS84, pixels) + codes d'erreur | **806/806 tests, lint 193/0** |

Bac à sable réinitialisé avant la session (`.git`/`node_modules` perdus) → `git init` + `remote add origin` + `fetch` + `checkout -B main origin/main` + `npm ci` refaits. Patch : `/home/user/patch-design-terrio-import.patch` (`675a1d8..b298504`, binaire wasm exclu — reproductible via `npm pack terrio-js@0.7.0` et copie dans `public/vendor/terrio/core/`). Note : `transformPoints` renvoie `[xs, ys]` (deux tableaux), pas des paires par point — bug d'emprise WGS84 corrigé avant commit.

## 2026-11-07 — CodeCraft : preuve que le blocage est par ASN + upstream configurable (PR #13 `35eb4cb`, PR #14 `5d16b17`, main = `5d16b17`)

**Diagnostic live (prod `freemap-rose.vercel.app`)** : `route=catalog` et `route=chat` → `502 CODECRAFT_UPSTREAM_BLOCKED_BY_WAF upstreamStatus:403` ; depuis un poste normal, `https://codecraftapi.com/v1/models` → `401 application/json` (API vivante, clé requise) → le WAF Cloudflare ne bloque que la **sortie AWS/Vercel (AS16509)**. Docs officielles CodeCraft : seul hôte API = `https://codecraftapi.com/v1`.

| Étape | Commit/PR | Résultat |
|---|---|---|
| Profil navigateur complet vers l'amont (UA Chrome 142, Accept, Accept-Language fr, sec-ch-ua, sec-fetch-*) sur /models et /chat/completions | `d1bb9dc` PR #13 → merge `35eb4cb` | **prod re-testée : toujours 502 WAF 403** → le blocage est par ASN/IP, pas par headers ; aucun correctif code côté Vercel ne peut passer |
| Upstream configurable : `codecraftUpstream()` lit `CODECRAFT_UPSTREAM` (https obligatoire, sinon repli `https://codecraftapi.com/v1`) ; test env valide/invalide (2 IP de test, quota par IP) | `fcd2e11` PR #14 → merge `5d16b17` | prod `5d16b17` vérifiée : `400 INVALID_MODEL`, catalogue toujours `502 WAF` (attendu, upstream inchangé) |
| Messages client WAF enrichis (s5 + cartographique) : 3 contournements explicites | idem | — |

**Contournements livrés/documentés** : (1) allowlist AS16509 côté tableau de bord CodeCraft/Cloudflare (ou règle WAF off sur /v1/*) → relais OK tel quel ; (2) immédiat : « Autre endpoint » = `https://codecraftapi.com/v1` + clé `cc_…` en direct navigateur (non bloqué — vérifié 401 JSON hors AWS) ; (3) relais perso (ex. Cloudflare Worker) + `CODECRAFT_UPSTREAM` sur Vercel. Tests **807/807**, lint **193/0**. Patch : `/home/user/patch-design-codecraft-waf-headers.patch` (`675a1d8..5d16b17`, fichiers relais uniquement).

## 2026-11-07 — S5 : catalogue /models aussi pour « Autre endpoint » (PR #15, merge `ef1fb11`, main = `ef1fb11`)

**Vérifications réseau faites depuis le bac (IP non-AWS, comme un navigateur)** : `GET https://codecraftapi.com/v1/models` → `401 application/json` sans clé, `401 invalid_api_key` avec une fausse clé `cc_…` → l'endpoint répond, seul l'ASN AWS est bloqué. **CORS OK pour notre domaine** : preflight OPTIONS → `204` avec `access-control-allow-origin: https://freemap-rose.vercel.app` et `access-control-allow-headers: Authorization, Content-Type, …` → l'appel direct navigateur depuis `freemap-rose.vercel.app` est accepté.

| Changement | Détail | Preuve |
|---|---|---|
| `s5-comparison.mjs` | `CATALOG_PROVIDERS` = openrouter/apinex/codecraft/**custom** → bouton « Charger les modèles » + liste déroulante pour un endpoint perso ; appel direct `${endpoint}/models` ; modèle choisi dans la liste prioritaire sur la saisie manuelle ; statut avec total renvoyé (« N gratuit(s) listé(s) sur M renvoyé(s) » / « catalogue bien reçu : M modèle(s)… ») | prod `ef1fb11` sert le nouveau fichier |
| `atelier-s5.html` | note CodeCraft : contournement direct `https://codecraftapi.com/v1` via « Autre endpoint » + clé `cc_…`, CORS autorisé, doc `codecraftapi.com/docs` | prod 200 |
| `test/s5-comparison.test.mjs` | `freeModelsFromCatalog(…, 'custom')` : tarif nul ou suffixe `:free` retenus, payants exclus | **807/807 tests, lint 193/0** |

Patch : `/home/user/patch-design-s5-custom-catalog.patch` (`5d16b17..ef1fb11`).

## 2026-11-07 — Fix bouton « Charger les modèles » invisible pour « Autre endpoint » (PR #16, merge `3399f73`, main = `3399f73`)

**Cause racine** : la PR #15 avait été éditée en parallèle sur le même fichier — plusieurs éditions se sont écrasées ; le fichier fusionné (`ef1fb11`) référençait `CATALOG_PROVIDERS` et `total` **sans les déclarer** et `setProviderUI` gardait l'ancienne liste → bouton caché pour « custom » (et `loadModels` aurait levé une ReferenceError). Leçon retenue : une seule édition par fichier et par message.

| Changement | Détail | Preuve |
|---|---|---|
| `public/js/atelier/s5-comparison.mjs` | `const CATALOG_PROVIDERS = ['openrouter','apinex','codecraft','custom']` déclaré une fois, utilisé dans `setProviderUI` (hidden), `updateAiControls` (disabled), `loadModels` (garde) ; label custom ; `const total` déclaré avant usage | prod `3399f73` : `curl …/s5-comparison.mjs?v=20261107s5` contient la déclaration (grep = 1) |
| `public/atelier-s5.html` | `?v=20261107s5` sur les 2 scripts → cache navigateur vidé | prod HTML sert `s5-comparison.mjs?v=20261107s5` |
| `test/s5-comparison.test.mjs` | **garde-fou statique** : déclaration unique de CATALOG_PROVIDERS, présence de `'custom'`, 4 usages UI, `const total`, label custom | **808/808 tests, lint 193/0** |

Patch : `/home/user/patch-design-s5-custom-catalog-fix.patch` (`ef1fb11..3399f73`).

## 2026-11-07 — Atelier cartographique : bouton « Charger le catalogue des modèles » (PR #17, merge `4865058`, main = `4865058`)

Le panneau IA de `atelier-cartographique.html` n'avait **aucun** chargement de catalogue (l'utilisateur travaille sur l'atelier cartographique, pas S5).

| Changement | Détail | Preuve |
|---|---|---|
| `public/atelier-cartographique.html` | champ `aiModel` + `list="aiModelList"` + `<datalist id="aiModelList">` ; bouton `loadAiModels` « Charger le catalogue des modèles » + statut `aiModelStatus` ; `?v=20261107carto` (6 refs) | prod `4865058` : HTML servi contient `loadAiModels`/`aiModelList`/`v=20261107carto` |
| `public/js/atelier/local-layers-ui.mjs` | `loadAiModels` : GET `{base}/models` — openrouter/apinex en direct navigateur, **custom dérivé de l'endpoint `/chat/completions` saisi**, codecraft via le relais (message WAF + contournement direct `https://codecraftapi.com/v1/chat/completions` + clé `cc_…`) ; datalist remplie (300 max) avec label « gratuit déclaré » via `freeModelsFromCatalog` (s5-core) ; statut « Catalogue reçu : N modèle(s), M déclaré(s) gratuit(s) » ; bouton activé si fournisseur + clé saisis | prod : `local-layers-ui.mjs?v=20261107carto` contient le handler |
| `test/atelier-ui.test.mjs` | test de présence HTML + câblage JS (ids, list=, handler, filtrage, disabled) | **809/809 tests, lint 193/0** |

Patch : `/home/user/patch-design-carto-load-models.patch` (`3399f73..4865058`).

## 2026-11-07 — Catalogue carto : « 33 modèles, 0 gratuit » expliqué + prix dans les suggestions (PR #18, merge `d99c22d`, main = `d99c22d`)

Retour utilisateur : « Catalogue reçu : 33 modèle(s), 0 déclaré(s) gratuit(s) » → **la connexion directe codecraftapi.com/v1 fonctionne** (200, CORS OK). Page publique `codecraftapi.com/models` : 33 modèles, tarifs publiés $0,12–$8,30/M, **aucun à tarif nul** → le palier gratuit CodeCraft (~1M jetons/mois) est au niveau du **compte**, pas du modèle.

| Changement | Détail | Preuve |
|---|---|---|
| `local-layers-ui.mjs` | suggestion avec `pricing.prompt/input` → label « entrée ~x $/1M jetons » ; si 0 gratuit déclaré, le statut ajoute : « palier gratuit éventuel au niveau du compte — consultez le tableau de bord du fournisseur » | prod `d99c22d` sert le hint |
| `atelier-cartographique.html` | `?v=20261107carto2` | — |
| test | assertions hint + label prix | **809/809 tests, lint 193/0** |

Patch : `/home/user/patch-design-carto-catalog-hint.patch` (`4865058..d99c22d`).

## 2026-11-07 — Carto IA : liste déroulante <select> des modèles chargés (PR #19, merge `97ab276`, main = `97ab276`)

Retour utilisateur : « aucun modèle chargé » alors que le statut disait « Catalogue reçu : 33 modèle(s)… » → le catalogue était bien rempli dans la `<datalist>`, mais celle-ci est peu visible. Ajout d'une vraie liste déroulante.

| Changement | Détail | Preuve |
|---|---|---|
| `atelier-cartographique.html` | nouveau `<select id="aiModelSelect">` dans le label `aiModelSelectField` « Modèle chargé du catalogue » (caché tant que non chargé) ; `?v=20261107carto3` | prod `97ab276` : HTML servi contient `aiModelSelect` |
| `local-layers-ui.mjs` | au chargement du catalogue, le select est rempli (label = ID + « gratuit déclaré » / « entrée ~x $/1M jetons » / « tarif à vérifier ») et affiché ; au choix, l'ID est recopié dans `#aiModel` ; au changement de fournisseur, select + datalist vidés ; statut mis à jour | prod : handler `aiModelSelect` servi |
| `test/atelier-ui.test.mjs` | ids présents, câblage select, affichage post-chargement | **809/809 tests, lint 193/0** |

Patch : `/home/user/patch-design-carto-model-select.patch` (`d99c22d..97ab276`).

## 2026-11-07 — Carto IA : hint immédiat si « CodeCraft » (relais) choisi (PR #20, merge `030066a`, main = `030066a`)

Capture réseau utilisateur (`/home/user/uploads/image-7.png`) : `GET codecraftapi.com/models` → **200** ×2 + OPTIONS 204 (catalogue OK en direct navigateur), mais `POST freemap-rose.vercel.app/codecraft` → **502** : l'envoi était parti par le relais car le fournisseur était « CodeCraft » au clic d'envoi.

| Changement | Détail | Preuve |
|---|---|---|
| `local-layers-ui.mjs` | à la sélection de « CodeCraft », `#aiModelStatus` affiche immédiatement l'avertissement WAF + le contournement (« Endpoint fourni par vous » = `https://codecraftapi.com/v1/chat/completions` + clé `cc_…`, direct navigateur, CORS ok) | prod `030066a` sert le hint |
| `atelier-cartographique.html` | `?v=20261107carto4` | — |
| test | assertions hint | **809/809 tests, lint 193/0** |

Patch : `/home/user/patch-design-carto-codecraft-hint.patch` (`97ab276..030066a`).

## 2026-11-07 — Évaluation + intégration de FreeLLMAPI (PR #21, merge `0a4f77b`, main = `0a4f77b`)

**Évaluation de `freellmapi.co/models`** : freellmapi.co = site du projet **MIT auto-hébergé** (github.com/tashfeenahmed/freellmapi, Neu Software LLC) : routeur local qui agrège les paliers gratuits de ~38 fournisseurs (~395 modèles à $0) derrière `http://localhost:3001/v1`, l'utilisateur fournissant ses propres clés. **L'API « hébergée » `api.freellmapi.ai` renvoie 522 (origine Cloudflare down) et réclame des clés `sk_live_` d'un opérateur non identifié → NON intégrée** (risque + indisponible). Confidentialité : les prompts partent vers les fournisseurs amont, dont >85 % conservent les données (expérimentation personnelle uniquement).

| Changement | Détail | Preuve |
|---|---|---|
| `atelier-s5.html` + `atelier-cartographique.html` | nouvelle option « FreeLLMAPI (routeur local, gratuits) » + note confidentialité (rétention amont, pas de données personnelles) + liens catalogue/GitHub/privacy ; `?v=20261107s5b` / `?v=20261107carto5` | prod `0a4f77b` : `value="freellmapi"` servi dans les 2 pages |
| `s5-comparison.mjs` | `freellmapi` dans CATALOG_PROVIDERS, `normalizedBaseUrl` (http://localhost autorisé comme origine sûre, prérempli `http://localhost:3001/v1`), label, catalogue /models en direct navigateur | prod : `localhost:3001` servi ×3 |
| `local-layers-ui.mjs` | `aiCatalogBaseUrl` + `runAi` + `updateAiControls` + préremplissage endpoint pour freellmapi | — |
| tests | filtre `:free` reconnu gratuit (freellmapi), câblage statique S5 + carto | **810/810 tests, lint 193/0** |

Usage : `docker run -d -p 3001:3001 tashfeenahmed/freellmapi` chez soi → fournisseur « FreeLLMAPI » → clé unifiée du routeur → « Charger le catalogue ». Patch : `/home/user/patch-design-freellmapi-provider.patch` (`030066a..0a4f77b`). Bac à sable réinitialisé avant la session (`.git`/`public/js` perdus) → restauré depuis origin (`030066a`) + `npm ci`.

## 2026-11-07 — FreeLLMAPI local : cause CORS prouvée + hint commande exacte (PR #22, merge `cf092da`, main = `cf092da`)

Retour : « `http://localhost:3001/v1/models` pas visible dans la liste ». Diagnostic sur le repo amont (`tashfeenahmed/freellmapi`, `server/src/app.ts:116-192`) : CORS en liste blanche, origines par défaut = `localhost:5173`/`127.0.0.1:5173`/`[::1]:5173` uniquement → l'origine `https://freemap-rose.vercel.app` est **refusée au preflight** → la requête `/v1/models` échoue côté navigateur. Correctif côté utilisateur : `DASHBOARD_ORIGINS=https://freemap-rose.vercel.app`.

| Changement | Détail | Preuve |
|---|---|---|
| `local-layers-ui.mjs` | pendant le chargement, l'URL cible est affichée (« Chargement du catalogue depuis http://localhost:3001/v1/models… ») ; en cas d'échec avec freellmapi, le statut donne la commande exacte : `docker run -d -p 3001:3001 -e DASHBOARD_ORIGINS=https://freemap-rose.vercel.app tashfeenahmed/freellmapi` + clé unifiée | prod `cf092da` sert le hint |
| `s5-comparison.mjs` | même hint dans le catch de `loadModels` pour freellmapi | prod s5 html contient DASHBOARD_ORIGINS |
| notes HTML (s5 + carto) | commande docker CORS ajoutée à la note FreeLLMAPI ; `?v=20261107s5c` / `?v=20261107carto6` | — |
| tests | hints présents dans JS/HTML des deux ateliers | **810/810 tests, lint 193/0** |

Patch : `/home/user/patch-design-freellmapi-cors-hint.patch` (`0a4f77b..cf092da`).

## 2026-11-07 — Fix image Docker FreeLLMAPI (PR #23, merge `32ed1ac`, main = `32ed1ac`)

L'image publiée est `ghcr.io/tashfeenahmed/freellmapi:latest` (ghcr.io, pas Docker Hub — vérifié dans `docker-compose.yml` et `docs/en/install/01-install.md` du repo amont). Commande corrigée dans les notes HTML + messages d'erreur des deux ateliers, avec volume persistant `-v freellmapi-data:/app/server/data` :
`docker run -d --name freellmapi -p 3001:3001 -e DASHBOARD_ORIGINS=https://freemap-rose.vercel.app -v freellmapi-data:/app/server/data ghcr.io/tashfeenahmed/freellmapi:latest`
Tests : assertion image ghcr.io. **810/810, lint 193/0** ; prod `32ed1ac` sert la commande corrigée. Patch : `/home/user/patch-design-freellmapi-docker-image-fix.patch`.

## 2026-11-08 — Recette FreeLLMAPI validée de bout en bout côté utilisateur (main = `32ed1ac`)

Routeur lancé sur le PC Windows de l'utilisateur via Docker Desktop/WSL2 : `docker run -d --name freellmapi -p 3001:3001 --env-file %USERPROFILE%\freellmapi.env -v freellmapi-data:/app/server/data ghcr.io/tashfeenahmed/freellmapi:latest` (env-file = `DASHBOARD_ORIGINS=https://freemap-rose.vercel.app` + `ENCRYPTION_KEY` 64 hexa générée localement, encodage ASCII — piège UTF-16 de `Out-File` PowerShell 5.1 à éviter). Tableau de bord `http://localhost:3001` ouvert sans code (même machine), clé unifiée `freellmapi-…` copiée via le bouton Copier. Dans UrbaTrame (atelier cartographique, `Ctrl+F5`) : fournisseur « FreeLLMAPI (routeur local, gratuits) », endpoint auto `http://localhost:3001/v1/chat/completions`, clé unifiée collée → « Charger le catalogue » : F12 Réseau `OPTIONS /v1/models` **204** + `GET /v1/models` **200** (292 modèles). Envoi chat modèle `agne-2.5-flash` → réponse JSON valide (résumé + sources + GeoJSON), couche IA validée et ajoutée localement. **Chaîne complète opérationnelle.** Pièges rencontrés : conteneur exit 255 après veille PC (~10 h, « [wake] resumed ») → désactiver la veille ; nom de conteneur réutilisable après `docker rm -f` ; clé de chiffrement en UTF-16 lisible avec octets nuls → régénérer en ASCII.

## 2026-11-08 — Recette CodeCraft en direct validée côté utilisateur (main = `32ed1ac`)

Dans l'atelier cartographique, fournisseur « Endpoint OpenAI-compatible fourni par vous » + endpoint `https://codecraftapi.com/v1/chat/completions` + clé `cc_…` → « Charger le catalogue » : `GET https://codecraftapi.com/v1/models` **200 direct navigateur** (CORS autorisé, 33 modèles — le relais Vercel `/api/util/codecraft` reste 502/WAF, non utilisé). Envoi chat modèle `gemini-3.7-flash` → `POST /v1/chat/completions` **200**, réponse JSON valide (résumé + sources + limitations), couche IA validée et ajoutée localement. **Appel direct CodeCraft opérationnel** (PR #17-#20 confirmé en conditions réelles).
