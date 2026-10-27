import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { TimelineEvent } from '../../components/PackageParts';

export interface NotificationPrefs {
  email: boolean;
  sms: boolean;
  whatsapp: boolean;
  inApp: boolean;
}

export interface Profile {
  id: string;
  kind: 'PLATFORM' | 'STAFF' | 'CUSTOMER';
  email: string;
  emailVerified: boolean;
  firstName: string;
  lastName: string;
  phone: string | null;
  phoneVerified: boolean;
  locale: 'fr' | 'ht' | 'en';
  businessName: string | null;
  customer: { id: string; customerCode: string; customerType: 'INDIVIDUAL' | 'BUSINESS'; notificationPrefs: NotificationPrefs } | null;
}

export interface Address {
  id: string;
  kind: 'PERSONAL' | 'DELIVERY';
  label: string;
  recipientName: string;
  phone: string | null;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  country: string;
  postalCode: string | null;
  instructions: string | null;
  isDefault: boolean;
}

export interface Beneficiary {
  id: string;
  fullName: string;
  idDocumentType: string | null;
  idDocumentLast4: string | null;
  phone: string | null;
  validFrom: string | null;
  validTo: string | null;
}

export interface ReceivingResult {
  customerCode: string;
  warehouses: {
    id: string;
    reference: string;
    name: string;
    country: string;
    city: string;
    addresses: { mode: 'AIR' | 'SEA'; lines: string[] }[];
  }[];
}

export const keys = {
  profile: ['me', 'profile'] as const,
  addresses: ['me', 'addresses'] as const,
  beneficiaries: ['me', 'beneficiaries'] as const,
  receiving: ['me', 'receiving'] as const,
};

export const useProfile = () => useQuery({ queryKey: keys.profile, queryFn: () => api<Profile>('/v1/me/profile') });
export const useAddresses = () => useQuery({ queryKey: keys.addresses, queryFn: () => api<{ items: Address[] }>('/v1/me/addresses') });
export const useBeneficiaries = () => useQuery({ queryKey: keys.beneficiaries, queryFn: () => api<{ items: Beneficiary[] }>('/v1/me/beneficiaries') });
export const useReceiving = () => useQuery({ queryKey: keys.receiving, queryFn: () => api<ReceivingResult>('/v1/me/receiving-addresses') });

// ---------------------------------------------------------------------------------------------
// Préalertes, colis et pièces jointes (phase 5)
// ---------------------------------------------------------------------------------------------

export type TransportMode = 'AIR' | 'SEA';
export type PrealertStatus = 'OPEN' | 'MATCHED_AUTO' | 'MATCHED_MANUAL' | 'CANCELLED';

export interface Prealert {
  id: string;
  status: PrealertStatus;
  storeName: string;
  orderNumber: string | null;
  supplierTracking: string | null;
  transportMode: TransportMode;
  purchaseAmount: string;
  purchaseCurrency: string;
  description: string;
  warehouse: { id: string; name: string; city: string; country: string };
  package: { id: string; trackingNumber: string; status: string };
  createdAt: string;
}

export interface PackageSummary {
  id: string;
  trackingNumber: string;
  trackingNumberDisplay: string;
  status: string;
  transportMode: TransportMode | null;
  supplierTracking: string | null;
  contentDescription: string | null;
  origin: { country: string; city: string; warehouse: string };
  destination: { country: string; city: string | null };
  measures: { actualWeightKg: string | null; billableWeight: string | null; weightUnit: 'KG' | 'LB' };
  fees: { freight: string; extras: string | null; currency: string; provisional: true } | null;
  receivedAt: string | null;
  createdAt: string;
}

export interface PackageDetail extends PackageSummary {
  events: TimelineEvent[];
}

export interface FileItem {
  id: string;
  kind: 'PHOTO' | 'INVOICE' | 'DOCUMENT';
  name: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export const accountKeys = {
  prealerts: ['me', 'prealerts'] as const,
  packages: ['me', 'packages'] as const,
  files: (ownerType: string, ownerId: string) => ['me', 'files', ownerType, ownerId] as const,
};

export const usePrealerts = () => useQuery({ queryKey: accountKeys.prealerts, queryFn: () => api<{ items: Prealert[] }>('/v1/me/prealerts') });

export const usePackages = (filter: { status: string; q: string }) =>
  useInfiniteQuery({
    queryKey: [...accountKeys.packages, filter] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: '20' });
      if (filter.status) params.set('status', filter.status);
      if (filter.q) params.set('q', filter.q);
      if (pageParam) params.set('cursor', pageParam);
      return api<{ items: PackageSummary[]; nextCursor: string | null }>(`/v1/me/packages?${params.toString()}`);
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

export const usePackage = (id: string) =>
  useQuery({ queryKey: [...accountKeys.packages, 'one', id] as const, queryFn: () => api<PackageDetail>(`/v1/me/packages/${id}`) });

export const useFiles = (ownerType: 'PREALERT' | 'PACKAGE', ownerId: string) =>
  useQuery({
    queryKey: accountKeys.files(ownerType, ownerId),
    queryFn: () => api<{ items: FileItem[] }>(`/v1/files?${new URLSearchParams({ ownerType, ownerId }).toString()}`),
  });
