# Risques avant la mise en production

Liste établie à la fin de la phase 10, à partir de ce qui a **réellement** été construit et testé (ROADMAP.md, TEST_PLAN.md, SECURITY.md, DEPLOYMENT.md). Elle dit ce qui **empêche** d'ouvrir le service au public, ce qui doit être décidé, et ce qui est acceptable avec une réserve. Elle n'est pas un audit externe.

Verdict : **la plateforme n'est pas prête à être ouverte au public en l'état.** Le logiciel est complet pour le périmètre décrit et testé, mais les points « bloquants » ci-dessous dépendent de décisions, de comptes et de vérifications qui n'existent pas encore.

## A. Bloquants (à lever avant d'accepter de vrais clients)

| # | Risque | Pourquoi c'est bloquant | Ce qu'il faut faire |
|---|---|---|---|
| A1 | **Aucun déploiement essayé hors poste de développement** | La pile de production n'a tourné que sur Docker Desktop avec un certificat auto-signé : serveur Linux, domaine, certificat réel, pare-feu, redémarrage après panne, ressources réelles sont inconnus | Déployer sur un serveur de préproduction, rejouer `prod:smoke`, la recette navigateur complète et un test de charge **sur ce serveur** |
| A2 | **Aucun fournisseur d'e-mail de production** | Sans e-mail, personne ne confirme son compte, ne réinitialise son mot de passe, ne reçoit de notification ; l'API refuse de démarrer sans SMTP. Délivrabilité (SPF, DKIM, DMARC) jamais vérifiée | Choisir un fournisseur, configurer le domaine d'expédition, tester avec de vraies boîtes (dont les messageries courantes en Haïti) |
| A3 | **Sauvegardes non automatisées ni hors serveur** | Les sauvegardes restent sur la machine qui les produit : un incident disque ou serveur perd données **et** sauvegardes. Planification, chiffrement, copie distante et alerte d'échec non faits | Planifier, chiffrer, copier hors site, **tester la restauration depuis cette copie**, surveiller l'échec (DEPLOYMENT.md § 5) |
| A4 | **Aucune supervision ni alerte** | Une panne (base, API, notifications bloquées, certificat expiré, disque plein) ne prévient personne | Surveillance externe de `/health/ready`, alertes disque, certificat, sauvegarde ; centralisation et rotation des journaux |
| A5 | **Textes juridiques à l'état de projet** | Conditions générales et politique de confidentialité portent un bandeau « Projet de texte : à faire valider par un juriste » ; la collecte de données personnelles et d'identité exige un cadre juridique valide | Rédaction et validation par un juriste (droit applicable, conservation, droits des personnes) |
| A6 | **Pas de test d'intrusion ni d'audit externe** | La revue de sécurité a été faite par lecture du code et des tests (guide ASVS niveau 2), jamais par un tiers ; une plateforme qui garde identités, adresses et paiements doit être éprouvée | Test d'intrusion par un tiers avant l'ouverture ; correction des constats |
| A7 | **Marque, contacts et contenus provisoires** | Le logo et le nom **B2C** sont en place (WEB.md), mais les coordonnées publiques, les textes de présentation et l'adresse d'expédition des e-mails (`MAIL_FROM`) restent à fournir ou à configurer | Fournir marque, textes, coordonnées, entrepôts et agences réels ; reconstruire l'image `web` |
| A8 | **Aucun tarif réel** | Par conception, aucun tarif n'est inventé : tant que l'entreprise n'a pas saisi et activé sa grille, le calculateur répond « tarif indisponible » et aucun colis ne peut être chiffré | L'entreprise saisit ses vraies grilles (et les valide par des exemples chiffrés connus) |

## B. Décisions à prendre (le logiciel fonctionne sans, mais le métier en dépend)

| # | Sujet | État |
|---|---|---|
| B1 | **Paiement en ligne** (cartes) | Non fait : aucun prestataire choisi. **Modes du premier lancement : espèces, virement bancaire, Zelle** : le client paie en espèces au personnel ou déclare un virement / un paiement Zelle, validé à la main par un agent (aucun moyen de vérifier automatiquement ; les coordonnées bancaires et Zelle de l'entreprise sont saisies dans les consignes de paiement). Le point d'entrée de confirmation signée existe mais n'a été exercé qu'avec un émetteur simulé |
| B2 | **WhatsApp** (le SMS est retiré du produit) | Non fait : aucun fournisseur. Les notifications WhatsApp sont « ignorées — canal non configuré » ; le code de remise n'est lisible que dans l'espace du client (un client sans accès ne peut pas remettre de code) |
| B3 | **Transporteurs aériens et maritimes, cartes et itinéraires** | Non intégrés : départs et arrivées de lots saisis à la main, pas de position ni de date prévue |
| B4 | **Stockage des pièces jointes** | Disque local par défaut (volume à sauvegarder). Le stockage S3 n'est testé que contre SeaweedFS ; pas d'AWS S3 ni d'autre fournisseur, pas de chiffrement des objets, pas d'antivirus |
| B5 | **Une entreprise par site** | Le site est construit pour une seule entreprise ; plusieurs entreprises demandent plusieurs constructions et domaines, ou un développement |
| B6 | **Devises** | Facturation par devise : une facture ne mélange jamais deux devises (`CURRENCY_MISMATCH`) et un colis ne se facture qu'une fois, donc son solde reste dans une seule devise. **La caisse a une devise** (migration 0014) : un encaissement en espèces entre dans la caisse ouverte de la devise de sa facture, sinon il est refusé ; une agence qui encaisse deux devises ouvre deux caisses, et attendu, compté et écart restent dans la devise de la caisse. Aucune **conversion** entre devises n'existe : c'est voulu |
| B7 | **Signature de remise** | Absente (preuves : code, pièce d'identité à 4 caractères, photo) ; la photo est ajoutée par le personnel, le livreur ne peut pas la prendre depuis son écran |

## C. Risques techniques majeurs (acceptables avec une réserve connue)

| # | Risque | Détail |
|---|---|---|
| C1 | **Une seule instance, pas de haute disponibilité** | Une panne de la machine, de PostgreSQL ou de l'API interrompt le service ; la mise à jour coupe brièvement l'API ; pas de réplique de base ni de basculement |
| C2 | **Capacité inconnue** | Mesures de charge sur un poste de travail (suivi connu : environ 128 requêtes/s sous 50 connexions simultanées, 0 erreur serveur ; limite par IP exacte). Pas de mesure sur serveur réel, ni des écrans du personnel, de l'émission de factures, du traitement des notifications ; pas d'endurance |
| C3 | **Rôle de migration super-utilisateur** | `b2c_migrator` est le super-utilisateur du conteneur PostgreSQL (la fonction de suivi public `SECURITY DEFINER` en dépend). Jamais utilisé par l'API (rôle `b2c_app`, soumis à la RLS), mais à revoir avec une base gérée |
| C4 | **Double authentification** | Obligatoire pour le personnel en production, mais : jamais essayée avec une vraie application d'authentification ni dans la recette navigateur ; pas de réinitialisation par un administrateur (un second facteur perdu sans code de secours demande une intervention en base) ; la clé `TOTP_ENCRYPTION_KEY` perdue rend les secrets illisibles |
| C5 | **Dépendances** | En production : 3 alertes « élevées » dans l'outil en ligne de commande Prisma (correctif = Prisma 7, changement majeur non fait) ; alertes critiques dans des outils de test (vitest, autocannon) : non exposées. Aucun pipeline d'intégration continue : les tests ne s'exécutent qu'à la main |
| C6 | **Journal d'audit sans chaînage** | Immuable pour l'application et le propriétaire des tables, mais un super-utilisateur PostgreSQL pourrait l'altérer : prévoir un export externe |
| C7 | **Pas de détection de robots, liste de mots de passe courts, `TRUST_PROXY`** | Voir SECURITY.md : limitation de débit seulement ; ~50 mots de passe courants refusés ; la confiance dans l'adresse du client suppose que nginx reste le seul point d'entrée |
| C8 | **Accessibilité et langues** | Contrôle automatique (axe) seulement : aucun test avec lecteur d'écran, aucun audit manuel ; **le créole n'a pas été relu par un locuteur natif** ; Chromium seulement (ni Firefox ni Safari), aucun test sur vrai téléphone ni réseau lent |
| C9 | **Matériel** | Lecteurs de codes-barres simulés par la saisie, jamais essayés ; impression d'étiquettes non faite |
| C10 | **Confirmation de pesée furtive** | Le message disparaît presque aussitôt (le panneau se referme) : à corriger |
| C12 | **Panel d'administration récent** | Écrans de gestion des utilisateurs, des rôles et des entreprises neufs : testés (unitaires, API, recette partielle) mais pas encore éprouvés par des utilisateurs ; création d'entreprise et gestion des rôles absentes de la recette navigateur (couvertes par des tests d'interface et d'API) ; écrans repris des phases 6 à 8 denses ; pas de rôles personnalisés ni de réinitialisation du second facteur par un administrateur ; le certificat TLS doit couvrir **deux** noms de domaine |
| C13 | **Équipe d'un compte professionnel récente** | Testée (API, interface) mais pas éprouvée par des clients : **pas de transfert de propriété** (si le propriétaire part, l'accès se règle par l'entreprise), **une seule équipe par personne**, deux rôles fixes seulement (pas de droits à la carte), l'historique du client ne couvre que la gestion de l'équipe (invitations, rôles, retraits), pas ce que fait chaque membre sur les colis ; lien d'activation envoyé par e-mail (la délivrabilité reste le point A2) |
| C14 | **Tableau de bord client : inspiration sans référence directe** | Conçu d'après les usages courants des espaces clients de transitaires, **sans avoir pu consulter** l'espace connecté d'un concurrent (accès protégé) ; pas de graphique d'évolution ni de carte, pas d'avis de clients sur l'ergonomie | Recueillir les retours de vrais clients et ajuster |
| C11 | **Images volumineuses** | L'image `api` pèse 810 Mo : sans conséquence fonctionnelle, mais allonge les déploiements |

## D. Ce qui est solide (vérifié par des tests exécutés)

Isolation des entreprises par la base (RLS forcée, 52 tables) ; sessions et verrouillage ; double authentification TOTP ; machine d'états des colis protégée en base ; factures immuables et numérotées sans trou ; remise avec code, solde dû bloquant et dérogation journalisée ; livreur limité à ses tournées ; journal d'audit en ajout seul ; limite de débit exacte ; aucune erreur serveur sous charge ; restauration de sauvegarde et reconstruction après sinistre essayées ; production refusant les réglages dangereux ; 972 tests automatisés (partagé 88, API 545 + 7 ignorés, site 157, panel 92, navigateur 89).

## Ordre conseillé

1. Préproduction sur un vrai serveur (A1) avec fournisseur d'e-mail (A2) : rejouer tous les tests contre elle.
2. Sauvegardes hors site et supervision (A3, A4), exercice de restauration depuis la copie distante.
3. Contenus, marque, tarifs, textes juridiques (A5, A7, A8) en parallèle.
4. Test d'intrusion (A6) et correction.
5. Ouverture restreinte (quelques clients) avant l'ouverture générale ; décisions B1 à B7 selon les priorités du métier.
