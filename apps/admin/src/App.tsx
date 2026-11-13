import { lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router';
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
        <Route path="packages" element={<StaffPackagesPage />} />
        <Route path="packages/:id" element={<StaffPackageDetailPage />} />
        <Route path="warehouse" element={<StaffWarehousePage />} />
        <Route path="shipments" element={<StaffShipmentsPage />} />
        <Route path="shipments/:id" element={<StaffShipmentDetailPage />} />
        <Route path="agency" element={<StaffAgencyPage />} />
        <Route path="routes" element={<StaffRoutesPage />} />
        <Route path="routes/:id" element={<StaffRouteDetailPage />} />
        <Route path="my-routes" element={<StaffRoutesPage mine />} />
        <Route path="my-routes/:id" element={<StaffRouteDetailPage mine />} />
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
