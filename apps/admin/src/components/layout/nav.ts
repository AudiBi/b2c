import type { IconName } from '../ui/Icon';
import type { PageKey } from '../../routes';
import type { Messages } from '../../i18n/fr';
import type { SessionUser } from '../../api/client';

export interface NavItem {
  page: PageKey;
  label: string;
  icon: IconName;
  end?: boolean;
}
export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

/** Navigation du panel, filtrée par les droits de la personne connectée (le serveur reste l'autorité). */
export function buildNav(user: SessionUser, m: Messages): NavGroup[] {
  const can = (permission: string) => user.permissions.includes(permission);
  const staff = user.kind === 'STAFF';
  const n = m.admin.nav;
  const s = m.staff.nav;
  const groups: NavGroup[] = [
    { id: 'overview', label: n.overview, items: [{ page: 'home', label: n.home, icon: 'dashboard', end: true }] },
  ];
  if (staff && can('report:read')) groups[0].items.push({ page: 'accountStaffDashboard', label: s.dashboard, icon: 'chart' });

  const operations: NavItem[] = [];
  if (staff && can('package:receive')) operations.push({ page: 'accountStaffReception', label: s.reception, icon: 'scan' });
  if (staff && can('package:read')) operations.push({ page: 'accountStaffPackages', label: s.packages, icon: 'box' });
  if (staff && can('warehouse:read')) operations.push({ page: 'accountStaffWarehouse', label: s.warehouse, icon: 'warehouse' });
  if (staff && can('shipment:read')) operations.push({ page: 'accountStaffShipments', label: s.shipments, icon: 'layers' });
  if (staff && can('agency:receive')) operations.push({ page: 'accountStaffAgency', label: s.agency, icon: 'building' });
  if (staff && can('delivery:read')) operations.push({ page: 'accountStaffRoutes', label: s.routes, icon: 'route' });
  if (staff && can('delivery:read_assigned')) operations.push({ page: 'accountStaffMyRoutes', label: s.myRoutes, icon: 'truck' });
  if (staff && can('claim:read')) operations.push({ page: 'accountStaffClaims', label: s.claims, icon: 'message' });
  if (operations.length) groups.push({ id: 'operations', label: n.operations, items: operations });

  const finance: NavItem[] = [];
  if (staff && can('invoice:read')) finance.push({ page: 'accountStaffBilling', label: s.billing, icon: 'receipt' });
  if (staff && can('payment:read')) finance.push({ page: 'accountStaffPayments', label: s.payments, icon: 'wallet' });
  if (finance.length) groups.push({ id: 'finance', label: n.finance, items: finance });

  if (staff && can('notification:read')) {
    groups.push({ id: 'communication', label: n.communication, items: [{ page: 'accountStaffNotifications', label: s.notifications, icon: 'bell' }] });
  }

  const admin: NavItem[] = [];
  if (can('user:read')) admin.push({ page: 'users', label: n.users, icon: 'users' });
  if (can('role:read')) admin.push({ page: 'roles', label: n.roles, icon: 'key' });
  if (staff && can('audit:read')) admin.push({ page: 'accountStaffAudit', label: s.audit, icon: 'history' });
  if (admin.length) groups.push({ id: 'administration', label: n.administration, items: admin });

  if (can('company:manage')) groups.push({ id: 'platform', label: n.platform, items: [{ page: 'companies', label: n.companies, icon: 'building' }] });
  return groups;
}
