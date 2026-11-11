#!/bin/sh
# Sauvegarde logique de la base : pg_dump → vérification → chiffrement (GnuPG, AES-256, avec contrôle d'intégrité) → copie HORS du
# serveur (stockage objet compatible S3) → relecture de la copie (téléchargement, déchiffrement, lecture par pg_restore).
# Échoue (code ≠ 0) à la moindre étape : une sauvegarde qu'on n'a pas pu relire n'est pas une sauvegarde.
# Variables : PGHOST PGPASSWORD [PGPORT PGUSER PGDATABASE], BACKUP_PASSPHRASE (à GARDER hors de Render), BACKUP_S3_BUCKET,
#   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, [AWS_DEFAULT_REGION BACKUP_S3_ENDPOINT BACKUP_S3_PREFIX BACKUP_RETENTION_DAYS BACKUP_KEEP_MIN]
set -eu

: "${PGHOST:?PGHOST manquant}" "${PGPASSWORD:?PGPASSWORD manquant}" "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE manquant}"
: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET manquant}" "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID manquant}" "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY manquant}"
export PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-b2c_migrator}" PGDATABASE="${PGDATABASE:-b2c}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"
# Fournisseurs compatibles S3 autres qu'AWS (Backblaze B2, Cloudflare R2…) : pas de somme de contrôle supplémentaire non exigée par le protocole
export AWS_REQUEST_CHECKSUM_CALCULATION="${AWS_REQUEST_CHECKSUM_CALCULATION:-when_required}" AWS_RESPONSE_CHECKSUM_VALIDATION="${AWS_RESPONSE_CHECKSUM_VALIDATION:-when_required}"
PREFIX="${BACKUP_S3_PREFIX:-b2c/db}"
ENDPOINT=""
[ -n "${BACKUP_S3_ENDPOINT:-}" ] && ENDPOINT="--endpoint-url ${BACKUP_S3_ENDPOINT}"
# shellcheck disable=SC2086
s3() { aws $ENDPOINT "$@"; }

gpg_pass() { printf '%s' "$BACKUP_PASSPHRASE" | gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 0 "$@"; }

stamp="$(date -u +%Y%m%d-%H%M%S)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
name="db-${stamp}.dump.gpg"

echo "1/5 pg_dump de ${PGDATABASE} sur ${PGHOST}:${PGPORT}"
pg_dump -Fc -f "$work/db.dump"
pg_restore -l "$work/db.dump" | grep -q 'TABLE' || { echo "Échec : le fichier produit ne contient aucune table" >&2; exit 1; }

echo "2/5 chiffrement (AES-256)"
gpg_pass --symmetric --cipher-algo AES256 -o "$work/$name" "$work/db.dump"
sum="$(sha256sum "$work/$name" | cut -d' ' -f1)"
size="$(wc -c < "$work/$name" | tr -d ' ')"

echo "3/5 copie vers s3://${BACKUP_S3_BUCKET}/${PREFIX}/${name}"
s3 s3 cp "$work/$name" "s3://${BACKUP_S3_BUCKET}/${PREFIX}/${name}" --only-show-errors
printf '%s  %s\n' "$sum" "$name" > "$work/$name.sha256"
s3 s3 cp "$work/$name.sha256" "s3://${BACKUP_S3_BUCKET}/${PREFIX}/${name}.sha256" --only-show-errors

echo "4/5 relecture de la copie distante (téléchargement, somme, déchiffrement, lecture)"
s3 s3 cp "s3://${BACKUP_S3_BUCKET}/${PREFIX}/${name}" "$work/check.gpg" --only-show-errors
[ "$(sha256sum "$work/check.gpg" | cut -d' ' -f1)" = "$sum" ] || { echo "Échec : la copie distante diffère du fichier envoyé" >&2; exit 1; }
gpg_pass --decrypt -o "$work/check.dump" "$work/check.gpg"
pg_restore -l "$work/check.dump" | grep -q 'TABLE' || { echo "Échec : la copie déchiffrée est illisible" >&2; exit 1; }

echo "5/5 conservation"
if [ -n "${BACKUP_RETENTION_DAYS:-}" ]; then
  keep="${BACKUP_KEEP_MIN:-7}"
  cutoff="$(date -u -d "@$(( $(date +%s) - BACKUP_RETENTION_DAYS * 86400 ))" +%Y%m%d)"
  # Seules les sauvegardes db-AAAAMMJJ-HHMMSS.dump.gpg de ce dossier sont concernées, et on en garde toujours au moins « keep »
  s3 s3 ls "s3://${BACKUP_S3_BUCKET}/${PREFIX}/" | awk '{print $4}' | grep -E '^db-[0-9]{8}-[0-9]{6}\.dump\.gpg$' | sort > "$work/all.txt" || true
  total="$(wc -l < "$work/all.txt" | tr -d ' ')"
  removable=$(( total - keep ))
  if [ "$removable" -gt 0 ]; then
    head -n "$removable" "$work/all.txt" | while read -r old; do
      day="$(echo "$old" | sed -E 's/^db-([0-9]{8})-.*/\1/')"
      if [ "$day" -lt "$cutoff" ]; then
        echo "  suppression de ${old} (plus de ${BACKUP_RETENTION_DAYS} jours)"
        s3 s3 rm "s3://${BACKUP_S3_BUCKET}/${PREFIX}/${old}" --only-show-errors
        s3 s3 rm "s3://${BACKUP_S3_BUCKET}/${PREFIX}/${old}.sha256" --only-show-errors || true
      fi
    done
  fi
else
  echo "  aucune suppression (BACKUP_RETENTION_DAYS absent) : prévoir une règle de cycle de vie sur le stockage"
fi

echo "OK : ${name} (${size} octets, sha256 ${sum})"
