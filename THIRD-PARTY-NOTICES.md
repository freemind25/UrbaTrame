# Notices des composants tiers

UrbaTrame conserve sa licence MIT. Les composants suivants servent uniquement à lire des fichiers SIG locaux dans l’atelier; ils ne transmettent pas les fichiers à un service externe.

## Runtime SIG de l’atelier

- **sql.js 1.15.0** — MIT; SQLite est dans le domaine public. Le navigateur reçoit `public/vendor/sql.js/sql-wasm-browser.js` (45 049 octets) et `public/vendor/sql.js/sql-wasm-browser.wasm` (684 897 octets). Les fichiers sont chargés à la demande lors de l’import d’un GeoPackage. Texte de licence : [`public/vendor/sql.js/LICENSE`](public/vendor/sql.js/LICENSE). Projet : <https://github.com/sql-js/sql.js/>.
- **geotiff.js 3.0.5** — MIT. Bundle navigateur `public/vendor/geotiff/geotiff.js` (550 900 octets), chargé à la demande pour un GeoTIFF. Texte de licence : [`public/vendor/geotiff/LICENSE`](public/vendor/geotiff/LICENSE). Projet : <https://github.com/geotiffjs/geotiff.js/>.

Le bundle navigateur de geotiff.js inclut les dépendances suivantes. Leurs licences sont conservées dans `public/vendor/geotiff/licenses/` :

| Composant | Version verrouillée | Licence déclarée |
|---|---:|---|
| @petamoriken/float16 | 3.9.3 | MIT |
| lerc | 3.0.0 | Apache-2.0 |
| pako | 2.2.0 | MIT et Zlib |
| parse-headers | 2.0.6 | MIT |
| quick-lru | 6.1.2 | MIT |
| web-worker | 1.5.0 | Apache-2.0 |
| xml-utils | 1.10.2 | CC0-1.0 |
| zstddec | 0.2.0 | MIT et BSD-3-Clause |

Les versions et licences ci-dessus correspondent au verrou npm actuel. `sql.js` et `geotiff` sont aussi déclarés en dépendances de développement afin d’exécuter les tests de lecture sur les fichiers-échantillons; l’application navigateur sert ses copies locales épinglées sous `public/vendor/`, sans CDN. `npm install` a signalé zéro vulnérabilité dans l’arbre installé le 17 octobre 2026; ce contrôle ponctuel n’est pas une garantie future.
