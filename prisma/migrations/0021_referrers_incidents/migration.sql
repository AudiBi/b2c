-- Référents (commissions sur le profit des clients qu'ils amènent) et indemnisation des incidents (réclamations).
-- Tout est dans des tables à part : rien de cela n'apparaît dans les réponses destinées aux clients.
CREATE TABLE referrers (
  id         uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id),
  name       text NOT NULL,
  phone      text,
  email      text,
  -- Pourcentage du profit (0 à 100)
  rate       numeric(5,2) NOT NULL CHECK (rate >= 0 AND rate <= 100),
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name),
  UNIQUE (id, company_id)
);

CREATE TABLE customer_referrers (
  company_id  uuid NOT NULL REFERENCES companies(id),
  customer_id uuid NOT NULL PRIMARY KEY,
  referrer_id uuid NOT NULL,
  since       date NOT NULL DEFAULT CURRENT_DATE,
  FOREIGN KEY (customer_id, company_id) REFERENCES customers(id, company_id),
  FOREIGN KEY (referrer_id, company_id) REFERENCES referrers(id, company_id)
);

CREATE TABLE referrer_payouts (
  id          uuid PRIMARY KEY,
  company_id  uuid NOT NULL REFERENCES companies(id),
  referrer_id uuid NOT NULL,
  month       char(7) NOT NULL CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  amount      numeric(14,2) NOT NULL CHECK (amount > 0),
  currency    char(3) NOT NULL,
  paid_on     date NOT NULL,
  note        text,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (referrer_id, month),
  FOREIGN KEY (referrer_id, company_id) REFERENCES referrers(id, company_id)
);

CREATE TABLE claim_compensations (
  claim_id      uuid PRIMARY KEY,
  company_id    uuid NOT NULL REFERENCES companies(id),
  -- Indemnité payée au client et remboursement obtenu du transporteur
  indemnity     numeric(14,2) NOT NULL DEFAULT 0 CHECK (indemnity >= 0),
  reimbursement numeric(14,2) NOT NULL DEFAULT 0 CHECK (reimbursement >= 0),
  currency      char(3) NOT NULL,
  paid_on       date,
  note          text,
  updated_by    uuid,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (claim_id, company_id) REFERENCES claims(id, company_id)
);

ALTER TABLE referrers ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrers FORCE ROW LEVEL SECURITY;
ALTER TABLE customer_referrers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_referrers FORCE ROW LEVEL SECURITY;
ALTER TABLE referrer_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrer_payouts FORCE ROW LEVEL SECURITY;
ALTER TABLE claim_compensations ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_compensations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON referrers USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_isolation ON customer_referrers USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_isolation ON referrer_payouts USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_isolation ON claim_compensations USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
GRANT SELECT, INSERT, UPDATE ON referrers TO b2c_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON customer_referrers TO b2c_app;
GRANT SELECT, INSERT ON referrer_payouts TO b2c_app;
GRANT SELECT, INSERT, UPDATE ON claim_compensations TO b2c_app;
