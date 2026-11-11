# Déploiement en production

Ce guide décrit comment installer la plateforme sur **un serveur** avec Docker, comment la sauvegarder, la restaurer et la mettre à jour. Il a été **exécuté pour de vrai sur un poste de développement** (Windows 11, Docker Desktop, conteneurs Linux) avec un domaine `localhost` et un certificat auto-signé : les commandes et résultats ci-dessous viennent de cet essai. **Rien n'a été essayé sur un serveur Linux public, avec un vrai domaine, un vrai certificat ni un vrai fournisseur d'e-mail** : voir « Ce qui n'a pas été vérifié » et [RISKS.md](RISKS.md) avant d'ouvrir le service au public.

## 1. Architecture déployée

```
Internet ──443/80──► nginx (conteneur « web » : HTTPS, deux noms de domaine)
                        ├── exemple.com        → site statique (pages publiques, espace client)
                        └── admin.exemple.com  → panel d'administration (application monopage)
                        (les deux relaient /v1 vers l'API)
                        └──► api (NestJS, port 3100, réseau interne)
                               ├──► postgres (17, volume pgdata, réseau interne)
                               ├──► redis (7, mot de passe, volume redisdata, réseau interne)
                               └──► volume « files » (pièces jointes) ou stockage S3
migrate : tâche ponctuelle (rôle de migration) exécutée avant chaque démarrage de l'API
```

- Seul **nginx** publie des ports (80 et 443). PostgreSQL, Redis et l'API ne sont joignables que depuis le réseau Docker interne.
- nginx est le **seul point d'entrée** : il écrase `X-Forwarded-For` par l'adresse réelle du client et l'API ne fait confiance qu'à un seul saut (`TRUST_PROXY=true`). Ne placez **aucun autre mandataire devant nginx** sans revoir ce réglage (voir SECURITY.md) : sinon tous les visiteurs partageraient la même adresse et la limite de débit les frapperait ensemble.
- L'API tourne en utilisateur sans privilège (`node`), avec uniquement les dépendances de production ; le client Prisma est généré à la construction. L'image de migration contient les outils de développement : elle ne sert qu'à la tâche `migrate` et n'est jamais exposée.
- Le site et le panel sont **construits pour une seule entreprise** (`COMPANY_SLUG`) : changer d'entreprise ou de marque demande de reconstruire l'image `web`.
- Le **panel d'administration** (`ADMIN_HOST`, par exemple `admin.exemple.com`) est servi par le **même nginx**, sur son propre nom de domaine, avec ses propres en-têtes (jamais indexé, jamais dans un cadre) et ses propres cookies de session. Voir [ADMIN.md](ADMIN.md).

Fichiers : [docker/Dockerfile](../docker/Dockerfile), [docker/compose.prod.yml](../docker/compose.prod.yml), [docker/nginx/](../docker/nginx/), [.env.production.example](../.env.production.example).

## 2. Prérequis

| Élément | Détail |
|---|---|
| Serveur | Linux avec Docker Engine et Docker Compose v2. **Dimensionnement non établi** : les mesures de charge (TEST_PLAN.md) viennent d'un poste de travail, pas d'un serveur. Prévoir de la marge et mesurer |
| Domaine | **Deux** noms de domaine dont le DNS pointe vers le serveur : le site (`PUBLIC_HOST`) et le panel (`ADMIN_HOST`, par exemple `admin.exemple.com`) |
| Certificat TLS | `fullchain.pem` et `privkey.pem` **couvrant les deux noms** (deux SAN, ou un certificat générique), dans le dossier `CERTS_DIR` (par défaut `certs/` à la racine du dépôt, **jamais versionné**). Exemple avec Let's Encrypt (certbot, **non essayé ici**) : obtenir le certificat par la méthode « webroot » puis copier ou monter les deux fichiers ; renouveler avant l'expiration et recharger nginx (`docker compose ... exec web nginx -s reload`) |
| E-mail | Un compte SMTP réel (hôte, port, identifiants, adresse d'expédition). **Obligatoire** : l'API refuse de démarrer sans `SMTP_HOST` et `MAIL_FROM`. Sans e-mail, personne ne peut confirmer son compte, ni réinitialiser son mot de passe |
| Pare-feu | N'ouvrir que 80 et 443 (et l'accès d'administration SSH, restreint). Ne pas publier les ports de PostgreSQL ou Redis |
| Git, Node | Facultatifs sur le serveur : tout se construit dans Docker. Node 22 n'est utile que pour lancer les scripts `npm run prod:*` |

## 3. Première installation

Depuis la racine du dépôt :

```bash
# 1. Génère .env.production avec des secrets aléatoires (n'écrase jamais un fichier existant, n'affiche aucun secret)
npm run setup:env:prod

# 2. Compléter à la main .env.production : PUBLIC_HOST, ADMIN_HOST, COMPANY_SLUG, SMTP_*, MAIL_FROM,
#    et SEED_SUPERADMIN_EMAIL / SEED_SUPERADMIN_PASSWORD (premier administrateur, mot de passe d'au moins 10 caractères, non courant)
# 3. Déposer fullchain.pem et privkey.pem dans certs/

# 4. Construire et démarrer (la tâche migrate s'exécute avant l'API)
npm run prod:up

# 5. Vérifier
docker compose -f docker/compose.prod.yml --env-file .env.production ps
SMOKE_URL=https://exemple.com SMOKE_ADMIN_URL=https://admin.exemple.com SMOKE_HTTP_URL=http://exemple.com node scripts/prod-smoke.mjs
```

**Sauvegardez tout de suite, hors du serveur, `TOTP_ENCRYPTION_KEY` et `JWT_ACCESS_SECRET`** (coffre de secrets). Perdre `TOTP_ENCRYPTION_KEY` rend illisibles les secrets de double authentification : tous les comptes équipés devraient être réinitialisés à la main en base.

### Premier administrateur et première entreprise

1. Le compte de `SEED_SUPERADMIN_EMAIL` est créé **une seule fois** par la tâche `migrate`. Ensuite, **effacez `SEED_SUPERADMIN_PASSWORD` de `.env.production`** (un compte existant n'est jamais modifié).
2. Ouvrez **`https://admin.exemple.com/login`**, cliquez sur « Accès équipe plateforme » et connectez-vous avec ce compte (**le super administrateur n'a pas d'écran sur le site**). En production la double authentification est **obligatoire** : à la première connexion, l'API répond mais toute route d'administration renvoie `403 TOTP_ENROLLMENT_REQUIRED` tant que le compte n'a pas activé la double authentification (`POST /v1/me/2fa/setup` puis `/enable`, avec une application d'authentification compatible TOTP). Conservez les 10 codes de secours remis.
3. Créez l'entreprise depuis l'écran **Entreprises** du panel (ou, équivalent, par `POST /v1/platform/companies`) (`name`, `slug` **identique à `COMPANY_SLUG`**, `trackingPrefix`, `customerCodePrefix`, `adminEmail`, `adminFirstName`, `adminLastName`). L'administrateur de l'entreprise reçoit une invitation par e-mail, doit définir son mot de passe puis activer à son tour la double authentification. L'invitation arrive sur le **panel** : l'administrateur y définit son mot de passe, active sa double authentification, puis **invite lui-même son personnel** depuis l'écran Utilisateurs.
4. Entrepôts, agences, grilles de tarifs, règles de remise : à configurer par l'administrateur de l'entreprise depuis l'espace du personnel. **Aucun tarif par défaut n'existe** : tant qu'aucune grille n'est activée, le calculateur répond « tarif indisponible ».

### Variables de `.env.production`

| Variable | Rôle |
|---|---|
| `PUBLIC_HOST`, `ADMIN_HOST`, `COMPANY_SLUG`, `BRAND_NAME` | Domaine du site, domaine du panel, entreprise servie, marque affichée (fixés à la **construction**) |
| `HTTP_PORT`, `HTTPS_PORT`, `CERTS_DIR` | Ports publiés (80/443 par défaut) et dossier des certificats |
| `POSTGRES_MIGRATOR_PASSWORD`, `POSTGRES_APP_PASSWORD`, `REDIS_PASSWORD` | Mots de passe générés ; l'API n'utilise que le rôle `b2c_app` (soumis à la RLS) |
| `JWT_ACCESS_SECRET`, `TOTP_ENCRYPTION_KEY` | Secrets générés, **distincts** ; la production refuse de démarrer si l'un manque ou s'ils sont égaux |
| `SMTP_*`, `MAIL_FROM` | Envoi d'e-mails (obligatoires) |
| `STORAGE_DRIVER` (+ `S3_*`) | `disk` (volume `files`, à sauvegarder) ou `s3` (voir INTEGRATIONS.md : testé seulement avec SeaweedFS) |
| `PAYMENT_WEBHOOK_PROVIDER`, `PAYMENT_WEBHOOK_SECRET` | À laisser vides tant qu'aucun prestataire de paiement n'est branché |
| `LOG_LEVEL` | `info` par défaut |

Réglages **imposés** par `compose.prod.yml` (non modifiables par le fichier d'environnement) : `NODE_ENV=production`, `COOKIE_SECURE=true`, `REQUIRE_STAFF_2FA=true`, `TRUST_PROXY=true`, `ENABLE_DOCS=false`. La production refuse aussi un coût argon2 trop faible, un transport e-mail « memory » et une valeur de secret de substitution.

## 4. Mises à jour

```bash
npm run prod:backup            # 1. sauvegarde AVANT toute mise à jour
git pull                       # 2. nouvelle version
npm run prod:up                # 3. reconstruit les images ; migrate applique les migrations en attente, puis l'API redémarre
node scripts/prod-smoke.mjs    # 4. contrôle de fumée
```

- Les migrations ne vont que **vers l'avant** (pas de retour arrière automatique). En cas de problème après une mise à jour : revenir à la version précédente du code **et** restaurer la sauvegarde faite à l'étape 1 (§ 6).
- Une seule instance de l'API tourne : **l'arrêt est bref mais réel** pendant le redémarrage. Il n'y a ni déploiement sans interruption, ni environnement de préproduction.
- Essai réalisé : relancer `npm run prod:up` sur une pile existante fonctionne (`No pending migrations`, super administrateur inchangé, données conservées).

## 5. Sauvegardes

```bash
npm run prod:backup            # base (pg_dump -Fc) + pièces jointes (si STORAGE_DRIVER=disk) dans backups/, avec empreintes SHA-256
node scripts/prod-backup.mjs backup --keep 14   # garde les 14 dernières
```

- Le script **relit** la sauvegarde de base avec `pg_restore -l` et supprime un fichier illisible.
- **Les sauvegardes restent sur le serveur** : copiez-les ailleurs (autre machine ou stockage objet) et **chiffrez-les** (par exemple `age` ou `gpg`) : elles contiennent toutes les données clients. Cette copie n'est pas automatisée ici.
- Planification : exécuter la commande par `cron` (par exemple chaque nuit) ; **la planification n'a pas été essayée**. Surveillez que la sauvegarde réussit (le script sort avec un code d'erreur sinon).
- Avec `STORAGE_DRIVER=s3`, les pièces jointes ne sont pas dans la sauvegarde : le fournisseur doit les conserver (versionnement, réplication).
- Sauvegardez aussi `.env.production` (secrets) **dans un coffre**, pas avec les données.

## 6. Restauration

### Exercice (sans toucher à la base en service) — à répéter régulièrement

```bash
npm run prod:drill             # restaure la dernière sauvegarde dans une base TEMPORAIRE, la compare, la supprime
```

Résultat constaté (essai du 2026-10-28) : empreinte conforme ; restauration sans erreur en 2,1 s (0,27 Mio) ; 54 tables et 311 lignes identiques à la base en service ; RLS activée et forcée sur 52 tables ; 9 migrations ; droits du rôle applicatif identiques.

### Sinistre (base perdue) — procédure essayée de bout en bout

Les volumes ont réellement été supprimés puis la pile reconstruite à partir d'une sauvegarde :

```bash
P="docker compose -f docker/compose.prod.yml --env-file .env.production"
$P down -v                                   # (simulation du sinistre : volumes perdus)
$P up -d postgres redis                      # volumes neufs : le rôle b2c_app est recréé par le script d'initialisation
$P exec -T postgres pg_restore -U b2c_migrator -d b2c --exit-on-error < backups/db-AAAAMMJJ-HHMMSS.dump
$P up -d                                     # migrate : « No pending migrations », catalogue resynchronisé
$P exec -T api tar -xzf - -C /data/files < backups/files-AAAAMMJJ-HHMMSS.tar.gz   # pièces jointes (si disk)
node scripts/prod-smoke.mjs                  # contrôle
```

Constaté : 2 entreprises et 2 utilisateurs restaurés, le compte équipé de la double authentification répond `TOTP_REQUIRED` (le secret chiffré est relu avec la même `TOTP_ENCRYPTION_KEY`). Sous Windows (Git Bash), préfixer la commande `tar` de `MSYS_NO_PATHCONV=1` ; sous Linux, rien à faire. Les données saisies **depuis** la sauvegarde sont perdues : le point de restauration est l'instant de la sauvegarde (pas de restauration à la seconde près).

## 7. Exploitation

- **État** : `docker compose -f docker/compose.prod.yml --env-file .env.production ps` (les conteneurs `api`, `postgres`, `redis` ont un contrôle de santé) ; `GET /health/live` (processus) et `GET /health/ready` (PostgreSQL et Redis) passent par nginx.
- **Journaux** : JSON structuré sur la sortie standard (`docker compose ... logs api`) ; les en-têtes `Authorization` et `Cookie` sont masqués. **Aucune rotation ni centralisation n'est configurée** (Docker garde les journaux sans limite par défaut : configurez la rotation du pilote de journalisation).
- **Supervision** : **aucune métrique ni alerte n'est fournie**. À mettre en place avant l'ouverture (surveillance externe de `/health/ready`, espace disque, expiration du certificat, échec de sauvegarde).
- **Notifications** : traitées en tâche de fond dans le processus de l'API (file en base, 4 reprises espacées). Les échecs sont visibles dans l'écran « Notifications » du personnel ; aucune alerte automatique.
- **Redémarrage** : tous les services ont `restart: unless-stopped`. Essai de redémarrage des conteneurs non réalisé au-delà de la reconstruction décrite plus haut.
- **Certificat** : le renouvellement n'est pas automatisé ; nginx ne le relit qu'au rechargement.
- **Sécurité** : suivre SECURITY.md ; relancer `npm audit --omit=dev` à chaque mise à jour ; l'image de base (`node:22-alpine`, `nginx:1.27-alpine`, `postgres:17-alpine`, `redis:7-alpine`) doit être reconstruite régulièrement pour recevoir les correctifs.

## 8. Ce qui a été vérifié (essai du 2026-10-28)

Pile construite et lancée depuis zéro avec `docker/compose.prod.yml` ; `scripts/prod-smoke.mjs` : **22 contrôles sur 22 réussis** par le point d'entrée HTTPS :
- `/health/ready` (PostgreSQL et Redis) ; pages servies avec CSP stricte, HSTS, `nosniff`, `Referrer-Policy` ; version de nginx non divulguée ; coquille de l'espace client ; vrai 404 pour une page inconnue ; `/docs` non exposé ; ressources `/assets` avec cache immuable ; HTTP redirigé en 301 vers HTTPS ;
- **limite de débit non contournable** : 34 requêtes avec un `X-Forwarded-For` falsifié à chaque fois → des refus 429 apparaissent (nginx écrase l'en-tête) ;
- cookie de renouvellement `HttpOnly; Secure; SameSite=Lax; Path=/v1/auth` ;
- **double authentification obligatoire** : avant activation `403 TOTP_ENROLLMENT_REQUIRED`, activation avec un code calculé, connexion sans code `TOTP_REQUIRED`, rejeu refusé, code suivant accepté, administration ouverte ; création d'une entreprise par la plateforme ;
- l'e-mail d'invitation de l'administrateur de l'entreprise est réellement arrivé (SMTP vers un Mailpit de développement) ; le volume des pièces jointes est inscriptible par l'utilisateur de l'API ; migrations idempotentes à la mise à jour ; sauvegarde, exercice et restauration après sinistre (§ 5 et 6).

Tailles d'images constatées : `web` 76 Mo, `api` 810 Mo, `migrate` 1,39 Go.

## 9. Ce qui n'a pas été vérifié

- Aucun **serveur Linux** réel, aucun **vrai domaine**, aucun **vrai certificat** (essai avec un certificat auto-signé sur `localhost`), aucun **fournisseur SMTP de production**.
- La recette navigateur complète (`npm run test:e2e`) n'a **pas** été rejouée contre cette pile de production : elle tourne sur la pile de développement. Seul le contrôle de fumée ci-dessus a été exécuté sur la pile de production ; les parcours clients et du personnel n'y ont pas été rejoués.
- Pas de test de charge sur la pile Docker de production, pas de test d'endurance, pas de test de panne (arrêt brutal de PostgreSQL ou du serveur).
- Renouvellement de certificat, planification des sauvegardes, rotation des journaux, copie hors serveur : décrits mais **non essayés**.
- Le rôle de migration `b2c_migrator` est le super-utilisateur du conteneur PostgreSQL (comme en développement) : la fonction de recherche publique `SECURITY DEFINER` en dépend. Un hébergement PostgreSQL géré (sans super-utilisateur) n'a pas été essayé et demanderait de revoir les droits (voir SECURITY.md).
- Redirection HTTP→HTTPS : l'adresse de redirection ne reprend pas le port ; sur des ports non standard (essai local en 8080/8443) elle pointe vers le port 443. Sans effet avec les ports 80/443.

## Référencement : ce que le déploiement doit fournir

Détails dans [SEO.md](SEO.md). Au déploiement du site : `PUBLIC_HOST` définitif (il devient `SITE_URL`, base des canonical, hreflang et du sitemap) ; en option `SEO_GOOGLE_SITE_VERIFICATION`, `SEO_BING_SITE_VERIFICATION` et `SEO_ORGANIZATION_JSON` (arguments de construction, voir `.env.production.example`). Le fichier `docker/nginx/default.conf.template` redirige les adresses à barre finale (301), pose `X-Robots-Tag` sur l'espace client et les pages d'authentification, sert les fichiers pré-compressés (`gzip_static`) et distingue le cache des ressources versionnées (`immutable`) des images (une semaine). Après chaque construction : `npm run seo:check`.
