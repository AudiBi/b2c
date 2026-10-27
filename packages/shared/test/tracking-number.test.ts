import { randomInt } from 'node:crypto';
import {
  TRACKING_ALPHABET,
  formatTrackingNumber,
  generateTrackingNumber,
  normalizeTrackingNumber,
  trackingCheckChar,
} from '../src/tracking-number';

describe('numéro de suivi', () => {
  it('est composé du préfixe, de 10 caractères aléatoires de l’alphabet de Crockford et d’un contrôle', () => {
    const number = generateTrackingNumber('TH', randomInt);
    expect(number).toMatch(/^TH[0-9A-HJKMNP-TV-Z]{11}$/);
    expect(number).toHaveLength(13);
    expect(generateTrackingNumber('ABCD', randomInt)).toHaveLength(15);
  });

  it('refuse un préfixe invalide ou hors alphabet (I, L, O, U)', () => {
    for (const bad of ['T', 'ABCDE', 't1', 'LO', 'UI', '']) expect(() => generateTrackingNumber(bad, randomInt)).toThrow();
  });

  it('10 000 numéros générés sont tous distincts, valides, et répartis sur tout l’alphabet', () => {
    const seen = new Set<string>();
    const chars = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) {
      const number = generateTrackingNumber('TK', randomInt);
      expect(normalizeTrackingNumber(number)).toBe(number);
      seen.add(number);
      for (const c of number.slice(2, 12)) chars.add(c);
    }
    expect(seen.size).toBe(10_000);
    expect(chars.size).toBe(32);
  });

  it('accepte les saisies humaines : minuscules, espaces, tirets, O/I/L confondus', () => {
    const number = generateTrackingNumber('TH', () => 1); // corps « 1111111111 »
    const noisy = `  ${formatTrackingNumber(number).toLowerCase().replace(/1/g, (_, i) => (i % 2 ? 'l' : 'i'))} `;
    expect(normalizeTrackingNumber(noisy)).toBe(number);
    expect(normalizeTrackingNumber(`${number.slice(0, 2)} ${number.slice(2, 7)} ${number.slice(7)}`)).toBe(number);
    const withZero = generateTrackingNumber('TH', () => 0);
    expect(normalizeTrackingNumber(withZero.replace(/0/g, 'O'))).toBe(withZero);
  });

  it('détecte toute faute de frappe sur un caractère', () => {
    const number = generateTrackingNumber('TH', randomInt);
    for (let position = 0; position < number.length; position += 1) {
      for (const replacement of TRACKING_ALPHABET) {
        if (replacement === number[position]) continue;
        const mutated = number.slice(0, position) + replacement + number.slice(position + 1);
        // une faute dans le préfixe vers un caractère hors alphabet est refusée ; sinon le contrôle échoue
        expect(normalizeTrackingNumber(mutated)).toBeNull();
      }
    }
  });

  it('détecte l’échange de deux caractères adjacents différents dans la plupart des cas', () => {
    let detected = 0;
    let total = 0;
    for (let i = 0; i < 500; i += 1) {
      const number = generateTrackingNumber('TH', randomInt);
      for (let p = 2; p < number.length - 1; p += 1) {
        if (number[p] === number[p + 1]) continue;
        const swapped = number.slice(0, p) + number[p + 1] + number[p] + number.slice(p + 2);
        total += 1;
        if (normalizeTrackingNumber(swapped) === null) detected += 1;
      }
    }
    expect(detected / total).toBeGreaterThan(0.9);
  });

  it('refuse les formes invalides', () => {
    for (const bad of ['', 'TH', 'TH123', '1234567890123', 'TH-ÉÉÉÉÉ-ÉÉÉÉÉ-É', 'T'.repeat(30), 'TH7K3M9PQ2XA', "TH'; DROP TABLE packages;--"]) {
      expect(normalizeTrackingNumber(bad)).toBeNull();
    }
  });

  it('le caractère de contrôle est stable', () => {
    // T = 26 (poids 1) et H = 17 (poids 3) : 26 + 51 = 77 ; 77 mod 32 = 13 ; l'alphabet[13] est « D »
    expect(trackingCheckChar('TH0000000000')).toBe('D');
    expect(() => trackingCheckChar('TH-')).toThrow();
  });

  it('s’affiche par groupes lisibles', () => {
    const number = generateTrackingNumber('TH', () => 5);
    expect(formatTrackingNumber(number)).toMatch(/^TH-[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]$/);
    expect(normalizeTrackingNumber(formatTrackingNumber(number))).toBe(number);
  });
});
