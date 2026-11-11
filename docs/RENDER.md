# Déploiement sur Render

Configuration prête à l'emploi pour héberger la plateforme sur [Render](https://render.com) : **site** `https://b2cxpress.com`, **panel d'administration** `https://admin.b2cxpress.com`. Elle est décrite par le Blueprint [render.yaml](../render.yaml) à la racine du dépôt.

> **Statut honnête** : la configuration a été vérifiée **en local** (images construites, migrations, API, nginx, relais, domaines : voir § 7). **Rien n'a été déployé sur Render** : je n'ai aucun accès à votre compte. Les comportements propres à la plateforme (adresse réelle du client, redémarrages, disques, certificats, coûts) restent à vérifier au premier déploiement (§ 6). Ce document ne remplace pas [DEPLOYMENT.md](DEPLOYMENT.md) ni [RISKS.md](RISKS.md), dont les points bloquants restent valables.

## 1. Architecture

```
Internet ──HTTPS (Render)──► b2c-web  (nginx : site, panel, relais /v1)
                                │  réseau privé Render (même région)
                                ▼
                             b2c-api  (service privé, disque /data/files)
                              │   └──► b2c-redis    (Key Value privé, sans éviction)
                              └──────► b2c-postgres (service privé, disque pgdata)
b2c-migrate : tâche ponctuelle, lancée à la main à chaque déploiement
b2c-backup  : sauvegarde quotidienne chiffrée de la base, copiée hors de Render (S3)
```

| Service | Type Render | Rôle |
|---|---|---|
| `b2c-web` | web (Docker) | nginx : sert le site pré-rendu et le panel, relaie `/v1` vers l'API. **Les deux domaines sont rattachés à ce seul service** |
| `b2c-api` | service privé (Docker) | API NestJS ; jamais exposée à Internet ; pièces jointes sur un disque persistant |
| `b2c-postgres` | service privé (Docker) | PostgreSQL 17, disque persistant ; rôles `b2c_migrator` (propriétaire) et `b2c_app` (API, soumis à la RLS) |
| `b2c-redis` | Key Value | limites de débit, jetons à usage unique ; accès Internet fermé |
| `b2c-migrate` | tâche planifiée (Docker) | migrations, droits et rôles, premier administrateur ; jamais lancée automatiquement |
| `b2c-backup` | tâche planifiée (Docker) | sauvegarde quotidienne chiffrée de la base vers un stockage S3 hors de Render (§ 5) |

Toutes les images viennent du même `docker/Dockerfile` : Render ne permet pas de choisir une cible de construction, donc la variable `IMAGE_TARGET` (`api-render`, `web-render`, `migrate`) la désigne.

## 2. Décisions à connaître

1. **PostgreSQL n'est pas la base managée de Render.** Reproduit en local avec un propriétaire sans droits de super-utilisateur (celui de la base managée) : les migrations exigent le droit de créer des rôles, et surtout **les fonctions du suivi public et de la file de notifications ne voient plus aucune ligne** (la RLS s'applique au propriétaire des tables : un `SELECT` sur `companies` rendait 0 ligne au lieu de 2). Résultat : le suivi public ne trouverait aucun colis et aucune notification ne partirait, **sans erreur visible**. PostgreSQL tourne donc dans un service privé avec disque (le même schéma de rôles que `docker/compose.prod.yml`, déjà testé). Contrepartie : **les sauvegardes sont à votre charge** (§ 5). Une évolution possible (non faite) : ajouter à la base une politique explicite pour le propriétaire dans ces deux fonctions, ce qui permettrait la base managée avec ses sauvegardes ; cela touche à la sécurité et demande une migration et des tests dédiés.
2. **Une seule instance** de l'API et de la base (un disque ne se monte que sur une instance) : un déploiement ou une panne interrompt brièvement le service (RISKS.md C1).
3. **Région `virginia`** (côte est des États-Unis, la plus proche d'Haïti parmi celles de Render) ; tous les services doivent être dans la même région pour se joindre par le réseau privé.
4. **Domaine du site sans `www`** : `b2cxpress.com` est le domaine canonique. Ajouter aussi `www.b2cxpress.com` dans Render si vous voulez l'accepter (Render le redirige vers le domaine principal) ; nginx redirige de toute façon (301) tout nom d'hôte inconnu, y compris l'adresse `*.onrender.com`, vers `https://b2cxpress.com` pour éviter le contenu dupliqué.

## 3. Coûts

Les disques persistants et les services privés **ne sont pas disponibles en formule gratuite** : le Blueprint demande la formule `starter` pour 5 services (web, API, base, migration, sauvegarde) et pour Redis, plus deux disques de 10 Go. Consultez la page des tarifs de Render pour le montant actuel : je ne l'ai pas vérifié.

## 4. Mise en place pas à pas

**Avant** : le dépôt doit être sur GitHub ou GitLab (Render le lit de là). Préparez deux mots de passe hexadécimaux de 32 caractères (par exemple `openssl rand -hex 16`) : `POSTGRES_PASSWORD` (propriétaire) et `B2C_APP_PASSWORD` (API). **Hexadécimal** : ils sont insérés dans une adresse de connexion.

1. Render > **New** > **Blueprint**, choisir le dépôt. Render lit `render.yaml` et demande les valeurs « secrètes » :

| Valeur demandée | Où | Contenu |
|---|---|---|
| `POSTGRES_PASSWORD` | `b2c-postgres` | mot de passe du propriétaire |
| `B2C_APP_PASSWORD` | `b2c-postgres` | mot de passe de l'API |
| `DATABASE_URL` | `b2c-api` **et** `b2c-migrate` | `postgresql://b2c_app:<B2C_APP_PASSWORD>@b2c-postgres:5432/b2c` |
| `DIRECT_URL` | `b2c-migrate` | `postgresql://b2c_migrator:<POSTGRES_PASSWORD>@b2c-postgres:5432/b2c` |
| `SMTP_PASSWORD` | `b2c-api` | mot de passe de la boîte `noreply@b2cxpress.com` (voir DEPLOYMENT.md § E-mail) |
| `VITE_COMPANY_SLUG` | `b2c-web` | identifiant public de l'entreprise (par exemple `b2c`) : **le même** que celui créé à l'étape 5 |
| `SEED_SUPERADMIN_EMAIL`, `SEED_SUPERADMIN_PASSWORD` | `b2c-migrate` | premier administrateur de la plateforme (mot de passe d'au moins 10 caractères, non courant) |
| `PGPASSWORD`, `BACKUP_PASSPHRASE`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ENDPOINT`, `AWS_DEFAULT_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | `b2c-backup` | sauvegarde quotidienne (§ 5) : mot de passe de `b2c_migrator`, phrase de chiffrement à garder hors de Render, bucket S3 dédié et sa clé |

2. **Sauvegardez `TOTP_ENCRYPTION_KEY`** (générée par Render pour `b2c-api`, onglet Environment) **hors de Render** : la perdre rend les secrets de double authentification illisibles. `JWT_ACCESS_SECRET` aussi est générée.
3. **Ordre au premier déploiement** : laissez d'abord `b2c-postgres` et `b2c-redis` démarrer ; puis lancez **`b2c-migrate`** (bouton **Trigger Run**) et vérifiez dans ses journaux « All migrations have been successfully applied » puis la fin du script de synchronisation. Ensuite seulement `b2c-api` puis `b2c-web` démarrent correctement (relancez leur déploiement s'ils ont échoué avant les migrations). **À chaque mise à jour** : déployer, puis relancer `b2c-migrate` (il est idempotent).
4. Domaines : dans `b2c-web` > **Settings** > **Custom Domains**, ajouter `b2cxpress.com` **et** `admin.b2cxpress.com`. Chez votre registrar (Namecheap), créer les enregistrements DNS que Render indique (un `ALIAS`/`A` pour le domaine nu, un `CNAME` pour `admin`) ; Render délivre les certificats.
5. Créer l'entreprise : se connecter au panel `https://admin.b2cxpress.com` avec le compte du premier administrateur (activer la double authentification), écran **Entreprises** : `slug` = `VITE_COMPANY_SLUG`, préfixes de suivi et de code client, administrateur de l'entreprise (il reçoit l'invitation par e-mail : vérifie au passage l'envoi, DEPLOYMENT.md § E-mail).
6. **Effacer** `SEED_SUPERADMIN_PASSWORD` (et l'e-mail) de `b2c-migrate` une fois le compte créé.
7. Reconstruire `b2c-web` si vous changez `VITE_COMPANY_SLUG`, `SITE_URL` ou la marque : ces valeurs sont lues à la **construction** du site.

## 5. Sauvegardes (RISKS.md A3)

**Base de données — automatisée** : la tâche planifiée `b2c-backup` (tous les jours à 07:00 UTC) exécute `docker/render/backup.sh` : `pg_dump` → vérification que le fichier contient des tables → chiffrement GnuPG (AES-256, avec contrôle d'intégrité) → copie **hors de Render** dans un stockage objet compatible S3 → **relecture de la copie** (téléchargement, somme de contrôle, déchiffrement, lecture par `pg_restore`). Si une étape échoue, la tâche échoue (Render le signale) : une sauvegarde qu'on n'a pas pu relire n'est pas une sauvegarde. Les sauvegardes de plus de 30 jours sont supprimées (au moins 7 sont toujours conservées, et seuls les fichiers `db-AAAAMMJJ-HHMMSS.dump.gpg` du dossier concerné peuvent l'être).

**Coût du stockage hors de Render** : une sauvegarde pèse quelques dizaines de Ko à quelques Mo (47 Ko pour la base de développement) ; 30 jours de sauvegardes restent donc très en dessous de 1 Go. AWS S3 coûterait quelques centimes par mois, mais n'a pas d'offre gratuite durable. **Deux fournisseurs compatibles S3 ont une offre gratuite permanente suffisante** (consultée sur leurs pages officielles le 11 novembre 2026 : à revérifier à l'inscription) :

| Fournisseur | Gratuit | Réglages (format habituel, à confirmer dans leur tableau de bord) |
|---|---|---|
| **Backblaze B2** | les 10 premiers Go de stockage, toujours gratuits ; appels S3 gratuits pour le paiement à l'usage | `BACKUP_S3_ENDPOINT=https://s3.<région>.backblazeb2.com`, `AWS_DEFAULT_REGION=<région>` (par exemple `us-west-004`), clé d'application limitée au bucket |
| **Cloudflare R2** | 10 Go-mois de stockage et 1 million d'écritures par mois, sortie de données gratuite | `BACKUP_S3_ENDPOINT=https://<identifiant-du-compte>.r2.cloudflarestorage.com`, `AWS_DEFAULT_REGION=auto`, jeton d'accès limité au bucket |

Le script est le même pour tous (aucune modification de code) ; il désactive les sommes de contrôle supplémentaires d'AWS CLI que ces fournisseurs n'exigent pas. **Je n'ai pu essayer qu'avec SeaweedFS** : le premier lancement sur le fournisseur choisi est à vérifier (la tâche échoue clairement si quelque chose ne va pas). Vous devez créer le compte et le bucket vous-même ; l'inscription peut demander une adresse e-mail, voire une carte bancaire selon le fournisseur (non vérifié) : ne dépassez pas l'offre gratuite en y mettant aussi les pièces jointes sans surveiller l'espace (10 Go partagés).

À fournir (saisies à la création du Blueprint) : `PGPASSWORD` (mot de passe de `b2c_migrator`), `BACKUP_PASSPHRASE` (phrase de chiffrement : **à conserver hors de Render, sans elle les sauvegardes sont illisibles**), `BACKUP_S3_BUCKET`, `BACKUP_S3_ENDPOINT` (vide pour AWS S3), `AWS_DEFAULT_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`. Utilisez un bucket **dédié, dans un compte distinct de Render**, avec une clé qui n'a que le droit de lister, écrire et supprimer dans ce bucket.

**Restauration** (exercice à faire avant l'ouverture, puis régulièrement) : dans une base **vide ou de test**, jamais directement sur la production :

```bash
# créer la base cible sur le service b2c-postgres, puis, avec la même image et les mêmes variables :
TARGET_DATABASE=b2c_restauration restore.sh latest        # ou restore.sh db-20261111-070000.dump.gpg
```

`restore.sh` contrôle la somme, déchiffre, restaure avec `pg_restore --exit-on-error` et refuse de s'exécuter sans `TARGET_DATABASE`. Pour une vraie reprise après sinistre : restaurer dans une base neuve, relancer `b2c-migrate` (idempotent), puis faire pointer `DATABASE_URL` vers elle.

**Pièces jointes — non sauvegardées par ce mécanisme** : elles vivent sur le disque de `b2c-api`, qu'une autre tâche ne peut pas monter. Deux options : (a) **recommandée** : passer le stockage en S3 (`STORAGE_DRIVER=s3` et variables `S3_*` de `.env.production.example`) sur le même fournisseur, avec versionnage du bucket (l'adaptateur S3 n'a été éprouvé que contre SeaweedFS, RISKS.md B4) ; (b) consulter la documentation de Render sur les instantanés de disque (je ne l'ai pas vérifiée : fréquence, durée de conservation, restauration) et ne pas s'y fier seul.

**Vérifié en local** (image `b2c-backup`, PostgreSQL 17 de développement et SeaweedFS comme stockage S3) : sauvegarde de `b2c_dev` puis restauration dans une base vide : mêmes tables (55), mêmes permissions (72), mêmes migrations (14) ; mauvaise phrase de chiffrement : échec net (code de sortie ≠ 0) ; rétention : de faux anciens fichiers `db-2020…` supprimés, un fichier étranger et les sauvegardes récentes conservés. **Non vérifié** : exécution sur Render, fournisseur S3 réel, durée sur une base volumineuse.

## 6. À vérifier au premier déploiement (non vérifiable en local)

| Point | Comment vérifier |
|---|---|
| **Adresse réelle du client** | nginx transmet à l'API l'en-tête `CF-Connecting-IP` de Render (réécrit par la plateforme) dans `X-Forwarded-For`, avec `TRUST_PROXY=true` (un seul saut). **À confirmer** : faire deux connexions depuis deux adresses différentes et vérifier dans les journaux de l'API qu'elles ne partagent pas la même adresse (sinon la limite de débit frapperait tous les visiteurs ensemble) ; vérifier qu'un en-tête `CF-Connecting-IP` forgé par un visiteur est écrasé par Render |
| Santé | `https://b2cxpress.com/health/ready` répond 200 ; contrôle de santé de `b2c-web` vert |
| HTTPS et HSTS | les deux domaines servent un certificat valide, `Strict-Transport-Security` présent |
| Cookie de session | connexion au site et au panel, déconnexion, session conservée après un redémarrage de l'API |
| Pièces jointes | téléverser puis télécharger une facture ; redémarrer l'API : le fichier est toujours là (disque) |
| E-mail | confirmation de compte reçue (Namecheap, SPF/DKIM/DMARC), voir DEPLOYMENT.md |
| Suivi public | le suivi d'un vrai numéro retrouve le colis ; une notification est réellement envoyée (preuve que la base du service privé garde bien le contournement de la RLS) |
| Redémarrage | arrêter puis relancer chaque service ; reprise sans intervention |
| Performance et SEO | PageSpeed Insights et Lighthouse sur `https://b2cxpress.com` ; déclarer le site à Search Console et Bing (SEO.md § 8) |

## 7. Ce qui a été vérifié en local

Contrôle `docker compose -f docker/render/compose.check.yml up -d --build` (mêmes images, mêmes cibles `IMAGE_TARGET` et mêmes variables que `render.yaml`, réseau Docker, volumes nommés appartenant à root comme un disque Render, secrets jetables) :

| Vérifié | Résultat |
|---|---|
| Les 4 images se construisent avec `IMAGE_TARGET` (`api-render`, `web-render`, `migrate`) et l'image PostgreSQL de Render | oui (API 811 Mo, nginx 79 Mo, migration 1,39 Go, PostgreSQL 423 Mo) |
| Migrations (14) appliquées avec le propriétaire `b2c_migrator` du service privé, puis synchronisation (72 permissions, 14 rôles) et création du super administrateur | oui |
| `b2c_migrator` super-utilisateur, `b2c_app` sans privilège ; les deux fonctions `SECURITY DEFINER` (suivi public, notifications) appartiennent à `b2c_migrator` ; données dans le sous-dossier `PGDATA` du disque | oui |
| API : démarre sur `PORT=10000`, contrôle de santé vert ; le processus tourne **sous l'utilisateur `node`** alors que le disque monté appartenait à root (l'entrée du conteneur rend le dossier à `node`, puis abaisse les privilèges) ; écriture sur le disque possible | oui |
| nginx en HTTP sur `$PORT` : `/health/ready` relayé, site pré-rendu servi compressé (`gzip_static`), 301 sans barre finale, `X-Robots-Tag` sur l'espace client et le panel, secours de l'application monopage du panel | oui |
| Deux domaines sur un seul service (site et panel) distingués par le nom d'hôte | oui |
| Nom d'hôte inconnu (type `*.onrender.com`) : 301 vers le domaine du site ; contrôle de santé toujours répondu quel que soit l'hôte | oui |
| Relais `/v1` jusqu'à l'API et la base en rôle `b2c_app` (réponse métier `COMPANY_NOT_FOUND` attendue pour une entreprise inexistante) | oui |
| Adresse du client : avec `CF-Connecting-IP: 203.0.113.9`, la clé de limitation de débit dans Redis est `rl:auth-login:203.0.113.9` ; sans cet en-tête, nginx retombe sur l'adresse de la connexion (`rl:public-company:172.23.0.1`) | oui (le comportement **de Render** reste à confirmer, § 6) |
| Redémarrage de PostgreSQL puis de l'API : l'API redevient prête, les données (72 permissions, le super administrateur) sont conservées | oui |

**Non vérifié** : tout ce qui dépend de Render lui-même (Blueprint accepté tel quel, champs `fromService` / `hostport` / `keyvalue`, disques, certificats, DNS, en-tête `CF-Connecting-IP`, redémarrages gérés par la plateforme, coûts), l'envoi d'e-mails par Namecheap, et le parcours complet d'un client (non rejoué sur cette pile : la double authentification obligatoire du personnel interdit un essai sans application d'authentification). Les 998 tests automatisés ne tournent pas sur cette pile ; ils ont été exécutés sur la pile de développement avant ces changements.

## 8. Limites

- Aucun essai sur Render ; aucune vérification de coût.
- Pas de haute disponibilité ; sauvegarde de la base automatisée mais pièces jointes à protéger séparément (§ 5) ; pas de supervision externe (RISKS.md A4) : Render propose des alertes de service, à activer.
- Les contrôles de santé de Render ne s'appliquent qu'au service web : une panne de l'API se voit par `/health/ready` relayé, pas par son propre statut.
- La tâche de migration est manuelle par choix (jamais de migration automatique sur une base de production sans qu'on la déclenche).
- Les images pèsent plusieurs centaines de Mo (API : RISKS.md C11) : le premier déploiement est long.
