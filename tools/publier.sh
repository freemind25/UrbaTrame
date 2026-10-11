#!/usr/bin/env bash
# Relie ce dépôt local à GitHub et envoie la branche main.
# Le dépôt distant doit exister et être VIDE (sans README, sans licence).
#
#   bash tools/publier.sh --dry-run          # montre les commandes sans rien faire
#   bash tools/publier.sh                    # SSH (clé configurée)
#   bash tools/publier.sh --https            # HTTPS (jeton d'accès personnel)
set -euo pipefail

MODE="ssh"
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    --https) MODE="https" ;;
    --ssh) MODE="ssh" ;;
    -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "option inconnue : $arg" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")/.."

# Adresse du dépôt lue dans package.json (personnalisée par tools/personaliser.mjs)
URL="$(node -p "require('./package.json').repository.url.replace(/^git\+/,'').replace(/\.git$/,'')")"
case "$URL" in
  *CHANGER-MOI*)
    echo "Les adresses du dépôt sont encore provisoires." >&2
    echo "Lancez d'abord : npm run personnaliser -- --compte <pseudo>" >&2
    exit 1 ;;
esac
CHEMIN="${URL#https://github.com/}"
if [ "$MODE" = "ssh" ]; then REMOTE="git@github.com:${CHEMIN}.git"; else REMOTE="${URL}.git"; fi

BRANCHE="$(git rev-parse --abbrev-ref HEAD)"
echo "dépôt local   : $(pwd)"
echo "dépôt distant : $REMOTE"
echo "branche       : $BRANCHE"
echo "commits       : $(git rev-list --count HEAD)"

if [ -n "${DRY:-}" ]; then
  echo
  echo "commande qui serait exécutée :"
  echo "  git remote add origin $REMOTE   # (ou « git remote set-url origin … » si déjà présent)"
  echo "  git push -u origin $BRANCHE"
  exit 0
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo
  echo "Des modifications ne sont pas enregistrées. Enregistrez-les d'abord :" >&2
  echo "  git add -A && git commit -m \"…\"" >&2
  exit 1
fi

if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REMOTE"
else
  git remote add origin "$REMOTE"
fi
git push -u origin "$BRANCHE"

echo
echo "Envoyé. Vérifiez ensuite :"
echo "  $URL/actions   → l'intégration continue doit passer au vert"
echo "  $URL           → le README s'affiche avec les planches"
