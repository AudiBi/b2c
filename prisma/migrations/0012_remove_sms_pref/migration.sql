-- Le canal SMS est retiré du produit : la préférence « sms » disparaît des profils et du défaut.
-- (La valeur SMS de l'énumération « NotificationChannel » est conservée : PostgreSQL ne retire pas une valeur d'énumération
-- sans reconstruire le type, et d'anciennes lignes du journal peuvent la porter ; plus rien ne l'émet.)
ALTER TABLE "customers" ALTER COLUMN "notification_prefs" SET DEFAULT '{"email": true, "whatsapp": false, "inApp": true}';
UPDATE "customers" SET "notification_prefs" = "notification_prefs" - 'sms' WHERE "notification_prefs" ? 'sms';
