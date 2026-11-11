// Pages qui embarquent la validation de formulaires (zod) : chargées à la demande pour alléger le premier chargement des autres pages.
import { lazyPage } from './lazy-page';

export const LoginPage = lazyPage(() => import('./pages/AuthPages').then((m) => m.LoginPage));
export const RegisterPage = lazyPage(() => import('./pages/AuthPages').then((m) => m.RegisterPage));
export const ForgotPasswordPage = lazyPage(() => import('./pages/AuthPages').then((m) => m.ForgotPasswordPage));
export const ResetPasswordPage = lazyPage(() => import('./pages/AuthPages').then((m) => m.ResetPasswordPage));
export const VerifyEmailPage = lazyPage(() => import('./pages/AuthPages').then((m) => m.VerifyEmailPage));
export const AcceptInvitePage = lazyPage(() => import('./pages/AuthPages').then((m) => m.AcceptInvitePage));
export const CalculatorPage = lazyPage(() => import('./pages/CalculatorPage').then((m) => m.CalculatorPage));
