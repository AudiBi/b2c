#!/bin/sh
# Production : exécuté une seule fois, à la création du volume PostgreSQL.
# - b2c_migrator (créé par l'image) : propriétaire des tables, exécute les migrations. Jamais utilisé par l'API.
# - b2c_app : rôle de l'API. Ni superutilisateur, ni BYPASSRLS, ni propriétaire des tables : la RLS s'applique toujours.
# Aucune base de test n'est créée.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<EOSQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'b2c_app') THEN
    CREATE ROLE b2c_app LOGIN PASSWORD '${B2C_APP_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
\$\$;
GRANT CONNECT ON DATABASE "$POSTGRES_DB" TO b2c_app;
EOSQL
