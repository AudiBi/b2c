# Site web et espace client (`apps/web`)

Phase 4. Site public (17 pages, 3 langues) et espace client. Il s'appuie sur l'API de la phase 3 ; il ne contient aucune règle métier (les schémas de validation sont ceux de `packages/shared`).

## Pile et principes

| Sujet | Choix |
|---|---|
| Interface | React 19 + TypeScript, Vite 7, React Router 7 (mode déclaratif), TanStack Query |
| Rendu | **Pré-rendu au build** (décision D1) : chaque page publique est un fichier HTML complet, avec son contenu, `<title>`, description, `canonical` et `hreflang`, puis « hydraté » par React. Sans JavaScript le contenu reste lisible |
| Pages non pré-rendues | L'espace client (`/{langue}/account/*`) : coquille vide `200.html`, rendue par le navigateur après connexion. Il est chargé à la demande (fichier séparé) |
| Données publiques | Entrepôts et coordonnées de contact sont chargés **côté navigateur** depuis l'API : le build ne dépend pas de l'API |
| Textes | `src/i18n/fr.ts` est la source ; `en.ts` et `ht.ts` ont le type `Messages` : **une clé manquante ou en trop est une erreur de compilation**. Aucun texte en dur dans les composants |
| Validation des formulaires | Schémas zod partagés avec l'API ; messages d'erreur traduits par `forms/validation.ts` (le serveur renvoie des codes stables, p. ex. `phone_format`) |
| Style | CSS maison (variables dans `styles/tokens.css`), mobile d'abord, sans bibliothèque. Palette et logo **provisoires et originaux** |
| Accessibilité | HTML sémantique, lien d'évitement, focus visible, libellés liés aux champs, erreurs annoncées, navigation clavier, `prefers-reduced-motion`. Contrôlée automatiquement par axe (WCAG 2.1 A/AA) sur chaque page, ordinateur et téléphone |
| Session | Jeton d'accès **en mémoire seulement** ; renouvelé avec un cookie HttpOnly. Un cookie « indice » `b2c_session` (lisible, sans secret) évite tout appel inutile pour un visiteur anonyme. Renouvellements dédoublonnés (un seul appel à la fois, y compris entre onglets via Web Locks) |

Dossiers : `src/pages` (pages), `src/components` (ui, layout), `src/api` (client HTTP), `src/auth`, `src/forms`, `src/i18n`, `src/styles`, `scripts/` (pré-rendu, serveur de prévisualisation), `e2e/` (Playwright), `tests/` (Vitest).

## Commandes

```bash
npm run dev:api        # (racine) construit et lance l'API sur :3100
npm run dev:web        # serveur de développement du site sur :5173 (proxy /v1 → API)
npm run build:web      # construit le site pré-rendu dans apps/web/dist/client
npm run preview:web    # sert dist/client sur :4173 avec proxy /v1 (recette locale, pas la production)
npm test               # tests unitaires du site (Vitest) avec ceux de l'API
npm run test:e2e       # recette navigateur (Playwright, voir TEST_PLAN.md)
```

Variables lues **à la construction** (fichier `.env` de la racine ; seules celles préfixées `VITE_` atteignent le navigateur) :

| Variable | Rôle |
|---|---|
| `VITE_COMPANY_SLUG` | Entreprise servie par ce site. **Une construction = une entreprise** |
| `VITE_BRAND_NAME` | Nom de marque affiché (« B2C » par défaut) |
| `VITE_API_URL` | Vide par défaut (même origine). À renseigner seulement si l'API est sur un autre domaine (alors configurer CORS et revoir le cookie de session) |
| `SITE_URL` | URL publique, utilisée au pré-rendu pour `canonical`, `hreflang`, `sitemap.xml`, `robots.txt`. **À définir pour toute mise en ligne** |

## Déploiement du site (dossier `dist/client`)

C'est un dossier de fichiers statiques. Le serveur web doit : (1) servir les fichiers ; (2) faire suivre `/v1/` (et `/health/`) vers l'API **sur le même domaine** (le cookie de session a pour chemin `/v1/auth`) ; (3) renvoyer `200.html` pour `/{langue}/account/*` ; (4) renvoyer `404.html` avec le statut 404 pour le reste ; (5) ajouter les en-têtes de sécurité ci-dessous. Exemple nginx :

```nginx
root /var/www/site/dist/client;
location /v1/ { proxy_pass http://127.0.0.1:3100; proxy_set_header X-Forwarded-For $remote_addr; }
location ~ ^/(fr|ht|en)/account(/|$) { try_files /200.html =404; }
location /assets/ { add_header Cache-Control "public, max-age=31536000, immutable"; }
location / { try_files $uri $uri/index.html =404; }
error_page 404 /404.html;
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header X-Content-Type-Options "nosniff" always;
```

Derrière ce proxy, l'API doit avoir `TRUST_PROXY=true` (voir SECURITY.md). Le serveur de `scripts/serve-dist.mjs` applique la même politique CSP : la recette navigateur échoue si une page viole la CSP (erreur console). **Production** : la configuration nginx essayée (HTTPS, CSP, HSTS, relais `/v1`, `200.html` pour l'espace client, vrai 404) est dans `docker/nginx/` et décrite dans [DEPLOYMENT.md](DEPLOYMENT.md) ; elle a été exécutée dans Docker (nginx 1.27) avec un certificat auto-signé, pas sur un serveur public. L'exemple ci-dessus reste valable pour un autre serveur web (Apache non essayé).

## Ajouter ou modifier un texte

1. Modifier `src/i18n/fr.ts`. 2. `npm run typecheck` signale les clés à ajouter dans `en.ts` et `ht.ts`. 3. Les tests `tests/i18n.test.ts` contrôlent : mêmes clés et mêmes variables `{…}` partout, aucune valeur vide, longueurs des balises `<title>`/description, absence de prix ou de numéro de téléphone inventés.
**Le créole a été rédigé sans relecture par un locuteur natif : à faire relire avant publication.** Les pages légales sont des **projets à valider par un juriste** (bandeau visible sur la page).

> **Mise à jour : le personnel n'est plus sur le site.** Les écrans du personnel (phases 6 à 9 : réception, colis, lots, agence, finance, livraison, réclamations, tableau de bord, audit, double authentification du personnel) ont été **déplacés dans le panel d'administration** (`apps/admin`, voir [ADMIN.md](ADMIN.md)). Les descriptions de ces écrans plus bas restent valables pour leur contenu, mais leurs adresses sont celles du panel (`/packages`, `/billing`…, sans préfixe de langue). Le site ne contient plus que les pages publiques et l'espace client ; un compte du personnel qui s'y connecte voit « Cet espace est réservé aux clients » avec un lien vers le panel (`VITE_ADMIN_URL`).

## Calculateur, suivi et colis (phase 5)

- **Calculateur** (`/calculator`) : lit `GET /rates` (trajets, services facultatifs, catégories) puis `POST /quote`. Sans grille publiée, la page l'explique et n'affiche **aucun formulaire ni prix**. Un client connecté enregistre ses estimations. Les deux poids (réel, volumétrique) et le poids facturable sont montrés ; le résultat est marqué « estimation indicative ».
- **Suivi** (`/tracking?n=…`) : le numéro est dans l'adresse (lien partageable) ; relancer la recherche relit le serveur ; numéro inconnu = message neutre. Aucune date de livraison n'est affichée (aucune donnée réelle).
- **Espace client** : « Mes préalertes » (déclaration, modification, annulation en deux temps, facture jointe), « Mes colis » (filtre, recherche, détail, historique, frais provisoires, pièces jointes). Les pièces s'ouvrent par un lien signé de courte durée.
- Les montants, poids et dates sont formatés par `src/lib/format.ts` (le créole se formate comme le français, faute de données de locale fiables). Les libellés des 17 statuts et des motifs de retenue sont dans les trois catalogues (un test vérifie qu'aucun statut n'en manque).
- Tout ce qui concerne le **personnel** (réception, pesée…) n'a pas d'écran : voir [ROADMAP.md](ROADMAP.md).

## Écrans du personnel (phase 6)

Dans l'espace connecté (`/<langue>/account/staff/…`), le menu n'affiche que ce que les permissions de la personne permettent (le serveur contrôle chaque droit et sa portée : le menu n'est qu'une commodité).
- **Réception** : champ de lecture focalisé en permanence, envoi par Entrée, historique de la session, résultat `Reçu` / `Déjà reçu` / `Non identifié`.
- **Colis** : liste (statut, recherche, « sans client ») et fiche : identification, pesée (validation partagée avec l'API), changement de statut (seules les transitions que l'API générique accepte ; motif exigé), rangement, agence de retrait, note interne, photos, historique complet.
- **Entrepôt** : inventaire par emplacement, création d'emplacements, file des anomalies.
- **Lots** : création, chargement par lecture, départ / arrivée / douane / clôture / annulation **en deux temps**, colis laissés de côté nommés, manifeste CSV et PDF téléchargés avec la session.
- **Agence** : réception par lecture, « prêt pour retrait ».
Les textes sont dans les trois langues (créole à relire). Pas d'impression d'étiquettes ni de scan par caméra.

## Écrans de la finance et des notifications (phase 7)

**Espace client** (`/<langue>/account/…`) :
- **Mes factures** (`invoices`) : liste des factures émises (jamais les brouillons) avec statut et reste à payer ; détail avec lignes, totaux, colis, avoirs, paiements, **facture en PDF** et **reçu en PDF**.
- **Payer** : les consignes de paiement de l'entreprise, puis la **déclaration** d'un virement ou d'un paiement mobile (montant et référence contrôlés avec le schéma partagé). Le paiement reste « en attente de validation » : la facture n'est pas « payée » avant la validation d'un agent. Le client peut retirer sa déclaration tant qu'elle est en attente. Le texte précise honnêtement que le paiement par carte en ligne n'est **pas** disponible.
- **Notifications** (`notifications`) : boîte de réception du portail, pastille du nombre de non lues dans le menu, « marquer comme lu » (une ou toutes).

**Espace du personnel** (menu selon les droits) :
- **Factures** : liste (statut, numéro, code client) ; nouveau brouillon (recherche du client, choix de ses colis pesés, lignes supplémentaires, remise si `discount:apply`, échéance) ; fiche : émission, suppression d'un brouillon (en deux temps), annulation avec motif, avoir, PDF, encaissement en espèces (clé d'idempotence générée par saisie), validation ou refus (motif) d'un paiement déclaré, remboursement.
- **Paiements** : file des paiements (par défaut « en attente »), **caisse** (ouverture avec fond, clôture avec montant compté, attendu et écart), **synthèse de la période** par mode et devise, **export CSV**, réglages de facturation (plafond de remise, consignes de paiement).
- **Notifications** : journal des envois (statut, tentatives, dernière erreur, prochaine tentative), relance d'un échec, traitement immédiat, **éditeur de modèles** par événement, canal et langue (variables autorisées affichées, retour au modèle par défaut).
Textes en trois langues (créole à relire). Le total de la facture et le solde sont affichés avec la devise de la facture ; les montants de caisse n'ont pas de symbole car la caisse n'enregistre pas de devise.

## Écrans de la livraison, des réclamations et du pilotage (phase 8)

**Espace client** : le **code de remise** sur la fiche d'un colis en agence ou en livraison (bouton « Obtenir mon code », montré une seule fois avec sa validité), un lien « Signaler un problème » qui préremplit le colis, « Mes réclamations » (liste, ouverture, échanges, réclamation clôturée sans formulaire).

**Personnel** (menu selon les droits) :
- **Remise au comptoir** (fiche du colis « prêt pour retrait ») : client ou bénéficiaire autorisé de la liste, pièce (type et 4 derniers caractères), code, photo de preuve choisie parmi les photos du colis, **solde dû affiché** et remise bloquée tant que la dérogation motivée n'est pas cochée (si le droit existe) ; historique des tentatives.
- **Tournées** : liste et création, règle des preuves à cocher (enregistrement immédiat), détail avec ajout / retrait d'arrêts, départ, clôture, annulation (en deux temps) ; par arrêt : adresse figée, instructions, solde, « Remettre » (même formulaire qu'au comptoir) et « Échec » (motif, précision, reprogrammation).
- **Mes tournées** (livreur) : ses tournées uniquement, sans actions de gestion.
- **Réclamations** : liste filtrée, détail avec notes internes signalées, affectation, réponse ou note, changement d'état (résolution obligatoire pour clôturer).
- **Tableau de bord** : période libre (30 jours par défaut), sections colis, expéditions et entrepôts, revenus et soldes par devise, incidents, délais moyens, agences et livreurs ; états vides explicites (« Aucune donnée », « Pas de mesure »).
- **Journal d'audit** : lecture seule, filtres, détails avant / après.
Textes en trois langues (créole à relire). Pas de carte ni d'itinéraire, pas d'application mobile pour le livreur (écran responsive seulement).

## Logo B2C

Le logo fourni (`IMG-20260326-WA0026.svg`, 294 Ko : une trame vectorisée automatiquement en 870 tracés, avec un fond gris clair et des filets parasites) a été **retracé proprement** : deux couleurs (bleu #03526F, gris #878787), fond transparent, contours lissés, filet clair entre le « 2 » et les lettres comblé. Résultat dans `apps/web/public/` :

| Fichier | Poids | Emploi |
|---|---|---|
| `logo.svg` | 7,9 Ko (3,7 Ko compressé) | logo complet avec « Business to Customer » : pied de page, aperçu des réseaux sociaux |
| `logo-mark.svg` | 5,0 Ko | mot-symbole B2C seul : en-tête (48 px de haut) |
| `favicon.svg`, `favicon-48.png` | 5,1 Ko, 1,7 Ko | onglet du navigateur (mot-symbole sur plaque blanche) |
| `apple-touch-icon.png` | 4,9 Ko | écran d'accueil iOS (180 px) |
| `og-image.png` | 42 Ko | aperçu des liens partagés (1200 × 630), balises `og:image` et `twitter:card` ajoutées au pré-rendu |
| `apps/api/src/branding/logo-png.ts` | 26 Ko (PNG en base64) | logo des PDF : factures, reçus, manifestes (en haut à droite) |

**Où il apparaît** : en-tête de toutes les pages (publiques, connexion, espace client et du personnel), pied de page (sur une plaque blanche, car le pied de page est bleu foncé), onglet, aperçu des liens partagés, PDF. **Pas** dans les e-mails (texte brut) ni dans les modèles de notification. Les images sont décoratives (`alt` vide) : le nom de la marque reste porté par un texte réservé aux lecteurs d'écran, et des tests le vérifient (pré-rendu, PDF).

**Limites** : le fichier source est une trame vectorisée à partir d'une image : le retracé est fidèle à l'œil mais les bords gardent de légères irrégularités héritées de l'original ; **si l'entreprise possède le fichier vectoriel d'origine (Illustrator, Figma, SVG propre), il vaut mieux l'utiliser**. Le PDF n'a pas été contrôlé à l'œil (vérifié seulement : l'image est présente dans le document, aucun test automatique de mise en page). Le **nom de marque** affiché est désormais « B2C » (valeur par défaut de `VITE_BRAND_NAME` et `APP_NAME`), comme le logo ; il reste modifiable par configuration.

## Double authentification (phase 9)

- **Connexion** : si le serveur répond `TOTP_REQUIRED`, le formulaire affiche un champ « Code de l'application » (6 chiffres, vérifié côté navigateur avant l'envoi) ; un bouton bascule vers le **code de secours** (`xxxx-xxxx`) ; le mot de passe n'est pas ressaisi.
- **Page Sécurité** (`/account/security`) : activation en deux temps (mot de passe → clé à saisir dans l'application d'authentification, **sans code QR** : saisie manuelle de la clé ou de l'adresse `otpauth://` → code de vérification) ; les **10 codes de secours** sont montrés **une seule fois** avec la case « J'ai noté mes codes » ; régénération et désactivation exigent le mot de passe et un code.
- **Compte du personnel quand la double authentification est obligatoire** : tant qu'elle n'est pas active, tout l'espace redirige vers la page Sécurité (bandeau explicatif) ; la désactivation y est masquée.
- Textes en trois langues (créole à relire). Testé par `tests/phase9.test.tsx` (8 tests d'interface) ; **non couvert par la recette navigateur** (pas de générateur de code TOTP dans le banc e2e) et jamais essayé avec une vraie application d'authentification ni sur téléphone. Pas de code QR : l'activation sur le téléphone même exige de recopier la clé.

## Limites connues

- **Poids du JavaScript** : environ 277 Ko compressés pour le fichier principal (les écrans connectés, dont 51 Ko compressés, sont chargés à la demande) (React, React Router, zod, TanStack Query, les trois catalogues de textes). Le contenu s'affiche avant (pré-rendu) mais l'interactivité attend ce fichier. Pistes : charger seulement la langue courante, remplacer TanStack Query par un petit utilitaire, alléger zod côté navigateur.
- Pas de mode sombre. Pas de PWA ni de mode hors ligne.
- Une seule marque et une seule entreprise par construction.
- Les routes d'authentification non pré-référencées (`/forgot-password`, etc.) sont pré-rendues en `noindex`.
