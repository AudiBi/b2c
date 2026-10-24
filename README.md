# Plateforme de logistique et d'expédition (nom provisoire : TransitHaïti)

Plateforme multi-entreprises de gestion de colis, d'expéditions aériennes et maritimes, d'entrepôts, d'agences, de facturation et de livraison, pour le marché haïtien.

## État du projet

| Phase | Contenu | État |
|---|---|---|
| 1-2 | Audit, spécifications, architecture, schéma | ☑ documents dans `docs/` |
| **3** | **Monorepo, Docker, Prisma, multi-entreprises (RLS), authentification, rôles, audit** | **☑ implémentée et testée (156 tests)** |
| 4-10 | Site public, colis, entrepôts, finance, livraison, etc. | ☐ non commencées |

Ce qui existe : une API REST (`/v1`) avec inscription/connexion/sessions, 12 rôles et 68 permissions, administration des utilisateurs, création des entreprises par la plateforme, journal d'audit immuable, isolement des entreprises par Row-Level Security PostgreSQL. **Il n'y a pas encore d'interface web, de colis, de tarifs ni de paiements.** Voir [docs/ROADMAP.md](docs/ROADMAP.md).

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

Les e-mails envoyés en développement (confirmation, invitation, réinitialisation) s'affichent dans Mailpit : http://localhost:8035.

### Créer le premier super administrateur

Renseigner `SEED_SUPERADMIN_EMAIL` et `SEED_SUPERADMIN_PASSWORD` dans `.env` (mot de passe d'au moins 10 caractères, non courant), puis relancer `npm run db:seed`. Le compte est créé une seule fois (un compte existant n'est jamais modifié). Retirer ensuite le mot de passe du fichier `.env`.
Le super administrateur se connecte avec `POST /v1/auth/login` (sans `companySlug`), puis crée une entreprise avec `POST /v1/platform/companies` : l'administrateur de cette entreprise reçoit un lien d'activation par e-mail.

### Comptes de démonstration (développement uniquement)

```bash
DEMO_PASSWORD='<un mot de passe de votre choix>' npm run db:seed:demo
```

Crée l'entreprise `demo` (nom préfixé « DEMO ») avec un compte par rôle, tous en `@demo.invalid` et tous avec le mot de passe donné : `company-admin`, `logistics-manager`, `billing-agent`, `customer-service`, `driver`, `customer-individual`, `customer-business`, `auditor`. Les rôles d'entrepôt et d'agence (`WAREHOUSE_MANAGER`, `RECEPTION_AGENT`, `AGENCY_MANAGER`) seront ajoutés en phase 6 quand les entrepôts et agences existeront. Le script refuse de s'exécuter si `NODE_ENV=production`. Aucun mot de passe n'est enregistré dans le dépôt.

## Tests

```bash
npm test      # construit, puis exécute les tests du package partagé (21) et de l'API (135)
```

Les tests de l'API utilisent de **vrais** PostgreSQL et Redis (les conteneurs ci-dessus), dans la base `b2c_test` et la base Redis n° 1, jamais dans la base de développement. Avant chaque exécution la base de test est mise à jour par les migrations, ses données sont effacées (le script refuse toute base dont le nom ne finit pas par `_test`) et le catalogue des rôles est resynchronisé. Détail : [docs/TEST_PLAN.md](docs/TEST_PLAN.md).

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
| `SEED_SUPERADMIN_EMAIL/PASSWORD`, `DEMO_PASSWORD` | Amorçage (voir ci-dessus) |

Aucun secret n'est dans le dépôt : `.env` est ignoré par Git et `.env.example` ne contient que des marqueurs.

## Structure

```
apps/api/           API NestJS (modules : security, auth, iam, audit, platform, infra, health…)
packages/shared/    catalogue des permissions et rôles, PermissionSet, schémas zod partagés
prisma/             schema.prisma, migrations/ (0001, 0002), seed.ts, seed-demo.ts
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
| [docs/API.md](docs/API.md), [docs/openapi.json](docs/openapi.json) | Routes, conventions, erreurs |
| [docs/SECURITY.md](docs/SECURITY.md) | Mesures en place, limites connues, vulnérabilités de dépendances |
| [docs/TEST_PLAN.md](docs/TEST_PLAN.md) | Ce qui est testé, résultats, parcours du cahier couverts |
| [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) | État des intégrations externes |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phases et backlog |

À venir : `DEPLOYMENT.md` (phase 10).
