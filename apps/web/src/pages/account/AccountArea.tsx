import { Route, Routes } from 'react-router';
import { AccountLayout } from './AccountLayout';
import { AddressesPage } from './AddressesPage';
import { BeneficiariesPage } from './BeneficiariesPage';
import { DashboardPage } from './DashboardPage';
import { PackageDetailPage, PackagesPage } from './PackagesPage';
import { PrealertsPage } from './PrealertsPage';
import { ProfilePage } from './ProfilePage';
import { ReceivingPage } from './ReceivingPage';
import { SecurityPage } from './SecurityPage';
import { StaffAgencyPage } from '../staff/StaffAgencyPage';
import { StaffPackageDetailPage } from '../staff/StaffPackageDetailPage';
import { StaffPackagesPage } from '../staff/StaffPackagesPage';
import { StaffReceptionPage } from '../staff/StaffReceptionPage';
import { StaffShipmentDetailPage } from '../staff/StaffShipmentDetailPage';
import { StaffShipmentsPage } from '../staff/StaffShipmentsPage';
import { StaffWarehousePage } from '../staff/StaffWarehousePage';

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
        <Route path="staff/reception" element={<StaffReceptionPage />} />
        <Route path="staff/packages" element={<StaffPackagesPage />} />
        <Route path="staff/packages/:id" element={<StaffPackageDetailPage />} />
        <Route path="staff/warehouse" element={<StaffWarehousePage />} />
        <Route path="staff/shipments" element={<StaffShipmentsPage />} />
        <Route path="staff/shipments/:id" element={<StaffShipmentDetailPage />} />
        <Route path="staff/agency" element={<StaffAgencyPage />} />
        <Route path="security" element={<SecurityPage />} />
      </Route>
    </Routes>
  );
}
