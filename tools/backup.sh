#!/bin/sh
# Local backup of the whole project, on top of the GitHub remote.
#   npm run backup [-- /some/other/folder]
# Writes to $PALUDARIUM_BACKUPS, or else to a folder called "backups" next to the project's folder:
#   history/paludarium-<time>.bundle   full git history, every branch (restore: git clone <file>)
#   files/                             a mirror of art-src/ and public/assets/, uncommitted files included
# Keeps the 10 newest bundles.
set -e
cd "$(dirname "$0")/.."
DEST="${1:-${PALUDARIUM_BACKUPS:-$(dirname "$PWD")/backups}}"
mkdir -p "$DEST/history" "$DEST/files"
git bundle create "$DEST/history/paludarium-$(date +%Y%m%d-%H%M%S).bundle" --all
rsync -a --delete art-src public/assets "$DEST/files/"
ls -1t "$DEST"/history/*.bundle | tail -n +11 | while read -r f; do rm -f "$f"; done
echo "Backed up to $DEST"
du -sh "$DEST"
