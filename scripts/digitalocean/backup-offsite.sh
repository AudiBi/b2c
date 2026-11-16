#!/usr/bin/env bash
# Sauvegarde nocturne CHIFFRÉE de la base et des pièces jointes vers un stockage S3 HORS de DigitalOcean (Backblaze B2, Cloudflare R2…).
# Une sauvegarde sur le même hébergeur que le serveur ne protège pas d'un incident de compte : gardez-la chez un autre fournisseur.
#
# Prérequis : <APP_DIR>/.env.backup (chmod 600), jamais versionné :
#   BACKUP_PASSPHRASE=...        phrase de chiffrement : à GARDER AUSSI hors du serveur (sans elle, les sauvegardes sont illisibles)
#   BACKUP_S3_BUCKET=...         AWS_ACCESS_KEY_ID=...        AWS_SECRET_ACCESS_KEY=...
#   BACKUP_S3_ENDPOINT=https://s3.us-west-004.backblazeb2.com   (vide pour AWS S3)      AWS_DEFAULT_REGION=us-west-004
#   BACKUP_RETENTION_DAYS=30     (facultatif ; au moins 7 sauvegardes sont toujours gardées)
# Planification (crontab de l'utilisateur b2c) :   15 3 * * *  /opt/b2c/scripts/digitalocean/backup-offsite.sh >> /opt/b2c/backups-offsite.log 2>&1
# La base utilise docker/render/backup.sh (dump, chiffrement GnuPG AES-256, copie, RELECTURE de la copie distante).
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/b2c}"
NETWORK="${COMPOSE_NETWORK:-b2c-prod_default}"
cd "$APP_DIR"
[ -f .env.backup ] || { echo "Fichier .env.backup absent (voir l'en-tête de ce script)." >&2; exit 1; }
set -a
. ./.env.backup
set +a
: "${BACKUP_PASSPHRASE:?}" "${BACKUP_S3_BUCKET:?}" "${AWS_ACCESS_KEY_ID:?}" "${AWS_SECRET_ACCESS_KEY:?}"
PGPASSWORD="$(grep -E '^POSTGRES_MIGRATOR_PASSWORD=' .env.production | cut -d= -f2-)"
export PGPASSWORD
[ -n "$PGPASSWORD" ] || { echo "POSTGRES_MIGRATOR_PASSWORD introuvable dans .env.production." >&2; exit 1; }

echo "== $(date -u +%FT%TZ) sauvegarde de la base"
docker build -q -f docker/render/backup.Dockerfile -t b2c-backup . >/dev/null
docker run --rm --network "$NETWORK" \
  -e PGHOST=postgres -e PGPASSWORD \
  -e BACKUP_PASSPHRASE -e BACKUP_S3_BUCKET -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY \
  -e AWS_DEFAULT_REGION -e BACKUP_S3_ENDPOINT -e BACKUP_S3_PREFIX -e BACKUP_RETENTION_DAYS \
  b2c-backup

# Pièces jointes : seulement avec STORAGE_DRIVER=disk (avec S3, c'est le fournisseur du stockage qui les conserve)
if grep -qE '^STORAGE_DRIVER=disk' .env.production 2>/dev/null; then
  echo "== $(date -u +%FT%TZ) sauvegarde des pièces jointes"
  stamp="$(date -u +%Y%m%d-%H%M%S)"
  docker run --rm --user root \
    -v b2c-prod_files:/data:ro \
    -e BACKUP_PASSPHRASE -e BACKUP_S3_BUCKET -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION -e BACKUP_S3_ENDPOINT \
    -e BACKUP_S3_PREFIX_FILES -e STAMP="$stamp" --entrypoint sh b2c-backup -c '
      set -eu
      ENDPOINT=""; [ -n "${BACKUP_S3_ENDPOINT:-}" ] && ENDPOINT="--endpoint-url ${BACKUP_S3_ENDPOINT}"
      tar -czf /tmp/files.tgz -C /data .
      printf "%s" "$BACKUP_PASSPHRASE" | gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 0 --symmetric --cipher-algo AES256 -o /tmp/files.tgz.gpg /tmp/files.tgz
      aws $ENDPOINT s3 cp /tmp/files.tgz.gpg "s3://${BACKUP_S3_BUCKET}/${BACKUP_S3_PREFIX_FILES:-b2c/files}/files-${STAMP}.tgz.gpg" --only-show-errors
      rm -f /tmp/files.tgz /tmp/files.tgz.gpg
      echo "  pièces jointes chiffrées et copiées (files-${STAMP}.tgz.gpg)"
    '
fi
echo "== OK"
