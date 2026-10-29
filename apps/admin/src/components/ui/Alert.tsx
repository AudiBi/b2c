import type { ReactNode } from 'react';

type Tone = 'info' | 'warning' | 'success' | 'danger';

/** Message d'état. `live` : annoncé aux lecteurs d'écran (erreurs de formulaire, confirmations). */
export function Alert({ tone = 'info', title, children, live }: { tone?: Tone; title?: string; children: ReactNode; live?: boolean }) {
  return (
    <div className={`alert alert-${tone}`} role={live ? (tone === 'danger' ? 'alert' : 'status') : undefined}>
      <div>
        {title ? <strong className="alert-title">{title}</strong> : null}
        {children}
      </div>
    </div>
  );
}
