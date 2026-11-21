#!/usr/bin/env bash
# Certificat HTTPS Let's Encrypt SANS sudo : certbot tourne dans un conteneur Docker (l'utilisateur « b2c » est dans le groupe docker).
# Un seul certificat couvre le site ET le panel. Copie fullchain.pem et privkey.pem dans <APP_DIR>/certs (le dossier lu par nginx).
#
#   Première émission (les DNS pointent déjà vers le serveur, le port 80 est libre : nginx n'est pas encore démarré) :
#     bash scripts/digitalocean/cert-docker.sh issue b2cxpress.com admin.b2cxpress.com vous@exemple.com
#   Renouvellement (planifié, voir plus bas) : ne fait rien tant que le certificat vaut encore plus de 30 jours ;
#     sinon arrête « web » quelques secondes, renouvelle, recopie les fichiers, relance « web ».
#     bash scripts/digitalocean/cert-docker.sh renew
#   Planification (crontab -e, utilisateur b2c) :   0 4 * * *  /opt/b2c/scripts/digitalocean/cert-docker.sh renew >> /opt/b2c/cert-renew.log 2>&1
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/b2c}"
LE_DIR="${APP_DIR}/letsencrypt"
CERTS="${APP_DIR}/certs"
COMPOSE=(docker compose -f "${APP_DIR}/docker/compose.prod.yml" --env-file "${APP_DIR}/.env.production")
IMAGE="certbot/certbot:latest"

certbot() {
  docker run --rm --user "$(id -u):$(id -g)" -p 80:80 \
    -v "${LE_DIR}:/etc/letsencrypt" -v "${LE_DIR}/work:/var/lib/letsencrypt" -v "${LE_DIR}/logs:/var/log/letsencrypt" \
    "${IMAGE}" "$@"
}

install_certs() {
  # -L : les fichiers de Let's Encrypt sont des liens ; un montage Docker n'en suivrait pas la cible
  cp -L "${LE_DIR}/live/b2c/fullchain.pem" "${CERTS}/fullchain.pem"
  cp -L "${LE_DIR}/live/b2c/privkey.pem" "${CERTS}/privkey.pem"
  chmod 644 "${CERTS}/fullchain.pem"
  chmod 600 "${CERTS}/privkey.pem"
}

mkdir -p "${LE_DIR}/work" "${LE_DIR}/logs" "${CERTS}"

case "${1:-}" in
  issue)
    PUBLIC_HOST="${2:?usage : cert-docker.sh issue <domaine du site> <domaine du panel> <e-mail>}"
    ADMIN_HOST="${3:?usage : cert-docker.sh issue <domaine du site> <domaine du panel> <e-mail>}"
    EMAIL="${4:?usage : cert-docker.sh issue <domaine du site> <domaine du panel> <e-mail>}"
    certbot certonly --standalone --non-interactive --agree-tos -m "${EMAIL}" --cert-name b2c \
      -d "${PUBLIC_HOST}" -d "${ADMIN_HOST}"
    install_certs
    echo "Certificat installé dans ${CERTS}. Validité :"
    openssl x509 -enddate -noout -in "${CERTS}/fullchain.pem"
    echo "Pensez à planifier le renouvellement (voir l'en-tête de ce script)."
    ;;
  renew)
    [ -f "${CERTS}/fullchain.pem" ] || { echo "Aucun certificat à renouveler." >&2; exit 1; }
    if openssl x509 -checkend $((30 * 86400)) -noout -in "${CERTS}/fullchain.pem" >/dev/null; then
      echo "$(date -u +%FT%TZ) certificat valable plus de 30 jours : rien à faire"
      exit 0
    fi
    echo "$(date -u +%FT%TZ) renouvellement"
    "${COMPOSE[@]}" stop web || true
    trap '"${COMPOSE[@]}" start web || true' EXIT
    certbot renew --non-interactive
    install_certs
    echo "$(date -u +%FT%TZ) certificat renouvelé"
    ;;
  *)
    echo "Usage : cert-docker.sh issue <site> <panel> <e-mail>   |   cert-docker.sh renew" >&2
    exit 2
    ;;
esac
