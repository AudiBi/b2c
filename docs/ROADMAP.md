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
| 8 | Livraisons, réclamations, tableaux de bord | ☑ 856 tests au total ; réserves ci-dessous |
| 9 | Intégrations, tests de sécurité, tests de charge | ☑ 898 tests au total ; réserves ci-dessous |
| 10 | Documentation finale, déploiement, préparation à la production | ☑ 899 tests au total ; **non prête pour le public** : voir [RISKS.md](RISKS.md) |

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
| # | Tâche | Exigences |
|---|---|---|
| 8.1 | Tournées, affectation d'un livreur, arrêts, départ, clôture | DEL-01 |
| 8.2 | Remise : code (OTP), pièce d'identité, photo, bénéficiaire, au comptoir et par le livreur | DEL-02 |
| 8.3 | Livraison non aboutie, motif, reprogrammation, retour en agence | DEL-03 |
| 8.4 | Un livreur ne voit que ses tournées | DEL-04 |
| 8.5 | Remise bloquée si solde dû, dérogation permise et tracée | DEL-05 |
| 8.6 | Réclamations : ouverture, affectation, échanges, notes internes, clôture | CLI-13, ADM-04 |
| 8.7 | Tableau de bord : indicateurs calculés sur les données réelles | ADM-02 |
| 8.8 | Journal d'audit consultable (écran) | ADM-03 |
| 8.9 | Tests : parcours 11 et 12 ; OTP forcé, solde dû, livreur d'un autre, réclamation | – |

**Réalisé en phase 8** : 8.1 à 8.9, avec les écrans.
- **Tournées** (`TOU-AAAA-NNNNNN`) : planifiées par le responsable d'une agence pour un livreur ; un colis arrivé (ou prêt pour retrait) devient un **arrêt** avec l'adresse de livraison **figée** à la planification ; le client est prévenu (`delivery.scheduled`, avec la date) ; le **départ** fait passer tous les colis « en cours de livraison » (tout ou rien) ; clôture seulement quand tous les arrêts sont traités ; annulation d'une tournée planifiée libère les colis. Cycle de vie et arrêts protégés par des déclencheurs (une tournée close ne change plus, un arrêt traité non plus, un colis n'est que sur un arrêt en attente à la fois).
- **Remise** (au comptoir ou par le livreur) : règle de preuves **par entreprise** (code du client, pièce d'identité — type et **4 derniers caractères seulement** —, photo de preuve), bénéficiaire autorisé (actif, dans ses dates, pièce concordante) ou client, tentative **en ajout seul** avec l'auteur. Le **code de remise** (6 chiffres) est généré par le client dans son espace, **montré une fois**, conservé sous forme d'empreinte HMAC, valable 72 h, annulé par un nouveau code, **verrouillé après 5 essais erronés** (les essais sont comptés même quand l'opération échoue), 5 codes par colis et par heure au plus.
- **Solde dû** : la remise est refusée (`BALANCE_DUE`) s'il reste un solde sur une facture active du colis, ou si le colis n'est pas facturé quand l'entreprise fait payer à la remise ; **dérogation** réservée à `delivery:override_balance`, motif obligatoire, inscrite dans la tentative et le journal d'audit (`delivery.completed_with_override`).
- **Le livreur** ne voit et ne traite que **ses** tournées (« Mes tournées ») ; l'arrêt, la tournée ou le colis d'un autre sont des 404 ; il n'a aucun accès aux montants ni à la remise au comptoir.
- **Livraison non aboutie** : motif de la liste (client absent, adresse, refus, accès, solde, autre), précision interne, date de reprogrammation indicative ; le colis revient « prêt pour retrait » à l'agence et le client reçoit **un** message adapté (`delivery.failed`) ; au 3e échec l'interface propose le retour du colis.
- **Réclamations** : ouvertes par le client (éventuellement sur un de ses colis), numérotées `CLM-AAAA-NNNNNN`, échanges de messages, **notes internes jamais montrées au client**, affectation, clôture (résolue ou rejetée) avec résolution obligatoire, réouverture possible ; le client est prévenu (`claim.updated`) ; messages en ajout seul.
- **Tableau de bord** (`report:read` sur toute l'entreprise) : clients, colis reçus / en transit / en attente de paiement / à livrer / remis, expéditions par mode, volumes par entrepôt, encaissé / remboursé / facturé / impayé **par devise**, retenues et réclamations, **délais moyens** (entrepôt, transport, agence) avec le nombre de colis mesurés, performance par agence et par livreur. Aucune valeur de remplacement : une moyenne sans mesure vaut `null` et l'écran dit « Pas de mesure ».
- **Journal d'audit** : écran en lecture seule (filtres action et type d'objet, détails avant / après).
- **Site** : « Mes réclamations » et le code de remise (fiche du colis) pour le client ; « Tournées », « Mes tournées », « Réclamations », « Tableau de bord », « Journal d'audit » et, sur la fiche d'un colis, la remise au comptoir avec l'historique des tentatives, pour le personnel (menu selon les droits).
- Quatre événements de notification supplémentaires ou complétés : `delivery.scheduled` (avec date), `package.delivered`, `delivery.failed`, `claim.updated` (14 événements au total).
- Défaut trouvé par la recette : l'**administrateur de l'entreprise ne pouvait pas inviter un livreur** (anti-escalade : il ne détenait pas `delivery:read_assigned`) ; il le détient désormais (il ne donne accès qu'aux tournées confiées à soi-même).

**Réserves de la phase 8 (reportées)** :
- **Pas de signature** de remise (preuves : code, pièce, photo) ; la photo est une pièce jointe PHOTO du colis, **ajoutée par le personnel depuis la fiche du colis** (le livreur ne peut pas la prendre depuis son écran). Le code n'est lisible que dans l'espace du client : aucun envoi par SMS (aucun prestataire) ; un client sans accès à son espace ne peut pas remettre de code (la règle peut être assouplie pour toute l'entreprise, pas colis par colis).
- **Pas de zones de livraison, de transporteurs, de services ni de taxes configurables** (reste de ADM-01) ; pas d'optimisation d'itinéraire, de carte, de position GPS ni d'heure d'arrivée ; ordre des arrêts non modifiable ; un arrêt retiré ne se rajoute pas à la même tournée ; pas d'application mobile ni de mode hors ligne pour le livreur. La portée `ROUTE` des rôles n'est pas utilisée (le livreur est désigné par la tournée).
- **Retour à l'expéditeur / au fournisseur** : seul le retour du colis à l'agence après un échec est automatique ; le passage à `RETURNED` reste une décision du personnel (transition générique).
- **Solde** : les factures actives d'un colis sont additionnées **sans conversion de devise** ; la devise affichée est celle de la dernière facture.
- **Tableau de bord** : réservé aux droits portant sur toute l'entreprise (un responsable d'agence reçoit un 403 explicite, pas de tableau limité à son agence) ; pas de graphique, de tendance ni d'export (`report:export` non utilisé) ; période de 366 jours au plus ; moyennes seulement (ni médiane ni percentiles).
- **Réclamations** : pas de pièces jointes, de délai de réponse suivi (SLA), d'escalade ni de mesure de satisfaction ; affectation possible à tout membre actif du personnel ; le client n'est prévenu que des réponses visibles et des changements d'état.
- Les données de démonstration (`seed-demo`) ne contiennent pas encore de tournées, de remises ni de réclamations. Le créole des nouveaux écrans et des nouveaux modèles de messages n'a pas été relu par un locuteur natif.

### Phase 9 : intégrations et robustesse
Revue de sécurité (OWASP ASVS niveau 2 comme guide), tests de charge du suivi et du calculateur, tests de restauration de sauvegarde, intégrations réelles uniquement avec des comptes de test.

| # | Tâche | Résultat |
|---|---|---|
| 9.1 | Revue de sécurité guidée par ASVS niveau 2 ; audit des dépendances | ☑ [SECURITY.md](SECURITY.md) (écart principal : second facteur du personnel) |
| 9.2 | Double authentification TOTP, codes de secours, obligation du personnel | ☑ API, base (migration 0009), écrans, 3 langues |
| 9.3 | Tests de charge du suivi public et du calculateur | ☑ `npm run loadtest` : chiffres réels dans [TEST_PLAN.md](TEST_PLAN.md) |
| 9.4 | Test de restauration d'une sauvegarde | ☑ `npm run backup:check` : 17 contrôles, tous réussis |
| 9.5 | Intégration réelle : stockage S3 | ◐ adaptateur testé contre **SeaweedFS** seulement ; aucun autre fournisseur |
| 9.6 | Intégrations de paiement, SMS, WhatsApp, transporteurs | ❌ **non faites** : aucun compte de test n'existe, rien n'est simulé |

**Réalisé en phase 9** :
- **Double authentification** (`/v1/me/2fa/*`, connexion en deux temps) : TOTP standard (RFC 6238, vecteurs officiels reproduits), secret chiffré au repos, code à usage unique, 10 codes de secours (empreinte HMAC), mot de passe exigé pour activer / désactiver / régénérer, échecs comptés dans le verrouillage. `REQUIRE_STAFF_2FA=true` (obligatoire en production) enferme tout compte du personnel non équipé sur sa page Sécurité. Défauts trouvés en chemin : une expression régulière perdue par l'outil d'écriture (`/^d{6}$/`) refusait tous les codes ; vue par un test d'intégration avant toute livraison.
- **Dépendances** : `multer` et `js-yaml` corrigés (`overrides`) ; en production il ne reste que 3 alertes « élevées » de l'outil en ligne de commande Prisma (détail dans SECURITY.md).
- **Charge** : banc `scripts/loadtest/run.mjs` (20 000 colis, 60 000 événements, API compilée, autocannon, Redis dédié, base de test uniquement). Chiffres, limites et conditions dans [TEST_PLAN.md](TEST_PLAN.md) ; la limite par adresse IP laisse passer exactement 30 requêtes par minute, sans aucune erreur serveur.
- **Sauvegarde / restauration** : `npm run backup:check` sauvegarde la base de test (`pg_dump -Fc`), la restaure dans une base neuve (`pg_restore`), compare lignes et empreintes des tables sensibles, puis vérifie avec le **rôle applicatif** que l'isolation par entreprise et l'audit en ajout seul ont survécu.
- **Stockage S3** : `STORAGE_DRIVER=s3`, adaptateur `S3Storage` (client `@aws-sdk/client-s3`), service Docker `seaweedfs` (profil `storage`) à la place de MinIO (image introuvable), `npm run s3:init` / `npm run test:s3`. Défaut relevé par un test : SeaweedFS crée silencieusement un bucket absent (S3 répond `NoSuchBucket`) → désactivé dans le compose.

**Réserves de la phase 9 (reportées)** :
- **Aucune intégration externe de production n'a été faite** : pas de prestataire de paiement, de SMS, de WhatsApp, de transporteur ni de fournisseur d'e-mail de production, faute de compte de test. Le webhook de paiement, le SMS et le code de remise par SMS restent inexercés avec un vrai service.
- **S3** : essayé uniquement avec SeaweedFS, dans Docker, en local. Pas d'AWS S3 ni d'autre fournisseur, pas de lien pré-signé direct vers le stockage (les fichiers passent encore par l'API), pas de chiffrement ni de cycle de vie, et le test de restauration ne couvre pas les fichiers.
- **Charge** : mesurée sur **une seule machine** (générateur de charge, API, PostgreSQL et Redis ensemble, Windows + Docker Desktop) : les chiffres sont des ordres de grandeur, pas une capacité de production. Le suivi public coûte deux transactions par requête et n'a pas été optimisé ni profilé. Pas de test de charge des écrans du personnel, de l'émission des factures ni du traitement des notifications, pas de test d'endurance.
- **Sauvegarde** : vérifie la restauration d'**une** base de test (2,2 Mio) ; aucune sauvegarde planifiée, aucune rétention, aucun chiffrement, aucune copie hors machine, aucune restauration partielle, aucune mesure sur une grosse base.
- **Revue de sécurité** : par lecture du code et des tests, guidée par ASVS ; ni test d'intrusion, ni analyse automatique du code (SAST), ni audit externe. Les alertes d'outils de développement restent (vitest, autocannon, jest) : voir SECURITY.md.
- **Double authentification** : pas de WebAuthn, de SMS ni de réinitialisation par un administrateur ; pas de code QR ; testée avec des codes calculés par les tests, jamais avec une vraie application d'authentification ; absente de la recette navigateur.
- Le créole des nouveaux écrans (double authentification) n'a pas été relu par un locuteur natif.
- **Confirmation de pesée furtive** (relevée par la recette navigateur) : le message « Pesée enregistrée. » disparaît presque aussitôt, car le panneau de pesée se ferme au rechargement de la fiche du colis ; le test vérifie désormais le résultat, mais l'agent ne voit presque pas la confirmation. À améliorer (message au niveau de la page).

### Hors plan initial : panel d'administration séparé du site
Demande de l'utilisateur : « détacher le panel admin du site, le faire séparément et très professionnel ». Détail : [ADMIN.md](ADMIN.md).

**Réalisé** :
- **Application `apps/admin`** (React 19, Vite, même package partagé que le site) : coque professionnelle (barre latérale groupée selon les droits, barre du haut avec langue et menu du compte, adaptée au téléphone), écran de connexion dédié (personnel / équipe plateforme, second facteur), système de design propre (`admin.css`).
- **Écrans du personnel déplacés** du site vers le panel (réception, colis, entrepôt, lots, agence, tournées, réclamations, factures, paiements, notifications, tableau de bord, audit, sécurité) ; adresses sans préfixe de langue ; langue au choix de l'utilisateur.
- **Nouveaux écrans** : **Utilisateurs** (liste filtrée, invitation avec rôle et portée, fiche, ajout et retrait de rôle, désactivation), **Rôles et droits** (catalogue en lecture seule), **Entreprises** (création, suspension, réactivation, pour l'équipe plateforme).
- **Site allégé** : plus aucun écran du personnel ; un compte du personnel qui s'y connecte est dirigé vers le panel.
- **API** : cookies de session **distincts** pour le panel (`X-Client-App: admin` → `b2c_admin_refresh`/`b2c_admin_session`) ; liens d'invitation et de réinitialisation du **personnel** vers le panel (`ADMIN_PUBLIC_URL`).
- **Production** : même nginx, second nom de domaine (`ADMIN_HOST`), en-têtes dédiés ; contrôle de fumée étendu (`SMOKE_ADMIN_URL`).
- **Défauts trouvés** : nom accessible du menu du compte sans son texte visible (WCAG 2.5.3, relevé par axe) ; durée d'attente trop courte du premier écran chargé à la demande dans les tests d'interface ; test de signature de webhook sensible à la lenteur de la machine (marge élargie).

**Réserves** : voir « Limites connues » de [ADMIN.md](ADMIN.md) — pas de rôles personnalisés, pas de réinitialisation du second facteur par un administrateur, une entreprise par construction, écrans repris tels quels des phases 6 à 8 (contenu inchangé, habillage nouveau), créole des nouveaux textes à relire, panel essayé sur la pile de production **locale** seulement.

### Phase 10 : production
Docker de production, procédures de déploiement et de sauvegarde, `docs/DEPLOYMENT.md`, `docs/SECURITY.md`, `docs/TEST_PLAN.md`, `docs/INTEGRATIONS.md`, `docs/API.md`, liste finale des risques bloquants.

| # | Tâche | Résultat |
|---|---|---|
| 10.1 | Images Docker de production (API, tâche de migration, site + nginx HTTPS) | ☑ construites et lancées |
| 10.2 | Pile de production `docker/compose.prod.yml` (réseau interne, secrets générés, réglages de production imposés) | ☑ essayée en local |
| 10.3 | Contrôle de fumée de production (`npm run prod:smoke`) | ☑ 22 contrôles sur 22 |
| 10.4 | Sauvegarde, exercice de restauration, reconstruction après sinistre | ☑ essayés de bout en bout |
| 10.5 | `DEPLOYMENT.md` (installation, mises à jour, sauvegardes, restauration, exploitation) | ☑ |
| 10.6 | Liste finale des risques bloquants ([RISKS.md](RISKS.md)) | ☑ |
| 10.7 | Mise en ligne réelle (serveur, domaine, certificat, e-mail) | ❌ **non faite** : aucun serveur ni compte fournis |

**Réalisé en phase 10** :
- **Images** (`docker/Dockerfile`, 3 cibles) : `api` (dépendances de production seulement, utilisateur `node`, contrôle de santé), `migrate` (migrations Prisma puis amorçage, tâche ponctuelle), `web` (site pré-rendu servi par nginx qui termine le HTTPS, CSP stricte, HSTS, redirection HTTP→HTTPS, relais `/v1`). Le site est construit pour **une** entreprise.
- **Pile** (`docker/compose.prod.yml`, `.env.production.example`, `npm run setup:env:prod`) : seul nginx publie des ports ; PostgreSQL (rôle applicatif soumis à la RLS créé à l'initialisation) et Redis (mot de passe) restent internes ; les réglages de production sont imposés (cookies sécurisés, double authentification obligatoire, documentation de l'API fermée).
- **Exploitation** : `npm run prod:backup` (base + pièces jointes, empreintes SHA-256, relecture par `pg_restore -l`), `npm run prod:drill` (restauration dans une base temporaire et comparaison), `npm run prod:smoke`.
- **Essais réels** (détail dans DEPLOYMENT.md § 8) : pile construite et lancée depuis zéro ; 22 contrôles de fumée réussis, dont l'impossibilité de contourner la limite de débit en falsifiant `X-Forwarded-For` et l'enfermement d'un compte du personnel sans second facteur ; e-mail d'invitation réellement reçu ; mise à jour idempotente ; **sinistre simulé** (volumes supprimés) puis reconstruction depuis la sauvegarde, double authentification comprise.
- **Défaut trouvé par ces essais** : les variables vides transmises par `docker compose` (`S3_ENDPOINT=`) faisaient échouer la validation de la configuration de l'API ; une variable vide vaut maintenant une variable absente (test ajouté).

**Réserves de la phase 10 (reportées)** : voir [RISKS.md](RISKS.md), qui est la liste de référence. En résumé : aucun déploiement essayé sur un vrai serveur, domaine, certificat ni fournisseur d'e-mail ; sauvegardes non planifiées ni copiées hors serveur ; aucune supervision ; la recette navigateur complète n'a pas été rejouée contre la pile de production (seul le contrôle de fumée l'a été) ; une seule instance, sans haute disponibilité ; textes juridiques à valider ; test d'intrusion à faire.

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
