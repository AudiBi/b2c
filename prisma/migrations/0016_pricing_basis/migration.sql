-- Tarification métier : chaque tranche de la grille se calcule sur le poids (défaut), le volume (pied cube) ou à l'unité (baril).
-- Un diviseur volumétrique propre à la tranche permet un contenant particulier (ex. e-conteneur). Un colis porte une quantité.
CREATE TYPE "PricingBasis" AS ENUM ('WEIGHT', 'VOLUME', 'UNIT');

ALTER TABLE rate_rules ADD COLUMN basis "PricingBasis" NOT NULL DEFAULT 'WEIGHT';
ALTER TABLE rate_rules ADD COLUMN volumetric_divisor numeric(12,4) CHECK (volumetric_divisor IS NULL OR volumetric_divisor > 0);

ALTER TABLE packages ADD COLUMN quantity integer NOT NULL DEFAULT 1 CHECK (quantity >= 1 AND quantity <= 10000);
