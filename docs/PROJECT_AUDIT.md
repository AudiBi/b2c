# Rapport d'audit : phase 1

Date : 2026-10-24. Statut : **audit uniquement, aucune fondation de projet n'a été modifiée ni créée.**

## 1. Résumé

| Constat | Conséquence |
|---|---|
| `C:\dev\b2c` (répertoire de travail) est **vide** et n'est pas un dépôt Git. | Projet à créer de zéro (greenfield). Aucune donnée ni fonctionnalité à préserver ici. |
| Le dépôt Git ouvert au début de la session, `C:\xampp\htdocs\siteweb-kashpaw`, est le **site vitrine de KashPaw** (transfert d'argent / paiement mobile en Haïti). Ce n'est **pas** une application de logistique. | Il ne contient aucun module logistique. Il peut servir de référence de style et d'hébergement, pas de base fonctionnelle. Il ne doit pas être modifié. |
| La référence https://shippex.net/ est un service d'expédition États-Unis ⇄ Haïti (⇄ Turks-et-Caïcos), aérien et maritime, avec adresses d'entrepôts, suivi, calculateur et espace client. | Le périmètre demandé est cohérent avec ce modèle. De nombreux éléments internes ne sont pas visibles publiquement (voir §3.3). |
| Outils présents sur la machine : Node v22.21.1, npm 11.1.0, PHP 8.2.12, Docker 29.4.3, PostgreSQL client 18.4, Git 2.46. | Une pile Node/TypeScript + PostgreSQL est installable sans prérequis supplémentaire. Redis et un stockage S3 ne sont pas vérifiés (Docker les fournira en local). |

**Point à confirmer avant la phase 2** : le dossier cible est-il bien `C:\dev\b2c` ? Le répertoire de travail a changé en cours de session (de `siteweb-kashpaw` vers `C:\dev\b2c`). Je pars de l'hypothèse que `C:\dev\b2c` est le nouveau projet.

## 2. Audit du code existant

### 2.1 `C:\dev\b2c`
Vide : 0 fichier, pas de `.git`.

### 2.2 `C:\xampp\htdocs\siteweb-kashpaw` (KashPaw, lu en lecture seule)
- 184 fichiers suivis, 15 commits, branche `main`, arbre propre.
- **Racine** : ancien site statique (HTML, Bootstrap, jQuery, traductions JSON, `pages/send_email.php`, `pages/contact-us.php`). Il a été remplacé par le sous-dossier ci-dessous mais reste dans le dépôt.
- **`kashpaw-site/`** : site vitrine **Astro 7** (TypeScript), contenu trilingue FR / EN / HT en JSON, composants Astro réutilisables, un script PHP de formulaire de contact (`server/ContactHandler.php`, jeton, hôtes autorisés), tests (Playwright E2E, PHP, unitaires, parité i18n), script de paquet de livraison et de vérification de release, guide de déploiement cPanel/Apache.
- **Absent** : base de données, authentification, API, rôles, colis, tarifs, paiements, notifications, tableau de bord. Aucune de ces fonctionnalités n'existe, même partiellement.
- **Réutilisable comme idée, pas comme code** : structure `config/` + `content/<langue>/`, i18n avec clé manquante = échec de build, tests de parité de langues, paquet de release vérifié. Le contenu, la marque et les coordonnées de KashPaw ne doivent pas être repris.
- **Remarques de risque** (hors périmètre, à titre d'information) : le dépôt contient d'anciens fichiers à la racine (`pages/error_log` suivi par Git, scripts d'envoi d'e-mail) ; le guide de déploiement les fait supprimer.
- Dossiers voisins dans `C:\dev` (`kashpaw-app`, `kashpaw-backoffice`, `kashpaw-sms-gateway`, `smpp-api`, `supermillions`, etc.) : **non examinés**, hors du périmètre indiqué. Je ne les lirai que sur votre demande, par exemple pour réutiliser la passerelle SMS.

## 3. Analyse de la référence shippex.net

Méthode : lecture des pages publiques par un outil de récupération qui résume le contenu. Ce n'est pas un export HTML brut : les libellés exacts et les éléments chargés en JavaScript (listes de villes, résultats) peuvent m'échapper. Rien n'a été soumis (aucun compte créé, aucun formulaire envoyé).

### 3.1 Parcours et fonctionnalités visibles
| Page | Constats |
|---|---|
| Accueil | Menu : Accueil, Suivi, Nos adresses, Estimation, À propos (Qui sommes-nous, CGU, Confidentialité), Support (FAQ, Chat), sélecteur de langue (EN, ES, FR, HT), Connexion / Mon compte. Appels à créer un compte, applications Android et iOS, réseaux sociaux. |
| Couverture | États-Unis, Haïti, Turks-et-Caïcos. 9 sites aux États-Unis (Floride, Géorgie, Massachusetts, Rhode Island). 13 sites en Haïti (Port-au-Prince/Delmas, Pétion-Ville, Carrefour, Cap-Haïtien, Cayes, Gonaïves, Hinche, Jacmel, Jérémie, Léogâne, Ouanaminthe, Port-de-Paix, Saint-Marc). |
| Transport | Aérien (« Plane ») et maritime (« Boat »). Délais indicatifs dans les CGU : environ 5 à 14 jours ouvrables par avion, jusqu'à 30 par bateau, sans garantie. |
| Suivi | Formulaire unique : numéro de suivi Shippex **ou** numéro du fournisseur. Ce que le suivi affiche publiquement n'est pas visible. |
| Adresses | Annuaire statique (nom, adresse, lien d'itinéraire), sans filtre ni horaires. **Aucun code client n'apparaît dans les adresses publiques.** L'adresse personnalisée de réception serait donc dans l'espace connecté (non vérifiable). |
| Calculateur | Champs : transport, pays/ville d'origine, pays/ville de destination, poids, longueur, largeur, hauteur. Annonce un poids volumétrique et un prix. Aucune unité, diviseur, minimum ni arrondi n'est affiché. Pas de catégorie de marchandise, d'assurance ni de services supplémentaires. |
| Inscription | Prénom, nom, téléphone (indicatif pays), e-mail, mot de passe + confirmation, pays, adresse, adresse et pays de livraison (Haïti par défaut), type de client (**Personnel, Entreprise, Ambassade, ONG**), identifiant de référence optionnel, langue, acceptation des CGU. |
| FAQ | Suivi par e-mail et compte, paiements (espèces, virement, Zelle, Visa/Mastercard), assurance automatique jusqu'à 100 $ avec extension selon la valeur déclarée, tarification sur le plus grand du poids réel et du poids dimensionnel. N'aborde pas : préalertes, douane, retrait, objets interdits. |
| CGU | 26 sections. Points utiles : stockage gratuit 30 jours puis frais possibles (barème non publié), assurance additionnelle jusqu'à 3 000 $, demande de remboursement sous 90 jours, droits et taxes pouvant atteindre 35 % de la valeur, droit de la Floride applicable. Aucune liste de marchandises interdites. |

### 3.2 Enseignements à retenir (comme idées, pas comme copie)
- Suivi par numéro interne **ou** numéro fournisseur : le modèle de données doit stocker les deux.
- Types de client au-delà de « individuel / professionnel » : Ambassade et ONG existent chez la référence. À décider (voir §6).
- Langues : la référence propose aussi l'espagnol. Votre cahier des charges demande FR / HT / EN.
- Les règles chiffrées de la référence (100 $, 3 000 $, 30 jours, 90 jours, 35 %) sont les siennes. Ici, tout doit être paramétrable en administration, avec vos propres valeurs.
- Le contenu, le logo, les textes et la charte de Shippex ne sont pas repris.

### 3.3 Non accessible publiquement (je ne le suppose pas)
Tableau de bord client et liste des colis, génération de l'adresse personnalisée et du code client, résultat réel du suivi et ses statuts, résultat du calculateur et grille de tarifs, processus de préalerte, achat assisté (« Online purchase »), logique de paiement en ligne, notifications, outils des employés et des livreurs, intégrations de paiement, de SMS et de transport. Les pages Contact et Chat n'ont pas été analysées. Ce qui est décrit au §5 pour ces points vient de votre cahier des charges, pas de la référence.

## 4. Écart entre l'existant et le cahier des charges

Rien n'existe côté logistique. Le tableau indique le travail restant, pas un état d'avancement.

| § du cahier | Domaine | Existant | Phase prévue |
|---|---|---|---|
| 3 | Site public (17 pages) | Aucun dans `b2c`. Le site KashPaw a un contenu sans rapport. | 4 |
| 4 | Clients, adresses, codes client | Rien | 3, 4 |
| 5 | Colis, 17 statuts, audit | Rien | 5 |
| 6 | Préalertes et rapprochement | Rien | 5 |
| 7 | Calculateur et grille tarifaire | Rien | 5 |
| 8 | Entrepôts, scans, emplacements | Rien | 6 |
| 9 | Expéditions, lots, manifestes | Rien | 6 |
| 10 | Suivi public et API | Rien | 5 |
| 11 | Agences, tournées, livraison, OTP | Rien | 6, 8 |
| 12 | Facturation et paiements | Rien | 7 |
| 13 | Notifications multicanaux | Rien (le projet KashPaw a une passerelle SMS séparée, non examinée) | 7 |
| 14 | Tableau de bord et administration | Rien | 8 |
| 15 | 12 rôles et autorisations | Rien | 3 |
| 16, 17 | Architecture, sécurité | Rien | 2, 3, 9 |
| 18, 19 | Tests, documentation | Rien (ce rapport est le premier document) | toutes |

## 5. Architecture proposée (à valider en phase 2)

Le répertoire étant vide, je propose la pile suggérée dans votre cahier, adaptée à ce que la machine permet :

- **Monorepo npm workspaces** : `apps/api` (NestJS + TypeScript), `apps/web` (React + TypeScript, site public + portails), `packages/shared` (types, validations, statuts partagés).
- **PostgreSQL** + **Prisma** (migrations versionnées), **Redis** + **BullMQ** (notifications, tâches, nouvelles tentatives), stockage objet **compatible S3** (MinIO en local), OpenAPI/Swagger générée.
- **Docker Compose** pour PostgreSQL, Redis, MinIO en local ; Dockerfiles pour la production.
- Tests : Vitest/Jest (unitaires), Supertest sur une vraie base de test (intégration), Playwright (E2E).
- **Multi-entreprises** : à trancher (§6). Si oui, `company_id` partout, avec isolement forcé côté serveur (y compris files, exports, fichiers) dès la phase 3. L'ajouter après coup est coûteux.
- Machine d'états des colis (17 statuts) codée en un seul endroit côté serveur, chaque transition écrivant le journal d'audit dans la même transaction.
- Couche d'intégration par interfaces (paiement, SMS, e-mail, WhatsApp, transporteur) avec fournisseurs réels branchés uniquement quand des identifiants existent. Sinon, le fournisseur est marqué « non configuré » dans l'interface, pas simulé comme actif.

## 6. Décisions nécessaires (je ne les prends pas à votre place)

1. **Dossier cible** : `C:\dev\b2c` confirmé ?
2. **Mono-entreprise ou multi-entreprises** (plusieurs sociétés de logistique sur la même plateforme) ? Cela change le schéma dès le départ.
3. **Types de client** : individuel et professionnel seulement, ou aussi ambassade / ONG comme la référence ?
4. **Marque** : nom et identité de votre entreprise (le cahier demande une marque indépendante). Un nom provisoire peut être utilisé.
5. **Pile technique** : la proposition du §5 vous convient-elle, ou souhaitez-vous rester sur PHP/XAMPP comme vos autres projets ?
6. **Fournisseurs réels disponibles** pour le paiement (le marché haïtien : par exemple MonCash, NatCash, ou une passerelle carte), SMS, e-mail, WhatsApp Business. Sans compte ni clé, ces intégrations resteront « non configurées ».
7. **Premiers entrepôts et agences**, devises (USD / HTG), unités (lb / kg, in / cm) et valeurs par défaut du diviseur volumétrique. Sans vos valeurs, je mettrai des valeurs de démonstration clairement étiquetées comme telles dans les données de départ, jamais dans le code.

## 7. Risques identifiés

| Risque | Gravité | Mesure |
|---|---|---|
| Périmètre très large (≈ 10 phases) : plusieurs mois de travail réel pour une équipe | Élevée | Livrer par phases testables ; la phase 3 doit être validée avant les suivantes. |
| Choix mono / multi-entreprises tardif | Élevée | Décision avant la phase 2 (§6.2). |
| Isolement des données clients (colis d'autrui) | Élevée | Filtre par propriétaire côté serveur + tests dédiés (tests 13 et 14 du cahier). |
| Paiements : double encaissement, faux « payé » | Élevée | Clés d'idempotence, statut « payé » seulement sur confirmation du prestataire, aucun numéro de carte stocké. |
| Intégrations (paiement, SMS, transporteurs) impossibles sans comptes et clés | Moyenne | Couche d'interfaces ; statut d'intégration affiché honnêtement. |
| Exigences légales douane / droits / taxes haïtiennes non fournies | Moyenne | Taxes et frais configurables ; textes juridiques à faire valider par un juriste. |
| Références à la marque Shippex (contenu, logo) | Faible | Aucun élément repris. |
| Environnement : Redis et stockage S3 non vérifiés ; versions locales à confirmer | Faible | Docker Compose. |

## 8. Prochaines étapes (phase 2, après votre validation)

1. Spécifications détaillées (`REQUIREMENTS.md`), modèle de domaine (`DOMAIN_MODEL.md`), architecture (`ARCHITECTURE.md`), schéma de données (`DATABASE_SCHEMA.md`), backlog (`ROADMAP.md`).
2. Squelette du monorepo, Docker Compose, première migration (utilisateurs, rôles, audit) en phase 3.

## 9. Fichiers créés ou modifiés pendant cette phase

- Créé : `C:\dev\b2c\docs\PROJECT_AUDIT.md` (ce document).
- Aucun autre fichier créé ni modifié. Le dépôt KashPaw n'a pas été touché.
