# Mise en place des données réelles

Script : `scripts/setup-company/run.ts` (logique et valeurs : `setup.ts`). Il passe par l'API réelle : toutes les règles s'appliquent. Il est **rejouable** : ce qui existe déjà n'est ni modifié ni dupliqué.

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
