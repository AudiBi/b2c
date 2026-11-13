# Référencement naturel (SEO) du site

Rapport de l'audit et des optimisations du site public (`apps/web`), réalisés le 11 novembre 2026. **Rien ici ne dit que le site est référencé** : aucun compte Google Search Console, Bing Webmaster Tools ou Analytics n'a été utilisé, aucun site n'a été soumis, et aucune position dans les résultats de recherche n'a été mesurée. Ce qui est annoncé a été **vérifié sur le site construit** (contrôleur `npm run seo:check`, tests automatisés, Lighthouse en local, nginx sous Docker).

## 1. Architecture et rendu

| Sujet | État |
|---|---|
| Framework | React 19, React Router 7, Vite 7 (aucune migration) ; API NestJS séparée |
| Rendu | **Pré-rendu statique** (SSG) : un fichier HTML complet par page et par langue (63 pages), produit par `scripts/prerender.mjs`, servi par nginx. Un moteur de recherche lit le contenu **sans exécuter JavaScript** |
| Pages publiques référencées | 16 pages × 3 langues (fr, ht, en) = 48 |
| Pages non référencées | connexion (`noindex, follow`), 4 pages à jeton (`noindex, nofollow`), espace client (coquille `noindex`), 404, page de choix de langue de la racine |
| Bibliothèques SEO | aucune installée ; le module maison `src/seo-head.ts` produit toutes les balises du `<head>` et les données structurées |
| Données dynamiques | coordonnées, entrepôts, agences et tarifs viennent de l'API **dans le navigateur** : ils ne sont pas dans le HTML pré-rendu (voir § 6) |

## 2. Audit initial (mesuré avant toute modification)

Lighthouse 12, mobile (simulation « 4G lente »), site construit servi en local, 4 pages :

| Page | Performance | Accessibilité | Bonnes pratiques | SEO | LCP | TBT | CLS |
|---|---|---|---|---|---|---|---|
| `/fr/` | 54 | 100 | 93 | 100 | 5,9 s | 410 ms | 0 |
| `/fr/services/air` | 58 | 100 | 96 | 100 | 5,8 s | 320 ms | 0 |
| `/fr/faq` | 59 | 100 | 96 | 100 | 5,8 s | 270 ms | 0 |
| `/en/calculator` | 52 | 100 | 93 | 100 | 5,7 s | 500 ms | 0,033 |

Contenu pré-rendu (français) : 21 pages, 129 à 644 mots par page, un seul `h1` partout, aucune page orpheline, aucun lien interne cassé.

### Problèmes identifiés

| # | Problème | Gravité | Corrigé |
|---|---|---|---|
| 1 | Un seul fichier JavaScript de 954 Ko (277 Ko compressé) contenant les trois langues et la validation de formulaires pour toutes les pages ; LCP de 5,8 s | Élevée | Oui |
| 2 | Aucune donnée structurée JSON-LD | Élevée | Oui |
| 3 | `/fr/page` et `/fr/page/` répondaient tous deux 200 (contenu dupliqué, atténué par la canonical) | Moyenne | Oui (301) |
| 4 | Espace client protégé seulement par une balise meta ; `robots.txt` n'excluait pas `/v1/` | Moyenne | Oui |
| 5 | Titres peu orientés recherche (« À propos \| B2C »), descriptions de 30 à 66 caractères sur plusieurs pages, ni `og:site_name`, ni `twitter:title/description`, ni `robots` explicite | Moyenne | Oui |
| 6 | Coordonnées, entrepôts et agences invisibles pour les moteurs (chargés après coup par l'API) | Moyenne | Partiel (§ 6) |
| 7 | Pas de fil d'Ariane ; connexion indexée sans valeur ; racine sans description ni canonical | Faible | Oui |
| 8 | Peu de liens internes entre les pages de contenu (suivi, calculateur, entrepôts, contact, FAQ) | Faible | Oui |
| 9 | Pages juridiques (CGU, confidentialité) contenant des champs à renseigner (« [à renseigner] ») | Moyenne | **Non** : contenu à fournir (RISKS.md A5) |
| 10 | Aucun contenu éditorial profond (guides, glossaire, actualités) | Moyenne | **Non** : demande des informations réelles de l'entreprise (§ 7) |

## 3. Optimisations réellement implémentées

### Performance (Core Web Vitals)
- **Une langue par chargement** : les textes de chaque langue sont des modules séparés, téléchargés à la demande ; le module de la langue de la page est préchargé (`modulepreload`) pour éviter une cascade de requêtes. Le rendu serveur et les tests chargent les trois (`src/i18n/all.ts`).
- **Formulaires à la demande** : les pages à validation de formulaire (connexion, inscription, mot de passe, calculateur), qui embarquent la bibliothèque `zod`, sont chargées à la demande (`src/lazy-page.tsx`), préchargées avant l'hydratation pour que le HTML pré-rendu et l'application restent identiques.
- **Compression pré-calculée** : le pré-rendu produit les versions `.gz` et `.br` de chaque fichier ; nginx envoie le `.gz` tel quel (`gzip_static`), le serveur de prévisualisation envoie `.br` ou `.gz`.
- **Cache** : `/assets/` en `immutable` un an (un bug de priorité des règles nginx l'avait rabattu à une semaine, détecté par le test sous Docker et corrigé avec `^~`) ; images et icônes une semaine ; HTML `no-cache`.
- **Images** : le site n'emploie que le logo SVG, une illustration SVG intégrée au HTML et l'image de partage PNG de 42 Ko (obligatoirement PNG/JPEG pour les réseaux sociaux). **WebP/AVIF et le chargement différé d'images n'ont donc rien à optimiser** ; toutes les images ont `alt` et dimensions (vérifié). Aucune police externe (polices système) : rien à précharger.

### Métadonnées
- Titres (≤ 66 caractères avec la marque) et descriptions (95 à 165 caractères) **réécrits en français, créole et anglais**, uniques par page et par langue, orientés « envoyer un colis en Haïti » sans répétition artificielle.
- Balises par page : `title`, `description`, `robots` (`index, follow, max-image-preview:large…`), canonical, `hreflang` (fr, ht, en, `x-default`), Open Graph complet (`og:site_name`, `og:locale` et `og:locale:alternate`, image 1200×630 avec texte alternatif), cartes Twitter/X (`title`, `description`, `image`), `<html lang>`, favicon SVG + PNG, icône Apple.
- Pages non référencées : `noindex` sans canonical ni Open Graph ; la connexion `noindex, follow`, les pages à jeton `noindex, nofollow`.

### Données structurées (JSON-LD, uniquement du contenu réel)
`Organization` (logo, zone desservie : Haïti), `WebSite`, `WebPage` (`AboutPage` et `ContactPage` quand il convient), `BreadcrumbList` (fil d'Ariane **visible** identique), `Service` sur les 4 pages de service, `ItemList` des services sur la page « Nos services ». Coordonnées (`email`, `telephone`, `sameAs`, `ContactPoint`) et `LocalBusiness` (adresse) **uniquement si fournies** (§ 8) : rien n'est inventé.
**`FAQPage` volontairement absent** : Google ne l'affiche plus que pour des sites officiels de santé ou d'administration. Aucun `Product`, `Article`, `BlogPosting` : le site n'en contient pas.

### Indexation et sécurité
- nginx : 301 sans barre finale, `X-Robots-Tag` (`noindex, nofollow` sur l'espace client, les pages à jeton et la 404 ; `noindex, follow` sur la connexion), redirections relatives (`absolute_redirect off`), compression.
- `robots.txt` : exclut `/fr|ht|en/account` et `/v1/`, autorise `/assets/` (aucune ressource de rendu bloquée), déclare le sitemap. **`robots.txt` n'est pas une protection** : l'accès à l'espace client dépend de la connexion ; les pages privées ne contiennent aucune donnée avant authentification.
- `sitemap.xml` : 48 adresses (pages référencées uniquement) avec leurs variantes de langue ; aucune page `noindex` ; pas de `lastmod` (une date de construction serait trompeuse).
- Racine `/` : page de choix de langue `noindex, follow` ; `x-default` pointe vers le français.

### Contenu et liens internes
- Fil d'Ariane visible sur toutes les pages intérieures (une seule source pour l'affichage et le JSON-LD).
- Bloc « Pour aller plus loin » (3 liens avec description) sur 7 pages : à propos, comment ça marche, FAQ, suivi, calculateur, entrepôts, contact.

### Outils pour webmasters
Emplacements de configuration (variables de construction, `.env.production.example`, Dockerfile) : `SEO_GOOGLE_SITE_VERIFICATION`, `SEO_BING_SITE_VERIFICATION`, `SEO_ORGANIZATION_JSON`, `SEO_API_URL`. **Google Analytics 4 n'est pas intégré** (§ 8).

## 4. Fichiers créés et modifiés

Créés : `apps/web/src/seo-head.ts`, `breadcrumbs.ts`, `components/Breadcrumbs.tsx`, `components/RelatedPages.tsx`, `lazy-page.tsx`, `lazy-pages.ts`, `page-preload.ts`, `i18n/all.ts`, `apps/web/scripts/seo-check.mjs`, `apps/web/tests/seo.test.ts`, `docs/SEO.md`.
Modifiés : `scripts/prerender.mjs` (réécrit : en-têtes, sitemap, robots, compression), `scripts/serve-dist.mjs`, `src/i18n/{index.tsx,fr,ht,en}`, `src/{App,main,entry-server,routes}.ts(x)`, `components/layout/LangLayout.tsx`, `components/ui/Sections.tsx`, pages (Info, Tracking, Calculator, Locations, Contact), `styles/components.css`, `vite.config.ts`, `public/language.js`, tests (`prerender.test.tsx`, `setup.ts`, `e2e/public-pages.spec.ts`), `docker/nginx/default.conf.template`, `docker/Dockerfile`, `docker/compose.prod.yml`, `.env.example`, `.env.production.example`, `package.json` (racine et site : script `seo:check`).

## 5. Résultats des tests et mesures

### Tests exécutés après les modifications

| Vérification | Résultat |
|---|---|
| Tests du site (`vitest`) | **273 réussis** sur 12 fichiers (163 avant ; +110, dont `tests/seo.test.ts`) |
| Typecheck API, site et panel | aucune erreur |
| Contrôleur `npm run seo:check` (site construit, sans JavaScript) | **0 anomalie** : 64 pages lues, 48 référencées, 48 adresses de sitemap. Contrôlé : titre, description, `h1`, `lang`, canonical, `og:*`, Twitter, hreflang réciproques, JSON-LD valide et cohérent, fil d'Ariane, liens internes, pages orphelines, images (`alt`, dimensions), sitemap ↔ canonical ↔ `noindex`, `robots.txt`, 404 et espace client en `noindex`, fichiers pré-compressés. Vérifié capable d'échouer : une canonical et une règle `robots.txt` retirées volontairement ont produit 5 anomalies |
| Tests navigateur (Edge) | **94 réussis sur 95 au premier passage** ; l'échec, `logistics.spec.ts` (panel du personnel : il ouvre « le premier lot de la liste » avant que la liste soit rafraîchie sur une base de recette qui garde les lots des exécutions précédentes), est **sans rapport avec le SEO** ; relancé seul, il passe (5 sur 5). À corriger dans ce test |
| Tests navigateur ajoutés | 301 sans barre finale ; JSON-LD valide sans JavaScript ; `robots` et `X-Robots-Tag` de l'espace client, de la connexion et des pages à jeton ; sitemap sans connexion ; 404 `noindex` ; métadonnées dans la bonne langue ; page servie compressée et **une seule langue téléchargée** ; accessibilité WCAG 2.1 AA et mobile sur les 17 pages × 3 langues (inchangées, toujours vertes) |
| nginx (conteneur Docker `nginx:1.27-alpine`, configuration du dépôt adaptée sans TLS) | 301 de `/fr/services/` vers `/fr/services` (relatif) ; `Content-Encoding: gzip` servi depuis les `.gz` ; `X-Robots-Tag` correct sur `/fr/account/*`, pages à jeton, connexion et 404 (statut 404) ; `/assets/` en `immutable` ; images en une semaine. Un défaut a été trouvé et corrigé par ce test (priorité de règles) |
| API | non concernée par ces changements |

### Scores Lighthouse mesurés (v12, mobile, simulation 4G lente, site construit servi en local, sans API)

| Page | Perf. avant → après | Accessibilité | Bonnes pratiques | SEO | LCP avant → après | TBT avant → après | CLS |
|---|---|---|---|---|---|---|---|
| `/fr/` | 54 → **93** | 100 | 93 → **100** | 100 | 5,9 s → **2,3 s** | 410 → 180 ms | 0 |
| `/fr/services/air` | 58 → **95** | 100 | 96 → **100** | 100 | 5,8 s → **2,2 s** | 320 → 160 ms | 0 |
| `/fr/faq` | 59 → **94** | 100 | 96 → **100** | 100 | 5,8 s → **2,2 s** | 270 → 160 ms | 0 |
| `/en/calculator` | 52 → **88** | 100 | 93 | 100 | 5,7 s → **2,5 s** | 500 → 280 ms | 0,033 → 0,03 |
| `/fr/register` (non mesuré avant) | **92** | 100 | 96 | 100 | 2,5 s | 160 ms | 0 |
| `/ht/locations` (non mesuré avant) | **95** | 100 | 96 | 100 | 2,2 s | 140 ms | 0,009 |

Poids transféré par page : 978–985 Ko → **181–217 Ko**. Limites de ces mesures : **simulation** de Lighthouse sur un poste de développement (pas un serveur ni un réseau réels) ; le serveur de prévisualisation remplace nginx ; **l'API est absente**, ce qui provoque des erreurs réseau dans la console (Bonnes pratiques 93 à 96 sur le calculateur, l'inscription et les entrepôts) et un léger décalage de mise en page (CLS ≤ 0,03, seuil « bon » : 0,1) quand le message d'erreur remplace le chargement. INP n'est pas mesurable en laboratoire. Ces scores ne remplacent pas PageSpeed Insights sur le site déployé.


## 6. Problèmes restants

1. **Données de l'API absentes du HTML** : coordonnées, entrepôts et agences ne sont lus par les moteurs que s'ils exécutent JavaScript. Remède partiel livré : `SEO_API_URL` / `SEO_ORGANIZATION_JSON` alimentent le JSON-LD au pré-rendu ; le texte des pages « Contact » et « Entrepôts et agences » reste chargé dans le navigateur. Les rendre indexables demande de pré-rendre ces données à la construction (et de reconstruire à chaque changement) : décision à prendre.
2. **Pages juridiques à finir** (RISKS.md A5) : champs à renseigner et bandeau « projet de texte ».
3. **Contenu court sur certaines pages** (Entrepôts, Contact, Suivi : 180 à 240 mots) et **aucun contenu éditorial profond** : voir § 7.
4. **Créole non relu par un locuteur natif** (RISKS.md C8) : y compris les nouveaux titres et descriptions.
5. **TBT mobile encore autour de 170 à 260 ms** en simulation (hydratation de React) : les Core Web Vitals réels (INP) ne sont mesurables qu'avec de vrais visiteurs (Search Console, rapport d'expérience utilisateur Chrome).
6. **Brotli non servi par nginx** : les fichiers `.br` sont produits, mais l'image `nginx:alpine` n'a pas le module ; gzip est servi. Ajouter un module Brotli ou un CDN (gain d'environ 15 % sur le JavaScript).
7. **Chaîne CSS bloquante** (150 ms estimés par Lighthouse) : l'inclure en ligne demanderait de revoir la politique de sécurité (CSP) ; non fait.
8. **Redirection `www`** et noms de domaine alternatifs : à régler selon le domaine choisi (nginx n'écoute que `SERVER_NAME`).
9. **Tests sur serveur réel absents** : tout a été mesuré en local (RISKS.md A1) ; les performances réelles dépendent de l'hébergement, du CDN et du réseau en Haïti.

## 7. Intention de recherche et mots-clés par page

Référence en français (équivalents en créole et en anglais dans les métadonnées). Les mots-clés secondaires sont des expressions que le contenu emploie déjà ; aucune page ne répète artificiellement le mot-clé.

| Page | Intention | Mot-clé principal | Mots-clés secondaires |
|---|---|---|---|
| Accueil | commerciale / découverte | expédition de colis vers Haïti | envoyer un colis en Haïti, adresse de réception, avion ou bateau, retrait en agence |
| À propos | confiance | service d'expédition vers Haïti | mission, suivi à chaque étape |
| Nos services | comparaison | services d'expédition et de livraison vers Haïti | expédition aérienne, maritime, transport international |
| Expédition aérienne | informationnelle / transactionnelle | expédition aérienne vers Haïti | colis urgents, poids facturable, frais détaillés |
| Expédition maritime | informationnelle | expédition maritime vers Haïti | colis volumineux, délais indicatifs, bateau |
| Transport international | informationnelle | transport international de colis vers Haïti | lots, manifeste, événements de transport |
| Retrait en agence | informationnelle | retrait de colis en agence en Haïti | bénéficiaires autorisés, pièce d’identité, remise sécurisée |
| Calculateur | outil | calculateur de frais d'expédition vers Haïti | poids volumétrique, poids facturable, estimation |
| Suivi | navigationnelle | suivi de colis vers Haïti | numéro de suivi, statut, historique |
| Entrepôts et agences | locale | entrepôts à l'étranger et agences de retrait en Haïti | adresses, villes |
| Comment ça marche | informationnelle | comment envoyer un colis en Haïti | préalerte, pesée, paiement, retrait |
| FAQ | informationnelle | questions fréquentes sur l'envoi de colis vers Haïti | préalertes, tarifs, réclamations |
| Contact | navigationnelle | contact et assistance clients | téléphone, e-mail, horaires |
| Créer un compte | transactionnelle | créer un compte, adresses de réception | code client, gratuit |
| CGU, confidentialité | juridique | aucun (pas de ciblage) | — |

**Pages de contenu recommandées** (non créées : elles exigent des informations réelles et vérifiées de l'entreprise, que je ne peux pas inventer) : marchandises interdites ou réglementées (la liste de l'entreprise), droits de douane et taxes en Haïti (source officielle), délais réels par mode, tarifs publiés, guide « acheter chez un marchand américain et se faire livrer en Haïti », « poids volumétrique expliqué avec exemples », présentation de chaque entrepôt et agence réels (page par lieu **uniquement** si le contenu est unique : horaires, accès, photos). Ne pas créer de pages par ville sans contenu propre.

## 8. Configurations externes à effectuer par vous

| Action | Comment |
|---|---|
| **Domaine, HTTPS et `SITE_URL`** | Renseigner `PUBLIC_HOST` ; la construction doit recevoir l'URL publique définitive (canonical, hreflang, sitemap, Open Graph en dépendent) |
| **Google Search Console** | Ajouter la propriété du domaine, copier le code de la balise « HTML tag » dans `SEO_GOOGLE_SITE_VERIFICATION`, reconstruire, vérifier ; puis soumettre `https://<domaine>/sitemap.xml` et contrôler « Pages » (indexation), « Expérience » (Core Web Vitals réels) et « Améliorations » (fil d'Ariane, etc.) |
| **Bing Webmaster Tools** | Même principe avec `SEO_BING_SITE_VERIFICATION` (ou importer la propriété depuis Search Console) |
| **Coordonnées publiques** | Renseigner `SEO_ORGANIZATION_JSON` (e-mail, téléphone, profils sociaux `sameAs`, adresse structurée pour `LocalBusiness`) avec des informations **réelles et visibles sur le site** ; ou `SEO_API_URL` si l'API est joignable à la construction |
| **Marque et textes** | `VITE_BRAND_NAME` ; remplacer les champs « à renseigner » des CGU et de la politique de confidentialité |
| **Google Analytics 4** | **Non intégré, volontairement** : il impose de modifier la politique de sécurité (CSP `script-src` / `connect-src` pour Google), un consentement aux cookies et une mise à jour de la politique de confidentialité. À décider avant de l'ajouter ; une alternative sans cookie (mesure côté serveur) est possible |
| **Validation externe** | Passer les pages de `https://<domaine>` dans le Test des résultats enrichis (Google), le Schema Markup Validator, PageSpeed Insights et Lighthouse sur le serveur de production : seuls ces outils donnent les scores réels |
| **Brotli / CDN** | Facultatif : module Brotli pour nginx ou CDN devant le site |

## 9. Stratégie sur 90 jours

**Jours 1 à 15 — fondations** : déployer sur le domaine réel (RISKS.md A1) ; renseigner `SITE_URL`, la marque, les coordonnées ; déclarer le site à Search Console et Bing ; soumettre le sitemap ; relire le créole ; finir les CGU et la confidentialité ; saisir de vrais tarifs et entrepôts/agences (le calculateur et la page Entrepôts deviennent utiles).
**Jours 16 à 45 — contenu** : publier 4 à 6 guides à partir d'informations réelles (marchandises interdites, douane, délais, acheter aux États-Unis, poids volumétrique) en trois langues, chacun avec fil d'Ariane et liens vers calculateur et inscription ; enrichir les pages Entrepôts et Contact ; décider du pré-rendu des données de l'API (§ 6.1).
**Jours 46 à 75 — mesure et corrections** : lire Search Console (pages indexées, requêtes, CTR, Core Web Vitals réels) ; réécrire les titres dont le CTR est faible ; corriger les pages « explorée, non indexée » ; mesurer PageSpeed Insights en production et traiter l'hydratation (TBT/INP) si nécessaire.
**Jours 76 à 90 — autorité et pérennité** : obtenir des liens **réels** (annuaires professionnels, partenaires, diaspora, presse locale, fiche Google Business Profile **si** l'entreprise a un lieu d'accueil public) ; avis clients authentiques ; mettre `seo:check` dans l'intégration continue (RISKS.md C5) ; revoir ce document.

Indicateurs à suivre : pages indexées / 48, impressions et clics par langue, positions sur « envoyer un colis en Haïti » et équivalents créole/anglais, LCP/INP/CLS réels, nombre de comptes créés depuis la recherche.

## 10. Score de conformité SEO technique

Critères **vérifiables localement** ; un critère n'est « conforme » que s'il est contrôlé automatiquement (`seo:check`, tests, e2e, Lighthouse, nginx sous Docker). Ce score ne mesure **ni l'indexation, ni le classement**.

| # | Critère | Vérifié par | Conforme |
|---|---|---|---|
| 1 | Chaque page référencée a un `<title>` unique, ≤ 70 caractères | `seo:check`, tests | ✔ |
| 2 | Chaque page référencée a une description unique de 90 à 165 caractères | `seo:check`, tests | ✔ |
| 3 | Un seul `h1` par page | `seo:check`, tests, e2e | ✔ |
| 4 | Hiérarchie de titres sans saut de niveau | axe (e2e) | ✔ |
| 5 | Canonical auto-référente sur chaque page référencée | `seo:check` | ✔ |
| 6 | `hreflang` complets et réciproques (fr, ht, en, x-default) | `seo:check` | ✔ |
| 7 | `<html lang>` correct partout | `seo:check`, e2e | ✔ |
| 8 | Aucune langue mélangée dans les métadonnées | tests, e2e | ✔ |
| 9 | Open Graph et cartes Twitter complets | `seo:check` | ✔ |
| 10 | Données structurées JSON-LD valides, cohérentes avec la page | `seo:check`, tests | ✔ |
| 11 | Fil d'Ariane visible = fil d'Ariane des données structurées | tests | ✔ |
| 12 | Aucune donnée structurée inventée (coordonnées seulement si fournies) | tests | ✔ |
| 13 | `sitemap.xml` : toutes les pages référencées, aucune `noindex`, canonical identique | `seo:check`, e2e | ✔ |
| 14 | `robots.txt` : sitemap déclaré, espace client et API exclus, ressources de rendu autorisées | `seo:check`, e2e | ✔ |
| 15 | Pages privées et d'authentification non indexables (balise **et** en-tête) | e2e, nginx sous Docker | ✔ |
| 16 | 404 réelle (statut 404) et non référencée | e2e, nginx sous Docker | ✔ |
| 17 | Une seule adresse par page (301 sans barre finale) | e2e, nginx sous Docker | ✔ |
| 18 | Contenu lisible sans JavaScript (HTML pré-rendu) | e2e, `seo:check` | ✔ |
| 19 | Aucun lien interne cassé, aucune page orpheline | `seo:check` | ✔ |
| 20 | Images : `alt` et dimensions | `seo:check`, tests | ✔ |
| 21 | Pages publiques accessibles (WCAG 2.1 AA, clavier) et adaptées au téléphone | e2e (axe), Lighthouse 100 | ✔ |
| 22 | Compression HTTP des pages et des scripts | e2e, nginx sous Docker | ✔ |
| 23 | Cache long des ressources versionnées | nginx sous Docker | ✔ |
| 24 | JavaScript initial raisonnable (une seule langue chargée) | e2e, mesure (954 → 500 Ko) | ✔ |
| 25 | Lighthouse SEO = 100 ; Accessibilité = 100 | Lighthouse | ✔ |
| 26 | Lighthouse Performance ≥ 90 sur les pages de contenu | Lighthouse (simulation) | ½ (5 pages sur 6 ; calculateur : 88) |
| 27 | LCP ≤ 2,5 s, CLS ≤ 0,1 (laboratoire) | Lighthouse (simulation) | ✔ |
| 28 | TBT ≤ 200 ms (laboratoire) | Lighthouse (simulation) | ½ (5 pages sur 6 ; calculateur : 280 ms) |
| 29 | Emplacements de vérification Search Console / Bing | tests | ✔ |
| 30 | Brotli servi en production | nginx | ✘ (fichiers produits, module absent) |
| 31 | Données de l'API (coordonnées, entrepôts) lisibles sans JavaScript | `seo:check` | ✘ |
| 32 | Pages juridiques finalisées (sans champs « à renseigner ») | relecture | ✘ |
| 33 | Mesures sur le site déployé (PageSpeed, Core Web Vitals réels) | — | **non mesurable ici** |
| 34 | Propriété déclarée à Search Console et Bing, sitemap soumis | — | **non fait, hors de ma portée** |

**Score : 28 sur 32 critères contrôlables (88 %)** : 27 conformes, 2 à moitié (26 et 28, à cause du calculateur, dont la mesure est aussi faussée par l'absence d'API), 3 non conformes (30, 31, 32) ; les critères 33 et 34, non évaluables ici, sont exclus du calcul. Un score de 88 % ne signifie pas un bon classement : le classement dépend du contenu, de l'autorité (liens) et du temps.

## 11. Maintenir le SEO

- Après tout changement de page ou de texte : `npm run build:web && npm run seo:check` (échoue au moindre problème : titre ou description en double, canonical fausse, hreflang non réciproque, JSON-LD invalide, lien cassé, page orpheline, sitemap incohérent, image sans `alt`).
- Un titre ou une description se modifie dans `apps/web/src/i18n/{fr,ht,en}.ts` (bloc `seo`) ; les tests (`tests/seo.test.ts`) imposent unicité et longueurs.
- Une nouvelle page publique : l'ajouter à `routes.ts`, à `App.tsx`, aux textes `seo` et `nav` des trois langues ; elle entre seule dans le pré-rendu, le sitemap et le contrôleur.
