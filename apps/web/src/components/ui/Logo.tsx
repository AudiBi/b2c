/**
 * Logo B2C Shipping Express (fichiers `public/logo-mark.svg` et `public/logo.svg`, allégés à partir du logo vectoriel fourni).
 * L'image est décorative : le nom de la marque est porté par le texte voisin (lien d'accueil, pied de page).
 *  - « mark » : symbole « B2C » seul, pour l'en-tête ;
 *  - « full » : avec la ligne « SHIPPING EXPRESS », pour les grands formats.
 */
const RATIO = { mark: 1.758, full: 1.559 } as const;

export function Logo({ variant = 'mark', height = 48, className }: { variant?: keyof typeof RATIO; height?: number; className?: string }) {
  return (
    <img
      className={className}
      src={variant === 'mark' ? '/logo-mark.svg' : '/logo.svg'}
      alt=""
      width={Math.round(height * RATIO[variant])}
      height={height}
      decoding="async"
    />
  );
}
