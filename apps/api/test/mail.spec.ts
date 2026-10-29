import { ConfigService } from '../src/config/config.module';
import { loadEnv } from '../src/config/env';
import { LOGO_CID } from '../src/mail/mail.layout';
import { MailService } from '../src/mail/mail.service';

const base = { DATABASE_URL: 'x', REDIS_URL: 'x', JWT_ACCESS_SECRET: 'a'.repeat(40), APP_NAME: 'B2C', WEB_PUBLIC_URL: 'https://exemple.com' };
const service = (extra: Record<string, string> = {}) => new MailService(new ConfigService(loadEnv({ ...base, MAIL_TRANSPORT: 'memory', ...extra } as NodeJS.ProcessEnv)));

describe('E-mails : gabarit HTML de la marque', () => {
  it('un e-mail d’authentification a une version HTML avec logo, titre, bouton et lien de secours, et garde son texte brut', async () => {
    const mail = service();
    await mail.sendAuthMail('verify-email', 'marie@example.test', 'fr', { firstName: 'Marie', url: 'https://exemple.com/fr/verify-email?token=abc' });
    const [message] = mail.sent;
    expect(message.text).toContain('Bonjour Marie');
    expect(message.text).toContain('https://exemple.com/fr/verify-email?token=abc');
    const html = message.html!;
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<html lang="fr">');
    expect(html).toContain(`src="cid:${LOGO_CID}"`);
    expect(html).toContain('alt="B2C"');
    expect(html).toContain('<h1');
    expect(html).toContain('Confirmez votre adresse e-mail');
    expect(html).toContain('Confirmer mon adresse');
    // le bouton ET le lien de secours pointent vers l'adresse
    expect(html.split('href="https://exemple.com/fr/verify-email?token=abc"').length - 1).toBe(2);
    expect(html).toContain('Ce lien est valable 24 heures');
    expect(html).toContain('merci de ne pas y répondre');
  });

  it('chaque modèle d’authentification existe en HTML dans les trois langues, avec son bouton quand il y a un lien', async () => {
    const mail = service();
    for (const kind of ['verify-email', 'reset-password', 'invite', 'already-registered'] as const) {
      for (const lang of ['fr', 'ht', 'en'] as const) {
        await mail.sendAuthMail(kind, 'x@example.test', lang, { firstName: 'Paul', url: 'https://exemple.com/lien' });
      }
    }
    expect(mail.sent).toHaveLength(12);
    for (const message of mail.sent) {
      expect(message.html).toContain(`cid:${LOGO_CID}`);
      expect(message.html).toContain('Paul');
      expect(message.text).toBeTruthy();
      expect(message.html).not.toMatch(/undefined|\[object Object\]/);
    }
    // « déjà inscrit » n'a pas de lien d'action
    expect(mail.sent.filter((m) => m.html!.includes('href="https://exemple.com/lien"'))).toHaveLength(9);
    expect(mail.sent[0].html).toContain('<html lang="fr">');
    expect(mail.sent[1].html).toContain('<html lang="ht">');
    expect(mail.sent[2].html).toContain('<html lang="en">');
    expect(mail.sent[2].html).toContain('Confirm my address');
  });

  it('aucune valeur saisie n’est interprétée comme du HTML (nom, texte de notification)', async () => {
    const mail = service();
    await mail.sendAuthMail('invite', 'x@example.test', 'fr', { firstName: '<script>alert(1)</script>', url: 'https://exemple.com/a?x=1&y="2"' });
    const html = mail.sent[0].html!;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('href="https://exemple.com/a?x=1&amp;y=&quot;2&quot;"');

    const note = mail.notification('x@example.test', 'Objet <b>gras</b>', 'Bonjour <img src=x onerror=alert(1)>,\n\nVotre colis EE-1 est arrivé.\nÀ bientôt.', 'fr');
    expect(note.html).not.toContain('<img src=x');
    expect(note.html).not.toContain('<b>gras</b>');
    expect(note.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('une notification devient un message avec le logo, le titre = l’objet, un paragraphe par bloc et un bouton vers l’espace client', () => {
    const mail = service();
    const note = mail.notification('marie@example.test', 'Colis reçu à l’entrepôt', 'Bonjour Marie, votre colis EE-ABCDE est arrivé.\n\nÀ bientôt.', 'en');
    expect(note.text).toBe('Bonjour Marie, votre colis EE-ABCDE est arrivé.\n\nÀ bientôt.'); // texte brut inchangé
    expect(note.html).toContain('<h1');
    expect(note.html).toContain('Colis reçu à l’entrepôt');
    expect((note.html!.match(/<p style="margin:0 0 16px/g) ?? []).length).toBe(2);
    expect(note.html).toContain('href="https://exemple.com/en/account"');
    expect(note.html).toContain('Open my account');
    // aucun jeton ni identifiant interne dans le lien
    expect(note.html).not.toMatch(/token=|[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it('en SMTP, le logo est joint au message comme image intégrée (cid) ; sans HTML, aucune pièce jointe', async () => {
    const mail = service({ MAIL_TRANSPORT: 'smtp', SMTP_HOST: '127.0.0.1' });
    const sendMail = jest.fn().mockResolvedValue({});
    (mail as unknown as { transporter: { sendMail: typeof sendMail } }).transporter = { sendMail };
    await mail.send({ to: 'a@example.test', subject: 's', text: 't', html: `<img src="cid:${LOGO_CID}">` });
    await mail.send({ to: 'a@example.test', subject: 's', text: 't' });
    const [withHtml, plain] = sendMail.mock.calls.map((c) => c[0]);
    expect(withHtml.attachments).toHaveLength(1);
    expect(withHtml.attachments[0]).toMatchObject({ cid: LOGO_CID, contentType: 'image/png', contentDisposition: 'inline' });
    expect(Buffer.isBuffer(withHtml.attachments[0].content)).toBe(true);
    expect(withHtml.attachments[0].content.subarray(0, 4).toString('hex')).toBe('89504e47'); // signature PNG
    expect(plain.attachments).toBeUndefined();
  });
});
