import { Route, Routes } from 'react-router';
import { AccountLayout } from './AccountLayout';
import { AddressesPage } from './AddressesPage';
import { BeneficiariesPage } from './BeneficiariesPage';
import { ClaimDetailPage, ClaimsPage } from './ClaimsPage';
import { DashboardPage } from './DashboardPage';
import { InvoiceDetailPage, InvoicesPage } from './InvoicesPage';
import { NotificationsPage } from './NotificationsPage';
import { PackageDetailPage, PackagesPage } from './PackagesPage';
import { PrealertsPage } from './PrealertsPage';
import { ProfilePage } from './ProfilePage';
import { ReceivingPage } from './ReceivingPage';
import { SecurityPage } from './SecurityPage';
import { TeamPage } from './TeamPage';

/** Espace client : chargé à la demande (les visiteurs non connectés ne téléchargent pas ce code). */
export default function AccountArea() {
  return (
    <Routes>
      <Route element={<AccountLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="addresses" element={<AddressesPage />} />
        <Route path="beneficiaries" element={<BeneficiariesPage />} />
        <Route path="receiving-addresses" element={<ReceivingPage />} />
        <Route path="prealerts" element={<PrealertsPage />} />
        <Route path="packages" element={<PackagesPage />} />
        <Route path="packages/:id" element={<PackageDetailPage />} />
        <Route path="invoices" element={<InvoicesPage />} />
        <Route path="invoices/:id" element={<InvoiceDetailPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="claims" element={<ClaimsPage />} />
        <Route path="claims/:id" element={<ClaimDetailPage />} />
        <Route path="team" element={<TeamPage />} />
        <Route path="security" element={<SecurityPage />} />
      </Route>
    </Routes>
  );
}
