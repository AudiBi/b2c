-- Frais CONATEL : table d'articles (prix normal et VIP, pourcentage de la valeur, par watt, à confirmer) et lignes par colis.
-- Ces frais sont REVERSÉS à l'organisme : ils figurent sur la facture en lignes de type CUSTOMS, distinctes du fret (hors marge).
CREATE TYPE "CustomsFeeKind" AS ENUM ('FIXED', 'PERCENT_OF_VALUE', 'PER_WATT', 'TO_CONFIRM');

CREATE TABLE customs_items (
  id                     uuid PRIMARY KEY,
  company_id             uuid NOT NULL REFERENCES companies(id),
  name                   text NOT NULL,
  size                   text NOT NULL DEFAULT '',
  kind                   "CustomsFeeKind" NOT NULL,
  normal_price           numeric(14,2),
  vip_price              numeric(14,2),
  -- Pourcentage (PERCENT_OF_VALUE) ou prix par watt (PER_WATT)
  rate                   numeric(10,4),
  requires_authorization boolean NOT NULL DEFAULT false,
  active                 boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name, size),
  UNIQUE (id, company_id),
  CHECK (kind <> 'FIXED' OR (normal_price IS NOT NULL AND vip_price IS NOT NULL)),
  CHECK (kind NOT IN ('PERCENT_OF_VALUE', 'PER_WATT') OR rate IS NOT NULL)
);

CREATE TABLE package_customs_lines (
  id             uuid PRIMARY KEY,
  company_id     uuid NOT NULL REFERENCES companies(id),
  package_id     uuid NOT NULL,
  item_id        uuid NOT NULL,
  quantity       integer NOT NULL DEFAULT 1 CHECK (quantity >= 1 AND quantity <= 1000),
  vip            boolean NOT NULL DEFAULT false,
  declared_value numeric(14,2),
  watts          numeric(12,2),
  -- Frais figés au moment de la saisie : un changement de table ne réécrit pas l'histoire
  fee            numeric(14,2) NOT NULL CHECK (fee >= 0),
  currency       char(3) NOT NULL,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (package_id, company_id) REFERENCES packages(id, company_id),
  FOREIGN KEY (item_id, company_id) REFERENCES customs_items(id, company_id)
);
CREATE INDEX package_customs_lines_package_idx ON package_customs_lines (company_id, package_id);

ALTER TABLE customs_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE customs_items FORCE ROW LEVEL SECURITY;
ALTER TABLE package_customs_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE package_customs_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customs_items USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_isolation ON package_customs_lines USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
GRANT SELECT, INSERT, UPDATE ON customs_items TO b2c_app;
GRANT SELECT, INSERT, DELETE ON package_customs_lines TO b2c_app;
