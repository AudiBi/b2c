#!/usr/bin/env bash
# Préparation d'un serveur DigitalOcean neuf (Ubuntu 24.04 LTS) pour la pile de production Docker Compose.
# À exécuter UNE FOIS, en root, juste après la création du droplet :
#     curl -fsSL <adresse du fichier> | bash        ou        bash bootstrap.sh
# Ce que fait le script : mises à jour, Docker, Node 22 (pour les scripts du dépôt), pare-feu (SSH, 80, 443 seulement),
# fail2ban, mises à jour de sécurité automatiques, rotation des journaux Docker, mémoire d'échange, utilisateur « b2c ».
# Rejouable : chaque étape vérifie l'état avant d'agir.
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "Exécutez ce script en root." >&2; exit 1; }
DEPLOY_USER="${DEPLOY_USER:-b2c}"
APP_DIR="${APP_DIR:-/opt/b2c}"
export DEBIAN_FRONTEND=noninteractive

echo "1/8 mises à jour du système"
apt-get update -y
apt-get upgrade -y
apt-get install -y ca-certificates curl gnupg ufw fail2ban unattended-upgrades git certbot

echo "2/8 Docker Engine et Compose"
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

echo "3/8 Node 22 (pour les scripts du dépôt : secrets, contrôle de fumée, sauvegarde locale)"
if ! command -v node >/dev/null 2>&1 || ! node -v | grep -q '^v22'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "4/8 rotation des journaux Docker (sinon ils grossissent sans limite)"
if [ ! -f /etc/docker/daemon.json ]; then
  cat > /etc/docker/daemon.json <<'JSON'
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "5" } }
JSON
  systemctl restart docker
fi

echo "5/8 mémoire d'échange de 2 Go (protège contre un manque de mémoire ponctuel)"
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "6/8 pare-feu : SSH, 80 et 443 seulement"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
systemctl enable --now fail2ban
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "7/8 utilisateur « ${DEPLOY_USER} » (sans mot de passe, clés SSH de root recopiées)"
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
fi
usermod -aG docker "$DEPLOY_USER"
if [ -s /root/.ssh/authorized_keys ]; then
  install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
  cp /root/.ssh/authorized_keys "/home/$DEPLOY_USER/.ssh/authorized_keys"
  chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/authorized_keys"
  chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"
fi
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR"

echo "8/8 SSH : connexion par clé seulement (uniquement si une clé est en place pour ${DEPLOY_USER})"
if [ -s "/home/$DEPLOY_USER/.ssh/authorized_keys" ]; then
  cat > /etc/ssh/sshd_config.d/99-b2c.conf <<'SSH'
PasswordAuthentication no
PermitRootLogin no
SSH
  systemctl reload ssh || systemctl reload sshd
  echo "  Mot de passe et connexion root désactivés. Connectez-vous désormais avec : ssh ${DEPLOY_USER}@<adresse>"
else
  echo "  AUCUNE clé SSH trouvée : la connexion par mot de passe reste active. Ajoutez une clé, puis relancez ce script." >&2
fi

echo
echo "Serveur prêt. Étape suivante : se connecter en ${DEPLOY_USER} et cloner le dépôt dans ${APP_DIR} (docs/DIGITALOCEAN.md, étape 5)."
