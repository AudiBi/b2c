import { AcceptInvitePage, CalculatorPage, ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage, VerifyEmailPage } from './lazy-pages';

const byPath: [RegExp, { preload: () => Promise<void> }][] = [
  [/^\/(fr|ht|en)\/login\/?$/, LoginPage],
  [/^\/(fr|ht|en)\/register\/?$/, RegisterPage],
  [/^\/(fr|ht|en)\/forgot-password\/?$/, ForgotPasswordPage],
  [/^\/(fr|ht|en)\/reset-password\/?$/, ResetPasswordPage],
  [/^\/(fr|ht|en)\/verify-email\/?$/, VerifyEmailPage],
  [/^\/(fr|ht|en)\/accept-invite\/?$/, AcceptInvitePage],
  [/^\/(fr|ht|en)\/calculator\/?$/, CalculatorPage],
];

/** Précharge la page demandée avant l'hydratation (même HTML que le rendu serveur, aucun clignotement). */
export async function preloadRoute(pathname: string): Promise<void> {
  await byPath.find(([pattern]) => pattern.test(pathname))?.[1].preload();
}

/** Rendu serveur et tests : toutes les pages à chargement différé. */
export async function preloadAllPages(): Promise<void> {
  await Promise.all(byPath.map(([, page]) => page.preload()));
}
