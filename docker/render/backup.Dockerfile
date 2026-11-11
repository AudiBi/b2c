# Sauvegarde et restauration de la base sur Render : PostgreSQL 17 (pg_dump, pg_restore) + AWS CLI (S3 compatible) + GnuPG.
# Construction : docker build -f docker/render/backup.Dockerfile -t b2c-backup .   (contexte = racine du dépôt)
FROM postgres:17-alpine
RUN apk add --no-cache aws-cli gnupg
COPY docker/render/backup.sh docker/render/restore.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore.sh
USER postgres
CMD ["backup.sh"]
