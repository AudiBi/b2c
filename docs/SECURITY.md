# Sécurité

Phase 3. Décrit ce qui est **en place et testé**, puis ce qui **manque**. Une revue de sécurité complète est prévue en phase 9 ; ce document ne vaut pas audit.

## Mesures en place

| Domaine | Mesure | Où / test |
|---|---|---|
| Isolation des entreprises | `company_id` NOT NULL partout ; Row-Level Security activée **et forcée** sur 11 tables ; le rôle de l'API n'est ni superutilisateur, ni `BYPASSRLS`, ni propriétaire ; sans contexte, aucune ligne n'est visible ; contexte posé par `SET LOCAL` dans la transaction (pas de fuite entre requêtes sur le pool) ; clés étrangères composites (une session ne peut pas relier un utilisateur à une autre entreprise) | migration 0001, `DbService`, `rls.spec.ts` |
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
| Journaux | JSON structuré (pino) ; en-têtes `Authorization`, `Cookie`, `Set-Cookie` masqués ; chaîne de requête non journalisée | configuration |

## Ce qui manque ou reste fragile

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
| MinIO / stockage de fichiers | Pas encore utilisé ; l'image Docker de MinIO n'a pas pu être récupérée (profil `storage` non vérifié) | 5 |

## Vulnérabilités connues des dépendances (`npm audit`, 7 restantes : 2 modérées, 5 élevées)

| Paquet | Nature | Décision |
|---|---|---|
| `multer` (via `@nestjs/platform-express`) | déni de service avec un `fileFilter` asynchrone | **Non exploitable ici** : aucune route n'accepte de téléversement multipart (les fichiers passeront par des URL signées vers le stockage objet). Correctif attendu avec NestJS 12 |
| `js-yaml` (via `@nestjs/swagger`) | consommation CPU sur des fusions de clés YAML | Non exploitable : la documentation est générée à partir de notre code, pas de YAML fourni par un utilisateur |
| `prisma`, `@prisma/config`, `deepmerge-ts` | récursion excessive dans l'outil en ligne de commande | Outil de développement et de déploiement (non exposé) ; le correctif impose Prisma 7 (changement majeur) |

`nodemailer` a été mis à jour en version 10 (la 7 était signalée vulnérable). Réévaluer à chaque phase.

## Signaler un problème
À définir avec l'entreprise exploitante (adresse de contact sécurité) avant la mise en production.
