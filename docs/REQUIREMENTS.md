# Spécifications fonctionnelles et non fonctionnelles

Phase 2. Source : cahier des charges de l'utilisateur (sections 3 à 19) et [PROJECT_AUDIT.md](PROJECT_AUDIT.md).
Nom de marque : **provisoire** (« TransitHaïti », à remplacer ; il est une variable de configuration, jamais en dur dans le code).

## 1. Hypothèses retenues (validées par l'utilisateur le 2026-10-24)

| # | Hypothèse | Effet |
|---|---|---|
| H1 | Projet dans `C:\dev\b2c` | Monorepo créé en phase 3 |
| H2 | **Multi-entreprises** | `company_id` sur toutes les données métier, isolement imposé côté serveur et par Row-Level Security PostgreSQL |
| H3 | Clients : **individuel** et **professionnel** seulement | Énumération `CustomerType` extensible plus tard (ambassade, ONG) |
| H4 | NestJS + React + PostgreSQL + Prisma, Redis/BullMQ, stockage compatible S3 | Voir ARCHITECTURE.md |
| H5 | Marque provisoire | Pas de logo ni de texte emprunté à shippex.net |
| H6 | Valeurs de démonstration | Uniquement dans `prisma/seed-demo.ts`, étiquetées `DEMO`, jamais chargées en production |
| H7 | Devises : USD et HTG. Unités : lb/kg et in/cm | Configurables par entreprise ; conversions centralisées |
| H8 | Langues : FR, HT, EN | Contenu en fichiers de traduction ; modèles de messages en base par langue |

Hypothèses **non** validées, donc à confirmer avant la phase 7 : prestataires de paiement, SMS, WhatsApp, e-mail.
Jusque-là, ces intégrations sont des interfaces avec l'état « non configuré ».

## 2. Acteurs et rôles

12 rôles (cahier §15). Chaque rôle est un ensemble de permissions ; la portée peut être limitée à un entrepôt ou à une agence.

| Rôle | Portée | Exemples de permissions |
|---|---|---|
| Super administrateur | Plateforme | Créer des entreprises, voir la santé du système. **Pas d'accès par défaut aux données métier** d'une entreprise (accès journalisé et explicite) |
| Administrateur de l'entreprise | Entreprise | Tout dans son entreprise |
| Responsable logistique | Entreprise | Expéditions, lots, manifestes, transporteurs, tarifs en lecture |
| Responsable d'entrepôt | Entrepôt | Réception, emplacements, anomalies, sorties |
| Agent de réception | Entrepôt | Réceptionner, peser, photographier, affecter |
| Agent de facturation | Entreprise | Devis, factures, paiements, remboursements (soumis à seuil) |
| Responsable d'agence | Agence | Réception agence, retrait, tournées, espèces |
| Agent de service client | Entreprise | Clients, réclamations, lecture des colis ; pas de paiement |
| Livreur | Tournées assignées | Voir ses livraisons, confirmer remise, échecs |
| Client individuel | Ses données | Ses colis, préalertes, factures, paiements |
| Client professionnel | Ses données + sous-utilisateurs | Idem, plusieurs adresses et bénéficiaires |
| Auditeur en lecture seule | Entreprise | Lecture partout, y compris le journal d'audit ; aucune écriture |

Règle : l'autorisation est vérifiée **côté serveur** à chaque requête ; l'interface masque seulement ce qui est interdit.

## 3. Exigences fonctionnelles

Priorité : **P0** indispensable au premier produit exploitable, **P1** important, **P2** ultérieur.
Chaque exigence a un identifiant utilisé dans le backlog (ROADMAP.md) et le plan de test.

### 3.1 Comptes et clients (phase 3 et 4)
| ID | Exigence | P |
|---|---|---|
| CLI-01 | Inscription individuelle ou professionnelle avec e-mail, téléphone, mot de passe, langue | P0 |
| CLI-02 | Vérification de l'e-mail par lien à usage unique et durée limitée | P0 |
| CLI-03 | Vérification du téléphone par code à usage unique (déclenchée selon la règle de l'entreprise, par exemple avant retrait) | P1 |
| CLI-04 | Connexion, déconnexion, rotation et révocation des sessions | P0 |
| CLI-05 | Réinitialisation du mot de passe (lien à usage unique, réponse identique que le compte existe ou non) | P0 |
| CLI-06 | Profil, préférences (langue, canaux de notification) | P0 |
| CLI-07 | Carnet d'adresses (personnelles et de livraison) | P0 |
| CLI-08 | **Code client unique** par entreprise, généré par le système, jamais saisi | P0 |
| CLI-09 | **Adresses de réception personnalisées** par entrepôt et par mode, générées à partir du modèle d'adresse de l'entrepôt et du code client | P0 |
| CLI-10 | Bénéficiaires autorisés à récupérer un colis (nom, pièce, téléphone, validité) | P1 |
| CLI-11 | Compte professionnel : raison sociale, identifiant fiscal, sous-utilisateurs | P1 |
| CLI-12 | Historique des expéditions, paiements, factures, reçus | P0 |
| CLI-13 | Assistance et réclamations | P1 |

### 3.2 Préalertes et colis (phase 5)
| ID | Exigence | P |
|---|---|---|
| PRE-01 | Le client déclare un achat : boutique, n° de commande, n° de suivi initial, entrepôt, mode, montant, description, facture jointe | P0 |
| PRE-02 | Rapprochement **automatique** (n° de suivi du transporteur initial ou code client) et **manuel** (file de rapprochement) à la réception | P0 |
| PRE-03 | États de rapprochement : non rapprochée, rapprochée automatiquement, rapprochée manuellement, conflit | P0 |
| PKG-01 | Création d'un colis avec tous les champs du cahier §5 | P0 |
| PKG-02 | Numéro de suivi unique, non devinable, avec chiffre de contrôle | P0 |
| PKG-03 | 17 statuts avec transitions contrôlées (voir DOMAIN_MODEL.md §4), refus de toute transition non listée | P0 |
| PKG-04 | Chaque transition : horodatée, attribuée à un utilisateur, écrite dans l'historique du colis et dans le journal d'audit, dans la **même transaction** | P0 |
| PKG-05 | Poids volumétrique et facturable calculés par règle configurée, valeurs enregistrées avec la version de règle utilisée | P0 |
| PKG-06 | Photos et documents (types, taille et contenu vérifiés) | P0 |
| PKG-07 | Assurance optionnelle (valeur déclarée, prime selon règle configurée) | P1 |
| PKG-08 | Regroupement de colis, séparation, colis endommagé, colis non identifié | P1 |
| PKG-09 | Colis non identifié : stocké sans client, trouvable par recherche, rattachable ensuite | P0 |

### 3.3 Calculateur (phase 5)
| ID | Exigence | P |
|---|---|---|
| CAL-01 | Entrées : origine, destination, mode, poids, dimensions, catégorie, assurance, services | P0 |
| CAL-02 | Poids volumétrique = L × l × h / diviseur ; diviseur, unités, minimum facturable, arrondi **configurables par grille** | P0 |
| CAL-03 | Le prix vient **uniquement** des grilles actives en base ; sans grille correspondante, réponse « tarif indisponible », jamais un prix inventé | P0 |
| CAL-04 | Résultat étiqueté **estimation** ; la facture définitive est calculée à la pesée | P0 |
| CAL-05 | Le calculateur public ne révèle pas les remises ni les tarifs négociés d'un client | P0 |
| CAL-06 | Administration des grilles : création, versions, dates d'effet, activation | P0 |

### 3.4 Suivi (phase 5)
| ID | Exigence | P |
|---|---|---|
| TRK-01 | Page publique : saisie du numéro, statut, dernière mise à jour, origine/destination (villes), mode, événements publics | P0 |
| TRK-02 | Le suivi public ne montre jamais nom, téléphone, adresse exacte, documents ou valeur déclarée | P0 |
| TRK-03 | Détail complet dans le portail pour le propriétaire | P0 |
| TRK-04 | Recherche aussi par numéro de suivi fournisseur (client connecté seulement) | P1 |
| TRK-05 | API de suivi limitée en débit, identique côté public et mobile | P0 |
| TRK-06 | Estimation de livraison affichée uniquement si une donnée réelle existe (date d'arrivée du lot) | P1 |

### 3.5 Entrepôts, expéditions et agences (phase 6)
| ID | Exigence | P |
|---|---|---|
| WH-01 | Entrepôts : pays, ville, adresse, référence, modèle d'adresse de réception | P0 |
| WH-02 | Réception par scan (code-barres/QR ou saisie), pesée, mesure, photos, affectation au client | P0 |
| WH-03 | Emplacements de stockage et mouvements | P1 |
| WH-04 | Anomalies (colis endommagé, inconnu, contenu douteux) avec file de traitement | P0 |
| WH-05 | Inventaire des colis présents et contrôle des sorties | P1 |
| SHP-01 | Lots de transport : référence, mode, origine, destination, transporteur, n° de connaissement, dates, statut | P0 |
| SHP-02 | Ajout de colis à un lot ; un colis n'appartient qu'à un lot actif à la fois | P0 |
| SHP-03 | Manifeste (liste de colis, totaux de poids) en PDF et CSV | P0 |
| SHP-04 | Événements de lot qui se propagent aux colis (départ, arrivée) | P0 |
| SHP-05 | Aucune donnée de positionnement ou d'horaire sans source réelle | P0 |
| AGY-01 | Agences et points de retrait ; affectation des colis | P0 |
| AGY-02 | Réception en agence par scan | P0 |

### 3.6 Livraison (phase 6 et 8)
| ID | Exigence | P |
|---|---|---|
| DEL-01 | Tournées, affectation de livreurs, zones de livraison | P1 |
| DEL-02 | Confirmation de remise : nom du récupérateur, pièce, **OTP**, signature, photo (selon règle) | P0 |
| DEL-03 | Tentatives échouées avec motif, reprogrammation, retour en agence | P1 |
| DEL-04 | Un livreur ne voit que ses tournées | P0 |
| DEL-05 | Remise bloquée si solde dû, sauf dérogation avec permission et journal | P0 |

### 3.7 Finance (phase 7)
| ID | Exigence | P |
|---|---|---|
| FIN-01 | Devis, factures, lignes (transport, entreposage, manutention, assurance, taxes, douane) | P0 |
| FIN-02 | Remises soumises à permission et plafond | P1 |
| FIN-03 | Paiements partiels, solde restant, remboursements | P1 |
| FIN-04 | Paiement espèces enregistré par un employé autorisé : reçu numéroté + audit | P0 |
| FIN-05 | Interface `PaymentProvider` ; un paiement n'est « confirmé » qu'après confirmation vérifiée du prestataire (webhook signé ou requête de vérification) | P0 |
| FIN-06 | Webhooks : signature, rejeu rejeté, traitement idempotent | P0 |
| FIN-07 | Rapprochement des paiements et export comptable (CSV) | P1 |
| FIN-08 | Aucun numéro de carte ni cryptogramme n'est stocké ni journalisé | P0 |
| FIN-09 | Numérotation des factures et reçus sans trou, par entreprise et par année | P0 |

### 3.8 Notifications (phase 7)
| ID | Exigence | P |
|---|---|---|
| NOT-01 | Événements métier → notification (cahier §13, 12 événements) | P0 |
| NOT-02 | Canaux : portail, e-mail (P0) ; SMS et WhatsApp (P1, selon fournisseur) ; mobile (P2) | P0 |
| NOT-03 | Modèles par événement, canal et langue (FR, HT, EN), modifiables | P0 |
| NOT-04 | File de tâches, nouvelles tentatives avec délai croissant, statut d'échec visible | P0 |
| NOT-05 | Préférences du client respectées, sauf messages obligatoires | P1 |

### 3.9 Administration et tableau de bord (phase 8)
| ID | Exigence | P |
|---|---|---|
| ADM-01 | Gestion des utilisateurs, rôles, entrepôts, agences, zones, transporteurs, tarifs, services, taxes, paramètres | P0 |
| ADM-02 | Indicateurs du cahier §14, tous calculés par requêtes sur les données réelles ; état vide affiché tel quel | P0 |
| ADM-03 | Journal d'audit consultable et filtrable (lecture seule) | P0 |
| ADM-04 | Réclamations : ouverture, affectation, résolution | P1 |

### 3.10 Site public (phase 4)
17 pages du cahier §3. Responsive, accessible (WCAG 2.1 AA visé), FR/HT/EN, SEO de base. Contenu de marque original.

## 4. Exigences non fonctionnelles

| ID | Exigence | Mesure |
|---|---|---|
| NFR-01 | Isolement des entreprises | Tests automatisés : aucune requête, recherche, export, tâche de fond ou URL de fichier ne renvoie de données d'une autre entreprise |
| NFR-02 | Isolement des clients | Un client ne lit que ses ressources ; tests 13 et 14 du cahier |
| NFR-03 | Mots de passe | argon2id, politique de longueur, vérification contre mots de passe courants |
| NFR-04 | Limitation de débit | Connexion, réinitialisation, suivi public, calculateur public |
| NFR-05 | Validation des entrées | Schéma strict sur chaque route ; champs inconnus refusés |
| NFR-06 | Opérations financières idempotentes | Clé d'idempotence unique ; rejouer = même résultat |
| NFR-07 | Transactions | Toute transition de statut, tout paiement, toute numérotation en transaction |
| NFR-08 | Concurrence | Deux scans simultanés d'un même colis ne produisent ni doublon ni état incohérent (verrou/contrainte) |
| NFR-09 | Secrets | Jamais dans le dépôt ; `.env.example` sans valeur sensible |
| NFR-10 | Journalisation | Journaux structurés JSON avec identifiant de requête ; aucune donnée personnelle sensible ni secret |
| NFR-11 | Sauvegarde | Sauvegarde PostgreSQL quotidienne, restauration testée et documentée |
| NFR-12 | Conservation | Durées de conservation configurables (documents, journaux, comptes supprimés) |
| NFR-13 | Performance | Suivi public < 300 ms au 95e centile sur données de test ; liste de colis paginée (curseur) |
| NFR-14 | Observabilité | Santé (`/health`), métriques Prometheus, alertes de file en échec |
| NFR-15 | Évolutivité mobile | API versionnée `/v1`, jetons utilisables par une application mobile, aucune logique métier côté interface |
| NFR-16 | Accessibilité et i18n | Clés de traduction manquantes détectées par test |

## 5. Hors périmètre actuel

- Suivi automatique chez les transporteurs aériens ou maritimes (nécessite des API réelles et des contrats).
- Achat pour le compte du client chez un marchand (« Online purchase » de la référence) : non spécifié dans votre cahier ; à décider.
- Application mobile (l'API est prévue pour l'accueillir).
- Déclaration douanière électronique avec l'administration haïtienne.
- Comptabilité complète (seul l'export est prévu).

## 6. Critères d'acceptation globaux
Les 15 parcours du cahier §18 s'exécutent en tests automatisés réellement lancés. Aucune fonctionnalité n'est déclarée terminée sans test passé, et le rapport de fin indique les intégrations actives, simulées et non configurées.
