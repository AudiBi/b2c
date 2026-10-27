-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('INDIVIDUAL', 'BUSINESS');

-- CreateEnum
CREATE TYPE "AddressKind" AS ENUM ('PERSONAL', 'DELIVERY');

-- CreateEnum
CREATE TYPE "BeneficiaryStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "WarehouseStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "TransportMode" AS ENUM ('AIR', 'SEA');

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "customer_type" "CustomerType" NOT NULL,
    "customer_code" TEXT NOT NULL,
    "notification_prefs" JSONB NOT NULL DEFAULT '{"email": true, "sms": false, "whatsapp": false, "inApp": true}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_addresses" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "kind" "AddressKind" NOT NULL,
    "label" TEXT NOT NULL,
    "recipient_name" TEXT NOT NULL,
    "phone" TEXT,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" TEXT NOT NULL,
    "region" TEXT,
    "country" CHAR(2) NOT NULL,
    "postal_code" TEXT,
    "instructions" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "beneficiaries" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "id_document_type" TEXT,
    "id_document_last4" TEXT,
    "phone" TEXT,
    "valid_from" DATE,
    "valid_to" DATE,
    "status" "BeneficiaryStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "beneficiaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" CHAR(2) NOT NULL,
    "city" TEXT NOT NULL,
    "address_line" TEXT NOT NULL,
    "public_visible" BOOLEAN NOT NULL DEFAULT true,
    "address_template" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "status" "WarehouseStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receiving_addresses" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "transport_mode" "TransportMode" NOT NULL,
    "lines" JSONB NOT NULL,
    "warehouse_version" INTEGER NOT NULL,
    "generated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receiving_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_user_id_key" ON "customers"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_company_id_customer_code_key" ON "customers"("company_id", "customer_code");

-- CreateIndex
CREATE UNIQUE INDEX "customers_id_company_id_key" ON "customers"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_user_id_company_id_key" ON "customers"("user_id", "company_id");

-- CreateIndex
CREATE INDEX "customer_addresses_customer_id_idx" ON "customer_addresses"("customer_id");

-- CreateIndex
CREATE INDEX "beneficiaries_customer_id_status_idx" ON "beneficiaries"("customer_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_company_id_reference_key" ON "warehouses"("company_id", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_id_company_id_key" ON "warehouses"("id", "company_id");

-- CreateIndex
CREATE INDEX "receiving_addresses_company_id_warehouse_id_idx" ON "receiving_addresses"("company_id", "warehouse_id");

-- CreateIndex
CREATE UNIQUE INDEX "receiving_addresses_customer_id_warehouse_id_transport_mode_key" ON "receiving_addresses"("customer_id", "warehouse_id", "transport_mode");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_user_id_company_id_fkey" FOREIGN KEY ("user_id", "company_id") REFERENCES "users"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customer_id_company_id_fkey" FOREIGN KEY ("customer_id", "company_id") REFERENCES "customers"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beneficiaries" ADD CONSTRAINT "beneficiaries_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beneficiaries" ADD CONSTRAINT "beneficiaries_customer_id_company_id_fkey" FOREIGN KEY ("customer_id", "company_id") REFERENCES "customers"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receiving_addresses" ADD CONSTRAINT "receiving_addresses_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receiving_addresses" ADD CONSTRAINT "receiving_addresses_customer_id_company_id_fkey" FOREIGN KEY ("customer_id", "company_id") REFERENCES "customers"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receiving_addresses" ADD CONSTRAINT "receiving_addresses_warehouse_id_company_id_fkey" FOREIGN KEY ("warehouse_id", "company_id") REFERENCES "warehouses"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =====================================================================================
-- Partie écrite à la main : contraintes CHECK, Row-Level Security, droits du rôle applicatif.
-- =====================================================================================

ALTER TABLE customers ADD CONSTRAINT customers_code_format
  CHECK (customer_code ~ '^[A-Z]{2,4}-[0-9]{6,}$');
ALTER TABLE customers ADD CONSTRAINT customers_notification_prefs_object
  CHECK (jsonb_typeof(notification_prefs) = 'object');

ALTER TABLE customer_addresses ADD CONSTRAINT customer_addresses_country_iso
  CHECK (country ~ '^[A-Z]{2}$');

ALTER TABLE beneficiaries ADD CONSTRAINT beneficiaries_id_last4_length
  CHECK (id_document_last4 IS NULL OR char_length(id_document_last4) BETWEEN 1 AND 4);
ALTER TABLE beneficiaries ADD CONSTRAINT beneficiaries_validity_order
  CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_to >= valid_from);

ALTER TABLE warehouses ADD CONSTRAINT warehouses_country_iso
  CHECK (country ~ '^[A-Z]{2}$');
ALTER TABLE warehouses ADD CONSTRAINT warehouses_reference_format
  CHECK (reference ~ '^[A-Z0-9][A-Z0-9-]{1,19}$');
ALTER TABLE warehouses ADD CONSTRAINT warehouses_template_lines
  CHECK (jsonb_typeof(address_template) = 'array' AND jsonb_array_length(address_template) BETWEEN 1 AND 10);
ALTER TABLE warehouses ADD CONSTRAINT warehouses_version_positive
  CHECK (version >= 1);

ALTER TABLE receiving_addresses ADD CONSTRAINT receiving_addresses_lines_array
  CHECK (jsonb_typeof(lines) = 'array');

-- Row-Level Security : activée et forcée, isolement strict par entreprise
ALTER TABLE customers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_addresses  ENABLE ROW LEVEL SECURITY;
ALTER TABLE beneficiaries       ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouses          ENABLE ROW LEVEL SECURITY;
ALTER TABLE receiving_addresses ENABLE ROW LEVEL SECURITY;

ALTER TABLE customers           FORCE ROW LEVEL SECURITY;
ALTER TABLE customer_addresses  FORCE ROW LEVEL SECURITY;
ALTER TABLE beneficiaries       FORCE ROW LEVEL SECURITY;
ALTER TABLE warehouses          FORCE ROW LEVEL SECURITY;
ALTER TABLE receiving_addresses FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON customers
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_isolation ON customer_addresses
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_isolation ON beneficiaries
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_isolation ON warehouses
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_isolation ON receiving_addresses
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

-- Droits au plus juste : pas de suppression des clients, bénéficiaires (révocation par statut) ni entrepôts.
GRANT SELECT, INSERT, UPDATE ON customers TO b2c_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON customer_addresses TO b2c_app;
GRANT SELECT, INSERT, UPDATE ON beneficiaries TO b2c_app;
GRANT SELECT, INSERT, UPDATE ON warehouses TO b2c_app;
GRANT SELECT, INSERT, UPDATE ON receiving_addresses TO b2c_app;
