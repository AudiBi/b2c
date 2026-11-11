# PostgreSQL pour Render : image officielle + script d'initialisation des rôles (b2c_migrator propriétaire, b2c_app sans privilège).
# Render n'offre pas de superutilisateur sur sa base managée ; or les fonctions SECURITY DEFINER de la plateforme
# (suivi public, file de notifications) exigent un propriétaire qui contourne la RLS : voir docs/RENDER.md.
# Construction : docker build -f docker/render/postgres.Dockerfile .  (contexte = racine du dépôt)
FROM postgres:17-alpine
COPY docker/postgres/init-prod/ /docker-entrypoint-initdb.d/
