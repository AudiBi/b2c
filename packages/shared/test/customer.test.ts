import {
  addressTemplateSchema,
  createAddressSchema,
  createBeneficiarySchema,
  publicContactSchema,
  renderAddressTemplate,
  updateProfileSchema,
} from '../src';

describe("modèle d'adresse de réception", () => {
  const template = ['{customerName}', '{customerCode} {mode}', '1 Test Street', '', 'Miami, FL'];

  it('remplace les variables, supprime les lignes vides et ne ré-analyse pas les valeurs insérées', () => {
    const lines = renderAddressTemplate(template, { customerName: '{customerCode} piège', customerCode: 'TH-000042', mode: 'AIR' });
    expect(lines).toEqual(['{customerCode} piège', 'TH-000042 AIR', '1 Test Street', 'Miami, FL']);
  });

  it('accepte un modèle valide', () => {
    expect(addressTemplateSchema.safeParse(template.filter(Boolean)).success).toBe(true);
  });

  it.each([
    ['sans {customerCode}', ['{customerName}', 'Miami']],
    ['variable inconnue', ['{customerCode}', '{ville}']],
    ['accolade isolée', ['{customerCode}', 'a } b']],
    ['trop de lignes', Array(11).fill('{customerCode}')],
    ['ligne trop longue', ['{customerCode}', 'x'.repeat(121)]],
    ['vide', []],
  ])('refuse un modèle %s', (_label, value) => {
    expect(addressTemplateSchema.safeParse(value).success).toBe(false);
  });
});

describe('schémas du portail client', () => {
  it('normalise le code pays en majuscules et refuse les formats invalides', () => {
    const base = { kind: 'DELIVERY', label: 'Maison', recipientName: 'M. Jean', line1: '1 rue', city: 'Port-au-Prince' };
    expect(createAddressSchema.parse({ ...base, country: ' ht ' }).country).toBe('HT');
    expect(createAddressSchema.safeParse({ ...base, country: 'HTI' }).success).toBe(false);
    expect(createAddressSchema.parse({ ...base, country: 'HT', line2: '   ' }).line2).toBeUndefined();
  });

  it('refuse un numéro de pièce de plus de 4 caractères et une validité inversée', () => {
    expect(createBeneficiarySchema.safeParse({ fullName: 'A', idDocumentLast4: '12345' }).success).toBe(false);
    expect(createBeneficiarySchema.safeParse({ fullName: 'A', validFrom: '2026-02-01', validTo: '2026-01-01' }).success).toBe(false);
    expect(createBeneficiarySchema.safeParse({ fullName: 'A', validFrom: '2026-01-01', validTo: '2026-01-01' }).success).toBe(true);
  });

  it("refuse une mise à jour de profil vide ou avec un champ non modifiable", () => {
    expect(updateProfileSchema.safeParse({}).success).toBe(false);
    expect(updateProfileSchema.safeParse({ email: 'x@y.co' }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ phone: null }).success).toBe(true);
  });

  it('les coordonnées publiques exigent des URL https', () => {
    expect(publicContactSchema.safeParse({ phones: [], facebook: 'https://facebook.com/x' }).success).toBe(true);
    expect(publicContactSchema.safeParse({ phones: [], facebook: 'http://facebook.com/x' }).success).toBe(false);
    expect(publicContactSchema.safeParse({ phones: [], facebook: 'javascript:alert(1)' }).success).toBe(false);
  });
});
