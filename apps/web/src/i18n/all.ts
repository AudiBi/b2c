// Charge les trois langues d'un coup : rendu serveur (pré-rendu) et tests. Le navigateur, lui, passe par loadCatalog (une langue).
import { registerCatalog } from './index';
import { en } from './en';
import { fr } from './fr';
import { ht } from './ht';

registerCatalog('fr', fr);
registerCatalog('ht', ht);
registerCatalog('en', en);
