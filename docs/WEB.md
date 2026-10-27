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
| `VITE_BRAND_NAME` | Nom de marque affiché (provisoire : « TransitHaïti ») |
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

Derrière ce proxy, l'API doit avoir `TRUST_PROXY=true` (voir SECURITY.md). Le serveur de `scripts/serve-dist.mjs` applique la même politique CSP : la recette navigateur échoue si une page viole la CSP (erreur console). Les procédures de déploiement complètes (HTTPS, sauvegardes, supervision) relèvent de la phase 10 ; ce qui précède n'a pas été testé sur un vrai serveur nginx ou Apache.

## Ajouter ou modifier un texte

1. Modifier `src/i18n/fr.ts`. 2. `npm run typecheck` signale les clés à ajouter dans `en.ts` et `ht.ts`. 3. Les tests `tests/i18n.test.ts` contrôlent : mêmes clés et mêmes variables `{…}` partout, aucune valeur vide, longueurs des balises `<title>`/description, absence de prix ou de numéro de téléphone inventés.
**Le créole a été rédigé sans relecture par un locuteur natif : à faire relire avant publication.** Les pages légales sont des **projets à valider par un juriste** (bandeau visible sur la page).

## Fonctions volontairement non activées

Le suivi public et le calculateur ne sont pas branchés : leur API n'existe pas (phase 5). Les pages expliquent le principe et affichent « pas encore activé » **sans formulaire** (aucun bouton qui ne ferait rien, aucun prix inventé). L'activation passe par `config.features` dans `src/config.ts`. La liste des agences est vide tant que le module agences (phase 6) n'existe pas.

## Limites connues

- **Poids du JavaScript** : environ 235 Ko compressés pour le fichier principal (React, React Router, zod, TanStack Query, les trois catalogues de textes). Le contenu s'affiche avant (pré-rendu) mais l'interactivité attend ce fichier. Pistes : charger seulement la langue courante, remplacer TanStack Query par un petit utilitaire, alléger zod côté navigateur.
- Pas de mode sombre. Pas de PWA ni de mode hors ligne.
- Une seule marque et une seule entreprise par construction.
- Les routes d'authentification non pré-référencées (`/forgot-password`, etc.) sont pré-rendues en `noindex`.
