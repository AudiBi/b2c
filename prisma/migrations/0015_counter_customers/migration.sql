-- Fusion avec l'outil de gestion de comptoir : colis créés au guichet, avec destinataire distinct,
-- et ancien numéro de suivi conservé pour les colis importés.
ALTER TYPE "RecipientKind" ADD VALUE IF NOT EXISTS 'RECIPIENT';

ALTER TABLE packages ADD COLUMN legacy_tracking_number text;
ALTER TABLE packages ADD COLUMN recipient_phone text;
ALTER TABLE packages ADD COLUMN recipient_city text;
ALTER TABLE packages ADD COLUMN created_at_counter boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX packages_company_legacy_tracking_key ON packages (company_id, legacy_tracking_number) WHERE legacy_tracking_number IS NOT NULL;
