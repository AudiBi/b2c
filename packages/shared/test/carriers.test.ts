import { detectCarrier, smsLink, whatsappLink } from '../src';

describe('transporteurs et liens de contact', () => {
  it('reconnaît UPS, USPS, FedEx, DHL et Amazon par le format', () => {
    expect(detectCarrier('1Z999AA10123456784')?.carrier).toBe('UPS');
    expect(detectCarrier('1z 999 aa1 0123 456 784')?.carrier).toBe('UPS');
    expect(detectCarrier('9400111899223197428490')?.carrier).toBe('USPS');
    expect(detectCarrier('EA123456789US')?.carrier).toBe('USPS');
    expect(detectCarrier('123456789012')?.carrier).toBe('FEDEX');
    expect(detectCarrier('1234567890')?.carrier).toBe('DHL');
    expect(detectCarrier('TBA123456789012')?.carrier).toBe('AMAZON');
  });

  it('donne un lien de suivi encodé, et rien pour un format inconnu', () => {
    expect(detectCarrier('1Z999AA10123456784')?.url).toBe('https://www.ups.com/track?tracknum=1Z999AA10123456784');
    expect(detectCarrier('abc')).toBeNull();
    expect(detectCarrier('')).toBeNull();
    expect(detectCarrier(null)).toBeNull();
  });

  it('WhatsApp et SMS : numéro international nettoyé, message encodé, refus d’un numéro trop court', () => {
    expect(whatsappLink('+509 3411-1111', 'Bonjour Jean & Marie')).toBe('https://wa.me/50934111111?text=Bonjour%20Jean%20%26%20Marie');
    expect(smsLink('+50934111111', 'Colis arrivé')).toBe('sms:+50934111111?&body=Colis%20arriv%C3%A9');
    expect(whatsappLink('123', 'x')).toBeNull();
    expect(smsLink('', 'x')).toBeNull();
  });
});
