import { lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { config } from './config';
import { AcceptInvitePage, ForgotPasswordPage, LoginPage, ResetPasswordPage } from './pages/AuthPages';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { AdminShell } from './components/layout/AdminShell';

// Chaque écran métier est chargé à la demande : la première page affichée reste légère
const StaffAgencyPage = lazy(() => import('./pages/staff/StaffAgencyPage').then((m) => ({ default: m.StaffAgencyPage })));
const StaffAuditPage = lazy(() => import('./pages/staff/StaffAuditPage').then((m) => ({ default: m.StaffAuditPage })));
const StaffClaimDetailPage = lazy(() => import('./pages/staff/StaffClaimsPage').then((m) => ({ default: m.StaffClaimDetailPage })));
const StaffClaimsPage = lazy(() => import('./pages/staff/StaffClaimsPage').then((m) => ({ default: m.StaffClaimsPage })));
const StaffDashboardPage = lazy(() => import('./pages/staff/StaffDashboardPage').then((m) => ({ default: m.StaffDashboardPage })));
const StaffInvoiceDetailPage = lazy(() => import('./pages/staff/StaffInvoiceDetailPage').then((m) => ({ default: m.StaffInvoiceDetailPage })));
const StaffInvoicesPage = lazy(() => import('./pages/staff/StaffInvoicesPage').then((m) => ({ default: m.StaffInvoicesPage })));
const StaffNotificationsPage = lazy(() => import('./pages/staff/StaffNotificationsPage').then((m) => ({ default: m.StaffNotificationsPage })));
const StaffPackageDetailPage = lazy(() => import('./pages/staff/StaffPackageDetailPage').then((m) => ({ default: m.StaffPackageDetailPage })));
const StaffPackagesPage = lazy(() => import('./pages/staff/StaffPackagesPage').then((m) => ({ default: m.StaffPackagesPage })));
const StaffPaymentsPage = lazy(() => import('./pages/staff/StaffPaymentsPage').then((m) => ({ default: m.StaffPaymentsPage })));
const StaffReceptionPage = lazy(() => import('./pages/staff/StaffReceptionPage').then((m) => ({ default: m.StaffReceptionPage })));
const StaffRouteDetailPage = lazy(() => import('./pages/staff/StaffRouteDetailPage').then((m) => ({ default: m.StaffRouteDetailPage })));
const StaffRoutesPage = lazy(() => import('./pages/staff/StaffRoutesPage').then((m) => ({ default: m.StaffRoutesPage })));
const StaffShipmentDetailPage = lazy(() => import('./pages/staff/StaffShipmentDetailPage').then((m) => ({ default: m.StaffShipmentDetailPage })));
const StaffShipmentsPage = lazy(() => import('./pages/staff/StaffShipmentsPage').then((m) => ({ default: m.StaffShipmentsPage })));
const StaffWarehousePage = lazy(() => import('./pages/staff/StaffWarehousePage').then((m) => ({ default: m.StaffWarehousePage })));
const SecurityPage = lazy(() => import('./pages/security/SecurityPage').then((m) => ({ default: m.SecurityPage })));
const UsersPage = lazy(() => import('./pages/admin/UsersPage').then((m) => ({ default: m.UsersPage })));
const UserDetailPage = lazy(() => import('./pages/admin/UserDetailPage').then((m) => ({ default: m.UserDetailPage })));
const RolesPage = lazy(() => import('./pages/admin/RolesPage').then((m) => ({ default: m.RolesPage })));
const StaffCounterPage = lazy(() => import('./pages/staff/StaffCounterPage').then((m) => ({ default: m.StaffCounterPage })));
const StaffCustomsPage = lazy(() => import('./pages/staff/StaffCustomsPage').then((m) => ({ default: m.StaffCustomsPage })));
const StaffRateCardsPage = lazy(() => import('./pages/staff/StaffRateCardsPage').then((m) => ({ default: m.StaffRateCardsPage })));
const StaffProfitPage = lazy(() => import('./pages/staff/StaffProfitPage').then((m) => ({ default: m.StaffProfitPage })));
const StaffExpensesPage = lazy(() => import('./pages/staff/StaffExpensesPage').then((m) => ({ default: m.StaffExpensesPage })));
const StaffPettyCashPage = lazy(() => import('./pages/staff/StaffPettyCashPage').then((m) => ({ default: m.StaffPettyCashPage })));
const StaffDepositsPage = lazy(() => import('./pages/staff/StaffDepositsPage').then((m) => ({ default: m.StaffDepositsPage })));
const StaffReferrersPage = lazy(() => import('./pages/staff/StaffReferrersPage').then((m) => ({ default: m.StaffReferrersPage })));
const StaffDelaysPage = lazy(() => import('./pages/staff/StaffDelaysPage').then((m) => ({ default: m.StaffDelaysPage })));
const StaffProformasPage = lazy(() => import('./pages/staff/StaffProformasPage').then((m) => ({ default: m.StaffProformasPage })));
const StaffSettingsPage = lazy(() => import('./pages/staff/StaffSettingsPage').then((m) => ({ default: m.StaffSettingsPage })));
const CompaniesPage = lazy(() => import('./pages/admin/CompaniesPage').then((m) => ({ default: m.CompaniesPage })));

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/accept-invite" element={<AcceptInvitePage />} />
      <Route element={<AdminShell />}>
        <Route index element={<HomePage />} />
        <Route path="dashboard" element={<StaffDashboardPage />} />
        <Route path="reception" element={<StaffReceptionPage />} />
        <Route path="counter" element={<StaffCounterPage />} />
        <Route path="customs" element={<StaffCustomsPage />} />
        <Route path="rates" element={<StaffRateCardsPage />} />
        <Route path="profit" element={<StaffProfitPage />} />
        <Route path="expenses" element={<StaffExpensesPage />} />
        <Route path="petty-cash" element={<StaffPettyCashPage />} />
        <Route path="deposits" element={<StaffDepositsPage />} />
        <Route path="referrers" element={<StaffReferrersPage />} />
        <Route path="delays" element={<StaffDelaysPage />} />
        <Route path="proformas" element={<StaffProformasPage />} />
        <Route path="settings" element={<StaffSettingsPage />} />
        <Route path="packages" element={<StaffPackagesPage />} />
        <Route path="packages/:id" element={<StaffPackageDetailPage />} />
        <Route path="warehouse" element={<StaffWarehousePage />} />
        <Route path="shipments" element={<StaffShipmentsPage />} />
        <Route path="shipments/:id" element={<StaffShipmentDetailPage />} />
        <Route path="agency" element={<StaffAgencyPage />} />
        {config.features.delivery ? (
          <>
            <Route path="routes" element={<StaffRoutesPage />} />
            <Route path="routes/:id" element={<StaffRouteDetailPage />} />
            <Route path="my-routes" element={<StaffRoutesPage mine />} />
            <Route path="my-routes/:id" element={<StaffRouteDetailPage mine />} />
          </>
        ) : null}
        <Route path="claims" element={<StaffClaimsPage />} />
        <Route path="claims/:id" element={<StaffClaimDetailPage />} />
        <Route path="billing" element={<StaffInvoicesPage />} />
        <Route path="billing/:id" element={<StaffInvoiceDetailPage />} />
        <Route path="payments" element={<StaffPaymentsPage />} />
        <Route path="notifications" element={<StaffNotificationsPage />} />
        <Route path="audit" element={<StaffAuditPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="users/:id" element={<UserDetailPage />} />
        <Route path="roles" element={<RolesPage />} />
        <Route path="companies" element={<CompaniesPage />} />
        <Route path="security" element={<SecurityPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
