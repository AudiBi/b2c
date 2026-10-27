import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';

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
