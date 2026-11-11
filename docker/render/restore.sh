#!/bin/sh
# Restauration d'une sauvegarde faite par backup.sh dans une base VIDE ou de test. Ne touche jamais la base de production par défaut :
# la base cible est TARGET_DATABASE (obligatoire), distincte de PGDATABASE.
#   restore.sh <nom-de-l-objet>      ex. : restore.sh db-20261111-070000.dump.gpg       (ou « latest »)
# Variables : celles de backup.sh (PGHOST PGPASSWORD BACKUP_PASSPHRASE BACKUP_S3_BUCKET AWS_*) + TARGET_DATABASE
set -eu
: "${PGHOST:?}" "${PGPASSWORD:?}" "${BACKUP_PASSPHRASE:?}" "${BACKUP_S3_BUCKET:?}" "${AWS_ACCESS_KEY_ID:?}" "${AWS_SECRET_ACCESS_KEY:?}"
: "${TARGET_DATABASE:?TARGET_DATABASE : base dans laquelle restaurer (jamais la base de production sans l'avoir décidé)}"
export PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-b2c_migrator}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"
# Fournisseurs compatibles S3 autres qu'AWS (Backblaze B2, Cloudflare R2…) : pas de somme de contrôle supplémentaire non exigée par le protocole
export AWS_REQUEST_CHECKSUM_CALCULATION="${AWS_REQUEST_CHECKSUM_CALCULATION:-when_required}" AWS_RESPONSE_CHECKSUM_VALIDATION="${AWS_RESPONSE_CHECKSUM_VALIDATION:-when_required}"
PREFIX="${BACKUP_S3_PREFIX:-b2c/db}"
ENDPOINT=""
[ -n "${BACKUP_S3_ENDPOINT:-}" ] && ENDPOINT="--endpoint-url ${BACKUP_S3_ENDPOINT}"
# shellcheck disable=SC2086
s3() { aws $ENDPOINT "$@"; }

name="${1:?nom de la sauvegarde, ou « latest »}"
if [ "$name" = "latest" ]; then
  name="$(s3 s3 ls "s3://${BACKUP_S3_BUCKET}/${PREFIX}/" | awk '{print $4}' | grep -E '^db-[0-9]{8}-[0-9]{6}\.dump\.gpg$' | sort | tail -n 1)"
  [ -n "$name" ] || { echo "Aucune sauvegarde trouvée" >&2; exit 1; }
fi
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
echo "Téléchargement de ${name}"
s3 s3 cp "s3://${BACKUP_S3_BUCKET}/${PREFIX}/${name}" "$work/b.gpg" --only-show-errors
s3 s3 cp "s3://${BACKUP_S3_BUCKET}/${PREFIX}/${name}.sha256" "$work/b.sha256" --only-show-errors
[ "$(sha256sum "$work/b.gpg" | cut -d' ' -f1)" = "$(cut -d' ' -f1 "$work/b.sha256")" ] || { echo "Somme de contrôle incorrecte : sauvegarde corrompue" >&2; exit 1; }
printf '%s' "$BACKUP_PASSPHRASE" | gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 0 --decrypt -o "$work/b.dump" "$work/b.gpg"
echo "Restauration dans ${TARGET_DATABASE}"
pg_restore --no-owner --no-privileges --exit-on-error -d "$TARGET_DATABASE" "$work/b.dump"
echo "Restauration terminée."
