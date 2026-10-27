/**
 * Numéro de suivi : <préfixe 2-4 lettres><10 caractères aléatoires><1 caractère de contrôle>.
 * Alphabet de Crockford (sans I, L, O, U) : pas de confusion à la lecture ou à la dictée.
 * 10 caractères = 50 bits aléatoires : non devinable ; le caractère de contrôle détecte une faute de frappe
 * avant toute requête en base. L'unicité est garantie par une contrainte en base (pas par le hasard seul).
 */
export const TRACKING_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const BODY_LENGTH = 10;
const SUFFIX_LENGTH = BODY_LENGTH + 1;

const valueOf = (char: string) => TRACKING_ALPHABET.indexOf(char);

/**
 * Caractère de contrôle : somme pondérée modulo 32 avec des poids IMPAIRS (1, 3, 5…). Un poids impair est inversible
 * modulo 32 : toute erreur sur un seul caractère change donc la somme et est détectée (des poids pairs en laisseraient
 * passer). La plupart des échanges de caractères voisins sont aussi détectés.
 */
export function trackingCheckChar(prefixAndBody: string): string {
  let sum = 0;
  for (let i = 0; i < prefixAndBody.length; i += 1) {
    const value = valueOf(prefixAndBody[i]);
    if (value < 0) throw new Error(`Caractère invalide dans le numéro de suivi : ${prefixAndBody[i]}`);
    sum += value * (2 * i + 1);
  }
  return TRACKING_ALPHABET[sum % 32];
}

/** Génère un numéro à partir d'une source d'entiers aléatoires sûre (crypto.randomInt côté serveur). */
export function generateTrackingNumber(prefix: string, randomInt: (maxExclusive: number) => number): string {
  const cleanPrefix = prefix.toUpperCase();
  if (!/^[A-Z]{2,4}$/.test(cleanPrefix)) throw new Error('Préfixe de suivi invalide (2 à 4 lettres)');
  let body = '';
  for (let i = 0; i < BODY_LENGTH; i += 1) body += TRACKING_ALPHABET[randomInt(32)];
  // Le contrôle porte sur le préfixe en lettres de l'alphabet : les lettres hors alphabet (I, L, O, U) sont refusées
  const head = `${cleanPrefix}${body}`;
  return `${head}${trackingCheckChar(head)}`;
}

/**
 * Forme canonique d'un numéro saisi par un humain, ou null s'il est invalide :
 * majuscules, espaces et tirets ignorés, O→0, I et L→1 dans la partie aléatoire, caractère de contrôle vérifié.
 */
export function normalizeTrackingNumber(input: string): string | null {
  const clean = input.toUpperCase().replace(/[\s-]/g, '');
  if (clean.length < SUFFIX_LENGTH + 2 || clean.length > SUFFIX_LENGTH + 4) return null;
  const prefix = clean.slice(0, clean.length - SUFFIX_LENGTH);
  if (!/^[A-Z]{2,4}$/.test(prefix)) return null;
  const suffix = clean.slice(-SUFFIX_LENGTH).replace(/O/g, '0').replace(/[IL]/g, '1');
  if ([...suffix].some((char) => valueOf(char) < 0)) return null;
  // Les lettres du préfixe doivent appartenir à l'alphabet pour que le contrôle soit calculable
  if ([...prefix].some((char) => valueOf(char) < 0)) return null;
  const head = `${prefix}${suffix.slice(0, BODY_LENGTH)}`;
  return suffix[BODY_LENGTH] === trackingCheckChar(head) ? `${head}${suffix[BODY_LENGTH]}` : null;
}

/** Affichage lisible : préfixe, puis groupes de 5 (EE-7K3M9-PQ2XA-C). */
export function formatTrackingNumber(canonical: string): string {
  const prefix = canonical.slice(0, canonical.length - SUFFIX_LENGTH);
  const rest = canonical.slice(-SUFFIX_LENGTH);
  return `${prefix}-${rest.slice(0, 5)}-${rest.slice(5, 10)}-${rest.slice(10)}`;
}
