import { useQuery } from '@tanstack/react-query';
import { config } from '../config';
import { api } from './client';

export interface PublicContact {
  email?: string;
  phones: string[];
  whatsapp?: string;
  address?: string;
  hours?: string;
  facebook?: string;
  instagram?: string;
  tiktok?: string;
  youtube?: string;
}

export interface PublicCompany {
  name: string;
  slug: string;
  defaultLocale: 'fr' | 'ht' | 'en';
  defaultCurrency: string;
  contact: PublicContact;
}

export interface PublicWarehouse {
  reference: string;
  name: string;
  country: string;
  city: string;
  addressLine: string;
}

const base = `/v1/public/companies/${config.companySlug}`;

/** Coordonnées et réglages publics : chargés côté navigateur (le pré-rendu ne dépend pas de l'API). */
export const usePublicCompany = () =>
  useQuery({ queryKey: ['public', 'company'], queryFn: () => api<PublicCompany>(base, { auth: false }), staleTime: 60_000, retry: 1 });

export const usePublicWarehouses = () =>
  useQuery({ queryKey: ['public', 'warehouses'], queryFn: () => api<{ items: PublicWarehouse[] }>(`${base}/warehouses`, { auth: false }), staleTime: 60_000, retry: 1 });
