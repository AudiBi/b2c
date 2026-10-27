import { createHash } from 'node:crypto';
import { AppException } from '../common/errors';

export type DetectedType = { mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf'; extension: 'jpg' | 'png' | 'webp' | 'pdf' };

const startsWith = (buffer: Buffer, bytes: number[], offset = 0) => bytes.every((byte, i) => buffer[offset + i] === byte);

/** Type réel du contenu, d'après ses premiers octets (le type annoncé par le client n'est qu'une indication). */
export function detectType(buffer: Buffer): DetectedType | null {
  if (buffer.length < 12) return null;
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', extension: 'jpg' };
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: 'image/png', extension: 'png' };
  if (startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) && startsWith(buffer, [0x57, 0x45, 0x42, 0x50], 8)) return { mime: 'image/webp', extension: 'webp' };
  if (startsWith(buffer, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { mime: 'application/pdf', extension: 'pdf' };
  return null;
}

/**
 * Jetons PDF qui permettent d'exécuter du code ou d'embarquer des fichiers. Contrôle heuristique : il ne remplace
 * pas un antivirus (non configuré), il écarte les cas les plus courants.
 */
const DANGEROUS_PDF_TOKENS = [/\/JavaScript\b/, /\/JS\b/, /\/Launch\b/, /\/EmbeddedFile\b/, /\/OpenAction\b/, /\/AA\b/];

export interface VerifiedFile {
  mime: DetectedType['mime'];
  extension: DetectedType['extension'];
  size: number;
  sha256: string;
}

export function verifyUpload(body: unknown, declaredType: string | undefined): VerifiedFile {
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw new AppException(415, 'UNSUPPORTED_FILE', 'Corps binaire attendu (image JPEG, PNG, WebP ou PDF)');
  }
  const detected = detectType(body);
  if (!detected) throw new AppException(415, 'UNSUPPORTED_FILE', 'Type de fichier non reconnu : JPEG, PNG, WebP ou PDF uniquement');
  if (declaredType && declaredType.split(';')[0].trim().toLowerCase() !== detected.mime) {
    throw AppException.badRequest('FILE_CONTENT_MISMATCH', 'Le contenu du fichier ne correspond pas à son type annoncé');
  }
  if (detected.mime === 'application/pdf') {
    const text = body.toString('latin1');
    if (DANGEROUS_PDF_TOKENS.some((token) => token.test(text))) {
      throw AppException.badRequest('FILE_REJECTED', 'Ce PDF contient du contenu actif ou des pièces jointes : refusé');
    }
  }
  return { mime: detected.mime, extension: detected.extension, size: body.length, sha256: createHash('sha256').update(body).digest('hex') };
}

/** Nom d'affichage sûr : ni séparateur de chemin, ni caractère de contrôle, longueur limitée. */
export function sanitizeFilename(name: string, extension: string): string {
  const base = name
    .replace(/[\\/]+/g, ' ')
    .replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '')
    .replace(/\.+/g, '.')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 100);
  const withoutExt = base.replace(/\.[A-Za-z0-9]{1,5}$/, '');
  return `${withoutExt || 'fichier'}.${extension}`;
}
