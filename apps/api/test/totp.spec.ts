import { base32Decode, base32Encode, decryptSecret, encryptSecret, generateRecoveryCode, generateSecret, hashRecoveryCode, hotp, otpauthUri, stepAt, verifyTotp } from '../src/security/totp';

// Vecteurs de test de la RFC 6238 (annexe B, SHA-1, secret ASCII « 12345678901234567890 »), réduits à 6 chiffres
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));
const VECTORS: [number, string][] = [
  [59, '287082'],
  [1111111109, '081804'],
  [1111111111, '050471'],
  [1234567890, '005924'],
  [2000000000, '279037'],
];

describe('TOTP : primitives', () => {
  it.each(VECTORS)('vecteur officiel de la RFC 6238 à T=%i → %s', (time, expected) => {
    expect(hotp(base32Decode(RFC_SECRET), stepAt(time * 1000))).toBe(expected);
    expect(verifyTotp(RFC_SECRET, expected, { now: time * 1000 })).toBe(stepAt(time * 1000));
  });

  it('base32 : aller-retour, majuscules/minuscules et séparateurs tolérés, caractères invalides refusés', () => {
    for (const size of [1, 5, 10, 20, 33]) {
      const bytes = Buffer.from(Array.from({ length: size }, (_, i) => (i * 37 + size) % 256));
      expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
    }
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('mzxw 6ytb-oi==').toString()).toBe('foobar');
    expect(() => base32Decode('MZXW1')).toThrow();
  });

  it('fenêtre de tolérance d’une période de chaque côté, pas davantage', () => {
    const now = 1_700_000_000_000;
    const step = stepAt(now);
    const code = (s: number) => hotp(base32Decode(RFC_SECRET), s);
    expect(verifyTotp(RFC_SECRET, code(step), { now })).toBe(step);
    expect(verifyTotp(RFC_SECRET, code(step - 1), { now })).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, code(step + 1), { now })).toBe(step + 1);
    expect(verifyTotp(RFC_SECRET, code(step - 2), { now })).toBeNull();
    expect(verifyTotp(RFC_SECRET, code(step + 2), { now })).toBeNull();
  });

  it('rejeu : une période déjà utilisée (ou plus ancienne) est refusée', () => {
    const now = 1_700_000_000_000;
    const step = stepAt(now);
    const code = hotp(base32Decode(RFC_SECRET), step);
    expect(verifyTotp(RFC_SECRET, code, { now, lastUsedStep: step })).toBeNull();
    expect(verifyTotp(RFC_SECRET, code, { now, lastUsedStep: step + 1 })).toBeNull();
    expect(verifyTotp(RFC_SECRET, code, { now, lastUsedStep: step - 1 })).toBe(step);
    expect(verifyTotp(RFC_SECRET, code, { now, lastUsedStep: null })).toBe(step);
  });

  it('formats refusés : pas de chiffres, trop court, trop long, espaces', () => {
    for (const bad of ['', '12345', '1234567', 'abcdef', '123 456', '１２３４５６']) expect(verifyTotp(RFC_SECRET, bad)).toBeNull();
  });

  it('secret généré : 160 bits en base32, différent à chaque fois ; adresse otpauth conforme', () => {
    const a = generateSecret();
    expect(a).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(a)).toHaveLength(20);
    expect(generateSecret()).not.toBe(a);
    const uri = otpauthUri(a, 'marie@example.test', 'B2C');
    expect(uri.startsWith('otpauth://totp/B2C')).toBe(true);
    expect(uri).toContain(`secret=${a}`);
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
    expect(uri).toContain('marie%40example.test');
  });
});

describe('TOTP : chiffrement du secret et codes de secours', () => {
  const key = 'k'.repeat(40);

  it('le secret est chiffré (AES-256-GCM) : jamais en clair, vecteur d’initialisation neuf à chaque fois, altération détectée', () => {
    const secret = generateSecret();
    const a = encryptSecret(secret, key);
    const b = encryptSecret(secret, key);
    expect(a).not.toBe(b);
    expect(a.startsWith('v1.')).toBe(true);
    expect(a).not.toContain(secret);
    expect(decryptSecret(a, key)).toBe(secret);
    expect(() => decryptSecret(a, 'autre-cle-'.repeat(5))).toThrow();
    const parts = a.split('.');
    parts[3] = Buffer.from('falsifié').toString('base64url');
    expect(() => decryptSecret(parts.join('.'), key)).toThrow();
    expect(() => decryptSecret('v2.a.b.c', key)).toThrow();
    expect(() => decryptSecret('n-importe-quoi', key)).toThrow();
  });

  it('codes de secours : format xxxx-xxxx sans caractères ambigus, uniques, empreinte à clé (64 hex) insensible à la casse', () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateRecoveryCode()));
    expect(codes.size).toBe(200);
    for (const c of codes) expect(c).toMatch(/^[a-hj-km-np-z2-9]{4}-[a-hj-km-np-z2-9]{4}$/);
    const code = [...codes][0];
    expect(hashRecoveryCode(code, key)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRecoveryCode(code.toUpperCase(), key)).toBe(hashRecoveryCode(code, key));
    expect(hashRecoveryCode(code, key)).not.toBe(hashRecoveryCode(code, 'autre-cle-'.repeat(5))); // sans la clé, pas de force brute hors ligne
  });
});
