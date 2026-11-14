import { detectCarrier, smsLink, whatsappLink } from '@b2c/shared';
import { format, useI18n } from '../i18n';

/** Boutons WhatsApp et SMS en un clic (aucun fournisseur payant) : le message est déjà rempli, c'est la personne qui l'envoie. */
export function ContactLinks({ phone, name, tracking, statusLabel }: { phone: string | null | undefined; name: string | null | undefined; tracking: string; statusLabel: string }) {
  const { m } = useI18n();
  const c = m.staff.contact;
  if (!phone) return null;
  const text = format(c.message, { name: name ?? '', tracking, status: statusLabel });
  const wa = whatsappLink(phone, text);
  const sms = smsLink(phone, text);
  if (!wa && !sms) return null;
  return (
    <span className="form-actions" data-testid="contact-links">
      {wa ? (
        <a className="btn btn-outline btn-sm" href={wa} target="_blank" rel="noopener noreferrer">
          {c.whatsapp}
        </a>
      ) : null}
      {sms ? (
        <a className="btn btn-outline btn-sm" href={sms}>
          {c.sms}
        </a>
      ) : null}
    </span>
  );
}

/** Lien de suivi du transporteur reconnu d'après le format du numéro d'achat (UPS, USPS, FedEx, DHL, Amazon). */
export function CarrierLink({ code }: { code: string | null | undefined }) {
  const { m } = useI18n();
  const match = detectCarrier(code);
  if (!match) return null;
  return (
    <a href={match.url} target="_blank" rel="noopener noreferrer" data-testid="carrier-link">
      {format(m.staff.contact.trackAt, { carrier: match.name })}
    </a>
  );
}
