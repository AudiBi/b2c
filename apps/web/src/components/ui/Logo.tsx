/** Marque graphique provisoire (colis stylisé). À remplacer par le logo de l'entreprise. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="14" fill="#0b2545" />
      <path d="M32 12 14 21v22l18 9 18-9V21z" fill="none" stroke="#f2a541" strokeWidth="4" strokeLinejoin="round" />
      <path d="M14 21l18 9 18-9M32 30v22" fill="none" stroke="#f2a541" strokeWidth="4" strokeLinejoin="round" />
    </svg>
  );
}
