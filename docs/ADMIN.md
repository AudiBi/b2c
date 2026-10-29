# Panel d'administration (`apps/admin`)

Depuis la séparation, **le personnel ne travaille plus sur le site** : il dispose d'une application à part, avec sa propre adresse, ses propres cookies de session et son propre design. Le site (`apps/web`) ne garde que les pages publiques et l'espace **client**.

## Ce qui a changé

| | Avant | Maintenant |
|---|---|---|
| Où | `/fr/account/staff/...` sur le site | application `apps/admin`, adresse dédiée (`admin.exemple.com`, port 5174 en développement) |
| Qui | personnel et clients dans le même espace | **personnel et plateforme seulement** ; un client qui s'y connecte est refusé et déconnecté |
| Langue | préfixe d'adresse `/fr`, `/ht`, `/en` | choix de l'utilisateur (FR / HT / EN), mémorisé dans le navigateur |
| Gestion des accès | API seulement | **écrans Utilisateurs et Rôles** |
| Plateforme | API seulement | **écran Entreprises** (création, suspension, réactivation) |
| Sessions | cookies partagés avec le site | cookies **distincts** : `b2c_admin_refresh` et `b2c_admin_session` |
| Compte du personnel sur le site | menu du personnel | page « Cet espace est réservé aux clients » avec un lien vers le panel |

## Écrans (selon les droits)

| Groupe | Écran | Droit requis |
|---|---|---|
| Aperçu | Accueil (accès rapides) ; Tableau de bord | – ; `report:read` |
| Exploitation | Réception ; Colis ; Entrepôt ; Lots ; Agence ; Tournées ; Mes tournées ; Réclamations | `package:receive` ; `package:read` ; `warehouse:read` ; `shipment:read` ; `agency:receive` ; `delivery:read` ; `delivery:read_assigned` ; `claim:read` |
| Finance | Factures ; Paiements | `invoice:read` ; `payment:read` |
| Communication | Notifications | `notification:read` |
| Administration | **Utilisateurs** ; **Rôles et droits** ; Journal d'audit | `user:read` ; `role:read` ; `audit:read` |
| Plateforme | **Entreprises** | `company:manage` |
| Compte | Sécurité (double authentification, mot de passe) | connecté |

Le menu n'affiche que ce que les droits permettent, mais **c'est le serveur qui décide** : chaque route de l'API vérifie le droit (et sa portée) à chaque requête.

### Utilisateurs et rôles
- **Liste** : recherche (nom, e-mail), filtres type et statut, pagination « Charger plus », rôles nommés, état, dernière connexion.
- **Invitation** (`user:create`) : prénom, nom, e-mail, téléphone, langue, **un rôle et sa portée** (toute l'entreprise, un entrepôt ou une agence selon le rôle). Un e-mail d'activation (72 h) part vers le **panel**.
- **Fiche** : compte, rôles attribués avec leur portée nommée, **ajout et retrait de rôle** (`role:assign`, retrait en deux temps), **désactivation / réactivation** (`user:disable`, en deux temps ; impossible sur son propre compte). Un compte client est en consultation seule.
- **Règles appliquées par le serveur** (le panel les explique) : on ne peut attribuer que des droits qu'on possède, le dernier administrateur ne peut être ni retiré ni désactivé, un rôle ne s'attribue qu'avec une portée autorisée.
- **Rôles et droits** : les **12 rôles système** (définis dans le code, en lecture seule) et les **rôles personnalisés** de l'entreprise.
  - **Rôle personnalisé** : un nom, une description, une **portée unique** (toute l'entreprise, un entrepôt ou une agence ; non modifiable ensuite) et des **droits** cochés parmi ceux du personnel (72 droits au catalogue), groupés par domaine. Réservé au droit `role:manage` (administrateur de l'entreprise).
  - **Anti-escalade** : on ne peut donner, modifier ou supprimer que des droits qu'on **détient soi-même** (les autres sont grisés dans l'éditeur ; le serveur le refuse de toute façon).
  - **Effet immédiat** : modifier les droits d'un rôle agit à la requête suivante de ses titulaires ; un rôle **encore attribué ne se supprime pas** ; au plus 30 rôles personnalisés par entreprise ; noms uniques (aussi face aux rôles système).
  - Un rôle personnalisé n'existe **que dans son entreprise** ; il est proposé à l'invitation et à l'ajout de rôle, avec sa portée imposée. Création, modification et suppression sont **auditées**.

### Entreprises (équipe plateforme)
Création (nom, identifiant, préfixes de suivi et de codes client, devise, langue, règle de paiement, administrateur invité), suspension en deux temps (déconnexion immédiate des utilisateurs), réactivation. **Aucune donnée métier** d'une entreprise n'est visible depuis la plateforme.

## Connexion
- **Personnel** : adresse e-mail et mot de passe ; l'entreprise est celle pour laquelle le panel est construit (`VITE_COMPANY_SLUG`).
- **Équipe plateforme** (super administrateur) : bouton « Accès équipe plateforme » sur l'écran de connexion (aucun identifiant d'entreprise n'est envoyé).
- **Double authentification** obligatoire en production : tant qu'elle n'est pas activée, seul l'écran Sécurité s'ouvre.
- Les liens d'invitation et de réinitialisation du mot de passe **du personnel** pointent vers le panel (`ADMIN_PUBLIC_URL`) ; ceux des clients vers le site.

## Sécurité propre au panel
- **Cookies distincts** : le panel envoie `X-Client-App: admin` ; l'API pose alors `b2c_admin_refresh` (HttpOnly) et `b2c_admin_session` au lieu de `b2c_refresh` / `b2c_session`. Un navigateur peut donc avoir une session client sur le site et une session du personnel sur le panel, **sans qu'elles se mélangent**, même sur le même domaine (essai local, ports différents). Testé par l'API et par le contrôle de fumée de production.
- **nginx** : adresse dédiée, CSP stricte, `X-Frame-Options: DENY`, `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer`, HSTS ; jamais référencé. Un bloc commenté permet de **restreindre le panel à certaines adresses IP** (non essayé).
- Un compte **client** qui se connecte sur le panel est refusé, sa session est refermée aussitôt.

## Lancer et construire
```bash
npm run dev:admin        # http://localhost:5174 (l'API doit tourner ; le panel la joint par le proxy /v1)
npm run build:admin      # apps/admin/dist (VITE_COMPANY_SLUG, VITE_BRAND_NAME, VITE_SITE_URL lus à la construction)
npm run preview:admin    # sert dist sur :4174 avec proxy /v1 (recette locale, pas la production)
```
En développement, le panel (`localhost:5174`) et le site (`localhost:5173`) peuvent être ouverts ensemble dans le même navigateur grâce aux cookies distincts.

Production : voir [DEPLOYMENT.md](DEPLOYMENT.md) (un seul conteneur nginx, deux noms de domaine ; le certificat doit couvrir les deux).

## Tests
- **Unitaires** (`apps/admin/tests`, Vitest) : les écrans du personnel repris du site (réception, colis, lots, agence, finance, livraison, réclamations, tableau de bord, audit, double authentification) **plus** les nouveaux écrans : accès (sans session, client refusé, menu selon les droits, plateforme, double authentification exigée, changement de langue), connexion (entreprise ou plateforme), utilisateurs (liste, filtres, invitation, refus du serveur), fiche (rôles, retrait, désactivation, son propre compte, compte client), rôles, entreprises (création contrôlée, suspension, réactivation), et la cohérence des textes dans les trois langues.
- **Recette navigateur** (`apps/web/e2e`) : le panel est un second serveur ; les parcours du personnel (logistique, finance, livraison) s'y déroulent avec contrôle d'accessibilité (axe). Elle a révélé un défaut réel : le nom accessible du menu du compte ne contenait pas son texte visible (WCAG 2.5.3), corrigé.
- **Contrôle de fumée de production** (`SMOKE_ADMIN_URL`) : voir DEPLOYMENT.md.

## Limites connues
- **Les 12 rôles système ne se modifient pas** (seuls les rôles personnalisés sont éditables) ; pas de rôle réservé à la plateforme personnalisable ; les libellés des droits dans l'éditeur sont en français (leur domaine est traduit) ; pas d'écran pour réinitialiser le second facteur d'un utilisateur ; pas d'invitation de client (ils s'inscrivent seuls) ; pas de changement d'adresse e-mail d'un utilisateur.
- **Une entreprise par construction du panel** (comme le site). L'équipe plateforme se connecte à l'adresse du panel d'**une** entreprise : il n'y a pas de panel plateforme à part, ni de sélecteur d'entreprise.
- **Poids** : ~250 Ko compressés pour le premier chargement (les trois langues sont embarquées) ; les écrans métier sont chargés à la demande. Les textes du panel contiennent encore des sections héritées du site (espace client) non utilisées.
- **Créole** : les nouveaux textes (utilisateurs, rôles, entreprises, connexion) n'ont pas été relus par un locuteur natif.
- **Accessibilité** : contrôle automatique (axe) seulement, en français ; pas d'audit manuel ni de test avec lecteur d'écran. **Navigateurs** : Chromium seulement ; **pas de mode sombre**.
- Les écrans des phases 6 à 8 **ont été déplacés tels quels** : leur contenu est celui d'avant, habillé par le nouveau design (cartes, tableaux, badges). Certains écrans (réception, fiche colis, tournées) restent denses : un travail de présentation écran par écran n'a pas été fait.
- La restriction par adresse IP (nginx) et le déploiement sur un vrai serveur ne sont pas essayés (voir RISKS.md).
