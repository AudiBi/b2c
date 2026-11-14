# Fusionner le prototype et le projet : analyse détaillée et plan de départ

Suite de [COMPARAISON_PROTOTYPE.md](COMPARAISON_PROTOTYPE.md). Ce document décide **comment** réunir les deux, **par où commencer**, et quoi décider avant d'écrire du code. Les constats techniques viennent de la lecture du code du projet (schéma de données, contrôleurs, services) et du fichier du prototype. Les tailles de chantier (S, M, L) sont des **ordres de grandeur relatifs**, pas des estimations en jours.

## 1. Décision recommandée, en bref

1. **Le projet devient le noyau unique** ; le prototype devient (a) le **cahier des charges métier** et (b) une **source de données** à importer. **On ne fusionne pas les codes** : un fichier à données locales, PIN en clair et droits côté navigateur ne peut pas être greffé sur une plateforme dont tout l'intérêt est la sécurité côté serveur.
2. **On rattrape par vagues, chacune livrable et utilisable seule**, en commençant par ce qui débloque votre activité réelle (clients et colis créés au comptoir, tarifs réels) avant la gestion financière.
3. **Le vrai point de départ est un changement de modèle, pas un écran** : aujourd'hui le projet suppose que **chaque client a un compte** (adresse e-mail, mot de passe) et qu'il **achète lui-même en ligne**. Le prototype gère surtout des **clients enregistrés par le personnel au comptoir**, souvent sans e-mail, qui **envoient un colis à un destinataire en Haïti**. Tant que ce point n'est pas traité, rien d'autre ne peut être importé ni utilisé.
4. **Première semaine, sans développement** : charger vos vraies coordonnées, adresses et tarif aérien (5 $/lb) dans le projet, ce qui lève deux bloquants de `RISKS.md` (A7, A8).
5. **Ne jamais exploiter les deux en parallèle sur les mêmes données.** Pour chaque domaine, une seule source de vérité à chaque vague (§ 6).

## 2. Constats déterminants (vérifiés dans le code)

| # | Constat | Preuve | Conséquence pour la fusion |
|---|---|---|---|
| C1 | **Un client = un compte.** `Customer.userId` est obligatoire et unique ; l'adresse e-mail est obligatoire pour tout compte | `prisma/schema.prisma` (modèle `Customer`) ; 24 endroits du code lisent le nom, l'e-mail ou le téléphone à travers `customer.user` | Les clients du prototype (souvent sans e-mail, créés par un employé) **ne peuvent pas être importés tels quels**. Il faut des « clients sans compte » |
| C2 | **Le personnel ne peut pas créer un colis pour un client.** Un colis naît d'une préalerte du client, d'une réception, ou d'un colis non identifié | `packages.controllers.ts` : pas de création côté personnel | Le geste principal du prototype (« Nouveau colis » au comptoir, avec expéditeur et destinataire) n'existe pas |
| C3 | **Pas de notion de destinataire en Haïti.** Le colis porte un nom de destinataire (par défaut le client) ; la remise passe par le client ou un « bénéficiaire » **que le client a lui-même déclaré** | `Package.recipientName`, `recipientKind: CUSTOMER \| BENEFICIARY` | Le modèle « la diaspora envoie à un proche » (téléphone, adresse, retrait par le proche) n'est pas couvert |
| C4 | **Tarification au poids uniquement.** Les règles portent sur des tranches de poids ; les suppléments sont fixes ou en pourcentage ; le colis stocke poids et dimensions en unités métriques | `RateRule`, `SurchargeMethod` (FLAT, PERCENT_OF_…), `Package` | Pas de prix au pied cube, au baril ni par article ; pas de quantité ni de type de contenant |
| C5 | **Bonne surprise : les factures savent déjà faire « quantité × prix unitaire »** et ont un type `CUSTOMS` | `InvoiceLine.quantity`, `unitPrice`, `InvoiceLineKind` | Les barils (2 × 200 $) et les frais CONATEL s'écrivent **sans changer la facturation** |
| C6 | **Aucun coût, aucune marge.** Les rapports donnent le chiffre d'affaires et les soldes, pas le profit | aucun champ de coût dans le schéma | Le profit mensuel suppose d'**ajouter** les coûts d'achat du transport, les dépenses et leur droit d'accès |
| C7 | **Les factures sont immuables et numérotées sans trou** (déclencheurs en base) | migrations 0007 et suivantes | **On n'importe pas l'historique des factures** : on importe les colis et les soldes ouverts, et on réémet de nouvelles factures (§ 5) |
| C8 | **MonCash est facile à rétablir** : la valeur `MOBILE_MONEY` existe encore dans l'énumération | `enum PaymentMethod` | Rétablir MonCash = autoriser la valeur et l'écran, avec déclaration puis validation comme Zelle |
| C9 | **Les numéros de suivi sont générés par le projet** (préfixe de l'entreprise) ; le prototype utilise `B2C-…` | `tracking-number.service.ts` | Vos clients connaissent déjà leurs codes `B2C-…` : le suivi public doit **accepter l'ancien code** |
| C10 | **Pas de mode hors ligne**, pas de rôle « Partenaire » ; les droits par entrepôt ou agence existent | pas de service worker ; `RoleDefinition.allowedScopes` | Le rôle partenaire se compose avec les portées existantes ; le hors ligne est un chantier à part |

## 3. Les stratégies de fusion comparées

| | A. Tout migrer d'un coup puis éteindre le prototype | **B. Projet comme noyau, bascule par vagues** | C. Faire tourner les deux avec une synchronisation | D. Continuer le prototype et abandonner le projet |
|---|---|---|---|---|
| Principe | Reconstruire toutes les fonctions puis basculer un jour | Chaque vague rend une partie du prototype inutile ; on bascule domaine par domaine | Écrire un pont entre le JSON du prototype et l'API | Améliorer le prototype (PHP, PIN, etc.) |
| Délai avant le premier bénéfice | Long (tout ou rien) | **Court** (vague 0 en quelques jours) | Moyen | Immédiat |
| Risque de perte ou de doublon de données | Faible pendant le chantier, **élevé le jour J** | **Faible** : une seule source par domaine | **Très élevé** : deux modèles différents (C1 à C3), conflits permanents | Moyen (fusion par horodatage) |
| Sécurité | Bonne à l'arrivée | Bonne et progressive | Le maillon faible reste exposé | **Mauvaise** (PIN, droits côté navigateur, clé partagée) |
| Adoption par l'équipe | Brutale | **Progressive, avec formation par vague** | Confuse (« où saisir ? ») | Aucun changement |
| Coût de maintenance à terme | Un seul système | Un seul système | **Deux systèmes + le pont** | Un système sans tests ni isolation |
| Verdict | Trop risqué, retarde tout | **Recommandée** | À écarter | À écarter (les besoins de croissance et de sécurité du projet disparaîtraient) |

**Pourquoi B** : elle livre de la valeur tôt, garde un seul endroit de saisie par domaine, laisse le prototype comme filet de sécurité, et respecte l'ordre naturel des dépendances (clients → colis → tarifs → factures → gestion).

## 4. Par où commencer : classement des chantiers

Critères : **valeur pour l'activité** (peut-on travailler sans ?), **dépendances** (qu'est-ce qui bloque quoi ?), **risque** et **réversibilité**.

| Rang | Chantier | Pourquoi ce rang | Dépend de |
|---|---|---|---|
| 1 | Données réelles : coordonnées, entrepôts, tarif aérien, taux de change (sans développement) | Gratuit, immédiat, lève A7 et A8, rend le site public crédible | — |
| 2 | **Clients sans compte** et **colis créé au comptoir avec destinataire** | **Chemin critique** : tout colis, import et facture en dépend (C1 à C3) | 1 |
| 3 | Reprise des clients et des colis ouverts du prototype | Premier pas vers l'abandon du prototype | 2 |
| 4 | Tarification : pied cube, barils, types de contenant, quantité, remise par baril | Deux de vos trois produits ne sont pas calculables (C4) | 2 |
| 5 | Frais CONATEL (table d'articles, supplément « par article / % / par watt ») | Obligatoire pour l'électronique, déjà facturable (C5) | 4 |
| 6 | Double affichage USD / gourdes, MonCash | Usage quotidien en Haïti ; petit chantier | 1 |
| 7 | Coût d'achat, marge, dépenses, profit mensuel | Pilotage de l'entreprise (C6) ; demande un droit d'accès dédié | 4 |
| 8 | Dépôts bancaires, petite caisse | Contrôle de l'argent liquide ; s'appuie sur les caisses déjà existantes | 7 |
| 9 | Incidents avec indemnités, référents et commissions | Complète le profit ; moins urgent | 7 |
| 10 | Proforma, outils d'achats en ligne, liens WhatsApp, rôle partenaire | Confort ; indépendants | 2 |
| 11 | Transport terrestre, colis Haïti → USA, présence en direct | Extensions du modèle | 4 |
| 12 | Mode hors ligne (réception en entrepôt) | Gros chantier ; à justifier par la qualité réelle de la connexion | 2 |
| — | Paie | Hors périmètre d'une plateforme de logistique : à laisser à un outil dédié | — |

**Réponse à « le meilleur pour commencer »** : le rang 1 tout de suite (aucun risque, aucun code), puis le rang 2 comme **première vraie livraison**, parce que c'est lui qui débloque tous les autres. Commencer par la tarification ou les finances serait un piège : sans clients sans compte et sans colis au comptoir, on ne pourrait ni saisir ni importer une seule opération réelle.

## 5. Conception technique par chantier

### 5.1 Clients sans compte et colis au comptoir (rang 2)

- **Données** : rendre `Customer.userId` facultatif ; porter sur `Customer` les coordonnées qui vivent aujourd'hui sur le compte (nom ou raison sociale, téléphone, téléphones en Haïti, e-mail facultatif, adresse, pays) ; ajouter `legacyCode` (ancien code `B2C-…`) ; ajouter sur `Package` un **destinataire** structuré (nom, téléphone, adresse, ville) et un `legacyTrackingNumber`.
- **API** : création et modification d'un client par le personnel ; **création d'un colis par le personnel** (client, mode, contenu, destinataire, destination) qui passe ensuite par la pesée et la facturation existantes ; invitation facultative « créer mon accès » qui rattache un compte au client existant.
- **Remise** : étendre la règle de remise (`recipientKind`) à un **destinataire** identifié par son nom, son téléphone et sa pièce d'identité, avec les mêmes preuves et le même blocage de solde que pour un client.
- **Suivi public** : accepter `legacyTrackingNumber` en plus du numéro généré.
- **Droits** : une permission dédiée (par exemple `customer:create`, `package:create`) donnée à la réception, au comptoir et à l'administrateur, **refusée** aux autres rôles ; la matrice des rôles (`role-matrix.spec.ts`) se met à jour d'elle-même.
- **Points de vigilance** : les 24 endroits qui lisent `customer.user` doivent lire les nouveaux champs ; l'envoi des notifications doit gérer « pas d'e-mail » (téléphone seulement) ; l'isolation par entreprise (RLS) doit couvrir les nouveaux champs ; l'espace client d'un client sans compte n'existe pas tant qu'il n'a pas été invité.
- **Taille** : M. **Tests d'acceptation** : créer un client sans e-mail, lui créer un colis avec destinataire, le peser, le facturer, le remettre au destinataire ; suivre par l'ancien code.

### 5.2 Tarification métier (rangs 4, 5, 6)

- **Base de calcul** : ajouter à la grille une **base de tarification** (`WEIGHT`, `VOLUME`, `UNIT`) ; en `VOLUME`, le calcul utilise longueur × largeur × hauteur × quantité ÷ 1 728 (pieds cubes) ; en `UNIT`, quantité × prix unitaire.
- **Types de contenant** : table de types (boîte, e-conteneur, baril, valise, sac, palette…) portant leur base, leur **diviseur volumétrique propre** (166 ou 132) et leur prix unitaire éventuel ; le colis porte type et quantité.
- **Remise par baril** : ligne de remise sur la facture (type `DISCOUNT`), plafonnée par le droit existant (plafond de remise de l'entreprise) ou par un droit spécial.
- **Prix modifiable à la main** (le prototype l'autorise librement) : **à encadrer** plutôt que reproduire : permission `price:override`, **motif obligatoire**, écart enregistré dans le journal d'audit, visible sur la facture comme ligne d'ajustement. Cela respecte la règle « jamais de prix inventé » tout en gardant la souplesse du comptoir.
- **CONATEL** : table d'articles (désignation, série ou taille, prix normal, prix VIP, type : fixe, pourcentage de la valeur, par watt, à confirmer ; **autorisation requise**), éditable par l'administrateur. Un colis porte des **lignes d'articles** (article, quantité, valeur, puissance) ; le calcul en tire une ligne de facture de type `CUSTOMS`, marquée **reversée** (hors profit), comme le fait le prototype.
- **Gourdes** : taux de change **réglé par l'entreprise avec historique**, utilisé uniquement pour l'**affichage** d'un équivalent (colis, facture, reçu). Aucune conversion comptable : une facture reste dans **une** devise (règle déjà éprouvée avec la caisse à devise unique).
- **MonCash** : autoriser `MOBILE_MONEY` comme mode déclaré puis validé par un agent, comme Zelle.
- **Acceptation** : rejouer les **cas de l'annexe 8.3** de la comparaison (115,65 $ / 150 $ / 145,45 $ / 25,30 $ / 72 $ / 400 $) comme tests automatiques ; l'écart toléré sur l'aérien est de 2 centimes.
- **Taille** : M à L. **Piège** : choisir l'arrondi (exact comme le prototype, ou demi-livre) : c'est une décision d'entreprise (§ 7).

### 5.3 Gestion financière (rangs 7, 8, 9)

- **Coûts** : un **coût d'achat unitaire** par grille (3,90 $/lb, 14 $/pi³, 150 $/baril) ; au moment de la pesée, le coût est **figé** sur le colis (comme l'est déjà le prix, `pricingSnapshot`), donc un changement de tarif ne réécrit pas l'histoire.
- **Confidentialité** : les coûts et marges ne sortent **jamais** vers le site public, l'espace client, ni les rôles de réception ou de partenaire ; permission dédiée (`cost:read`, `report:profit`) réservée à l'administrateur et à la comptabilité ; **test d'absence** dans toutes les réponses destinées aux clients et au personnel limité.
- **Dépenses** : catégories et agences, saisie datée, pièces jointes (le stockage de fichiers existe).
- **Petite caisse** : écritures (dépense ou approvisionnement) par devise, solde courant, alerte de solde bas, rapport du jour.
- **Dépôts bancaires** : ils se **rattachent aux caisses déjà existantes** (une caisse a une devise, une agence, une clôture avec écart) au lieu de recalculer « toutes les espèces » comme le fait le prototype ; écart déposé − encaissé par période ; bordereau imprimable.
- **Incidents** : ajouter à la réclamation l'**indemnité payée au client** et le **remboursement du transporteur**, qui alimentent le profit.
- **Référents** : référent par client, taux, relevé mensuel, paiement des commissions.
- **Profit mensuel** : chiffre d'affaires − frais CONATEL reversés − coût d'achat − dépenses − petite caisse − commissions − indemnités nettes, sur 12 mois et par mode (formules du prototype, reprises à l'identique pour pouvoir **comparer les chiffres**).
- **Taille** : L au total ; à livrer en trois morceaux (coûts et profit, caisses et dépôts, référents et incidents).

### 5.4 Exploitation et confort (rangs 10 à 12)

Proforma du personnel (validité, PDF, conversion en colis, en s'appuyant sur le stockage d'estimations existant) ; détection du transporteur par le format du numéro (UPS, USPS, FedEx, DHL, Amazon) avec lien de suivi, alerte de retard, « flot par client » ; boutons **WhatsApp / SMS en un clic** (`wa.me`, `sms:`) qui remplissent le modèle de message existant, **sans fournisseur payant** ; rôle partenaire (portée par entrepôt, sans accès aux coûts) ; transport terrestre (nouveau mode) et colis Haïti → USA ; **hors ligne** limité d'abord à la **réception par lecture de code** (file locale qui se synchronise au retour d'internet), car c'est là que la connexion fait le plus défaut.

## 6. Reprise des données du prototype

### 6.1 Ce qu'on importe, ce qu'on archive

| Donnée du prototype | Décision | Où dans le projet |
|---|---|---|
| Clients (nom, téléphones, e-mail, adresse, pays, référent, date de création) | **Importer tous** | `Customer` sans compte (§ 5.1), `legacyCode` = ancien code `B2C-…` |
| Colis **ouverts** (tous statuts sauf livré et retourné) | **Importer** | `Package`, statut mis en correspondance (tableau ci-dessous), `legacyTrackingNumber` |
| Colis livrés ou retournés | **Importer les 12 derniers mois en lecture seule** (statut livré, sans pièces financières) ; archiver le reste en fichier | `Package` terminé |
| Paiements et factures historiques | **Ne pas importer** (factures immuables et numérotées, C7) ; conserver les PDF et l'export dans les archives | Archive hors base |
| **Soldes ouverts** (montant − payé par colis) | **Réémettre** : une nouvelle facture par client à la bascule, référencée « reprise de solde » | `Invoice` normale |
| Tarifs et réglages (taux, 5 $/lb, 18 $/pi³, 220 $/baril, diviseurs, commission 10 %) | **Saisir** dans les grilles et réglages | `RateCard`, `CompanySetting` |
| Table CONATEL (21 lignes) | **Importer** | table d'articles (§ 5.2) |
| Dépenses, dépôts, petite caisse, référents, incidents | **Importer après la vague finances** | modules § 5.3 |
| Employés et paies | **Ne pas importer** | hors périmètre |
| Utilisateurs et PIN | **Ne jamais importer** ; recréer les comptes avec invitation et mot de passe fort, double authentification | `User` |
| Journal d'audit local | Archiver | — |

### 6.2 Correspondance des statuts

| Prototype | Projet |
|---|---|
| Reçu aux USA | `RECEIVED_AT_WAREHOUSE` (ou `REGISTERED_WEIGHED` si pesé) |
| En transit | `IN_TRANSIT` |
| Arrivé en Haïti | `ARRIVED_DESTINATION` |
| En douane | `IN_CUSTOMS` |
| Prêt pour livraison | `READY_FOR_PICKUP` |
| Livré | `DELIVERED` |
| Retourné | `RETURNED` |

### 6.3 Procédure de bascule

1. **Répétition à blanc** : un script d'import (rejouable, en mode « simulation ») lit l'export JSON du prototype et produit un **rapport** : nombre de clients et de colis lus, doublons de téléphone, adresses mal formées, statuts inconnus, codes en double. Rien n'est écrit.
2. **Nettoyage** des anomalies du rapport, côté prototype ou par règles d'import.
3. **Gel** : à une date annoncée, plus de saisie dans le prototype ; export final.
4. **Import réel** dans une base **vide**, puis **rapprochement** : nombre de clients, nombre de colis par statut, **total des soldes ouverts par client** identiques à ceux du prototype.
5. **Réémission des soldes**, vérification des totaux, ouverture aux utilisateurs.
6. **Prototype en lecture seule** pendant au moins un mois (filet de sécurité), puis archivage.

## 7. Feuille de route par vagues

| Vague | Contenu | Taille relative | Source de vérité à la fin | Critère de sortie vérifiable |
|---|---|---|---|---|
| **0. Fondations** | Rang 1 et 6 (sans MonCash si non décidé) : coordonnées, entrepôts Miami et Philadelphie, agence de Pétion-Ville, grille aérienne 5 $/lb, taux de change, équivalent en gourdes | S | Prototype pour l'exploitation ; projet pour le **site public** | Le calculateur public donne 115,67 $ pour le colis de l'annexe 8.3 ; la page Contact affiche les vraies coordonnées |
| **1. Comptoir** | Rang 2 et 3 : clients sans compte, colis au comptoir avec destinataire, remise au destinataire, import des clients et des colis ouverts (simulation puis réel) | M | **Projet** pour clients et colis | Le rapport de rapprochement est à zéro écart ; un colis créé au comptoir est livré à un destinataire |
| **2. Tarifs** | Rang 4 et 5 (+ MonCash) : pied cube, barils, contenants, CONATEL, remise par baril, prix encadré | M à L | **Projet** pour les devis et les factures | Les 6 cas de l'annexe 8.3 passent en tests automatiques ; une facture de 2 barils = 400 $ |
| **3a. Profit** | Coûts figés à la pesée, dépenses, profit mensuel | M | Projet pour la marge | Le profit d'un mois rejoué sur les données importées est **identique** à celui du prototype (à l'arrondi près) |
| **3b. Caisses** | Dépôts bancaires, petite caisse, rapprochement avec les clôtures de caisse | M | Projet pour l'argent liquide | « Reste à déposer » égal au prototype sur une période témoin |
| **3c. Référents, incidents** | Commissions, indemnités | S à M | Projet | Relevés de commission identiques sur un mois témoin |
| **4. Exploitation** | Proforma, outils d'achats, WhatsApp en un clic, rôle partenaire, terrestre, Haïti → USA | M | Projet | Un partenaire de Philadelphie voit ses colis, jamais les coûts |
| **5. Hors ligne et clôture** | Réception hors ligne ; archivage définitif du prototype | L | Projet seul | Une réception hors ligne se synchronise sans doublon |

**Chemin critique** : 0 → 1 → 2 → 3a. Les vagues 3b, 3c et 4 se font en parallèle une fois la 2 terminée ; la vague 5 est conditionnée à la qualité réelle de la connexion.

## 8. Décisions à prendre par vous avant de commencer

| # | Décision | Ma recommandation |
|---|---|---|
| 1 | Le projet doit-il gérer l'**envoi par un expéditeur vers un destinataire** (modèle du prototype), en plus de l'achat en ligne du client ? | **Oui** : c'est l'essentiel de l'usage au comptoir |
| 2 | Autoriser les **clients sans compte** (téléphone seulement), invitables plus tard ? | **Oui** |
| 3 | **Prix modifiable à la main** ? | Seulement avec permission, motif et trace (§ 5.2) |
| 4 | **Arrondi** du poids facturable : exact (comme le prototype) ou à la demi-livre ? | Exact au début pour retrouver vos prix, quitte à changer plus tard par une nouvelle version de grille |
| 5 | **MonCash** : le rétablir ? | **Oui**, déclaré puis validé comme Zelle |
| 6 | Qui voit les **coûts et le profit** ? | Administrateur et comptable, personne d'autre |
| 7 | Frais **CONATEL** : reversés (hors profit) comme aujourd'hui ? Qui met la table à jour ? | Oui, administrateur uniquement |
| 8 | Taux de change : saisi à la main avec historique ? | Oui, affichage seulement |
| 9 | **Paie** hors du projet ? | Oui |
| 10 | **Hors ligne** : indispensable, et où ? | À trancher après une semaine de mesure des coupures réelles ; viser la réception en entrepôt |
| 11 | **Partenaires** des États-Unis : combien, quel périmètre ? | Un rôle par site, sans accès aux coûts |
| 12 | Historique à reprendre : seulement les colis ouverts et 12 mois de livrés ? | Oui |
| 13 | Date de **gel** du prototype et durée de la lecture seule ? | Gel annoncé 2 semaines avant ; lecture seule 1 mois |

## 9. Risques et parades

| Risque | Parade |
|---|---|
| **Deux systèmes saisis en même temps** (doublons, soldes faux) | Une source de vérité par domaine et par vague (§ 7) ; gel avant chaque bascule |
| **Prix différents de ceux auxquels les clients sont habitués** | Reprise des formules à l'identique, cas de l'annexe 8.3 en tests, arrondi exact au départ |
| **Fuite des coûts d'achat** | Permissions dédiées, redaction dans les réponses, test d'absence, matrice des rôles |
| **Données importées de mauvaise qualité** (téléphones, doublons, statuts) | Simulation avec rapport avant toute écriture ; rapprochement chiffré après |
| **Modèle client fragilisé** par la suppression de l'obligation de compte | Migration soignée, 24 usages relus, tests de non-régression existants (1 187) et nouveaux ; isolation par entreprise testée |
| **Facture ou numéro de suivi historique introuvable** | Ancien code accepté au suivi public ; archive des factures conservée |
| **Dérive du périmètre** (le prototype a tout, tout de suite) | Une vague = un critère de sortie ; paie et présence en direct hors périmètre |
| **Adoption de l'équipe** | Jeu de données de démonstration (`npm run db:seed:demo-data`) pour former avant chaque bascule ; une vague à la fois |
| **Hors ligne mal évalué** | Mesurer d'abord ; commencer par la seule réception en entrepôt |

## 10. Ce qui n'est volontairement pas repris

Code PIN à 4 chiffres, comptes par défaut, droits appliqués dans le navigateur, base dans `localStorage`, synchronisation par `api.php` et clé partagée, journal d'audit modifiable, suppression sans trace, calcul de numéros dans le navigateur, paie. Le projet les remplace par des équivalents sûrs (mots de passe forts, double authentification, droits côté serveur, journal inviolable, numérotation par la base).

## 11. Pour démarrer

1. Répondre aux décisions 1, 2, 3, 4 et 5 (les autres peuvent attendre leur vague).
2. **Semaine 1 (vague 0)** : je prépare le chargement des vraies coordonnées, des entrepôts et de la grille aérienne, après votre validation de chaque valeur.
3. **Semaines suivantes (vague 1)** : migration du modèle client et du colis au comptoir, avec ses tests, puis script d'import en simulation.
4. À la fin de chaque vague : suite de tests complète, recette avec les données de démonstration, mise à jour de `RISKS.md`.

## 10. État d'avancement de la fusion

| Vague | État | Ce qui existe |
|---|---|---|
| **0. Fondations** | Faite | MonCash rétabli (déclaré puis validé comme Zelle) ; taux gourdes/dollar avec historique (`GET/PUT /v1/admin/settings/fx-rate`) ; **équivalent indicatif en gourdes** sous le reste à payer d'une facture en dollars (panel, site, **PDF de facture et reçu**), sur le total du calculateur public et sur les frais d'un colis du site (`GET /v1/public/companies/:slug/fx-rate`, `GET /v1/me/fx-rate`) ; **mise en place des vraies données depuis le panel** (Administration → Paramètres : valeurs de départ en un clic, puis coordonnées, entrepôts, agences, catégories, taux et seuils modifiables à la main ; le script `npm run setup:company` reste facultatif, `docs/SETUP_COMPANY.md`) : coordonnées, entrepôts Miami et Philadelphie, agence de Pétion-Ville, catégories, grilles aérienne (5 $/lb, 166 ; 132 pour l'e-conteneur) et maritime (18 $/pi³, baril 220 $), taux 135, table CONATEL ; rejouable. |
| **1. Comptoir** | Faite | Clients sans compte (`/v1/admin/customers`, invitation), colis de comptoir avec destinataire (`POST /v1/admin/packages/counter`), remise au destinataire (`RECIPIENT`), écran « Comptoir », import du prototype (`docs/IMPORT_GESTION.md`, migration 0015), **suivi public par l'ancien code** (`GET /v1/public/tracking/legacy/:slug/:code`, limite de débit stricte, utilisé par la page de suivi du site), **notification** : un client sans e-mail reçoit `NO_EMAIL` (jamais d'envoi à l'adresse factice). |
| **2. Tarifs** | Faite | Base de calcul par tranche : poids, **volume (pied cube)**, **unité (baril)**, diviseur propre à une tranche, quantité sur le colis (migration 0016) ; les 6 cas de l'annexe 8.3 sont des tests automatiques ; **prix convenu** encadré (`price:override`) ; **rabais par baril** à la facturation (`unitDiscounts`, `discount:apply`, plafond de l'entreprise, ligne de rabais séparée) ; **CONATEL** (migration 0017) : table, lignes par colis à frais figés, lignes de facture `CUSTOMS` reversées (jamais remisées en pourcentage) ; écrans « Grilles tarifaires » (liste, activation, duplication, création avec tranches poids, volume ou unité), « Frais CONATEL », ajustements par colis dans la facturation. |
| **3a. Profit** | Faite | Coût d'achat par tranche de grille (`unitCost`, réservé à `cost:manage`/`cost:read`, jamais dans le détail d'une grille ni dans une estimation) **figé sur le colis à la pesée** ; dépenses (`/v1/admin/expenses`, journalisées) ; **profit mensuel sur 12 mois** (`GET /v1/admin/reports/profit`) : chiffre d'affaires hors frais CONATEL et taxes − coût figé − dépenses − commissions − incidents, par mode ; nouveau rôle **Comptable** ; les chiffres de l'annexe 8.3 sont rejoués en test (222 $ de CA, 173 $ de coût, 49 $ de marge). Écrans « Profit », « Dépenses », champ de coût dans « Grilles tarifaires ». Migration 0018. |
| **3b. Caisses** | Faite | **Petite caisse** (`/v1/admin/petty-cash` : approvisionnements et dépenses par devise, numéro PC-AAAA-NNNNNN, écritures non modifiables, dépense refusée au-delà du solde, seuil d'alerte de solde bas, rapport du jour) ; **dépôts bancaires** rattachés aux **caisses clôturées** (`/v1/admin/deposits` : « reste à déposer » par devise, attendu = compté − fonds de caisse, écart déposé − attendu figé, une caisse ne se dépose qu'une fois, compte limité à 4 caractères, **bordereau PDF**). Écrans « Petite caisse » et « Dépôts bancaires ». Migrations 0019 et 0020. |
| **3c. Référents, incidents** | Faite | **Référents** (`/v1/admin/referrers` : pourcentage du profit des clients amenés, jamais négatif, relevé mensuel, **paiement de la commission une fois par mois**, rattachement d'un client) ; **incidents** : indemnité payée au client et remboursement du transporteur par réclamation (`/v1/admin/claims/:id/compensation`), jamais visibles du client ; le profit déduit commissions et incidents (net de l'exemple : 26,70 $). Écrans « Référents » et carte d'indemnisation sur la réclamation. Migration 0021. |
| **4. Exploitation** | Presque faite | **Rôle Partenaire** (portée par entrepôt : colis et clients de son site, aucun accès aux coûts ni aux finances) ; **envoi Haïti → étranger** (entrepôt en Haïti, pays de destination au comptoir) ; **détection du transporteur** (UPS, USPS, FedEx, DHL, Amazon) avec lien de suivi ; **WhatsApp et SMS en un clic** (liens `wa.me` et `sms:`, message prérempli, sans fournisseur payant) ; **alerte de retard** (`/v1/admin/reports/delays`) et **flot par client** ; **proforma** (`/v1/admin/proformas` : figée, numéro PF-AAAA-NNNNNN, valable N jours, PDF, transformation en colis de comptoir, refus si périmée ou déjà transformée ; migration 0022). **Pas fait** : le mode de transport **terrestre** (il ajoute une adresse de réception par client et touche beaucoup de tests : à traiter à part), le suivi automatique chez le transporteur (liens seulement). |
| **5. Hors ligne** | Faite pour la réception | Réception par lecture de code **sans connexion** : les lectures sont gardées sur l'appareil, rejouées dans l'ordre au retour d'internet (bouton et événement `online`), **sans doublon** (la réception est idempotente) ; un refus du serveur passe dans une liste d'échecs, jamais rejoué en boucle. Les autres écrans ne sont pas utilisables hors ligne. Reste à décider : archivage définitif du prototype (voir § 6.3). |

Décisions prises par défaut (§ 8, recommandations) : projet = noyau ; clients sans compte par utilisateur « fantôme » ; arrondi exact ; MonCash rétabli ; frais CONATEL reversés, table modifiable par ceux qui gèrent les tarifs (`rate:manage`) ; coûts réservés à l'administration et à la comptabilité (non implémentés) ; paie hors périmètre.

**À vérifier avant usage** : la table CONATEL et les tarifs de départ viennent du prototype ; l'organisme fixe ses prix « jusqu'à nouvel ordre », faites-les contrôler. L'ancien code de suivi (`B2C-AAMMJJ-NNNN`) est plus facile à deviner qu'un numéro généré : la recherche publique est limitée à 10 par minute et ne montre que le statut, jamais de donnée personnelle.

**Pas de livraison à domicile** (décision de l'entreprise) : les tournées, « Mes tournées » et le rôle livreur sont masqués dans le panel (`VITE_FEATURE_DELIVERY=false` par défaut, réactivable ; l'API et les données sont intactes). La remise se fait à l'agence ou au comptoir, au client, à un bénéficiaire ou au destinataire. Le site public ne promet plus de livraison dans la page « Retrait » et l'étape « Remise en agence » ; les textes de présentation du site (accueil, services, retrait, étapes, conditions, confidentialité) en français, anglais et créole ne promettent plus de livraison. Restent volontairement : les adresses « de livraison » du compte client (champ conservé tant que la fonction n'est pas retirée), l'état « Livré » (= remis) et les libellés internes du panel.
