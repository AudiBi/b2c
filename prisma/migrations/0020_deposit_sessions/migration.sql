-- Une caisse clôturée ne change plus (déclencheur) : le rattachement d'un dépôt à ses caisses se fait par une table de liaison,
-- une caisse ne pouvant être déposée qu'une fois.
ALTER TABLE cash_sessions DROP CONSTRAINT cash_sessions_deposit_fkey;
DROP INDEX cash_sessions_deposit_idx;
ALTER TABLE cash_sessions DROP COLUMN deposit_id;

CREATE TABLE bank_deposit_sessions (
  company_id      uuid NOT NULL REFERENCES companies(id),
  deposit_id      uuid NOT NULL,
  cash_session_id uuid NOT NULL,
  PRIMARY KEY (deposit_id, cash_session_id),
  UNIQUE (cash_session_id),
  FOREIGN KEY (deposit_id, company_id) REFERENCES bank_deposits(id, company_id),
  FOREIGN KEY (cash_session_id, company_id) REFERENCES cash_sessions(id, company_id)
);
ALTER TABLE bank_deposit_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_deposit_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON bank_deposit_sessions USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
GRANT SELECT, INSERT ON bank_deposit_sessions TO b2c_app;
