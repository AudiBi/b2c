# Comparaison : le projet et le prototype « B2C Express Shipping – Gestion »

Document établi le 12 novembre 2026 à partir du fichier `B2C_Express_Shipping (6).html` (version 3.0 de l'application, 198 Ko). **Le fichier a été lu en entier (interface, calculs et code de synchronisation PHP intégré) mais pas exécuté** : les comparaisons viennent de la lecture du code, pas d'un essai à l'écran.

## 1. En bref

Le fichier est un **outil de gestion interne** déjà pensé pour vos opérations réelles : calcul des frais à la livre et au pied cube, barils, frais CONATEL, caisse, dépôts en banque, petite caisse, paie, profit mensuel, commissions de référents, partenaires aux États-Unis. Le projet est une **plateforme** : sécurité, multi-entreprises, site public et espace client, facturation et machine d'états rigoureuses.

- **Le projet est nettement plus solide** sur la sécurité, la traçabilité, la facturation, l'espace client, le suivi public, le référencement et les droits.
- **Le prototype est nettement plus complet sur le métier réel** : tarification haïtienne (drums, pi³, CONATEL), argent au quotidien (caisse, banque, petite caisse), gestion (dépenses, marges, profit, commissions, paie), achats en ligne et outils de relation client par WhatsApp.
- **Il manque donc au projet une couche « exploitation et gestion » et la tarification spécifique à votre activité.** C'est ce qu'il faut ajouter avant de pouvoir remplacer le prototype.
- Les **données réelles du prototype** (coordonnées, adresses, tarifs, taux) règlent d'un coup deux bloquants de `RISKS.md` (A7 et A8) : voir § 5.

## 2. Nature des deux

| | Prototype (fichier HTML) | Projet |
|---|---|---|
| Architecture | Un seul fichier, données dans le navigateur (`localStorage`), synchronisation par un `api.php` de 300 lignes qui stocke un fichier JSON | API NestJS, PostgreSQL, Redis, site et panel React, Docker |
| Mode hors ligne | **Oui** : fonctionne sans internet, synchronise au retour | **Non** : en ligne seulement |
| Connexion | Liste d'utilisateurs et **code PIN à 4 chiffres stocké en clair** (« 1234 », « 1111 »…) | Mot de passe argon2, verrouillage, double authentification obligatoire pour le personnel, sessions révocables |
| Droits | 5 rôles appliqués **dans le navigateur** (modifiables en ouvrant la console) | 14 rôles et rôles personnalisés appliqués **côté serveur et en base** (RLS), matrice testée route par route |
| Isolation des données | Partenaires filtrés par le script PHP (par site) | Isolation par entreprise garantie par la base |
| Traçabilité | Journal local de 1 500 lignes, modifiable | Journal d'audit en ajout seul en base |
| Clients | Pas d'espace client, pas de site public | Site public (3 langues, référencement), espace client, suivi public, préalertes |
| Documents | Impression par le navigateur (reçu, proforma, facture, fiches) | PDF côté serveur (facture, reçu, manifeste), numérotation sans trou |
| Langues | Français | Français, créole, anglais |
| Tests | Aucun | 1 187 tests automatisés (annexe) |

## 3. Couverture des fonctions du prototype

✔ = présent et au moins aussi bon · ◐ = partiel · ✘ = absent du projet

### Colis et tarification

| Fonction du prototype | Projet | Remarque |
|---|---|---|
| Colis avec expéditeur, destinataire, contenu, poids, dimensions | ✔ | Plus riche (17 statuts, historique public/privé, pièces jointes) |
| Poids volumétrique, poids facturable = max(réel, volumétrique) | ✔ | Diviseur configurable par grille |
| Livres (lb) et pouces (po) | ✔ | Unités KG/LB et CM/IN |
| **Tarif aérien à la livre** (5 $/lb) | ◐ | Possible avec une grille (tranche unique), à saisir |
| **Tarif maritime au pied cube** (18 $/pi³) | ✘ | Le projet facture au **poids** seulement ; aucune règle au volume |
| **Barils (drums)** à prix fixe (220 $) avec rabais par baril | ✘ | Aucun type de contenant ni prix à l'unité |
| **Types de contenant** (boîte, e-conteneur, baril, valise, palette) et quantité | ✘ | Un colis = une unité |
| Deux diviseurs volumétriques (166 standard, 132 boîte/e-conteneur) | ◐ | Un diviseur par grille, pas par type de contenant |
| Montant calculé automatiquement **et modifiable à la main** | ✘ | Volontaire : « jamais de prix inventé » ; une remise est possible (plafonnée), pas un prix libre |
| **Frais CONATEL** (électronique : 21 articles, prix fixe, 20 % de la valeur, 2 $/watt, tarif normal ou VIP, « autorisation requise ») | ✘ | Les suppléments du projet sont fixes ou en pourcentage (fret, valeur, sous-total) ; ni « par article », ni « par watt », ni table d'articles |
| Équivalent en **gourdes** partout (taux 135) | ✘ | Factures par devise, aucun taux de change ni double affichage |
| Proforma imprimable (validité 30 jours), convertible en colis | ◐ | Estimation publique et estimations enregistrées par le client ; pas de document proforma du personnel ni de conversion |
| Sens USA → Haïti **et Haïti → USA** | ◐ | Grilles par trajet quelconque, mais le parcours (entrepôts à l'étranger, agences en Haïti) est conçu pour l'import |
| Transport terrestre (Philadelphie) | ✘ | Modes : avion et bateau seulement |

### Réception, achats en ligne, suivi

| Fonction du prototype | Projet | Remarque |
|---|---|---|
| Achats en ligne (Amazon, Walmart, eBay, Shein, Temu…) avec suivi vendeur | ✔ | Les **préalertes** du client |
| Reconnaissance du transporteur par le numéro (UPS, USPS, FedEx, DHL, Amazon) et lien de suivi | ✘ | Facile à ajouter |
| Réception rapide par les derniers chiffres, code client ou nom | ◐ | Réception par lecture du code (numéro exact, ou code client si un seul colis attendu) |
| Colis non annoncé, colis en retard, « flot par client » | ◐ | Colis non identifié oui ; alerte de retard et flot par client non |
| Adresse d'embarquement donnée au client avec son code en 2e ligne | ✔ | Générée automatiquement par entrepôt et par mode |
| Suivi par numéro, barre de progression, itinéraire envoyé au client | ✔ | Suivi public, sans donnée personnelle |
| Statuts : reçu USA, en transit, arrivé, douane, prêt, livré, retourné | ✔ | Plus fins ; lots de transport, manifestes, départ et arrivée |

### Argent et gestion

| Fonction du prototype | Projet | Remarque |
|---|---|---|
| Encaissement : espèces, **MonCash**, virement, carte | ◐ | Espèces, virement, Zelle ; **MonCash retiré au premier lancement**, carte non faite |
| Factures regroupant les colis impayés, liste des dettes par client | ◐ | Factures numérotées, avoirs, PDF (plus rigoureux) ; pas de vue « dettes par client » |
| Caisse : soldes à encaisser, paiements récents | ✔ | Caisse par agence **et par devise**, clôture avec écart |
| **Dépôts bancaires** (journalier, hebdomadaire, bordereau, écart, « reste à déposer ») | ✘ | Aucun rapprochement entre espèces et banque |
| **Petite caisse** (dépenses, approvisionnements, solde USD/HTG, alerte solde bas, rapport du jour) | ✘ | |
| **Dépenses** par catégorie et par agence | ✘ | |
| **Paie** : employés, retenues 6 %, bulletins | ✘ | Hors périmètre du projet |
| **Coût d'achat du transport, marge, profit net mensuel** (12 mois, par mode) | ✘ | Le projet ne connaît **aucun coût** ; ses rapports donnent le chiffre d'affaires, pas le profit |
| **Référents et commissions** (taux sur le profit des clients référés, relevés, paiements) | ✘ | |
| Rapports et export CSV des colis | ◐ | Tableau de bord, export comptable CSV des écritures ; pas d'export des colis |
| Incidents (égaré, cassé, endommagé) avec **indemnité et remboursement du transporteur** | ◐ | **Réclamations** côté client avec échanges ; aucun montant d'indemnité ni lien avec le profit |

### Relation client et exploitation

| Fonction du prototype | Projet | Remarque |
|---|---|---|
| Messages WhatsApp, SMS, e-mail **ouverts dans l'appareil** (`wa.me`, `sms:`, `mailto:`) avec modèles modifiables | ◐ | E-mails et portail envoyés par le serveur, modèles modifiables en 3 langues ; WhatsApp et SMS « non configurés » (pas de fournisseur) |
| Bienvenue automatique au nouveau client (3 canaux) | ◐ | E-mail de confirmation et notifications ; pas de message de bienvenue WhatsApp |
| Partenaires USA par site, **coûts masqués** | ◐ | Rôles limités à un entrepôt ou une agence ; aucun coût n'existe à masquer |
| Activité en direct (qui est connecté, sur quelle page) | ✘ | |
| Mode démonstration | ✔ | `npm run db:seed:demo-data` (plus complet) |
| Sauvegarde / restauration | ✔ | Sauvegarde chiffrée hors serveur ; restauration éprouvée |
| Thème clair et sombre | ◐ | Clair seulement |

## 4. Ce que le projet apporte et que le prototype n'a pas

Espace client avec préalertes, factures, paiements déclarés, réclamations et équipe d'un compte professionnel ; site public en trois langues avec référencement (SEO) ; suivi public ; remise sécurisée (code, pièce d'identité, solde bloquant) ; tournées et livreurs ; lots de transport et manifestes ; double authentification ; sécurité par entreprise en base ; journal d'audit inviolable ; factures et avoirs numérotés sans trou ; sauvegardes chiffrées ; déploiement Render ; 1 187 tests.

## 5. Données réelles à reprendre du prototype

Le fichier contient les vraies informations de l'entreprise. **À confirmer par vous avant de les publier**, elles permettraient de lever `RISKS.md` A7 (coordonnées) et A8 (tarifs) :

| Donnée | Valeur dans le prototype |
|---|---|
| Agence Haïti | 48, rue Clerveaux, Pétion-Ville |
| Téléphones, e-mail | +509 3458 9898 / +509 3543 3535 · info@b2cxpress.com |
| Embarquement USA (avion et bateau) | 3060 NW 72nd Ave, Miami, FL 33122 |
| Transport terrestre USA | 1245 Passmore St, Philadelphie, PA 19111 · +1 (267) 469-4089 |
| Tarif aérien | 5 $ par livre (coût d'achat 3,90 $) |
| Tarif maritime | 18 $ par pied cube (coût 14 $) |
| Baril (drum) | 220 $ au client (coût 150 $), rabais possible par baril |
| Diviseurs volumétriques | 166 (standard), 132 (boîte / e-conteneur) |
| Taux de change | 1 $ = 135 gourdes |
| Frais CONATEL | 21 lignes (iPhone, télévisions, ordinateurs, Starlink, drones…) |
| Autres réglages | commission des référents 10 % ; retenues de paie 6 % ; seuil d'alerte de la petite caisse 50 $ |

Les **coûts d'achat** (3,90 / 14 / 150 $) sont des informations internes : ils ne doivent jamais apparaître sur le site public ni dans l'espace client.

## 6. Points faibles du prototype à ne pas reproduire

PIN de 4 chiffres en clair (« 1234 » comme compte administrateur par défaut), contrôle des rôles dans le navigateur, base modifiable par n'importe quel utilisateur de l'appareil, clé secrète partagée pour la synchronisation, suppression sans trace fiable, journal d'audit modifiable, fusion des modifications par horodatage (risque de perte), aucune isolation réelle des partenaires, aucun test. Ces points sont exactement ce que le projet corrige.

## 7. Ordre de rattrapage conseillé

**Priorité 1 : permettre d'exploiter votre activité réelle**
1. **Reprendre vos coordonnées et vos tarifs** dans le projet (grilles avion, valeurs de `RISKS.md` A7/A8) : rapide, sans développement.
2. **Tarification au volume et au contenant** : prix au pied cube pour le maritime, **barils** à prix fixe avec rabais, types de contenant, diviseurs par type.
3. **Frais CONATEL** : table d'articles (prix fixe, % de la valeur, par watt, normal/VIP, autorisation requise), appliquée à un colis comme supplément.
4. **Gourdes** : taux de change configurable et double affichage USD/HTG sur colis, factures et reçus.
5. **Décision MonCash** : mode de paiement très courant en Haïti, retiré du projet au premier lancement ; à rétablir comme mode déclaré puis validé (comme Zelle) si l'entreprise l'accepte.

**Priorité 2 : gestion financière**
6. **Coût d'achat, marge et profit mensuel** (réservé à l'administrateur et à la comptabilité), puis **dépenses**.
7. **Dépôts bancaires et petite caisse** (rapprochement des espèces).
8. **Indemnités d'incidents** (montant payé au client, remboursement du transporteur) rattachées aux réclamations et au profit.
9. **Référents et commissions** ; **proforma** imprimable convertible en colis.

**Priorité 3 : confort et extensions**
10. Liens WhatsApp / SMS « un clic » (comme `wa.me` du prototype) : aucun fournisseur à payer, très utile en attendant une vraie intégration.
11. Détection du transporteur et lien de suivi sur les préalertes ; alerte de retard ; flot par client.
12. Mode hors ligne ou application installable pour les agents (réception en entrepôt), si la connexion l'exige.
13. Transport terrestre, colis Haïti → USA, présence en direct, thème sombre.
14. **Paie** : probablement à laisser à un outil dédié (hors périmètre d'une plateforme de logistique).

**Migration des données** : le prototype propose un export JSON complet (Paramètres → Exporter). Un script d'import (clients, colis, paiements) vers le projet est faisable ; à prévoir avant de basculer, avec relecture des codes clients existants (`B2C-…`).

## 8. Annexe : données chiffrées

Toutes les valeurs ci-dessous ont été **mesurées** le 12 novembre 2026 (dépôt à son état courant, fichier du prototype tel que fourni) ; rien n'est estimé, sauf mention.

### 8.1 Taille et contenu

| Mesure | Prototype | Projet |
|---|---|---|
| Fichiers | 1 (198 308 octets, 743 lignes) | 441 fichiers suivis par Git |
| Code applicatif (lignes) | environ 740 (interface, calculs et PHP de synchronisation dans le même fichier) | API 13 029 · site 11 782 · panel 12 363 · partagé 1 886 (lignes de code et de configuration) |
| Base de données | 17 collections JSON dans le navigateur | 54 modèles, 44 énumérations, 1 651 lignes de schéma, 14 migrations (2 833 lignes de SQL) |
| Écrans | 23 entrées de menu | Site public : 16 pages référencées × 3 langues ; espace client ; panel du personnel |
| Interface de programmation | 6 actions PHP (`ping`, `get`, `put`, `keys`, `addkey`, `delkey`) | 160 chemins, 195 opérations (`docs/openapi.json`) |
| Rôles | 5 (appliqués dans le navigateur) | 14 + rôles personnalisés, 72 permissions (appliqués côté serveur) |
| Langues | 1 (français) | 3 (français, créole, anglais), environ 1 450 lignes de textes par langue |
| Tests | 0 | 1 187 réussis : partagé 91, API 583, site 323, panel 95, navigateur 95 (7 tests d'API ignorés non comptés) ; 60 fichiers de test, 16 792 lignes |
| Documentation | un guide dans l'application | 17 documents (2 667 lignes) |
| Historique | une copie du fichier | 26 commits |

### 8.2 Couverture des 39 fonctions du prototype

| | ✔ présent | ◐ partiel | ✘ absent |
|---|---|---|---|
| **Total (39)** | **10 (26 %)** | **14 (36 %)** | **15 (38 %)** |
| Colis et tarification (14) | 3 | 4 | 7 |
| Réception, achats en ligne, suivi (7) | 4 | 2 | 1 |
| Argent et gestion (11) | 1 | 4 | 6 |
| Relation client et exploitation (7) | 2 | 4 | 1 |

Lecture : **les deux domaines les moins couverts sont la tarification (7 absentes sur 14) et l'argent et la gestion (6 absentes sur 11)**, justement ceux où le prototype est le plus spécifique à votre activité. La réception et le suivi sont, eux, bien couverts (4 sur 7 complètement, 6 sur 7 au moins en partie).

### 8.3 Même colis, deux calculs

Le prototype calcule : poids facturable = max(poids réel, L×l×H ÷ diviseur) ; aérien × 5 $/lb. Le projet a été interrogé avec **son vrai moteur de calcul** (`apps/api/src/pricing/calculator.ts`) paramétré comme le prototype (grille unique à 5 $/lb, livres et pouces, sans arrondi ni minimum), puis avec les réglages de la grille de démonstration (arrondi à la demi-livre supérieure, minimum 0,5 lb).

| Cas | Colis | Prototype | Projet (mêmes réglages) | Projet (arrondi à 0,5 lb) |
|---|---|---|---|---|
| Aérien, boîte volumineuse | 12 lb, 20×16×12 po, diviseur 166 | 23,13 lb → **115,65 $** | 23,133 lb → **115,67 $** | **117,50 $** |
| Aérien, petit colis dense | 30 lb, 12×10×8 po | 30 lb → **150,00 $** | **150,00 $** | **150,00 $** |
| Aérien, e-conteneur | 10 lb, 20×16×12 po, diviseur 132 | 29,09 lb → **145,45 $** | **145,46 $** | **147,50 $** |
| Aérien, colis léger | 2,3 lb, 14×10×6 po | 5,06 lb → **25,30 $** | **25,30 $** | **27,50 $** |
| Maritime | 24×18×16 po = 4 pi³ × 18 $ | **72,00 $** | **non calculable** (le projet facture au poids) | non calculable |
| Baril ×2 avec rabais de 20 $ | 2 × (220 − 20) | **400,00 $** | **non calculable** (aucun type de contenant) | non calculable |

Ce que ces chiffres montrent :
- **Le moteur du projet reproduit le prototype à 2 centimes près** sur l'aérien (le prototype arrondit le poids facturable à 2 décimales avant de multiplier, le projet multiplie avant d'arrondir le montant). L'aérien à la livre est donc faisable **dès maintenant** avec une grille.
- **L'arrondi à la demi-livre de la grille de démonstration coûte jusqu'à 2,50 $ de plus par colis** que le prototype (117,50 $ contre 115,65 $) : c'est un choix d'entreprise à trancher (arrondi ou non), pas une limite technique.
- **Le maritime au pied cube et les barils, qui sont deux de vos trois produits, ne sont pas calculables aujourd'hui** : c'est la priorité n° 2 du § 7.

### 8.4 Paramètres du prototype (à reprendre ou à rapprocher du projet)

| Élément | Prototype | Projet |
|---|---|---|
| Statuts d'un colis | 7 | 17 |
| Statuts d'une commande en ligne | 6 (commandé… problème / retour) | la préalerte vit dans les statuts du colis (17) |
| Statuts d'un incident | 5 | réclamation : ouverte, en cours, résolue, rejetée (4) |
| Types d'incident | 4 (égaré, non retrouvé, cassé, endommagé) | 6 catégories de réclamation (dont abîmé, perdu, retard, facturation) |
| Modes de paiement | 4 (espèces, MonCash, virement, carte) | 3 (espèces, virement, Zelle) |
| Catégories de dépenses | 8 | aucune (pas de module de dépenses) |
| Catégories de petite caisse | 10 | aucune |
| Banques proposées pour les dépôts | 9 (Sogebank, Unibank, BNC, Capital Bank, BUH, Bank of America, Chase, Wells Fargo, autre) | aucune |
| Articles CONATEL | 21 lignes | aucun |
| Comptes initiaux | 4, avec PIN « 1234 », « 1111 », « 2222 », « 3333 » | compte créé par le script d'amorçage, mot de passe fort exigé |
| Numérotation | `B2C-…` (clients, colis), `PF-`, `F-`, `INC-`, `DEP-`, `PC-` (calculées dans le navigateur) | `INV-`, `CN-`, `RCT-`, `TOU-`, `CLM-`, code client et suivi par entreprise (attribuées par la base, sans trou ni doublon) |
