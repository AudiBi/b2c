-- Proforma du personnel : estimation chiffrée pour un client, valable jusqu'à une date, convertible en colis de comptoir.
-- Le calcul vient de la grille active (jamais un prix inventé) ; il est figé à la création.
CREATE TABLE proformas (
  id                   uuid PRIMARY KEY,
  company_id           uuid NOT NULL REFERENCES companies(id),
  number               text NOT NULL,
  customer_id          uuid NOT NULL,
  rate_card_id         uuid NOT NULL,
  input                jsonb NOT NULL,
  result               jsonb NOT NULL,
  currency             char(3) NOT NULL,
  total                numeric(14,2) NOT NULL CHECK (total >= 0),
  valid_until          date NOT NULL,
  note                 text,
  converted_package_id uuid,
  created_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, number),
  UNIQUE (id, company_id),
  FOREIGN KEY (customer_id, company_id) REFERENCES customers(id, company_id),
  FOREIGN KEY (rate_card_id, company_id) REFERENCES rate_cards(id, company_id),
  FOREIGN KEY (converted_package_id, company_id) REFERENCES packages(id, company_id)
);
CREATE INDEX proformas_company_customer_idx ON proformas (company_id, customer_id, created_at);
ALTER TABLE proformas ENABLE ROW LEVEL SECURITY;
ALTER TABLE proformas FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON proformas USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
GRANT SELECT, INSERT, UPDATE ON proformas TO b2c_app;
