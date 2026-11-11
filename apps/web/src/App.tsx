import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { ContactPage } from './pages/ContactPage';
import { HomePage } from './pages/HomePage';
import { AcceptInvitePage, CalculatorPage, ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage, VerifyEmailPage } from './lazy-pages';
import { AboutPage, FaqPage, HowItWorksPage, LegalPage, ServiceDetailPage, ServicesPage } from './pages/InfoPages';
import { TrackingPage } from './pages/TrackingPage';
import { LocationsPage } from './pages/LocationsPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { LangLayout } from './components/layout/LangLayout';
import { DEFAULT_LANG, detectLang } from './i18n';

const AccountArea = lazy(() => import('./pages/account/AccountArea'));

/** « / » : redirige vers la langue préférée (le serveur sert aussi une page statique de choix de langue). */
function RootRedirect() {
  const lang = typeof window === 'undefined' ? DEFAULT_LANG : detectLang();
  return <Navigate to={`/${lang}`} replace />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/:lang" element={<LangLayout />}>
        <Route index element={<HomePage />} />
        <Route path="about" element={<AboutPage />} />
        <Route path="services" element={<ServicesPage />} />
        <Route path="services/air" element={<ServiceDetailPage kind="air" />} />
        <Route path="services/sea" element={<ServiceDetailPage kind="sea" />} />
        <Route path="services/international" element={<ServiceDetailPage kind="international" />} />
        <Route path="services/local-delivery" element={<ServiceDetailPage kind="local" />} />
        <Route path="calculator" element={<CalculatorPage />} />
        <Route path="tracking" element={<TrackingPage />} />
        <Route path="locations" element={<LocationsPage />} />
        <Route path="how-it-works" element={<HowItWorksPage />} />
        <Route path="faq" element={<FaqPage />} />
        <Route path="contact" element={<ContactPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="forgot-password" element={<ForgotPasswordPage />} />
        <Route path="reset-password" element={<ResetPasswordPage />} />
        <Route path="verify-email" element={<VerifyEmailPage />} />
        <Route path="accept-invite" element={<AcceptInvitePage />} />
        <Route path="terms" element={<LegalPage kind="terms" />} />
        <Route path="privacy" element={<LegalPage kind="privacy" />} />
        <Route
          path="account/*"
          element={
            <Suspense
              fallback={
                <div className="container section">
                  <p role="status">…</p>
                </div>
              }
            >
              <AccountArea />
            </Suspense>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
