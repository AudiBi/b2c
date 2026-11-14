-- Dépôts bancaires : ils se rattachent aux caisses CLÔTURÉES (une caisse a une devise, une agence et un montant compté à la clôture).
-- Petite caisse : écritures datées (dépense ou approvisionnement) par devise, solde courant.
CREATE TABLE bank_deposits (
  id              uuid PRIMARY KEY,
  company_id      uuid NOT NULL REFERENCES companies(id),
  number          text NOT NULL,
  deposit_date    date NOT NULL,
  bank            text NOT NULL,
  -- Quatre derniers caractères seulement : jamais le numéro de compte complet
  account_last4   text,
  slip_ref        text NOT NULL,
  currency        char(3) NOT NULL,
  -- Montant compté à la clôture des caisses rattachées, figé à la création
  expected_amount numeric(14,2) NOT NULL CHECK (expected_amount >= 0),
  deposited_amount numeric(14,2) NOT NULL CHECK (deposited_amount >= 0),
  difference      numeric(14,2) NOT NULL,
  note            text,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, number),
  UNIQUE (id, company_id)
);
ALTER TABLE cash_sessions ADD COLUMN deposit_id uuid;
ALTER TABLE cash_sessions ADD CONSTRAINT cash_sessions_deposit_fkey FOREIGN KEY (deposit_id, company_id) REFERENCES bank_deposits(id, company_id);
CREATE INDEX cash_sessions_deposit_idx ON cash_sessions (company_id, deposit_id);

CREATE TABLE petty_cash_entries (
  id          uuid PRIMARY KEY,
  company_id  uuid NOT NULL REFERENCES companies(id),
  number      text NOT NULL,
  entry_date  date NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('EXPENSE', 'FUNDING')),
  category    text,
  description text NOT NULL,
  counterparty text,
  receipt_ref text,
  amount      numeric(14,2) NOT NULL CHECK (amount > 0),
  currency    char(3) NOT NULL,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, number)
);
CREATE INDEX petty_cash_company_date_idx ON petty_cash_entries (company_id, entry_date);

ALTER TABLE bank_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_deposits FORCE ROW LEVEL SECURITY;
ALTER TABLE petty_cash_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE petty_cash_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON bank_deposits USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
CREATE POLICY tenant_isolation ON petty_cash_entries USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
-- Un dépôt et une écriture de caisse ne se modifient pas : une erreur se corrige par une écriture inverse
GRANT SELECT, INSERT ON bank_deposits TO b2c_app;
GRANT SELECT, INSERT ON petty_cash_entries TO b2c_app;
