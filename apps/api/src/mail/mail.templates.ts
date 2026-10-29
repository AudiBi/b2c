import type { Locale } from '@b2c/shared';

export type AuthMailKind = 'verify-email' | 'reset-password' | 'invite' | 'already-registered';

interface Params {
  appName: string;
  firstName: string;
  url?: string;
}

/** Contenu structuré du message HTML (le gabarit visuel est dans mail.layout.ts). */
interface Content {
  title: string;
  paragraphs: string[];
  /** Libellé du bouton d'action (le lien est `url`). */
  button?: string;
  note?: string;
}

interface Template {
  subject: (p: Params) => string;
  /** Version texte brut : sert d'alternative au HTML et de seul contenu aux messageries en texte seul. */
  text: (p: Params) => string;
  content: (p: Params) => Content;
}

// Textes d'authentification uniquement. Les modèles de notification logistique sont configurables en base ;
// le créole ci-dessous doit être relu par un locuteur natif.
const templates: Record<AuthMailKind, Record<Locale, Template>> = {
  'verify-email': {
    fr: {
      subject: (p) => `${p.appName} : confirmez votre adresse e-mail`,
      text: (p) =>
        `Bonjour ${p.firstName},\n\nPour activer votre compte, confirmez votre adresse e-mail :\n${p.url}\n\nCe lien est valable 24 heures. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.`,
      content: (p) => ({
        title: 'Confirmez votre adresse e-mail',
        paragraphs: [`Bonjour ${p.firstName},`, 'Pour activer votre compte, confirmez votre adresse e-mail.'],
        button: 'Confirmer mon adresse',
        note: "Ce lien est valable 24 heures. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.",
      }),
    },
    ht: {
      subject: (p) => `${p.appName} : konfime adrès imèl ou`,
      text: (p) =>
        `Bonjou ${p.firstName},\n\nPou aktive kont ou, klike sou lyen sa a pou konfime adrès imèl ou :\n${p.url}\n\nLyen sa a bon pandan 24 èdtan. Si se pa ou ki fè demann sa a, inyore mesaj sa a.`,
      content: (p) => ({
        title: 'Konfime adrès imèl ou',
        paragraphs: [`Bonjou ${p.firstName},`, 'Pou aktive kont ou, konfime adrès imèl ou.'],
        button: 'Konfime adrès mwen',
        note: 'Lyen sa a bon pandan 24 èdtan. Si se pa ou ki fè demann sa a, inyore mesaj sa a.',
      }),
    },
    en: {
      subject: (p) => `${p.appName}: confirm your email address`,
      text: (p) =>
        `Hello ${p.firstName},\n\nTo activate your account, confirm your email address:\n${p.url}\n\nThis link is valid for 24 hours. If you did not request this, ignore this message.`,
      content: (p) => ({
        title: 'Confirm your email address',
        paragraphs: [`Hello ${p.firstName},`, 'To activate your account, confirm your email address.'],
        button: 'Confirm my address',
        note: 'This link is valid for 24 hours. If you did not request this, ignore this message.',
      }),
    },
  },
  'reset-password': {
    fr: {
      subject: (p) => `${p.appName} : réinitialisation du mot de passe`,
      text: (p) =>
        `Bonjour ${p.firstName},\n\nPour choisir un nouveau mot de passe :\n${p.url}\n\nCe lien est valable 1 heure et ne peut servir qu'une fois. Si vous n'avez rien demandé, ignorez ce message : votre mot de passe reste inchangé.`,
      content: (p) => ({
        title: 'Réinitialisation du mot de passe',
        paragraphs: [`Bonjour ${p.firstName},`, 'Vous avez demandé à choisir un nouveau mot de passe.'],
        button: 'Choisir un nouveau mot de passe',
        note: "Ce lien est valable 1 heure et ne peut servir qu'une fois. Si vous n'avez rien demandé, ignorez ce message : votre mot de passe reste inchangé.",
      }),
    },
    ht: {
      subject: (p) => `${p.appName} : reyinisyalize modpas ou`,
      text: (p) =>
        `Bonjou ${p.firstName},\n\nPou chwazi yon nouvo modpas :\n${p.url}\n\nLyen sa a bon pandan 1 èdtan epi li sèvi yon sèl fwa. Si ou pa mande anyen, inyore mesaj sa a : modpas ou pa chanje.`,
      content: (p) => ({
        title: 'Reyinisyalize modpas ou',
        paragraphs: [`Bonjou ${p.firstName},`, 'Ou mande pou chwazi yon nouvo modpas.'],
        button: 'Chwazi yon nouvo modpas',
        note: 'Lyen sa a bon pandan 1 èdtan epi li sèvi yon sèl fwa. Si ou pa mande anyen, inyore mesaj sa a : modpas ou pa chanje.',
      }),
    },
    en: {
      subject: (p) => `${p.appName}: password reset`,
      text: (p) =>
        `Hello ${p.firstName},\n\nTo choose a new password:\n${p.url}\n\nThis link is valid for 1 hour and can be used once. If you did not ask for this, ignore this message: your password is unchanged.`,
      content: (p) => ({
        title: 'Password reset',
        paragraphs: [`Hello ${p.firstName},`, 'You asked to choose a new password.'],
        button: 'Choose a new password',
        note: 'This link is valid for 1 hour and can be used once. If you did not ask for this, ignore this message: your password is unchanged.',
      }),
    },
  },
  invite: {
    fr: {
      subject: (p) => `${p.appName} : votre compte vous attend`,
      text: (p) =>
        `Bonjour ${p.firstName},\n\nUn compte a été créé pour vous. Choisissez votre mot de passe pour l'activer :\n${p.url}\n\nCe lien est valable 72 heures.`,
      content: (p) => ({
        title: 'Votre compte vous attend',
        paragraphs: [`Bonjour ${p.firstName},`, "Un compte a été créé pour vous. Choisissez votre mot de passe pour l'activer."],
        button: 'Activer mon compte',
        note: 'Ce lien est valable 72 heures.',
      }),
    },
    ht: {
      subject: (p) => `${p.appName} : kont ou ap tann ou`,
      text: (p) =>
        `Bonjou ${p.firstName},\n\nYo kreye yon kont pou ou. Chwazi modpas ou pou aktive l :\n${p.url}\n\nLyen sa a bon pandan 72 èdtan.`,
      content: (p) => ({
        title: 'Kont ou ap tann ou',
        paragraphs: [`Bonjou ${p.firstName},`, 'Yo kreye yon kont pou ou. Chwazi modpas ou pou aktive l.'],
        button: 'Aktive kont mwen',
        note: 'Lyen sa a bon pandan 72 èdtan.',
      }),
    },
    en: {
      subject: (p) => `${p.appName}: your account is ready`,
      text: (p) =>
        `Hello ${p.firstName},\n\nAn account has been created for you. Choose your password to activate it:\n${p.url}\n\nThis link is valid for 72 hours.`,
      content: (p) => ({
        title: 'Your account is ready',
        paragraphs: [`Hello ${p.firstName},`, 'An account has been created for you. Choose your password to activate it.'],
        button: 'Activate my account',
        note: 'This link is valid for 72 hours.',
      }),
    },
  },
  'already-registered': {
    fr: {
      subject: (p) => `${p.appName} : vous avez déjà un compte`,
      text: (p) =>
        `Bonjour ${p.firstName},\n\nQuelqu'un a tenté de créer un compte avec cette adresse, mais un compte existe déjà. Si c'était vous, connectez-vous ou utilisez « mot de passe oublié ». Sinon, ignorez ce message.`,
      content: (p) => ({
        title: 'Vous avez déjà un compte',
        paragraphs: [`Bonjour ${p.firstName},`, "Quelqu'un a tenté de créer un compte avec cette adresse, mais un compte existe déjà. Si c'était vous, connectez-vous ou utilisez « mot de passe oublié »."],
        note: 'Si ce n’était pas vous, ignorez ce message : rien n’a été modifié.',
      }),
    },
    ht: {
      subject: (p) => `${p.appName} : ou gen yon kont deja`,
      text: (p) =>
        `Bonjou ${p.firstName},\n\nYon moun eseye kreye yon kont ak adrès sa a, men yon kont egziste deja. Si se ou, konekte w oswa itilize « bliye modpas ». Si se pa ou, inyore mesaj sa a.`,
      content: (p) => ({
        title: 'Ou gen yon kont deja',
        paragraphs: [`Bonjou ${p.firstName},`, 'Yon moun eseye kreye yon kont ak adrès sa a, men yon kont egziste deja. Si se ou, konekte w oswa itilize « bliye modpas ».'],
        note: 'Si se pa ou, inyore mesaj sa a : anyen pa chanje.',
      }),
    },
    en: {
      subject: (p) => `${p.appName}: you already have an account`,
      text: (p) =>
        `Hello ${p.firstName},\n\nSomeone tried to create an account with this address, but one already exists. If it was you, sign in or use "forgot password". Otherwise, ignore this message.`,
      content: (p) => ({
        title: 'You already have an account',
        paragraphs: [`Hello ${p.firstName},`, 'Someone tried to create an account with this address, but one already exists. If it was you, sign in or use "forgot password".'],
        note: 'If it was not you, ignore this message: nothing was changed.',
      }),
    },
  },
};

export function renderAuthMail(kind: AuthMailKind, locale: Locale, params: Params) {
  const template = templates[kind][locale] ?? templates[kind].fr;
  return { subject: template.subject(params), text: template.text(params), content: template.content(params) };
}
