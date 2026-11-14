-- La règle de paiement peut être l'une, l'autre ou les deux : PAY_BEFORE_BOTH = payer avant l'expédition ET avant la remise.
ALTER TYPE "PaymentPolicy" ADD VALUE IF NOT EXISTS 'PAY_BEFORE_BOTH';
