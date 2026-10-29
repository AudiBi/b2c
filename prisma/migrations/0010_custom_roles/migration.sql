-- AlterTable
ALTER TABLE "roles" ADD COLUMN     "scope_type" "ScopeType" NOT NULL DEFAULT 'COMPANY';

-- =====================================================================================
-- Compléments écrits à la main : rôles personnalisés (créés par l'administrateur d'une entreprise)
-- =====================================================================================

-- Un rôle personnalisé a un code `custom-…` (généré par le serveur) et une portée simple ; un rôle système n'a jamais de code `custom-…`
ALTER TABLE roles ADD CONSTRAINT roles_code_format CHECK (
  (is_system AND code !~ '^custom-')
  OR (NOT is_system AND code ~ '^custom-[a-z0-9]+(-[a-z0-9]+)*$' AND length(code) <= 64 AND scope_type IN ('COMPANY', 'WAREHOUSE', 'AGENCY'))
);

-- Identité d'un rôle figée : code, entreprise et nature (système ou non) ne changent jamais
CREATE FUNCTION roles_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.company_id, NEW.code, NEW.is_system) IS DISTINCT FROM (OLD.company_id, OLD.code, OLD.is_system) THEN
    RAISE EXCEPTION 'L''identité d''un rôle ne se modifie pas' USING ERRCODE = '23514';
  END IF;
  IF NOT OLD.is_system AND NEW.scope_type IS DISTINCT FROM OLD.scope_type THEN
    RAISE EXCEPTION 'La portée d''un rôle ne se modifie pas' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER roles_immutable_identity BEFORE UPDATE ON roles FOR EACH ROW EXECUTE FUNCTION roles_guard();

-- Un rôle système (entreprise plateforme) ne se supprime pas par l'application
CREATE FUNCTION roles_no_system_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.is_system THEN
    RAISE EXCEPTION 'Un rôle système ne se supprime pas' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END
$$;
CREATE TRIGGER roles_keep_system BEFORE DELETE ON roles FOR EACH ROW EXECUTE FUNCTION roles_no_system_delete();
