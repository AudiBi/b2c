# Intégrations externes

Phase 3. Une intégration n'est dite **active** que si elle a été exercée avec un service réel.

| Intégration | État | Détail |
|---|---|---|
| PostgreSQL 17 | ✅ active | Conteneur Docker de développement ; rôles `b2c_migrator` / `b2c_app` |
| Redis 7 | ✅ active | Limitation de débit et verrouillage des connexions ; échec « fermé » sur les routes d'authentification |
| E-mail (SMTP) | ◐ **active en développement seulement** | Livraison vérifiée vers Mailpit ; aucun fournisseur de production configuré. Envoi direct, sans file ni nouvelle tentative (phase 7) |
| Stockage objet compatible S3 | ❌ non configuré | Profil Docker `storage` prévu ; image MinIO non récupérable lors de la mise en place, à remplacer par une image S3 disponible (phase 5) |
| SMS | ❌ non configuré | Aucun fournisseur choisi |
| WhatsApp Business | ❌ non configuré | Aucun compte |
| Paiement en ligne (cartes, mobile money) | ❌ non configuré | Aucun prestataire choisi ; l'interface `PaymentProvider` sera créée en phase 7 |
| Transporteurs aériens / maritimes | ❌ non configuré | Aucun suivi automatique : les événements de lot seront saisis manuellement |
| Sites marchands (Amazon, Walmart…) | ❌ aucune | Aucune intégration n'est prévue ni simulée |
