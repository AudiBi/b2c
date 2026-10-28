# Feuille de route et backlog

Phase 2. Les identifiants (CLI-01, PKG-03…) renvoient à [REQUIREMENTS.md](REQUIREMENTS.md). L'état est mis à jour à la fin de chaque phase ; une case n'est cochée que lorsque les tests correspondants ont réellement été exécutés avec succès.

Légende : ☐ à faire · ◐ en cours · ☑ terminé et testé

## Phases

| Phase | Contenu | État |
|---|---|---|
| 1 | Audit du dépôt et de la référence | ☑ [PROJECT_AUDIT.md](PROJECT_AUDIT.md) |
| 2 | Spécifications, architecture, modèle de domaine, schéma, backlog | ☑ validée par l'utilisateur |
| 3 | Monorepo, Docker, auth, utilisateurs, rôles, tenancy + RLS, audit | ☑ 156 tests réussis ([TEST_PLAN.md](TEST_PLAN.md)) ; réserves ci-dessous |
| 4 | Site public (17 pages) et portail client | ☑ 391 tests au total ; réserves ci-dessous |
| 5 | Colis, préalertes, suivi, calculateur | ☑ 579 tests au total ; réserves ci-dessous |
| 6 | Entrepôts, lots, manifestes, agences | ☑ 670 tests au total ; réserves ci-dessous |
| 7 | Facturation, paiements, notifications | ☑ 772 tests au total ; réserves ci-dessous |
| 8 | Livraisons, réclamations, tableaux de bord | ☐ |
| 9 | Intégrations, tests de sécurité, tests de charge | ☐ |
| 10 | Documentation finale, déploiement, préparation à la production | ☐ |

## Backlog détaillé et dépendances

### Phase 3 : fondations
| # | Tâche | Dépend de | Exigences |
|---|---|---|---|
| 3.1 | Monorepo, TypeScript strict, lint, scripts, `.env.example` | – | NFR-09 |
| 3.2 | `docker/compose.dev.yml` (PostgreSQL, Redis, MinIO, Mailpit) | 3.1 | – |
| 3.3 | Prisma, migration `0001`, rôles PostgreSQL (migration / application), RLS | 3.2 | NFR-01 |
| 3.4 | Module `tenancy` : contexte d'entreprise par requête, transaction + `SET LOCAL` | 3.3 | NFR-01 |
| 3.5 | Module `auth` : inscription, e-mail de vérification (Mailpit), connexion, rotation des sessions, réinitialisation | 3.4 | CLI-01, 02, 04, 05 |
| 3.6 | Module `iam` : permissions, rôles par défaut (12), guard, portées | 3.4 | §2 REQUIREMENTS |
| 3.7 | Module `audit` en ajout seul | 3.3 | PKG-04 |
| 3.8 | Limitation de débit, Helmet, validation globale, journaux JSON, `/health` | 3.1 | NFR-04, 05, 10, 14 |
| 3.9 | OpenAPI générée | 3.5 | – |
| 3.10 | Tests : inscription/connexion, isolement de deux entreprises, interdictions de rôle, rejeu de jeton | 3.4-3.8 | Tests 1, 13, 14 |
| 3.11 | Seed minimal (rôles, permissions) et `seed-demo` étiqueté DEMO | 3.6 | H6 |

Critère de sortie : tests verts exécutés, migration appliquée à une base vide, deux entreprises isolées prouvées par test. **Atteint.**

**Réserves de la phase 3 (reportées)** :
- 3.5 : vérification du téléphone et TOTP du personnel non implémentés (le TOTP est à faire avant toute mise en production) ; e-mails sans file ni nouvelle tentative (phase 7).
- 3.6 : l'existence des entrepôts/agences référencés par une portée n'est pas vérifiée (phase 6).
- 3.2 : l'image MinIO n'a pas pu être téléchargée ; le profil Docker « storage » est non vérifié (phase 5).
- Vulnérabilités de dépendances connues et acceptées : voir [SECURITY.md](SECURITY.md).
- Écarts de conception : [ARCHITECTURE.md §15](ARCHITECTURE.md) et [DATABASE_SCHEMA.md §0](DATABASE_SCHEMA.md).

### Phase 4 : site public et portail client
| # | Tâche | Exigences |
|---|---|---|
| 4.1 | Décision D1 (pré-rendu) ; identité visuelle provisoire ; composants UI ; i18n FR/HT/EN | NFR-16 |
| 4.2 | 17 pages publiques | §3.10 |
| 4.3 | Inscription / connexion / vérification dans l'interface | CLI-01 à 05 |
| 4.4 | Profil, préférences, carnet d'adresses, bénéficiaires | CLI-06, 07, 10 |
| 4.5 | Code client et adresses de réception (dépend d'au moins un entrepôt) | CLI-08, 09 |
| 4.6 | Accessibilité (axe) et responsive (tests Playwright) | NFR-16 |

**Réalisé en phase 4** : 4.1 à 4.6 (voir [WEB.md](WEB.md)) ; en plus : changement de mot de passe, consultation des clients par le personnel, gestion minimale des entrepôts, coordonnées publiques de l'entreprise.

**Réserves de la phase 4 (reportées)** :
- Le **créole** n'a pas été relu par un locuteur natif ; les **textes légaux** sont des projets à faire valider par un juriste ; le contenu éditorial doit être adapté à l'entreprise (marque, entrepôts, délais, moyens de paiement).
- Accessibilité : contrôle automatique (axe) seulement ; **audit manuel et test avec lecteur d'écran à faire** avant d'annoncer une conformité.
- ~~Le suivi public et le calculateur ne sont pas actifs~~ : **activés en phase 5**. La liste des agences est vide (phase 6).
- Compte professionnel : sous-utilisateurs non réalisés (CLI-11) ; vérification du téléphone non réalisée (CLI-03).
- Poids du JavaScript (~235 Ko compressés) à réduire (voir WEB.md) ; pas de mesure de performance sur réseau mobile.
- Un site = une entreprise (une construction par entreprise) ; pas de bascule par nom de domaine.
- Déploiement du site non testé sur un vrai serveur nginx/Apache (exemple de configuration fourni dans WEB.md).

### Phase 5 : colis, préalertes, suivi, calculateur
| # | Tâche | Exigences |
|---|---|---|
| 5.1 | Machine d'états + table de transitions + test exhaustif de toutes les paires | PKG-03, 04 |
| 5.2 | Numéro de suivi (génération, contrôle, unicité, concurrence) | PKG-02 |
| 5.3 | CRUD colis, historique, pièces jointes (URL signées, vérification) | PKG-01, 06 |
| 5.4 | Préalertes et rapprochement automatique / manuel | PRE-01 à 03 |
| 5.5 | Grilles tarifaires, versions, administration | CAL-06 |
| 5.6 | Calculateur (poids volumétrique, arrondi, minimum), « tarif indisponible » | CAL-01 à 05 |
| 5.7 | Suivi public + portail + limitation de débit | TRK-01 à 06 |
| 5.8 | Colis non identifiés, anomalies, regroupements | PKG-08, 09 |
| 5.9 | Tests : parcours 2, 3, 4, 5, 7, 8, 13 ; doublons de suivi ; transitions interdites | – |

**Réalisé en phase 5** : 5.1 à 5.9. Détail : machine d'états de **40 règles** dans le package partagé (utilisée par l'API et l'interface) avec test exhaustif des 289 paires ; verrou de ligne + déclencheur différé en base (« pas de changement de statut sans événement ») ; numéro de suivi à contrôle (erreur de saisie détectée) ; préalerte → colis attendu → rapprochement (numéro du marchand exact, code client unique, choix manuel) ; colis non identifiés avec fusion dans le colis attendu ; regroupement ; retenue/reprise ; grilles tarifaires versionnées et immuables une fois actives (déclencheurs + contraintes d'exclusion), calculateur en décimal exact ; suivi public sans donnée personnelle ; pièces jointes (contenu vérifié, liens signés de 5 min) ; calculateur, suivi, préalertes, « Mes colis » dans le site ; données DEMO étiquetées (entrepôt, catégorie, grille fictifs).

**Réserves de la phase 5 (reportées)** :
- **Pas d'écran pour le personnel** (réception, pesée, identification, retenue) : ces opérations n'existent qu'en API (la recette navigateur les appelle par l'API). Écran d'entrepôt avec lecteur de codes : phase 6.
- L'API générique de changement de statut n'accepte que les transitions pilotées par les colis et la facturation ; transport, agence et livraison viendront avec les phases 6 et 8 (réponse 409 `TRANSITION_NOT_AVAILABLE`). Les gardes de paiement (`AWAITING_PAYMENT` → `READY_TO_SHIP`) sont **manuelles** (permission + motif) jusqu'à la phase 7.
- **Division** d'un colis en plusieurs : non réalisée (regroupement seulement).
- **Stockage des pièces jointes sur disque local** (`FILES_DIR`) : l'adaptateur S3 n'est pas écrit ni testé (image MinIO toujours inaccessible). Pas d'antivirus : seule une vérification du type réel et un refus des PDF à contenu actif sont faits.
- Les frais calculés à la pesée sont **provisoires** (la facture, phase 7, fait foi) ; aucune date de livraison n'est annoncée (aucune donnée réelle).
- Le calculateur ne gère pas de tarif négocié par client ni de conversion de devise.
- Le créole des nouveaux écrans n'a pas été relu par un locuteur natif.

### Phase 6 : entrepôts, lots, agences
| # | Tâche | Exigences |
|---|---|---|
| 6.1 | Entrepôts, emplacements, mouvements | WH-01, 03 |
| 6.2 | Réception par scan (saisie rapide, lecteur code-barres) | WH-02 |
| 6.3 | Lots, chargement, manifeste PDF/CSV | SHP-01 à 05 |
| 6.4 | Propagation des événements de lot vers les colis | SHP-04 |
| 6.5 | Agences, réception en agence | AGY-01, 02 |
| 6.6 | Tests : parcours 3, 6, 11 ; scans concurrents | NFR-08 |

**Réalisé en phase 6** : 6.1 à 6.6, **avec les écrans du personnel** (réserve de la phase 5 levée) :
- **Entrepôt** : emplacements (zone, étagère, bac), mouvements en ajout seul (IN / MOVE / OUT), inventaire par emplacement (hors colis partis), file des anomalies (retenues ouvertes, colis sans client), réception **par scan** (numéro de suivi ou numéro du marchand ; relecture sans effet ; verrou consultatif : 6 lectures simultanées → 1 seul colis).
- **Lots** : référence `<entrepôt>-<mode>-<AAAAMMJJ>-<n>` numérotée sans doublon ; chargement contrôlé (colis prêt, client, poids, dimensions, même mode, même entrepôt, même destination, **un seul lot à la fois** — index unique partiel) ; départ, arrivée, douane, clôture, annulation qui **propagent** le statut aux colis ; dates **réelles** seulement ; manifeste **CSV** (protégé contre l'injection de formules) et **PDF**.
- **Agences** : administration, liste publique, affectation, réception par scan (refus si autre agence ou lot non arrivé), « prêt pour retrait », point de retrait montré au client et au suivi public (agence publique seulement).
- **Droits** : portées entrepôt/agence respectées partout ; une portée doit désigner un entrepôt ou une agence existant de l'entreprise (réserve de sécurité levée).
- **Site** : écrans « Réception », « Colis », « Entrepôt », « Lots », « Agence » (menu selon les droits), lecture par lecteur de codes-barres (le champ reprend le focus), téléchargement du manifeste.

**Réserves de la phase 6 (reportées)** :
- Les écrans du personnel sont **fonctionnels mais sobres** : pas de tableau de bord opérationnel, pas d'impression d'étiquettes, pas de scan par caméra (lecteur de codes-barres ou saisie seulement), pas d'écran d'administration des agences ni d'identification avec fusion dans le colis attendu (API disponible).
- **Aucune intégration de transporteur** : départ et arrivée sont saisis par le personnel (SHP-05). Pas de date d'arrivée prévue ni de position.
- Le transporteur est un **texte libre** (pas de table des transporteurs) ; pas de zones de livraison ni de tournées (phase 8).
- ~~La notification « prêt pour retrait » n'est pas envoyée~~ : **levée en phase 7**.
- Le manifeste n'est pas conservé (généré à la demande, action journalisée par les téléchargements de l'API) ; PDF sobre (police standard, pas de logo).
- Remise au client (OTP, signature, preuve) : phase 8 ; `DELIVERED` reste hors de portée.

### Phase 7 : finance et notifications
| # | Tâche | Exigences |
|---|---|---|
| 7.1 | Factures, lignes, numérotation sans trou, avoirs | FIN-01, 09 |
| 7.2 | Paiements espèces, reçus, caisse | FIN-04 |
| 7.3 | Interface prestataire, webhooks signés, idempotence ; virement manuel validé | FIN-05, 06 |
| 7.4 | Remboursements, rapprochement, export CSV | FIN-03, 07 |
| 7.5 | Outbox, file, modèles multilingues, e-mail réel (SMTP), nouvelle tentative | NOT-01 à 05 |
| 7.6 | SMS / WhatsApp : interface + adaptateur, **actifs seulement avec identifiants réels** | NOT-02 |
| 7.7 | Tests : parcours 9, 10, 15 ; webhook rejoué ; échec de fournisseur | – |

**Réalisé en phase 7** : 7.1 à 7.7, avec les écrans.
- **Factures** : brouillon à partir des colis pesés (fret et manutention repris de la **pesée**, jamais saisis ; un colis sans tarif calculé exige un fret saisi), remise plafonnée (10 % par défaut, réglable) et soumise à `discount:apply`, **un colis n'est facturé qu'une fois** (contrainte unique, y compris brouillons simultanés), émission avec numéro `INV-AAAA-NNNNNN` **sans trou** (4 émissions simultanées → 1 à 4), facture **immuable** après émission (API et déclencheurs), annulation motivée sans paiement, **avoirs** numérotés (`CN-…`), PDF. Une facture entièrement payée libère ses colis.
- **Paiements** : espèces avec **caisse ouverte exigée**, droits par agence, **Idempotency-Key** (rejeu sans doublon), reçu `RCT-…` immédiat, ouverture / clôture de caisse (attendu, compté, écart) ; virement et paiement mobile **déclarés par le client** (référence unique, réservation du montant) puis **validés ou refusés par un agent** ; plafond au reste dû garanti par verrou **et** par la base ; remboursements partiels ou totaux ; synthèse de rapprochement et export CSV.
- **Confirmation signée** d'un prestataire : HMAC horodaté, rejeu sans effet, montant et devise rapprochés ; **inexistante (404) tant qu'aucun prestataire n'est configuré**.
- **Notifications** : douze événements, dont dix ont un émetteur (réception, identification, facture à payer, paiement reçu, préalerte, lot préparé / parti / arrivé, prêt pour retrait, incident ; **testés par un test dédié** : préalerte, réception, incident, facture à payer, paiement reçu ; les émetteurs des lots, de l'identification et du retrait en agence sont en place mais **sans test dédié**) ; portail + e-mail ; langue du client ; préférences respectées sauf événements obligatoires ; modèles par défaut FR / HT / EN modifiables par l'entreprise (variables contrôlées, texte brut) ; nouvelles tentatives à +1, +5, +30, +120 min puis échec visible et relançable ; journal ; traitement de fond.
- **Site** : « Mes factures » (détail, déclaration de paiement, PDF, reçus), « Notifications » avec pastille, et pour le personnel « Factures », « Paiements » (file, caisse, synthèse, export, réglages) et « Notifications » (journal, relance, modèles).
- Réserves des phases 5 et 6 levées : le passage « en attente de paiement » → « prêt pour expédition » se fait par le paiement ; la notification « prêt pour retrait » est désormais émise (sans test dédié).

**Écarts avec le plan (assumés)** :
- **Pas de BullMQ** : la file est dans PostgreSQL (`outbox_events` + `notifications`, verrous `SKIP LOCKED`). Moins de dépendances ; Redis reste pour les limites de débit.
- **Pas d'interface `PaymentProvider` ni d'adaptateur** (7.3) : aucun prestataire n'est choisi, et en écrire un sans service réel serait de la simulation. Seuls existent le point d'entrée de confirmation signée (désactivé par défaut) et la validation manuelle.
- **Pas d'adaptateur SMS / WhatsApp** (7.6) : le canal existe dans le journal et produit « ignorée — canal non configuré » ; rien n'est envoyé.
- Un paiement règle **une** facture (pas de `payment_allocations`).

**Réserves de la phase 7 (reportées)** :
- **Aucun paiement en ligne** (carte, mobile money) : la confirmation signée n'a été exercée qu'avec un émetteur simulé par les tests ; le format des événements d'un vrai prestataire, son secret et ses adresses d'émission restent à valider. Les remboursements sont **enregistrés** ici, l'argent est rendu hors plateforme.
- **La validation d'un virement ou d'un paiement mobile est humaine** : l'outil ne peut pas le vérifier. Pas de double validation pour les gros montants.
- **Caisse mono-devise** : le montant attendu à la clôture additionne les encaissements de toutes devises ; la caisse n'enregistre pas de devise.
- **Documents non validés par un comptable ou un juriste** : pas de mentions légales (numéro fiscal, taxe), pas de logo ; PDF sobre. Aucun moteur de taxes : une ligne de taxe ne vient que de la grille, la douane est saisie à la main. Export **CSV seulement** (aucune interface avec un logiciel comptable).
- **Pas de relance d'échéance** : la date d'échéance est indicative. Les événements `delivery.scheduled` et `package.delivered` n'ont pas d'émetteur (phase 8).
- **Téléphone non vérifié** : aucun SMS n'est envoyé (aucun prestataire) ; la vérification du téléphone reste absente.
- Livraison des e-mails « au moins une fois » (un arrêt entre l'envoi SMTP et son enregistrement peut produire un doublon) ; traitement de fond dans le processus de l'API, sans alerte ni mesure ; 5 tentatives maximum.
- Les données de démonstration (`seed-demo`) ne contiennent pas encore de factures ni de paiements.
- Le créole des nouveaux écrans et des modèles n'a pas été relu par un locuteur natif.

### Phase 8 : livraison, réclamations, tableaux de bord
Tournées, OTP, preuves, tentatives échouées (DEL-01 à 05) ; réclamations (ADM-04) ; indicateurs réels (ADM-02) ; journal d'audit consultable (ADM-03) ; tests parcours 11 et 12.

### Phase 9 : intégrations et robustesse
Revue de sécurité (OWASP ASVS niveau 2 comme guide), tests de charge du suivi et du calculateur, tests de restauration de sauvegarde, intégrations réelles uniquement avec des comptes de test.

### Phase 10 : production
Docker de production, procédures de déploiement et de sauvegarde, `docs/DEPLOYMENT.md`, `docs/SECURITY.md`, `docs/TEST_PLAN.md`, `docs/INTEGRATIONS.md`, `docs/API.md`, liste finale des risques bloquants.

## Questions à régler avant ou pendant les phases

| Question | Avant la phase |
|---|---|
| Nom et identité définitifs de la marque | 4 |
| Fournisseurs de paiement, SMS, WhatsApp, e-mail réellement disponibles | 7 |
| Entrepôts et agences réels, grilles tarifaires réelles, diviseur volumétrique | 5 |
| Politique de paiement par défaut (avant expédition ou avant remise) | 5 |
| Textes juridiques (CGU, confidentialité) validés par un juriste | 10 |
| Achat assisté chez des marchands : dans ou hors périmètre | 5 |
| Hébergement de production | 10 |
