-- Caisse : une caisse a UNE devise (jamais de dollars additionnés à des gourdes).
-- Un encaissement en espèces entre dans la caisse ouverte de la devise de sa facture ; une agence qui encaisse deux devises ouvre deux caisses.
ALTER TABLE cash_sessions ADD COLUMN currency CHAR(3);

-- Reprise de l'existant : devise des encaissements de la caisse, à défaut devise par défaut de l'entreprise.
-- Le déclencheur qui interdit de modifier une caisse clôturée est suspendu le temps de la reprise.
ALTER TABLE cash_sessions DISABLE TRIGGER cash_sessions_closed_immutable;
UPDATE cash_sessions s SET currency = COALESCE(
  (SELECT p.currency FROM payments p WHERE p.cash_session_id = s.id ORDER BY p.created_at LIMIT 1),
  (SELECT c.default_currency FROM companies c WHERE c.id = s.company_id)
);
ALTER TABLE cash_sessions ENABLE TRIGGER cash_sessions_closed_immutable;
ALTER TABLE cash_sessions ALTER COLUMN currency SET NOT NULL;
ALTER TABLE cash_sessions ALTER COLUMN currency SET DEFAULT 'USD';

-- Une seule caisse ouverte par agence (ou pour l'entreprise) ET PAR DEVISE
DROP INDEX cash_sessions_one_open;
CREATE UNIQUE INDEX cash_sessions_one_open ON cash_sessions (company_id, COALESCE(agency_id, '00000000-0000-0000-0000-000000000000'::uuid), currency) WHERE closed_at IS NULL;
