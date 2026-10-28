# Plan de test

Phases 3 à 10. Ce document sera étendu à chaque phase. **Seuls les résultats d'exécutions réelles y figurent.**

## Exécuter

```bash
npm run docker:up     # PostgreSQL, Redis, Mailpit doivent tourner
npm test              # package partagé + API (intégration) + site (unitaire)
npm run test:e2e      # recette navigateur : construit l'API et le site, lance Playwright
npm run loadtest      # tests de charge (phase 9) : construit l'API, sème 20 000 colis dans la base de TEST, mesure
npm run backup:check  # test de restauration (phase 9) : sauvegarde la base de test, la restaure dans une copie, compare
npm run test:s3       # adaptateur S3 contre SeaweedFS (profil Docker « storage » : docker compose -f docker/compose.dev.yml --profile storage up -d seaweedfs)
```

Ne **jamais** lancer deux de ces commandes en même temps : elles partagent la base de test (un échec sans rapport a déjà été observé).

- **API** : tests d'intégration. L'application complète (NestJS) est interrogée en HTTP contre un vrai PostgreSQL (rôle applicatif soumis à la RLS), un vrai Redis et un transport e-mail en mémoire. Un client Prisma avec le rôle de migration sert uniquement à préparer ou vérifier les données. Chaque test crée ses propres entreprises et utilisateurs (identifiants aléatoires) et utilise une adresse IP fictive distincte (`X-Forwarded-For`).
- **Site, unitaires** (Vitest + jsdom) : traductions, client d'API, formulaires, rendu serveur des 63 pages.
- **Site, recette navigateur** (Playwright) : vrai navigateur, vraie API compilée, site pré-rendu servi comme en production (avec la CSP de référence), base de test, e-mails réels envoyés à Mailpit et lus par le test. La base `b2c_test` n'est jamais confondue avec la base de développement (garde-fou sur le nom). Navigateur : Chromium de Playwright (`npx playwright install chromium`), sinon Microsoft Edge installé (`E2E_CHANNEL=msedge`).

## Derniers résultats

Exécutés le 2026-10-28 (suites automatisées rejouées à la fin de la phase 10), Windows 11, Node 22.21.1, PostgreSQL 17, Redis 7, Chromium de Playwright.

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
| API `app.spec.ts` (santé, en-têtes, CORS, erreurs, configuration, **variables vides**) | 15 | ✅ |
| API `totp.spec.ts` + `two-factor.spec.ts` (vecteurs officiels RFC 6238, fenêtre, rejeu, chiffrement du secret, codes de secours, activation / désactivation, connexion en deux temps, verrouillage, obligation du personnel, base) | 31 | ✅ |
| API `s3-storage.spec.ts` : configuration (3, toujours exécutés) ; stockage réel (7, **ignorés** sans `npm run test:s3`, voir ci-dessous) | 3 + 7 ignorés | ✅ / ⏭ |
| Site, unitaires (10 fichiers : + `phase9`) | 200 | ✅ |
| Site, recette navigateur | 88 | ✅ |
| **Total de la suite standard** | **899** | **899 réussis, 0 échec** (7 tests de stockage S3 ignorés, exécutés à part) |

Stockage S3 contre un **vrai SeaweedFS** (`npm run test:s3`) : **10 tests sur 10 réussis** (3 de configuration + 7 de stockage, dont le parcours API complet), exécutés le 2026-10-28. Ils sont ignorés par `npm test` pour ne pas exiger ce service : la suite l'affiche comme « ignorés », elle ne les compte pas comme vérifiés.

La recette navigateur couvre notamment : les **17 pages publiques × 3 langues** (51 pages) avec contrôle automatique d'accessibilité WCAG 2.1 A/AA (axe) sur ordinateur **et** sur téléphone (375 px), absence de défilement horizontal, absence d'erreur console (donc de violation de la CSP) ; le HTML pré-rendu sans JavaScript (titre, description, `canonical`, `hreflang`) ; le sitemap et robots.txt ; la page 404 avec statut 404 ; le sélecteur de langue ; la navigation au clavier (lien d'évitement) ; et tout le parcours client : inscription → e-mail réel → confirmation → connexion → code client → adresses de réception → profil → adresses → bénéficiaires → mot de passe → déconnexion, redirection vers la page demandée, redirection externe refusée, mot de passe oublié, jeton à usage unique, inscription en créole.

La recette de la phase 5 ajoute : calculateur (poids réel, volumétrique, assurance, détail, validation FR/EN, téléphone 375 px, axe) ; parcours complet **préalerte → facture jointe (lien signé vérifié) → réception rapprochée → pesée → frais provisoires → suivi public sans connexion (aucune donnée personnelle dans le texte de la page) → retenue en douane** ; doublon de numéro marchand ; modification et annulation en deux temps ; un client ne peut pas ouvrir le colis d'un autre ; suivi en créole.

La recette de la phase 6 ajoute le parcours complet **préalerte → lecture du code en entrepôt (reçu, relu, inconnu) → pesée → autorisation → rangement → lot (chargement refusé puis accepté) → manifestes CSV et PDF réellement téléchargés → départ → arrivée → clôture refusée → réception en agence → prêt pour retrait → point de retrait chez le client et dans le suivi public**, avec contrôle d'accessibilité sur chaque écran du personnel, l'absence d'accès d'un client aux écrans du personnel (interface et API), la liste publique des agences sur téléphone, et les écrans en créole et en anglais.

La recette de la phase 7 ajoute le parcours complet **client inscrit → colis pesé → le personnel crée un brouillon à partir du colis, l'émet → le client voit « À payer », déclare un virement (référence trop courte refusée) → le paiement reste « en attente » → un agent le valide dans la file → facture « Payée », reçu téléchargeable, colis « prêt pour expédition » → traitement des notifications → le client lit « facture à régler » et « paiement reçu » dans son portail → l'e-mail de paiement est réellement arrivé dans Mailpit → encaissement en espèces d'un second colis (refusé sans caisse ouverte, accepté après ouverture)**, avec contrôle d'accessibilité (axe, WCAG 2.1 A/AA) sur les huit écrans de ce parcours.

La recette de la phase 8 ajoute le parcours complet **colis arrivé et « prêt pour retrait » → le client obtient son code (lu à l'écran) → le personnel tente un code faux (refusé), puis le bon : colis remis, tentative et historique visibles → un livreur invité (rôle « Livreur ») se connecte et ne voit que « Mes tournées » → le personnel planifie une tournée de deux colis et la fait partir → le livreur remet un colis avec le code du client et déclare un échec « client absent » pour l'autre (le colis revient « prêt pour retrait ») → le personnel termine la tournée → le client ouvre une réclamation depuis le colis, le service répond puis clôture avec une résolution (refusée sans résolution) → tableau de bord et journal d'audit**, avec contrôle d'accessibilité sur les écrans de ce parcours.

### Défauts réels détectés pendant la phase 9 (corrigés)
1. **Aucun code de double authentification n'était accepté** : l'expression régulière du format (`/^\d{6}$/`) avait perdu son antislash à l'écriture du fichier (`/^d{6}$/`) ; relevé par le test d'activation (`VALIDATION_ERROR`), corrigé et verrouillé par les tests de format.
2. **Bibliothèques vulnérables** : `multer` et `js-yaml` (corrigés par `overrides`) ; puis le client S3 en version trop ancienne introduisait 22 alertes (dont une critique) — résolu en prenant la version courante, avec contrôle de `npm audit` après chaque ajout.
3. **SeaweedFS crée un bucket absent à l'écriture** (S3 répond `NoSuchBucket`) : le test « bucket absent » a échoué ; le service Docker est lancé avec `-s3.autoCreateBucket=false`.
4. **Banc de charge** : le semis de colis violait deux règles de la base (client et mesures obligatoires pour un colis avancé, format du code client) — preuve que ces protections existent ; le semis les respecte.
5. **Test d'environnement de production** (`app.spec.ts`) devenu faux : la production exige désormais `REQUIRE_STAFF_2FA` et `TOTP_ENCRYPTION_KEY` ; test réécrit pour les couvrir.
6. Test d'interface du formulaire de double authentification : le bouton « Activer » était cherché avant la fin du chargement de l'état (défaut du test, pas du produit).
7. **Recette navigateur instable** : le parcours de logistique attendait le message « Pesée enregistrée. », qui disparaît dès que la fiche du colis se recharge (le panneau de pesée se ferme) ; échec reproduit dans la suite complète, succès isolé. Assertion remplacée par la vérification du résultat (statut et poids). Réserve produit : cette confirmation est quasi invisible pour l'agent (à améliorer).

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

## Pile de production (phase 10)

Essai du 2026-10-28 sur Docker Desktop (Windows 11, conteneurs Linux), domaine `localhost`, certificat auto-signé, SMTP vers un Mailpit de développement. **Ce n'est pas un essai sur un serveur public.**

- `npm run prod:smoke` (`scripts/prod-smoke.mjs`) par le point d'entrée HTTPS : **22 contrôles sur 22 réussis** (disponibilité PostgreSQL et Redis, CSP / HSTS / nosniff, vrai 404, `/docs` fermé, cache des ressources, redirection HTTP→HTTPS, **limite de débit non contournable par `X-Forwarded-For` falsifié**, attributs du cookie de session, **double authentification obligatoire** de bout en bout, création d'une entreprise). Un second passage, après reconstruction depuis la sauvegarde, a réussi aussi (second facteur toujours actif).
- **Mise à jour** : relancer le déploiement sur une pile existante → « No pending migrations », catalogue resynchronisé, super administrateur inchangé.
- **Sauvegarde et exercice** (`npm run prod:backup`, `npm run prod:drill`) : empreinte SHA-256 conforme, restauration sans erreur (2,1 s), 54 tables et 311 lignes identiques, RLS forcée sur 52 tables, 9 migrations, droits identiques.
- **Sinistre simulé** : volumes supprimés, pile reconstruite, base restaurée avec `pg_restore` : 2 entreprises et 2 utilisateurs retrouvés, compte équipé de la double authentification répondant `TOTP_REQUIRED`.
- **Non essayé sur cette pile** : la recette navigateur complète, un test de charge, les pannes brutales, un vrai serveur, domaine, certificat ou fournisseur d'e-mail (voir DEPLOYMENT.md § 9 et RISKS.md).

### Défaut réel détecté pendant la phase 10 (corrigé)
1. **L'API refusait de démarrer sous `docker compose`** : le fichier de composition transmet `S3_ENDPOINT=` (chaîne vide) quand la variable n'est pas définie, et la validation de configuration rejetait cette chaîne vide (URL invalide). Une variable vide équivaut désormais à une variable absente (test ajouté dans `app.spec.ts`) ; relevé en préparant l'essai, avant tout lancement.

## Tests de charge (phase 9)

`npm run loadtest` (script `scripts/loadtest/run.mjs`). Résultats du 2026-10-28 (fichier `loadtest-results.json`, non versionné).

**Conditions** : Intel Core i7-1355U (12 threads), 32 Gio, Windows 11, Node 22.21.1 ; **le générateur de charge (autocannon), l'API compilée, PostgreSQL 17 et Redis 7 (Docker Desktop) tournent sur la même machine** ; base de TEST seule, avec 20 000 colis et 60 000 événements d'une entreprise ; 50 connexions simultanées pendant 20 s par scénario (sauf mention) ; adresses IP distinctes simulées pour rester sous la limite de débit (sauf le dernier scénario). Les chiffres sont donc des **ordres de grandeur sur du matériel de poste de travail, pas une capacité de production**.

| Scénario | Débit | Latence p50 | p97,5 | p99 | Statuts |
|---|---|---|---|---|---|
| Référence : `/health/live` (aucune requête SQL), 8 s | 874 req/s | 54 ms | 87 ms | 104 ms | 6 995 × 2xx |
| Référence : suivi d'un numéro connu, **1 seule connexion** (latence sans file d'attente), 8 s | 48 req/s | 19 ms | 32 ms | 33 ms | 382 × 2xx |
| Suivi public : numéro connu | 128 req/s | 351 ms | 636 ms | 690 ms | 2 562 × 2xx |
| Suivi public : numéro inconnu (404 identique) | 329 req/s | 147 ms | 232 ms | 273 ms | 6 572 × 404 |
| Calculateur public (estimation avec assurance) | 161 req/s | 302 ms | 410 ms | 495 ms | 3 226 × 2xx |
| **Une seule adresse IP insiste sur le suivi** (10 connexions, 8 s) | – | – | – | – | **30 × 2xx, 7 275 × 429, 0 × 5xx** |

**Ce que les mesures montrent** : aucune erreur serveur (0 × 5xx), aucun délai dépassé, aucune erreur de connexion sur l'ensemble des scénarios ; la limite de débit par adresse laisse passer **exactement 30** requêtes par minute puis refuse le reste sous une charge de plus de 900 req/s ; une requête de suivi isolée prend 19 ms avec 20 000 colis (non comparé à d’autres volumes). Sous 50 connexions la latence est surtout de l'attente en file (le suivi fait deux transactions par requête) ; cette explication est une estimation, le goulot n'a pas été profilé.

**Ce que les mesures ne montrent pas** : le comportement sur des machines séparées ou plus puissantes ; la saturation du pool de connexions PostgreSQL en production ; une charge soutenue sur des heures (aucun test d'endurance) ; les écrans du personnel, l'émission de factures et le traitement des notifications (non mesurés) ; l'effet d'un proxy inverse (nginx, TLS) ; le goulot exact (non profilé). Un maximum isolé de 2,4 s a été observé sur le suivi connu (cause non investiguée) sans erreur. **Aucune optimisation n'a été faite** : le script est reproductible pour mesurer avant / après.

## Test de restauration d'une sauvegarde (phase 9)

`npm run backup:check` (script `scripts/backup-restore-check.mjs`), exécuté le 2026-10-28 sur la base de TEST (refuse toute base dont le nom ne finit pas par `_test`) : `pg_dump -Fc` (0,6 s, 2,2 Mio) puis `pg_restore` dans une base neuve (2,0 s), puis suppression de la copie. **17 contrôles sur 17 réussis** :
- restauration sans aucune erreur ; **54 tables, 80 597 lignes**, nombre de lignes identique table par table ; 9 migrations identiques ;
- **empreinte md5 du contenu** identique pour `users`, `invoices`, `payments`, `audit_log`, `packages` ;
- RLS activée **et forcée** identique (52 tables protégées), 57 politiques, 28 déclencheurs, droits du rôle applicatif identiques ;
- avec le **rôle applicatif** (celui de l'API) sur la copie : sans contexte d'entreprise → 0 colis ; avec le contexte de l'entreprise → ses 20 000 colis exactement ; avec celui d'une autre entreprise → 0 ; la modification du journal d'audit est **refusée** (« ajout seul »).

**Limites** : une seule base, petite (le test mesure la fidélité, pas les délais d'une vraie base) ; sauvegarde et restauration dans le **même conteneur** PostgreSQL (une panne de la machine n'est pas simulée) ; les **fichiers joints** ne sont pas sauvegardés par ce test ; aucune sauvegarde planifiée ni rétention ni chiffrement (phase 10) ; restauration complète seulement (pas à un instant donné).

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
| Tests de charge | ✅ phase 9, une seule machine : voir « Tests de charge » ci-dessous |
| Restauration d'une sauvegarde | ✅ phase 9 : voir « Test de restauration » ci-dessous |

## Contrôles manuels réalisés
- **Détection des tests** (phase 3) : trois protections cassées volontairement puis rétablies (révocation de famille de sessions, garde de permissions, politique RLS) : les tests échouent comme attendu.
- **Navigateur intégré** : affichage de l'accueil (ordinateur et 375 px) et de l'inscription en créole.
- **E-mail réel** : une inscription a livré son e-mail à Mailpit via SMTP.
- `seed-demo` exécuté sur la base de test et refusé en production.

## Limites des tests actuels
- **Phase 10** : voir « Pile de production » ci-dessus et DEPLOYMENT.md § 9 : aucun essai sur serveur public, aucune recette navigateur ni charge sur la pile de production.
- **Phase 9** : la double authentification n'est testée qu'avec des codes calculés par les tests (RFC 6238), jamais avec une application d'authentification réelle, et n'est pas dans la recette navigateur ; le stockage S3 n'est testé que contre SeaweedFS en local ; **aucune intégration de paiement, SMS, WhatsApp, transporteur ni e-mail de production** n'a été testée (aucun compte de test) ; les mesures de charge viennent d'une seule machine ; aucun test d'intrusion, d'analyse automatique du code ni d'endurance.
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
