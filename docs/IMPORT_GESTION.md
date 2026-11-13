# Import des données de l'outil de gestion

Script : `scripts/import-gestion/run.ts` (lecture et contrôle : `mapping.ts`). Décisions : `docs/FUSION.md` § 6.

## Procédure

1. **Export** : dans l'outil de gestion, copier le contenu JSON de la clé `b2c_db_v1` (ou utiliser sa sauvegarde) dans un fichier `export.json`.
2. **Simulation** (n'écrit rien, c'est le mode par défaut) :

```bash
npm run import:gestion -- --file export.json --report rapport.txt
```

3. **Nettoyage** des anomalies du rapport, dans l'outil de gestion ou dans le fichier, puis nouvelle simulation jusqu'à un rapport acceptable.
4. **Import réel**, dans une entreprise **sans colis** (base de démarrage). Le script écrit avec le rôle propriétaire (il contourne la RLS) : il ne vise jamais une base en service.

```bash
IMPORT_DATABASE_URL=postgresql://b2c_migrator:...@localhost:5442/b2c_dev npm run import:gestion -- --file export.json --company <slug> --warehouse <référence entrepôt> --apply
```

5. **Rapprochement** : comparer le nombre de clients, de colis par statut et les soldes ouverts du rapport avec l'outil de gestion.

## Ce qui est importé

| Donnée | Traitement |
|---|---|
| Clients | Tous ceux qui ont un nom. Créés **sans accès** (adresse factice `@no-access.invalid`, aucun mot de passe) ; invitation plus tard depuis l'écran Comptoir. E-mail repris seulement s'il est valide et libre. Adresse, pays, référent et téléphones supplémentaires dans la note du rapport. |
| Colis ouverts | Tous. Statut converti (tableau § 6.2 de FUSION), ancien code conservé dans `legacy_tracking_number`, destinataire, mesures converties (lb → kg, pouces → cm). Un événement privé « IMPORTED » est ajouté. |
| Colis livrés ou retournés | Seulement ceux des 12 derniers mois ; les autres sont comptés dans le rapport (« archivés ») et à conserver en fichier. |
| Soldes ouverts | **Non importés** : le rapport les totalise par client pour émettre des factures de reprise. |
| Paiements, factures, dépenses, employés, paies | Non importés. |
| Utilisateurs et PIN | **Jamais.** |

## Anomalies signalées

`CLIENT_SANS_NOM`, `TELEPHONE_INVALIDE`, `TELEPHONE_EN_DOUBLE`, `EMAIL_INVALIDE`, `CODE_ABSENT`, `CODE_EN_DOUBLE`, `STATUT_INCONNU`, `MODE_INCONNU`, `CLIENT_INTROUVABLE`, `DESTINATAIRE_ABSENT`, `MESURES_ABSENTES`, `MESURES_ESTIMEES`.

La base exige un poids et des dimensions pour tout colis au-delà de l'inspection. Un colis avancé sans mesures (fûts, conteneurs) est donc **écarté** (`MESURES_ABSENTES`), sauf avec `--estimer-mesures` : 1 kg et 1 cm sont alors posés, marqués « estimés » dans l'événement d'import, à corriger.

## Limites

- Les anciens colis arrivent sans facture ni paiement ; le solde dû se règle par une facture de reprise.
- L'import est une opération unique : un second import dans la même entreprise est refusé (`--force` pour l'imposer, à vos risques).
- Testé sur un jeu d'exemple (`scripts/import-gestion/exemple-export.json`) et par `apps/api/test/import-gestion.spec.ts` ; pas encore essayé sur une vraie base du prototype.
