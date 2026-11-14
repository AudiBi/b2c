# Mise en place des données réelles

## Depuis le panel (méthode normale)

Ouvrez **Administration → Paramètres** avec un compte administrateur de l'entreprise.

- **Valeurs de départ** : un bouton crée en une fois les coordonnées publiques (si vides), les entrepôts de Miami et de Philadelphie, l'agence de Pétion-Ville, les catégories, les grilles aérienne et maritime, le taux et la table CONATEL. Ce qui existe déjà n'est jamais modifié ni dupliqué : on peut recommencer sans risque.
- Ensuite, **tout se modifie à la main dans le panel** : coordonnées publiques, **entrepôts** (modèle d'adresse du client compris), **agences et points de retrait**, **catégories** de marchandises, **taux gourdes/dollar**, **seuils d'alerte** de la petite caisse. Les tarifs et la table CONATEL ont leurs écrans (**Grilles tarifaires**, **Frais CONATEL**).

Le script ci-dessous reste disponible pour les installations automatisées ; il utilise exactement la même logique (`packages/shared/src/setup-company.ts`).

## Par script (facultatif)

Script : `scripts/setup-company/run.ts`. Il passe par l'API réelle : toutes les règles s'appliquent. Il est **rejouable** : ce qui existe déjà n'est ni modifié ni dupliqué.

```bash
SETUP_ADMIN_EMAIL=... SETUP_ADMIN_PASSWORD=... npm run setup:company -- --company <slug>
```

Variables facultatives : `API_URL` (défaut `http://localhost:3100`). L'API doit être démarrée ; avec la double authentification obligatoire pour le personnel, utilisez un environnement où elle n'est pas exigée pour cette opération (`REQUIRE_STAFF_2FA=false` en local).

## Ce qui est créé

| Élément | Valeur (reprise de l'outil de gestion) |
|---|---|
| Coordonnées publiques | info@b2cxpress.com, +509 3458 9898, +509 3543 3535, 48 rue Clerveaux, Pétion-Ville (seulement si rien n'est déjà renseigné) |
| Entrepôts | MIA : 3060 NW 72nd Ave, Miami, FL 33122 · PHL : 1245 Passmore St, Philadelphia, PA 19111 |
| Agence | PV : Pétion-Ville |
| Catégories | E_CONTAINER, DRUM |
| Grille aérienne US → HT | 5 $/lb, diviseur 166, sans arrondi ni minimum ; e-conteneur : diviseur 132 |
| Grille maritime US → HT | 18 $/pi³ (volume) ; baril : 220 $ l'unité |
| Taux | 135 gourdes pour 1 dollar (affichage indicatif) |
| Table CONATEL | 21 articles de départ |

Une grille active par trajet et par mode : si elle existe déjà, le script n'y touche pas (une nouvelle version se fait par duplication dans l'écran « Grilles tarifaires »).

## À relire avant la mise en service

- Les téléphones, l'adresse de l'agence et les heures d'ouverture (non repris du prototype).
- Les tarifs et la table CONATEL : l'organisme fixe ses prix « jusqu'à nouvel ordre ».
- Les coûts d'achat du prototype (3,90 $/lb, 14 $/pi³, 150 $/baril) ne sont **pas** importés : ils relèvent de la vague « profit ».
