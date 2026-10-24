-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "PaymentPolicy" AS ENUM ('PAY_BEFORE_SHIPMENT', 'PAY_BEFORE_RELEASE');

-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('fr', 'ht', 'en');

-- CreateEnum
CREATE TYPE "UserKind" AS ENUM ('PLATFORM', 'STAFF', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING', 'ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "TokenPurpose" AS ENUM ('EMAIL_VERIFY', 'PASSWORD_RESET', 'INVITE');

-- CreateEnum
CREATE TYPE "ScopeType" AS ENUM ('COMPANY', 'WAREHOUSE', 'AGENCY', 'ROUTE');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'SYSTEM', 'ANONYMOUS');

-- CreateEnum
CREATE TYPE "IdempotencyStatus" AS ENUM ('COMPLETED');

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "tracking_prefix" TEXT,
    "customer_code_prefix" TEXT,
    "default_currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "default_locale" "Locale" NOT NULL DEFAULT 'fr',
    "payment_policy" "PaymentPolicy" NOT NULL DEFAULT 'PAY_BEFORE_SHIPMENT',
    "status" "CompanyStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_settings" (
    "company_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "company_settings_pkey" PRIMARY KEY ("company_id","key")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "kind" "UserKind" NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "business_name" TEXT,
    "password_hash" TEXT,
    "password_changed_at" TIMESTAMPTZ(6),
    "locale" "Locale" NOT NULL DEFAULT 'fr',
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING',
    "email_verified_at" TIMESTAMPTZ(6),
    "phone_verified_at" TIMESTAMPTZ(6),
    "totp_secret_enc" TEXT,
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "refresh_hash" TEXT NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "rotated_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" "TokenPurpose" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_code" TEXT NOT NULL,
    "company_id" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_code")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "scope_type" "ScopeType" NOT NULL DEFAULT 'COMPANY',
    "scope_id" UUID,
    "scope_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "actor_type" "ActorType" NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" UUID,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "company_id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status" "IdempotencyStatus" NOT NULL DEFAULT 'COMPLETED',
    "response_status" INTEGER,
    "response" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("company_id","scope","key")
);

-- CreateTable
CREATE TABLE "counters" (
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "year" INTEGER NOT NULL DEFAULT 0,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "counters_pkey" PRIMARY KEY ("company_id","name","year")
);

-- CreateIndex
CREATE UNIQUE INDEX "companies_slug_key" ON "companies"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "companies_tracking_prefix_key" ON "companies"("tracking_prefix");

-- CreateIndex
CREATE INDEX "users_company_id_status_idx" ON "users"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "users_company_id_email_key" ON "users"("company_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "users_id_company_id_key" ON "users"("id", "company_id");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_family_id_idx" ON "sessions"("family_id");

-- CreateIndex
CREATE INDEX "sessions_company_id_expires_at_idx" ON "sessions"("company_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_hash_key" ON "verification_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "verification_tokens_user_id_purpose_idx" ON "verification_tokens"("user_id", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "roles_company_id_code_key" ON "roles"("company_id", "code");

-- CreateIndex
CREATE INDEX "user_roles_company_id_user_id_idx" ON "user_roles"("company_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_user_id_role_id_scope_key_key" ON "user_roles"("user_id", "role_id", "scope_key");

-- CreateIndex
CREATE INDEX "audit_log_company_id_entity_type_entity_id_idx" ON "audit_log"("company_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_company_id_created_at_idx" ON "audit_log"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_company_id_action_idx" ON "audit_log"("company_id", "action");

-- AddForeignKey
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_company_id_fkey" FOREIGN KEY ("user_id", "company_id") REFERENCES "users"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_user_id_company_id_fkey" FOREIGN KEY ("user_id", "company_id") REFERENCES "users"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_code_fkey" FOREIGN KEY ("permission_code") REFERENCES "permissions"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_company_id_fkey" FOREIGN KEY ("user_id", "company_id") REFERENCES "users"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counters" ADD CONSTRAINT "counters_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =====================================================================================
-- Partie écrite à la main (non modélisée par Prisma) : rôle applicatif, entreprise
-- « plateforme », fonctions, contraintes CHECK, Row-Level Security, droits, journal immuable.
-- =====================================================================================

-- Rôle applicatif. En développement il est créé avec mot de passe par docker/postgres/init/01-roles.sh ;
-- en production, créer le rôle avec LOGIN et un secret fort AVANT de lancer les migrations.
-- Ce rôle ne doit être ni superutilisateur, ni propriétaire des tables, ni BYPASSRLS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'b2c_app') THEN
    CREATE ROLE b2c_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO b2c_app;

-- Entreprise « plateforme » : identifiant fixe. Elle porte les rôles système et les comptes
-- des super administrateurs ; aucune donnée métier n'y est attachée.
INSERT INTO companies (id, name, slug, status, updated_at)
VALUES ('00000000-0000-7000-8000-000000000001', 'Plateforme', 'platform', 'ACTIVE', now());

-- -------------------------------------------------------------------------------------
-- Contexte de la requête, posé par l'API avec SET LOCAL (voir DbService.run).
--   app.company_id : entreprise de la requête (absent => aucune ligne visible)
--   app.platform   : 'on' pour les rares opérations inter-entreprises (création/recherche d'entreprise)
-- -------------------------------------------------------------------------------------
CREATE FUNCTION app_company_id() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.company_id', true), '')::uuid $$;

CREATE FUNCTION app_is_platform() RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT COALESCE(current_setting('app.platform', true), '') = 'on' $$;

CREATE FUNCTION app_platform_company_id() RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$ SELECT '00000000-0000-7000-8000-000000000001'::uuid $$;

-- -------------------------------------------------------------------------------------
-- Contraintes d'intégrité
-- -------------------------------------------------------------------------------------
ALTER TABLE companies ADD CONSTRAINT companies_slug_format
  CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$');
ALTER TABLE companies ADD CONSTRAINT companies_currency
  CHECK (default_currency IN ('USD', 'HTG'));
ALTER TABLE users ADD CONSTRAINT users_email_lowercase
  CHECK (email = lower(email));
-- Un compte PLATFORM n'existe que dans l'entreprise plateforme, et inversement.
ALTER TABLE users ADD CONSTRAINT users_platform_kind
  CHECK ((kind = 'PLATFORM') = (company_id = app_platform_company_id()));
ALTER TABLE user_roles ADD CONSTRAINT user_roles_scope_consistency CHECK (
  (scope_type = 'COMPANY' AND scope_id IS NULL AND scope_key = 'COMPANY')
  OR (scope_type <> 'COMPANY' AND scope_id IS NOT NULL AND scope_key = scope_type::text || ':' || scope_id::text)
);
ALTER TABLE counters ADD CONSTRAINT counters_value_nonnegative CHECK (value >= 0);
ALTER TABLE sessions ADD CONSTRAINT sessions_expiry_after_creation CHECK (expires_at > created_at);

-- -------------------------------------------------------------------------------------
-- Row-Level Security : activée ET forcée (s'applique même au propriétaire des tables).
-- Sans contexte (app.company_id absent), aucune ligne n'est visible ni insérable.
-- -------------------------------------------------------------------------------------
ALTER TABLE companies           ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_settings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE users               ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions            ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles               ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log           ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys    ENABLE ROW LEVEL SECURITY;
ALTER TABLE counters            ENABLE ROW LEVEL SECURITY;

ALTER TABLE companies           FORCE ROW LEVEL SECURITY;
ALTER TABLE company_settings    FORCE ROW LEVEL SECURITY;
ALTER TABLE users               FORCE ROW LEVEL SECURITY;
ALTER TABLE sessions            FORCE ROW LEVEL SECURITY;
ALTER TABLE verification_tokens FORCE ROW LEVEL SECURITY;
ALTER TABLE roles               FORCE ROW LEVEL SECURITY;
ALTER TABLE role_permissions    FORCE ROW LEVEL SECURITY;
ALTER TABLE user_roles          FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_log           FORCE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys    FORCE ROW LEVEL SECURITY;
ALTER TABLE counters            FORCE ROW LEVEL SECURITY;

-- Table des entreprises : chacune ne voit que sa ligne ; le mode plateforme voit et gère toutes les lignes.
CREATE POLICY companies_select ON companies FOR SELECT
  USING (id = app_company_id() OR app_is_platform());
CREATE POLICY companies_insert ON companies FOR INSERT
  WITH CHECK (app_is_platform());
CREATE POLICY companies_update ON companies FOR UPDATE
  USING (app_is_platform()) WITH CHECK (app_is_platform());

-- Tables d'entreprise : isolement strict en lecture et en écriture.
CREATE POLICY tenant_isolation ON company_settings
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_isolation ON users
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_isolation ON sessions
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_isolation ON verification_tokens
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_isolation ON user_roles
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_isolation ON idempotency_keys
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_isolation ON counters
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

-- Rôles : lecture de ses rôles et des rôles système (entreprise plateforme) ; écriture sur les siens seulement.
CREATE POLICY tenant_isolation ON roles
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY system_roles_read ON roles FOR SELECT
  USING (company_id = app_platform_company_id());
CREATE POLICY tenant_isolation ON role_permissions
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY system_role_permissions_read ON role_permissions FOR SELECT
  USING (company_id = app_platform_company_id());

-- Journal d'audit : lecture et ajout, rien d'autre.
CREATE POLICY audit_select ON audit_log FOR SELECT
  USING (company_id = app_company_id());
CREATE POLICY audit_insert ON audit_log FOR INSERT
  WITH CHECK (company_id = app_company_id());

-- Journal immuable : aucun UPDATE ni DELETE, pour aucun rôle (TRUNCATE reste réservé au propriétaire).
CREATE FUNCTION audit_log_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log est en ajout seul' USING ERRCODE = '42501';
END
$$;
CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

-- -------------------------------------------------------------------------------------
-- Droits du rôle applicatif : explicites, au plus juste. Chaque migration qui crée une table
-- doit accorder ses droits ; un oubli provoque une erreur « permission denied », jamais un accès trop large.
-- -------------------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON companies TO b2c_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON company_settings TO b2c_app;
GRANT SELECT, INSERT, UPDATE ON users TO b2c_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions TO b2c_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON verification_tokens TO b2c_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON roles TO b2c_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON role_permissions TO b2c_app;
GRANT SELECT, INSERT, DELETE ON user_roles TO b2c_app;
GRANT SELECT, INSERT, DELETE ON idempotency_keys TO b2c_app;
GRANT SELECT, INSERT, UPDATE ON counters TO b2c_app;
GRANT SELECT, INSERT ON audit_log TO b2c_app;
GRANT SELECT ON permissions TO b2c_app;
