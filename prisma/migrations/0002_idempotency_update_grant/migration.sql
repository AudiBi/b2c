-- Le service d'idempotence enregistre la clé au début de la transaction puis y inscrit la réponse
-- une fois l'opération terminée : le rôle applicatif a besoin de UPDATE sur cette table.
-- (La suppression des clés expirées reste réservée à DELETE, déjà accordé en 0001.)
GRANT UPDATE ON idempotency_keys TO b2c_app;
