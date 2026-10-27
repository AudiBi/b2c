# Intégrations externes

Phases 3 à 6. Une intégration n'est dite **active** que si elle a été exercée avec un service réel.

| Intégration | État | Détail |
|---|---|---|
| PostgreSQL 17 | ✅ active | Conteneur Docker de développement ; rôles `b2c_migrator` / `b2c_app` |
| Redis 7 | ✅ active | Limitation de débit et verrouillage des connexions ; échec « fermé » sur les routes d'authentification |
| E-mail (SMTP) | ◐ **active en développement seulement** | Livraison vérifiée vers Mailpit (aussi dans la recette navigateur, qui lit les messages) ; aucun fournisseur de production configuré. Envoi direct, sans file ni nouvelle tentative (phase 7). Textes d'authentification en FR/HT/EN (créole à relire) |
| Navigateurs de test | ✅ | Chromium de Playwright ; Microsoft Edge en repli. Pas de Firefox ni Safari |
| Pièces jointes (factures, photos) | ◐ **disque local seulement** | Fonctionne et testé (dossier `FILES_DIR`, par défaut `./.data/files`). Interface `FileStorage` prête pour un adaptateur S3, **non écrit** |
| Stockage objet compatible S3 | ❌ non configuré | Profil Docker `storage` prévu ; image MinIO non récupérable lors de la mise en place |
| SMS | ❌ non configuré | Aucun fournisseur choisi |
| WhatsApp Business | ❌ non configuré | Aucun compte |
| Paiement en ligne (cartes, mobile money) | ❌ non configuré | Aucun prestataire choisi ; l'interface `PaymentProvider` sera créée en phase 7 |
| Transporteurs aériens / maritimes | ❌ non configuré | Aucun suivi automatique : départ et arrivée des lots sont **saisis par le personnel** (phase 6) ; aucune date prévue, aucune position |
| Génération de PDF (manifestes) | ✅ active | Bibliothèque `pdfkit` (locale, sans service externe) ; tests : le document est un PDF valide, sans contrôle visuel automatisé |
| Lecteur de codes-barres | ✅ par clavier | Un lecteur qui « tape » le code puis Entrée suffit (champ focalisé) ; testé par saisie simulée, **pas avec un lecteur matériel** ; pas de scan par caméra |
| Sites marchands (Amazon, Walmart…) | ❌ aucune | Aucune intégration n'est prévue ni simulée |
