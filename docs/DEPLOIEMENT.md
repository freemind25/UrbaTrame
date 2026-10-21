# Déploiement d'un serveur Node

Ce document couvre le mode serveur classique (VPS, Docker, Render, Railway),
celui qui conserve tout : quota par IP, licences révocables, clé sur disque.
Pour un déploiement serverless sur Vercel, voir **[VERCEL.md](VERCEL.md)**.

## Prérequis

- Node.js 20.11 ou plus récent, puis `npm ci` pour installer les dépendances verrouillées ;
- un dossier inscriptible pour les données (clé de signature) ;
- un accès sortant vers Overpass, Nominatim, NASA POWER et AWS Terrarium.

## Variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `4173` | port d'écoute |
| `FM_HOST` | `0.0.0.0` | interface d'écoute |
| `FM_DATA_DIR` | `<dépôt>/data` | clé Ed25519 et données locales |
| `FM_PUBLIC_DIR` | `<dépôt>/public` | fichiers servis |
| `FM_STUDENT_AUTH` | `off` | `required` active la barrière étudiant; voir `ACCES-ETUDIANTS-OTP.md` |
| `FM_AUTH_DATABASE_URL` | vide | URL PostgreSQL du rôle applicatif, seulement si l’auth est requise |
| `FM_AUTH_OTP_KEY` | vide | clé HMAC OTP en Base64 (32 octets aléatoires) |
| `FM_AUTH_SMTP_*` | vide | relais d’envoi des OTP; aucun envoi si non configuré |

```bash
PORT=8080 FM_DATA_DIR=/var/lib/freemap node server/index.mjs
```

## Service systemd

```ini
# /etc/systemd/system/freemap.service
[Unit]
Description=Freemap
After=network-online.target

[Service]
Type=simple
User=freemap
WorkingDirectory=/srv/freemap
Environment=PORT=4173
Environment=FM_DATA_DIR=/var/lib/freemap
ExecStart=/usr/bin/node server/index.mjs
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/freemap

[Install]
WantedBy=multi-user.target
```

Derrière un reverse proxy (nginx, Caddy), transmettez `X-Forwarded-For` :
sans lui, toutes les requêtes partagent l'IP du proxy et le quota devient
global. Ne faites confiance à cet en-tête que s'il est posé par le proxy
lui-même.

## Docker

```bash
docker build -t freemap .
docker run -p 4173:4173 -v fm-data:/data -e FM_DATA_DIR=/data freemap
```

Le volume `/data` contient la clé de signature : sans lui, chaque redémarrage
invalide les licences déjà délivrées.

## Points d'attention avant une mise en ligne

1. **Protégez et sauvegardez les clés privées.** `FM_SIGNING_KEY` signe les
   attestations serveur; le coffre d’émission des `.utlic` est chiffré et reste
   dans le profil local de son propriétaire. Ne publiez ni clé privée ni coffre.
2. **Pour Pro/Max, configurez `FM_LICENSE_PUB`** avec la clé publique issue de
   `npm run licence:init`, puis remettez les `.utlic` générés avec
   `npm run licence:issue`. Les codes de démonstration ne fonctionnent qu’en
   développement local; la réponse publique `/api/status` n’expose aucun code.
3. **Pour l’accès universitaire**, ne définissez `FM_STUDENT_AUTH=required` qu’après configuration PostgreSQL/SMTP en préproduction. Le rôle applicatif ne doit pas pouvoir écrire la liste; la chaîne `FM_AUTH_ADMIN_DATABASE_URL` et l’outil `npm run etudiants` restent sur l’ordinateur de la responsable et ne vont jamais dans Vercel. Voir `ACCES-ETUDIANTS-OTP.md`.
4. **Changez le `User-Agent`** (`server/config.mjs`) pour y mettre un contact :
   c'est la règle d'usage de Nominatim et d'Overpass.
5. **Rendez le quota partagé** si vous lancez plusieurs instances : l'état de
   `server/quota.mjs` vit en mémoire, et les sessions d'activation
   (`server/licence.mjs`) également. Un magasin commun (Redis, table SQL) est
   nécessaire dès qu'il y a plusieurs processus ou un redémarrage fréquent.
6. **Prévoyez un cache** pour les sources externes si le trafic dépasse
   quelques visiteurs par minute : les quatre services interrogés sont gratuits
   et sans engagement de débit.

## Exploitation

Le serveur journalise une ligne par événement, horodatée :

```
18:24:07 activate max
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
