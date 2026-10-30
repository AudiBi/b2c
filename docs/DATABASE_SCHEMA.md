# Schéma de base de données (conception)

Phase 2. **Aucune migration n'existe encore.** Ce document fixe le schéma cible ; le fichier `prisma/schema.prisma` et les migrations seront produits en phase 3 (identité, tenancy, audit) puis par phase. Toute divergence future est répercutée ici.

## 0. État réellement migré (phases 3 à 8)

Migrations appliquées et testées (dans `prisma/migrations/`) : `0001_platform_identity`, `0002_idempotency_update_grant`, `0003_customers_warehouses`, `0004_packages_pricing`, `0005_file_owner_update_grant`, `0006_logistics`, `0007_finance_notifications`, `0008_delivery_claims`, `0009_two_factor`, `0010_custom_roles`, `0011_team_members`, `0012_remove_sms_pref`. Tables existantes : `companies`, `company_settings`, `users`, `sessions`, `verification_tokens`, `roles`, `permissions`, `role_permissions`, `user_roles`, `audit_log`, `idempotency_keys`, `counters` (phase 3) ; `customers`, `customer_addresses`, `beneficiaries`, `warehouses`, `receiving_addresses` (phase 4). Phase 5 : `package_categories`, `packages`, `package_events`, `package_holds`, `package_groups`, `prealerts`, `rate_cards`, `rate_rules`, `rate_surcharges`, `quotes`, `file_objects`. Phase 6 : `warehouse_locations`, `warehouse_movements`, `agencies`, `shipments`, `shipment_packages`, `shipment_events` ; `packages` gagne `location_id` et `destination_agency_id`. Phase 7 : `invoices`, `invoice_lines`, `invoice_packages`, `credit_notes`, `payments`, `receipts`, `refunds`, `cash_sessions`, `provider_webhook_events`, `notification_templates`, `outbox_events`, `notifications`. Phase 8 : `routes`, `route_stops`, `delivery_attempts`, `handover_codes`, `claims`, `claim_messages`. Phase 9 : `totp_recovery_codes` (et deux colonnes de `users`). Équipes : `customer_members`. Tout le reste de ce document (zones de livraison, transporteurs…) reste une **conception** non migrée. Écarts par rapport à la conception initiale ci-dessous :

| Sujet | Conception initiale | Réalisé |
|---|---|---|
| Comptes de la plateforme | `company_id` nul pour les super administrateurs et les rôles système | **Entreprise « plateforme » à identifiant fixe** `00000000-0000-7000-8000-000000000001` (insérée par la migration). `company_id` est donc `NOT NULL` partout, ce qui permet des index d'unicité simples et des politiques RLS uniformes. Un `CHECK` impose `kind = 'PLATFORM'` si et seulement si l'utilisateur appartient à cette entreprise |
| Rôles système | `roles.company_id` nul | `company_id` = entreprise plateforme ; lisibles par toutes les entreprises (politique `system_roles_read`), non modifiables par elles |
| `users` | colonnes de verrouillage de compte | Pas de compteur en base : le verrouillage (5 échecs / 15 min) est dans Redis, par (entreprise, e-mail), ce qui évite de révéler si un compte existe. Ajout de `kind` (PLATFORM / STAFF / CUSTOMER), `business_name`, `password_changed_at` |
| `sessions` | une ligne par session | Une ligne par jeton de renouvellement émis ; `family_id` regroupe les rotations successives ; `rotated_at` et `revoked_at` |
| `user_roles` | unicité sur (utilisateur, rôle, type de portée, id de portée) | Colonne `scope_key` (`COMPANY` ou `TYPE:uuid`) pour une unicité sans valeur NULL ; `CHECK` de cohérence portée/identifiant |
| Intégrité entre entreprises | RLS seule | RLS **plus** clés étrangères composites `(user_id, company_id) → users(id, company_id)` pour `sessions`, `verification_tokens`, `user_roles` |
| Journal d'audit | droits en ajout seul | Droits `SELECT, INSERT` **et** déclencheur refusant UPDATE/DELETE pour tous les rôles |
| Droits du rôle applicatif | non précisés | Explicites par table (aucun `ALTER DEFAULT PRIVILEGES`) ; chaque migration doit accorder ses droits |
| Contexte RLS | `SET LOCAL app.company_id` | Idem, plus `app.platform` (`on` pour la seule lecture/écriture de `companies` par la plateforme) ; fonctions SQL `app_company_id()`, `app_is_platform()`, `app_platform_company_id()` |
| `customers`, `customer_addresses`, `beneficiaries`, `receiving_addresses`, `warehouses` | migration « 0002_customers_refs » | **Créées en `0003_customers_warehouses`** (la 0002 est le droit UPDATE sur `idempotency_keys`). `warehouses` est minimale (référence, adresse, modèle d'adresse client, version, visibilité publique) ; emplacements, mouvements et scans arrivent en phase 6. `agencies` : phase 6 |
| `customers` | `customer_type`, `customer_code` | + `notification_prefs` (JSON : e-mail, WhatsApp, dans l'espace ; la clé `sms` a été retirée par la migration 0012) ; `customer_code` = `<préfixe>-<6 chiffres>` issu du compteur `customer-code` de l'entreprise (CHECK de format) ; clé étrangère composite vers `users(id, company_id)` |
| `beneficiaries` | numéro de pièce | **Seuls les 4 derniers caractères** sont conservés (`id_document_last4`) ; révocation par `status`, pas de suppression physique |
| `receiving_addresses` | `formatted_lines` | `lines` (JSON) + `warehouse_version` ; une ligne par (client, entrepôt, mode), écrite par `INSERT … ON CONFLICT DO UPDATE` (pas de doublon sous concurrence), régénérée quand les lignes changent (modèle de l'entrepôt ou nom du client) |
| Fichiers photo, documents | `file_objects` | **Créée en 0004** : propriétaire polymorphe (préalerte ou colis), empreinte SHA-256, clé de stockage imposée sous `companies/<entreprise>/` (CHECK), types MIME limités. Droits `SELECT, INSERT, DELETE` + `UPDATE(owner_id)` seulement (0005, pour la fusion de colis) |
| `packages` | tables « colis » de la conception | Statut modifiable **uniquement** avec un événement dans la même transaction (déclencheur différé `packages_status_needs_event`) ; `package_events` en ajout seul (droits + déclencheur) ; numéro de suivi **unique sur toute la plateforme** ; mode de transport nullable (colis sans préalerte) ; mesures stockées en kg et cm |
| `prealerts` | idem | Un colis attendu est créé avec la préalerte (relation 1-1, clé composite `(package_id, company_id)`) ; numéro de suivi marchand normalisé en majuscules (CHECK) |
| `rate_cards`, `rate_rules`, `rate_surcharges` | grilles versionnées | **Immuables hors brouillon** (déclencheurs `rate_cards_guard`, `rate_children_guard`) ; deux grilles ACTIVES ne couvrent jamais la même période pour un même trajet/mode (contrainte d'exclusion `rate_cards_no_active_overlap`) ; tranches sans chevauchement par catégorie (`rate_rules_no_overlap`) |
| `shipments`, `shipment_packages`, `shipment_events` | § 7 de la conception | **Pas de `carriers`, `manifests`, `scan_sessions`** : le transporteur est un texte libre, le manifeste est généré à la demande, la lecture de codes n'a pas de session. **Pas de date prévue** (`eta_at` retiré, exigence SHP-05) : seules `departed_at` et `arrived_at` réelles existent, cohérentes avec le statut (CHECK). Référence unique par entreprise (compteur par jour). **Un colis n'est dans qu'un lot actif** : index unique partiel `shipment_packages_one_active`. `shipment_packages` ne se modifie que sur un lot **ouvert** (déclencheur) et que par son retrait ; `shipment_events` en ajout seul |
| `warehouse_locations`, `warehouse_movements` | idem | Code unique par entrepôt ; un colis ne se range que dans un emplacement de **son** entrepôt (déclencheur `packages_location_check`) ; mouvements en ajout seul (droits + déclencheur) |
| Finance : `invoices`, `invoice_lines`, `credit_notes`, `payments`, `receipts`, `refunds`, `cash_sessions`, `provider_webhook_events` | § 8 | **Migration 0007** (regroupe finance et notifications ; pas de `0008`). **Pas de `payment_allocations`** : un paiement règle **une** facture (`payments.invoice_id`) ; l'affectation d'un paiement à plusieurs factures n'existe pas. **`invoice_packages` ajoutée** : un colis n'est facturé qu'une fois (`package_id` unique par entreprise), libéré à l'annulation ou à la suppression du brouillon. Facture : montants `NUMERIC(14,2)`, numéro `INV-AAAA-NNNNNN` attribué **à l'émission seulement** (compteur par entreprise et par année, sans trou), **immuable hors brouillon** (déclencheurs `invoices_guard`, `invoice_children_guard`) ; avoirs, reçus, remboursements et événements de prestataire en **ajout seul** (`finance_append_only`) ; paiement : montant, facture et client immuables, chemin de statut imposé (`payments_guard`), somme des paiements ouverts ≤ dû vérifiée **au commit** (déclencheur différé `payments_invoice_cap`) ; une seule caisse ouverte par agence (index unique partiel `cash_sessions_one_open`). Unicité `(provider, provider_ref)` et `(company_id, provider, event_id)` |
| Notifications : `notification_templates`, `outbox_events`, `notifications` | § 9 | **Migration 0007.** `outbox_events` : colonne `processed_at` (et non `published_at`), `attempts`, `next_attempt_at`, contenu **immuable** (`outbox_guard`). `notifications` : une ligne par canal (`IN_APP`, `EMAIL`, `SMS`, `WHATSAPP`), contenu rendu **immuable** (`notifications_guard`, seuls statut, tentatives, lecture changent), `dedupe_key = <événement>:<canal>` unique. Fonction `app_notification_work_companies()` (SECURITY DEFINER, renvoie seulement des identifiants d'entreprise) pour le traitement de fond. Pas de `claims`, `claim_messages`, `integration_configs` (phase 8) |
| Livraison : `routes`, `route_stops`, `delivery_attempts`, `handover_codes` | § 7 | **Migration 0008.** `routes` : référence `TOU-AAAA-NNNNNN`, cycle de vie imposé (`routes_guard`), agence et livreur figés. `route_stops` (et non `route_stops.address_snapshot` seul) : adresse **copiée** à la planification, **un seul arrêt `PENDING` par colis** (index unique partiel), arrêt traité immuable, insertion seulement dans une tournée `PLANNED`. `delivery_attempts` : **ajout seul**, preuves cohérentes par CHECK (réussite = destinataire nommé ; échec = motif ; dérogation = motif), seulement les 4 derniers caractères de la pièce. `handover_codes` (nouveau, non prévu) : empreinte HMAC-SHA256 du code, **un seul code actif par colis** (index unique partiel), compteur d'essais, jamais modifiable ni supprimé. Pas de `otps` générique ni de `delivery_zones` |
| Réclamations : `claims`, `claim_messages` | § 9 | **Migration 0008.** Numéro `CLM-AAAA-NNNNNN` ; clôture cohérente par CHECK (résolution obligatoire quand résolue ou rejetée) ; identité figée (`claims_guard`) ; messages en **ajout seul** avec drapeau `internal`. Pas de `integration_configs` |
| `agencies` | idem | Pas de `delivery_zones` (phase 8) ; visibilité publique par drapeau ; statut ACTIVE/INACTIVE |
| Recherche publique par numéro de suivi | non prévue | Fonction `app_package_company(text)` en **SECURITY DEFINER** : ne renvoie que l'identifiant de l'entreprise. Elle exige que son propriétaire contourne la RLS (superutilisateur ou `BYPASSRLS`) : à vérifier en production |

À savoir en écrivant les prochaines migrations : Prisma ne modélise ni les politiques RLS, ni les `CHECK`, ni les déclencheurs, ni les `GRANT`. Générer le SQL avec `prisma migrate diff --from-url … --to-schema-datamodel …` (ou `migrate dev --create-only`), puis **ajouter à la main** RLS + droits pour chaque nouvelle table portant `company_id` ; relire le SQL avant de l'appliquer. Les tests `rls.spec.ts` échouent si une table portant `company_id` n'a pas RLS activée et forcée.

## 1. Conventions

- PostgreSQL 16+. Noms de tables et colonnes en `snake_case`, tables au pluriel.
- Clé primaire `id uuid` (v7). Toutes les tables métier : `company_id uuid NOT NULL` (clé étrangère `companies`), `created_at`, `updated_at timestamptz`, et `created_by` si pertinent.
- Montants : `numeric(14,2)`, avec colonne `currency char(3)`. Poids : `numeric(10,3)` en **kg** stocké ; l'unité d'affichage (lb) est une conversion. Dimensions : `numeric(8,2)` en **cm**.
- Énumérations : types `ENUM` Prisma pour les listes fermées (statuts) ; tables de référence pour les listes configurables (catégories, services).
- Suppression : pas de suppression physique des données comptables ou logistiques (statuts, `deleted_at` ou archivage). Données personnelles : anonymisation selon la politique de conservation.
- Index : toute clé étrangère est indexée ; index composites commençant par `company_id`.
- **RLS** activée sur toutes les tables portant `company_id` (voir ARCHITECTURE.md §5).
- Colonnes `(…)` entre parenthèses : facultatives.

## 2. Plateforme et identité (phase 3)

| Table | Colonnes principales | Contraintes / index |
|---|---|---|
| `companies` | id, name, slug, tracking_prefix, customer_code_prefix, default_currency, default_locale, payment_policy, status | `slug` unique, `tracking_prefix` unique |
| `company_settings` | company_id, key, value (jsonb) | PK (company_id, key) |
| `users` | id, company_id (null pour plateforme), email, phone, password_hash, locale, status, email_verified_at, phone_verified_at, totp_secret_enc, last_login_at | unique (company_id, lower(email)) ; unique partiel pour plateforme |
| `sessions` | id, user_id, family_id, refresh_hash, ip, user_agent, expires_at, revoked_at, rotated_from | index (user_id), (family_id) |
| `verification_tokens` | id, user_id, purpose (EMAIL, PHONE, RESET), token_hash, expires_at, used_at | token_hash unique |
| `roles` | id, company_id (null = rôle système), code, name | unique (company_id, code) |
| `permissions` | code (PK), description | Défini par le code, synchronisé à la migration |
| `role_permissions` | role_id, permission_code | PK composite |
| `user_roles` | id, user_id, role_id, scope_type (COMPANY, WAREHOUSE, AGENCY, ROUTE), scope_id | unique (user_id, role_id, scope_type, scope_id) |
| `audit_log` | id, company_id, actor_user_id, actor_type, action, entity_type, entity_id, before (jsonb), after (jsonb), ip, request_id, created_at | **Ajout seul** : le rôle applicatif n'a que `INSERT` et `SELECT`. Index (company_id, entity_type, entity_id), (company_id, created_at) |
| `idempotency_keys` | company_id, key, scope, request_hash, response (jsonb), status, created_at | PK (company_id, scope, key) |
| `counters` | company_id, name, year, value | PK (company_id, name, year) ; incrément sous `UPDATE … RETURNING` verrouillé |

## 3. Clients (phase 3-4)

| Table | Colonnes principales | Contraintes |
|---|---|---|
| `customers` | id, company_id, user_id, customer_type (INDIVIDUAL, BUSINESS), customer_code, display_name, business_name, tax_id, phone, status, parent_customer_id (pour sous-comptes) | unique (company_id, customer_code) |
| `customer_addresses` | id, company_id, customer_id, kind (PERSONAL, DELIVERY), label, line1, line2, city, region, country, postal_code, instructions, is_default | index (customer_id) |
| `beneficiaries` | id, company_id, customer_id, full_name, id_document_type, id_document_last4, phone, valid_from, valid_to, status | Numéro de pièce non stocké en clair (seulement les 4 derniers caractères) |
| `receiving_addresses` | id, company_id, customer_id, warehouse_id, transport_mode, formatted_lines (jsonb), generated_at | unique (customer_id, warehouse_id, transport_mode) |

## 4. Entrepôts, agences, référentiels (phase 3 et 6)

| Table | Colonnes principales | Contraintes |
|---|---|---|
| `countries`, `cities` | code ISO, nom (fr/ht/en) | Référentiel global |
| `warehouses` | id, company_id, reference, name, country, city, address, address_template (jsonb), timezone, status | unique (company_id, reference) |
| `warehouse_locations` | id, company_id, warehouse_id, code, kind (SHELF, BIN, ZONE), status | unique (warehouse_id, code) |
| `agencies` | id, company_id, code, name, country, city, address, kind (AGENCY, PICKUP_POINT), phone, hours (jsonb), status | unique (company_id, code) |
| `delivery_zones` | id, company_id, agency_id, name, areas (jsonb), delivery_fee (nullable) | |
| `carriers` | id, company_id, name, mode (AIR, SEA, LAND), contact (jsonb), status | |
| `package_categories` | id, company_id, code, name (jsonb par langue), restricted, requires_declaration | unique (company_id, code) |
| `services` | id, company_id, code, name (jsonb), price_rule (jsonb), active | Services additionnels (assurance, emballage…) |
| `taxes` | id, company_id, code, name, rate or fixed_amount, applies_to, valid_from, valid_to | |

## 5. Préalertes et colis (phase 5)

| Table | Colonnes principales | Contraintes / index |
|---|---|---|
| `prealerts` | id, company_id, customer_id, store_name, order_number, supplier_tracking, warehouse_id, transport_mode, purchase_amount, currency, description, status, matched_package_id, matched_by, matched_at | index (company_id, supplier_tracking), unique (matched_package_id) si renseigné |
| `packages` | id, company_id, tracking_number, customer_id (null si non identifié), customer_ref, sender_name, recipient_name, recipient_phone, recipient_address_id, origin_warehouse_id, origin_country, origin_city, destination_country, destination_city, destination_agency_id, transport_mode, supplier_tracking, status, previous_status (pour reprise après blocage), actual_weight_kg, length_cm, width_cm, height_cm, volumetric_weight_kg, billable_weight_kg, rate_card_id, rate_card_version, content_description, declared_value, declared_currency, insured, shipping_fee, extra_fees, location_id, shipment_id (lot actif), group_id, received_at, shipped_at, delivered_at, version (verrou optimiste) | **unique (tracking_number) global** ; index (company_id, status), (company_id, customer_id), (company_id, supplier_tracking) ; CHECK poids > 0 si statut ≥ REGISTERED_WEIGHED ; déclencheur « statut ⇒ événement » |
| `package_events` | id, company_id, package_id, from_status, to_status, event_type, actor_user_id, reason, location_ref, occurred_at, visibility (PUBLIC, PRIVATE), data (jsonb) | Ajout seul. Index (package_id, occurred_at) |
| `package_items` | id, package_id, description, quantity, unit_value, hs_code (nullable) | |
| `package_groups` | id, company_id, customer_id, kind (CONSOLIDATION, SPLIT), reference | |
| `package_holds` | id, company_id, package_id, reason_code, note, opened_by, opened_at, released_by, released_at | Anomalies et blocages |
| `file_objects` | id, company_id, owner_type, owner_id, kind (PHOTO, INVOICE, DOCUMENT, SIGNATURE, MANIFEST), storage_key, original_name, mime_type, size_bytes, sha256, scan_status (PENDING, CLEAN, REJECTED), uploaded_by | `storage_key` commence par `companies/<company_id>/` (CHECK) |

## 6. Tarification (phase 5)

| Table | Colonnes principales | Contraintes |
|---|---|---|
| `rate_cards` | id, company_id, name, transport_mode, origin_zone, destination_zone, currency, weight_unit, dimension_unit, volumetric_divisor, min_billable_weight, rounding_mode (UP, NEAREST, STEP), rounding_step, valid_from, valid_to, version, status (DRAFT, ACTIVE, RETIRED) | Pas de chevauchement de périodes actives pour une même clé : contrainte d'exclusion `EXCLUDE USING gist` |
| `rate_rules` | id, rate_card_id, category_id (nullable), weight_from, weight_to, price_per_unit, flat_fee, min_charge | Tranches de poids sans chevauchement (exclusion) |
| `rate_surcharges` | id, rate_card_id, kind (INSURANCE_PCT, HANDLING, FUEL…), amount_or_rate, basis | |
| `quotes` | id, company_id, customer_id (nullable), input (jsonb), result (jsonb), rate_card_id, rate_card_version, is_estimate (true), expires_at | Conserve l'entrée et la version utilisée |

## 7. Transport et livraison (phase 6, 8)

| Table | Colonnes principales | Contraintes |
|---|---|---|
| `shipments` | id, company_id, reference, transport_mode, origin_warehouse_id, destination_country, destination_city, destination_agency_id, carrier_id, transport_ref (connaissement), departure_at, eta_at, arrived_at, status | unique (company_id, reference) |
| `shipment_packages` | shipment_id, package_id, loaded_at, loaded_by, removed_at | Unique partiel (package_id) WHERE removed_at IS NULL (I13) |
| `shipment_events` | id, company_id, shipment_id, status, actor_user_id, occurred_at, source (MANUAL, CARRIER_API), data | Ajout seul |
| `manifests` | id, company_id, shipment_id, file_object_id, generated_at, totals (jsonb) | |
| `warehouse_movements` | id, company_id, package_id, from_location_id, to_location_id, kind (IN, MOVE, OUT), actor_user_id, occurred_at | Ajout seul |
| `scan_sessions` | id, company_id, warehouse_id/agency_id, user_id, purpose, started_at, ended_at | |
| `routes` | id, company_id, agency_id, driver_user_id, planned_date, status | |
| `route_stops` | id, route_id, package_id, sequence, address_snapshot (jsonb), status | |
| `delivery_attempts` | id, company_id, package_id, route_stop_id, attempted_at, outcome (SUCCEEDED, FAILED, RESCHEDULED), failure_reason, recipient_name, id_document_last4, otp_verified, signature_file_id, photo_file_id, actor_user_id | |
| `delivery_otps` | id, package_id, code_hash, expires_at, attempts, used_at | Code haché, nombre d'essais limité |

## 8. Finance (phase 7)

| Table | Colonnes principales | Contraintes |
|---|---|---|
| `invoices` | id, company_id, number, customer_id, status, currency, subtotal, tax_total, discount_total, total, issued_at, due_at, voided_at | unique (company_id, number) ; modification interdite hors `DRAFT` (déclencheur) |
| `invoice_lines` | id, invoice_id, package_id (nullable), kind (FREIGHT, STORAGE, HANDLING, INSURANCE, TAX, CUSTOMS, DISCOUNT, OTHER), description, quantity, unit_price, amount | |
| `credit_notes` | id, company_id, number, invoice_id, amount, reason | |
| `payments` | id, company_id, customer_id, method (CASH, BANK_TRANSFER, CARD_ONLINE, MOBILE_MONEY), provider, provider_ref, amount, currency, status, idempotency_key, confirmed_at, recorded_by, agency_id, cash_session_id | unique (company_id, idempotency_key) ; unique (provider, provider_ref) |
| `payment_allocations` | payment_id, invoice_id, amount | Somme ≤ montant du paiement (déclencheur) |
| `refunds` | id, company_id, payment_id, amount, reason, status, provider_ref, approved_by | |
| `receipts` | id, company_id, number, payment_id, issued_at, file_object_id | unique (company_id, number) |
| `cash_sessions` | id, company_id, agency_id, opened_by, opened_at, closed_at, counted_amount, expected_amount | Clôture de caisse |
| `provider_webhook_events` | id, provider, event_id, received_at, payload_hash, status | unique (provider, event_id) : empêche le rejeu |

Aucun champ ne stocke un numéro de carte, un cryptogramme ou un jeton réutilisable de carte hors du prestataire.

## 9. Notifications et support (phase 7, 8)

| Table | Colonnes principales | Contraintes |
|---|---|---|
| `notification_templates` | id, company_id, event_code, channel (EMAIL, WHATSAPP, IN_APP ; la valeur SMS de l'énumération est conservée en base mais plus utilisée), locale, subject, body, active | unique (company_id, event_code, channel, locale) |
| `notifications` | id, company_id, user_id/customer_id, event_code, channel, locale, payload (jsonb), dedupe_key, status, attempts, last_error, next_attempt_at, sent_at, provider_message_id | unique (company_id, dedupe_key) |
| `outbox_events` | id, company_id, event_code, aggregate_type, aggregate_id, payload (jsonb), created_at, published_at | Index sur `published_at IS NULL` |
| `claims` | id, company_id, customer_id, package_id (nullable), kind, status, assigned_to, opened_at, resolved_at | |
| `claim_messages` | id, claim_id, author_id, body, file_object_id, created_at | |
| `integration_configs` | id, company_id, provider_code, channel, status (ACTIVE, DISABLED, NOT_CONFIGURED), secret_ref | Les secrets ne sont pas dans la table, seulement une référence au gestionnaire de secrets |

## 10. Rétention (par défaut, configurable)

| Donnée | Conservation proposée |
|---|---|
| Journal d'audit | 7 ans |
| Factures, paiements, reçus | 10 ans (obligations comptables à vérifier avec un juriste haïtien) |
| Photos de colis | 12 mois après livraison |
| Preuves de livraison | 24 mois |
| Jetons de session / vérification | Suppression à l'expiration |
| Compte client supprimé | Anonymisation des données personnelles, conservation des écritures comptables |

Ces durées sont des **valeurs proposées**, non des exigences légales vérifiées.

## 11. Migrations prévues

| Migration | Contenu | Phase |
|---|---|---|
| `0001_platform_identity` | companies, users, sessions, tokens, roles, permissions, user_roles, audit_log, idempotency_keys, counters + RLS | 3 |
| `0002_customers_refs` | customers, adresses, bénéficiaires, pays/villes, entrepôts, agences, catégories | 3-4 |
| `0003_packages` | packages, events, items, holds, file_objects, prealerts + déclencheurs | 5 |
| `0004_pricing` | rate_cards, rules, surcharges, quotes | 5 |
| `0005_logistics` | shipments, manifests, movements, scan_sessions | 6 |
| `0006_delivery` | routes, stops, attempts, otps | 6/8 |
| `0007_finance_notifications` | **réalisée** : finance + notifications en une migration (voir § 0) | 7 |
| `0010_custom_roles` | **réalisée** : `roles.scope_type` (portée unique d'un rôle personnalisé) ; CHECK `roles_code_format` (un rôle personnalisé a un code `custom-…` et une portée COMPANY / WAREHOUSE / AGENCY, un rôle système jamais) ; déclencheurs `roles_immutable_identity` (code, entreprise, nature et portée figés) et `roles_keep_system` (un rôle système ne se supprime pas). Les rôles personnalisés vivent dans l'entreprise qui les crée (RLS `tenant_isolation`), les rôles système dans l'entreprise plateforme (lecture seule pour les autres) |
| `0011_team_members` | **réalisée** : table `customer_members` (un membre d'équipe d'un compte professionnel : `user_id` unique, donc **une seule équipe**) ; déclencheurs `customer_members_guard` (appartenance immuable ; le membre est un compte client ; l'équipe se rattache à un compte PROFESSIONNEL ; un propriétaire de compte ne peut pas être membre, ni de sa propre équipe) et `customers_not_member` (un membre n'a jamais de profil client propre) ; RLS `tenant_isolation` forcée ; droits `SELECT, INSERT, DELETE` pour `b2c_app` |
| `0012_remove_sms_pref` | **réalisée** : retire la clé `sms` des préférences de notification (défaut et lignes existantes). La valeur `SMS` de l'énumération `NotificationChannel` est **conservée** (PostgreSQL ne retire pas une valeur d'énumération sans reconstruire le type ; d'anciennes lignes du journal peuvent la porter) |
| `0009_two_factor` | **réalisée (phase 9)** : `users.totp_enabled_at` et `users.totp_last_step` (dernier pas TOTP accepté, comparé-échangé pour qu'un code ne serve qu'une fois ; `totp_secret_enc` existait déjà et contient le secret **chiffré** AES-256-GCM) ; table `totp_recovery_codes` (empreinte HMAC de 64 caractères, usage unique : le déclencheur `totp_recovery_codes_immutable` interdit toute modification hors consommation, et d'une consommation déjà faite) ; CHECK `users_totp_consistent` (activation ⇒ secret présent) ; RLS forcée (52 tables protégées au total) ; suppression permise au rôle applicatif pour la régénération des codes |
| `0008_delivery_claims` | **réalisée** : tournées, arrêts, tentatives, codes de remise, réclamations (voir § 0) ; pas de vues de rapports : le tableau de bord interroge directement les tables | 8 |
