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

// ---------------------------------------------------------------------------------------------
// Calculateur de frais et suivi public (phase 5)
// ---------------------------------------------------------------------------------------------

export type TransportMode = 'AIR' | 'SEA';
export type LocalizedName = { fr: string; ht: string; en: string };

export interface RateCorridor {
  transportMode: TransportMode;
  originCountry: string;
  destinationCountry: string;
  currency: string;
  weightUnit: 'KG' | 'LB';
  dimensionUnit: 'CM' | 'IN';
  optionalSurcharges: { code: string; name: LocalizedName; method: string; value: string }[];
}

export interface RateOptions {
  corridors: RateCorridor[];
  categories: { code: string; name: LocalizedName; restricted: boolean }[];
}

export interface QuoteLine {
  code: string;
  kind: 'FREIGHT' | 'SURCHARGE' | 'TAX' | 'INSURANCE';
  label: LocalizedName | null;
  amount: string;
}

export interface QuoteResponse {
  isEstimate: true;
  /** Présent seulement lorsque l'estimation a été enregistrée dans l'historique du client. */
  id?: string;
  card: { id: string; name: string; version: number };
  result: {
    currency: string;
    weightUnit: 'KG' | 'LB';
    actualWeight: string;
    volumetricWeight: string | null;
    chargeableBeforeRounding: string;
    roundedWeight: string;
    billableWeight: string;
    freight: string;
    lines: QuoteLine[];
    subtotal: string;
    total: string;
  };
}

export interface QuoteRequest {
  transportMode: TransportMode;
  originCountry: string;
  destinationCountry: string;
  weight: { value: number; unit: 'KG' | 'LB' };
  dimensions?: { length: number; width: number; height: number; unit: 'CM' | 'IN' };
  categoryCode?: string;
  declaredValue?: number;
  optionalSurcharges: string[];
}

export const usePublicRates = () =>
  useQuery({ queryKey: ['public', 'rates'], queryFn: () => api<RateOptions>(`${base}/rates`, { auth: false }), staleTime: 60_000, retry: 1 });

/** Estimation anonyme : rien n'est enregistré. */
export const requestPublicQuote = (body: QuoteRequest) => api<QuoteResponse>(`${base}/quote`, { method: 'POST', body, auth: false });

/** Estimation d'un client connecté : enregistrée dans son historique. */
export const requestCustomerQuote = (body: QuoteRequest) => api<QuoteResponse>('/v1/me/quotes', { method: 'POST', body });

export interface TrackingEvent {
  type: string;
  status: string | null;
  occurredAt: string;
  location: string | null;
  reasonCode: string | null;
}

export interface TrackingResult {
  trackingNumber: string;
  status: string;
  lastUpdate: string;
  transportMode: TransportMode | null;
  origin: { country: string; city: string };
  destination: { country: string; city: string | null };
  estimatedDelivery: string | null;
  pickup: PickupPoint | null;
  events: TrackingEvent[];
}

export const trackPackage = (number: string, signal?: AbortSignal) =>
  api<TrackingResult>(`/v1/public/tracking/${encodeURIComponent(number.trim())}`, { auth: false, signal });

export interface PublicAgency {
  name: string;
  kind: 'AGENCY' | 'PICKUP_POINT';
  country: string;
  city: string;
  addressLine: string;
  phone: string | null;
  hours: string | null;
}

export const usePublicAgencies = () =>
  useQuery({ queryKey: ['public', 'agencies'], queryFn: () => api<{ items: PublicAgency[] }>(`${base}/agencies`, { auth: false }), staleTime: 60_000, retry: 1 });

export interface PickupPoint {
  name: string;
  kind: 'AGENCY' | 'PICKUP_POINT';
  city: string;
  country: string;
  addressLine: string;
  phone: string | null;
  hours: string | null;
  ready: boolean;
}
