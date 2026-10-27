-- CreateEnum
CREATE TYPE "PackageStatus" AS ENUM ('PREALERT_CREATED', 'AWAITING_RECEIPT', 'RECEIVED_AT_WAREHOUSE', 'UNDER_INSPECTION', 'REGISTERED_WEIGHED', 'AWAITING_PAYMENT', 'READY_TO_SHIP', 'IN_TRANSIT', 'ARRIVED_DESTINATION', 'IN_CUSTOMS', 'RECEIVED_AT_AGENCY', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'ON_HOLD', 'RETURNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EventVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "PrealertStatus" AS ENUM ('OPEN', 'MATCHED_AUTO', 'MATCHED_MANUAL', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HoldReasonCode" AS ENUM ('DAMAGED', 'UNIDENTIFIED', 'SUSPICIOUS_CONTENT', 'PROHIBITED_ITEM', 'CUSTOMS', 'OTHER');

-- CreateEnum
CREATE TYPE "RoundingMode" AS ENUM ('NONE', 'UP', 'NEAREST');

-- CreateEnum
CREATE TYPE "RateCardStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "WeightUnit" AS ENUM ('KG', 'LB');

-- CreateEnum
CREATE TYPE "DimensionUnit" AS ENUM ('CM', 'IN');

-- CreateEnum
CREATE TYPE "SurchargeKind" AS ENUM ('SURCHARGE', 'TAX', 'INSURANCE');

-- CreateEnum
CREATE TYPE "SurchargeMethod" AS ENUM ('FLAT', 'PERCENT_OF_FREIGHT', 'PERCENT_OF_DECLARED_VALUE', 'PERCENT_OF_SUBTOTAL');

-- CreateEnum
CREATE TYPE "FileOwnerType" AS ENUM ('PREALERT', 'PACKAGE');

-- CreateEnum
CREATE TYPE "FileKind" AS ENUM ('PHOTO', 'INVOICE', 'DOCUMENT');

-- CreateTable
CREATE TABLE "package_categories" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "restricted" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "package_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package_groups" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "package_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packages" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "tracking_number" TEXT NOT NULL,
    "customer_id" UUID,
    "sender_name" TEXT,
    "recipient_name" TEXT,
    "origin_warehouse_id" UUID NOT NULL,
    "origin_country" CHAR(2) NOT NULL,
    "origin_city" TEXT NOT NULL,
    "destination_country" CHAR(2) NOT NULL,
    "destination_city" TEXT,
    "transport_mode" "TransportMode",
    "supplier_tracking" TEXT,
    "status" "PackageStatus" NOT NULL,
    "previous_status" "PackageStatus",
    "actual_weight_kg" DECIMAL(10,3),
    "length_cm" DECIMAL(8,2),
    "width_cm" DECIMAL(8,2),
    "height_cm" DECIMAL(8,2),
    "volumetric_weight" DECIMAL(12,3),
    "billable_weight" DECIMAL(12,3),
    "weight_unit" "WeightUnit",
    "rate_card_id" UUID,
    "pricing_snapshot" JSONB,
    "shipping_fee" DECIMAL(14,2),
    "extra_fees" DECIMAL(14,2),
    "fee_currency" CHAR(3),
    "content_description" TEXT,
    "declared_value" DECIMAL(14,2),
    "declared_currency" CHAR(3),
    "insured" BOOLEAN NOT NULL DEFAULT false,
    "category_id" UUID,
    "group_id" UUID,
    "received_at" TIMESTAMPTZ(6),
    "registered_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package_events" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "from_status" "PackageStatus",
    "to_status" "PackageStatus",
    "event_type" TEXT NOT NULL,
    "actor_user_id" UUID,
    "reason" TEXT,
    "visibility" "EventVisibility" NOT NULL DEFAULT 'PUBLIC',
    "location_label" TEXT,
    "data" JSONB,
    "txid" BIGINT NOT NULL DEFAULT txid_current(),
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "package_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package_holds" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "reason_code" "HoldReasonCode" NOT NULL,
    "note" TEXT,
    "opened_by" UUID,
    "opened_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_by" UUID,
    "released_at" TIMESTAMPTZ(6),

    CONSTRAINT "package_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prealerts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "store_name" TEXT NOT NULL,
    "order_number" TEXT,
    "supplier_tracking" TEXT,
    "warehouse_id" UUID NOT NULL,
    "transport_mode" "TransportMode" NOT NULL,
    "purchase_amount" DECIMAL(14,2) NOT NULL,
    "purchase_currency" CHAR(3) NOT NULL,
    "description" TEXT NOT NULL,
    "status" "PrealertStatus" NOT NULL DEFAULT 'OPEN',
    "matched_by_user_id" UUID,
    "matched_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "prealerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_cards" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "transport_mode" "TransportMode" NOT NULL,
    "origin_country" CHAR(2) NOT NULL,
    "destination_country" CHAR(2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "weight_unit" "WeightUnit" NOT NULL,
    "dimension_unit" "DimensionUnit" NOT NULL,
    "volumetric_divisor" DECIMAL(12,4) NOT NULL,
    "min_billable_weight" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "rounding_mode" "RoundingMode" NOT NULL DEFAULT 'NONE',
    "rounding_step" DECIMAL(12,3) NOT NULL DEFAULT 1,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "status" "RateCardStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rate_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_rules" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "rate_card_id" UUID NOT NULL,
    "category_id" UUID,
    "weight_from" DECIMAL(12,3) NOT NULL,
    "weight_to" DECIMAL(12,3),
    "price_per_unit" DECIMAL(14,4) NOT NULL,
    "flat_fee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "min_charge" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "rate_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_surcharges" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "rate_card_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "kind" "SurchargeKind" NOT NULL,
    "method" "SurchargeMethod" NOT NULL,
    "value" DECIMAL(14,4) NOT NULL,
    "optional" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "rate_surcharges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "customer_id" UUID,
    "rate_card_id" UUID NOT NULL,
    "input" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_objects" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "owner_type" "FileOwnerType" NOT NULL,
    "owner_id" UUID NOT NULL,
    "kind" "FileKind" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploaded_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_objects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "package_categories_company_id_code_key" ON "package_categories"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "package_categories_id_company_id_key" ON "package_categories"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "package_groups_company_id_reference_key" ON "package_groups"("company_id", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "package_groups_id_company_id_key" ON "package_groups"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "packages_tracking_number_key" ON "packages"("tracking_number");

-- CreateIndex
CREATE INDEX "packages_company_id_status_idx" ON "packages"("company_id", "status");

-- CreateIndex
CREATE INDEX "packages_company_id_customer_id_idx" ON "packages"("company_id", "customer_id");

-- CreateIndex
CREATE INDEX "packages_company_id_supplier_tracking_idx" ON "packages"("company_id", "supplier_tracking");

-- CreateIndex
CREATE INDEX "packages_company_id_origin_warehouse_id_status_idx" ON "packages"("company_id", "origin_warehouse_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "packages_id_company_id_key" ON "packages"("id", "company_id");

-- CreateIndex
CREATE INDEX "package_events_package_id_occurred_at_idx" ON "package_events"("package_id", "occurred_at");

-- CreateIndex
CREATE INDEX "package_events_package_id_txid_idx" ON "package_events"("package_id", "txid");

-- CreateIndex
CREATE INDEX "package_holds_package_id_idx" ON "package_holds"("package_id");

-- CreateIndex
CREATE UNIQUE INDEX "prealerts_package_id_key" ON "prealerts"("package_id");

-- CreateIndex
CREATE INDEX "prealerts_company_id_customer_id_status_idx" ON "prealerts"("company_id", "customer_id", "status");

-- CreateIndex
CREATE INDEX "prealerts_company_id_supplier_tracking_idx" ON "prealerts"("company_id", "supplier_tracking");

-- CreateIndex
CREATE UNIQUE INDEX "prealerts_package_id_company_id_key" ON "prealerts"("package_id", "company_id");

-- CreateIndex
CREATE INDEX "rate_cards_company_id_status_transport_mode_origin_country__idx" ON "rate_cards"("company_id", "status", "transport_mode", "origin_country", "destination_country");

-- CreateIndex
CREATE UNIQUE INDEX "rate_cards_id_company_id_key" ON "rate_cards"("id", "company_id");

-- CreateIndex
CREATE INDEX "rate_rules_rate_card_id_idx" ON "rate_rules"("rate_card_id");

-- CreateIndex
CREATE UNIQUE INDEX "rate_surcharges_rate_card_id_code_key" ON "rate_surcharges"("rate_card_id", "code");

-- CreateIndex
CREATE INDEX "quotes_company_id_customer_id_created_at_idx" ON "quotes"("company_id", "customer_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "file_objects_storage_key_key" ON "file_objects"("storage_key");

-- CreateIndex
CREATE INDEX "file_objects_company_id_owner_type_owner_id_idx" ON "file_objects"("company_id", "owner_type", "owner_id");

-- AddForeignKey
ALTER TABLE "package_categories" ADD CONSTRAINT "package_categories_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_groups" ADD CONSTRAINT "package_groups_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_groups" ADD CONSTRAINT "package_groups_customer_id_company_id_fkey" FOREIGN KEY ("customer_id", "company_id") REFERENCES "customers"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_customer_id_company_id_fkey" FOREIGN KEY ("customer_id", "company_id") REFERENCES "customers"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_origin_warehouse_id_company_id_fkey" FOREIGN KEY ("origin_warehouse_id", "company_id") REFERENCES "warehouses"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_category_id_company_id_fkey" FOREIGN KEY ("category_id", "company_id") REFERENCES "package_categories"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_group_id_company_id_fkey" FOREIGN KEY ("group_id", "company_id") REFERENCES "package_groups"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_events" ADD CONSTRAINT "package_events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_events" ADD CONSTRAINT "package_events_package_id_company_id_fkey" FOREIGN KEY ("package_id", "company_id") REFERENCES "packages"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_holds" ADD CONSTRAINT "package_holds_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_holds" ADD CONSTRAINT "package_holds_package_id_company_id_fkey" FOREIGN KEY ("package_id", "company_id") REFERENCES "packages"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prealerts" ADD CONSTRAINT "prealerts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prealerts" ADD CONSTRAINT "prealerts_customer_id_company_id_fkey" FOREIGN KEY ("customer_id", "company_id") REFERENCES "customers"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prealerts" ADD CONSTRAINT "prealerts_package_id_company_id_fkey" FOREIGN KEY ("package_id", "company_id") REFERENCES "packages"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prealerts" ADD CONSTRAINT "prealerts_warehouse_id_company_id_fkey" FOREIGN KEY ("warehouse_id", "company_id") REFERENCES "warehouses"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_cards" ADD CONSTRAINT "rate_cards_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_rules" ADD CONSTRAINT "rate_rules_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_rules" ADD CONSTRAINT "rate_rules_rate_card_id_company_id_fkey" FOREIGN KEY ("rate_card_id", "company_id") REFERENCES "rate_cards"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_rules" ADD CONSTRAINT "rate_rules_category_id_company_id_fkey" FOREIGN KEY ("category_id", "company_id") REFERENCES "package_categories"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_surcharges" ADD CONSTRAINT "rate_surcharges_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_surcharges" ADD CONSTRAINT "rate_surcharges_rate_card_id_company_id_fkey" FOREIGN KEY ("rate_card_id", "company_id") REFERENCES "rate_cards"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_customer_id_company_id_fkey" FOREIGN KEY ("customer_id", "company_id") REFERENCES "customers"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_rate_card_id_company_id_fkey" FOREIGN KEY ("rate_card_id", "company_id") REFERENCES "rate_cards"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_objects" ADD CONSTRAINT "file_objects_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =====================================================================================
-- Partie écrite à la main : contraintes, exclusions, déclencheurs, RLS, droits, recherche publique.
-- =====================================================================================

-- Contraintes d'exclusion sur des intervalles (grilles actives, tranches de poids)
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- -------------------------------------------------------------------------------------
-- Catégories et colis
-- -------------------------------------------------------------------------------------
ALTER TABLE package_categories ADD CONSTRAINT package_categories_code_format
  CHECK (code ~ '^[A-Z0-9_]{2,40}$');

ALTER TABLE packages ADD CONSTRAINT packages_tracking_format
  CHECK (tracking_number ~ '^[A-Z]{2,4}[0-9A-HJKMNP-TV-Z]{11}$');
ALTER TABLE packages ADD CONSTRAINT packages_countries_iso
  CHECK (origin_country ~ '^[A-Z]{2}$' AND destination_country ~ '^[A-Z]{2}$');
ALTER TABLE packages ADD CONSTRAINT packages_supplier_tracking_normalized
  CHECK (supplier_tracking IS NULL OR supplier_tracking = upper(supplier_tracking));
ALTER TABLE packages ADD CONSTRAINT packages_measures_positive CHECK (
  (actual_weight_kg IS NULL OR actual_weight_kg > 0)
  AND (length_cm IS NULL OR length_cm > 0) AND (width_cm IS NULL OR width_cm > 0) AND (height_cm IS NULL OR height_cm > 0)
  AND (declared_value IS NULL OR declared_value > 0)
  AND (shipping_fee IS NULL OR shipping_fee >= 0) AND (extra_fees IS NULL OR extra_fees >= 0)
);
-- Règles I12 et I14 : au-delà de l'inspection, le colis a ses mesures et un client
ALTER TABLE packages ADD CONSTRAINT packages_advanced_status_needs_data CHECK (
  status NOT IN ('REGISTERED_WEIGHED', 'AWAITING_PAYMENT', 'READY_TO_SHIP', 'IN_TRANSIT', 'ARRIVED_DESTINATION',
                 'IN_CUSTOMS', 'RECEIVED_AT_AGENCY', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'DELIVERED')
  OR (customer_id IS NOT NULL AND actual_weight_kg IS NOT NULL AND length_cm IS NOT NULL
      AND width_cm IS NOT NULL AND height_cm IS NOT NULL)
);
-- Un colis non identifié ne peut pas être attendu : la préalerte appartient à un client
ALTER TABLE packages ADD CONSTRAINT packages_expected_needs_customer CHECK (
  status NOT IN ('PREALERT_CREATED', 'AWAITING_RECEIPT') OR customer_id IS NOT NULL
);

ALTER TABLE prealerts ADD CONSTRAINT prealerts_amount_positive CHECK (purchase_amount > 0);
ALTER TABLE prealerts ADD CONSTRAINT prealerts_currency CHECK (purchase_currency IN ('USD', 'HTG', 'EUR'));
ALTER TABLE prealerts ADD CONSTRAINT prealerts_supplier_tracking_normalized
  CHECK (supplier_tracking IS NULL OR supplier_tracking = upper(supplier_tracking));

-- -------------------------------------------------------------------------------------
-- Tarification
-- -------------------------------------------------------------------------------------
ALTER TABLE rate_cards ADD CONSTRAINT rate_cards_values CHECK (
  volumetric_divisor > 0 AND min_billable_weight >= 0 AND rounding_step > 0
  AND (valid_to IS NULL OR valid_to > valid_from)
  AND origin_country ~ '^[A-Z]{2}$' AND destination_country ~ '^[A-Z]{2}$'
  AND currency IN ('USD', 'HTG', 'EUR')
);
-- Deux grilles ACTIVES ne couvrent jamais la même période pour le même couloir et le même mode
ALTER TABLE rate_cards ADD CONSTRAINT rate_cards_no_active_overlap EXCLUDE USING gist (
  company_id WITH =, transport_mode WITH =, origin_country WITH =, destination_country WITH =,
  daterange(valid_from, valid_to, '[)') WITH &&
) WHERE (status = 'ACTIVE');

ALTER TABLE rate_rules ADD CONSTRAINT rate_rules_values CHECK (
  weight_from >= 0 AND (weight_to IS NULL OR weight_to > weight_from)
  AND price_per_unit >= 0 AND flat_fee >= 0 AND min_charge >= 0
);
-- Tranches de poids sans chevauchement, par grille et par catégorie
ALTER TABLE rate_rules ADD CONSTRAINT rate_rules_no_overlap EXCLUDE USING gist (
  rate_card_id WITH =,
  (COALESCE(category_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
  numrange(weight_from, weight_to, '[)') WITH &&
);
ALTER TABLE rate_surcharges ADD CONSTRAINT rate_surcharges_values
  CHECK (value >= 0 AND code ~ '^[A-Z0-9_]{2,30}$');

-- -------------------------------------------------------------------------------------
-- Fichiers : le contenu est vérifié par l'application, la base garde les invariants
-- -------------------------------------------------------------------------------------
ALTER TABLE file_objects ADD CONSTRAINT file_objects_values CHECK (
  size_bytes BETWEEN 1 AND 8388608
  AND mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
  AND char_length(sha256) = 64
  AND storage_key LIKE 'companies/' || company_id::text || '/%'
  AND storage_key !~ '\.\.'
);

-- -------------------------------------------------------------------------------------
-- Déclencheurs
-- -------------------------------------------------------------------------------------

-- Historique des colis en ajout seul
CREATE FUNCTION package_events_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'package_events est en ajout seul' USING ERRCODE = '42501';
END
$$;
CREATE TRIGGER package_events_no_update_delete
  BEFORE UPDATE OR DELETE ON package_events
  FOR EACH ROW EXECUTE FUNCTION package_events_immutable();

-- Tout changement de statut (et toute création) doit laisser un événement dans la MÊME transaction.
-- Contrôle différé : il s'exécute au COMMIT, une fois l'ensemble des écritures faites.
CREATE FUNCTION packages_require_event() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT EXISTS (
      SELECT 1 FROM package_events e
      WHERE e.package_id = NEW.id AND e.to_status = NEW.status AND e.txid = txid_current()
    ) THEN
      RAISE EXCEPTION 'Statut du colis % modifié sans événement dans la même transaction', NEW.id
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER packages_status_needs_event
  AFTER INSERT OR UPDATE OF status ON packages
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION packages_require_event();

-- Une grille ACTIVE est immuable : seuls son statut (→ RETIRED) et sa date de fin peuvent changer ; RETIRED ne change plus.
CREATE FUNCTION rate_cards_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'Seule une grille en brouillon peut être supprimée' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'RETIRED' THEN
    RAISE EXCEPTION 'Une grille retirée est immuable' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'ACTIVE' THEN
    IF (NEW.name, NEW.transport_mode, NEW.origin_country, NEW.destination_country, NEW.currency, NEW.weight_unit,
        NEW.dimension_unit, NEW.volumetric_divisor, NEW.min_billable_weight, NEW.rounding_mode, NEW.rounding_step,
        NEW.valid_from, NEW.version)
       IS DISTINCT FROM
       (OLD.name, OLD.transport_mode, OLD.origin_country, OLD.destination_country, OLD.currency, OLD.weight_unit,
        OLD.dimension_unit, OLD.volumetric_divisor, OLD.min_billable_weight, OLD.rounding_mode, OLD.rounding_step,
        OLD.valid_from, OLD.version)
       OR NEW.status = 'DRAFT' THEN
      RAISE EXCEPTION 'Une grille active est immuable : créer une nouvelle grille' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER rate_cards_immutable
  BEFORE UPDATE OR DELETE ON rate_cards
  FOR EACH ROW EXECUTE FUNCTION rate_cards_guard();

-- Règles et suppléments : modifiables seulement tant que la grille est en brouillon
CREATE FUNCTION rate_children_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  card_status "RateCardStatus";
BEGIN
  SELECT status INTO card_status FROM rate_cards WHERE id = COALESCE(NEW.rate_card_id, OLD.rate_card_id);
  IF card_status IS NOT NULL AND card_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Les règles d''une grille non brouillon sont immuables' USING ERRCODE = '23514';
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$$;
CREATE TRIGGER rate_rules_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON rate_rules
  FOR EACH ROW EXECUTE FUNCTION rate_children_guard();
CREATE TRIGGER rate_surcharges_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON rate_surcharges
  FOR EACH ROW EXECUTE FUNCTION rate_children_guard();

-- -------------------------------------------------------------------------------------
-- Recherche publique par numéro de suivi (le suivi public ne connaît pas l'entreprise)
-- Ne renvoie que l'identifiant de l'entreprise ; le numéro, à 50 bits aléatoires, joue le rôle de secret.
-- SECURITY DEFINER : s'exécute avec les droits du propriétaire (qui contourne la RLS).
-- Le propriétaire doit donc être superutilisateur ou posséder BYPASSRLS.
-- -------------------------------------------------------------------------------------
CREATE FUNCTION app_package_company(p_tracking text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT company_id FROM packages WHERE tracking_number = p_tracking
$$;
REVOKE ALL ON FUNCTION app_package_company(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_package_company(text) TO b2c_app;

-- -------------------------------------------------------------------------------------
-- Row-Level Security : activée et forcée
-- -------------------------------------------------------------------------------------
ALTER TABLE package_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE package_groups     ENABLE ROW LEVEL SECURITY;
ALTER TABLE packages           ENABLE ROW LEVEL SECURITY;
ALTER TABLE package_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE package_holds      ENABLE ROW LEVEL SECURITY;
ALTER TABLE prealerts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_cards         ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_rules         ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_surcharges    ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes             ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_objects       ENABLE ROW LEVEL SECURITY;

ALTER TABLE package_categories FORCE ROW LEVEL SECURITY;
ALTER TABLE package_groups     FORCE ROW LEVEL SECURITY;
ALTER TABLE packages           FORCE ROW LEVEL SECURITY;
ALTER TABLE package_events     FORCE ROW LEVEL SECURITY;
ALTER TABLE package_holds      FORCE ROW LEVEL SECURITY;
ALTER TABLE prealerts          FORCE ROW LEVEL SECURITY;
ALTER TABLE rate_cards         FORCE ROW LEVEL SECURITY;
ALTER TABLE rate_rules         FORCE ROW LEVEL SECURITY;
ALTER TABLE rate_surcharges    FORCE ROW LEVEL SECURITY;
ALTER TABLE quotes             FORCE ROW LEVEL SECURITY;
ALTER TABLE file_objects       FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON package_categories USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_isolation ON package_groups     USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_isolation ON packages           USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_isolation ON package_events     USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_isolation ON package_holds      USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_isolation ON prealerts          USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_isolation ON rate_cards         USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_isolation ON rate_rules         USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_isolation ON rate_surcharges    USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_isolation ON quotes             USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_isolation ON file_objects       USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

-- -------------------------------------------------------------------------------------
-- Droits du rôle applicatif, au plus juste (historique et devis : jamais modifiés)
-- -------------------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON package_categories TO b2c_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON package_groups TO b2c_app;
GRANT SELECT, INSERT, UPDATE ON packages TO b2c_app;
GRANT SELECT, INSERT ON package_events TO b2c_app;
GRANT SELECT, INSERT, UPDATE ON package_holds TO b2c_app;
GRANT SELECT, INSERT, UPDATE ON prealerts TO b2c_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON rate_cards TO b2c_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON rate_rules TO b2c_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON rate_surcharges TO b2c_app;
GRANT SELECT, INSERT ON quotes TO b2c_app;
GRANT SELECT, INSERT, DELETE ON file_objects TO b2c_app;
