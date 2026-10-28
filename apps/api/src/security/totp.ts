import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

/** Mots de passe à usage unique basés sur le temps (RFC 6238, HMAC-SHA1, 30 s, 6 chiffres) : compatible avec les applications usuelles. */
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Tolérance d'horloge : le code de la période précédente et de la suivante sont acceptés. */
export const TOTP_WINDOW = 1;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error('Caractère base32 invalide');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Nouveau secret de 160 bits (taille recommandée pour HMAC-SHA1), en base32. */
export const generateSecret = (): string => base32Encode(randomBytes(20));

export function hotp(secret: Buffer, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(message).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary = ((digest[offset] & 127) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

export const stepAt = (timeMs: number): number => Math.floor(timeMs / 1000 / TOTP_STEP_SECONDS);

/**
 * Vérifie un code. Renvoie la période (step) qui l'a validé, ou null. `lastUsedStep` empêche le rejeu : un code
 * déjà accepté (ou plus ancien) est refusé, même s'il reste dans la fenêtre de tolérance.
 */
export function verifyTotp(secretBase32: string, code: string, options: { now?: number; lastUsedStep?: number | null } = {}): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretBase32);
  const current = stepAt(options.now ?? Date.now());
  const given = Buffer.from(code);
  let matched: number | null = null;
  // Toutes les périodes de la fenêtre sont comparées (temps constant par comparaison)
  for (let delta = -TOTP_WINDOW; delta <= TOTP_WINDOW; delta += 1) {
    const step = current + delta;
    const expected = Buffer.from(hotp(secret, step));
    if (timingSafeEqual(expected, given) && matched === null) matched = step;
  }
  if (matched === null) return null;
  if (options.lastUsedStep !== undefined && options.lastUsedStep !== null && matched <= options.lastUsedStep) return null;
  return matched;
}

export function otpauthUri(secretBase32: string, account: string, issuer: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}

// ---------------------------------------------------------------------------------------------
// Chiffrement du secret au repos (AES-256-GCM, clé dérivée par HKDF)
// ---------------------------------------------------------------------------------------------

const deriveKey = (secret: string): Buffer => Buffer.from(hkdfSync('sha256', secret, 'b2c-totp-v1', 'secret-encryption', 32));

/** Format : v1.<iv>.<étiquette>.<chiffré> en base64url. */
export function encryptSecret(plain: string, keyMaterial: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(keyMaterial), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

export function decryptSecret(stored: string, keyMaterial: string): string {
  const [version, iv, tag, data] = stored.split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Secret TOTP illisible');
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(keyMaterial), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

// ---------------------------------------------------------------------------------------------
// Codes de secours
// ---------------------------------------------------------------------------------------------

const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // sans i, l, o, 0, 1

export function generateRecoveryCode(): string {
  const bytes = randomBytes(8);
  const pick = (i: number) => RECOVERY_ALPHABET[bytes[i] % RECOVERY_ALPHABET.length];
  return `${[0, 1, 2, 3].map(pick).join('')}-${[4, 5, 6, 7].map(pick).join('')}`;
}

/** Empreinte HMAC avec la clé du serveur : une fuite de la base seule ne permet pas de retrouver les codes par force brute. */
export const hashRecoveryCode = (code: string, keyMaterial: string): string => createHmac('sha256', deriveKey(keyMaterial)).update(`recovery:${code.trim().toLowerCase()}`).digest('hex');
