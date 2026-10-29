import type { ReactNode } from 'react';

/** En-tête d'écran : titre, description et actions principales alignées à droite. */
export function PageHead({ title, lead, actions }: { title: string; lead?: string; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {lead ? <p className="lead">{lead}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}
