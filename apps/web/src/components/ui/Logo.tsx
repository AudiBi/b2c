/**
 * Logo B2C (fichiers `public/logo-mark.svg` et `public/logo.svg`, vectorisés et allégés à partir du logo fourni).
 * L'image est décorative : le nom de la marque est porté par le texte voisin (lien d'accueil, pied de page).
 *  - « mark » : mot-symbole seul, pour l'en-tête ;
 *  - « full » : avec la ligne « Business to Customer », pour les grands formats.
 */
const RATIO = { mark: 1.823, full: 1.629 } as const;

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
