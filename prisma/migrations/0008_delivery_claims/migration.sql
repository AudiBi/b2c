-- CreateEnum
CREATE TYPE "RouteStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StopStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED', 'REMOVED');

-- CreateEnum
CREATE TYPE "DeliveryChannel" AS ENUM ('ROUTE', 'AGENCY');

-- CreateEnum
CREATE TYPE "AttemptOutcome" AS ENUM ('SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "RecipientKind" AS ENUM ('CUSTOMER', 'BENEFICIARY');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ClaimCategory" AS ENUM ('DAMAGED', 'LOST', 'DELAYED', 'BILLING', 'SERVICE', 'OTHER');

-- CreateEnum
CREATE TYPE "ClaimAuthorKind" AS ENUM ('CUSTOMER', 'STAFF');

-- CreateTable
CREATE TABLE "routes" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "agency_id" UUID NOT NULL,
    "driver_user_id" UUID NOT NULL,
    "planned_date" DATE NOT NULL,
    "status" "RouteStatus" NOT NULL DEFAULT 'PLANNED',
    "notes" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_stops" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "StopStatus" NOT NULL DEFAULT 'PENDING',
    "address_snapshot" JSONB NOT NULL,
    "instructions" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "route_stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_attempts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "route_stop_id" UUID,
    "channel" "DeliveryChannel" NOT NULL,
    "outcome" "AttemptOutcome" NOT NULL,
    "failure_reason" TEXT,
    "note" TEXT,
    "reschedule_for" DATE,
    "recipient_kind" "RecipientKind",
    "recipient_name" TEXT,
    "beneficiary_id" UUID,
    "id_document_type" TEXT,
    "id_document_last4" TEXT,
    "otp_verified" BOOLEAN NOT NULL DEFAULT false,
    "balance_overridden" BOOLEAN NOT NULL DEFAULT false,
    "override_reason" TEXT,
    "proof_file_id" UUID,
    "actor_user_id" UUID,
    "attempted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "handover_codes" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "used_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "handover_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claims" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "customer_id" UUID NOT NULL,
    "package_id" UUID,
    "category" "ClaimCategory" NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'OPEN',
    "assigned_to" UUID,
    "resolution" TEXT,
    "opened_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claim_messages" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "claim_id" UUID NOT NULL,
    "author_kind" "ClaimAuthorKind" NOT NULL,
    "author_user_id" UUID,
    "body" TEXT NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claim_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "routes_company_id_driver_user_id_planned_date_idx" ON "routes"("company_id", "driver_user_id", "planned_date");

-- CreateIndex
CREATE INDEX "routes_company_id_agency_id_status_idx" ON "routes"("company_id", "agency_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "routes_company_id_reference_key" ON "routes"("company_id", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "routes_id_company_id_key" ON "routes"("id", "company_id");

-- CreateIndex
CREATE INDEX "route_stops_company_id_route_id_sequence_idx" ON "route_stops"("company_id", "route_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "route_stops_route_id_package_id_key" ON "route_stops"("route_id", "package_id");

-- CreateIndex
CREATE UNIQUE INDEX "route_stops_id_company_id_key" ON "route_stops"("id", "company_id");

-- CreateIndex
CREATE INDEX "delivery_attempts_company_id_package_id_attempted_at_idx" ON "delivery_attempts"("company_id", "package_id", "attempted_at");

-- CreateIndex
CREATE INDEX "delivery_attempts_company_id_actor_user_id_attempted_at_idx" ON "delivery_attempts"("company_id", "actor_user_id", "attempted_at");

-- CreateIndex
CREATE INDEX "handover_codes_company_id_package_id_idx" ON "handover_codes"("company_id", "package_id");

-- CreateIndex
CREATE INDEX "claims_company_id_status_idx" ON "claims"("company_id", "status");

-- CreateIndex
CREATE INDEX "claims_company_id_customer_id_idx" ON "claims"("company_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "claims_company_id_number_key" ON "claims"("company_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "claims_id_company_id_key" ON "claims"("id", "company_id");

-- CreateIndex
CREATE INDEX "claim_messages_company_id_claim_id_created_at_idx" ON "claim_messages"("company_id", "claim_id", "created_at");

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_agency_id_company_id_fkey" FOREIGN KEY ("agency_id", "company_id") REFERENCES "agencies"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_driver_user_id_company_id_fkey" FOREIGN KEY ("driver_user_id", "company_id") REFERENCES "users"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_route_id_company_id_fkey" FOREIGN KEY ("route_id", "company_id") REFERENCES "routes"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_package_id_company_id_fkey" FOREIGN KEY ("package_id", "company_id") REFERENCES "packages"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_customer_id_company_id_fkey" FOREIGN KEY ("customer_id", "company_id") REFERENCES "customers"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_package_id_company_id_fkey" FOREIGN KEY ("package_id", "company_id") REFERENCES "packages"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handover_codes" ADD CONSTRAINT "handover_codes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handover_codes" ADD CONSTRAINT "handover_codes_package_id_company_id_fkey" FOREIGN KEY ("package_id", "company_id") REFERENCES "packages"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handover_codes" ADD CONSTRAINT "handover_codes_customer_id_company_id_fkey" FOREIGN KEY ("customer_id", "company_id") REFERENCES "customers"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_customer_id_company_id_fkey" FOREIGN KEY ("customer_id", "company_id") REFERENCES "customers"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_package_id_company_id_fkey" FOREIGN KEY ("package_id", "company_id") REFERENCES "packages"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_assigned_to_company_id_fkey" FOREIGN KEY ("assigned_to", "company_id") REFERENCES "users"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_messages" ADD CONSTRAINT "claim_messages_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_messages" ADD CONSTRAINT "claim_messages_claim_id_company_id_fkey" FOREIGN KEY ("claim_id", "company_id") REFERENCES "claims"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- =====================================================================================
-- Compléments écrits à la main (CHECK, index partiels, déclencheurs, RLS, droits)
-- =====================================================================================

-- ---------- Tournées ----------
ALTER TABLE routes ADD CONSTRAINT routes_dates CHECK (
  (status = 'COMPLETED') = (completed_at IS NOT NULL)
  AND (status IN ('PLANNED', 'CANCELLED') OR started_at IS NOT NULL)
);
ALTER TABLE route_stops ADD CONSTRAINT route_stops_sequence_positive CHECK (sequence > 0);
-- DEL-04 / I12 : un colis n'est que sur UN arrêt en attente à la fois (entre tournées aussi)
CREATE UNIQUE INDEX route_stops_one_pending_per_package ON route_stops (package_id) WHERE status = 'PENDING';
CREATE UNIQUE INDEX route_stops_sequence_unique ON route_stops (route_id, sequence);

-- Cycle de vie : PLANNED → IN_PROGRESS → COMPLETED, ou PLANNED → CANCELLED ; une tournée close ne change plus
CREATE FUNCTION routes_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Une tournée ne se supprime pas' USING ERRCODE = '42501';
  END IF;
  IF OLD.status IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Une tournée terminée ou annulée ne change plus' USING ERRCODE = '23514';
  END IF;
  IF (NEW.agency_id, NEW.driver_user_id, NEW.reference, NEW.company_id) IS DISTINCT FROM (OLD.agency_id, OLD.driver_user_id, OLD.reference, OLD.company_id) THEN
    RAISE EXCEPTION 'L''agence, le livreur et la référence d''une tournée ne changent pas' USING ERRCODE = '23514';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'PLANNED' AND NEW.status IN ('IN_PROGRESS', 'CANCELLED'))
    OR (OLD.status = 'IN_PROGRESS' AND NEW.status = 'COMPLETED')) THEN
    RAISE EXCEPTION 'Changement d''état de tournée interdit : % -> %', OLD.status, NEW.status USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER routes_lifecycle BEFORE UPDATE OR DELETE ON routes FOR EACH ROW EXECUTE FUNCTION routes_guard();

-- Un arrêt ne s'ajoute qu'à une tournée planifiée ; un arrêt traité (remis, échoué, retiré) ne change plus
CREATE FUNCTION route_stops_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE route_status "RouteStatus";
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT status INTO route_status FROM routes WHERE id = NEW.route_id;
    IF route_status IS DISTINCT FROM 'PLANNED' THEN
      RAISE EXCEPTION 'On n''ajoute un arrêt qu''à une tournée planifiée' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Un arrêt ne se supprime pas (il passe à REMOVED)' USING ERRCODE = '42501';
  END IF;
  IF OLD.status <> 'PENDING' THEN
    RAISE EXCEPTION 'Un arrêt traité ne change plus' USING ERRCODE = '23514';
  END IF;
  IF (NEW.route_id, NEW.package_id, NEW.customer_id, NEW.sequence) IS DISTINCT FROM (OLD.route_id, OLD.package_id, OLD.customer_id, OLD.sequence) THEN
    RAISE EXCEPTION 'Un arrêt ne change ni de tournée, ni de colis, ni de rang' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER route_stops_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON route_stops FOR EACH ROW EXECUTE FUNCTION route_stops_guard();

-- ---------- Tentatives de remise : ajout seul, preuves cohérentes ----------
ALTER TABLE delivery_attempts ADD CONSTRAINT delivery_attempts_proof CHECK (
  ((outcome = 'SUCCEEDED') AND recipient_name IS NOT NULL AND recipient_kind IS NOT NULL AND failure_reason IS NULL)
  OR ((outcome = 'FAILED') AND failure_reason IS NOT NULL)
);
ALTER TABLE delivery_attempts ADD CONSTRAINT delivery_attempts_override CHECK (NOT balance_overridden OR (override_reason IS NOT NULL AND length(override_reason) > 0));
ALTER TABLE delivery_attempts ADD CONSTRAINT delivery_attempts_last4 CHECK (id_document_last4 IS NULL OR length(id_document_last4) = 4);
CREATE TRIGGER delivery_attempts_append_only BEFORE UPDATE OR DELETE ON delivery_attempts FOR EACH ROW EXECUTE FUNCTION finance_append_only();

-- ---------- Codes de remise ----------
ALTER TABLE handover_codes ADD CONSTRAINT handover_codes_values CHECK (failed_attempts >= 0 AND length(code_hash) = 64);
-- Un seul code actif (ni utilisé, ni remplacé) par colis
CREATE UNIQUE INDEX handover_codes_one_active ON handover_codes (package_id) WHERE used_at IS NULL AND revoked_at IS NULL;
CREATE FUNCTION handover_codes_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Un code de remise ne se supprime pas' USING ERRCODE = '42501';
  END IF;
  IF (NEW.package_id, NEW.customer_id, NEW.code_hash, NEW.expires_at, NEW.company_id) IS DISTINCT FROM (OLD.package_id, OLD.customer_id, OLD.code_hash, OLD.expires_at, OLD.company_id) THEN
    RAISE EXCEPTION 'Un code de remise ne se modifie pas : on en génère un nouveau' USING ERRCODE = '23514';
  END IF;
  IF OLD.used_at IS NOT NULL AND (NEW.used_at IS DISTINCT FROM OLD.used_at OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'Un code utilisé ne change plus' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER handover_codes_immutable BEFORE UPDATE OR DELETE ON handover_codes FOR EACH ROW EXECUTE FUNCTION handover_codes_guard();

-- ---------- Réclamations ----------
ALTER TABLE claims ADD CONSTRAINT claims_closed_consistent CHECK (
  ((status IN ('RESOLVED', 'REJECTED')) = (resolved_at IS NOT NULL))
  AND (status NOT IN ('RESOLVED', 'REJECTED') OR (resolution IS NOT NULL AND length(resolution) > 0))
);
ALTER TABLE claims ADD CONSTRAINT claims_subject_length CHECK (length(subject) BETWEEN 1 AND 120);
CREATE FUNCTION claims_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Une réclamation ne se supprime pas' USING ERRCODE = '42501';
  END IF;
  IF (NEW.number, NEW.customer_id, NEW.package_id, NEW.category, NEW.subject, NEW.opened_at, NEW.company_id)
     IS DISTINCT FROM (OLD.number, OLD.customer_id, OLD.package_id, OLD.category, OLD.subject, OLD.opened_at, OLD.company_id) THEN
    RAISE EXCEPTION 'Le numéro, le client, le colis, la catégorie et l''objet d''une réclamation ne changent pas' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER claims_immutable BEFORE UPDATE OR DELETE ON claims FOR EACH ROW EXECUTE FUNCTION claims_guard();
ALTER TABLE claim_messages ADD CONSTRAINT claim_messages_body CHECK (length(body) BETWEEN 1 AND 2000);
CREATE TRIGGER claim_messages_append_only BEFORE UPDATE OR DELETE ON claim_messages FOR EACH ROW EXECUTE FUNCTION finance_append_only();

-- ---------- Isolation des entreprises (RLS activée et forcée) ----------
ALTER TABLE routes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE route_stops       ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE handover_codes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE claims            ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_messages    ENABLE ROW LEVEL SECURITY;

ALTER TABLE routes            FORCE ROW LEVEL SECURITY;
ALTER TABLE route_stops       FORCE ROW LEVEL SECURITY;
ALTER TABLE delivery_attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE handover_codes    FORCE ROW LEVEL SECURITY;
ALTER TABLE claims            FORCE ROW LEVEL SECURITY;
ALTER TABLE claim_messages    FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON routes            USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_isolation ON route_stops       USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_isolation ON delivery_attempts USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_isolation ON handover_codes    USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_isolation ON claims            USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_isolation ON claim_messages    USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

-- ---------- Droits du rôle applicatif, au plus juste ----------
GRANT SELECT, INSERT, UPDATE ON routes TO b2c_app;
GRANT SELECT, INSERT, UPDATE ON route_stops TO b2c_app;
GRANT SELECT, INSERT ON delivery_attempts TO b2c_app;
GRANT SELECT, INSERT, UPDATE ON handover_codes TO b2c_app;
GRANT SELECT, INSERT, UPDATE ON claims TO b2c_app;
GRANT SELECT, INSERT ON claim_messages TO b2c_app;
