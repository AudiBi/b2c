-- CreateTable
CREATE TABLE "customer_members" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "invited_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_members_user_id_key" ON "customer_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_members_user_id_company_id_key" ON "customer_members"("user_id", "company_id");

-- CreateIndex
CREATE INDEX "customer_members_company_id_customer_id_idx" ON "customer_members"("company_id", "customer_id");

-- AddForeignKey
ALTER TABLE "customer_members" ADD CONSTRAINT "customer_members_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_members" ADD CONSTRAINT "customer_members_customer_id_company_id_fkey" FOREIGN KEY ("customer_id", "company_id") REFERENCES "customers"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_members" ADD CONSTRAINT "customer_members_user_id_company_id_fkey" FOREIGN KEY ("user_id", "company_id") REFERENCES "users"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================================
-- Compléments écrits à la main : équipe d'un compte professionnel (moindre privilège)
-- =====================================================================================

-- Un membre est un compte client (jamais du personnel), le compte rattaché est PROFESSIONNEL,
-- et le membre n'est jamais lui-même propriétaire d'un compte client.
CREATE FUNCTION customer_members_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Une appartenance à une équipe ne se modifie pas : la retirer puis la recréer' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND company_id = NEW.company_id AND kind = 'CUSTOMER') THEN
    RAISE EXCEPTION 'Un membre d''équipe est un compte client' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM customers WHERE id = NEW.customer_id AND company_id = NEW.company_id AND customer_type = 'BUSINESS') THEN
    RAISE EXCEPTION 'Une équipe se rattache à un compte professionnel' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM customers WHERE user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'Un propriétaire de compte ne peut pas être membre d''une équipe' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM customers WHERE id = NEW.customer_id AND user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'Le propriétaire ne peut pas être membre de sa propre équipe' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER customer_members_check BEFORE INSERT OR UPDATE ON customer_members FOR EACH ROW EXECUTE FUNCTION customer_members_guard();

-- Réciproque : un membre d'équipe ne peut pas devenir propriétaire d'un compte client
CREATE FUNCTION customers_not_member() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM customer_members WHERE user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'Un membre d''une équipe ne peut pas avoir de compte client propre' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER customers_not_member_check BEFORE INSERT ON customers FOR EACH ROW EXECUTE FUNCTION customers_not_member();

ALTER TABLE customer_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_members FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer_members USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
GRANT SELECT, INSERT, DELETE ON customer_members TO b2c_app;
