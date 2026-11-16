#!/usr/bin/env bash
# Certificat HTTPS Let's Encrypt (un seul certificat pour le site ET le panel) et renouvellement automatique.
# À exécuter en root, une fois les DNS pointés vers le serveur :
#     sudo bash scripts/digitalocean/cert.sh b2cxpress.com admin.b2cxpress.com vous@exemple.com
# Le certificat est copié dans <APP_DIR>/certs (fullchain.pem, privkey.pem), le dossier que lit nginx (CERTS_DIR=../certs).
# Renouvellement : certbot (minuteur système) arrête brièvement le conteneur « web » (quelques secondes) pour libérer le port 80,
# renouvelle, recopie les fichiers puis relance « web ».
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "Exécutez ce script en root (sudo)." >&2; exit 1; }
PUBLIC_HOST="${1:?usage : cert.sh <domaine du site> <domaine du panel> <e-mail>}"
ADMIN_HOST="${2:?usage : cert.sh <domaine du site> <domaine du panel> <e-mail>}"
EMAIL="${3:?usage : cert.sh <domaine du site> <domaine du panel> <e-mail>}"
APP_DIR="${APP_DIR:-/opt/b2c}"
COMPOSE="docker compose -f ${APP_DIR}/docker/compose.prod.yml --env-file ${APP_DIR}/.env.production"
NAME="b2c"
LIVE="/etc/letsencrypt/live/${NAME}"

install -d -m 755 "${APP_DIR}/certs"

# Recopie les vrais fichiers (un montage Docker ne suit pas les liens symboliques de Let's Encrypt)
cat > /etc/letsencrypt/renewal-hooks/deploy/b2c-copy.sh <<HOOK
#!/bin/sh
set -e
install -m 644 "${LIVE}/fullchain.pem" "${APP_DIR}/certs/fullchain.pem"
install -m 600 "${LIVE}/privkey.pem" "${APP_DIR}/certs/privkey.pem"
HOOK
chmod +x /etc/letsencrypt/renewal-hooks/deploy/b2c-copy.sh

# Premier certificat (le port 80 doit être libre : nginx n'est pas encore démarré) ; les crochets servent aux renouvellements
certbot certonly --standalone --non-interactive --agree-tos -m "${EMAIL}" --cert-name "${NAME}" \
  -d "${PUBLIC_HOST}" -d "${ADMIN_HOST}" \
  --pre-hook "${COMPOSE} stop web || true" \
  --post-hook "${COMPOSE} start web || true"

/etc/letsencrypt/renewal-hooks/deploy/b2c-copy.sh
echo "Certificat installé dans ${APP_DIR}/certs. Contrôle du renouvellement :"
certbot renew --dry-run || echo "ATTENTION : l'essai de renouvellement a échoué ; voir /var/log/letsencrypt/letsencrypt.log" >&2
