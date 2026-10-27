# Modèle de domaine

Phase 2. Décrit le vocabulaire, les entités, les règles qui doivent toujours être vraies (invariants) et la machine d'états. Le détail des tables est dans [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md).

## 1. Vocabulaire

| Terme | Sens |
|---|---|
| Entreprise (Company) | Société de logistique cliente de la plateforme. Frontière d'isolement des données |
| Client (Customer) | Personne ou société qui expédie. Possède un **code client** |
| Entrepôt (Warehouse) | Lieu de réception à l'origine (par exemple Miami) |
| Agence (Agency) | Lieu de retrait/livraison à destination (par exemple Pétion-Ville) |
| Préalerte (Prealert) | Déclaration d'un achat par le client avant l'arrivée du colis |
| Colis (Package) | Unité physique suivie, avec un numéro de suivi |
| Lot / Expédition (Shipment) | Ensemble de colis transportés ensemble sur un mode donné |
| Manifeste | Document listant les colis d'un lot |
| Grille tarifaire (RateCard) | Ensemble versionné de règles de prix et de calcul de poids |
| Poids facturable | Maximum du poids réel et du poids volumétrique, après minimum et arrondi |
| Estimation / Facture | L'estimation est indicative ; la facture est calculée à la pesée réelle |

## 2. Contextes et agrégats

Un **agrégat** est un groupe d'objets modifié ensemble et protégé par des règles communes.

| Contexte | Agrégats (racine → éléments) |
|---|---|
| Plateforme | Company (→ CompanySettings), PlatformAdmin |
| Identité | User (→ Credentials, Sessions, Verifications), Role (→ Permissions), UserRoleAssignment (portée) |
| Clients | Customer (→ Addresses, Beneficiaries, ReceivingAddresses) |
| Préalertes | Prealert (→ Attachments) |
| Colis | Package (→ Events, Items, Dimensions, Attachments, Holds) ; PackageGroup |
| Entrepôt | Warehouse (→ Locations, Movements, ScanSessions) |
| Tarification | RateCard (→ Rules, VolumetricRule, Surcharges), Tax, ServiceFee |
| Transport | Shipment (→ ShipmentPackages, ShipmentEvents, Documents), Carrier |
| Livraison | Agency, DeliveryZone, Route (→ Stops), DeliveryAttempt (→ ProofOfDelivery) |
| Finance | Invoice (→ Lines), Payment (→ Allocations, Refunds), Receipt, CashSession |
| Notifications | NotificationTemplate, Notification (→ Attempts), OutboxEvent |
| Support | Claim (→ Messages) |
| Transverse | AuditLog (en ajout seul), IdempotencyKey, FileObject |

## 3. Règles métier (invariants)

### Identité et isolement
- I1. Toute entité métier appartient à exactement une entreprise ; aucune relation ne relie deux entreprises.
- I2. Un client ne peut lire que les objets dont `customer_id` est le sien (ou ceux de son compte professionnel).
- I3. Un employé agit dans ses portées (entrepôt/agence) ; une action hors portée est refusée.
- I4. Un utilisateur désactivé ne peut plus ouvrir de session ; ses sessions actives sont révoquées.

### Clients
- I5. Le code client est généré par le système, immuable et unique par entreprise.
- I6. Une adresse de réception est unique par (client, entrepôt, mode) ; elle est dérivée du modèle d'adresse de l'entrepôt et du code client, jamais saisie à la main.
- I7. Un bénéficiaire a une période de validité ; hors période, il ne peut pas retirer un colis.

### Colis
- I8. Le numéro de suivi est unique globalement et immuable.
- I9. Le statut ne change que par une transition autorisée (§4) et laisse toujours un événement (qui, quand, depuis quel statut, vers quel statut, motif).
- I10. Les événements de colis ne sont jamais modifiés ni supprimés ; une correction est un nouvel événement.
- I11. Poids facturable = arrondi(max(poids réel, poids volumétrique, minimum)) selon la grille appliquée ; la grille et sa version sont enregistrées sur le colis.
- I12. Un colis ne peut pas être `READY_TO_SHIP` sans poids réel, dimensions et client (ou mise en anomalie `ON_HOLD`).
- I13. Un colis ne peut appartenir qu'à un seul lot non terminé à la fois.
- I14. Un colis non identifié n'a pas de client ; il ne peut pas avancer au-delà de `UNDER_INSPECTION` avant rattachement.
- I15. Une remise (`DELIVERED`) exige : un récupérateur identifié, la preuve exigée par la règle de l'entreprise (OTP, signature ou photo) et un solde nul, sauf dérogation tracée.

### Préalertes
- I16. Une préalerte rapprochée référence au plus un colis ; un colis est rapproché d'au plus une préalerte par défaut (regroupement explicite sinon).
- I17. Le rapprochement automatique n'a lieu que sur correspondance **exacte** du numéro de suivi fournisseur ou sur code client lu ; le reste passe en file manuelle.

### Tarification
- I18. Une règle de prix s'applique à une dimension précise (mode, zone d'origine, zone de destination, catégorie, tranche de poids) pendant une période ; deux règles actives ne se recouvrent pas.
- I19. Sans règle applicable, le résultat est « tarif indisponible ». Aucun prix par défaut.
- I20. Une estimation enregistrée garde la version de grille utilisée ; modifier la grille ne change pas les estimations passées.

### Finance
- I21. Montants en décimal exact (jamais flottant) avec devise ; pas d'addition de devises différentes sans taux enregistré.
- I22. Une facture émise n'est plus modifiable ; une correction passe par un avoir.
- I23. Numérotation des factures et reçus sans trou, par entreprise et année.
- I24. Somme des affectations d'un paiement ≤ son montant ; solde d'une facture = total − paiements confirmés + remboursements.
- I25. Un paiement passe `CONFIRMED` seulement sur confirmation vérifiée ; une même confirmation rejouée n'a aucun effet supplémentaire.
- I26. Un remboursement ne dépasse pas le montant confirmé non encore remboursé.

### Notifications
- I27. Une notification est liée à un événement, un canal et une langue ; elle a un statut (`QUEUED`, `SENT`, `FAILED`, `SKIPPED`) et un nombre de tentatives.
- I28. Pour un même (événement, destinataire, canal), un seul envoi est effectué (clé d'idempotence).

## 4. Machine d'états du colis

Statuts (code → libellé du cahier) :

| Code | Libellé |
|---|---|
| `PREALERT_CREATED` | Préavis de colis créé |
| `AWAITING_RECEIPT` | En attente de réception |
| `RECEIVED_AT_WAREHOUSE` | Reçu à l'entrepôt |
| `UNDER_INSPECTION` | En cours de vérification |
| `REGISTERED_WEIGHED` | Enregistré et pesé |
| `AWAITING_PAYMENT` | En attente de paiement |
| `READY_TO_SHIP` | Prêt pour expédition |
| `IN_TRANSIT` | En transit |
| `ARRIVED_DESTINATION` | Arrivé dans le pays de destination |
| `IN_CUSTOMS` | En cours de traitement douanier |
| `RECEIVED_AT_AGENCY` | Reçu dans l'agence de destination |
| `READY_FOR_PICKUP` | Prêt pour retrait |
| `OUT_FOR_DELIVERY` | En cours de livraison |
| `DELIVERED` | Livré (terminal) |
| `ON_HOLD` | Retenu ou en anomalie |
| `RETURNED` | Retourné (terminal) |
| `CANCELLED` | Annulé (terminal) |

Transitions autorisées (toute paire absente est **refusée**) :

| De | Vers | Garde / permission principale |
|---|---|---|
| `PREALERT_CREATED` | `AWAITING_RECEIPT` | Automatique après création |
| `PREALERT_CREATED`, `AWAITING_RECEIPT` | `CANCELLED` | Client ou service client |
| `AWAITING_RECEIPT` | `RECEIVED_AT_WAREHOUSE` | `package:receive`, scan en entrepôt de portée |
| `RECEIVED_AT_WAREHOUSE` | `UNDER_INSPECTION` | `package:inspect` |
| `RECEIVED_AT_WAREHOUSE`, `UNDER_INSPECTION` | `REGISTERED_WEIGHED` | Poids et dimensions saisis, client rattaché (I12, I14) |
| `REGISTERED_WEIGHED` | `AWAITING_PAYMENT` | Facture/devis émis |
| `REGISTERED_WEIGHED`, `AWAITING_PAYMENT` | `READY_TO_SHIP` | Paiement confirmé **ou** politique de l'entreprise « paiement avant retrait » **ou** compte à crédit autorisé |
| `READY_TO_SHIP` | `IN_TRANSIT` | Lot parti (`shipment:dispatch`) |
| `IN_TRANSIT` | `ARRIVED_DESTINATION` | Lot arrivé |
| `ARRIVED_DESTINATION` | `IN_CUSTOMS` | Lot en douane |
| `ARRIVED_DESTINATION`, `IN_CUSTOMS` | `RECEIVED_AT_AGENCY` | Scan en agence de portée |
| `RECEIVED_AT_AGENCY` | `READY_FOR_PICKUP` | Notification déclenchée |
| `RECEIVED_AT_AGENCY`, `READY_FOR_PICKUP` | `OUT_FOR_DELIVERY` | Tournée assignée |
| `READY_FOR_PICKUP`, `OUT_FOR_DELIVERY` | `DELIVERED` | I15 |
| `OUT_FOR_DELIVERY` | `READY_FOR_PICKUP` | Tentative échouée, retour en agence |
| `UNDER_INSPECTION`, `IN_CUSTOMS`, `READY_FOR_PICKUP` | `RETURNED` | `package:return`, motif obligatoire |
| tout statut non terminal sauf `PREALERT_CREATED` | `ON_HOLD` | `package:hold`, motif obligatoire |
| `ON_HOLD` | statut précédent | `package:release_hold` (reprise) |
| `ON_HOLD` | `RETURNED`, `CANCELLED` | Permission spécifique, motif |

**Réalisé en phase 5** : la table du paquet partagé (`packages/shared/src/package-status.ts`) compte **40 règles** (26 « normales », 12 vers `ON_HOLD`, 2 sorties de `ON_HOLD`). Ajouts par rapport à ce tableau : `RECEIVED_AT_WAREHOUSE` et `UNDER_INSPECTION` → `CANCELLED` (réception saisie par erreur, ou colis fusionné dans le colis attendu d'un client ; motif obligatoire, `package:cancel`). Chaque règle porte un **module propriétaire** (`SYSTEM`, `PACKAGES`, `BILLING`, `SHIPMENTS`, `DELIVERY`) : l'API générique n'accepte que `PACKAGES` et `BILLING`. Tant que la facturation n'existe pas, `AWAITING_PAYMENT` et `READY_TO_SHIP` se décident à la main (`package:authorize_shipment`, motif exigé pour `READY_TO_SHIP`).

**Réalisé en phase 6** : les transitions `READY_TO_SHIP` → `IN_TRANSIT` → `ARRIVED_DESTINATION` → `IN_CUSTOMS` sont déclenchées par les **événements d'un lot** (table `SHIPMENT_TRANSITIONS` du paquet partagé, test exhaustif des 36 paires) ; `RECEIVED_AT_AGENCY` et `READY_FOR_PICKUP` par les écrans d'agence. La permission d'une transition d'agence se vérifie sur l'**agence de destination** du colis. Un lot : `OPEN` → `DISPATCHED` → `ARRIVED` → (`IN_CUSTOMS`) → `CLOSED`, ou `OPEN` → `CANCELLED` ; il se clôt seulement quand plus aucun colis n'attend sa réception en agence.

**Préalerte et rapprochement** : créer une préalerte crée le colis attendu (`PREALERT_CREATED` puis `AWAITING_RECEIPT` automatiquement) et émet tout de suite son numéro de suivi. À la réception : (1) choix manuel de l'agent ; (2) numéro de suivi du marchand **identique** (insensible à la casse et aux espaces ; une correspondance partielle ne rapproche rien) ; (3) code client lu sur l'étiquette avec **un seul** colis attendu ; plusieurs candidats = refus avec la liste ; (4) sinon nouveau colis, rattaché au code client ou « non identifié ». Un colis non identifié se rattache ensuite à un client, éventuellement en **fusionnant** dans son colis attendu (le colis physique est annulé, le client garde son numéro de suivi, les photos suivent).

`DELIVERED`, `RETURNED` et `CANCELLED` sont terminaux. Annuler après `READY_TO_SHIP` demande une permission élevée et la correction de la facture (avoir).

La politique de paiement est une option de l'entreprise : `PAY_BEFORE_SHIPMENT` (le colis attend en `AWAITING_PAYMENT`) ou `PAY_BEFORE_RELEASE` (paiement à la remise ; `READY_TO_SHIP` directement, et I15 bloque la remise tant que le solde n'est pas nul).

## 5. États des autres objets

| Objet | États |
|---|---|
| Préalerte | `OPEN`, `MATCHED_AUTO`, `MATCHED_MANUAL`, `CONFLICT`, `CANCELLED` |
| Lot | `DRAFT`, `LOADING`, `CLOSED`, `DISPATCHED`, `ARRIVED`, `IN_CUSTOMS`, `RECEIVED`, `CANCELLED` |
| Facture | `DRAFT`, `ISSUED`, `PARTIALLY_PAID`, `PAID`, `VOID`, `CREDITED` |
| Paiement | `PENDING`, `CONFIRMED`, `FAILED`, `CANCELLED`, `REFUNDED_PARTIAL`, `REFUNDED` |
| Tentative de livraison | `SCHEDULED`, `SUCCEEDED`, `FAILED`, `RESCHEDULED` |
| Réclamation | `OPEN`, `IN_PROGRESS`, `RESOLVED`, `REJECTED` |
| Notification | `QUEUED`, `SENT`, `FAILED`, `SKIPPED` |

## 6. Événements de domaine (alimentent audit, outbox et notifications)

`prealert.created`, `package.received`, `package.identified`, `payment.required`, `payment.confirmed`, `shipment.prepared`, `shipment.dispatched`, `shipment.arrived`, `package.available_at_agency`, `delivery.scheduled`, `package.delivered`, `package.incident`.
Les 12 événements de notification du cahier §13 correspondent un à un à cette liste.

## 7. Génération des identifiants

| Identifiant | Format | Garanties |
|---|---|---|
| Clé interne | UUID v7 | Jamais affiché |
| Numéro de suivi | `<préfixe entreprise 2-4 lettres>` + 10 caractères Crockford base32 aléatoires + 1 caractère de contrôle (poids impairs : détecte toute erreur sur un caractère) ; affiché `EE-XXXXX-XXXXX-C` | Unique global (contrainte + vérification préalable), non séquentiel, saisie tolérante (casse, tirets, O/0, I/L→1) ; un numéro au contrôle erroné reçoit la même réponse qu'un numéro inconnu |
| Code client | `<préfixe>-<séquence>` ex. `TH-000123` | Séquence par entreprise obtenue sous verrou ; jamais réattribuée |
| N° de facture / reçu | `INV-2026-000045`, `RCT-2026-000012` | Sans trou, par entreprise et année (table de compteurs verrouillée) |
| Référence de lot | `<entrepôt>-<mode>-<AAAAMMJJ>-<n>` | Unique par entreprise |
