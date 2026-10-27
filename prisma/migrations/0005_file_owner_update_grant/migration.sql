-- Fusion d'un colis non identifié dans le colis attendu du client : ses pièces jointes changent de propriétaire.
-- Seule la colonne owner_id est modifiable (le contenu, l'empreinte et la clé de stockage restent immuables).
GRANT UPDATE (owner_id) ON file_objects TO b2c_app;
