-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID', 'CREDITED');

-- CreateEnum
CREATE TYPE "InvoiceLineKind" AS ENUM ('FREIGHT', 'STORAGE', 'HANDLING', 'INSURANCE', 'TAX', 'CUSTOMS', 'DISCOUNT', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'MOBILE_MONEY', 'CARD_ONLINE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED', 'CANCELLED', 'REFUNDED_PARTIAL', 'REFUNDED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'SMS', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "number" TEXT,
    "customer_id" UUID NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" CHAR(3) NOT NULL,
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discount_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credited_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paid_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discount_percent" DECIMAL(5,2),
    "due_date" DATE,
    "notes" TEXT,
    "issued_at" TIMESTAMPTZ(6),
    "voided_at" TIMESTAMPTZ(6),
    "void_reason" TEXT,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "package_id" UUID,
    "kind" "InvoiceLineKind" NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_packages" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,

    CONSTRAINT "invoice_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_notes" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "currency" CHAR(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "provider" TEXT,
    "provider_ref" TEXT,
    "reference" TEXT,
    "confirmed_at" TIMESTAMPTZ(6),
    "recorded_by" UUID,
    "declared_by_customer" BOOLEAN NOT NULL DEFAULT false,
    "agency_id" UUID,
    "cash_session_id" UUID,
    "failure_reason" TEXT,
    "refunded_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "payment_id" UUID NOT NULL,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issued_by" UUID,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_sessions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "agency_id" UUID,
    "opened_by" UUID,
    "opened_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opening_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "closed_at" TIMESTAMPTZ(6),
    "closed_by" UUID,
    "counted_amount" DECIMAL(14,2),
    "expected_amount" DECIMAL(14,2),
    "difference" DECIMAL(14,2),

    CONSTRAINT "cash_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_webhook_events" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "event_code" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "locale" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "event_code" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "customer_id" UUID,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "outbox_event_id" UUID,
    "customer_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "event_code" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "locale" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "skip_reason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "next_attempt_at" TIMESTAMPTZ(6),
    "sent_at" TIMESTAMPTZ(6),
    "read_at" TIMESTAMPTZ(6),
    "dedupe_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoices_company_id_customer_id_idx" ON "invoices"("company_id", "customer_id");

-- CreateIndex
CREATE INDEX "invoices_company_id_status_idx" ON "invoices"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_company_id_number_key" ON "invoices"("company_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_id_company_id_key" ON "invoices"("id", "company_id");

-- CreateIndex
CREATE INDEX "invoice_lines_company_id_invoice_id_idx" ON "invoice_lines"("company_id", "invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_packages_package_id_key" ON "invoice_packages"("package_id");

-- CreateIndex
CREATE INDEX "invoice_packages_company_id_invoice_id_idx" ON "invoice_packages"("company_id", "invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_packages_package_id_company_id_key" ON "invoice_packages"("package_id", "company_id");

-- CreateIndex
CREATE INDEX "credit_notes_company_id_invoice_id_idx" ON "credit_notes"("company_id", "invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_notes_company_id_number_key" ON "credit_notes"("company_id", "number");

-- CreateIndex
CREATE INDEX "payments_company_id_status_idx" ON "payments"("company_id", "status");

-- CreateIndex
CREATE INDEX "payments_company_id_invoice_id_idx" ON "payments"("company_id", "invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_provider_ref_key" ON "payments"("provider", "provider_ref");

-- CreateIndex
CREATE UNIQUE INDEX "payments_company_id_method_reference_key" ON "payments"("company_id", "method", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "payments_id_company_id_key" ON "payments"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_payment_id_key" ON "receipts"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_company_id_number_key" ON "receipts"("company_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_payment_id_company_id_key" ON "receipts"("payment_id", "company_id");

-- CreateIndex
CREATE INDEX "refunds_company_id_payment_id_idx" ON "refunds"("company_id", "payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "cash_sessions_id_company_id_key" ON "cash_sessions"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_webhook_events_company_id_provider_event_id_key" ON "provider_webhook_events"("company_id", "provider", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_company_id_event_code_channel_locale_key" ON "notification_templates"("company_id", "event_code", "channel", "locale");

-- CreateIndex
CREATE INDEX "outbox_events_company_id_processed_at_next_attempt_at_idx" ON "outbox_events"("company_id", "processed_at", "next_attempt_at");

-- CreateIndex
CREATE INDEX "notifications_company_id_customer_id_created_at_idx" ON "notifications"("company_id", "customer_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_status_next_attempt_at_idx" ON "notifications"("status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_company_id_dedupe_key_key" ON "notifications"("company_id", "dedupe_key");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_company_id_fkey" FOREIGN KEY ("customer_id", "company_id") REFERENCES "customers"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_company_id_fkey" FOREIGN KEY ("invoice_id", "company_id") REFERENCES "invoices"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_package_id_company_id_fkey" FOREIGN KEY ("package_id", "company_id") REFERENCES "packages"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_packages" ADD CONSTRAINT "invoice_packages_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_packages" ADD CONSTRAINT "invoice_packages_invoice_id_company_id_fkey" FOREIGN KEY ("invoice_id", "company_id") REFERENCES "invoices"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_packages" ADD CONSTRAINT "invoice_packages_package_id_company_id_fkey" FOREIGN KEY ("package_id", "company_id") REFERENCES "packages"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_id_company_id_fkey" FOREIGN KEY ("invoice_id", "company_id") REFERENCES "invoices"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_company_id_fkey" FOREIGN KEY ("customer_id", "company_id") REFERENCES "customers"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_company_id_fkey" FOREIGN KEY ("invoice_id", "company_id") REFERENCES "invoices"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_agency_id_company_id_fkey" FOREIGN KEY ("agency_id", "company_id") REFERENCES "agencies"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_cash_session_id_company_id_fkey" FOREIGN KEY ("cash_session_id", "company_id") REFERENCES "cash_sessions"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_payment_id_company_id_fkey" FOREIGN KEY ("payment_id", "company_id") REFERENCES "payments"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_company_id_fkey" FOREIGN KEY ("payment_id", "company_id") REFERENCES "payments"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_agency_id_company_id_fkey" FOREIGN KEY ("agency_id", "company_id") REFERENCES "agencies"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_webhook_events" ADD CONSTRAINT "provider_webhook_events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_customer_id_company_id_fkey" FOREIGN KEY ("customer_id", "company_id") REFERENCES "customers"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =====================================================================================
-- Compléments écrits à la main (CHECK, déclencheurs, fonction publique, RLS, droits)
-- =====================================================================================

-- ---------- Factures ----------
ALTER TABLE invoices ADD CONSTRAINT invoices_amounts CHECK (
  subtotal >= 0 AND discount_total >= 0 AND tax_total >= 0 AND total >= 0
  AND total = subtotal - discount_total + tax_total
  AND credited_total >= 0 AND paid_total >= 0
  AND paid_total + credited_total <= total
  AND currency IN ('USD', 'HTG', 'EUR')
  AND (discount_percent IS NULL OR discount_percent BETWEEN 0 AND 100)
);
-- Le numéro n'existe qu'à partir de l'émission (jamais de trou : il est pris dans la transaction d'émission)
ALTER TABLE invoices ADD CONSTRAINT invoices_number_issued CHECK ((status = 'DRAFT') = (number IS NULL) AND (status = 'DRAFT') = (issued_at IS NULL));
ALTER TABLE invoices ADD CONSTRAINT invoices_void_consistent CHECK ((status = 'VOID') = (voided_at IS NOT NULL));

ALTER TABLE invoice_lines ADD CONSTRAINT invoice_lines_values CHECK (
  quantity > 0 AND length(description) BETWEEN 1 AND 200
  AND ((kind = 'DISCOUNT' AND amount <= 0) OR (kind <> 'DISCOUNT' AND amount >= 0))
);
ALTER TABLE credit_notes ADD CONSTRAINT credit_notes_amount CHECK (amount > 0);

-- I22 : une facture émise n'est plus modifiable (une correction passe par un avoir) ; seuls son statut,
-- ses compteurs d'encaissement et d'avoirs, son annulation et ses notes évoluent.
CREATE FUNCTION invoices_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'Une facture émise ne se supprime pas' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'VOID' THEN
    RAISE EXCEPTION 'Une facture annulée ne change plus' USING ERRCODE = '23514';
  END IF;
  IF OLD.status <> 'DRAFT' THEN
    IF (NEW.number, NEW.customer_id, NEW.currency, NEW.subtotal, NEW.discount_total, NEW.tax_total, NEW.total, NEW.issued_at, NEW.discount_percent)
       IS DISTINCT FROM
       (OLD.number, OLD.customer_id, OLD.currency, OLD.subtotal, OLD.discount_total, OLD.tax_total, OLD.total, OLD.issued_at, OLD.discount_percent) THEN
      RAISE EXCEPTION 'Une facture émise est immuable : émettre un avoir' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'DRAFT' THEN
      RAISE EXCEPTION 'Une facture émise ne redevient pas brouillon' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER invoices_immutable BEFORE UPDATE OR DELETE ON invoices FOR EACH ROW EXECUTE FUNCTION invoices_guard();

CREATE FUNCTION invoice_children_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  invoice_status "InvoiceStatus";
BEGIN
  SELECT status INTO invoice_status FROM invoices WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF invoice_status IS NOT NULL AND invoice_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Les lignes d''une facture émise sont immuables' USING ERRCODE = '23514';
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$$;
CREATE TRIGGER invoice_lines_draft_only BEFORE INSERT OR UPDATE OR DELETE ON invoice_lines FOR EACH ROW EXECUTE FUNCTION invoice_children_guard();

-- ---------- Paiements ----------
ALTER TABLE payments ADD CONSTRAINT payments_values CHECK (
  amount > 0 AND refunded_total >= 0 AND refunded_total <= amount
  AND currency IN ('USD', 'HTG', 'EUR')
  AND (status NOT IN ('CONFIRMED', 'REFUNDED_PARTIAL', 'REFUNDED') OR confirmed_at IS NOT NULL)
  AND (method <> 'CASH' OR recorded_by IS NOT NULL)
  AND (status <> 'REFUNDED' OR refunded_total = amount)
);
ALTER TABLE refunds ADD CONSTRAINT refunds_amount CHECK (amount > 0);

-- Un paiement ne change ni de montant, ni de facture, ni de mode ; son statut suit un chemin unique
CREATE FUNCTION payments_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.amount, NEW.invoice_id, NEW.customer_id, NEW.method, NEW.currency) IS DISTINCT FROM (OLD.amount, OLD.invoice_id, OLD.customer_id, OLD.method, OLD.currency) THEN
    RAISE EXCEPTION 'Montant, facture, client et mode d''un paiement sont immuables' USING ERRCODE = '23514';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'PENDING' AND NEW.status IN ('CONFIRMED', 'FAILED', 'CANCELLED'))
    OR (OLD.status = 'CONFIRMED' AND NEW.status IN ('REFUNDED_PARTIAL', 'REFUNDED'))
    OR (OLD.status = 'REFUNDED_PARTIAL' AND NEW.status = 'REFUNDED')
  ) THEN
    RAISE EXCEPTION 'Changement de statut de paiement interdit : % -> %', OLD.status, NEW.status USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER payments_immutable BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION payments_guard();

-- I24 : ce qui est réservé ou encaissé (net des remboursements) ne dépasse jamais le montant dû de la facture
CREATE FUNCTION payments_invoice_cap() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  due numeric;
  taken numeric;
BEGIN
  SELECT total - credited_total INTO due FROM invoices WHERE id = NEW.invoice_id;
  SELECT COALESCE(SUM(amount - refunded_total), 0) INTO taken
    FROM payments WHERE invoice_id = NEW.invoice_id AND status IN ('PENDING', 'CONFIRMED', 'REFUNDED_PARTIAL');
  IF taken > due THEN
    RAISE EXCEPTION 'Les paiements dépassent le montant dû de la facture' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER payments_within_invoice AFTER INSERT OR UPDATE ON payments DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION payments_invoice_cap();

-- ---------- Caisse ----------
CREATE UNIQUE INDEX cash_sessions_one_open ON cash_sessions (company_id, COALESCE(agency_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE closed_at IS NULL;
ALTER TABLE cash_sessions ADD CONSTRAINT cash_sessions_close CHECK (
  (closed_at IS NULL AND counted_amount IS NULL AND expected_amount IS NULL AND difference IS NULL)
  OR (closed_at IS NOT NULL AND counted_amount IS NOT NULL AND expected_amount IS NOT NULL AND difference IS NOT NULL)
);
CREATE FUNCTION cash_sessions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Une caisse clôturée ne change plus' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER cash_sessions_closed_immutable BEFORE UPDATE ON cash_sessions FOR EACH ROW EXECUTE FUNCTION cash_sessions_guard();

-- ---------- Journaux en ajout seul ----------
CREATE FUNCTION finance_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% est en ajout seul', TG_TABLE_NAME USING ERRCODE = '42501';
END
$$;
CREATE TRIGGER credit_notes_append_only BEFORE UPDATE OR DELETE ON credit_notes FOR EACH ROW EXECUTE FUNCTION finance_append_only();
CREATE TRIGGER receipts_append_only BEFORE UPDATE OR DELETE ON receipts FOR EACH ROW EXECUTE FUNCTION finance_append_only();
CREATE TRIGGER refunds_append_only BEFORE UPDATE OR DELETE ON refunds FOR EACH ROW EXECUTE FUNCTION finance_append_only();
CREATE TRIGGER webhook_events_append_only BEFORE UPDATE OR DELETE ON provider_webhook_events FOR EACH ROW EXECUTE FUNCTION finance_append_only();

-- ---------- Notifications ----------
ALTER TABLE notifications ADD CONSTRAINT notifications_values CHECK (
  attempts >= 0 AND (status <> 'SENT' OR sent_at IS NOT NULL) AND (status <> 'SKIPPED' OR skip_reason IS NOT NULL)
);
-- Le contenu d'une notification (destinataire, texte) ne change plus une fois créée : seuls son statut et son suivi évoluent
CREATE FUNCTION notifications_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.customer_id, NEW.user_id, NEW.event_code, NEW.channel, NEW.locale, NEW.subject, NEW.body, NEW.dedupe_key)
     IS DISTINCT FROM (OLD.customer_id, OLD.user_id, OLD.event_code, OLD.channel, OLD.locale, OLD.subject, OLD.body, OLD.dedupe_key) THEN
    RAISE EXCEPTION 'Le contenu d''une notification est immuable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER notifications_immutable BEFORE UPDATE ON notifications FOR EACH ROW EXECUTE FUNCTION notifications_guard();

CREATE FUNCTION outbox_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.event_code, NEW.aggregate_type, NEW.aggregate_id, NEW.customer_id, NEW.payload) IS DISTINCT FROM (OLD.event_code, OLD.aggregate_type, OLD.aggregate_id, OLD.customer_id, OLD.payload) THEN
    RAISE EXCEPTION 'Un événement de l''outbox est immuable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER outbox_immutable BEFORE UPDATE ON outbox_events FOR EACH ROW EXECUTE FUNCTION outbox_guard();

-- Entreprises qui ont du travail de notification à faire : le traitement de fond ne connaît pas d'entreprise à l'avance.
-- SECURITY DEFINER : ne renvoie que des identifiants d'entreprise (propriétaire contournant la RLS, comme app_package_company).
CREATE FUNCTION app_notification_work_companies() RETURNS SETOF uuid
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT company_id FROM outbox_events WHERE processed_at IS NULL AND next_attempt_at <= now()
  UNION
  SELECT company_id FROM notifications WHERE status = 'QUEUED' AND channel = 'EMAIL' AND next_attempt_at <= now()
$$;
GRANT EXECUTE ON FUNCTION app_notification_work_companies() TO b2c_app;

-- ---------- Row-Level Security ----------
ALTER TABLE invoices                ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_lines           ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_packages        ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_notes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments                ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipts                ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_sessions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_templates  ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications           ENABLE ROW LEVEL SECURITY;

ALTER TABLE invoices                FORCE ROW LEVEL SECURITY;
ALTER TABLE invoice_lines           FORCE ROW LEVEL SECURITY;
ALTER TABLE invoice_packages        FORCE ROW LEVEL SECURITY;
ALTER TABLE credit_notes            FORCE ROW LEVEL SECURITY;
ALTER TABLE payments                FORCE ROW LEVEL SECURITY;
ALTER TABLE receipts                FORCE ROW LEVEL SECURITY;
ALTER TABLE refunds                 FORCE ROW LEVEL SECURITY;
ALTER TABLE cash_sessions           FORCE ROW LEVEL SECURITY;
ALTER TABLE provider_webhook_events FORCE ROW LEVEL SECURITY;
ALTER TABLE notification_templates  FORCE ROW LEVEL SECURITY;
ALTER TABLE outbox_events           FORCE ROW LEVEL SECURITY;
ALTER TABLE notifications           FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON invoices                USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_isolation ON invoice_lines           USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_isolation ON invoice_packages        USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_isolation ON credit_notes            USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_isolation ON payments                USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_isolation ON receipts                USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_isolation ON refunds                 USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_isolation ON cash_sessions           USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_isolation ON provider_webhook_events USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_isolation ON notification_templates  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_isolation ON outbox_events           USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_isolation ON notifications           USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());

-- ---------- Droits du rôle applicatif, au plus juste ----------
GRANT SELECT, INSERT, UPDATE, DELETE ON invoices TO b2c_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON invoice_lines TO b2c_app;
GRANT SELECT, INSERT, DELETE ON invoice_packages TO b2c_app;
GRANT SELECT, INSERT ON credit_notes TO b2c_app;
GRANT SELECT, INSERT, UPDATE ON payments TO b2c_app;
GRANT SELECT, INSERT ON receipts TO b2c_app;
GRANT SELECT, INSERT ON refunds TO b2c_app;
GRANT SELECT, INSERT, UPDATE ON cash_sessions TO b2c_app;
GRANT SELECT, INSERT ON provider_webhook_events TO b2c_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON notification_templates TO b2c_app;
GRANT SELECT, INSERT, UPDATE ON outbox_events TO b2c_app;
GRANT SELECT, INSERT, UPDATE ON notifications TO b2c_app;
