-- Premier lancement : les modes de paiement sont les espèces, le virement bancaire et Zelle.
-- Les valeurs MOBILE_MONEY et CARD_ONLINE restent dans l'énumération (PostgreSQL ne retire pas une valeur sans reconstruire le type) mais ne sont plus proposées.
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'ZELLE';
