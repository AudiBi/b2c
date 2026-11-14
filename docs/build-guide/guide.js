// Génère docs/GUIDE_UTILISATEUR.docx — node docs/build-guide/guide.js
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel, AlignmentType, LevelFormat, WidthType, ShadingType, BorderStyle,
  Header, Footer, PageNumber, TableOfContents, PageBreak, TabStopType, TabStopPosition,
} = require('docx');

const FONT = 'Arial';
const BLUE = '1F4E79';
const GREY = 'F2F2F2';
const W = 9026; // A4 portrait, marges de 1" : 11906 - 2 × 1440

const run = (text, o = {}) => new TextRun({ text, font: FONT, ...o });

/** Texte avec **gras** simple. */
function runs(text, base = {}) {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part) => (part.startsWith('**') ? run(part.slice(2, -2), { ...base, bold: true }) : run(part, base)));
}
const p = (text, o = {}) => new Paragraph({ spacing: { after: 120, line: 288 }, ...o, children: runs(text) });
const h1 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [run(text)] });
const h2 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [run(text)] });
const h3 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [run(text)] });
const bullet = (text, level = 0) => new Paragraph({ numbering: { reference: 'bullets', level }, spacing: { after: 60, line: 276 }, children: runs(text) });
const step = (text) => new Paragraph({ numbering: { reference: 'steps', level: 0 }, spacing: { after: 60, line: 276 }, children: runs(text) });
const pageBreak = () => new Paragraph({ children: [new PageBreak()] });

const border = { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' };
const borders = { top: border, bottom: border, left: border, right: border };

function table(headers, rows, widths) {
  const total = widths.reduce((a, b) => a + b, 0);
  const cell = (text, w, head) =>
    new TableCell({
      width: { size: w, type: WidthType.DXA },
      borders,
      shading: head ? { fill: BLUE, type: ShadingType.CLEAR, color: 'auto' } : undefined,
      margins: { top: 70, bottom: 70, left: 110, right: 110 },
      children: String(text).split('\n').map((line) => new Paragraph({ spacing: { after: 20 }, children: runs(line, head ? { bold: true, color: 'FFFFFF', size: 19 } : { size: 19 }) })),
    });
  return new Table({
    width: { size: total, type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((h, i) => cell(h, widths[i], true)) }),
      ...rows.map((r) => new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, widths[i], false)) })),
    ],
  });
}

/** Encadré (conseil, attention, à retenir). */
function callout(title, lines, fill = 'DEEAF6', color = BLUE) {
  return new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: [W],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: W, type: WidthType.DXA },
            shading: { fill, type: ShadingType.CLEAR, color: 'auto' },
            borders: { top: { style: BorderStyle.SINGLE, size: 4, color: fill }, bottom: { style: BorderStyle.SINGLE, size: 4, color: fill }, right: { style: BorderStyle.SINGLE, size: 4, color: fill }, left: { style: BorderStyle.SINGLE, size: 24, color } },
            margins: { top: 100, bottom: 100, left: 180, right: 160 },
            children: [new Paragraph({ spacing: { after: 60 }, children: [run(title, { bold: true, color })] }), ...lines.map((l) => new Paragraph({ spacing: { after: 40, line: 276 }, children: runs(l, { size: 20 }) }))],
          }),
        ],
      }),
    ],
  });
}
const tip = (...lines) => callout('À retenir', lines);
const warn = (...lines) => callout('Attention', lines, 'FDE9D9', 'C00000');
const gap = () => new Paragraph({ spacing: { after: 100 }, children: [] });

const body = [];
const add = (...items) => body.push(...items);

// ------------------------------------------------------------------------------------------------
// Page de titre
// ------------------------------------------------------------------------------------------------
add(
  new Paragraph({ spacing: { before: 2600, after: 200 }, alignment: AlignmentType.LEFT, children: [run('B2C Shipping Express', { size: 26, color: '7F7F7F', bold: true })] }),
  new Paragraph({ spacing: { after: 240 }, children: [run('Guide utilisateur complet', { size: 64, bold: true, color: BLUE })] }),
  new Paragraph({ spacing: { after: 120 }, children: [run('Comprendre et utiliser toute la plateforme : site public, espace client, panel du personnel, finances et administration.', { size: 26, color: '404040' })] }),
  new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: BLUE, space: 4 } }, spacing: { after: 300 }, children: [] }),
  p('**Pour qui ?** Les clients, les agents de réception, de facturation et d’agence, les responsables, les comptables, les partenaires à l’étranger et les administrateurs.'),
  p('**Version du guide :** 14 novembre 2026. Les écrans sont décrits tels qu’ils existent dans la plateforme à cette date (français, créole haïtien et anglais).'),
  new Paragraph({ spacing: { before: 1600 }, children: [run('Ce document décrit le fonctionnement. Les décisions d’exploitation (prix, règles de l’entreprise, droits donnés à chacun) restent celles de votre entreprise.', { italics: true, color: '595959', size: 20 })] }),
  pageBreak(),
  new Paragraph({ heading: HeadingLevel.HEADING_1, children: [run('Table des matières')] }),
  new TableOfContents('Table des matières', { hyperlink: true, headingStyleRange: '1-2' }),
  pageBreak(),
);

// ------------------------------------------------------------------------------------------------
add(
  h1('1. La plateforme en bref'),
  p('B2C Shipping Express sert à **recevoir des colis à l’étranger (Miami, Philadelphie…), les expédier en Haïti, les facturer, encaisser les paiements et les remettre à leur destinataire**. Elle suit chaque colis de bout en bout et garde une trace de toutes les opérations.'),
  h2('1.1 Trois espaces, un seul système'),
  table(
    ['Espace', 'Pour qui', 'À quoi ça sert'],
    [
      ['**Site public**', 'Tout le monde', 'Présentation, calculateur de frais, suivi d’un colis, liste des entrepôts et des agences, contact, création de compte.'],
      ['**Espace client**', 'Les clients connectés', 'Adresse de réception à l’étranger, déclaration d’achats, suivi de ses colis, factures et paiements, code de remise, réclamations.'],
      ['**Panel du personnel**', 'L’équipe de l’entreprise', 'Réception, comptoir, pesée, facturation, caisse, expédition, remise, réclamations, finances, administration. Ce que chacun voit dépend de son rôle.'],
    ],
    [1900, 2000, 5126],
  ),
  gap(),
  h2('1.2 Le trajet d’un colis'),
  step('Le client achète en ligne et fait livrer l’achat à **l’adresse de réception de l’entrepôt** (avec son code client), ou dépose un colis au comptoir.'),
  step('Le colis est **reçu à l’entrepôt**, vérifié, **pesé et mesuré**. Le prix est calculé d’après la grille tarifaire.'),
  step('Une **facture** est émise. Selon la règle de l’entreprise, le colis attend le paiement avant de partir, avant d’être remis, ou les deux.'),
  step('Le colis part dans un **lot d’expédition**, arrive en Haïti, passe la **douane** et rejoint l’**agence**.'),
  step('Le colis est **prêt pour retrait**. Le client, un bénéficiaire autorisé ou le destinataire vient le retirer à l’agence avec les preuves exigées.'),
  gap(),
  tip('**Il n’y a pas de livraison à domicile.** Les colis se retirent en agence ou au comptoir. Les écrans de tournées existent dans le code mais sont masqués.'),
  gap(),
  h2('1.3 Entrepôt ou agence ?'),
  table(
    ['', 'Entrepôt', 'Agence'],
    [
      ['Où ?', 'À l’étranger (Miami, Philadelphie…), parfois en Haïti pour un envoi vers l’extérieur.', 'En Haïti (par exemple Pétion-Ville).'],
      ['Rôle', 'Recevoir, vérifier, peser, ranger et préparer le départ.', 'Recevoir les colis arrivés, encaisser, remettre au client.'],
      ['Caisse', 'Pas de caisse.', 'Une caisse par agence et par devise.'],
      ['Accès limité à…', 'Un entrepôt précis (responsable d’entrepôt, partenaire, agent de réception).', 'Une agence précise (responsable d’agence).'],
    ],
    [1700, 3663, 3663],
  ),
  gap(),
  h2('1.4 Vocabulaire'),
  table(
    ['Terme', 'Sens'],
    [
      ['**Numéro de suivi**', 'Numéro unique du colis (préfixe de l’entreprise + caractères + un caractère de contrôle). Il sert au suivi public. Un colis importé garde aussi son **ancien numéro** (par exemple B2C-261001-0001).'],
      ['**Code client**', 'Identifie le client (par exemple CL-000123). Il figure dans l’adresse de réception.'],
      ['**Préalerte**', 'Déclaration d’un achat par le client avant l’arrivée du colis.'],
      ['**Poids facturable**', 'Le plus grand du poids réel et du poids volumétrique, selon la grille.'],
      ['**Poids volumétrique**', 'Longueur × largeur × hauteur divisé par un diviseur fixé par la grille (166 en pouces et livres, 132 pour un e-conteneur).'],
      ['**Lot (expédition)**', 'Ensemble de colis expédiés ensemble par avion ou par bateau.'],
      ['**Grille tarifaire**', 'Les prix par mode (aérien, maritime), par trajet et par tranche.'],
      ['**CONATEL**', 'Frais de l’organisme pour certains articles électroniques. Ils sont reversés : ils ne font pas partie de votre marge.'],
      ['**Caisse**', 'Session d’encaissement en espèces d’une agence, dans une seule devise, ouverte avec un fonds et clôturée avec un comptage.'],
      ['**Remise**', 'Le moment où le colis est donné à la personne qui vient le retirer.'],
    ],
    [2300, 6726],
  ),
  pageBreak(),
);

// ------------------------------------------------------------------------------------------------
add(
  h1('2. Premiers pas'),
  h2('2.1 Créer un compte ou recevoir une invitation'),
  bullet('**Un client** crée lui-même son compte sur le site (e-mail, mot de passe, nom, téléphone) et confirme son adresse par le lien reçu par e-mail.'),
  bullet('**Un membre du personnel** est invité par un administrateur : il reçoit un lien d’activation, choisit son mot de passe, puis active la **double authentification**.'),
  bullet('**Un client créé au comptoir sans e-mail** n’a pas d’accès au site tant qu’on ne lui a pas envoyé une invitation (voir le chapitre 8).'),
  h2('2.2 Se connecter'),
  bullet('Le **site** (par exemple b2cxpress.com) est pour les clients ; le **panel** (par exemple admin.b2cxpress.com) est pour le personnel. Un client qui essaie le panel est refusé.'),
  bullet('Après plusieurs mots de passe erronés, la connexion est ralentie puis bloquée un moment : c’est une protection, attendez quelques minutes.'),
  bullet('**Mot de passe oublié** : le lien « Mot de passe oublié » envoie un message de réinitialisation.'),
  h2('2.3 Double authentification (personnel)'),
  p('Elle est **obligatoire pour le personnel**. À la première connexion, scannez le code QR avec une application d’authentification (Google Authenticator, Microsoft Authenticator…), saisissez le code à six chiffres et **gardez les codes de secours** dans un endroit sûr.'),
  warn('Si un employé perd son téléphone et ses codes de secours, **un administrateur peut réinitialiser sa double authentification** depuis la fiche de l’utilisateur. L’employé devra la réactiver.'),
  h2('2.4 Langue'),
  p('La langue (français, créole, anglais) se change depuis le sélecteur en haut de l’écran. Le choix est mémorisé sur l’appareil.'),
  pageBreak(),
);

// ------------------------------------------------------------------------------------------------
add(
  h1('3. Le site public'),
  h2('3.1 Calculateur de frais'),
  p('Le visiteur choisit le mode (aérien ou maritime), le trajet, le poids et, si possible, les dimensions. Le site affiche une **estimation** : le détail et le total. Si aucune grille ne s’applique, il le dit honnêtement : **aucun prix n’est jamais inventé**. Le montant définitif vient de la pesée réelle.'),
  p('Si l’entreprise a réglé un **taux en gourdes**, le total en dollars est suivi d’un équivalent indicatif en gourdes.'),
  h2('3.2 Suivi d’un colis'),
  bullet('On saisit le numéro de suivi (ou l’**ancien code** d’un colis importé) pour voir l’état et l’historique.'),
  bullet('Le suivi public n’affiche **jamais** de nom, de téléphone, de document, de prix ni d’information interne.'),
  bullet('Un numéro faux, inconnu ou mal saisi donne toujours la même réponse neutre.'),
  h2('3.3 Entrepôts et agences, contact'),
  p('Les pages publiques listent les entrepôts et les agences actifs (adresses, horaires) et les coordonnées de l’entreprise (e-mail, téléphones, adresse). Elles se règlent dans l’administration.'),
  pageBreak(),
);

// ------------------------------------------------------------------------------------------------
add(
  h1('4. L’espace client'),
  h2('4.1 Mon adresse de réception'),
  p('Pour chaque mode de transport (aérien, maritime), le client dispose d’une **adresse de réception à l’étranger** qui contient son **code client**. C’est l’adresse à donner aux boutiques en ligne. Le code client permet de reconnaître le colis à son arrivée.'),
  h2('4.2 Déclarer un achat (préalerte)'),
  p('Avant l’arrivée, le client déclare : la boutique, le numéro de commande, le **numéro de suivi du transporteur** (UPS, USPS, FedEx, DHL, Amazon), l’entrepôt, le mode, le montant et la description. Cela permet de rapprocher le colis dès sa réception. Il peut joindre la facture d’achat (photo ou PDF).'),
  tip('Une préalerte peut être annulée tant que le colis n’est pas arrivé. Elle n’est pas obligatoire, mais elle accélère le traitement.'),
  h2('4.3 Mes colis'),
  p('La liste montre chaque colis avec son statut. Le détail donne les mesures, les frais provisoires, l’historique et, quand c’est possible, le point de retrait. Le client peut filtrer par statut.'),
  h2('4.4 Mes factures et mes paiements'),
  bullet('Les factures émises apparaissent avec leur total, ce qui reste à payer et un **PDF** téléchargeable.'),
  bullet('Le client **déclare** un paiement par **virement bancaire, Zelle ou MonCash** en indiquant le montant et la référence de la transaction. Le paiement ne compte qu’**après vérification par l’équipe**.'),
  bullet('Le paiement en **espèces** se fait à l’agence ou au comptoir ; le reçu est ensuite téléchargeable.'),
  h2('4.5 Retirer un colis : le code de remise'),
  p('Pour retirer un colis, le client génère dans son espace un **code de remise à six chiffres**, valable un temps limité. Il le donne à l’agent avec une pièce d’identité si l’entreprise l’exige. Trop d’essais erronés bloquent le code : il faut en générer un nouveau.'),
  h2('4.6 Bénéficiaires autorisés'),
  p('Le client peut autoriser une autre personne à retirer ses colis : nom, pièce d’identité (type et **quatre derniers caractères seulement**), période de validité. Un bénéficiaire révoqué ou hors période est refusé au retrait.'),
  h2('4.7 Réclamations'),
  p('En cas de problème (colis abîmé, manquant…), le client ouvre une réclamation, joint un message et suit les réponses. L’équipe peut ajouter des notes internes que le client ne voit jamais.'),
  h2('4.8 Notifications et préférences'),
  p('Le client reçoit des notifications dans l’application et par e-mail (colis reçu, facture à payer, prêt pour retrait…). Il choisit les canaux qu’il souhaite ; certains messages importants restent obligatoires.'),
  h2('4.9 Compte professionnel et équipe'),
  p('Un client professionnel peut inviter jusqu’à dix membres : **lecteur** (consulte les colis, factures et réclamations) ou **opérateur** (consulte les colis, déclare des achats, ouvre des réclamations, sans voir l’argent). Seul le propriétaire gère l’équipe.'),
  pageBreak(),
);

// ------------------------------------------------------------------------------------------------
add(
  h1('5. Les rôles : qui voit quoi'),
  p('Chaque personne a un ou plusieurs **rôles**. Un rôle donne des droits, parfois **limités à un entrepôt ou à une agence**. Le serveur contrôle les droits à chaque action : cacher un menu ne suffit jamais.'),
  table(
    ['Rôle', 'Ce qu’il fait'],
    [
      ['**Administrateur de l’entreprise**', 'Accès complet à son entreprise : utilisateurs, rôles, tarifs, réglages, finances.'],
      ['**Responsable logistique**', 'Pilote les lots, les manifestes et le suivi des colis.'],
      ['**Responsable d’entrepôt**', 'Supervise réception, stockage et sorties d’un entrepôt.'],
      ['**Agent de réception**', 'Réceptionne, pèse et enregistre les colis en entrepôt ; peut créer des clients.'],
      ['**Agent de facturation**', 'Établit les factures et enregistre les paiements.'],
      ['**Responsable d’agence**', 'Gère la réception, le retrait et la remise dans son agence.'],
      ['**Agent de service client**', 'Répond aux clients, traite les réclamations ; ne manipule pas d’argent.'],
      ['**Comptable**', 'Lit factures, paiements et rapports ; voit les coûts ; saisit dépenses, petite caisse, dépôts, référents ; consulte le profit.'],
      ['**Partenaire (site à l’étranger)**', 'Reçoit, pèse et enregistre les colis de **son** entrepôt et crée des clients ; ne voit ni coûts, ni finances, ni les autres sites.'],
      ['**Auditeur (lecture seule)**', 'Lit les données et le journal d’audit, sans rien modifier.'],
      ['**Livreur**', 'Rôle prévu pour les tournées ; masqué car il n’y a pas de livraison à domicile.'],
      ['**Client individuel / professionnel**', 'Accède uniquement à ses propres données. Le professionnel gère une équipe.'],
      ['**Équipe : lecteur / opérateur**', 'Membres du compte d’un client professionnel (droits limités).'],
      ['**Super administrateur**', 'Équipe de la plateforme : crée et suspend les entreprises. Pas d’accès aux données métier.'],
    ],
    [3000, 6026],
  ),
  gap(),
  warn('Les **coûts d’achat, la marge, le profit, les dépenses, la petite caisse, les dépôts et les référents** sont réservés à l’administration et à la comptabilité. Un client, un agent de facturation ou un partenaire ne les voit jamais.'),
  pageBreak(),
);

// ------------------------------------------------------------------------------------------------
add(
  h1('6. Le panel du personnel : le menu'),
  p('Le menu se construit selon vos droits : une entrée absente signifie que vous n’y avez pas accès.'),
  table(
    ['Groupe', 'Entrées', 'Usage'],
    [
      ['**Vue d’ensemble**', 'Accueil, Tableau de bord', 'Indicateurs sur une période (colis, factures, paiements, délais).'],
      ['**Opérations**', 'Comptoir, Réception, Colis, Retards, Proforma, Frais CONATEL, Grilles tarifaires, Entrepôt, Lots, Agence, Réclamations', 'Le travail quotidien sur les colis.'],
      ['**Finance**', 'Factures, Paiements, Profit, Dépenses, Petite caisse, Dépôts bancaires, Référents', 'Argent, caisses et gestion.'],
      ['**Communication**', 'Notifications', 'Journal d’envoi, relances et modèles de messages.'],
      ['**Administration**', 'Paramètres, Utilisateurs, Rôles, Journal d’audit', 'Réglages de base, comptes, droits et traçabilité.'],
      ['**Plateforme**', 'Entreprises', 'Réservé au super administrateur.'],
    ],
    [1900, 3700, 3426],
  ),
  pageBreak(),
);

// ------------------------------------------------------------------------------------------------
add(
  h1('7. Le parcours d’un colis : les statuts'),
  table(
    ['Statut', 'Signification', 'Qui le fait avancer'],
    [
      ['Préalerte enregistrée', 'Le client a déclaré un achat.', 'Client'],
      ['En attente de réception', 'Le colis est attendu à l’entrepôt.', 'Système'],
      ['Reçu à l’entrepôt', 'Le colis est arrivé et scanné.', 'Réception'],
      ['En cours de vérification', 'Contrôle du contenu et de l’état.', 'Réception'],
      ['Enregistré et pesé', 'Mesures prises, prix calculé.', 'Réception'],
      ['En attente de paiement', 'Facture émise ; le colis attend le paiement avant de partir (selon la règle).', 'Facturation'],
      ['Prêt pour expédition', 'Peut être mis dans un lot.', 'Facturation / paiement'],
      ['En transit', 'Parti dans un lot.', 'Logistique'],
      ['Arrivé dans le pays de destination', 'Le lot est arrivé en Haïti.', 'Logistique'],
      ['En cours de traitement douanier', 'Passage en douane.', 'Logistique'],
      ['Reçu dans l’agence de destination', 'Le colis est dans l’agence.', 'Agence'],
      ['Prêt pour retrait', 'Le client peut venir le chercher.', 'Agence'],
      ['Livré', 'Le colis a été **remis** (retrait à l’agence ou au comptoir).', 'Agence / comptoir'],
      ['Retenu', 'Mis de côté après une anomalie (contenu suspect, dommage, document manquant…).', 'Selon le droit'],
      ['Retourné / Annulé', 'Fin de vie particulière du colis.', 'Selon le droit'],
    ],
    [2500, 4626, 1900],
  ),
  gap(),
  tip('« En cours de livraison » existe dans le système mais **n’est pas utilisé** : il n’y a pas de livraison à domicile.'),
  gap(),
  p('Chaque changement de statut est **enregistré avec son auteur, sa date et son motif** et ne peut pas être effacé. Certains événements sont publics (visibles dans le suivi), d’autres internes.'),
  pageBreak(),
);

// ------------------------------------------------------------------------------------------------
add(
  h1('8. Au comptoir : clients et colis'),
  p('L’écran **Comptoir** sert à enregistrer un colis déposé par un client, qu’il ait un compte ou non.'),
  h2('8.1 Choisir ou créer le client'),
  step('Cherchez le client par nom, code, téléphone ou e-mail.'),
  step('S’il n’existe pas, cliquez sur **Nouveau client** : prénom, nom, raison sociale (facultative), téléphone (format international, par exemple +50937000000) et **e-mail facultatif**.'),
  step('**Sans e-mail**, le client est créé « **sans accès au site** » : il a un code client et ses colis sont suivis au comptoir, mais il ne peut pas se connecter et ne reçoit aucun e-mail.'),
  step('Pour lui donner accès plus tard, utilisez **Envoyer l’invitation** avec son e-mail : il reçoit un lien d’activation.'),
  p('Une fois le client choisi, l’écran indique le nombre de **colis ouverts** (son « flot »).'),
  h2('8.2 Enregistrer le colis'),
  bullet('**Entrepôt** (si vous en avez plusieurs) et **mode** (aérien ou maritime).'),
  bullet('**Destinataire** : nom (obligatoire), téléphone et ville. L’expéditeur est le client ; le destinataire peut être une autre personne.'),
  bullet('**Pays de destination** (Haïti par défaut ; États-Unis pour un envoi Haïti → étranger depuis un entrepôt situé en Haïti) et **agence de retrait**.'),
  bullet('**Contenu** et **ancien numéro de suivi** (si le colis portait déjà un numéro dans l’ancien outil).'),
  p('Le colis naît « **Reçu à l’entrepôt** ». La pesée et la facturation suivent le parcours habituel.'),
  h2('8.3 Prévenir par WhatsApp ou SMS'),
  p('Sur la fiche d’un colis qui a un destinataire avec téléphone, les boutons **WhatsApp** et **SMS** ouvrent une conversation avec un message déjà rempli (numéro de suivi et statut). C’est vous qui envoyez le message ; aucun service payant n’est nécessaire.'),
  pageBreak(),
);

// ------------------------------------------------------------------------------------------------
add(
  h1('9. Réception en entrepôt'),
  h2('9.1 Scanner les colis'),
  p('L’écran **Réception** sert à lire (scanner ou saisir) le code de chaque colis arrivé. Choisissez l’entrepôt, scannez, et le résultat s’affiche : **Reçu**, **Déjà reçu** ou **Non identifié**. Relire un code ne crée jamais de doublon.'),
  h2('9.2 Que se passe-t-il à la lecture ?'),
  bullet('Si le **numéro du transporteur** correspond exactement à **une seule préalerte**, le colis est rapproché automatiquement.'),
  bullet('Si le **code client** désigne un seul colis attendu, il est rapproché aussi.'),
  bullet('S’il y a **plusieurs candidats**, le système demande de choisir (aucune erreur silencieuse).'),
  bullet('Sinon, un colis est créé : **identifié** s’il porte un code client, **non identifié** sinon. Il faudra l’identifier avant de le peser.'),
  h2('9.3 Colis non identifié'),
  p('Depuis la fiche du colis, saisissez le **code client** pour l’attribuer. Si une préalerte existe déjà pour ce client, on peut fusionner. Un colis retenu pour anomalie (dommage, contenu suspect…) reste visible dans l’écran **Entrepôt**.'),
  h2('9.4 Quand internet coupe (mode hors ligne)'),
  p('Si la connexion tombe, **continuez à scanner** : chaque lecture est gardée sur l’appareil et marquée « En attente de connexion ». Un bandeau indique le nombre de lectures en attente.'),
  bullet('Au retour d’internet, elles sont **envoyées automatiquement**, ou avec le bouton **Synchroniser**.'),
  bullet('Elles sont rejouées dans l’ordre et **sans doublon**.'),
  bullet('Une lecture refusée par le serveur (code inconnu, droit manquant) passe dans la liste « Lectures refusées au rejeu » : à traiter à la main, puis « Effacer la liste ».'),
  warn('Seule la **réception par lecture de code** fonctionne hors ligne. Ne fermez pas l’appareil ni ne videz les données du navigateur tant que des lectures sont en attente.'),
  h2('9.5 Rangement'),
  p('L’écran **Entrepôt** montre l’inventaire, les emplacements (zones, étagères, bacs) et les anomalies. On peut ranger un colis dans un emplacement depuis sa fiche.'),
  pageBreak(),
);

// ------------------------------------------------------------------------------------------------
add(
  h1('10. Pesée et calcul du prix'),
  h2('10.1 Peser et mesurer'),
  p('Sur la fiche du colis, cliquez sur la pesée : poids, dimensions, unités (livres et pouces, ou kilos et centimètres), contenu, valeur déclarée, assurance éventuelle, **quantité** (boîtes ou barils identiques) et **catégorie** (par exemple « Baril »). Le système calcule le prix **à partir des mesures réelles et de la grille active** ; jamais un prix inventé.'),
  p('Le colis passe à « Enregistré et pesé ». Si aucune grille ne s’applique, le colis est tout de même enregistré, mais **sans prix** : il faudra saisir le fret à la facturation.'),
  h2('10.2 Les grilles tarifaires'),
  p('Une **grille** couvre un mode (aérien ou maritime) et un trajet (pays d’origine → destination). Elle contient des **tranches**. Chaque tranche se calcule sur l’une de ces bases :'),
  table(
    ['Base', 'Comment ça se calcule', 'Exemple'],
    [
      ['**Poids**', 'Poids facturable × prix par unité de poids. Poids facturable = le plus grand du poids réel et du poids volumétrique.', 'Aérien à 5 $ la livre ; 30 lb → 150 $'],
      ['**Volume**', 'Volume en pieds cubes × prix par pied cube (L × l × H ÷ 1 728, multiplié par la quantité).', 'Maritime à 18 $ le pi³ ; 24 × 18 × 16 po = 4 pi³ → 72 $'],
      ['**Unité**', 'Quantité × prix unitaire.', 'Baril à 220 $ ; 2 barils → 440 $'],
    ],
    [1500, 4500, 3026],
  ),
  gap(),
  bullet('Un **diviseur volumétrique propre à la tranche** permet un cas particulier (132 pour l’e-conteneur, 166 pour une boîte).'),
  bullet('Des **suppléments** (manutention, assurance, taxes) peuvent s’ajouter.'),
  bullet('Une grille **active ne se modifie plus** : on la **duplique** pour créer une nouvelle version, puis on active la nouvelle.'),
  bullet('La page **Grilles tarifaires** permet de lister, créer (en brouillon), activer, retirer et dupliquer les grilles ; la création demande le droit de gérer les tarifs.'),
  h2('10.3 Frais CONATEL'),
  p('Pour certains articles électroniques (iPhone, télévision, ordinateur, drone, émetteur…), l’organisme CONATEL perçoit des frais.'),
  bullet('La page **Frais CONATEL** contient la table des articles : prix normal et prix VIP, pourcentage de la valeur, prix par watt, ou « à confirmer ». Les 21 articles de départ se chargent d’un clic (à faire contrôler).'),
  bullet('Sur la fiche du colis, la carte **Frais CONATEL** permet d’ajouter un article avec sa quantité (et sa valeur ou sa puissance si nécessaire). Le montant est **calculé et figé**.'),
  bullet('Un article « à confirmer » est **refusé** tant que son prix n’est pas fixé dans la table.'),
  bullet('Sur la facture, ces frais forment des **lignes distinctes** (« CONATEL »). Ils sont **reversés** : aucune remise en pourcentage ne les touche et ils sont **hors marge**.'),
  h2('10.4 Prix convenu'),
  p('Avec le droit **Fixer à la main le prix d’un colis** (administrateur), on peut remplacer le tarif calculé par un **prix convenu** au moment de la facturation. Le **motif est obligatoire**, l’écart est enregistré dans le journal, et la facture affiche « Prix convenu ».'),
  h2('10.5 Taux en gourdes'),
  p('L’entreprise règle un **taux** (gourdes pour 1 dollar) avec historique. Il sert **uniquement à afficher un équivalent indicatif** (factures, reçus, calculateur, frais d’un colis). Une facture reste toujours dans **une seule devise** : aucune conversion comptable.'),
  pageBreak(),
);

// ------------------------------------------------------------------------------------------------
add(
  h1('11. Proforma'),
  p('Une **proforma** est une estimation chiffrée pour un client, **valable un certain nombre de jours**, que l’on peut imprimer. Ce n’est pas une facture.'),
  step('Ouvrez **Proforma**, choisissez le client, le mode, les pays, le poids, les dimensions, la quantité et la catégorie, puis la durée de validité (30 jours par défaut).'),
  step('Le prix vient de la **grille active** et est **figé** (numéro PF-AAAA-NNNNNN). Sans tarif applicable, la création est refusée.'),
  step('Téléchargez le **PDF** pour le remettre au client.'),
  step('Si le client accepte, **Transformer en colis** : indiquez le destinataire ; un colis de comptoir est créé. Une proforma **périmée** ou **déjà transformée** est refusée.'),
  pageBreak(),
);

// ------------------------------------------------------------------------------------------------
add(
  h1('12. Facturation'),
  h2('12.1 Créer une facture'),
  step('Ouvrez **Factures → Nouveau brouillon**, cherchez le client, cochez ses colis **pesés** (un colis n’est facturé qu’**une seule fois**).'),
  step('Au besoin, ajoutez des **lignes supplémentaires** (par exemple un fret saisi à la main pour un colis sans tarif).'),
  step('Appliquez une **remise** en pourcentage (droit « Appliquer une remise » ; plafonnée par l’entreprise, 10 % par défaut).'),
  step('Pour un colis précis : **rabais par baril** (colis facturés à l’unité) ou **prix convenu avec motif** (droit réservé), dans « Ajustements par colis ».'),
  step('Enregistrez le brouillon, vérifiez, puis **émettez** la facture.'),
  h2('12.2 Après l’émission'),
  bullet('La facture reçoit un **numéro sans trou** (INV-AAAA-NNNNNN) et **ne peut plus être modifiée**.'),
  bullet('Une erreur se corrige par une **annulation motivée** (si aucun paiement) ou par un **avoir** (CN-…).'),
  bullet('Un **PDF** est disponible pour le client et pour le personnel.'),
  bullet('Une facture entièrement payée libère ses colis (« Prêt pour expédition »).'),
  h2('12.3 La règle de paiement de l’entreprise'),
  p('Elle se choisit à la création de l’entreprise et peut être **l’une, l’autre ou les deux à la fois** :'),
  table(
    ['Règle', 'Effet'],
    [
      ['**Payer avant l’expédition**', 'Après l’émission, le colis passe en « En attente de paiement » et ne part qu’une fois la facture payée.'],
      ['**Payer avant la remise**', 'Le colis est « Prêt pour expédition » dès l’émission ; c’est la **remise** qui est bloquée tant que le colis n’est pas facturé et soldé.'],
      ['**Les deux à la fois**', 'Le colis attend le paiement avant de partir **et** la remise reste bloquée tant que le colis n’est pas facturé et soldé.'],
    ],
    [3000, 6026],
  ),
  gap(),
  p('Dans tous les cas, un **solde dû** bloque la remise. Une personne autorisée peut la débloquer par une **dérogation avec motif**, tracée dans le journal.'),
  pageBreak(),
);

// ------------------------------------------------------------------------------------------------
add(
  h1('13. Paiements et caisse'),
  h2('13.1 Modes de paiement'),
  table(
    ['Mode', 'Comment ça se passe'],
    [
      ['**Espèces**', 'Enregistré par le personnel dans la caisse ouverte de la devise de la facture. Un reçu (RC-…) est émis.'],
      ['**Virement bancaire, Zelle, MonCash**', 'Le client **déclare** son paiement avec la référence. L’équipe le **valide ou le refuse** (motif) après vérification. Tant qu’il n’est pas validé, il est « en attente » et la facture n’est pas marquée payée.'],
    ],
    [3000, 6026],
  ),
  gap(),
  h2('13.2 Valider un paiement déclaré'),
  step('Ouvrez **Paiements** : la liste des paiements en attente affiche le mode, la référence, le client et la facture.'),
  step('Vérifiez la transaction dans votre banque, Zelle ou MonCash.'),
  step('**Confirmez** (la facture est mise à jour) ou **refusez** avec un motif.'),
  h2('13.3 Remboursement et avoir'),
  bullet('Un **remboursement** se fait sur un paiement confirmé, avec motif ; il ne dépasse jamais ce qui a été payé.'),
  bullet('Un **avoir** réduit une facture émise ; il est limité à ce qui n’est ni encaissé ni en attente.'),
  h2('13.4 La caisse (espèces)'),
  p('Une **caisse** est propre à une **agence** et à **une devise** : jamais des dollars additionnés à des gourdes. Une agence qui encaisse deux devises ouvre deux caisses.'),
  step('**Ouvrir** la caisse avec le fonds de départ.'),
  step('Les encaissements en espèces entrent automatiquement dans la caisse de la bonne devise.'),
  step('**Clôturer** : on saisit le montant compté ; le système calcule l’attendu (fonds + espèces − remboursements) et **l’écart**. Une caisse clôturée **ne change plus**.'),
  pageBreak(),
);

// ------------------------------------------------------------------------------------------------
add(
  h1('14. Expédition : les lots'),
  p('L’écran **Lots** organise les départs.'),
  step('**Créer un lot** (entrepôt d’origine, mode). Sa référence est de la forme ENTREPÔT-MODE-DATE-n.'),
  step('**Ajouter des colis prêts pour expédition** ; un colis n’est que dans un lot à la fois.'),
  step('**Expédier** le lot : les colis passent « En transit ». Le **manifeste** (PDF) liste le contenu.'),
  step('À l’arrivée en Haïti : **Arrivé**, puis **En douane** si besoin.'),
  step('À l’agence, **réceptionnez** les colis du lot : chaque colis passe « Reçu dans l’agence », puis « Prêt pour retrait ». Un colis manquant ou abîmé est signalé à ce moment.'),
  p('Statuts d’un lot : Ouvert, Expédié, Arrivé, En douane, Clôturé, Annulé.'),
  pageBreak(),
);

// ------------------------------------------------------------------------------------------------
add(
  h1('15. Remise du colis'),
  p('La remise se fait **à l’agence ou au comptoir**, depuis la fiche du colis (ou l’écran Agence).'),
  h2('15.1 Qui peut retirer ?'),
  table(
    ['Personne', 'Contrôles'],
    [
      ['**Le client**', 'Code de remise à six chiffres (si exigé), pièce d’identité (type et quatre derniers caractères), photo de preuve (si exigée).'],
      ['**Un bénéficiaire autorisé**', 'Même chose, plus le contrôle que la personne est bien un bénéficiaire valide (non révoqué, dans ses dates, pièce concordante).'],
      ['**Le destinataire inscrit sur le colis** (colis de comptoir)', 'Le nom doit **correspondre exactement** au destinataire du colis ; pas de code client demandé ; pièce d’identité et solde contrôlés comme pour les autres.'],
    ],
    [3300, 5726],
  ),
  gap(),
  h2('15.2 Les règles de remise de l’entreprise'),
  p('L’entreprise décide si elle exige le **code de remise**, la **pièce d’identité** et la **photo de preuve**. Ces règles s’appliquent à toute remise.'),
  h2('15.3 Étapes'),
  step('Ouvrez la fiche du colis « Prêt pour retrait ».'),
  step('Choisissez **qui retire** (client, bénéficiaire ou destinataire inscrit) et renseignez les preuves.'),
  step('Si un **solde est dû**, la remise est bloquée ; une personne autorisée peut la débloquer par une dérogation motivée.'),
  step('Confirmez : le colis passe « Livré » (remis) ; la remise est tracée (qui, quand, quelles preuves).'),
  warn('Un code de remise erroné est compté ; après plusieurs essais le code est bloqué. Ne jamais contourner une preuve exigée sans dérogation tracée.'),
  pageBreak(),
);

// ------------------------------------------------------------------------------------------------
add(
  h1('16. Réclamations et incidents'),
  h2('16.1 Traiter une réclamation'),
  bullet('La liste se filtre par état (Ouverte, En cours, Résolue, Rejetée) et par recherche.'),
  bullet('Dans le détail : **répondre** au client, ajouter une **note interne** (jamais visible du client), **affecter** la réclamation à un agent, **changer l’état**.'),
  bullet('Clôturer (résolue ou rejetée) exige une **résolution** écrite.'),
  h2('16.2 Indemnisation (réservé à la comptabilité et à l’administration)'),
  p('Sur la réclamation, la carte **Indemnisation de l’incident** enregistre :'),
  bullet('l’**indemnité payée au client** ;'),
  bullet('le **remboursement obtenu du transporteur** ;'),
  bullet('la devise et la **date de paiement**.'),
  p('Le **net** (indemnité − remboursement) est déduit du profit du **mois de paiement**. Le client ne le voit jamais.'),
  pageBreak(),
);

// ------------------------------------------------------------------------------------------------
add(
  h1('17. Gestion financière interne'),
  p('Ces écrans sont réservés à l’**administration** et à la **comptabilité**.'),
  h2('17.1 Coûts d’achat'),
  p('Dans **Grilles tarifaires**, une tranche peut porter un **coût d’achat par unité** (par livre, par pied cube ou par baril). Il est **figé sur le colis à la pesée** : modifier le tarif plus tard ne réécrit pas l’histoire. Il n’apparaît jamais dans une estimation, une grille consultée par d’autres, ni chez le client.'),
  h2('17.2 Dépenses'),
  p('L’écran **Dépenses** saisit les frais de l’entreprise (loyer, électricité, transport, fret et douane, marketing, salaires, fournitures, autre) avec la date, le montant et la devise. Chaque correction ou suppression est **journalisée**.'),
  h2('17.3 Petite caisse'),
  bullet('Écritures **d’approvisionnement** et de **dépense**, par devise, avec un numéro PC-AAAA-NNNNNN.'),
  bullet('Une écriture **ne se modifie pas** : une erreur se corrige par une écriture inverse.'),
  bullet('Une dépense **ne peut pas dépasser le solde** de sa devise.'),
  bullet('Un **seuil d’alerte** par devise signale un solde bas ; un **rapport du jour** résume entrées, sorties et solde.'),
  h2('17.4 Dépôts bancaires'),
  step('Quand des caisses sont clôturées, l’écran **Dépôts bancaires** affiche le **reste à déposer** par devise.'),
  step('Cochez les caisses déposées (une seule devise par dépôt), indiquez la banque, les **quatre derniers caractères** du compte, la référence du bordereau et le montant déposé.'),
  step('Le système calcule **l’attendu** (compté − fonds de caisse) et **l’écart** (déposé − attendu), figés.'),
  step('Téléchargez le **bordereau PDF**. Une caisse ne se dépose qu’une fois.'),
  h2('17.5 Référents et commissions'),
  p('Un **référent** est une personne qui amène des clients. Il touche un **pourcentage du profit** de ces clients.'),
  bullet('Créez le référent (nom, pourcentage) et **rattachez** ses clients.'),
  bullet('Le **relevé du mois** montre clients, nouveaux clients, colis facturés, chiffre d’affaires, coût, profit et **commission** (jamais négative).'),
  bullet('**Payer la commission** : une seule fois par mois et par référent ; le montant est figé.'),
  h2('17.6 Profit mensuel'),
  p('L’écran **Profit** présente les douze derniers mois :'),
  table(
    ['Ligne', 'Calcul'],
    [
      ['Chiffre d’affaires', 'Lignes des factures émises, **hors frais CONATEL et taxes**.'],
      ['Coût d’achat', 'Coût figé à la pesée des colis facturés.'],
      ['**Marge**', 'Chiffre d’affaires − coût d’achat (détail aérien / maritime).'],
      ['Dépenses', 'Dépenses du mois (les gourdes sont converties au taux courant, signalé).'],
      ['Commissions', 'Commissions des référents du mois.'],
      ['Incidents', 'Indemnités − remboursements du transporteur, au mois de paiement.'],
      ['**Profit net**', 'Marge − dépenses − commissions − incidents.'],
      ['Frais CONATEL reversés', 'Affichés à part : hors marge.'],
    ],
    [2800, 6226],
  ),
  gap(),
  tip('Exemple : un colis aérien de 30 lb facturé 150 $ avec un coût de 117 $ donne une marge de 33 $. Avec 10 % de commission au référent (3,30 $) et 3 $ d’incident, le net est 26,70 $. Les avoirs ne sont pas déduits dans ce calcul.'),
  pageBreak(),
);

// ------------------------------------------------------------------------------------------------
add(
  h1('18. Notifications et messages'),
  bullet('À chaque événement (colis reçu, facture à payer, prêt pour retrait…), le système crée des notifications **dans l’application** et **par e-mail**, selon les préférences du client.'),
  bullet('Un **client sans e-mail** (créé au comptoir) ne reçoit **aucun e-mail** : la notification est marquée « Pas d’adresse e-mail ». Utilisez les boutons WhatsApp ou SMS.'),
  bullet('Le canal WhatsApp automatique n’est pas configuré : les envois WhatsApp se font **à la main** par lien.'),
  bullet('L’écran **Notifications** montre le journal, permet de **relancer** un envoi en échec et de **modifier les modèles** de messages (sujet et texte, par langue).'),
  bullet('Un message qui échoue est **réessayé** plusieurs fois avant d’être déclaré en échec.'),
  pageBreak(),
);

// ------------------------------------------------------------------------------------------------
add(
  h1('19. Administration'),
  h2('19.1 Utilisateurs'),
  bullet('**Inviter** une personne : e-mail, nom, rôle et portée (toute l’entreprise, un entrepôt ou une agence).'),
  bullet('**Désactiver** un compte (ses sessions sont fermées), **ajouter ou retirer un rôle**, **réinitialiser la double authentification**.'),
  bullet('On ne peut donner que des droits que l’on détient soi-même.'),
  h2('19.2 Rôles personnalisés'),
  p('L’administrateur peut créer ses propres rôles : un nom, des droits choisis, et une portée unique. Les rôles du système ne se modifient pas.'),
  h2('19.3 Paramètres de l’entreprise (écran « Paramètres »)'),
  p('Tout le réglage de base se fait **dans le panel**, sans script : menu **Administration → Paramètres**. Chaque section s’enregistre séparément.'),
  bullet('**Valeurs de départ** : un bouton crée en une fois les coordonnées (si vides), les entrepôts de Miami et de Philadelphie, l’agence de Pétion-Ville, les catégories, les grilles aérienne et maritime, le taux et la table CONATEL. Ce qui existe déjà n’est jamais modifié : on peut le relancer sans risque.'),
  bullet('**Coordonnées publiques** : e-mail, téléphones (format international), WhatsApp, horaires, adresse.'),
  bullet('**Entrepôts** : référence, nom, pays (code à 2 lettres), ville, adresse et **modèle d’adresse du client** (une ligne par ligne ; variables {customerName}, {customerCode}, {mode} ; {customerCode} obligatoire). On peut modifier, désactiver et réactiver.'),
  bullet('**Agences et points de retrait** : code, nom, type, adresse, téléphone, horaires, affichage public.'),
  bullet('**Catégories de marchandises** : code, nom en trois langues, restriction (une catégorie restreinte est exclue du calculateur public).'),
  bullet('**Taux gourdes/dollar** avec historique ; **seuils d’alerte** de la petite caisse.'),
  p('Les **tarifs** (Grilles tarifaires) et la **table CONATEL** ont leurs propres écrans, accessibles depuis les raccourcis de la page. Les **règles de remise** (code, pièce d’identité, photo) se règlent dans leur écran dédié.'),
  h2('19.4 Journal d’audit'),
  p('Toute action sensible est enregistrée : qui, quoi, quand, avant et après (création de facture, prix convenu, remboursement, dépôt, commission…). Le journal est en lecture seule et se filtre par action et par période.'),
  h2('19.5 Entreprises (super administrateur)'),
  p('Le super administrateur crée une entreprise (nom, identifiant, préfixes de suivi et de codes client, devise, langue, **règle de paiement**) et son premier administrateur, ou la **suspend** en deux temps (les utilisateurs sont déconnectés).'),
  pageBreak(),
);

// ------------------------------------------------------------------------------------------------
add(
  h1('20. Sécurité et bonnes pratiques'),
  bullet('**Ne partagez jamais votre mot de passe** ni vos codes de secours ; chaque personne a son compte.'),
  bullet('Déconnectez-vous sur un poste partagé.'),
  bullet('Les **codes de remise** et les **numéros de pièce complets** ne sont jamais conservés : seuls les quatre derniers caractères le sont.'),
  bullet('**Une facture émise ne se modifie pas** ; **une caisse clôturée, un dépôt, une écriture de petite caisse non plus** : on corrige par une écriture inverse ou un avoir.'),
  bullet('Les données de chaque entreprise sont **cloisonnées** au niveau de la base : une entreprise ne peut pas lire celles d’une autre.'),
  bullet('Faites relire les **dérogations** (remise malgré solde, prix convenu) dans le journal d’audit.'),
  bullet('Vérifiez chaque jour que le **reste à déposer** et le solde de la petite caisse correspondent à la réalité.'),
  pageBreak(),
);

// ------------------------------------------------------------------------------------------------
add(
  h1('21. Mise en route et reprise de l’ancien outil'),
  h2('21.1 Mettre en place les données de base'),
  p('Ouvrez **Administration → Paramètres** et cliquez sur **Appliquer les valeurs de départ** : coordonnées, entrepôts (Miami, Philadelphie), agence de Pétion-Ville, catégories (e-conteneur, baril), grilles aérienne et maritime, taux et table CONATEL sont créés. Ce qui existe déjà n’est jamais modifié, donc le bouton peut être relancé sans risque. Ajustez ensuite chaque élément à la main dans les sections de la même page. Voir aussi le document SETUP_COMPANY.'),
  h2('21.2 Reprendre les données de l’ancien outil de gestion'),
  step('Exportez les données du prototype dans un fichier.'),
  step('Lancez la **simulation** : elle ne modifie rien et produit un **rapport** (clients et colis retenus, anomalies, soldes ouverts).'),
  step('Corrigez les anomalies (téléphones, doublons, statuts, colis sans mesures…) et relancez la simulation.'),
  step('Lancez l’**import réel** dans une entreprise **sans colis**. Les clients arrivent **sans accès**, les colis gardent leur statut et leur ancien code.'),
  step('Comparez les chiffres (nombre de clients, colis par statut, soldes ouverts) avec l’ancien outil.'),
  warn('Les **utilisateurs et leurs PIN ne sont jamais importés** : recréez les comptes par invitation. Les paiements et factures historiques ne sont pas importés ; les **soldes ouverts** se réémettent par une facture de reprise.'),
  h2('21.3 Période de pilote'),
  p('Commencez avec un seul agent et quelques colis réels, gardez l’ancien outil en **lecture seule** pour comparer les totaux chaque jour, puis élargissez. Le guide MISE_EN_PRODUCTION détaille les étapes.'),
  pageBreak(),
);

// ------------------------------------------------------------------------------------------------
add(
  h1('22. Questions fréquentes'),
  table(
    ['Question', 'Réponse'],
    [
      ['Un client n’a pas d’e-mail : peut-on quand même enregistrer ses colis ?', 'Oui. Créez-le au comptoir **sans e-mail** ; il aura un code client. Invitez-le plus tard s’il veut un accès.'],
      ['Je ne retrouve pas un colis reçu.', 'Cherchez par numéro de suivi, numéro du transporteur ou code client dans **Colis** ; pour un colis importé, cherchez l’ancien code. Regardez aussi les colis **non identifiés** et les **retards**.'],
      ['La facture contient une erreur.', 'Une facture émise ne se modifie pas. **Annulez-la** avec un motif (si aucun paiement) ou émettez un **avoir**, puis refaites une facture.'],
      ['Le client a payé par Zelle mais la facture n’est pas payée.', 'Le paiement déclaré doit être **validé** dans l’écran Paiements après vérification de la référence.'],
      ['La remise est bloquée.', 'Un solde est dû, le colis n’est pas facturé (selon la règle) ou une preuve manque. Faites payer, ou, si vous en avez le droit, utilisez la **dérogation motivée**.'],
      ['Pourquoi ce colis n’a pas de prix ?', 'Aucune grille active ne couvre ce trajet ou ce poids. Activez la bonne grille ou saisissez le fret à la facturation.'],
      ['L’écart de caisse n’est pas nul.', 'Recomptez ; l’écart est conservé à la clôture et visible au dépôt (déposé − attendu). Une explication doit figurer dans la note.'],
      ['Je ne vois pas « Profit » ou « Dépenses ».', 'Ces écrans exigent des droits de comptabilité ou d’administration. Demandez à un administrateur.'],
      ['Je ne peux plus me connecter après avoir changé de téléphone.', 'Utilisez un **code de secours**, sinon demandez à un administrateur de **réinitialiser la double authentification**.'],
      ['Internet coupe pendant la réception.', 'Continuez à scanner : les lectures sont envoyées au retour d’internet (chapitre 9.4).'],
      ['Faut-il toujours exiger la pièce d’identité ?', 'C’est une règle de l’entreprise. Elle s’applique à toutes les remises ; le détail est dans les règles de remise.'],
    ],
    [3300, 5726],
  ),
  gap(),
  h1('Annexe A : Résumé des droits sensibles'),
  table(
    ['Droit', 'Ce qu’il permet', 'Qui l’a (par défaut)'],
    [
      ['Appliquer une remise', 'Remise en pourcentage ou rabais par baril, dans le plafond de l’entreprise.', 'Facturation, administrateur'],
      ['Fixer à la main le prix d’un colis', 'Prix convenu avec motif obligatoire.', 'Administrateur'],
      ['Autoriser une remise malgré un solde', 'Dérogation motivée, tracée.', 'Responsable d’agence, administrateur'],
      ['Voir les coûts et marges', 'Coûts d’achat, profit.', 'Comptable, administrateur (et auditeur en lecture)'],
      ['Gérer les tarifs', 'Créer et activer des grilles, la table CONATEL.', 'Administrateur'],
      ['Dépôts, petite caisse, dépenses', 'Saisie et consultation.', 'Comptable, administrateur'],
      ['Référents', 'Gestion et paiement des commissions.', 'Comptable, administrateur'],
      ['Indemnisation des incidents', 'Indemnité et remboursement du transporteur.', 'Comptable, administrateur'],
    ],
    [2700, 3700, 2626],
  ),
  gap(),
  p('Les droits exacts de chaque rôle figurent dans le document ROLE_MATRIX (matrice des rôles et des routes), générée et vérifiée automatiquement.'),
);

// ------------------------------------------------------------------------------------------------
const doc = new Document({
  creator: 'B2C Shipping Express',
  title: 'Guide utilisateur — B2C Shipping Express',
  description: 'Guide utilisateur complet de la plateforme',
  styles: {
    default: { document: { run: { font: FONT, size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 34, bold: true, color: BLUE }, paragraph: { spacing: { before: 120, after: 200 }, keepNext: true, outlineLevel: 0, border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: BLUE, space: 4 } } } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 26, bold: true, color: '2E74B5' }, paragraph: { spacing: { before: 280, after: 120 }, keepNext: true, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 23, bold: true, color: '404040' }, paragraph: { spacing: { before: 200, after: 80 }, keepNext: true, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [
      { reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } }, { level: 1, format: LevelFormat.BULLET, text: '–', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1080, hanging: 270 } } } }] },
      { reference: 'steps', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
    ],
  },
  sections: [
    {
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, right: 1440, bottom: 1300, left: 1440 } } },
      headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF', space: 4 } }, children: [run('B2C Shipping Express — Guide utilisateur', { size: 18, color: '7F7F7F' })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [run('Page ', { size: 18, color: '7F7F7F' }), new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 18, color: '7F7F7F' }), run(' / ', { size: 18, color: '7F7F7F' }), new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: 18, color: '7F7F7F' })] })] }) },
      children: body,
    },
  ],
});

Packer.toBuffer(doc).then((buffer) => {
  const out = path.resolve(__dirname, '../GUIDE_UTILISATEUR.docx');
  fs.writeFileSync(out, buffer);
  console.log('Écrit :', out, buffer.length, 'octets');
});
