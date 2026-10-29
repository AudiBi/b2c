import type { Locale } from '@b2c/shared';

/** Identifiant de l'image du logo jointe au message (référencée par `cid:` dans le HTML). */
export const LOGO_CID = 'logo-b2c@mail';

export const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export interface MailLayout {
  lang: Locale;
  appName: string;
  /** Adresse du site (pied de page). */
  siteUrl: string;
  title: string;
  /** Texte d'aperçu affiché par les messageries à côté de l'objet (caché dans le message). */
  preheader?: string;
  /** Paragraphes de texte brut ; les retours à la ligne simples sont conservés. */
  paragraphs: string[];
  button?: { label: string; url: string };
  /** Encadré discret (consigne de sécurité, validité du lien…). */
  note?: string;
}

const STRINGS: Record<Locale, { fallback: string; automatic: string; rights: string }> = {
  fr: {
    fallback: 'Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :',
    automatic: 'Ce message vous a été envoyé automatiquement : merci de ne pas y répondre.',
    rights: 'Tous droits réservés.',
  },
  ht: {
    fallback: 'Si bouton an pa mache, kopye lyen sa a nan navigatè ou :',
    automatic: 'Mesaj sa a voye otomatikman : tanpri pa reponn li.',
    rights: 'Tout dwa rezève.',
  },
  en: {
    fallback: 'If the button does not work, copy this link into your browser:',
    automatic: 'This message was sent automatically: please do not reply.',
    rights: 'All rights reserved.',
  },
};

// Couleurs de la marque (bleu du logo) ; mises en forme en ligne, seule façon fiable de styler un e-mail.
const BRAND = '#03526f';
const INK = '#0f1b2d';
const MUTED = '#5b6b80';
const LINE = '#e3e9f0';
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

const paragraph = (text: string) =>
  `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:${INK};">${escapeHtml(text).replace(/\r?\n/g, '<br>')}</p>`;

/**
 * Gabarit HTML des e-mails : une colonne de 600 px, logo en tête, titre, texte, bouton d'action, encadré, pied de page.
 * Mise en page en tableaux et styles en ligne (compatibilité des messageries), texte alternatif fourni à part par l'appelant.
 * Toute valeur dynamique est échappée : un nom ou un libellé saisi par un client ne peut pas injecter de HTML.
 */
export function renderMailHtml(layout: MailLayout): string {
  const s = STRINGS[layout.lang] ?? STRINGS.fr;
  const app = escapeHtml(layout.appName);
  const year = new Date().getFullYear();
  const button = layout.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;"><tr><td align="center" bgcolor="${BRAND}" style="border-radius:8px;">
        <a href="${escapeHtml(layout.button.url)}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;background:${BRAND};">${escapeHtml(layout.button.label)}</a>
      </td></tr></table>
      <p style="margin:0 0 6px;font-size:13px;line-height:1.5;color:${MUTED};">${escapeHtml(s.fallback)}</p>
      <p style="margin:0 0 24px;font-size:13px;line-height:1.5;word-break:break-all;"><a href="${escapeHtml(layout.button.url)}" target="_blank" style="color:${BRAND};">${escapeHtml(layout.button.url)}</a></p>`
    : '';
  const note = layout.note
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px;"><tr><td style="padding:14px 16px;background:#f3f6f9;border-left:4px solid ${BRAND};border-radius:6px;font-size:14px;line-height:1.55;color:${MUTED};">${escapeHtml(layout.note).replace(/\r?\n/g, '<br>')}</td></tr></table>`
    : '';
  const preheader = escapeHtml(layout.preheader ?? layout.paragraphs[0] ?? layout.title).slice(0, 140);

  return `<!doctype html>
<html lang="${layout.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(layout.title)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f6f9;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f6f9;">
<tr><td align="center" style="padding:32px 12px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid ${LINE};border-radius:12px;overflow:hidden;">
    <tr><td style="height:5px;line-height:5px;font-size:0;background:${BRAND};">&nbsp;</td></tr>
    <tr><td align="center" style="padding:28px 32px 8px;">
      <img src="cid:${LOGO_CID}" width="150" alt="${app}" style="display:block;border:0;outline:none;text-decoration:none;width:150px;height:auto;">
    </td></tr>
    <tr><td style="padding:16px 32px 8px;font-family:${FONT};">
      <h1 style="margin:0 0 20px;font-size:24px;line-height:1.3;font-weight:700;color:${INK};">${escapeHtml(layout.title)}</h1>
      ${layout.paragraphs.map(paragraph).join('\n      ')}
      ${button}
      ${note}
    </td></tr>
    <tr><td style="padding:20px 32px 28px;font-family:${FONT};border-top:1px solid ${LINE};">
      <p style="margin:0 0 6px;font-size:12px;line-height:1.5;color:${MUTED};">${escapeHtml(s.automatic)}</p>
      <p style="margin:0;font-size:12px;line-height:1.5;color:${MUTED};">&copy; ${year} ${app} · <a href="${escapeHtml(layout.siteUrl)}" target="_blank" style="color:${MUTED};">${escapeHtml(layout.siteUrl.replace(/^https?:\/\//, ''))}</a> · ${escapeHtml(s.rights)}</p>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>
`;
}
