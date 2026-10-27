# Sécurité

Phase 3. Décrit ce qui est **en place et testé**, puis ce qui **manque**. Une revue de sécurité complète est prévue en phase 9 ; ce document ne vaut pas audit.

## Mesures en place

| Domaine | Mesure | Où / test |
|---|---|---|
| Isolation des entreprises | `company_id` NOT NULL partout ; Row-Level Security activée **et forcée** sur 27 tables (celles qui portent `company_id`, plus `companies`) ; le rôle de l'API n'est ni superutilisateur, ni `BYPASSRLS`, ni propriétaire ; sans contexte, aucune ligne n'est visible ; contexte posé par `SET LOCAL` dans la transaction (pas de fuite entre requêtes sur le pool) ; clés étrangères composites (une session ne peut pas relier un utilisateur à une autre entreprise) | migration 0001, `DbService`, `rls.spec.ts` |
| Mode plateforme | Un seul drapeau (`app.platform`) ouvre la table `companies` ; il ne donne accès à aucune donnée métier ; seuls 2 fichiers peuvent l'utiliser (un test le vérifie en lisant le code source) | `iam.spec.ts` |
| Mots de passe | argon2id (mémoire 64 Mio par défaut, 3 itérations) ; longueur 10-128 ; liste de mots de passe courants (courte) ; refus si contenant l'adresse e-mail ; vérification factice pour les comptes inconnus (temps de réponse comparable) | `PasswordService`, `auth.spec.ts` |
| Sessions | jeton d'accès JWT HS256 15 min (algorithme, émetteur, audience imposés) ; droits relus en base à chaque requête ; jeton de renouvellement opaque (256 bits, seul le condensé SHA-256 est stocké) à rotation ; réutilisation = révocation de la famille ; cookie HttpOnly + SameSite=Lax + chemin restreint + en-tête anti-CSRF | `auth.spec.ts` |
| Jetons e-mail | 256 bits, condensés en base, usage unique atomique, durées 24 h / 1 h / 72 h, un nouveau jeton invalide les précédents | `auth.spec.ts` |
| Énumération de comptes | Inscription, renvoi de confirmation et mot de passe oublié répondent identiquement que le compte existe ou non ; connexion : même message pour mot de passe faux, compte inconnu et entreprise inconnue | `auth.spec.ts` |
| Force brute | 5 échecs → compte (même inexistant) verrouillé 15 min, quelle que soit l'IP ; limites par IP sur chaque route d'authentification ; envois d'e-mails limités par adresse | `rate-limit.spec.ts` |
| Autorisation | refus par défaut (une route sans règle est refusée) ; permissions vérifiées côté serveur avant la validation ; anti-escalade de privilèges ; protection du dernier administrateur avec verrou ; révocation immédiate (désactivation, suspension) | `iam.spec.ts` |
| Validation | schémas zod stricts partagés ; champs inconnus refusés (pas de mass assignment) ; requêtes SQL uniquement paramétrées (Prisma, gabarits `$queryRaw`) | `auth.spec.ts`, `iam.spec.ts` |
| Journal d'audit | écrit dans la transaction de l'action ; ajout seul (droits + déclencheur, même pour le propriétaire) ; IP, identifiant de requête, acteur ; clés sensibles masquées | `rls.spec.ts`, `app.spec.ts` |
| Erreurs | format unique ; aucune trace ni message interne dans les 500 | `app.spec.ts` |
| En-têtes et CORS | Helmet (HSTS, nosniff, CSP…), origines CORS en liste blanche, `X-Powered-By` retiré | `app.spec.ts` |
| Secrets | aucun dans le dépôt ; `.env` ignoré ; générés localement ; la configuration de production refuse les valeurs de substitution, les cookies non sécurisés et un coût argon2 trop faible | `app.spec.ts` |
| Site web | Jeton d'accès en mémoire (jamais dans localStorage ; un test le vérifie) ; cookie de renouvellement HttpOnly ; redirection après connexion limitée aux pages de l'espace client du même site ; CSP de référence sans script ni style en ligne (la recette navigateur échoue sur toute violation) ; liens externes en `rel=noopener` ; aucune donnée personnelle dans l'URL hormis les jetons à usage unique des e-mails | `e2e/` |
| Espace client | Chaque route ne manipule que les données de l'utilisateur du jeton ; l'identifiant d'un autre client donne 404 ; bénéficiaires : seuls 4 caractères de la pièce conservés ; entrepôts : le modèle d'adresse des clients n'est jamais public ; coordonnées publiques : URL `https` uniquement | `customers.spec.ts` |
| Colis et historique | Statut modifiable par un seul chemin (verrou de ligne, table de transitions, permission + portée d'entrepôt, motif) ; la base refuse tout changement de statut sans événement et toute modification de l'historique, même pour le propriétaire des tables ; un colis hors portée ou d'une autre entreprise est présenté comme inexistant | `packages.spec.ts` |
| Suivi public | Numéro à 50 bits aléatoires (secret) + caractère de contrôle ; recherche par fonction SQL `SECURITY DEFINER` qui ne renvoie que l'entreprise ; réponse 404 identique pour inconnu, mal formé ou contrôle erroné ; limite 30/min/IP, `no-store` ; **aucun** nom, téléphone, adresse, valeur, document, acteur ni texte libre ; motifs de retenue sensibles masqués | `packages.spec.ts`, `e2e/parcels.spec.ts` |
| Tarifs | Grille active immuable (API **et** déclencheurs) ; périodes sans chevauchement (contrainte d'exclusion) ; calcul en décimal exact ; jamais de prix par défaut (422 `TARIFF_UNAVAILABLE`) ; l'estimation publique ne révèle aucune tranche | `pricing.spec.ts`, `calculator.spec.ts` |
| Pièces jointes | Type réel lu dans le contenu (le type annoncé n'est qu'une indication) ; JPEG/PNG/WebP/PDF, 8 Mo, 10 par objet ; PDF à contenu actif (`/JavaScript`, `/Launch`, `/EmbeddedFile`…) refusé ; nom assaini ; clé de stockage construite par le serveur (CHECK en base) ; accès vérifié selon le propriétaire (client : ses objets ; personnel : portée d'entrepôt) ; liens HMAC de 5 minutes liés à l'entreprise ; contenu servi avec `nosniff` et CSP `sandbox` | `files.spec.ts` |
| Journaux | JSON structuré (pino) ; en-têtes `Authorization`, `Cookie`, `Set-Cookie` masqués ; chaîne de requête non journalisée | configuration |

## Ce qui manque ou reste fragile

_Phase 4 : le cookie `b2c_session` est lisible par JavaScript par conception ; il ne contient aucun secret. Un script malveillant (XSS) pourrait toutefois agir au nom de l'utilisateur tant que la page est ouverte : d'où la CSP stricte._

| Sujet | Détail | Phase prévue |
|---|---|---|
| Double authentification (TOTP) du personnel | La colonne existe, la fonction non. À rendre obligatoire pour administrateurs et facturation | avant production |
| Vérification du téléphone | Non implémentée (nécessite un fournisseur SMS) | 7 |
| E-mails sans file ni nouvelle tentative | Un échec d'envoi est journalisé mais le message est perdu ; le client doit redemander un lien | 7 (outbox + BullMQ) |
| RLS ≠ protection contre l'exécution de SQL arbitraire | Si un attaquant exécutait du SQL avec le rôle applicatif, il pourrait modifier les paramètres de session. La RLS protège contre un filtre oublié dans le code ; la défense contre l'injection reste les requêtes paramétrées et la revue de code | 9 |
| `TRUST_PROXY` | Doit être `true` uniquement derrière un proxy de confiance qui écrase `X-Forwarded-For`. Mal réglé, un client peut falsifier son IP et contourner les limites par IP (le verrouillage par compte, lui, reste efficace) | 10 |
| Renouvellement concurrent strict | Deux renouvellements simultanés avec le même jeton (double clic, réseau instable) révoquent la session : sûr, mais peut déconnecter un client légitime. Une courte période de grâce pourra être ajoutée | 4 |
| Liste de mots de passe courants | ~50 entrées seulement | 9 |
| Journal d'audit sans chaînage cryptographique | Immuable pour l'application et le propriétaire des tables, mais un superutilisateur PostgreSQL pourrait le tronquer. Prévoir export externe/WORM | 9-10 |
| Pas de détection de robots à l'inscription | Seule la limitation de débit protège | 9 |
| Contrôle de l'existence des portées | `WAREHOUSE` / `AGENCY` : l'identifiant n'est pas vérifié (les tables n'existent pas encore) | 6 |
| Sauvegardes, rétention, chiffrement au repos | Non traités | 10 |
| `/docs` | Exposé si `ENABLE_DOCS=true` : à désactiver ou protéger en production | 10 |
| Stockage de fichiers | Écriture sur **disque local** (`FILES_DIR`) ; adaptateur S3 non écrit (image MinIO inaccessible) ; chiffrement au repos et sauvegarde du dossier à prévoir | 10 |
| Antivirus | Aucun ; seules la vérification du type réel et l'heuristique PDF existent. Ne pas présenter les fichiers comme « analysés » | 9 |
| `SECURITY DEFINER` | `app_package_company` suppose un propriétaire de fonction qui contourne la RLS : vérifier le rôle de migration en production | 10 |
| Numéros de suivi devinables | 50 bits : l'énumération est limitée par le débit (30/min/IP) mais pas par un compteur global ; surveiller les 404 en production | 9 |

## Vulnérabilités connues des dépendances (`npm audit`, 7 restantes : 2 modérées, 5 élevées)

| Paquet | Nature | Décision |
|---|---|---|
| `multer` (via `@nestjs/platform-express`) | déni de service avec un `fileFilter` asynchrone | **Non exploitable ici** : aucune route n'accepte de téléversement multipart (les fichiers passeront par des URL signées vers le stockage objet). Correctif attendu avec NestJS 12 |
| `js-yaml` (via `@nestjs/swagger`) | consommation CPU sur des fusions de clés YAML | Non exploitable : la documentation est générée à partir de notre code, pas de YAML fourni par un utilisateur |
| `prisma`, `@prisma/config`, `deepmerge-ts` | récursion excessive dans l'outil en ligne de commande | Outil de développement et de déploiement (non exposé) ; le correctif impose Prisma 7 (changement majeur) |

`nodemailer` a été mis à jour en version 10 (la 7 était signalée vulnérable). Réévaluer à chaque phase.

## Signaler un problème
À définir avec l'entreprise exploitante (adresse de contact sécurité) avant la mise en production.
