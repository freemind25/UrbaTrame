# Recette de vérification IA — UrbaTrame (archivée le 2026-11-08)

**Archive de la procédure validée de bout en bout le 2026-11-08 sur le PC Windows de l'utilisateur.**
Si un problème survient un jour, suivre ce document étape par étape.

- Site en production : `https://freemap-rose.vercel.app` (toujours faire `Ctrl+F5` pour vider le cache)
- Dépôt : `github.com/freemind25/UrbaTrame`, `main = 32ed1ac` (PR #21-#23 = fournisseur FreeLLMAPI + correctifs CORS/image Docker)
- Panneau IA dans les deux ateliers : **« 07 / IA FACULTATIVE »** (chercher avec `Ctrl+F` → « IA FACULTATIVE » dans la page)

---

## PARTIE 0 — Le routeur local FreeLLMAPI tourne (prérequis)

### 0.1 Vérifier que le conteneur tourne
```powershell
docker ps
```
Attendu : `freellmapi … Up … 0.0.0.0:3001->3001/tcp`

### 0.2 S'il ne tourne pas (redémarrage PC, veille, crash)
```powershell
docker start freellmapi
```
Si le conteneur n'existe plus :
```powershell
docker rm -f freellmapi
docker run -d --name freellmapi -p 3001:3001 --env-file "$env:USERPROFILE\freellmapi.env" -v freellmapi-data:/app/server/data ghcr.io/tashfeenahmed/freellmapi:latest
docker ps
docker logs freellmapi --tail 8
```
Attendu dans les logs : `Server running on http://[::]:3001`

### 0.3 Fichiers locaux à conserver (NE JAMAIS PARTAGER)
- `%USERPROFILE%\freellmapi.env` → 2 lignes : `DASHBOARD_ORIGINS=https://freemap-rose.vercel.app` + `ENCRYPTION_KEY=<64 hexa>`
- `%USERPROFILE%\freellmapi-key.txt` → la même ENCRYPTION_KEY (encodage ASCII pur — piège : `Out-File` de PowerShell 5.1 écrit en UTF-16 et produit des octets nuls qui font échouer Docker)

### 0.4 Pièges déjà rencontrés (ne pas y retomber)
- Image Docker correcte = **`ghcr.io/tashfeenahmed/freellmapi:latest`** (PAS `tashfeenahmed/freellmapi` sur Docker Hub)
- `ENCRYPTION_KEY` obligatoire sinon le conteneur quitte avec « ENCRYPTION_KEY is required in production »
- Nom `/freellmapi` déjà pris → `docker rm -f freellmapi` avant de relancer
- Veille du PC (~10 h) → conteneur tué (exit 255, « [wake] resumed » dans les logs) → **désactiver la veille** (Paramètres → Alimentation → Veille : Jamais) + `docker start freellmapi`
- `wsl --update` n'existait pas sur son WSL → utiliser `wsl --install --no-distribution` + redémarrage + `wsl --set-default-version 2` + Docker Desktop

---

## PARTIE 1 — Tableau de bord du routeur (localhost:3001)

1. Navigateur du PC → `http://localhost:3001`
2. Depuis la même machine, pas besoin du code d'inscription ; sinon le code est dans les logs :
   ```powershell
   docker logs freellmapi | Select-String -Pattern "(?i)first-run|setup code"
   ```
   (2026-11-08 : code `JYQ3R7ETFL`)
3. Onglet **Clés** → au moins une clé fournisseur **verte/« sains »** (2026-11-08 : Mistral, OpenRouter ×2, Zhipu AI, Agnes AI OK ; APINex invalide 403 = normal, ignorer)
4. Onglet **« Clé d'API unifiée »** → clé commençant par `freellmapi-…` → bouton **« Copier »** 📋 (ne jamais copier la clé à la main, ne jamais la partager)

---

## PARTIE 2 — Test dans UrbaTrame : FreeLLMAPI (routeur local) ✅ VALIDÉ

Modèle testé : **`agne-2.5-flash`** (Agnes AI, gratuit côté compte)

1. `https://freemap-rose.vercel.app/atelier-cartographique.html` → `Ctrl+F5`
2. `Ctrl+F` dans la page → `IA FACULTATIVE` → panneau « 07 / IA FACULTATIVE — Synthèse assistée »
3. Fournisseur = **« FreeLLMAPI (routeur local, gratuits) »** (PAS « URL personnalisée » — celle-ci exige « chat » dans l'URL)
4. Endpoint pré-rempli automatiquement : `http://localhost:3001/v1/chat/completions` (UrbaTrame enlève `/chat/completions` pour appeler `/v1/models`)
5. Champ « Clé API » : vider (`Ctrl+A`, `Suppr`) puis coller la clé unifiée (`Ctrl+V`)
6. Cliquer **« Charger le catalogue des modèles »**
7. F12 → Réseau → cocher **« Désactiver le cache »** → filtre `localhost` :
   - `OPTIONS …/v1/models` → **204** (CORS OK grâce à `DASHBOARD_ORIGINS`)
   - `GET …/v1/models` → **200** (2026-11-08 : 292 modèles)
8. Choisir un modèle dans « Modèle chargé du catalogue » → 2026-11-08 : `agne-2.5-flash`
9. Cocher « J’ai vérifié les conditions et j’autorise l’envoi… »
10. Rédiger la consigne (ex. « Résume en 3 puces ce que représentent les couches sélectionnées. »)
11. Sélectionner au moins une couche dans « Couches à transmettre » (sinon liste vide = aucune couche importée : aller dans « 01 / DONNÉES », importer un GeoJSON — fichier test utilisé : `test.geojson`, 1 point à Constantine [3.25, 36.35])
12. Cliquer **« Envoyer la demande explicitement »** → réponse JSON (résumé + sources + limitations + geojson)
13. Cocher « J’ai vérifié les sources, la date, le CRS et les limites… » → **« Valider et ajouter la couche localement »** → la couche IA apparaît dans la liste ✅

---

## PARTIE 3 — Test dans UrbaTrame : CodeCraft en direct ✅ VALIDÉ

Modèle testé : **`gemini-3.7-flash`** — clé `cc_…`

1. Même panneau « 07 / IA FACULTATIVE »
2. Fournisseur = **« Endpoint OpenAI-compatible fourni par vous »**
3. Endpoint : `https://codecraftapi.com/v1/chat/completions` (contient « chat » ✅)
4. Clé API = clé `cc_…` (du tableau de bord codecraftapi.com)
5. « Charger le catalogue » → `GET https://codecraftapi.com/v1/models` **200 direct navigateur** (CORS autorisé ; 33 modèles le 2026-11-08)
   - ⚠️ ne PAS utiliser le relais « CodeCraft » de Vercel (`/api/util/codecraft`) : 502, bloqué par le WAF Cloudflare (403 sur l'ASN AWS de Vercel)
6. Choisir le modèle → 2026-11-08 : `gemini-3.7-flash`
7. Consentement + consigne + couche + « Envoyer la demande explicitement » → `POST https://codecraftapi.com/v1/chat/completions` **200**, réponse JSON valide
8. Validation + « Valider et ajouter la couche localement » ✅

---

## PARTIE 4 — Diagnostic rapide si ça ne marche plus

| Symptôme | Cause probable | Action |
|---|---|---|
| `docker ps` vide | conteneur arrêté/crashé | `docker start freellmapi`, sinon recréer (0.2) |
| Page `localhost:3001` inaccessible | conteneur down | 0.1/0.2 + `docker logs freellmapi --tail 30` |
| « Catalogue indisponible (réseau ou CORS) » + hint docker | OPTIONS pas 204 | vérifier `DASHBOARD_ORIGINS` dans `freellmapi.env`, recréer le conteneur |
| `GET /models` = 401 « Invalid API key » | mauvaise clé copiée | recopie via bouton 📋 de « Clé d'API unifiée », champ vidé avant collage |
| `GET /models` = 304 « mis en cache » | cache navigateur | F12 → cocher « Désactiver le cache » |
| « L'URL personnalisée doit contenir le mot chat » | mauvais fournisseur choisi | choisir « FreeLLMAPI (routeur local) » ou endpoint en `…/chat/completions` |
| Liste « Couches à transmettre » vide | aucune couche importée | panneau « 01 / DONNÉES » → importer un GeoJSON |
| Bouton « Envoyer » grisé | case consentement / consigne / couche / clé manquante | tout cocher + remplir |
| `docker logs` : octets nuls / ENCRYPTION_KEY invalide | clé écrite en UTF-16 | régénérer la clé en ASCII (voir 0.3) |

## PARTIE 5 — Règles permanentes

- **Jamais de secrets dans le chat** (clés `freellmapi-…`, `cc_…`, `ENCRYPTION_KEY`) — copier/coller uniquement dans les champs prévus
- Pas de fournisseur payant sans accord explicite
- RGPD : aucune donnée personnelle dans les consignes IA (beaucoup de fournisseurs amont retiennent les prompts)
- L'IA ne certifie ni géoréférencement ni faits : toujours vérifier sources/date/CRS avant validation de la couche
- Pas de fonts/CDN externes (RGPD) ; français, ton novice
- Branches dédiées + PR/merge via API GitHub, jamais de push direct sur main

---

**Chemin de cette archive :** `/home/user/audit/recette-verification-ia-2026-11-08.md`
Journal général des modifications : `/home/user/audit/journal-des-modifications.md` (entrées PR #21-#23 + recettes validées 2026-11-08)
