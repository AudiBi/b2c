import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import type { Locale } from '@b2c/shared';
import { ConfigService } from '../config/config.module';
import { renderAuthMail, type AuthMailKind } from './mail.templates';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
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
    await this.transporter.sendMail({ from: this.config.env.MAIL_FROM, ...message });
  }

  /**
   * Envoi des e-mails d'authentification APRÈS validation de la transaction. Un échec est journalisé mais
   * n'annule pas l'action (le client peut redemander un lien). La file avec nouvelles tentatives arrive en phase 7.
   */
  async sendAuthMail(
    kind: AuthMailKind,
    to: string,
    locale: Locale,
    params: { firstName: string; url?: string },
  ): Promise<boolean> {
    try {
      const content = renderAuthMail(kind, locale, { appName: this.config.env.APP_NAME, ...params });
      await this.send({ to, ...content });
      return true;
    } catch (error) {
      this.logger.error(`Envoi de l'e-mail « ${kind} » échoué : ${(error as Error).message}`);
      return false;
    }
  }
}
