# API

Phase 3. Spécification machine : [openapi.json](openapi.json) (régénérée par `npm run docs:openapi`) ; interface interactive : `/docs` quand `ENABLE_DOCS=true`. Les routes métier (colis, tarifs, paiements…) seront ajoutées avec leurs phases.

## Conventions

- Toutes les routes sont sous `/v1`, sauf `/health/*`.
- JSON uniquement. Corps limité à 100 Ko. Les champs inconnus sont **refusés** (400), pour empêcher l'injection de champs comme `roles` ou `kind`.
- Authentification : `Authorization: Bearer <jeton d'accès>` (15 min). Le jeton de renouvellement est dans un cookie `b2c_refresh` (HttpOnly, SameSite=Lax, chemin `/v1/auth`) ; les clients mobiles (`X-Client-Type: mobile`) le reçoivent dans le corps.
- L'entreprise de la requête est **toujours déduite du jeton** ; aucun paramètre ni en-tête ne la choisit. Seules les routes publiques d'authentification prennent un `companySlug` (corps).
- Pagination par curseur : `?limit=` (1-100, 25 par défaut) et `?cursor=`. Réponse `{ items, nextCursor }` ; `nextCursor` vaut `null` à la fin.
- Chaque réponse porte `X-Request-Id` (repris du client s'il est valide), aussi présent dans les erreurs et les journaux.
- Limitation de débit : `X-RateLimit-Limit/Remaining` ; au-delà, 429 avec `Retry-After`.

### Format d'erreur

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Données invalides", "details": [{ "in": "body", "path": "email", "message": "…" }], "requestId": "…" } }
```

Codes ajoutés en phase 4 : `INVALID_CURRENT_PASSWORD`, `PASSWORD_UNCHANGED`, `NOT_A_BUSINESS_ACCOUNT`, `ADDRESS_LIMIT`, `BENEFICIARY_LIMIT` (422), `ADDRESS_NOT_FOUND`, `BENEFICIARY_NOT_FOUND`, `WAREHOUSE_NOT_FOUND`, `CUSTOMER_NOT_FOUND`, `WAREHOUSE_REFERENCE_USED`.

Les messages de `details` d'une `VALIDATION_ERROR` pour les règles propres à l'application sont des **codes stables** (`password_common`, `phone_format`, `terms_required`, `country_format`, `date_order`…) que l'interface traduit ; les autres sont les messages bruts de zod.

Codes principaux : `VALIDATION_ERROR` (400), `UNAUTHENTICATED`, `INVALID_TOKEN`, `SESSION_ENDED`, `INVALID_CREDENTIALS` (401), `FORBIDDEN`, `EMAIL_NOT_VERIFIED`, `ACCOUNT_DISABLED`, `COMPANY_SUSPENDED`, `PRIVILEGE_ESCALATION`, `CSRF_HEADER_REQUIRED` (403), `NOT_FOUND`, `USER_NOT_FOUND`, `COMPANY_NOT_FOUND` (404), `CONFLICT`, `EMAIL_ALREADY_USED`, `ROLE_ALREADY_ASSIGNED`, `LAST_ADMINISTRATOR`, `COMPANY_ALREADY_EXISTS` (409), `IDEMPOTENCY_KEY_REUSED` (422), `RATE_LIMITED`, `ACCOUNT_LOCKED` (429), `SECURITY_BACKEND_UNAVAILABLE`, `RATE_LIMITER_UNAVAILABLE` (503), `INTERNAL_ERROR` (500, sans détail).

Une route qui ne déclare ni accès public, ni accès « tout utilisateur connecté », ni permissions, est refusée par défaut (`ROUTE_NOT_CONFIGURED`) ; un test vérifie que cela n'arrive pour aucune route.

## Routes

| Méthode et chemin | Accès | Rôle |
|---|---|---|
| `POST /v1/auth/register` | public, 10/h/IP | Inscription client (individuel/professionnel). **Toujours 202**, que l'adresse existe ou non |
| `POST /v1/auth/verify-email` | public | Confirme l'e-mail (jeton à usage unique, 24 h) |
| `POST /v1/auth/resend-verification` | public | Renvoie le lien (3/h/adresse), réponse identique si inconnu |
| `POST /v1/auth/login` | public, 30/10 min/IP + verrou 5 échecs/15 min/compte | Connexion. Sans `companySlug` : équipe de la plateforme |
| `POST /v1/auth/refresh` | public (cookie + `X-CSRF-Protection: 1`, ou corps `refreshToken`) | Rotation des jetons ; réutilisation = révocation de la famille |
| `POST /v1/auth/logout` | connecté | Déconnexion (`allSessions: true` pour tous les appareils) |
| `POST /v1/auth/forgot-password` | public | Lien de réinitialisation (1 h), 3/h/adresse, réponse identique |
| `POST /v1/auth/reset-password` | public | Nouveau mot de passe ; active aussi un compte invité (72 h) ; révoque les sessions |
| `GET /v1/auth/me` | connecté | Profil, rôles avec portées, permissions |
| `GET /v1/admin/users` | `user:read` | Liste (filtres `q`, `kind`, `status`) |
| `GET /v1/admin/users/{id}` | `user:read` | Détail |
| `POST /v1/admin/users` | `user:create` | Invite un membre du personnel avec ses rôles |
| `POST /v1/admin/users/{id}/roles` | `role:assign` | Attribue un rôle et sa portée |
| `DELETE /v1/admin/users/{id}/roles/{userRoleId}` | `role:assign` | Retire une attribution |
| `POST /v1/admin/users/{id}/disable` · `/enable` | `user:disable` | Désactive (révoque les sessions) / réactive |
| `GET /v1/admin/roles` | `role:read` | Rôles et permissions |
| `GET /v1/audit` | `audit:read` | Journal d'audit de l'entreprise (filtres `action`, `entityType`, `entityId`, `actorUserId`) |
| `POST /v1/platform/companies` | `company:manage` | Crée une entreprise et invite son administrateur |
| `GET /v1/platform/companies` | `company:manage` | Liste des entreprises (aucune donnée métier) |
| `POST /v1/platform/companies/{id}/suspend` · `/activate` | `company:manage` | Suspension immédiate / réactivation |
| `POST /v1/auth/change-password` | connecté, 20/h/IP + 5 échecs/15 min/utilisateur | Change le mot de passe (actuel exigé) ; les AUTRES sessions sont révoquées |
| `GET /v1/me/profile` · `PATCH /v1/me/profile` | `profile:read_own` · `profile:update_own` | Profil, **code client**, préférences de notification ; nom, téléphone (revérifié s'il change), langue, raison sociale (compte professionnel) |
| `GET/POST /v1/me/addresses` · `PATCH/DELETE /v1/me/addresses/{id}` | `profile:*_own` | Adresses personnelles et de livraison (20 max ; une adresse par défaut par type) |
| `GET/POST /v1/me/beneficiaries` · `PATCH/DELETE /v1/me/beneficiaries/{id}` | `profile:*_own` | Bénéficiaires autorisés (10 actifs max ; 4 derniers caractères de la pièce seulement ; DELETE = révocation, l'historique est conservé) |
| `GET /v1/me/receiving-addresses` | `profile:read_own` | Adresses de réception générées par entrepôt actif et par mode (AIR/SEA) à partir du code client |
| `GET /v1/admin/customers` · `GET /v1/admin/customers/{id}` | `customer:read` | Recherche (code, nom, raison sociale, e-mail), pagination par curseur |
| `GET/POST /v1/admin/warehouses` · `PATCH /v1/admin/warehouses/{id}` | `warehouse:read` · `warehouse:manage` | Entrepôts. **Portées respectées** : un droit limité à un entrepôt ne permet ni d'en créer, ni de modifier un autre |
| `GET/PUT /v1/admin/settings/public-contact` | `settings:read` · `settings:update` | Coordonnées publiques (page Contact) |
| `GET /v1/public/companies/{slug}` · `GET /v1/public/companies/{slug}/warehouses` | public, 120/min/IP, `Cache-Control: public, max-age=60` | Nom, langue, devise, coordonnées ; entrepôts actifs et visibles. Le modèle d'adresse des clients n'est jamais exposé ; entreprise inconnue, suspendue ou « platform » : 404 |
| `GET /health/live`, `GET /health/ready` | public, sans limite | Sondes (la seconde teste PostgreSQL et Redis, 503 sinon) |

## Règles à connaître

- **Droits évalués à chaque requête** depuis la base : une désactivation, une révocation de session, un changement de rôle ou la suspension de l'entreprise s'appliquent immédiatement, sans attendre l'expiration du jeton d'accès.
- **Anti-escalade** : on ne peut attribuer qu'un rôle dont toutes les permissions sont détenues par soi-même sur toute l'entreprise.
- **Dernier administrateur** : on ne peut ni retirer le rôle, ni désactiver le dernier `COMPANY_ADMIN` actif d'une entreprise (ni le dernier `SUPER_ADMIN`).
- **Rôles clients** : ils ne s'attribuent que par l'inscription. Les rôles du personnel ne conviennent qu'aux comptes du personnel.
- **Liens des e-mails** : `<WEB_PUBLIC_URL>/<langue>/<page>?token=…` (langue du destinataire).
- **Cookies** : `b2c_refresh` (HttpOnly, chemin `/v1/auth`, jeton de renouvellement) et `b2c_session=1` (lisible, chemin `/`, sans secret, simple indice qu'une session peut être restaurée). Les deux sont supprimés à la déconnexion.
- **Portées** : `RECEPTION_AGENT` et `WAREHOUSE_MANAGER` exigent une portée `WAREHOUSE`, `AGENCY_MANAGER` une portée `AGENCY`. L'existence de l'entrepôt ou de l'agence n'est **pas encore vérifiée** (ces objets arrivent en phase 6).
