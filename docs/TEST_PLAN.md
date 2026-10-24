# Plan de test

Phase 3. Ce document sera étendu à chaque phase. **Seuls les résultats d'exécutions réelles y figurent.**

## Exécuter

```bash
npm run docker:up     # PostgreSQL, Redis, Mailpit doivent tourner
npm test              # package partagé puis API
```

Les tests de l'API sont des tests d'intégration : ils démarrent l'application complète (NestJS) et l'interrogent en HTTP contre un vrai PostgreSQL (rôle applicatif soumis à la RLS), un vrai Redis et un transport e-mail en mémoire. Un client Prisma avec le rôle de migration sert uniquement à préparer ou vérifier les données. Chaque test crée ses propres entreprises et utilisateurs (identifiants aléatoires) et utilise une adresse IP fictive distincte (`X-Forwarded-For`, `TRUST_PROXY=true` en test) pour que les limites de débit ne s'accumulent pas.

## Dernier résultat

Exécuté le 2026-10-24, Windows 11, Node 22.21.1, PostgreSQL 17, Redis 7.

| Suite | Tests | Résultat |
|---|---|---|
| `packages/shared` (catalogue, `PermissionSet`, schémas) | 21 | ✅ 21 réussis |
| `apps/api` : `rls.spec.ts` (isolation au niveau de la base) | 18 | ✅ |
| `apps/api` : `auth.spec.ts` (inscription, connexion, jetons, sessions, mot de passe oublié) | 40 | ✅ |
| `apps/api` : `iam.spec.ts` (politique des routes, matrice des rôles, invitations, isolation, plateforme) | 47 | ✅ |
| `apps/api` : `rate-limit.spec.ts` (verrouillage, limites, panne Redis) | 7 | ✅ |
| `apps/api` : `infra.spec.ts` (compteurs, idempotence, concurrence) | 9 | ✅ |
| `apps/api` : `app.spec.ts` (santé, en-têtes, CORS, erreurs, configuration, briques unitaires) | 14 | ✅ |
| **Total** | **156** | **156 réussis, 0 échec** |

Vérifications complémentaires faites à la main (non automatisées) :
- **Contrôle de détection des tests** : trois protections ont été volontairement cassées puis rétablies. (1) Réutilisation d'un jeton de renouvellement sans révocation de la famille → 1 test échoue. (2) Garde de permissions neutralisé → 8 tests échouent. (3) Politique RLS de `users` ouverte à tous → 7 tests échouent. Le code et la base ont été remis dans leur état d'origine et les suites repassent.
- **Démarrage réel** de l'API compilée (`npm start`) : `/health/ready` répond 200, `/docs` 200, une connexion invalide renvoie l'erreur structurée.
- **Envoi réel via SMTP** : une inscription sur l'API démarrée a bien livré l'e-mail de confirmation dans Mailpit.
- `seed-demo` exécuté sur la base de test (8 comptes créés) et refus en `NODE_ENV=production` vérifié.
- Migrations appliquées de zéro sur une base vide (`b2c_dev`, via `prisma migrate deploy`). Les tests n'utilisent pas `prisma migrate reset` (voir README).

## Couverture des parcours du cahier des charges (§18)

| # | Parcours | État |
|---|---|---|
| 1 | Un client crée son compte et se connecte | ✅ testé (`auth.spec.ts`) |
| 2-12 | Préalerte, réception, suivi, calculateur, lot, statuts, notifications, paiement, agence, livraison | ⏳ phases 5 à 8 |
| 13 | Un client ne peut pas consulter les données d'un autre client | ✅ pour ce qui existe (utilisateurs, journal d'audit, sessions, base entière via RLS) ; à rejouer sur colis/factures dès leur création |
| 14 | Un employé ne peut pas faire une opération interdite à son rôle | ✅ matrice sur les routes existantes (8 rôles + 3 rôles à portée), autorisation avant validation, anti-escalade, dernier administrateur |
| 15 | Erreurs de paiement ou de notification traitées | ◐ partiel : l'échec d'envoi d'e-mail est journalisé sans casser l'action (constaté en conditions réelles, non couvert par un test automatisé) ; paiements en phase 7 |

Autres exigences de test du cahier :

| Sujet | État |
|---|---|
| Doublons | ✅ inscriptions simultanées de la même adresse (10 requêtes → 1 compte, 0 erreur 500), invitations, rôles, entreprises, e-mails dans deux entreprises |
| Accès concurrents | ✅ 30 incréments de compteur → numéros 1..30 exacts ; 10 requêtes à clé d'idempotence identique → 1 exécution ; deux renouvellements simultanés du même jeton ; deux administrateurs qui se retirent mutuellement leur rôle ; 60 requêtes alternant deux entreprises sur le pool de connexions |
| Erreurs réseau | ✅ Redis injoignable : routes de connexion en 503 (échec fermé), routes ordinaires disponibles, `/health/ready` en 503. ❌ non testé : panne de PostgreSQL, SMTP injoignable |
| Données invalides | ✅ champs inconnus, types, formats, JSON mal formé, corps trop gros (413), mots de passe faibles, jetons falsifiés |
| Transitions de statut interdites | ⏳ phase 5 (machine d'états des colis) |
| Tests de charge | ⏳ phase 9 |
| Tests d'interface (navigateur) | ⏳ phase 4 |

## Limites connues des tests actuels

- Les tests de concurrence prouvent l'absence d'incohérence sur les cas écrits, pas sur toutes les entrelacements possibles.
- Le transport e-mail est simulé en test ; seul un essai manuel a utilisé un vrai SMTP (Mailpit).
- La base de test est partagée entre les fichiers de test (exécutés l'un après l'autre) ; l'isolation repose sur des identifiants aléatoires.
- Aucun test ne vérifie encore les en-têtes d'un déploiement derrière un proxy réel.
