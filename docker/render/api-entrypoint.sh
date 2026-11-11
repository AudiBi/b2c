#!/bin/sh
# Render monte les disques persistants en root : le dossier des pièces jointes doit être inscriptible par l'utilisateur
# sans privilège de l'API. On rend le dossier à « node », puis on abaisse les privilèges avant de lancer l'API.
set -e
DIR="${FILES_DIR:-/data/files}"
mkdir -p "$DIR"
chown node:node "$DIR"
exec su-exec node "$@"
