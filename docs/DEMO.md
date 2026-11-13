# Découvrir le projet avec les données de démonstration

Ce guide charge dans l'entreprise **« demo »** une petite histoire complète (de la préalerte d'un client à la remise du colis) et indique **quoi regarder, avec quel compte**. Tout est fictif : adresses en `@demo.invalid`, noms préfixés « DEMO », aucun tarif réel. **Jamais en production** (les scripts refusent `NODE_ENV=production`).

## 1. Charger les données (5 minutes)

Prérequis : Docker démarré, `npm install`, `npm run setup:env`, `npm run docker:up`, `npm run build`, `npm run db:migrate`, `npm run db:seed`. En développement, `REQUIRE_STAFF_2FA=false` (valeur par défaut de `.env.example`).

```bash
# 1. L'entreprise « demo » et un compte par rôle (le même mot de passe pour tous : choisissez le vôtre)
DEMO_PASSWORD='Choisissez-un-mot-de-passe-solide-1' npm run db:seed:demo
```
```bash
# 2. Démarrer l'API (dans un terminal à part, elle doit rester lancée)
npm start
```
```bash
# 3. Jouer le scénario : le script se connecte en tant que chaque personne et appelle l'API réelle
DEMO_PASSWORD='Choisissez-un-mot-de-passe-solide-1' npm run db:seed:demo-data
```

Puis lancez les deux interfaces :

```bash
npm run dev:admin    # panel du personnel : http://localhost:5174
npm run dev:web      # site et espace client : http://localhost:5173
```

> **Important** : le site et le panel se connectent à l'entreprise désignée par `VITE_COMPANY_SLUG` dans `.env` : mettez `VITE_COMPANY_SLUG=demo` (puis relancez `dev:web` et `dev:admin`), sinon la connexion est refusée. Les e-mails de développement (confirmation, notifications) s'affichent dans Mailpit : http://localhost:8035.

**Pourquoi par l'API et pas directement en base ?** Les données passent par les vraies règles du produit : machine d'états des colis, factures numérotées sans trou, caisse obligatoire pour les espèces, droits par rôle et par entrepôt ou agence. Ce que vous voyez est ce que l'application sait réellement produire.

Le script est **rejouable sans danger** : si l'entreprise contient déjà des colis, il s'arrête sans rien modifier (`SEED_FORCE=1` pour l'imposer, ce qui duplique les données). Pour repartir de zéro : `npm run docker:down`, supprimer les volumes, puis recommencer.

## 2. Les comptes

Mot de passe : celui de `DEMO_PASSWORD`. Connexion du **personnel** sur le **panel**, des **clients** sur le **site**.

| Compte (`…@demo.invalid`) | Où | Ce qu'il peut faire (et ne peut pas) |
|---|---|---|
| `company-admin` | panel | Tout dans l'entreprise : utilisateurs, rôles, entrepôts, agences, tarifs, paramètres, journal d'audit |
| `reception-agent` | panel | Recevoir, peser, ranger **dans l'entrepôt DEMO-MIA seulement** ; aucun accès à l'argent |
| `warehouse-manager` | panel | Entrepôt DEMO-MIA : emplacements, inventaire, anomalies |
| `billing-agent` | panel | Factures, paiements, caisse, remboursements, export comptable ; ne touche pas aux colis |
| `logistics-manager` | panel | Lots de transport, manifestes, départs et arrivées |
| `agency-manager` | panel | Agence DEMO-PAP : réception, retrait, remise, tournées de livraison |
| `driver` | panel | **Ses seules tournées** ; aucun montant visible |
| `customer-service` | panel | Réclamations et suivi clients ; **ne manipule pas d'argent** |
| `auditor` | panel | Lit tout, **ne modifie rien** |
| `customer-individual`, `nadege` | site | Espace client : mes colis, préalertes, factures, paiements |
| `customer-business` | site | Comme un client, plus la gestion d'une **équipe** (membres lecteur/opérateur) |

> **Expérience à faire** : connectez-vous successivement avec `reception-agent`, `billing-agent` et `auditor` et comparez les menus : chaque rôle ne voit que ce que ses droits permettent (voir [ROLE_MATRIX.md](ROLE_MATRIX.md) pour la matrice complète vérifiée route par route).

## 3. L'histoire en 11 colis : chacun à une étape différente

Le script affiche les numéros de suivi. Retrouvez-les dans le panel (**Colis**) ou, pour un client, dans **Mes colis**. La description de chaque colis commence par « DEMO · étape N ».

| # | Étape | Ce que vous pouvez observer |
|---|---|---|
| 1 | **Préalerte** (attendu) | Le client a déclaré son achat. Écran « Colis attendus » du personnel ; le colis n'est pas encore arrivé |
| 2 | **Reçu en entrepôt** | Rapprochement par le numéro du marchand ; historique daté |
| 3 | **Pesé** | Poids réel / volumétrique / facturable, **frais calculés** d'après la grille |
| 4 | **Facturé, en attente de paiement** | Facture `INV-AAAA-NNNNNN` émise (immuable, PDF) ; le colis attend le paiement |
| 5 | **Paiement Zelle à valider** (maritime) | Le client a déclaré un paiement : **validez-le** dans Paiements avec `billing-agent` |
| 6 | **Prêt à partir** | Payé en espèces (reçu `RCT-…`), rangé en emplacement A-01 |
| 7 | **En transit** (2 colis) | Dans un lot aérien **parti** ; manifeste CSV/PDF |
| 8 | **Reçu en agence** | Lot arrivé, colis reçu à Port-au-Prince |
| 9 | **Prêt pour retrait** | Le client est prévenu ; il génère son code de remise |
| 10 | **Remis au comptoir** | Code du client + 4 derniers caractères de la pièce d'identité |
| 11 | **Livré à domicile** | Tournée confiée au livreur, preuves de remise |

Autres éléments chargés : un colis **retenu** (anomalie), un colis **sans client** à rattacher, une **réclamation** avec échange public et note interne, un **remboursement partiel**, un lot maritime **ouvert** (vide), une **caisse ouverte**, deux entrepôts, deux agences, deux grilles tarifaires (avion et bateau), des consignes de paiement (virement, Zelle), un membre d'équipe invité et des **notifications** envoyées (portail et e-mail ; WhatsApp « ignoré : canal non configuré »).

## 4. Parcours de découverte (à rejouer soi-même)

1. **Suivi public, sans compte** : sur le site, page « Suivi de colis », saisissez le numéro du colis 7 : seuls statuts et dates apparaissent (aucun nom, adresse ni montant).
2. **Calculateur** : estimez les frais avion puis bateau pour 5 kg ; l'estimation est toujours distinguée du montant final.
3. **Côté client** (`customer-individual`) : « Mes colis » (historique public), « Mes factures » (PDF), « Mes préalertes », « Adresses de réception » (une par entrepôt et par mode, liée à votre code client), la réclamation ouverte et ses échanges (sans les notes internes).
4. **Valider un paiement** (`billing-agent`) : Paiements → le virement Zelle déclaré du colis 5 → confirmer. La facture passe « payée », un reçu est émis et le colis passe **automatiquement** « prêt à partir ».
5. **Charger le lot maritime** (`logistics-manager`) : Lots → le lot maritime ouvert → charger le colis 5 (maintenant prêt) → faire partir le lot.
6. **Rattacher le colis sans client** (`reception-agent` ou `company-admin`) : Entrepôt → Anomalies → identifier le colis par le code client.
7. **Clore la réclamation** (`customer-service`) : Réclamations → répondre, puis résoudre avec une explication ; le client est notifié.
8. **Fermer la caisse** (`billing-agent`) : Caisse → clôturer : attendu = fond + espèces − remboursements, écart calculé ; une caisse close ne change plus.
9. **Tournée du livreur** (`driver`) : « Mes tournées » : uniquement la sienne, sans montants.
10. **Journal d'audit et tableau de bord** (`auditor`, `company-admin`) : chaque action est tracée (qui, quoi, avant/après) ; le tableau de bord est calculé sur ces données réelles.
11. **Sécurité par les droits** : essayez, avec `reception-agent`, d'ouvrir une facture ou la caisse : l'accès est refusé ; avec `agency-manager`, les colis d'une autre agence sont invisibles.

## 5. Ce que ces données ne montrent pas

- Aucun paiement en ligne par carte, aucun envoi WhatsApp, aucune intégration de transporteur : le projet ne les contient pas (voir [RISKS.md](RISKS.md), section B).
- Les numéros de suivi et de lot changent à chaque chargement ; les adresses et coordonnées sont fictives.
- Pour vérifier la **double authentification** obligatoire du personnel, mettez `REQUIRE_STAFF_2FA=true` : le script de démonstration ne peut alors plus se connecter, car il ne gère pas le second facteur.

## 6. Dépannage

| Symptôme | Cause et remède |
|---|---|
| « Connexion impossible avec company-admin… » | `db:seed:demo` n'a pas été lancé, ou le mot de passe diffère de celui utilisé alors |
| « La double authentification est obligatoire » | `REQUIRE_STAFF_2FA=true` : le passer à `false` en développement |
| « Trop de requêtes » (429) | Limite de débit : attendre quelques minutes ; le script gère déjà sa propre cadence |
| Le site ou le panel refuse la connexion | `VITE_COMPANY_SLUG` ne vaut pas `demo` dans `.env` : le corriger et relancer les serveurs |
| « contient déjà des colis » | Normal : le scénario est déjà chargé |
