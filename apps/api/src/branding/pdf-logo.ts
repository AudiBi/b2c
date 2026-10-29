import { LOGO_PNG, LOGO_PNG_RATIO } from './logo-png';

/**
 * Place le logo en haut à droite de la page courante, dans les marges, sans déplacer le curseur de texte.
 * Retourne la largeur occupée, pour que le texte de l'en-tête puisse s'y arrêter.
 */
export function drawLogo(doc: PDFKit.PDFDocument, width = 80): number {
  const x = doc.page.width - doc.page.margins.right - width;
  doc.image(LOGO_PNG, x, doc.page.margins.top, { width, height: width * LOGO_PNG_RATIO });
  return width;
}
