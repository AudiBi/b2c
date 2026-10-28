-- AlterTable
ALTER TABLE "users" ADD COLUMN     "totp_enabled_at" TIMESTAMPTZ(6),
ADD COLUMN     "totp_last_step" BIGINT;

-- CreateTable
CREATE TABLE "totp_recovery_codes" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "totp_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "totp_recovery_codes_company_id_user_id_idx" ON "totp_recovery_codes"("company_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "totp_recovery_codes_user_id_code_hash_key" ON "totp_recovery_codes"("user_id", "code_hash");

-- AddForeignKey
ALTER TABLE "totp_recovery_codes" ADD CONSTRAINT "totp_recovery_codes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "totp_recovery_codes" ADD CONSTRAINT "totp_recovery_codes_user_id_company_id_fkey" FOREIGN KEY ("user_id", "company_id") REFERENCES "users"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- =====================================================================================
-- Compléments écrits à la main (CHECK, déclencheur, RLS, droits)
-- =====================================================================================

-- Une double authentification active suppose un secret
ALTER TABLE users ADD CONSTRAINT users_totp_consistent CHECK (totp_enabled_at IS NULL OR totp_secret_enc IS NOT NULL);
ALTER TABLE totp_recovery_codes ADD CONSTRAINT totp_recovery_codes_hash CHECK (length(code_hash) = 64);

-- Un code de secours ne se modifie pas (seule sa consommation est permise, une fois) et ne se supprime pas unitairement hors regénération
CREATE FUNCTION totp_recovery_codes_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.user_id, NEW.code_hash, NEW.company_id) IS DISTINCT FROM (OLD.user_id, OLD.code_hash, OLD.company_id) THEN
      RAISE EXCEPTION 'Un code de secours ne se modifie pas' USING ERRCODE = '23514';
    END IF;
    IF OLD.used_at IS NOT NULL AND NEW.used_at IS DISTINCT FROM OLD.used_at THEN
      RAISE EXCEPTION 'Un code de secours utilisé ne change plus' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$$;
CREATE TRIGGER totp_recovery_codes_immutable BEFORE UPDATE ON totp_recovery_codes FOR EACH ROW EXECUTE FUNCTION totp_recovery_codes_guard();

ALTER TABLE totp_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE totp_recovery_codes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON totp_recovery_codes USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
-- Suppression permise : la régénération remplace l'ensemble des codes
GRANT SELECT, INSERT, UPDATE, DELETE ON totp_recovery_codes TO b2c_app;
