# API

Phases 3 à 8. Spécification machine : [openapi.json](openapi.json) (régénérée par `npm run docs:openapi`) ; interface interactive : `/docs` quand `ENABLE_DOCS=true`. Les routes de la phase 8 (livraison, réclamations, tableau de bord) sont ci-dessous.

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

Codes ajoutés en phase 5 : `TARIFF_UNAVAILABLE`, `CATEGORY_RESTRICTED`, `INVALID_STATE`… (422/409) — tarifs : `CATEGORY_UNKNOWN`, `RULES_OVERLAP`, `INVALID_SURCHARGE`, `MISSING_DECLARED_VALUE`, `UNKNOWN_SURCHARGE`, `RATE_CARD_NOT_FOUND`, `RATE_CARD_IMMUTABLE`, `RATE_CARD_NOT_DRAFT`, `RATE_CARD_NOT_ACTIVE`, `RATE_CARD_PERIOD_OVERLAP`, `CATEGORY_CODE_USED` ; colis : `INVALID_TRANSITION`, `TRANSITION_NOT_AVAILABLE`, `REASON_REQUIRED`, `AMBIGUOUS_MATCH` (avec la liste des candidats), `NOT_EXPECTED`, `ALREADY_IDENTIFIED`, `CUSTOMER_REQUIRED`, `TRANSPORT_MODE_REQUIRED`, `INSURANCE_UNAVAILABLE`, `GROUP_CUSTOMER_MISMATCH`, `ALREADY_GROUPED`, `DUPLICATE_PACKAGES`, `PACKAGE_NOT_FOUND`, `GROUP_NOT_FOUND`, `DUPLICATE_PREALERT`, `PREALERT_LOCKED`, `PREALERT_NOT_FOUND`, `CUSTOMER_ONLY`, `TRACKING_NOT_FOUND` ; fichiers : `UNSUPPORTED_FILE` (415), `FILE_CONTENT_MISMATCH`, `FILE_REJECTED`, `FILE_KIND_NOT_ALLOWED`, `FILE_LIMIT` (422), `PAYLOAD_TOO_LARGE` (413), `LINK_INVALID`, `LINK_EXPIRED` (403), `FILE_NOT_FOUND`, `FILE_OWNER_NOT_FOUND`.

Codes ajoutés en phase 6 : entrepôt — `LOCATION_NOT_FOUND`, `LOCATION_CODE_USED`, `LOCATION_NOT_EMPTY`, `LOCATION_INACTIVE`, `NOT_IN_WAREHOUSE`, `PACKAGE_CANCELLED`, `CODE_REQUIRED` ; agences — `AGENCY_NOT_FOUND`, `AGENCY_CODE_USED`, `AGENCY_COUNTRY_MISMATCH`, `WRONG_AGENCY`, `NOT_ARRIVED` ; lots — `SHIPMENT_NOT_FOUND`, `SHIPMENT_NOT_OPEN`, `SHIPMENT_EMPTY`, `INVALID_SHIPMENT_TRANSITION`, `PACKAGE_NOT_READY`, `PACKAGE_INCOMPLETE`, `MODE_MISMATCH`, `WAREHOUSE_MISMATCH`, `DESTINATION_MISMATCH`, `ALREADY_IN_SHIPMENT`, `PACKAGE_NOT_IN_SHIPMENT`, `PACKAGES_NOT_READY`, `PACKAGES_PENDING_RECEIPT` ; rôles — `SCOPE_NOT_FOUND`.

Les messages de `details` d'une `VALIDATION_ERROR` pour les règles propres à l'application sont des **codes stables** (`password_common`, `phone_format`, `terms_required`, `country_format`, `date_order`…) que l'interface traduit ; les autres sont les messages bruts de zod.

Codes principaux : `VALIDATION_ERROR` (400), `UNAUTHENTICATED`, `INVALID_TOKEN`, `SESSION_ENDED`, `INVALID_CREDENTIALS`, `TOTP_REQUIRED`, `INVALID_TOTP` (401), `FORBIDDEN`, `EMAIL_NOT_VERIFIED`, `ACCOUNT_DISABLED`, `COMPANY_SUSPENDED`, `PRIVILEGE_ESCALATION`, `CSRF_HEADER_REQUIRED`, `TOTP_ENROLLMENT_REQUIRED` (403 : le compte doit d'abord activer la double authentification ; seules `/v1/auth/me`, `/v1/auth/logout` et `/v1/me/2fa/*` restent ouvertes), `NOT_FOUND`, `USER_NOT_FOUND`, `COMPANY_NOT_FOUND` (404), `CONFLICT`, `EMAIL_ALREADY_USED`, `ROLE_ALREADY_ASSIGNED`, `LAST_ADMINISTRATOR`, `COMPANY_ALREADY_EXISTS`, `TOTP_ALREADY_ENABLED`, `TOTP_SETUP_REQUIRED`, `TOTP_NOT_ENABLED`, `TOTP_REQUIRED_BY_POLICY` (409), `IDEMPOTENCY_KEY_REUSED` (422), `RATE_LIMITED`, `ACCOUNT_LOCKED`, `TOO_MANY_ATTEMPTS` (429), `SECURITY_BACKEND_UNAVAILABLE`, `RATE_LIMITER_UNAVAILABLE` (503), `INTERNAL_ERROR` (500, sans détail).

Une route qui ne déclare ni accès public, ni accès « tout utilisateur connecté », ni permissions, est refusée par défaut (`ROUTE_NOT_CONFIGURED`) ; un test vérifie que cela n'arrive pour aucune route.

## Routes

| Méthode et chemin | Accès | Rôle |
|---|---|---|
| `POST /v1/auth/register` | public, 10/h/IP | Inscription client (individuel/professionnel). **Toujours 202**, que l'adresse existe ou non |
| `POST /v1/auth/verify-email` | public | Confirme l'e-mail (jeton à usage unique, 24 h) |
| `POST /v1/auth/resend-verification` | public | Renvoie le lien (3/h/adresse), réponse identique si inconnu |
| `POST /v1/auth/login` | public, 30/10 min/IP + verrou 5 échecs/15 min/compte | Connexion. Sans `companySlug` : équipe de la plateforme. Si la double authentification est active, le mot de passe seul répond **401 `TOTP_REQUIRED`** ; renvoyer la requête avec `totpCode` (6 chiffres) **ou** `recoveryCode` (`xxxx-xxxx`, jamais les deux). Un code faux, rejoué ou périmé : **401 `INVALID_TOTP`** (compté comme un échec de connexion) |
| _(en-tête)_ `X-Client-App: admin` | — | Envoyé par le panel d'administration : les cookies de session se nomment alors `b2c_admin_refresh` / `b2c_admin_session` (au lieu de `b2c_refresh` / `b2c_session`). Ne donne aucun droit |
| `POST /v1/auth/refresh` | public (cookie + `X-CSRF-Protection: 1`, ou corps `refreshToken`) | Rotation des jetons ; réutilisation = révocation de la famille |
| `POST /v1/auth/logout` | connecté | Déconnexion (`allSessions: true` pour tous les appareils) |
| `POST /v1/auth/forgot-password` | public | Lien de réinitialisation (1 h), 3/h/adresse, réponse identique |
| `POST /v1/auth/reset-password` | public | Nouveau mot de passe ; active aussi un compte invité (72 h) ; révoque les sessions |
| `GET /v1/auth/me` | connecté | Profil, rôles avec portées, permissions, et `mfa` : `{ enabled, required, enrollmentRequired }` |
| `GET /v1/me/2fa` | connecté | État de la double authentification et nombre de codes de secours restants |
| `POST /v1/me/2fa/setup` | connecté, 20/h/IP ; corps `{ password }` | Démarre l'activation : renvoie la clé (`secret`) et l'adresse `otpauth://` **une seule fois** ; sans effet tant qu'un code valide n'a pas été saisi |
| `POST /v1/me/2fa/enable` | connecté ; corps `{ code }` | Active après un code valide ; renvoie les **10 codes de secours, une seule fois** |
| `POST /v1/me/2fa/disable` | connecté ; corps `{ password, totpCode ou recoveryCode }` | Désactive (refusé : `TOTP_REQUIRED_BY_POLICY` si le compte y est tenu) |
| `POST /v1/me/2fa/recovery-codes` | connecté ; même corps | Remplace les codes de secours par 10 nouveaux, montrés une seule fois |
| `GET /v1/admin/users` | `user:read` | Liste (filtres `q`, `kind`, `status`) |
| `GET /v1/admin/users/{id}` | `user:read` | Détail |
| `POST /v1/admin/users` | `user:create` | Invite un membre du personnel avec ses rôles |
| `POST /v1/admin/users/{id}/roles` | `role:assign` | Attribue un rôle et sa portée |
| `DELETE /v1/admin/users/{id}/roles/{userRoleId}` | `role:assign` | Retire une attribution |
| `POST /v1/admin/users/{id}/disable` · `/enable` | `user:disable` | Désactive (révoque les sessions) / réactive |
| `POST /v1/admin/users/{id}/two-factor/reset` | `user:update` | Réinitialise la double authentification d'un compte du **personnel** : secret et codes de secours supprimés, sessions fermées, e-mail d'alerte, audit `user.two_factor_reset`. Refus : soi-même (`CANNOT_RESET_SELF`), client (`NOT_STAFF_ACCOUNT`), rien à réinitialiser (`TWO_FACTOR_NOT_ACTIVE`), compte détenant des droits que l'acteur n'a pas (`TARGET_HAS_MORE_PERMISSIONS`) |
| `GET /v1/admin/roles` | `role:read` | Rôles système **et personnalisés** : code, nom, portées possibles, droits, nombre de titulaires |
| `POST /v1/admin/roles` | `role:manage` | Crée un rôle personnalisé (`name`, `description?`, `scopeType` COMPANY / WAREHOUSE / AGENCY, `permissions`). Anti-escalade ; codes d'erreur `ROLE_NAME_TAKEN`, `TOO_MANY_ROLES`, `PRIVILEGE_ESCALATION` |
| `PATCH /v1/admin/roles/{code}` | `role:manage` | Modifie nom, description, droits d'un rôle personnalisé (effet immédiat) |
| `DELETE /v1/admin/roles/{code}` | `role:manage` | Supprime un rôle personnalisé non attribué (`ROLE_IN_USE` sinon) |
| `GET /v1/audit` | `audit:read` | Journal d'audit de l'entreprise (filtres `action`, `entityType`, `entityId`, `actorUserId`) |
| `POST /v1/platform/companies` | `company:manage` | Crée une entreprise et invite son administrateur |
| `GET /v1/platform/companies` | `company:manage` | Liste des entreprises (aucune donnée métier) |
| `POST /v1/platform/companies/{id}/suspend` · `/activate` | `company:manage` | Suspension immédiate / réactivation |
| `POST /v1/auth/change-password` | connecté, 20/h/IP + 5 échecs/15 min/utilisateur | Change le mot de passe (actuel exigé) ; les AUTRES sessions sont révoquées |
| `GET /v1/me/profile` · `PATCH /v1/me/profile` | `profile:read_own` · `profile:update_own` | Profil, **code client**, préférences de notification ; nom, téléphone (revérifié s'il change), langue, raison sociale (compte professionnel) |
| `GET/POST /v1/me/addresses` · `PATCH/DELETE /v1/me/addresses/{id}` | `profile:*_own` | Adresses personnelles et de livraison (20 max ; une adresse par défaut par type) |
| `GET /v1/me/team/activity` | `team:manage_own` | Historique des 50 dernières actions de gestion de l'équipe (invitation, changement de rôle, retrait) |
| `GET /v1/me/team` · `POST /v1/me/team` · `PATCH/DELETE /v1/me/team/{userId}` | `team:manage_own` (propriétaire d'un compte **professionnel** seulement) | Équipe : liste (`limit` 10), invitation (`email`, `firstName`, `lastName`, `role` `READER` / `OPERATOR`, `locale` ; lien de 72 h vers le site), changement de rôle (immédiat), retrait (204 ; accès coupé, sessions fermées). Erreurs : `TEAM_FULL`, `EMAIL_ALREADY_USED`, `TEAM_MEMBER_NOT_FOUND`, `OWNER_ONLY`, `BUSINESS_ONLY`, `TOTP_ENROLLMENT_REQUIRED` (double authentification du propriétaire exigée quand `REQUIRE_STAFF_2FA` est actif) |
| `GET/POST /v1/me/beneficiaries` · `PATCH/DELETE /v1/me/beneficiaries/{id}` | `profile:*_own` | Bénéficiaires autorisés (10 actifs max ; 4 derniers caractères de la pièce seulement ; DELETE = révocation, l'historique est conservé) |
| `GET /v1/me/receiving-addresses` | `profile:read_own` | Adresses de réception générées par entrepôt actif et par mode (AIR/SEA) à partir du code client |
| `GET /v1/admin/customers` · `GET /v1/admin/customers/{id}` | `customer:read` | Recherche (code, nom, raison sociale, e-mail), pagination par curseur |
| `GET/POST /v1/admin/warehouses` · `PATCH /v1/admin/warehouses/{id}` | `warehouse:read` · `warehouse:manage` | Entrepôts. **Portées respectées** : un droit limité à un entrepôt ne permet ni d'en créer, ni de modifier un autre |
| `GET/PUT /v1/admin/settings/public-contact` | `settings:read` · `settings:update` | Coordonnées publiques (page Contact) |
| `GET /v1/public/companies/{slug}` · `GET /v1/public/companies/{slug}/warehouses` | public, 120/min/IP, `Cache-Control: public, max-age=60` | Nom, langue, devise, coordonnées ; entrepôts actifs et visibles. Le modèle d'adresse des clients n'est jamais exposé ; entreprise inconnue, suspendue ou « platform » : 404 |
| `GET/POST /v1/admin/rate-cards` · `GET/PUT/DELETE /v1/admin/rate-cards/{id}` | `rate:read` · `rate:manage` | Grilles tarifaires (tranches de poids, suppléments, taxes). Création **en brouillon** ; `PUT`/`DELETE` réservés aux brouillons |
| `POST /v1/admin/rate-cards/{id}/activate` · `/retire` · `/duplicate` | `rate:manage` | Active (409 si une autre grille active couvre le même trajet, mode et période), retire (fin de validité = aujourd'hui), copie en brouillon de version suivante. Une grille active est **immuable** (API et base) |
| `GET/POST /v1/admin/categories` · `PATCH /v1/admin/categories/{id}` | `rate:read` · `rate:manage` | Catégories de marchandises (une catégorie « restreinte » est refusée par le calculateur) |
| `GET /v1/public/companies/{slug}/rates` | public, 120/min/IP, cache 60 s | Trajets/modes tarifés aujourd'hui, services facultatifs, catégories. **Aucun prix** |
| `POST /v1/public/companies/{slug}/quote` | public, 60/min/IP | Estimation (`isEstimate: true`), rien n'est enregistré. **422 `TARIFF_UNAVAILABLE`** sans grille ou sans tranche : aucun prix n'est jamais inventé |
| `POST/GET /v1/me/quotes` | `quote:create`, comptes clients | Estimation enregistrée dans l'historique du client / 20 dernières |
| `GET/POST /v1/me/prealerts` · `GET/PATCH/DELETE /v1/me/prealerts/{id}` | `prealert:read_own` · `prealert:create_own` | Déclaration d'achat : crée le colis attendu et son numéro de suivi. Un numéro de suivi marchand = une préalerte active par entreprise (409). Modification/annulation tant que le colis n'est pas arrivé (409 `PREALERT_LOCKED`) |
| `GET /v1/me/packages` · `GET /v1/me/packages/{id}` | `package:read_own` | Mes colis (filtres `status`, `q`, curseur) et détail avec historique **public** ; frais « provisoires » ; colis d'autrui = 404 |
| `GET /v1/admin/packages` · `/expected` · `/{id}` | `package:read` · `package:receive` | Liste (limitée aux entrepôts de la portée), colis attendus, détail complet (historique interne, retenues, préalerte) |
| `POST /v1/admin/packages/receive` | `package:receive` (portée entrepôt) | Réception et rapprochement : numéro du marchand **exact**, sinon code client avec un seul colis attendu, sinon `expectedPackageId` ; plusieurs candidats : 409 `AMBIGUOUS_MATCH` ; sans correspondance : nouveau colis rattaché au code client ou « non identifié » |
| `POST /v1/admin/packages/{id}/identify` · `/register` · `/notes` | `package:update` · `package:register` | Rattache un colis non identifié (fusion possible dans le colis attendu) ; pèse et calcule les frais avec la grille active (sans grille : enregistré **sans montant**) ; note interne |
| `POST /v1/admin/packages/{id}/transitions` | selon la transition (table partagée) + portée | Changement de statut : toute paire hors table = 409 `INVALID_TRANSITION` ; transitions des autres modules = 409 `TRANSITION_NOT_AVAILABLE` ; motif obligatoire pour retenir, retourner, annuler |
| `POST /v1/admin/package-groups` · `DELETE /v1/admin/package-groups/{id}` | `package:update` | Regroupe / dégroupe des colis du même client |
| `GET /v1/public/tracking/{numéro}` | public, 30/min/IP, `Cache-Control: no-store` | Statut et événements **publics** (aucun nom, adresse, valeur, document, acteur, texte libre ; motifs sensibles masqués). Numéro inconnu, mal formé ou au contrôle erroné : **même réponse 404** |
| `POST /v1/files?ownerType&ownerId&kind&filename` | tout connecté, autorisé selon le propriétaire, 60/10 min | Dépôt (corps binaire brut : JPEG, PNG, WebP, PDF ; 8 Mo ; 10 par objet). Type réel déterminé par le contenu |
| `GET /v1/files` · `GET /v1/files/{id}/link` · `DELETE /v1/files/{id}` | idem | Liste, lien signé de 5 minutes, suppression |
| `GET /v1/files/{id}/content?c&exp&sig` | public (signature HMAC) | Contenu ; en-têtes `nosniff` et CSP `sandbox` |
| `GET/POST /v1/admin/warehouses/{id}/locations` · `PATCH /v1/admin/locations/{id}` | `warehouse:read` · `warehouse:manage` (par entrepôt) | Emplacements. Désactivation refusée s'ils contiennent des colis |
| `POST /v1/admin/packages/{id}/move` · `GET /v1/admin/packages/{id}/movements` | `warehouse:move` · `package:read` | Range, déplace ou sort un colis ; un mouvement est écrit à chaque changement (journal en ajout seul) |
| `GET /v1/admin/warehouses/{id}/inventory` | `warehouse:read` (par entrepôt) | Colis présents par emplacement ; **exclut** les colis dont le lot est parti |
| `GET /v1/admin/anomalies` | `package:read` | Retenues ouvertes et colis reçus sans client, selon le périmètre |
| `POST /v1/admin/scan/receive` | `package:receive` (par entrepôt) | Réception d'un code (suivi ou numéro marchand) : `RECEIVED`, `ALREADY_RECEIVED` ou `UNIDENTIFIED`. Idempotente, sûre sous concurrence |
| `GET/POST /v1/admin/agencies` · `PATCH /v1/admin/agencies/{id}` | `agency:read` · `agency:manage` | Agences et points de retrait (la liste est limitée au périmètre) |
| `POST /v1/admin/packages/{id}/agency` | `package:update` | Affecte l'agence de retrait (même pays, agence active, avant l'arrivée en agence) |
| `GET /v1/admin/agencies/{id}/packages` · `POST …/receive` · `POST …/packages/{id}/ready-for-pickup` | `agency:read` · `agency:receive` (par agence) | Colis présents et attendus ; réception par scan (409 `WRONG_AGENCY`, `NOT_ARRIVED`) ; « prêt pour retrait » |
| `GET /v1/public/companies/{slug}/agencies` | public, 120/min/IP, cache 60 s | Agences actives et publiques (nom, adresse, téléphone, horaires) |
| `GET/POST /v1/admin/shipments` · `GET/PATCH /v1/admin/shipments/{id}` | `shipment:read` · `shipment:manage` (par entrepôt d'origine) | Lots ; création **sans date prévue** ; modification des lots ouverts |
| `POST /v1/admin/shipments/{id}/packages` · `DELETE …/packages/{packageId}` | `shipment:manage` | Charge (code scanné ou identifiant : `LOADED` / `ALREADY_LOADED`) ou retire un colis d'un lot ouvert |
| `POST /v1/admin/shipments/{id}/dispatch` · `arrive` · `customs` · `close` · `cancel` | `shipment:dispatch` · `shipment:receive` · `shipment:manage` | Événements du lot ; départ, arrivée et douane **font avancer les colis** (réponse : `advanced`, `skipped`). Clôture refusée tant que des colis ne sont pas reçus en agence |
| `GET /v1/admin/shipments/{id}/manifest.csv` · `manifest.pdf` | `shipment:read` | Manifeste en téléchargement (`attachment`, `nosniff`, `no-store`) ; 409 si le lot est vide |
| `GET /health/live`, `GET /health/ready` | public, sans limite | Sondes (la seconde teste PostgreSQL et Redis, 503 sinon) |

### Finance et notifications (phase 7)

| Méthode et chemin | Accès | Rôle |
|---|---|---|
| `GET/POST /v1/admin/invoices` · `GET /v1/admin/invoices/{id}` | `invoice:read` · `invoice:create` | Liste (statut, client, numéro ou code client) ; **brouillon** à partir des colis pesés (frais de la pesée, remise plafonnée, lignes libres contrôlées) |
| `POST /v1/admin/invoices/{id}/issue` · `DELETE /v1/admin/invoices/{id}` | `invoice:create` | Émet (numéro `INV-AAAA-NNNNNN` sans trou, colis « en attente de paiement » ou « prêts » selon la politique, client prévenu) · supprime un brouillon |
| `POST /v1/admin/invoices/{id}/void` · `POST …/credit-notes` | `invoice:void` | Annule une facture sans paiement (motif) · émet un avoir (`CN-AAAA-NNNNNN`) limité à ce qui n'est ni payé ni en attente |
| `GET /v1/admin/invoices/{id}/pdf` | `invoice:read` | Facture en PDF (pas de PDF pour un brouillon) |
| `GET /v1/me/invoices` · `GET …/{id}` · `GET …/{id}/pdf` | `invoice:read_own` | Mes factures **émises** (jamais les brouillons) |
| `POST /v1/me/invoices/{id}/payments` | `payment:declare_own` | Déclare un virement bancaire ou un paiement Zelle (`method` `BANK_TRANSFER` ou `ZELLE`, référence obligatoire) : le paiement reste `PENDING` |
| `GET /v1/me/payments` · `DELETE /v1/me/payments/{id}` · `GET …/{id}/receipt.pdf` · `GET /v1/me/payment-options` | `payment:read_own` · `payment:declare_own` | Mes paiements ; retire une déclaration en attente ; reçu PDF ; moyens réellement disponibles (`online: false` tant qu'aucun prestataire n'est configuré) |
| `GET /v1/admin/payments` | `payment:read` | Paiements (statut, mode, facture) |
| `POST /v1/admin/payments/cash` | `payment:record_cash` | Encaissement en espèces ; **caisse ouverte exigée** ; en-tête `Idempotency-Key` ; reçu `RCT-AAAA-NNNNNN` immédiat |
| `POST /v1/admin/payments/{id}/confirm` · `POST …/reject` | `payment:reconcile` | Valide / refuse (motif) un paiement déclaré |
| `POST /v1/admin/payments/{id}/refunds` | `payment:refund` | Enregistre un remboursement (partiel ou total, motif) |
| `GET /v1/admin/payments/{id}/receipt.pdf` | `payment:read` | Reçu PDF |
| `GET/POST /v1/admin/cash-sessions` · `POST …/{id}/close` | `payment:read` · `payment:record_cash` | Caisses (par agence ou entreprise) : ouverture, clôture avec attendu / compté / écart |
| `GET /v1/admin/finance/summary` · `GET …/export.csv` | `payment:reconcile` · `payment:export` | Synthèse par mode et devise ; registre CSV (période ≤ 366 jours, cellules textuelles protégées contre l'injection de formules, montants restés numériques) |
| `GET/PUT /v1/admin/settings/finance` | `settings:read` · `settings:update` | Plafond de remise (10 % par défaut), consignes de paiement |
| `POST /v1/webhooks/payments/{entreprise}/{prestataire}` | public, signé, 300/min | Confirmation de paiement signée ; **404 tant que `PAYMENT_WEBHOOK_PROVIDER` / `PAYMENT_WEBHOOK_SECRET` ne sont pas définis** |
| `GET /v1/admin/notifications` · `POST …/{id}/retry` · `POST …/process` | `notification:read` · `notification:template_manage` | Journal (statut, canal, événement) ; relance d'un échec ; traitement immédiat |
| `GET/PUT/DELETE /v1/admin/notification-templates` | `notification:read` · `notification:template_manage` | Modèles effectifs, personnalisation par événement, canal et langue ; retour au défaut |
| `GET /v1/me/notifications` · `POST …/read-all` · `POST …/{id}/read` | `notification:read_own` | Ma boîte de réception du portail |

### Livraison, réclamations, tableau de bord (phase 8)

| Méthode et chemin | Accès | Rôle |
|---|---|---|
| `GET/POST /v1/admin/routes` · `GET …/{id}` | `delivery:read` · `delivery:assign` | Tournées des agences gérées ; planification (`TOU-AAAA-NNNNNN`, livreur actif ayant le rôle) ; détail avec arrêts, règle de preuves, bénéficiaires, soldes |
| `POST /v1/admin/routes/{id}/stops` · `DELETE …/stops/{stopId}` | `delivery:assign` | Ajoute un colis arrivé (adresse figée, client prévenu) · retire un arrêt (tournée planifiée) |
| `POST /v1/admin/routes/{id}/start` · `/complete` · `/cancel` | `delivery:assign` | Départ (colis « en cours de livraison », tout ou rien) · clôture (arrêts tous traités) · annulation (planifiée) |
| `GET /v1/admin/my-routes` · `GET …/{id}` | `delivery:read_assigned` | **Mes tournées** du livreur (seulement les siennes, sans montants) |
| `POST /v1/admin/route-stops/{id}/deliver` · `/fail` | `delivery:confirm` | Remise d'un arrêt (preuves) · livraison non aboutie (motif, reprogrammation). Livreur de la tournée ou responsable de l'agence, sinon 404 |
| `POST /v1/admin/packages/{id}/handover` | `delivery:confirm` | Remise au comptoir d'un colis « prêt pour retrait » (responsables de l'agence, pas les livreurs) |
| `GET /v1/admin/packages/{id}/handover-info` · `GET …/delivery-attempts` | `delivery:confirm` · `delivery:read` | Avant la remise : règle, bénéficiaires, solde, échecs ; historique des tentatives |
| `GET /v1/admin/drivers` | `delivery:assign` | Livreurs actifs affectables |
| `GET/PUT /v1/admin/settings/delivery` | `settings:read` · `settings:update` | Preuves exigées (code, pièce, photo) |
| `POST /v1/me/packages/{id}/handover-code` | `package:read_own` | Génère mon code de remise (montré une seule fois) |
| `GET/POST /v1/me/claims` · `GET …/{id}` · `POST …/{id}/messages` | `claim:read_own` · `claim:create_own` | Mes réclamations et leurs échanges (sans notes internes) |
| `GET /v1/admin/claims` · `GET …/{id}` · `GET …/assignees` | `claim:read` · `claim:manage` | Réclamations (statut, catégorie, responsable, numéro, code client) ; détail avec notes internes |
| `POST /v1/admin/claims/{id}/assign` · `/messages` · `/status` | `claim:manage` | Affecte · répond ou note (`internal: true`) · change l'état (clôture = résolution obligatoire) |
| `GET /v1/admin/dashboard` | `report:read` (toute l'entreprise) | Indicateurs sur une période (30 jours par défaut, 366 au plus) |
| `GET /v1/audit` | `audit:read` | Journal d'audit (déjà en phase 3) : maintenant aussi dans l'interface |

## Règles à connaître

- **Droits évalués à chaque requête** depuis la base : une désactivation, une révocation de session, un changement de rôle ou la suspension de l'entreprise s'appliquent immédiatement, sans attendre l'expiration du jeton d'accès.
- **Anti-escalade** : on ne peut attribuer qu'un rôle dont toutes les permissions sont détenues par soi-même sur toute l'entreprise.
- **Dernier administrateur** : on ne peut ni retirer le rôle, ni désactiver le dernier `COMPANY_ADMIN` actif d'une entreprise (ni le dernier `SUPER_ADMIN`).
- **Rôles clients** : ils ne s'attribuent que par l'inscription. Les rôles du personnel ne conviennent qu'aux comptes du personnel.
- **Liens des e-mails** : `<WEB_PUBLIC_URL>/<langue>/<page>?token=…` (langue du destinataire).
- **Cookies** : `b2c_refresh` (HttpOnly, chemin `/v1/auth`, jeton de renouvellement) et `b2c_session=1` (lisible, chemin `/`, sans secret, simple indice qu'une session peut être restaurée). Les deux sont supprimés à la déconnexion.
- **Portées** : `RECEPTION_AGENT` et `WAREHOUSE_MANAGER` exigent une portée `WAREHOUSE`, `AGENCY_MANAGER` une portée `AGENCY`. L'existence de l'entrepôt ou de l'agence n'est **pas encore vérifiée** (ces objets arrivent en phase 6).

## Règles ajoutées en phase 5

- **Un seul point d'écriture du statut** : `PackagesService.transition`. Il verrouille la ligne, vérifie la table de transitions, le module propriétaire, la permission (et la portée d'entrepôt), le motif, puis écrit l'événement et le journal d'audit dans la même transaction. La base refuse en plus tout changement de statut sans événement dans la même transaction.
- **Droits par entrepôt** : un agent limité à un entrepôt ne reçoit, ne pèse ni ne voit rien ailleurs ; un colis hors portée est présenté comme inexistant (404).
- **Montants** : toujours en décimal exact (pas de flottant), deux décimales, arrondi « 0,5 vers le haut » ; le total est la somme exacte des lignes affichées.
- **Corps binaire** : seule `/v1/files` accepte du binaire (les autres routes restent limitées au JSON de 100 Ko).

## Règles ajoutées en phase 6

- **Chargement d'un colis (I12, I13)** : statut « prêt pour expédition », client, poids, dimensions connus ; même mode, même entrepôt d'origine, même pays de destination que le lot ; un seul lot actif à la fois (index unique partiel en base). Un lot qui n'est plus ouvert refuse tout chargement et tout retrait (déclencheur).
- **Propagation** : le départ fait passer les colis de `READY_TO_SHIP` à `IN_TRANSIT` (et vide leur emplacement), l'arrivée de `IN_TRANSIT` à `ARRIVED_DESTINATION`, la douane à `IN_CUSTOMS`. Un colis retenu en route est **laissé tel quel et signalé**. Ces transitions appartiennent au module des lots : l'API générique répond 409 `TRANSITION_NOT_AVAILABLE`.
- **Droits par famille de permission** : `agency:*` se vérifie sur l'agence de destination du colis, `warehouse:*`, `package:*` et `shipment:*` sur son entrepôt d'origine.
- **Manifeste CSV** : UTF-8 avec BOM ; toute cellule commençant par `=`, `+`, `-`, `@`, tabulation ou retour chariot est précédée d'une apostrophe (injection de formules).
- `POST /v1/admin/packages/{id}/register` accepte `transportMode` pour un colis reçu sans préalerte (sans effet si le mode est déjà connu).
- Les colis exposent `pickup` (agence, adresse, horaires, `ready`) au client propriétaire et, pour une agence publique, au suivi public : seulement quand le colis est réellement arrivé en agence.

## Règles ajoutées en phase 7

- **Montants** en décimal exact, deux décimales ; une facture est en **une devise** (`CURRENCY_MISMATCH` sinon).
- **Brouillon** : les lignes de fret et de manutention viennent de la pesée (grille appliquée) ; un colis sans tarif calculé exige une ligne `FREIGHT` saisie (`PACKAGE_NOT_PRICED`), un colis déjà tarifé n'en accepte pas (`PACKAGE_ALREADY_PRICED`). Un colis n'est que dans **une** facture (`ALREADY_INVOICED`, aussi en cas de brouillons simultanés).
- **Remise** : permission `discount:apply` et plafond de l'entreprise (`DISCOUNT_ABOVE_CAP`, 422).
- **Émission** : numérotation par entreprise et par année, sans trou même avec des émissions simultanées ; politique `PAY_BEFORE_SHIPMENT` (colis « en attente de paiement ») ou `PAY_BEFORE_RELEASE` (colis « prêts à partir » dès l'émission). Une facture **intégralement payée** libère ses colis (« prêt pour expédition ») avec un événement qui cite la facture.
- **Paiement** : jamais au-delà du reste dû (`AMOUNT_EXCEEDS_BALANCE`, 422, paiements en attente compris). **Idempotency-Key** (8 à 64 caractères) : même clé et même contenu → même résultat (`replayed: true`), même clé et contenu différent → `IDEMPOTENCY_KEY_REUSED`. Une référence de virement ou de paiement mobile ne se déclare qu'une fois (`DUPLICATE_REFERENCE`).
- **Caisse** : une caisse a **une devise** (`currency`, par défaut celle de l'entreprise) ; une seule ouverte par agence (ou pour l'entreprise) **et par devise** (une agence qui encaisse deux devises ouvre deux caisses) ; l'encaissement entre dans la caisse de la devise de la facture, sinon `CASH_SESSION_REQUIRED` (avec `details.currency`) ; l'encaissement sans caisse ouverte est refusé (`CASH_SESSION_REQUIRED`) ; l'agent d'une agence ne peut ouvrir, encaisser et clôturer que pour **son** agence ; attendu = fond + espèces − remboursements ; une caisse clôturée ne change plus.
- **Remboursement** : jamais plus que le montant confirmé non encore remboursé (`REFUND_EXCEEDS_PAYMENT`) ; le solde de la facture suit.
- **Notifications** : douze événements métier (`prealert.created`, `package.received`, `package.identified`, `payment.required`, `payment.confirmed`, `shipment.prepared`, `shipment.dispatched`, `shipment.arrived`, `package.available_at_agency`, `delivery.scheduled`, `package.delivered`, `package.incident`) ; **`delivery.scheduled` et `package.delivered` n'ont pas encore d'émetteur** (la livraison arrive en phase 8). Canaux : portail et e-mail actifs ; WhatsApp « ignoré — canal non configuré ». **Le SMS a été retiré du produit** (plus de préférence ni de canal ; `PATCH /v1/me/profile` refuse la clé `sms`). Les préférences du client coupent un canal, sauf pour `payment.confirmed` et `package.incident`. Nouvelles tentatives d'e-mail à +1, +5, +30, +120 minutes puis `FAILED` (5 tentatives au total).
- Codes ajoutés : `ALREADY_INVOICED`, `PACKAGE_NOT_BILLABLE`, `PACKAGE_CUSTOMER_MISMATCH`, `PACKAGE_NOT_PRICED`, `PACKAGE_ALREADY_PRICED`, `EXTRA_LINE_PACKAGE_UNKNOWN`, `DISCOUNT_ABOVE_CAP`, `DISCOUNT_NOT_ALLOWED`, `CURRENCY_MISMATCH`, `INVOICE_NOT_FOUND`, `INVOICE_NOT_DRAFT`, `INVOICE_IS_DRAFT`, `INVOICE_NOT_ISSUED`, `INVOICE_HAS_PAYMENTS`, `INVOICE_NOT_PAYABLE`, `INVOICE_NOT_CREDITABLE`, `INVOICE_VOID`, `CREDIT_EXCEEDS_UNPAID`, `CASH_SESSION_REQUIRED`, `CASH_SESSION_OPEN`, `CASH_SESSION_CLOSED`, `CASH_SESSION_NOT_FOUND`, `AMOUNT_EXCEEDS_BALANCE`, `DUPLICATE_REFERENCE`, `INVALID_IDEMPOTENCY_KEY`, `IDEMPOTENCY_KEY_REUSED`, `PAYMENT_NOT_FOUND`, `PAYMENT_NOT_PENDING`, `PAYMENT_NOT_REFUNDABLE`, `REFUND_EXCEEDS_PAYMENT`, `RECEIPT_NOT_FOUND`, `INVALID_SIGNATURE` (401), `INVALID_PAYLOAD`, `NOTIFICATION_NOT_FOUND`, `NOT_FAILED`, `TEMPLATE_NOT_FOUND`, `CHANNEL_NOT_CONFIGURED`.

## Règles ajoutées en phase 8

- **Remise** : `DELIVERED` n'est écrit que par le module de livraison. Le colis doit être « prêt pour retrait » (comptoir) ou « en cours de livraison » (arrêt d'une tournée en cours). Preuves selon `/v1/admin/settings/delivery` (code, pièce, photo ; par défaut code et pièce) : `OTP_REQUIRED`, `ID_DOCUMENT_REQUIRED`, `PROOF_PHOTO_REQUIRED`. Un bénéficiaire doit être actif et dans ses dates (`BENEFICIARY_INVALID`) et sa pièce concorder (`ID_MISMATCH`). Un code faux répond `OTP_INVALID` avec `details.remaining` ; au 5e échec le code est annulé (`OTP_NOT_AVAILABLE` ensuite, il faut en générer un nouveau) ; `OTP_LOCKED` si le verrou est atteint avec un code encore actif.
- **Solde** : `BALANCE_DUE` (409, `details` : montant, devise, `unbilled`) ; avec `overrideBalance: { reason }`, la remise passe si l'utilisateur détient `delivery:override_balance` (sinon 403 `OVERRIDE_NOT_ALLOWED`).
- **Code de remise** : `POST /v1/me/packages/{id}/handover-code` renvoie `{ code, expiresAt }` une seule fois ; 5 codes par colis et par heure (`TOO_MANY_CODES`, 429) ; colis pas encore en agence : `INVALID_STATE`.
- **Tournées** : `ROUTE_NOT_PLANNED`, `ROUTE_NOT_IN_PROGRESS`, `ROUTE_EMPTY`, `ROUTE_HAS_PENDING_STOPS`, `STOP_ALREADY_HANDLED`, `ALREADY_ON_ROUTE`, `NO_DELIVERY_ADDRESS`, `DRIVER_INVALID`, `PACKAGES_NOT_READY` (départ refusé, rien ne bouge).
- **Échec de livraison** : `{ failed, failedAttempts, returnSuggested }` (suggestion à partir de 3 échecs).
- **Réclamations** : `CLAIM_NOT_FOUND`, `CLAIM_CLOSED` (le client ne répond plus à une réclamation clôturée), `CLAIM_STATUS_UNCHANGED`, `ASSIGNEE_INVALID`.
- **Tableau de bord** : `REPORT_SCOPE` (403) pour un droit limité à une agence ou un entrepôt. Les montants sont des chaînes à deux décimales groupées par devise ; les délais moyens valent `null` sans mesure.
- Notifications : `delivery.scheduled` porte `plannedDate` ; nouveaux événements `delivery.failed` et `claim.updated` (`claimNumber`).
- `COMPANY_ADMIN` détient désormais `delivery:read_assigned` (nécessaire pour attribuer le rôle de livreur).
