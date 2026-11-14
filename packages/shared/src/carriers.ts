/**
 * Détection du transporteur d'un numéro de suivi d'achat en ligne (UPS, USPS, FedEx, DHL, Amazon) d'après son FORMAT, avec le lien de suivi.
 * Heuristique : un numéro de 12 chiffres peut être FedEx ou autre ; le lien ne sert qu'à vérifier, jamais à décider d'un statut.
 */
export type CarrierCode = 'UPS' | 'USPS' | 'FEDEX' | 'DHL' | 'AMAZON';

export interface CarrierMatch {
  carrier: CarrierCode;
  name: string;
  url: string;
}

const clean = (raw: string) => raw.toUpperCase().replace(/[\s-]/g, '');
const enc = encodeURIComponent;

export function detectCarrier(raw: string | null | undefined): CarrierMatch | null {
  if (!raw) return null;
  const code = clean(raw);
  if (/^1Z[A-Z0-9]{16}$/.test(code)) return { carrier: 'UPS', name: 'UPS', url: `https://www.ups.com/track?tracknum=${enc(code)}` };
  if (/^TBA\d{9,15}$/.test(code)) return { carrier: 'AMAZON', name: 'Amazon Logistics', url: `https://track.amazon.com/tracking/${enc(code)}` };
  if (/^[A-Z]{2}\d{9}US$/.test(code) || /^(92|93|94|95)\d{18,20}$/.test(code)) {
    return { carrier: 'USPS', name: 'USPS', url: `https://tools.usps.com/go/TrackConfirmAction?tLabels=${enc(code)}` };
  }
  if (/^(\d{12}|\d{15}|\d{20}|\d{22})$/.test(code)) return { carrier: 'FEDEX', name: 'FedEx', url: `https://www.fedex.com/fedextrack/?trknbr=${enc(code)}` };
  if (/^(\d{10}|JD\d{18})$/.test(code)) return { carrier: 'DHL', name: 'DHL', url: `https://www.dhl.com/en/express/tracking.html?AWB=${enc(code)}` };
  return null;
}

/** Chiffres seulement : le format international de `wa.me` n'accepte ni « + » ni espaces. */
const digits = (phone: string) => phone.replace(/\D/g, '');

/** Lien WhatsApp (sans fournisseur payant) qui ouvre une conversation avec le message déjà rempli. */
export function whatsappLink(phone: string, text: string): string | null {
  const d = digits(phone);
  return d.length >= 8 && d.length <= 15 ? `https://wa.me/${d}?text=${enc(text)}` : null;
}

/** Lien SMS (`sms:`) avec le message déjà rempli. */
export function smsLink(phone: string, text: string): string | null {
  const d = digits(phone);
  return d.length >= 8 && d.length <= 15 ? `sms:+${d}?&body=${enc(text)}` : null;
}
