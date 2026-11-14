# Mise en production et pilote

État au 14 novembre 2026. Ce guide sépare ce qui est **vérifié** de ce qui **reste à faire**, et dit qui doit le faire. Détails techniques : [RENDER.md](RENDER.md), [DEPLOYMENT.md](DEPLOYMENT.md), [SECURITY.md](SECURITY.md), [RISKS.md](RISKS.md).

## 1. Ce qui est vérifié

| Sujet | Preuve |
|---|---|
| Fonctions de la fusion (comptoir, tarifs, CONATEL, profit, caisses, référents, proforma, hors ligne) | Tests automatiques de chaque fonction ; suite complète à relancer avant chaque mise en ligne |
| Isolation des données par entreprise | Sécurité au niveau de la base (RLS forcée) + tests |
| Droits par rôle | Matrice des rôles générée et vérifiée (`docs/ROLE_MATRIX.md`) ; coûts, profit, caisses et référents absents des réponses clients (tests d'absence) |
| Réglages de production sûrs par défaut | `render.yaml` : `NODE_ENV=production`, cookies sécurisés, **double authentification du personnel exigée**, documentation de l'API désactivée |
| Livraison à domicile | Masquée dans le panel ; le site ne la promet plus |

## 2. Ce qui bloque encore, et qui doit agir

| # | Blocage | Qui | Action |
|---|---|---|---|
| 1 | Intégration continue GitHub arrêtée | **Vous** | GitHub → Settings → Billing and plans : lever le blocage de facturation ou le quota d'Actions. Sans cela, aucun contrôle automatique avant une mise en ligne. |
| 2 | Déploiement jamais essayé sur Render | **Vous** puis moi | Créer le Blueprint (`render.yaml`) en suivant [RENDER.md](RENDER.md), saisir les secrets demandés, puis me donner l'adresse pour que je contrôle la santé (`/v1/health` ou `/health/live` selon le service), les pages et la connexion. |
| 3 | Courrier : SPF, DKIM, DMARC | **Vous** (Namecheap) | Publier les trois enregistrements DNS (voir [DEPLOYMENT.md](DEPLOYMENT.md) § courrier), puis envoyer un message réel vers Gmail, Outlook et une boîte utilisée en Haïti et lire les en-têtes (`pass`). |
| 4 | Sauvegardes hors Render | **Vous** | Créer le bucket (Backblaze B2 ou Cloudflare R2, gratuits), saisir `BACKUP_*`, **garder `BACKUP_PASSPHRASE` hors de Render**, puis faire **une restauration d'essai** complète. |
| 5 | Prix et table CONATEL | **Vous** | Contrôler les grilles (aérien 5 $/lb, maritime 18 $/pi³, baril 220 $, e-conteneur 132) et les 21 articles CONATEL (`docs/SETUP_COMPANY.md`). L'organisme fixe ses prix « jusqu'à nouvel ordre ». |
| 6 | Coordonnées publiques | **Vous** | Vérifier téléphones, adresse de l'agence et **heures d'ouverture** (non reprises du prototype). |
| 7 | Import des données du prototype | **Vous** puis moi | Exporter la clé `b2c_db_v1` du prototype, lancer la **simulation** (`npm run import:gestion -- --file export.json --report rapport.txt`), corriger les anomalies, me montrer le rapport avant l'import réel. |
| 8 | Textes en créole | **Vous** | Faire relire les trois langues par un locuteur natif (créole en priorité). |
| 9 | Secrets du `.env` de développement | **Vous** | Ne pas les réutiliser en production : `scripts/init-env-prod.mjs` génère de nouveaux secrets. |

## 3. Ordre conseillé

1. **Débloquer GitHub Actions** (1) et pousser les commits ; la suite doit être verte.
2. **Environnement d'essai sur Render** (2) avec une entreprise d'essai ; courrier (3) et sauvegardes (4) configurés dès le départ.
3. **Mise en place des données réelles depuis le panel** : **Administration → Paramètres → Valeurs de départ**, puis ajustement à la main des coordonnées, entrepôts, agences, catégories, taux et seuils (voir `docs/SETUP_COMPANY.md`), puis contrôle des prix (5) et des coordonnées (6).
4. **Simulation d'import** (7), nettoyage, import réel dans l'entreprise **vide de colis**, rapprochement des chiffres avec le prototype.
5. **Comptes** : inviter chaque personne (jamais d'import de PIN), activer la double authentification, donner les rôles (Comptable, Partenaire, réception…).

## 4. Pilote (2 semaines conseillées)

- **Périmètre** : un seul agent au comptoir, quelques clients et colis réels ; le prototype reste en **lecture seule** et sert de contrôle.
- **Chaque jour** : comparer les totaux de la caisse, le « reste à déposer » et les colis ouverts avec le prototype ; noter tout écart.
- **Chaque semaine** : rejouer le profit du mois dans « Profit » et le comparer au prototype (à l'arrondi près) ; vérifier une restauration de sauvegarde.
- **Critères de sortie** : zéro écart de caisse inexpliqué, courrier reçu en boîte de réception, aucune erreur serveur dans les journaux, équipe à l'aise avec le comptoir, la facturation et la remise.
- **Retour arrière** : le prototype n'est ni modifié ni supprimé pendant le pilote ; l'import peut être refait dans une entreprise vide.

## 5. Après la bascule

- Prototype en lecture seule **au moins un mois**, puis archivage (son export JSON reste conservé).
- Surveillance : journaux de l'API, alertes de sauvegarde, rapport « Retards » chaque semaine.
- Reste à faire plus tard : mode de transport terrestre, suivi automatique chez les transporteurs, éventuel mode hors ligne étendu au-delà de la réception.
