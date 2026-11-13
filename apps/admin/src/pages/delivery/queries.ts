import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';

export type RouteStatus = 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export type StopStatus = 'PENDING' | 'DELIVERED' | 'FAILED' | 'REMOVED';
export type ClaimStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'REJECTED';
export type ClaimCategory = 'DAMAGED' | 'LOST' | 'DELAYED' | 'BILLING' | 'SERVICE' | 'OTHER';

export interface RouteSummary {
  id: string;
  reference: string;
  status: RouteStatus;
  plannedDate: string;
  agency: { id: string; name: string; city: string };
  driver: { id: string; name: string };
  notes: string | null;
  startedAt: string | null;
  completedAt: string | null;
  stopCount: number;
  delivered?: number;
  failed?: number;
}

export interface HandoverSettings {
  requireOtp: boolean;
  requireIdDocument: boolean;
  requirePhoto: boolean;
}

export interface BeneficiaryOption {
  id: string;
  fullName: string;
  idDocumentType: string | null;
  idDocumentLast4: string | null;
}

export interface RouteStopItem {
  id: string;
  routeId: string;
  sequence: number;
  status: StopStatus;
  address: { label?: string; recipientName?: string; phone?: string | null; line1?: string; line2?: string | null; city?: string; region?: string | null; postalCode?: string | null } | null;
  instructions: string | null;
  package: { id: string; trackingNumber: string; trackingNumberDisplay: string; description: string | null; status: string };
  customer: { id: string; customerCode: string; name: string; phone: string | null };
  balanceDue: string | null;
  balanceCurrency: string | null;
  unbilled: boolean;
  beneficiaries: BeneficiaryOption[];
}

export interface RouteDetail extends RouteSummary {
  stops: RouteStopItem[];
  settings: HandoverSettings;
}

export interface HandoverInfo {
  package: { id: string; trackingNumberDisplay: string; status: string };
  customer: { id: string; customerCode: string; name: string };
  settings: HandoverSettings;
  beneficiaries: BeneficiaryOption[];
  balance: { due: string; currency: string | null; unbilled: boolean; blocked: boolean };
  failedAttempts: number;
}

export interface DeliveryAttemptItem {
  id: string;
  channel: 'ROUTE' | 'AGENCY';
  outcome: 'SUCCEEDED' | 'FAILED';
  failureReason: string | null;
  note: string | null;
  rescheduleFor: string | null;
  recipientName: string | null;
  recipientKind: 'CUSTOMER' | 'BENEFICIARY' | 'RECIPIENT' | null;
  idDocumentType: string | null;
  idDocumentLast4: string | null;
  otpVerified: boolean;
  balanceOverridden: boolean;
  overrideReason: string | null;
  attemptedAt: string;
}

export interface ClaimItem {
  id: string;
  number: string;
  category: ClaimCategory;
  subject: string;
  status: ClaimStatus;
  resolution: string | null;
  package: { id: string; trackingNumber: string } | null;
  openedAt: string;
  resolvedAt: string | null;
  updatedAt: string;
  customer?: { id: string; customerCode: string; name: string };
  assignedTo?: { id: string; name: string } | null;
}

export interface ClaimMessageItem {
  id: string;
  author: 'CUSTOMER' | 'STAFF';
  body: string;
  createdAt: string;
  internal?: boolean;
}

export interface ClaimDetail extends ClaimItem {
  messages: ClaimMessageItem[];
}

export interface AuditItem {
  id: string;
  actorUserId: string | null;
  actorType: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
}

export interface Dashboard {
  range: { from: string; to: string };
  generatedAt: string;
  customers: { total: number; newInRange: number };
  packages: { receivedInRange: number; deliveredInRange: number; inTransit: number; awaitingPayment: number; toDeliver: number; onHold: number; byStatus: Record<string, number> };
  shipments: { byMode: { mode: 'AIR' | 'SEA'; count: number }[] };
  warehouses: { id: string; name: string; city: string; atWarehouse: number; receivedInRange: number }[];
  finance: {
    collected: { currency: string; amount: string; count?: number }[];
    refunded: { currency: string; amount: string }[];
    invoiced: { currency: string; amount: string; count?: number }[];
    unpaid: { currency: string; amount: string; count?: number }[];
  };
  incidents: { openHolds: number; holdsOpenedInRange: number; claimsByStatus: Record<ClaimStatus, number>; claimsOpenInProgress: number; claimsOpenedInRange: number };
  delays: Record<'warehouseReceiptToReady' | 'transport' | 'agencyReceiptToDelivered', { count: number; avgHours: number | null }>;
  agencies: { id: string; name: string; city: string; inAgency: number; deliveredInRange: number; avgHoursToDeliver: number | null }[];
  drivers: { id: string; name: string; succeeded: number; failed: number; successRate: number | null }[];
}

export const deliveryKeys = {
  routes: ['staff', 'routes'] as const,
  myRoutes: ['staff', 'my-routes'] as const,
  claims: ['staff', 'claims'] as const,
  myClaims: ['me', 'claims'] as const,
  settings: ['staff', 'delivery-settings'] as const,
  dashboard: ['staff', 'dashboard'] as const,
  audit: ['staff', 'audit'] as const,
};

export const useRoutes = (mine: boolean, filter: { status: string }) =>
  useQuery({
    queryKey: [...(mine ? deliveryKeys.myRoutes : deliveryKeys.routes), filter] as const,
    queryFn: () => api<{ items: RouteSummary[]; nextCursor: string | null }>(`/v1/admin/${mine ? 'my-routes' : 'routes'}?limit=50${filter.status ? `&status=${filter.status}` : ''}`),
  });

export const useRoute = (id: string, mine: boolean) =>
  useQuery({
    queryKey: [...(mine ? deliveryKeys.myRoutes : deliveryKeys.routes), 'one', id] as const,
    queryFn: () => api<RouteDetail>(`/v1/admin/${mine ? 'my-routes' : 'routes'}/${id}`),
  });

export const useHandoverInfo = (packageId: string, enabled: boolean) =>
  useQuery({ queryKey: ['staff', 'handover-info', packageId] as const, enabled, queryFn: () => api<HandoverInfo>(`/v1/admin/packages/${packageId}/handover-info`) });

export const useDeliveryAttempts = (packageId: string, enabled: boolean) =>
  useQuery({ queryKey: ['staff', 'delivery-attempts', packageId] as const, enabled, queryFn: () => api<{ items: DeliveryAttemptItem[] }>(`/v1/admin/packages/${packageId}/delivery-attempts`) });

export const useDeliverySettings = (enabled = true) =>
  useQuery({ queryKey: deliveryKeys.settings, enabled, queryFn: () => api<HandoverSettings>('/v1/admin/settings/delivery') });

export const useStaffClaims = (filter: { status: string; q: string }) =>
  useInfiniteQuery({
    queryKey: [...deliveryKeys.claims, filter] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: '20' });
      if (filter.status) params.set('status', filter.status);
      if (filter.q) params.set('q', filter.q);
      if (pageParam) params.set('cursor', pageParam);
      return api<{ items: ClaimItem[]; nextCursor: string | null }>(`/v1/admin/claims?${params.toString()}`);
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

export const useStaffClaim = (id: string) => useQuery({ queryKey: [...deliveryKeys.claims, 'one', id] as const, queryFn: () => api<ClaimDetail>(`/v1/admin/claims/${id}`) });

export const useMyClaims = () => useQuery({ queryKey: deliveryKeys.myClaims, queryFn: () => api<{ items: ClaimItem[]; nextCursor: string | null }>('/v1/me/claims?limit=50') });
export const useMyClaim = (id: string) => useQuery({ queryKey: [...deliveryKeys.myClaims, 'one', id] as const, queryFn: () => api<ClaimDetail>(`/v1/me/claims/${id}`) });

export const useDashboard = (range: { from: string; to: string } | null, enabled: boolean) =>
  useQuery({
    queryKey: [...deliveryKeys.dashboard, range] as const,
    enabled,
    queryFn: () => api<Dashboard>(`/v1/admin/dashboard${range ? `?from=${range.from}&to=${range.to}` : ''}`),
  });

export const useAudit = (filter: { action: string; entityType: string }) =>
  useInfiniteQuery({
    queryKey: [...deliveryKeys.audit, filter] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: '25' });
      if (filter.action) params.set('action', filter.action);
      if (filter.entityType) params.set('entityType', filter.entityType);
      if (pageParam) params.set('cursor', pageParam);
      return api<{ items: AuditItem[]; nextCursor: string | null }>(`/v1/audit?${params.toString()}`);
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
