# Intégrations externes

Phases 3 à 7. Une intégration n'est dite **active** que si elle a été exercée avec un service réel.

| Intégration | État | Détail |
|---|---|---|
| PostgreSQL 17 | ✅ active | Conteneur Docker de développement ; rôles `b2c_migrator` / `b2c_app` |
| Redis 7 | ✅ active | Limitation de débit et verrouillage des connexions ; échec « fermé » sur les routes d'authentification |
| E-mail (SMTP) | ◐ **active en développement seulement** | Livraison vérifiée vers Mailpit (aussi dans la recette navigateur, qui lit les messages) ; aucun fournisseur de production configuré. Depuis la phase 7, les notifications passent par une **file en base** (outbox) avec **nouvelles tentatives espacées** (1, 5, 30, 120 min) puis échec visible et relance par le personnel ; les e-mails d'authentification restent envoyés directement. Textes en FR/HT/EN (créole à relire) |
| Navigateurs de test | ✅ | Chromium de Playwright ; Microsoft Edge en repli. Pas de Firefox ni Safari |
| Pièces jointes (factures, photos) | ◐ **disque local seulement** | Fonctionne et testé (dossier `FILES_DIR`, par défaut `./.data/files`). Interface `FileStorage` prête pour un adaptateur S3, **non écrit** |
| Stockage objet compatible S3 | ❌ non configuré | Profil Docker `storage` prévu ; image MinIO non récupérable lors de la mise en place |
| SMS | ❌ non configuré | Aucun fournisseur choisi. Le canal existe dans le journal : une notification SMS demandée par le client est enregistrée « ignorée — canal non configuré » (`CHANNEL_NOT_CONFIGURED`) ; **rien n'est envoyé ni simulé** |
| WhatsApp Business | ❌ non configuré | Aucun compte. Même comportement que le SMS : « ignorée — canal non configuré » |
| Paiement en ligne (cartes, mobile money) | ❌ non configuré | Aucun prestataire choisi : **aucun paiement en ligne n'est proposé** (`/v1/me/payment-options` répond `online: false`). Le client paie en espèces auprès du personnel, ou **déclare** un virement / paiement mobile qu'un agent valide à la main après vérification. Un point d'entrée de **confirmation signée** (`POST /v1/webhooks/payments/:entreprise/:prestataire`, HMAC-SHA256 horodaté, rejeu sans effet) existe mais **n'est actif que si `PAYMENT_WEBHOOK_PROVIDER` et `PAYMENT_WEBHOOK_SECRET` sont définis** ; il n'a été exercé qu'avec un émetteur simulé par les tests (aucun prestataire réel), et il n'y a **pas d'adaptateur** de prestataire (création de paiement, remboursement chez le prestataire) |
| Transporteurs aériens / maritimes | ❌ non configuré | Aucun suivi automatique : départ et arrivée des lots sont **saisis par le personnel** (phase 6) ; aucune date prévue, aucune position |
| Génération de PDF (manifestes, factures, reçus) | ✅ active | Bibliothèque `pdfkit` (locale, sans service externe) ; tests : le document est un PDF valide, sans contrôle visuel automatisé |
| Lecteur de codes-barres | ✅ par clavier | Un lecteur qui « tape » le code puis Entrée suffit (champ focalisé) ; testé par saisie simulée, **pas avec un lecteur matériel** ; pas de scan par caméra |
| Sites marchands (Amazon, Walmart…) | ❌ aucune | Aucune intégration n'est prévue ni simulée |
