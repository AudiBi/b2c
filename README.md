# Plateforme de logistique et d'expédition (marque : B2C — Business to Customer)

Plateforme multi-entreprises de gestion de colis, d'expéditions aériennes et maritimes, d'entrepôts, d'agences, de facturation et de livraison, pour le marché haïtien.

## État du projet

| Phase | Contenu | État |
|---|---|---|
| 1-2 | Audit, spécifications, architecture, schéma | ☑ documents dans `docs/` |
| 3 | Monorepo, Docker, Prisma, multi-entreprises (RLS), authentification, rôles, audit | ☑ testée |
| 4 | Site public (17 pages, FR/HT/EN), espace client, code client, adresses de réception | ☑ testée |
| **5** | **Colis, préalertes, suivi public, calculateur de frais, pièces jointes** | **☑ implémentée et testée (579 tests au total)** |
| **6** | **Entrepôts (scan, emplacements, inventaire), lots de transport et manifestes, agences, écrans du personnel** | **☑ implémentée et testée (670 tests au total)** |
| **7** | **Factures (numérotation sans trou, avoirs, PDF), paiements (espèces avec caisse, virement / mobile déclaré puis validé, confirmation signée si un prestataire est configuré), remboursements, export comptable, notifications (portail + e-mail avec nouvelles tentatives, modèles FR/HT/EN)** | **☑ implémentée et testée (772 tests au total)** |
| **8** | **Tournées et livreurs, remise avec code, pièce d'identité et photo, solde dû bloquant, échecs de livraison, réclamations, tableau de bord réel, journal d'audit** | **☑ implémentée et testée (856 tests au total)** |
| **9** | **Double authentification (TOTP), revue de sécurité (ASVS niveau 2 comme guide), tests de charge, test de restauration de sauvegarde, stockage S3 (SeaweedFS)** | **☑ implémentée et testée (voir docs/TEST_PLAN.md)** |
| **+** | **Panel d'administration séparé du site** (`apps/admin`) : écrans du personnel, **utilisateurs et rôles**, **entreprises** (plateforme), design dédié, cookies distincts | **☑ implémenté et testé (943 tests au total ; voir docs/ADMIN.md)** |
| **10** | **Images Docker de production, pile de production, sauvegarde et restauration, guide de déploiement, liste des risques** | **☑ réalisée ; la plateforme n'est PAS prête pour le public : voir docs/RISKS.md** |

Ce qui existe :
- une **API REST** (`/v1`) : inscription/connexion/sessions, 12 rôles et 71 permissions, administration des utilisateurs, création des entreprises, journal d'audit immuable, isolement des entreprises par Row-Level Security PostgreSQL ; profil client avec **code client unique**, adresses, bénéficiaires, entrepôts et **adresses de réception personnalisées** ;
- un **site web** (`apps/web`) : 17 pages publiques en français, créole haïtien et anglais (pré-rendues pour le référencement), inscription, connexion, mot de passe oublié, et un espace client. Depuis la phase 5 : **calculateur de frais** (grille tarifaire de l'entreprise, jamais de prix inventé), **suivi public par numéro**, **préalertes** avec facture jointe et **Mes colis** (historique, frais provisoires) ;
- **personnel** (phase 6) : réception par scan, pesée, rangement, inventaire, anomalies, **lots de transport** (chargement contrôlé, départ/arrivée qui font avancer les colis, manifeste CSV et PDF), **agences** (réception par scan, prêt pour retrait) ;
- côté API : **colis** à 17 statuts et machine d'états contrôlée (aussi en base), réception avec rapprochement automatique/manuel, colis non identifiés, pesée avec frais, regroupement, retenue, **grilles tarifaires versionnées**, pièces jointes à liens signés.

- **livraison et pilotage** (phase 8) : **tournées** d'agence confiées à un livreur qui ne voit que les siennes, **remise** au comptoir ou en tournée avec le **code du client**, la pièce d'identité (4 derniers caractères) et la photo selon la règle de l'entreprise, **bloquée si un solde est dû** (dérogation motivée et journalisée), échecs de livraison avec motif et retour en agence, **réclamations** (échanges, notes internes, clôture), **tableau de bord** calculé sur les données réelles (jamais de chiffre de remplacement) et **journal d'audit** consultable ;
- **finance et notifications** (phase 7) : factures en brouillon puis émises (numéro `INV-AAAA-NNNNNN` sans trou, immuables), avoirs, PDF de facture et de reçu, paiements **en espèces** (caisse ouverte exigée, Idempotency-Key, caisse par agence) et **virement / paiement mobile déclaré par le client puis validé par un agent**, remboursements enregistrés, synthèse de rapprochement et export CSV, point d'entrée de **confirmation signée** (actif seulement si un prestataire est configuré) ; notifications par **portail et e-mail** (file en base, nouvelles tentatives, journal, relance, modèles FR/HT/EN modifiables), SMS et WhatsApp « ignorés — canal non configuré ».

**Il n'y a pas encore** de signature de remise, de carte ni d'itinéraire (phase 8 : voir les réserves), de paiement en ligne (aucun prestataire choisi), d'envoi par SMS ou WhatsApp, ni d'intégration de transporteur. Les pièces jointes sont stockées sur disque local par défaut ; un adaptateur S3 existe (`STORAGE_DRIVER=s3`) mais n'a été testé que contre SeaweedFS. Voir [docs/ROADMAP.md](docs/ROADMAP.md) pour les réserves.

## Prérequis

- Node.js ≥ 22.12 et npm
- Docker (PostgreSQL 17, Redis 7 et Mailpit tournent en conteneurs)

Ports utilisés (choisis pour ne pas entrer en conflit avec un PostgreSQL ou Redis local) : PostgreSQL **5442**, Redis **6389**, SMTP Mailpit **1035**, interface Mailpit **8035**, API **3100**.

## Démarrage local

```bash
npm install
npm run setup:env        # crée .env avec des secrets aléatoires (n'écrase jamais un .env existant)
npm run docker:up        # PostgreSQL, Redis, Mailpit
npm run build            # compile le package partagé, génère le client Prisma, compile l'API
npm run db:migrate       # applique les migrations (rôle de migration)
npm run db:seed          # synchronise permissions et rôles ; crée le super administrateur si configuré
npm start                # API sur http://localhost:3100  (documentation interactive : /docs)
```

### Lancer le panel d'administration

```bash
npm run dev:admin        # http://localhost:5174 (l'API doit tourner ; le panel la joint par le proxy /v1)
```

Le **personnel** (administrateur de l'entreprise, réception, caisse, livreur…) et l'**équipe plateforme** travaillent dans ce panel, pas sur le site. Détails, écrans et droits : [docs/ADMIN.md](docs/ADMIN.md).

### Lancer le site

```bash
npm run dev:web          # http://localhost:5173 (l'API doit tourner : le site la joint par le proxy /v1)
```

Le site sert **une entreprise** (variable `VITE_COMPANY_SLUG`, `demo` par défaut). Pour qu'elle existe, créez-la : `DEMO_PASSWORD='…' npm run db:seed:demo` (voir plus bas), ou, avec un super administrateur, `POST /v1/platform/companies`. Pour voir des adresses de réception, créez un entrepôt (`POST /v1/admin/warehouses`, rôle administrateur) : sans entrepôt actif, l'espace client l'indique. Version de production du site : `npm run build:web` (dossier `apps/web/dist/client`) puis `npm run preview:web` pour l'essayer sur http://localhost:4173. Détails et déploiement : [docs/WEB.md](docs/WEB.md).

Les e-mails envoyés en développement (confirmation, invitation, réinitialisation) s'affichent dans Mailpit : http://localhost:8035.

### Créer le premier super administrateur

Renseigner `SEED_SUPERADMIN_EMAIL` et `SEED_SUPERADMIN_PASSWORD` dans `.env` (mot de passe d'au moins 10 caractères, non courant), puis relancer `npm run db:seed`. Le compte est créé une seule fois (un compte existant n'est jamais modifié). Retirer ensuite le mot de passe du fichier `.env`.
Le super administrateur se connecte avec `POST /v1/auth/login` (sans `companySlug`), puis crée une entreprise avec `POST /v1/platform/companies` : l'administrateur de cette entreprise reçoit un lien d'activation par e-mail.

### Comptes de démonstration (développement uniquement)

```bash
DEMO_PASSWORD='<un mot de passe de votre choix>' npm run db:seed:demo
```

Crée l'entreprise `demo` (nom préfixé « DEMO », préfixe de code client `DM`) avec un compte par rôle, tous en `@demo.invalid` et tous avec le mot de passe donné : `company-admin`, `logistics-manager`, `billing-agent`, `customer-service`, `driver`, `customer-individual`, `customer-business`, `auditor`. Le script ajoute aussi un entrepôt, une catégorie et une grille tarifaire aérienne **fictifs** (étiquetés DEMO) pour que le calculateur et les préalertes fonctionnent. Trois comptes à portée limitée sont aussi créés : `reception-agent` et `warehouse-manager` (entrepôt DEMO), `agency-manager` (agence DEMO fictive). Le script refuse de s'exécuter si `NODE_ENV=production`. Aucun mot de passe n'est enregistré dans le dépôt.

## Tests

```bash
npm test          # package partagé (88) + API (525, plus 7 de stockage S3 ignorés) + site (157) + panel (84)
npm run test:e2e  # recette navigateur : construit l'API et le site, puis Playwright (89 scénarios)
npm run loadtest  # tests de charge (suivi, calculateur, limite de débit) : sème des colis dans la base de TEST
npm run backup:check # sauvegarde la base de test, la restaure dans une copie et compare (RLS, audit, droits)
npm run test:s3   # adaptateur S3 contre SeaweedFS (profil Docker « storage », voir docs/INTEGRATIONS.md)
```

## Production

Guide complet : [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) ; risques avant ouverture : [docs/RISKS.md](docs/RISKS.md).

```bash
npm run setup:env:prod   # crée .env.production (secrets aléatoires) ; à compléter : domaine, entreprise, SMTP
npm run prod:up          # construit et lance la pile (nginx HTTPS, API, PostgreSQL, Redis, migrations)
npm run prod:smoke       # contrôle de fumée (SMOKE_URL=https://votre-domaine)
npm run prod:backup      # sauvegarde la base et les pièces jointes dans backups/
npm run prod:drill       # restaure la dernière sauvegarde dans une base temporaire et la compare
```

Les tests de l'API utilisent de **vrais** PostgreSQL et Redis (les conteneurs ci-dessus), dans la base `b2c_test` et la base Redis n° 1, jamais dans la base de développement. Avant chaque exécution la base de test est mise à jour par les migrations, ses données sont effacées (le script refuse toute base dont le nom ne finit pas par `_test`) et le catalogue des rôles est resynchronisé. La recette navigateur utilise aussi la base de test, l'entreprise `e2e`, et lit les vrais e-mails dans Mailpit. Première utilisation : `npx playwright install chromium` (sinon Microsoft Edge est utilisé s'il est installé). Détail et résultats : [docs/TEST_PLAN.md](docs/TEST_PLAN.md).

## Variables d'environnement

Toutes sont décrites dans [.env.example](.env.example) ; `npm run setup:env` génère les secrets. L'API refuse de démarrer si la configuration est invalide (liste complète des erreurs).

| Variable | Rôle |
|---|---|
| `DATABASE_URL` | PostgreSQL, rôle **applicatif** `b2c_app` (soumis à la RLS) |
| `DIRECT_URL` | PostgreSQL, rôle de **migration** `b2c_migrator` (migrations et seeds uniquement) |
| `TEST_DATABASE_URL`, `TEST_DIRECT_URL` | Mêmes rôles, base `b2c_test` |
| `REDIS_URL` | Limitation de débit et verrouillage des connexions |
| `JWT_ACCESS_SECRET` | Signature des jetons d'accès (≥ 32 caractères aléatoires) |
| `ACCESS_TOKEN_TTL_SECONDS`, `REFRESH_TOKEN_TTL_DAYS` | Durées de session (900 s / 30 j par défaut) |
| `COOKIE_SECURE` | `true` obligatoire en production |
| `ARGON2_MEMORY_KIB` | Coût du hachage des mots de passe (≥ 19456 en production) |
| `MAIL_TRANSPORT`, `SMTP_*`, `MAIL_FROM` | Envoi d'e-mails (`smtp` ; `memory` réservé aux tests) |
| `WEB_PUBLIC_URL`, `CORS_ORIGINS` | Liens dans les e-mails ; origines autorisées |
| `TRUST_PROXY` | `true` derrière un proxy de confiance (lit `X-Forwarded-For`) |
| `ENABLE_DOCS` | Expose `/docs` (désactiver en production si l'API n'est pas publique) |
| `VITE_COMPANY_SLUG`, `VITE_BRAND_NAME`, `SITE_URL` | **Site web, à la construction** : entreprise servie, nom de marque, URL publique (liens canoniques, sitemap) |
| `SEED_SUPERADMIN_EMAIL/PASSWORD`, `DEMO_PASSWORD` | Amorçage (voir ci-dessus) |

Aucun secret n'est dans le dépôt : `.env` est ignoré par Git et `.env.example` ne contient que des marqueurs.

## Structure

```
apps/api/           API NestJS (modules : security, auth, iam, audit, platform, customers, infra, health…)
apps/web/           Site public et espace client (React, pré-rendu), tests Vitest et Playwright
packages/shared/    catalogue des permissions et rôles, PermissionSet, schémas zod partagés
prisma/             schema.prisma, migrations/ (0001 à 0003), seed.ts, seed-demo.ts
docker/             compose.dev.yml, initialisation des rôles PostgreSQL
docs/               audit, spécifications, architecture, schéma, API (+ openapi.json), sécurité, tests
```

## Documents

| Document | Contenu |
|---|---|
| [docs/PROJECT_AUDIT.md](docs/PROJECT_AUDIT.md) | Audit du dépôt et de la référence, risques |
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | Hypothèses, rôles, exigences |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Architecture cible + écarts constatés à l'implémentation (§15) |
| [docs/DOMAIN_MODEL.md](docs/DOMAIN_MODEL.md) | Règles métier, machine d'états des colis |
| [docs/DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md) | Schéma cible + état réellement migré (§0) |
| [docs/WEB.md](docs/WEB.md) | Site web : architecture, déploiement statique, textes, limites |
| [docs/API.md](docs/API.md), [docs/openapi.json](docs/openapi.json) | Routes, conventions, erreurs |
| [docs/SECURITY.md](docs/SECURITY.md) | Mesures en place, limites connues, vulnérabilités de dépendances |
| [docs/TEST_PLAN.md](docs/TEST_PLAN.md) | Ce qui est testé, résultats, parcours du cahier couverts |
| [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) | État des intégrations externes |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phases et backlog |

À venir : `DEPLOYMENT.md` (phase 10).
