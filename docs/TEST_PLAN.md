# Plan de test

Phases 3 à 5. Ce document sera étendu à chaque phase. **Seuls les résultats d'exécutions réelles y figurent.**

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
| `packages/shared` (catalogue, `PermissionSet`, schémas, modèle d'adresse, **machine d'états, numéro de suivi**) | 55 | ✅ |
| API `rls.spec.ts` (isolation au niveau de la base) | 18 | ✅ |
| API `auth.spec.ts` | 40 | ✅ |
| API `iam.spec.ts` (politique des routes, matrice des rôles, invitations, plateforme) | 47 | ✅ |
| API `customers.spec.ts` (code client, profil, adresses, bénéficiaires, entrepôts, adresses de réception, public) | 48 | ✅ |
| API `calculator.spec.ts` (formules pures : unités, poids volumétrique, arrondis, tranches, suppléments, taxes, décimal exact) | 26 | ✅ |
| API `pricing.spec.ts` (grilles : brouillon/activation/immuabilité/chevauchement, catégories, calculateur public, estimations client) | 29 | ✅ |
| API `packages.spec.ts` (préalertes, rapprochement, portées, identification/fusion, pesée, machine d'états, déclencheurs, regroupement, recherche, suivi public) | 54 | ✅ |
| API `files.spec.ts` (contenu réel, taille, PDF actif, accès, liens signés, suppression, fusion) | 20 | ✅ |
| API `rate-limit.spec.ts` | 7 | ✅ |
| API `infra.spec.ts` (compteurs, idempotence) | 9 | ✅ |
| API `app.spec.ts` (santé, en-têtes, CORS, erreurs, configuration) | 14 | ✅ |
| Site, unitaires (6 fichiers : `i18n`, `api-client`, `forms`, `prerender`, `format`, `phase5`) | 130 | ✅ |
| Site, recette navigateur (`public-pages`, `customer-journey`, `parcels`) | 82 | ✅ |
| **Total** | **579** | **579 réussis, 0 échec** |

La recette navigateur couvre notamment : les **17 pages publiques × 3 langues** (51 pages) avec contrôle automatique d'accessibilité WCAG 2.1 A/AA (axe) sur ordinateur **et** sur téléphone (375 px), absence de défilement horizontal, absence d'erreur console (donc de violation de la CSP) ; le HTML pré-rendu sans JavaScript (titre, description, `canonical`, `hreflang`) ; le sitemap et robots.txt ; la page 404 avec statut 404 ; le sélecteur de langue ; la navigation au clavier (lien d'évitement) ; et tout le parcours client : inscription → e-mail réel → confirmation → connexion → code client → adresses de réception → profil → adresses → bénéficiaires → mot de passe → déconnexion, redirection vers la page demandée, redirection externe refusée, mot de passe oublié, jeton à usage unique, inscription en créole.

La recette de la phase 5 ajoute : calculateur (poids réel, volumétrique, assurance, détail, validation FR/EN, téléphone 375 px, axe) ; parcours complet **préalerte → facture jointe (lien signé vérifié) → réception rapprochée → pesée → frais provisoires → suivi public sans connexion (aucune donnée personnelle dans le texte de la page) → retenue en douane** ; doublon de numéro marchand ; modification et annulation en deux temps ; un client ne peut pas ouvrir le colis d'un autre ; suivi en créole.

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
| 6, 8-12 | Lot, notifications, paiement, agence, livraison… | ⏳ phases 6 à 8 |
| 13 | Un client ne peut pas consulter les données d'un autre client | ✅ pour ce qui existe : utilisateurs, journal d'audit, adresses, bénéficiaires, adresses de réception, entrepôts, **préalertes, colis, pièces jointes, estimations** (API et navigateur), base entière via RLS ; à rejouer sur factures |
| 14 | Un employé ne peut pas faire une opération interdite à son rôle | ✅ matrice sur toutes les routes existantes, portées d'entrepôt, autorisation avant validation, anti-escalade, dernier administrateur |
| 15 | Erreurs de paiement ou de notification traitées | ◐ l'échec d'envoi d'e-mail est journalisé sans casser l'action (constaté, non couvert par test automatisé) ; paiements en phase 7 |

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
- **Phase 5** : les opérations du personnel (réception, pesée…) sont testées par l'API, pas par une interface (elle n'existe pas). Aucun antivirus ni stockage S3 n'a été exercé. Les tests de transport, d'agence et de livraison attendent leurs modules. Charge et énumération des numéros de suivi : phase 9.
- **L'accessibilité automatisée (axe) ne détecte qu'une partie des problèmes.** Aucun test avec lecteur d'écran ni audit manuel n'a eu lieu : ne pas annoncer de conformité WCAG avant cet audit.
- Navigateurs testés : Chromium (et Edge pour le repli). Ni Firefox ni Safari. Pas de test sur un vrai téléphone ni sur un réseau lent.
- **Les traductions créoles n'ont pas été relues par un locuteur natif** ; les tests vérifient la structure, pas la qualité de la langue.
- Aucun test de performance : le fichier JavaScript principal pèse environ 235 Ko compressés (voir WEB.md).
- Les tests de concurrence couvrent les cas écrits, pas tous les entrelacements possibles.
- Le pré-rendu et la CSP sont testés avec le serveur de `scripts/serve-dist.mjs`, pas avec un vrai nginx ou Apache.
- La base de test est partagée entre les fichiers (exécutés l'un après l'autre) ; l'isolation repose sur des identifiants aléatoires.
