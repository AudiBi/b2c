# Déploiement sur DigitalOcean (un droplet, Docker Compose)

Ce guide installe la plateforme sur **un seul serveur DigitalOcean** (« droplet ») avec la pile de production `docker/compose.prod.yml` : nginx (HTTPS), API, PostgreSQL 17, Redis. Le détail de la pile, des sauvegardes locales et des mises à jour est dans [DEPLOYMENT.md](DEPLOYMENT.md) ; la liste de contrôle d'ouverture est dans [MISE_EN_PRODUCTION.md](MISE_EN_PRODUCTION.md).

> **Honnêteté** : cette pile a été construite et testée **en local** (22 contrôles de fumée sur 22). Les scripts de ce guide (`scripts/digitalocean/`) ont une syntaxe vérifiée mais **n'ont jamais été exécutés sur un vrai droplet**. Faites tout l'enchaînement sur un droplet d'essai avant d'y mettre de vraies données, et corrigez-moi ce qui diffère.

## 0. Pourquoi un droplet et pas les services gérés de DigitalOcean

- **Base de données** : n'utilisez **pas** « Managed PostgreSQL ». La plateforme a besoin d'un rôle propriétaire qui contourne la sécurité par entreprise (RLS, attribut `BYPASSRLS`) pour deux fonctions de la base ; les bases gérées ne l'accordent généralement pas. PostgreSQL tourne donc **dans Docker sur le droplet**.
- **App Platform** : même limite (base) et pas de disque local fiable ; non recommandé ici.
- **Spaces** (stockage objet de DigitalOcean) : possible pour les pièces jointes (`STORAGE_DRIVER=s3`, testé seulement avec SeaweedFS), **mais pas pour les sauvegardes** : une sauvegarde chez le même hébergeur ne protège pas d'un incident de compte. Utilisez **Backblaze B2 ou Cloudflare R2**.

## 1. Choisir et créer le droplet

| Réglage | Valeur conseillée |
|---|---|
| Image | **Ubuntu 24.04 LTS** |
| Type | Basic, **2 vCPU / 4 Go de mémoire** ou plus (vérifiez le tarif actuel ; compter de l'ordre de 20 à 30 $ par mois) ; 2 Go suffisent à peine pour construire les images |
| Région | **New York (NYC1 ou NYC3)** : la plus proche d'Haïti parmi les régions DigitalOcean |
| Connexion | **Clé SSH** (créez-la sur votre poste, ajoutez la clé publique à DigitalOcean) ; pas de mot de passe |
| Options | Cochez **Sauvegardes hebdomadaires** (filet de sécurité, pas la sauvegarde principale) |

Ensuite :

1. **Reserved IP** (adresse fixe) : réservez-en une et attachez-la au droplet, pour que le DNS survive à une reconstruction.
2. **Cloud Firewall** (réseau → pare-feu) : entrées **22 (SSH, de préférence limité à votre adresse), 80 et 443** ; tout le reste fermé. C'est en plus du pare-feu du serveur configuré à l'étape 3.

## 2. Pointer les noms de domaine (Namecheap)

Dans Namecheap → Domain List → **Advanced DNS** de `b2cxpress.com`, créez deux enregistrements **A** vers l'adresse (Reserved IP) du droplet :

| Type | Hôte | Valeur |
|---|---|---|
| A | `@` | adresse du droplet |
| A | `admin` | adresse du droplet |

Les enregistrements de **courrier** (SPF, DKIM, DMARC) se règlent au même endroit : voir [DEPLOYMENT.md](DEPLOYMENT.md), section courrier. Attendez que `ping b2cxpress.com` renvoie la bonne adresse avant l'étape 6.

## 3. Préparer le serveur (une fois)

Connectez-vous en root, puis lancez le script de préparation :

```bash
ssh root@ADRESSE_DU_DROPLET
git clone https://github.com/AudiBi/b2c.git /opt/b2c && bash /opt/b2c/scripts/digitalocean/bootstrap.sh
```

Il installe Docker, Node 22, le pare-feu (SSH, 80, 443), fail2ban, les mises à jour de sécurité automatiques, la rotation des journaux Docker, 2 Go de mémoire d'échange, et crée l'utilisateur **`b2c`** avec votre clé SSH. Il désactive ensuite la connexion root et par mot de passe : **ouvrez un second terminal et vérifiez `ssh b2c@ADRESSE` avant de fermer la session root**. Si le dépôt est privé, utilisez une clé de déploiement ou clonez depuis votre poste (`scp`/`rsync`).

```bash
chown -R b2c:b2c /opt/b2c      # le dépôt a été cloné par root
```

## 4. Secrets et configuration

En tant qu'utilisateur `b2c`, dans `/opt/b2c` :

```bash
cd /opt/b2c
npm run setup:env:prod        # génère .env.production avec des secrets aléatoires (n'écrase jamais un fichier existant)
nano .env.production
```

À renseigner : `PUBLIC_HOST=b2cxpress.com`, `ADMIN_HOST=admin.b2cxpress.com`, `COMPANY_SLUG` (identifiant de l'entreprise, **le même qu'à la création de l'entreprise dans le panel**), `SMTP_*` et `MAIL_FROM` (Namecheap Private Email), `SEED_SUPERADMIN_EMAIL` et `SEED_SUPERADMIN_PASSWORD` (au moins 10 caractères, non courant). `CERTS_DIR=../certs` reste inchangé.

> **Copiez tout de suite, hors du serveur** (coffre de mots de passe) : `TOTP_ENCRYPTION_KEY`, `JWT_ACCESS_SECRET` et le fichier `.env.production`. Perdre `TOTP_ENCRYPTION_KEY` rend illisibles les secrets de double authentification.

## 5. Certificat HTTPS (Let's Encrypt)

Un seul certificat couvre le site et le panel. Les DNS (étape 2) doivent déjà pointer vers le serveur et le port 80 doit être libre (nginx n'est pas encore démarré) :

```bash
sudo bash scripts/digitalocean/cert.sh b2cxpress.com admin.b2cxpress.com vous@exemple.com
```

Le script obtient le certificat, le copie dans `/opt/b2c/certs` (`fullchain.pem`, `privkey.pem`), installe le **renouvellement automatique** (minuteur système de certbot ; le conteneur `web` est arrêté quelques secondes à chaque renouvellement) et fait un essai de renouvellement. Ne continuez que si l'essai se termine sans erreur.

## 6. Démarrer

```bash
cd /opt/b2c
npm run prod:up                # construit les images, applique les migrations (tâche migrate), démarre
docker compose -f docker/compose.prod.yml --env-file .env.production ps
SMOKE_URL=https://b2cxpress.com SMOKE_ADMIN_URL=https://admin.b2cxpress.com SMOKE_HTTP_URL=http://b2cxpress.com node scripts/prod-smoke.mjs
```

La première construction prend plusieurs minutes. Le contrôle de fumée doit afficher **tous les contrôles réussis**. Puis **effacez `SEED_SUPERADMIN_PASSWORD` de `.env.production`** (le compte est créé une seule fois).

## 7. Première entreprise et réglages

1. Ouvrez `https://admin.b2cxpress.com/login` → « Accès équipe plateforme » → connectez-vous avec le super administrateur et **activez la double authentification** (obligatoire).
2. **Entreprises → Créer** : nom, `slug` **identique à `COMPANY_SLUG`**, préfixes de suivi et de codes client, devise, langue, **règle de paiement** (avant l'expédition, avant la remise, ou les deux) et l'administrateur de l'entreprise (il reçoit une invitation par e-mail).
3. L'administrateur de l'entreprise se connecte, active sa double authentification, puis ouvre **Administration → Paramètres → Valeurs de départ** : entrepôts, agence, catégories, grilles, taux et table CONATEL sont créés. Il ajuste ensuite chaque section à la main et contrôle les prix.
4. Invitez le personnel et attribuez les rôles (voir le guide utilisateur).

## 8. Sauvegardes hors de DigitalOcean (obligatoire avant l'ouverture)

1. Créez un bucket chez **Backblaze B2** ou **Cloudflare R2** (compte distinct de DigitalOcean) et une clé d'accès limitée à ce bucket.
2. Créez `/opt/b2c/.env.backup` (`chmod 600`, jamais versionné) :

```bash
BACKUP_PASSPHRASE=une-longue-phrase-secrete-gardee-aussi-hors-du-serveur
BACKUP_S3_BUCKET=nom-du-bucket
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
BACKUP_S3_ENDPOINT=https://s3.us-west-004.backblazeb2.com     # R2 : https://<identifiant>.r2.cloudflarestorage.com
AWS_DEFAULT_REGION=us-west-004                                # R2 : auto
BACKUP_RETENTION_DAYS=30
```

3. Essayez à la main, puis planifiez chaque nuit (`crontab -e` en tant que `b2c`) :

```bash
bash /opt/b2c/scripts/digitalocean/backup-offsite.sh
# 15 3 * * *  /opt/b2c/scripts/digitalocean/backup-offsite.sh >> /opt/b2c/backups-offsite.log 2>&1
```

Le script sauvegarde la base (`pg_dump`), la **chiffre** (GnuPG, AES-256), la copie vers le stockage externe, puis **relit la copie** (téléchargement, somme de contrôle, déchiffrement) ; il sauvegarde aussi les pièces jointes du volume `files`. Il échoue (code ≠ 0) à la moindre étape.

4. **Faites une restauration d'essai complète** (sur un second droplet ou en local) avec `docker/render/restore.sh` et la procédure de sinistre de [DEPLOYMENT.md](DEPLOYMENT.md) § 6. Une sauvegarde jamais restaurée n'est pas une sauvegarde. Conservez `BACKUP_PASSPHRASE` hors du serveur.

## 9. Mises à jour et exploitation

```bash
cd /opt/b2c
bash scripts/digitalocean/backup-offsite.sh      # 1. sauvegarde AVANT toute mise à jour
git pull                                         # 2. nouvelle version
npm run prod:up                                  # 3. reconstruit ; migrate applique les migrations en attente
node scripts/prod-smoke.mjs                      # 4. contrôle de fumée (avec SMOKE_URL / SMOKE_ADMIN_URL)
```

- Une mise à jour **interrompt brièvement** le service (une seule instance, pas de préproduction).
- **Surveillance externe** : créez une sonde (UptimeRobot, Better Stack…) sur `https://b2cxpress.com/health/ready` avec alerte par e-mail ou SMS ; ajoutez les alertes DigitalOcean (processeur, mémoire, disque) dans l'onglet Monitoring du droplet.
- **Journaux** : `docker compose -f docker/compose.prod.yml --env-file .env.production logs -f api`.
- **Espace disque** : `df -h` ; les images Docker anciennes se nettoient avec `docker image prune -f`.
- **Changer de domaine ou de marque** : reconstruire l'image `web` (les valeurs sont fixées à la construction).

## 10. Aide-mémoire des problèmes courants

| Symptôme | Cause probable |
|---|---|
| Le conteneur « Conflict ... already in use » | Une ancienne tentative a laissé des conteneurs : `docker ps -a`, puis `docker rm` des conteneurs `b2c-prod-*` à l'état « Created » |
| Variables vides (« PUBLIC_HOST is not set ») | La commande n'a pas lu `.env.production` : utilisez `npm run prod:up` |
| Le certificat échoue à l'étape 5 | DNS pas encore propagé, port 80 occupé ou fermé dans le pare-feu DigitalOcean |
| Tout le monde est « limité » en débit | Un mandataire a été placé devant nginx (voir SECURITY.md : un seul saut de confiance) |
| Les messages de confirmation n'arrivent pas | SPF, DKIM ou DMARC manquants, ou envoi par application tierce non autorisé dans Namecheap |

## 11. Coût et limites

- Un droplet unique est un **point de défaillance unique** : prévoyez les sauvegardes externes, les instantanés hebdomadaires et un plan de reconstruction (ce guide, ré-exécuté, plus la restauration).
- La charge réelle n'a pas été mesurée sur un serveur : surveillez la mémoire et le disque les premières semaines et agrandissez le droplet au besoin (redimensionnement dans le panneau DigitalOcean).
