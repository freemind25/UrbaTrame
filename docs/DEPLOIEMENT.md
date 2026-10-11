# Déploiement

## Prérequis

- Node.js 20.11 ou plus récent (aucune dépendance à installer) ;
- un dossier inscriptible pour les données (clé de signature) ;
- un accès sortant vers Overpass, Nominatim, NASA POWER et AWS Terrarium.

## Variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `4173` | port d'écoute |
| `MTN_HOST` | `0.0.0.0` | interface d'écoute |
| `MTN_DATA_DIR` | `<dépôt>/data` | clé Ed25519 et données locales |
| `MTN_PUBLIC_DIR` | `<dépôt>/public` | fichiers servis |

```bash
PORT=8080 MTN_DATA_DIR=/var/lib/maptonap node server/index.mjs
```

## Service systemd

```ini
# /etc/systemd/system/maptonap.service
[Unit]
Description=MapToNap-clone
After=network-online.target

[Service]
Type=simple
User=maptonap
WorkingDirectory=/srv/maptonap-clone
Environment=PORT=4173
Environment=MTN_DATA_DIR=/var/lib/maptonap
ExecStart=/usr/bin/node server/index.mjs
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/maptonap

[Install]
WantedBy=multi-user.target
```

Derrière un reverse proxy (nginx, Caddy), transmettez `X-Forwarded-For` :
sans lui, toutes les requêtes partagent l'IP du proxy et le quota devient
global. Ne faites confiance à cet en-tête que s'il est posé par le proxy
lui-même.

## Docker

```bash
docker build -t maptonap-clone .
docker run -p 4173:4173 -v mtn-data:/data -e MTN_DATA_DIR=/data maptonap-clone
```

Le volume `/data` contient la clé de signature : sans lui, chaque redémarrage
invalide les licences déjà délivrées.

## Points d'attention avant une mise en ligne

1. **Sauvegardez `data/keys.json`** hors du serveur. Le perdre revient à
   perdre toutes les licences émises ; le publier revient à les rendre
   falsifiables.
2. **Remplacez les codes de démonstration** (`DEMO_CODES` dans
   `server/licence.mjs`) par votre catalogue réel : ils sont publics dans le
   dépôt, et `GET /api/status` les énumère.
3. **Changez le `User-Agent`** (`server/config.mjs`) pour y mettre un contact :
   c'est la règle d'usage de Nominatim et d'Overpass.
4. **Rendez le quota partagé** si vous lancez plusieurs instances : l'état de
   `server/quota.mjs` vit en mémoire, et les sessions d'activation
   (`server/licence.mjs`) également. Un magasin commun (Redis, table SQL) est
   nécessaire dès qu'il y a plusieurs processus ou un redémarrage fréquent.
5. **Prévoyez un cache** pour les sources externes si le trafic dépasse
   quelques visiteurs par minute : les quatre services interrogés sont gratuits
   et sans engagement de débit.

## Exploitation

Le serveur journalise une ligne par événement, horodatée :

```
18:24:07 activate cs_demo_max → max
18:24:08 begin 3f5c1b2a max 7 analyse(s) 3 requête(s)
18:24:10 query 3f5c1b2a base 4390 éléments 2287 ms
18:24:11 quota 203.0.113.7 GENERATION_IN_PROGRESS
```

Surveillez les lignes `query échec` (source injoignable) et `quota` (abus ou
réglage trop strict). L'en-tête `X-EM-Trace` d'une réponse permet de retrouver
l'instance qui a traité une requête donnée.

## Vérifications après déploiement

```bash
curl -s localhost:4173/api/status | head -c 200      # le service répond
curl -s -o /dev/null -w '%{http_code}\n' localhost:4173/   # l'interface est servie
npm run test:net                                      # les sources sont joignables
```
