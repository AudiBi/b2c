import type { Locale } from '@b2c/shared';

export type AuthMailKind = 'verify-email' | 'reset-password' | 'invite' | 'already-registered';

interface Params {
  appName: string;
  firstName: string;
  url?: string;
}

interface Template {
  subject: (p: Params) => string;
  text: (p: Params) => string;
}

// Textes d'authentification uniquement. Les modèles de notification logistique (phase 7) seront
// configurables en base ; le créole ci-dessous doit être relu par un locuteur natif.
const templates: Record<AuthMailKind, Record<Locale, Template>> = {
  'verify-email': {
    fr: {
      subject: (p) => `${p.appName} : confirmez votre adresse e-mail`,
      text: (p) =>
        `Bonjour ${p.firstName},\n\nPour activer votre compte, confirmez votre adresse e-mail :\n${p.url}\n\nCe lien est valable 24 heures. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.`,
    },
    ht: {
      subject: (p) => `${p.appName} : konfime adrès imèl ou`,
      text: (p) =>
        `Bonjou ${p.firstName},\n\nPou aktive kont ou, klike sou lyen sa a pou konfime adrès imèl ou :\n${p.url}\n\nLyen sa a bon pandan 24 èdtan. Si se pa ou ki fè demann sa a, inyore mesaj sa a.`,
    },
    en: {
      subject: (p) => `${p.appName}: confirm your email address`,
      text: (p) =>
        `Hello ${p.firstName},\n\nTo activate your account, confirm your email address:\n${p.url}\n\nThis link is valid for 24 hours. If you did not request this, ignore this message.`,
    },
  },
  'reset-password': {
    fr: {
      subject: (p) => `${p.appName} : réinitialisation du mot de passe`,
      text: (p) =>
        `Bonjour ${p.firstName},\n\nPour choisir un nouveau mot de passe :\n${p.url}\n\nCe lien est valable 1 heure et ne peut servir qu'une fois. Si vous n'avez rien demandé, ignorez ce message : votre mot de passe reste inchangé.`,
    },
    ht: {
      subject: (p) => `${p.appName} : reyinisyalize modpas ou`,
      text: (p) =>
        `Bonjou ${p.firstName},\n\nPou chwazi yon nouvo modpas :\n${p.url}\n\nLyen sa a bon pandan 1 èdtan epi li sèvi yon sèl fwa. Si ou pa mande anyen, inyore mesaj sa a : modpas ou pa chanje.`,
    },
    en: {
      subject: (p) => `${p.appName}: password reset`,
      text: (p) =>
        `Hello ${p.firstName},\n\nTo choose a new password:\n${p.url}\n\nThis link is valid for 1 hour and can be used once. If you did not ask for this, ignore this message: your password is unchanged.`,
    },
  },
  invite: {
    fr: {
      subject: (p) => `${p.appName} : votre compte vous attend`,
      text: (p) =>
        `Bonjour ${p.firstName},\n\nUn compte a été créé pour vous. Choisissez votre mot de passe pour l'activer :\n${p.url}\n\nCe lien est valable 72 heures.`,
    },
    ht: {
      subject: (p) => `${p.appName} : kont ou ap tann ou`,
      text: (p) =>
        `Bonjou ${p.firstName},\n\nYo kreye yon kont pou ou. Chwazi modpas ou pou aktive l :\n${p.url}\n\nLyen sa a bon pandan 72 èdtan.`,
    },
    en: {
      subject: (p) => `${p.appName}: your account is ready`,
      text: (p) =>
        `Hello ${p.firstName},\n\nAn account has been created for you. Choose your password to activate it:\n${p.url}\n\nThis link is valid for 72 hours.`,
    },
  },
  'already-registered': {
    fr: {
      subject: (p) => `${p.appName} : vous avez déjà un compte`,
      text: (p) =>
        `Bonjour ${p.firstName},\n\nQuelqu'un a tenté de créer un compte avec cette adresse, mais un compte existe déjà. Si c'était vous, connectez-vous ou utilisez « mot de passe oublié ». Sinon, ignorez ce message.`,
    },
    ht: {
      subject: (p) => `${p.appName} : ou gen yon kont deja`,
      text: (p) =>
        `Bonjou ${p.firstName},\n\nYon moun eseye kreye yon kont ak adrès sa a, men yon kont egziste deja. Si se ou, konekte w oswa itilize « bliye modpas ». Si se pa ou, inyore mesaj sa a.`,
    },
    en: {
      subject: (p) => `${p.appName}: you already have an account`,
      text: (p) =>
        `Hello ${p.firstName},\n\nSomeone tried to create an account with this address, but one already exists. If it was you, sign in or use "forgot password". Otherwise, ignore this message.`,
    },
  },
};

export function renderAuthMail(kind: AuthMailKind, locale: Locale, params: Params) {
  const template = templates[kind][locale] ?? templates[kind].fr;
  return { subject: template.subject(params), text: template.text(params) };
}
