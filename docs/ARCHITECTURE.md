# Architecture cible

Phase 2. **Conception**, pas encore implémentée : la section « Architecture effectivement implémentée » sera ajoutée en fin de projet.

## 1. Vue d'ensemble

```
Navigateur / mobile futur
        │ HTTPS
        ▼
  apps/web (React, Vite)  ──────►  apps/api (NestJS)  ──►  PostgreSQL (données, RLS)
  site public + portails           REST /v1 + OpenAPI  ──►  Redis (limites de débit, files BullMQ)
                                          │            ──►  Stockage S3 (SeaweedFS en local, optionnel)
                                          ▼
                              apps/worker (même code, processus séparé)
                              notifications, e-mails, exports, rapprochements
                                          │
                                          ▼
                      Intégrations (paiement, SMS, e-mail, WhatsApp, transporteurs)
```

## 2. Structure du dépôt (créée en phase 3)

```
b2c/
  apps/api/        NestJS : modules métier, Prisma, tests
  apps/web/        React + TypeScript : site public, portail client, back-office
  packages/shared/ types, schémas de validation (zod), énumérations de statuts, permissions
  prisma/          schema.prisma, migrations versionnées, seed.ts (minimal), seed-demo.ts (DEMO)
  docker/          Dockerfiles, compose.dev.yml (postgres, redis, mailpit ; seaweedfs en option)
  docs/
  .env.example
```

Outils : npm workspaces, TypeScript strict, ESLint, Prettier, Vitest (shared, web) et Jest ou Vitest (api), Supertest, Playwright.

## 3. Choix techniques et justification

| Sujet | Choix | Pourquoi / alternative écartée |
|---|---|---|
| API | NestJS (modules, injection, guards) | Découpage métier clair et guards d'autorisation réutilisables ; accepte OpenAPI |
| Base | PostgreSQL 16+ | Transactions, contraintes, **Row-Level Security**, index partiels, JSONB. Votre machine a le client 18 |
| ORM | Prisma | Migrations versionnées, types générés. Limite : RLS et verrous demandent du SQL brut, encadré dans une couche dédiée |
| Validation | zod dans `packages/shared`, partagé API/web | Une seule définition des formats |
| Files | BullMQ sur Redis | Nouvelles tentatives, délais, tâches différées |
| Fichiers | Disque local (défaut) ou API S3 (SeaweedFS en dev) via `STORAGE_DRIVER` | **Réalisé tel quel en phase 9 : les fichiers transitent par l'API** (liens signés HMAC de l'API, pas d'URL pré-signée du stockage) ; clés préfixées par l'entreprise |
| Auth | Cookie `HttpOnly` pour le web, jeton porteur pour mobile | Voir §5 |
| Front | React + Vite + React Router + TanStack Query, i18next | SPA pour les portails. Le site public a besoin de SEO : voir décision D1 |
| Docs API | `@nestjs/swagger` → `docs/API.md` généré + `/docs` | Une source |

**Décision ouverte D1 (site public et SEO)** : une SPA pure se référence mal. Options : (a) pré-rendu des pages publiques au build (Vite SSG), (b) Next.js pour le public. Je recommande (a) : toutes les pages publiques sont statiques, sauf suivi et calculateur qui appellent l'API. À confirmer en phase 4.

## 4. Découpage de l'API en modules

Chaque module contient : contrôleur (HTTP uniquement), service (règles métier), dépôt (accès Prisma), DTO/schémas.
Un contrôleur n'appelle jamais Prisma ; un service n'appelle jamais `req`.

| Module | Contenu |
|---|---|
| `tenancy` | Entreprises, contexte d'entreprise de la requête, RLS |
| `auth` | Inscription, sessions, vérifications, réinitialisation, TOTP du personnel |
| `iam` | Utilisateurs, rôles, permissions, portées, guards |
| `customers` | Clients, adresses, bénéficiaires, codes clients, adresses de réception |
| `warehouses` | Entrepôts, emplacements, mouvements, scan |
| `prealerts` | Préalertes, rapprochement |
| `packages` | Colis, machine d'états, historique, pièces jointes, regroupements |
| `pricing` | Grilles, règles, calcul de poids, devis |
| `shipments` | Lots, manifestes, transporteurs |
| `tracking` | Lecture publique et privée des événements |
| `agencies` | Agences, zones, tournées |
| `deliveries` | Tentatives, OTP, preuves de remise |
| `billing` | Devis, factures, avoirs, numérotation |
| `payments` | Paiements, remboursements, rapprochement, interface prestataire, webhooks |
| `notifications` | Événements, modèles, canaux, file d'envoi |
| `claims` | Réclamations |
| `reports` | Indicateurs, exports |
| `audit` | Journal d'audit |
| `files` | URLs signées, vérification des fichiers |
| `integrations` | Interfaces et adaptateurs (état actif / simulé / non configuré) |

Dépendances : `packages` dépend de `pricing`, `warehouses`, `audit`. `billing` et `deliveries` réagissent aux événements de `packages` ; `packages` ne dépend pas d'eux.

## 5. Multi-entreprises

1. Chaque table métier porte `company_id NOT NULL`.
2. Une requête authentifiée détermine l'entreprise **à partir du jeton / de la session**, jamais d'un paramètre fourni par le client.
3. Prisma est enveloppé : chaque requête ouvre une transaction qui exécute `SET LOCAL app.company_id = '<uuid>'` ; les politiques RLS (`USING company_id = current_setting('app.company_id')::uuid`) filtrent lecture **et** écriture. C'est une seconde barrière en cas d'oubli de filtre applicatif.
4. L'application se connecte avec un rôle PostgreSQL **sans** `BYPASSRLS` et sans propriété des tables. Les migrations s'exécutent avec un autre rôle.
5. Les tâches de fond reçoivent `company_id` dans leur charge utile et posent le même contexte avant tout accès.
6. Les clés d'objets S3 sont `companies/<company_id>/...` ; l'URL signée est générée après contrôle d'accès à la ressource.
7. Les exports se génèrent dans le contexte d'une entreprise et sont stockés sous son préfixe.
8. Les utilisateurs de la plateforme (super administrateur) opèrent hors contexte d'entreprise ; l'entrée dans une entreprise est un acte explicite et journalisé.
9. Unicité : codes clients, numéros de facture, références d'entrepôt uniques **par entreprise**. Les numéros de suivi sont uniques **globalement** (suivi public sans connaître l'entreprise).

Test obligatoire (phase 3) : deux entreprises, mêmes données, vérification qu'aucune route, recherche, export ni tâche ne franchit la frontière.

## 6. Authentification et sessions

- Mot de passe : argon2id. Limitation de tentatives par compte et par IP.
- Web : jeton d'accès court (15 min) + jeton de renouvellement à rotation en cookie `HttpOnly; Secure; SameSite=Lax`, protection CSRF par en-tête personnalisé. Réutilisation d'un jeton de renouvellement déjà tourné → toute la famille de sessions est révoquée.
- Mobile ultérieur : mêmes jetons, transmis par en-tête `Authorization`.
- Personnel : TOTP recommandé, exigible par rôle (administrateurs, facturation).
- Vérification e-mail, réinitialisation : jetons aléatoires de 32 octets, stockés **hachés**, usage unique, expiration.

## 7. Autorisation

- Permissions sous forme `ressource:action` (ex. `package:receive`, `payment:record_cash`), définies une seule fois dans `packages/shared`.
- `role_permissions` en base ; mappings par défaut fournis par la migration, modifiables par l'administrateur d'entreprise.
- Guard NestJS : `@RequirePermission('package:receive')` puis **contrôle de portée** (l'entrepôt/agence/tournée de la ressource appartient-il aux portées de l'utilisateur ?) puis **contrôle de propriété** pour les clients (`customer_id` du jeton).
- L'interface reçoit la liste de permissions pour masquer les actions ; elle n'a aucune autorité.

## 8. Machine d'états des colis

- Table de transitions (statut source, statut cible, permission requise, garde) définie en code dans `packages/shared`, vérifiée par l'API, couverte par un test qui énumère **toutes** les paires.
- Une seule fonction `transitionPackage(packageId, to, actor, reason, context)` modifie le statut. Elle : verrouille la ligne (`SELECT … FOR UPDATE`), vérifie la transition et les gardes, insère l'événement et la ligne d'audit, enregistre un message dans l'outbox, le tout en une transaction.
- Aucun autre code n'écrit `packages.status`. Un déclencheur de base de données refuse un changement de statut sans ligne d'événement correspondante dans la même transaction (défense en profondeur).

## 9. Événements et notifications (outbox)

1. La transaction métier écrit une ligne `outbox_events`.
2. Le traitement de fond lit l'outbox (verrou `SKIP LOCKED`) et crée une `notification` par canal (**réalisé sans BullMQ**, voir § écarts).
3. Le service de notification résout le modèle (événement, canal, langue du client), enregistre une `notification` et appelle le fournisseur du canal.
4. Échec → nouvelle tentative après 1, 5, 30 puis 120 minutes (5 tentatives au total), puis statut `FAILED` visible dans le journal et relançable par le personnel (**pas d'alerte automatique**). Un envoi n'est jamais déduit deux fois côté base (clé de déduplication), mais **un e-mail peut être renvoyé en double si le serveur s'arrête entre l'envoi SMTP et son enregistrement** (livraison « au moins une fois »).

Une notification n'est jamais perdue si le processus s'arrête après le commit, puisque l'outbox est dans la base.

## 10. Paiements

- Interface `PaymentProvider { createCharge, verifyWebhook, getStatus, refund }`.
- Un `payment` commence `PENDING`, passe `CONFIRMED` uniquement après vérification auprès du prestataire (signature de webhook + contrôle du montant, de la devise et de la référence), puis la facture est mise à jour dans la même transaction.
- Clé d'idempotence obligatoire sur création de paiement et sur chaque webhook (identifiant d'événement du prestataire stocké de manière unique).
- Espèces : `payment:record_cash`, reçu numéroté, agence/caisse, audit.
- Adaptateurs livrés en premier : `cash`, `bank_transfer` (enregistrement manuel avec justificatif et validation). Les passerelles en ligne ne sont écrites qu'avec un compte de test réel du prestataire, sinon elles restent « non configurées ».

## 11. Fichiers

- Téléversement : l'API délivre une URL signée à durée courte après contrôle de permission, taille et type annoncés.
- Après envoi : tâche de vérification (signature de contenu réelle, type autorisé, taille, nom nettoyé, analyse antivirus si ClamAV est configuré). Un fichier non vérifié n'est pas accessible.
- Lecture : URL signée courte, générée après contrôle d'accès.

## 12. Observabilité et exploitation

- Journaux JSON (pino) avec `request_id`, `company_id`, `user_id` ; masquage des champs sensibles.
- `/health/live` et `/health/ready` (base, Redis, S3).
- Métriques Prometheus : latence, erreurs, profondeur et échecs des files.
- Sauvegardes `pg_dump` quotidiennes chiffrées + test de restauration planifié (DEPLOYMENT.md).
- Migrations : Prisma Migrate, fichiers versionnés, exécutées par une étape de déploiement distincte ; jamais `db push` en production. Réalisé en phase 10 : tâche `migrate` de `docker/compose.prod.yml` (rôle de migration), exécutée avant le démarrage de l'API à chaque déploiement ([DEPLOYMENT.md](DEPLOYMENT.md)).

## 13. Sécurité applicative (résumé, détail dans SECURITY.md)
Helmet, CORS en liste blanche, limitation de débit (Redis), validation stricte, requêtes paramétrées, en-têtes CSP, pas d'identifiants séquentiels exposés (UUID v7 / numéros opaques), protection SSRF sur toute requête sortante pilotée par une donnée utilisateur, pas de secret en dépôt.

## 15. Implémenté en phase 3 et écarts avec la conception

Réalisé et testé (voir [TEST_PLAN.md](TEST_PLAN.md)) : monorepo npm workspaces (`apps/api`, `packages/shared`), Docker Compose (PostgreSQL 17, Redis 7, Mailpit), Prisma 6.19 avec deux rôles PostgreSQL, RLS, modules `security`, `auth`, `iam`, `audit`, `platform`, `infra` (compteurs, idempotence), `health`, OpenAPI.

| Sujet | Conception | Réalité |
|---|---|---|
| Versions | NestJS « récent » | **NestJS 11, Prisma 6.19, TypeScript 5.9, Jest 30**. Les versions « latest » de npm au moment du développement (NestJS 12, Prisma 8 en préversion, TypeScript 7) n'ont pas été retenues faute de recul ; à réexaminer |
| Contexte d'entreprise | « tâches de fond reçoivent `company_id` » | Pas encore de tâches de fond. Toute lecture/écriture passe par `DbService.run({ companyId })` (transaction + `SET LOCAL`) |
| Mode plateforme | non prévu | `DbService.run({ platform: true })`, réservé à `CompanyDirectory` (résoudre une entreprise par son identifiant public avant connexion) et `PlatformService` ; un test interdit tout autre usage. Dans ce mode `withCompany()` permet d'écrire dans la nouvelle entreprise dans la même transaction |
| Droits | « claims dans le jeton » | Le jeton ne contient que utilisateur, entreprise et session ; les droits sont relus en base à chaque requête (3 requêtes) pour une révocation immédiate. À mettre en cache court si la charge l'exige |
| Validation | `class-validator` / zod | zod partagé (`packages/shared`), appliqué par un intercepteur global (`@Validate`) qui alimente aussi OpenAPI |
| Express 5 | non prévu | `req.query` est en lecture seule : les données validées sont exposées par `@VBody() / @VQuery() / @VParams()` |
| Files de tâches | BullMQ dès la phase 3 | **File dans PostgreSQL, pas BullMQ** (phase 7) : table `outbox_events` écrite dans la transaction de l'action, puis table `notifications` traitée par un traitement de fond (intervalle `NOTIFICATION_WORKER_INTERVAL_MS`, verrous `SKIP LOCKED`, plusieurs instances sans doublon). Une dépendance et un point de panne de moins ; Redis reste réservé aux limites de débit. Les e-mails d'authentification (inscription, mot de passe) sont toujours envoyés directement après la transaction, sans nouvelle tentative |
| Stockage S3 | SeaweedFS dans le compose (profil `storage`) | MinIO abandonné (image introuvable) ; adaptateur testé contre SeaweedFS seulement (phase 9) |
| Authentification | TOTP du personnel | Colonne prévue, **fonction non implémentée** |
| Tests | Vitest | Jest + ts-jest (chemin standard avec les décorateurs NestJS) |
| Réinitialisation de la base de test | `prisma migrate reset` | Interdite à un agent par Prisma sans accord humain explicite ; remplacée par `migrate deploy` + nettoyage des données d'une base `*_test` |

### Phase 4 : site web et espace client

Réalisé : module API `customers` (profil et code client, adresses, bénéficiaires, adresses de réception, entrepôts, coordonnées et entrepôts publics, consultation des clients par le personnel), `POST /v1/auth/change-password`, application `apps/web` (voir [WEB.md](WEB.md)).

| Sujet | Conception | Réalité |
|---|---|---|
| Décision D1 (SEO) | Pré-rendu statique des pages publiques | **Retenue et réalisée** : rendu serveur React à la construction (63 fichiers HTML), hydratation, espace client en application monopage chargée à la demande |
| Un site par entreprise | non précisé | Une construction du site = une entreprise (`VITE_COMPANY_SLUG`) ; plusieurs entreprises = plusieurs constructions, ou plus tard un site qui lit l'entreprise dans le nom de domaine |
| Code client | « séquence sous verrou » | `CounterService` (compteur `customer-code`) appelé dans la transaction d'inscription ; un client créé hors inscription (seed, import) reçoit son code à sa première visite de l'espace |
| Portées en pratique | contrôle par la garde | Première utilisation : `warehouse:manage` limité à un entrepôt permet de le modifier mais pas d'en créer ; `warehouse:read` limité filtre la liste. Les routes doivent appeler `permissions.can(permission, portée)` : la garde seule ne vérifie que la détention dans une portée quelconque |
| Messages de validation | texte | Codes stables dans `packages/shared`, traduits par l'interface |
| `@b2c/shared` | CommonJS | Double publication : CommonJS (API, Jest) et ESM (navigateur, Vite) via `exports` |

## 14. Décisions ouvertes

| ID | Question | Recommandation | Échéance |
|---|---|---|---|
| D1 | SEO du site public | Pré-rendu statique des pages publiques | Phase 4 |
| D2 | UUID v4 ou v7 | v7 (ordre temporel, bon pour les index) | Phase 3 |
| D3 | Antivirus de fichiers | ClamAV optionnel, désactivé par défaut avec avertissement | Phase 9 |
| D4 | Hébergement | Non défini ; l'application reste portable (Docker) | Phase 10 |
| D5 | Achat assisté (« Online purchase ») | Hors périmètre sauf demande | Phase 5 |
