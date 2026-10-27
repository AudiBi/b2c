-- CreateEnum
CREATE TYPE "LocationKind" AS ENUM ('ZONE', 'SHELF', 'BIN');

-- CreateEnum
CREATE TYPE "MovementKind" AS ENUM ('IN', 'MOVE', 'OUT');

-- CreateEnum
CREATE TYPE "AgencyKind" AS ENUM ('AGENCY', 'PICKUP_POINT');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('OPEN', 'DISPATCHED', 'ARRIVED', 'IN_CUSTOMS', 'CLOSED', 'CANCELLED');

-- AlterTable
ALTER TABLE "packages" ADD COLUMN     "destination_agency_id" UUID,
ADD COLUMN     "location_id" UUID;

-- CreateTable
CREATE TABLE "warehouse_locations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "LocationKind" NOT NULL DEFAULT 'SHELF',
    "status" "WarehouseStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warehouse_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouse_movements" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "from_location_id" UUID,
    "to_location_id" UUID,
    "kind" "MovementKind" NOT NULL,
    "actor_user_id" UUID,
    "note" TEXT,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warehouse_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agencies" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "AgencyKind" NOT NULL DEFAULT 'AGENCY',
    "country" CHAR(2) NOT NULL,
    "city" TEXT NOT NULL,
    "address_line" TEXT NOT NULL,
    "phone" TEXT,
    "hours" TEXT,
    "public_visible" BOOLEAN NOT NULL DEFAULT true,
    "status" "WarehouseStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "agencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "transport_mode" "TransportMode" NOT NULL,
    "origin_warehouse_id" UUID NOT NULL,
    "destination_country" CHAR(2) NOT NULL,
    "destination_city" TEXT,
    "destination_agency_id" UUID,
    "carrier_name" TEXT,
    "transport_ref" TEXT,
    "notes" TEXT,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'OPEN',
    "departed_at" TIMESTAMPTZ(6),
    "arrived_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_packages" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "loaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "loaded_by" UUID,
    "removed_at" TIMESTAMPTZ(6),
    "removed_by" UUID,

    CONSTRAINT "shipment_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_events" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "from_status" "ShipmentStatus",
    "to_status" "ShipmentStatus",
    "actor_user_id" UUID,
    "note" TEXT,
    "data" JSONB,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_locations_warehouse_id_code_key" ON "warehouse_locations"("warehouse_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_locations_id_company_id_key" ON "warehouse_locations"("id", "company_id");

-- CreateIndex
CREATE INDEX "warehouse_movements_company_id_package_id_occurred_at_idx" ON "warehouse_movements"("company_id", "package_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "agencies_company_id_code_key" ON "agencies"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "agencies_id_company_id_key" ON "agencies"("id", "company_id");

-- CreateIndex
CREATE INDEX "shipments_company_id_status_idx" ON "shipments"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_company_id_reference_key" ON "shipments"("company_id", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_id_company_id_key" ON "shipments"("id", "company_id");

-- CreateIndex
CREATE INDEX "shipment_packages_company_id_shipment_id_idx" ON "shipment_packages"("company_id", "shipment_id");

-- CreateIndex
CREATE INDEX "shipment_packages_company_id_package_id_idx" ON "shipment_packages"("company_id", "package_id");

-- CreateIndex
CREATE INDEX "shipment_events_company_id_shipment_id_occurred_at_idx" ON "shipment_events"("company_id", "shipment_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_location_id_company_id_fkey" FOREIGN KEY ("location_id", "company_id") REFERENCES "warehouse_locations"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_destination_agency_id_company_id_fkey" FOREIGN KEY ("destination_agency_id", "company_id") REFERENCES "agencies"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_locations" ADD CONSTRAINT "warehouse_locations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_locations" ADD CONSTRAINT "warehouse_locations_warehouse_id_company_id_fkey" FOREIGN KEY ("warehouse_id", "company_id") REFERENCES "warehouses"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_movements" ADD CONSTRAINT "warehouse_movements_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_movements" ADD CONSTRAINT "warehouse_movements_package_id_company_id_fkey" FOREIGN KEY ("package_id", "company_id") REFERENCES "packages"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_movements" ADD CONSTRAINT "warehouse_movements_from_location_id_company_id_fkey" FOREIGN KEY ("from_location_id", "company_id") REFERENCES "warehouse_locations"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_movements" ADD CONSTRAINT "warehouse_movements_to_location_id_company_id_fkey" FOREIGN KEY ("to_location_id", "company_id") REFERENCES "warehouse_locations"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agencies" ADD CONSTRAINT "agencies_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_origin_warehouse_id_company_id_fkey" FOREIGN KEY ("origin_warehouse_id", "company_id") REFERENCES "warehouses"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_destination_agency_id_company_id_fkey" FOREIGN KEY ("destination_agency_id", "company_id") REFERENCES "agencies"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_packages" ADD CONSTRAINT "shipment_packages_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_packages" ADD CONSTRAINT "shipment_packages_shipment_id_company_id_fkey" FOREIGN KEY ("shipment_id", "company_id") REFERENCES "shipments"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_packages" ADD CONSTRAINT "shipment_packages_package_id_company_id_fkey" FOREIGN KEY ("package_id", "company_id") REFERENCES "packages"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_shipment_id_company_id_fkey" FOREIGN KEY ("shipment_id", "company_id") REFERENCES "shipments"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =====================================================================================
-- Compléments écrits à la main (Prisma ne modélise ni CHECK, ni déclencheurs, ni RLS, ni droits)
-- =====================================================================================

ALTER TABLE warehouse_locations ADD CONSTRAINT warehouse_locations_code_format CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$');

ALTER TABLE agencies ADD CONSTRAINT agencies_values CHECK (
  country ~ '^[A-Z]{2}$' AND code ~ '^[A-Z0-9][A-Z0-9-]{1,19}$' AND length(name) BETWEEN 1 AND 120
);

ALTER TABLE shipments ADD CONSTRAINT shipments_dates CHECK (
  (status = 'OPEN' AND departed_at IS NULL AND arrived_at IS NULL)
  OR status = 'CANCELLED'
  OR (status IN ('DISPATCHED') AND departed_at IS NOT NULL AND arrived_at IS NULL)
  OR (status IN ('ARRIVED', 'IN_CUSTOMS', 'CLOSED') AND departed_at IS NOT NULL AND arrived_at IS NOT NULL AND arrived_at >= departed_at)
);
ALTER TABLE shipments ADD CONSTRAINT shipments_country CHECK (destination_country ~ '^[A-Z]{2}$');

-- I13 : un colis n'est dans qu'UN lot à la fois (les lignes retirées restent pour l'historique)
CREATE UNIQUE INDEX shipment_packages_one_active ON shipment_packages (package_id) WHERE removed_at IS NULL;

-- Un colis ne peut être rangé que dans un emplacement de SON entrepôt d'origine
CREATE FUNCTION packages_location_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM warehouse_locations l WHERE l.id = NEW.location_id AND l.warehouse_id = NEW.origin_warehouse_id
  ) THEN
    RAISE EXCEPTION 'Emplacement d''un autre entrepôt' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER packages_location_check
  BEFORE INSERT OR UPDATE OF location_id, origin_warehouse_id ON packages
  FOR EACH ROW EXECUTE FUNCTION packages_location_guard();

-- On ne charge ni ne retire un colis que sur un lot OUVERT
CREATE FUNCTION shipment_packages_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  current_status "ShipmentStatus";
BEGIN
  SELECT status INTO current_status FROM shipments WHERE id = NEW.shipment_id;
  IF current_status IS DISTINCT FROM 'OPEN' THEN
    RAISE EXCEPTION 'Le lot n''est plus ouvert : chargement et retrait impossibles' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.package_id <> OLD.package_id OR NEW.shipment_id <> OLD.shipment_id OR NEW.loaded_at <> OLD.loaded_at OR OLD.removed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Une ligne de chargement ne change que par son retrait' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER shipment_packages_open_only
  BEFORE INSERT OR UPDATE ON shipment_packages
  FOR EACH ROW EXECUTE FUNCTION shipment_packages_guard();

-- Historiques en ajout seul
CREATE FUNCTION logistics_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% est en ajout seul', TG_TABLE_NAME USING ERRCODE = '42501';
END
$$;
CREATE TRIGGER shipment_events_append_only BEFORE UPDATE OR DELETE ON shipment_events
  FOR EACH ROW EXECUTE FUNCTION logistics_append_only();
CREATE TRIGGER warehouse_movements_append_only BEFORE UPDATE OR DELETE ON warehouse_movements
  FOR EACH ROW EXECUTE FUNCTION logistics_append_only();

-- Row-Level Security : activée et forcée
ALTER TABLE warehouse_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE agencies            ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipment_packages   ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipment_events     ENABLE ROW LEVEL SECURITY;

ALTER TABLE warehouse_locations FORCE ROW LEVEL SECURITY;
ALTER TABLE warehouse_movements FORCE ROW LEVEL SECURITY;
ALTER TABLE agencies            FORCE ROW LEVEL SECURITY;
ALTER TABLE shipments           FORCE ROW LEVEL SECURITY;
ALTER TABLE shipment_packages   FORCE ROW LEVEL SECURITY;
ALTER TABLE shipment_events     FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON warehouse_locations USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_isolation ON warehouse_movements USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_isolation ON agencies            USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_isolation ON shipments           USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_isolation ON shipment_packages   USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_isolation ON shipment_events     USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

-- Droits du rôle applicatif, au plus juste (historiques : jamais modifiés ; lignes de chargement : jamais supprimées)
GRANT SELECT, INSERT, UPDATE ON warehouse_locations TO b2c_app;
GRANT SELECT, INSERT ON warehouse_movements TO b2c_app;
GRANT SELECT, INSERT, UPDATE ON agencies TO b2c_app;
GRANT SELECT, INSERT, UPDATE ON shipments TO b2c_app;
GRANT SELECT, INSERT, UPDATE ON shipment_packages TO b2c_app;
GRANT SELECT, INSERT ON shipment_events TO b2c_app;
