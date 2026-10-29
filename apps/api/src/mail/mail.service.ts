import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import type { Locale } from '@b2c/shared';
import { LOGO_PNG } from '../branding/logo-png';
import { ConfigService } from '../config/config.module';
import { LOGO_CID, renderMailHtml, type MailLayout } from './mail.layout';
import { renderAuthMail, type AuthMailKind } from './mail.templates';

export interface MailMessage {
  to: string;
  subject: string;
  /** Version texte brut (toujours fournie : alternative au HTML). */
  text: string;
  /** Version HTML mise en forme, avec le logo en image intégrée (`cid:`). */
  html?: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger('Mail');
  private readonly transporter?: Transporter;
  /** Messages « envoyés » quand MAIL_TRANSPORT=memory (tests uniquement). */
  readonly sent: MailMessage[] = [];

  constructor(private readonly config: ConfigService) {
    const env = config.env;
    if (env.MAIL_TRANSPORT === 'smtp') {
      this.transporter = createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
      });
    }
  }

  async send(message: MailMessage): Promise<void> {
    if (!this.transporter) {
      this.sent.push(message);
      if (this.sent.length > 500) this.sent.shift();
      return;
    }
    // Le logo est joint au message (image intégrée) : il s'affiche sans dépendre d'un serveur d'images ni du réglage « afficher les images »
    await this.transporter.sendMail({
      from: this.config.env.MAIL_FROM,
      ...message,
      attachments: message.html
        ? [{ filename: 'logo.png', content: LOGO_PNG, contentType: 'image/png', cid: LOGO_CID, contentDisposition: 'inline' }]
        : undefined,
    });
  }

  /** Habille un contenu dans le gabarit de la marque (logo, titre, bouton, pied de page). */
  html(layout: Omit<MailLayout, 'appName' | 'siteUrl'>): string {
    return renderMailHtml({ appName: this.config.env.APP_NAME, siteUrl: this.config.env.WEB_PUBLIC_URL, ...layout });
  }

  /**
   * Message de notification (texte brut issu d'un modèle) : titre = objet, paragraphes = blocs du texte,
   * bouton vers l'espace du client. Aucune valeur n'est interprétée comme du HTML.
   */
  notification(to: string, subject: string, body: string, locale: Locale): MailMessage {
    const openAccount: Record<Locale, string> = { fr: 'Ouvrir mon espace', ht: 'Louvri espas mwen', en: 'Open my account' };
    const paragraphs = body.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
    return {
      to,
      subject,
      text: body,
      html: this.html({
        lang: locale,
        title: subject,
        paragraphs: paragraphs.length ? paragraphs : [body],
        button: { label: openAccount[locale] ?? openAccount.fr, url: `${this.config.env.WEB_PUBLIC_URL}/${locale}/account` },
      }),
    };
  }

  /**
   * Envoi des e-mails d'authentification APRÈS validation de la transaction. Un échec est journalisé mais
   * n'annule pas l'action (le client peut redemander un lien).
   */
  async sendAuthMail(
    kind: AuthMailKind,
    to: string,
    locale: Locale,
    params: { firstName: string; url?: string },
  ): Promise<boolean> {
    try {
      const { subject, text, content } = renderAuthMail(kind, locale, { appName: this.config.env.APP_NAME, ...params });
      const html = this.html({
        lang: locale,
        title: content.title,
        paragraphs: content.paragraphs,
        button: content.button && params.url ? { label: content.button, url: params.url } : undefined,
        note: content.note,
        preheader: content.paragraphs.at(-1),
      });
      await this.send({ to, subject, text, html });
      return true;
    } catch (error) {
      this.logger.error(`Envoi de l'e-mail « ${kind} » échoué : ${(error as Error).message}`);
      return false;
    }
  }
}
