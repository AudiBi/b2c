# Plan de test

Phases 3 à 6. Ce document sera étendu à chaque phase. **Seuls les résultats d'exécutions réelles y figurent.**

## Exécuter

```bash
npm run docker:up     # PostgreSQL, Redis, Mailpit doivent tourner
npm test              # package partagé + API (intégration) + site (unitaire)
npm run test:e2e      # recette navigateur : construit l'API et le site, lance Playwright
```

- **API** : tests d'intégration. L'application complète (NestJS) est interrogée en HTTP contre un vrai PostgreSQL (rôle applicatif soumis à la RLS), un vrai Redis et un transport e-mail en mémoire. Un client Prisma avec le rôle de migration sert uniquement à préparer ou vérifier les données. Chaque test crée ses propres entreprises et utilisateurs (identifiants aléatoires) et utilise une adresse IP fictive distincte (`X-Forwarded-For`).
- **Site, unitaires** (Vitest + jsdom) : traductions, client d'API, formulaires, rendu serveur des 63 pages.
- **Site, recette navigateur** (Playwright) : vrai navigateur, vraie API compilée, site pré-rendu servi comme en production (avec la CSP de référence), base de test, e-mails réels envoyés à Mailpit et lus par le test. La base `b2c_test` n'est jamais confondue avec la base de développement (garde-fou sur le nom). Navigateur : Chromium de Playwright (`npx playwright install chromium`), sinon Microsoft Edge installé (`E2E_CHANNEL=msedge`).

## Derniers résultats

Exécutés le 2026-10-27, Windows 11, Node 22.21.1, PostgreSQL 17, Redis 7, Chromium de Playwright.

| Suite | Tests | Résultat |
|---|---|---|
| `packages/shared` (catalogue, `PermissionSet`, schémas, machine d'états des colis, des lots, numéro de suivi, finance et notifications, **remise, tournées, réclamations, période du tableau de bord**) | 88 | ✅ |
| API `rls.spec.ts` (isolation au niveau de la base) | 18 | ✅ |
| API `auth.spec.ts` | 40 | ✅ |
| API `iam.spec.ts` (politique des routes, matrice des rôles, invitations, plateforme) | 47 | ✅ |
| API `customers.spec.ts` (code client, profil, adresses, bénéficiaires, entrepôts, adresses de réception, public) | 48 | ✅ |
| API `calculator.spec.ts` (formules pures : unités, poids volumétrique, arrondis, tranches, suppléments, taxes, décimal exact) | 26 | ✅ |
| API `pricing.spec.ts` (grilles : brouillon/activation/immuabilité/chevauchement, catégories, calculateur public, estimations client) | 29 | ✅ |
| API `packages.spec.ts` (préalertes, rapprochement, portées, identification/fusion, pesée, machine d'états, déclencheurs, regroupement, recherche, suivi public) | 54 | ✅ |
| API `files.spec.ts` (contenu réel, taille, PDF actif, accès, liens signés, suppression, fusion) | 20 | ✅ |
| API `warehouse-ops.spec.ts` (emplacements, mouvements, inventaire, anomalies, scan, agences, isolation) | 24 | ✅ |
| API `shipments.spec.ts` (création, droits, chargement, départ/arrivée/douane/clôture/annulation, agence, manifestes CSV/PDF, base) | 33 | ✅ |
| API `finance.spec.ts` (brouillon, remise, émission et numérotation simultanées, avoirs, immuabilité en base, caisse, espèces, idempotence, concurrence, déclaration / validation / refus, remboursements, PDF, export CSV, synthèse, isolation) | 38 | ✅ |
| API `webhooks.spec.ts` (signature, horodatage, altération, rejeu simultané, montant ou devise différents, référence inconnue, échec du prestataire, isolation, ajout seul) | 11 | ✅ |
| API `notifications.spec.ts` (événements, langue, préférences, SMS ignoré, déduplication, nouvelles tentatives, échec définitif et relance, modèles, injection d'en-têtes, file vidée en un traitement, émetteurs, portail, isolation, base) | 25 | ✅ |
| API `delivery.spec.ts` (tournées, droits, arrêts, départ « tout ou rien », livreur limité à ses tournées, code de remise et verrouillage, preuves, bénéficiaires, photo, solde dû et dérogation, remise au comptoir, échecs, base, isolation) | 28 | ✅ |
| API `claims.spec.ts` (ouverture, isolation, notes internes, affectation, responsables affectables, clôture et réouverture, notifications, base) | 10 | ✅ |
| API `reports.spec.ts` (tableau de bord vide, chiffres réels, revenus et impayés par devise, incidents, période, droits, livreurs) | 7 | ✅ |
| API `rate-limit.spec.ts` | 7 | ✅ |
| API `infra.spec.ts` (compteurs, idempotence) | 9 | ✅ |
| API `app.spec.ts` (santé, en-têtes, CORS, erreurs, configuration) | 14 | ✅ |
| Site, unitaires (9 fichiers : + `phase8`) | 192 | ✅ |
| Site, recette navigateur (+ `delivery`) | 88 | ✅ |
| **Total** | **856** | **856 réussis, 0 échec** |

La recette navigateur couvre notamment : les **17 pages publiques × 3 langues** (51 pages) avec contrôle automatique d'accessibilité WCAG 2.1 A/AA (axe) sur ordinateur **et** sur téléphone (375 px), absence de défilement horizontal, absence d'erreur console (donc de violation de la CSP) ; le HTML pré-rendu sans JavaScript (titre, description, `canonical`, `hreflang`) ; le sitemap et robots.txt ; la page 404 avec statut 404 ; le sélecteur de langue ; la navigation au clavier (lien d'évitement) ; et tout le parcours client : inscription → e-mail réel → confirmation → connexion → code client → adresses de réception → profil → adresses → bénéficiaires → mot de passe → déconnexion, redirection vers la page demandée, redirection externe refusée, mot de passe oublié, jeton à usage unique, inscription en créole.

La recette de la phase 5 ajoute : calculateur (poids réel, volumétrique, assurance, détail, validation FR/EN, téléphone 375 px, axe) ; parcours complet **préalerte → facture jointe (lien signé vérifié) → réception rapprochée → pesée → frais provisoires → suivi public sans connexion (aucune donnée personnelle dans le texte de la page) → retenue en douane** ; doublon de numéro marchand ; modification et annulation en deux temps ; un client ne peut pas ouvrir le colis d'un autre ; suivi en créole.

La recette de la phase 6 ajoute le parcours complet **préalerte → lecture du code en entrepôt (reçu, relu, inconnu) → pesée → autorisation → rangement → lot (chargement refusé puis accepté) → manifestes CSV et PDF réellement téléchargés → départ → arrivée → clôture refusée → réception en agence → prêt pour retrait → point de retrait chez le client et dans le suivi public**, avec contrôle d'accessibilité sur chaque écran du personnel, l'absence d'accès d'un client aux écrans du personnel (interface et API), la liste publique des agences sur téléphone, et les écrans en créole et en anglais.

La recette de la phase 7 ajoute le parcours complet **client inscrit → colis pesé → le personnel crée un brouillon à partir du colis, l'émet → le client voit « À payer », déclare un virement (référence trop courte refusée) → le paiement reste « en attente » → un agent le valide dans la file → facture « Payée », reçu téléchargeable, colis « prêt pour expédition » → traitement des notifications → le client lit « facture à régler » et « paiement reçu » dans son portail → l'e-mail de paiement est réellement arrivé dans Mailpit → encaissement en espèces d'un second colis (refusé sans caisse ouverte, accepté après ouverture)**, avec contrôle d'accessibilité (axe, WCAG 2.1 A/AA) sur les huit écrans de ce parcours.

La recette de la phase 8 ajoute le parcours complet **colis arrivé et « prêt pour retrait » → le client obtient son code (lu à l'écran) → le personnel tente un code faux (refusé), puis le bon : colis remis, tentative et historique visibles → un livreur invité (rôle « Livreur ») se connecte et ne voit que « Mes tournées » → le personnel planifie une tournée de deux colis et la fait partir → le livreur remet un colis avec le code du client et déclare un échec « client absent » pour l'autre (le colis revient « prêt pour retrait ») → le personnel termine la tournée → le client ouvre une réclamation depuis le colis, le service répond puis clôture avec une résolution (refusée sans résolution) → tableau de bord et journal d'audit**, avec contrôle d'accessibilité sur les écrans de ce parcours.

### Défauts réels détectés par ces tests pendant la phase 8 (corrigés)
1. **L'administrateur de l'entreprise ne pouvait pas inviter un livreur** (403 anti-escalade : il ne détenait pas `delivery:read_assigned`) — révélé par la recette navigateur, verrouillé ensuite par un test d'API.
2. **Utilisateur de test créé avec le mauvais type** : l'aide de test considérait « CUSTOMER_SERVICE » (personnel) comme un client parce que son nom commence par CUSTOMER ; le bogue ne touchait que le banc de test, mais il cachait l'impossibilité d'affecter une réclamation à un agent du service client.
3. Messages de validation de la phase 8 (« résolution obligatoire », « bénéficiaire obligatoire ») affichés « Valeur invalide » au lieu de « Ce champ est obligatoire » : codes ajoutés à la traduction des erreurs.
4. Noms accessibles en double (formulaires de réponse et de recherche portant le nom de leur champ) sur les écrans de réclamations : relevés par les tests d'interface, corrigés.
5. **Traitement des notifications limité à 20 e-mails par tour** (un tour toutes les 10 secondes) : un afflux d'événements retardait les messages suivants (relevé quand la recette complète a dépassé le délai d'attente d'un e-mail de paiement). Le traitement enchaîne maintenant des tours (au plus 20) tant qu'il y a du travail ; un test envoie 60 e-mails en un seul traitement.
6. **Recette navigateur : deux parcours qui se marchent dessus** (le parcours de livraison créait des lots dans l'entreprise de recette partagée, et la liste des lots d'un autre parcours montrait ce lot en tête) : le parcours de livraison tourne désormais dans un projet qui passe après les autres.

### Défauts réels détectés par ces tests pendant la phase 7 (corrigés)
1. **Impossible de créer le moindre brouillon de facture (500)** : Prisma refusait `company_id` dans la création imbriquée des lignes ; les lignes sont créées à part. Relevé dès le premier test d'API (35 échecs sur 38).
2. **Export CSV : montants négatifs (remboursements, avoirs) précédés d'une apostrophe** par la protection contre l'injection de formules, ce qui les rendait illisibles comme nombres dans un tableur. Les montants (produits par le serveur, jamais saisis) sont écrits tels quels ; les cellules textuelles restent protégées.
3. **Règle des hooks violée dans la navigation de l'espace connecté** (pastille des notifications appelée après les retours anticipés) : relevé par les tests d'interface, corrigé.
4. **Accessibilité** : un bouton « Chercher » dont le nom accessible était « Rechercher (…) » (le texte visible doit figurer dans le nom : WCAG 2.5.3), relevé par axe dans la recette navigateur.
5. **Défauts de banc de test (pas du produit)** : horloge de la base ≠ horloge du test (un événement créé « maintenant » par la base n'était pas encore échu pour le test), préfixes de suivi aléatoires qui se télescopaient (vérification en base ajoutée), attente à l'intérieur d'une chaîne `supertest` (serveur déjà refermé). Une exécution de la suite complète lancée **en même temps** qu'une autre sur la même base a produit un échec sans rapport : les suites ne doivent jamais se chevaucher.

### Défauts réels détectés par ces tests pendant la phase 6 (corrigés)
1. **Colis reçu sans préalerte impossible à peser** : aucun moyen d'en fixer le mode de transport (`register` accepte maintenant `transportMode` quand il manque).
2. **Droits d'agence évalués sur le mauvais objet** : la table de transitions contrôlait toute permission sur l'entrepôt d'origine ; les permissions `agency:*` se vérifient maintenant sur l'agence de destination.
3. **Portées de rôle sans contrôle** : un rôle pouvait être attribué pour un entrepôt ou une agence inexistant ou d'une autre entreprise (`SCOPE_NOT_FOUND`).
4. **Noms accessibles en double** (formulaire de lecture et formulaire de recherche portant le même nom que leur champ) : relevé par les tests d'interface, corrigé sur les écrans du personnel **et** « Mes colis » (phase 5).
5. Test d'interface instable au premier rendu du module chargé à la demande (délai porté à 5 s).

### Défauts réels détectés par ces tests pendant la phase 5 (corrigés)
1. **Modification d'une catégorie ou d'une préalerte qui réinitialisait des champs** : les schémas « partiels » gardaient les valeurs par défaut (`restricted: false`, devise `USD`) ; un renommage aurait levé la restriction d'une catégorie. Schémas de modification réécrits sans défauts.
2. **Fusion d'un colis non identifié impossible (500)** : droit `UPDATE` manquant sur `file_objects` (migration 0005) et transition `RECEIVED_AT_WAREHOUSE` → `CANCELLED` absente de la table.
3. **Recherche par code client sans résultat** : le tiret du code était supprimé de la saisie (« TT-000002 » → « TT000002 »).
4. **Détail d'événements** : `map(publicEventDto)` passait l'index comme second paramètre (détecté par le compilateur après l'ajout du paramètre « public »).
5. **Motifs de retenue sensibles** (« contenu suspect », « article interdit ») visibles de quiconque détenait le numéro : masqués dans le suivi public.
6. **Relancer le suivi du même numéro réaffichait le résultat en mémoire** au lieu de relire le serveur (recette navigateur).
7. **Déconnexion depuis l'espace client** parfois renvoyée vers la page de connexion au lieu de l'accueil (course entre deux navigations ; test préexistant devenu instable).
8. Frais « provisoires » affichés vides au client quand aucun tarif ne s'applique : l'encadré est maintenant masqué.

### Défauts réels détectés par ces tests pendant la phase 4 (corrigés)
1. **Lien d'évitement inaccessible au clavier** : le focus était déjà sur la zone principale à cause d'un effet rejoué par React (test de navigation au clavier).
2. **Nom accessible des liens de langue** (« Français ») ne contenant pas le texte visible (« FR ») : critère WCAG 2.5.3 (axe).
3. **Liens des e-mails sans préfixe de langue** (`/verify-email` au lieu de `/fr/verify-email`) : relevé à la relecture avant la recette, verrouillé ensuite par des tests API et E2E.
4. **Appel de renouvellement de session à chaque visite anonyme** (erreur 401 en console, consommation de la limite de débit) : remplacé par un cookie « indice » lisible.
5. **Test de purge** de la base de test qui ne couvrait pas les nouvelles tables ; **limite de débit globale** déclenchée par des tests partageant la même IP (corrigé dans le banc de test).

## Couverture des parcours du cahier des charges (§18)

| # | Parcours | État |
|---|---|---|
| 1 | Un client crée son compte et se connecte | ✅ API et navigateur |
| 2-5, 7 | Préalerte, réception et rapprochement, pesée, calculateur, statuts de colis | ✅ API et navigateur (phase 5) |
| 6 | Lot de transport, manifeste, propagation aux colis | ✅ API et navigateur (phase 6) |
| 9, 10 | Paiement (espèces, virement déclaré puis validé), notifications | ✅ API et navigateur (phase 7) |
| 11, 12 | Remise au client (code, pièces, solde dû, tournée du livreur), réclamations | ✅ API et navigateur (phase 8) |
| 13 | Un client ne peut pas consulter les données d'un autre client | ✅ pour ce qui existe : utilisateurs, journal d'audit, adresses, bénéficiaires, adresses de réception, entrepôts, **préalertes, colis, pièces jointes, estimations** (API et navigateur), base entière via RLS ; à rejouer sur factures |
| 14 | Un employé ne peut pas faire une opération interdite à son rôle | ✅ matrice sur toutes les routes existantes, portées d'entrepôt, autorisation avant validation, anti-escalade, dernier administrateur |
| 15 | Erreurs de paiement ou de notification traitées | ✅ échec d'envoi d'e-mail simulé : tentatives espacées, échec visible, relance ; paiement refusé, doublon de référence, surpaiement, rejeu de confirmation, signature invalide. ❌ Non testé : un **vrai** prestataire de paiement ou SMTP de production |

| Autre exigence | État |
|---|---|
| Doublons | ✅ 5 préalertes simultanées avec le même numéro marchand → 1 ; 5 réceptions simultanées du même colis → 1 ; 4 changements de statut simultanés → 1 ; inscriptions simultanées (1 compte, 0 erreur 500), 12 inscriptions simultanées → 12 codes clients distincts, adresses de réception sans doublon sous 10 consultations simultanées |
| Accès concurrents | ✅ compteurs, idempotence, renouvellement de jeton, retrait mutuel de rôles administrateur, pool de connexions |
| Erreurs réseau | ✅ Redis injoignable (503 / échec fermé, routes ordinaires disponibles) ; client d'API : panne réseau, 401 puis renouvellement, renouvellement refusé. ❌ non testé : panne PostgreSQL, SMTP injoignable |
| Données invalides | ✅ champs inconnus, formats, JSON mal formé, corps trop gros, mots de passe faibles, jetons falsifiés, validation côté navigateur ET serveur, en trois langues |
| Transitions de statut interdites | ✅ test exhaustif des 289 paires (paquet partagé) + refus au niveau API (409) + refus en base sans événement |
| Tests de charge | ⏳ phase 9 |

## Contrôles manuels réalisés
- **Détection des tests** (phase 3) : trois protections cassées volontairement puis rétablies (révocation de famille de sessions, garde de permissions, politique RLS) : les tests échouent comme attendu.
- **Navigateur intégré** : affichage de l'accueil (ordinateur et 375 px) et de l'inscription en créole.
- **E-mail réel** : une inscription a livré son e-mail à Mailpit via SMTP.
- `seed-demo` exécuté sur la base de test et refusé en production.

## Limites des tests actuels
- **Phase 8** : le code de remise est lu à l'écran du client (aucun SMS) ; la photo de preuve est simulée par une pièce jointe insérée en base (le chemin de dépôt de fichier est testé par la phase 5) ; les tournées ne sont testées que sur de petits volumes (2 à 3 arrêts) ; aucune mesure de performance des requêtes du tableau de bord sur un grand volume de données ; pas de test sur un téléphone réel pour l'écran du livreur.
- **Phase 7** : la confirmation signée est exercée avec un émetteur écrit pour les tests (aucun prestataire réel) ; l'échec d'envoi d'e-mail est simulé (SMTP injoignable réel non testé) ; les PDF de facture et de reçu sont vérifiés (document valide) mais pas visuellement ; pas de test de charge sur l'émission simultanée au-delà de 4 factures ; les écrans de finance ne sont testés que dans Chromium.
- **Phase 6** : le PDF du manifeste est vérifié (document valide, taille), pas visuellement ; le lecteur de codes-barres est simulé par la saisie ; aucun test de charge sur les scans (phase 9) ; les écrans du personnel ne sont testés que dans Chromium.
- **Phase 5 (levée en phase 6 pour les écrans)** : les opérations du personnel (réception, pesée…) sont testées par l'API, pas par une interface (elle n'existe pas). Aucun antivirus ni stockage S3 n'a été exercé. Les tests de transport, d'agence et de livraison attendent leurs modules. Charge et énumération des numéros de suivi : phase 9.
- **L'accessibilité automatisée (axe) ne détecte qu'une partie des problèmes.** Aucun test avec lecteur d'écran ni audit manuel n'a eu lieu : ne pas annoncer de conformité WCAG avant cet audit.
- Navigateurs testés : Chromium (et Edge pour le repli). Ni Firefox ni Safari. Pas de test sur un vrai téléphone ni sur un réseau lent.
- **Les traductions créoles n'ont pas été relues par un locuteur natif** ; les tests vérifient la structure, pas la qualité de la langue.
- Aucun test de performance : le fichier JavaScript principal pèse environ 277 Ko compressés (plus 51 Ko pour les écrans connectés, chargés à la demande) (voir WEB.md).
- Les tests de concurrence couvrent les cas écrits, pas tous les entrelacements possibles.
- Le pré-rendu et la CSP sont testés avec le serveur de `scripts/serve-dist.mjs`, pas avec un vrai nginx ou Apache.
- La base de test est partagée entre les fichiers (exécutés l'un après l'autre) ; l'isolation repose sur des identifiants aléatoires.
