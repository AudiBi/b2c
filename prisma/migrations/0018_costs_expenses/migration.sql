-- Coûts d'achat, dépenses et profit (réservés à l'administration et à la comptabilité).
-- Coût d'achat unitaire par tranche de grille (par lb, par pi³ ou par baril, dans la devise de la grille) : jamais montré hors permission cost:read.
ALTER TABLE rate_rules ADD COLUMN unit_cost numeric(14,4) CHECK (unit_cost IS NULL OR unit_cost >= 0);

-- Coût figé sur le colis à la pesée (comme le prix) : un changement de tarif ne réécrit pas l'histoire.
ALTER TABLE packages ADD COLUMN cost_amount numeric(14,2) CHECK (cost_amount IS NULL OR cost_amount >= 0);
ALTER TABLE packages ADD COLUMN cost_currency char(3);

CREATE TABLE expenses (
  id          uuid PRIMARY KEY,
  company_id  uuid NOT NULL REFERENCES companies(id),
  spent_on    date NOT NULL,
  category    text NOT NULL,
  agency      text,
  description text NOT NULL,
  amount      numeric(14,2) NOT NULL CHECK (amount > 0),
  currency    char(3) NOT NULL,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, company_id)
);
CREATE INDEX expenses_company_date_idx ON expenses (company_id, spent_on);
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON expenses USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON expenses TO b2c_app;
