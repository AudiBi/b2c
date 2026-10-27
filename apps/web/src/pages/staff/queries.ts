import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';

export type TransportMode = 'AIR' | 'SEA';

export interface StaffPackage {
  id: string;
  trackingNumber: string;
  trackingNumberDisplay: string;
  status: string;
  previousStatus: string | null;
  customer: { id: string; customerCode: string; name: string | null } | null;
  warehouse: { id: string; reference: string; name: string; city: string };
  originCountry: string;
  originCity: string;
  destinationCountry: string;
  destinationCity: string | null;
  transportMode: TransportMode | null;
  supplierTracking: string | null;
  contentDescription: string | null;
  declaredValue: string | null;
  declaredCurrency: string | null;
  destinationAgencyId: string | null;
  locationId: string | null;
  measures: { actualWeightKg: string | null; billableWeight: string | null; weightUnit: 'KG' | 'LB' | null };
}

export interface StaffEvent {
  id: string;
  type: string;
  from: string | null;
  to: string | null;
  reason: string | null;
  visibility: 'PUBLIC' | 'PRIVATE';
  location: string | null;
  occurredAt: string;
}

export interface StaffPackageDetail extends StaffPackage {
  events: StaffEvent[];
  holds: { id: string; reasonCode: string; note: string | null; openedAt: string; releasedAt: string | null }[];
  prealert: { storeName: string; purchaseAmount: string; purchaseCurrency: string } | null;
}

export interface WarehouseItem {
  id: string;
  reference: string;
  name: string;
  city: string;
  country: string;
}

export interface AgencyItem {
  id: string;
  code: string;
  name: string;
  city: string;
  country: string;
}

export interface LocationItem {
  id: string;
  code: string;
  kind: 'ZONE' | 'SHELF' | 'BIN';
  status: string;
}

export interface Inventory {
  warehouse: WarehouseItem;
  total: number;
  unplaced: number;
  locations: (LocationItem & { count: number })[];
  items: StaffPackage[];
  truncated: boolean;
}

export interface Anomalies {
  holds: { id: string; reasonCode: string; note: string | null; openedAt: string; package: StaffPackage }[];
  unidentified: StaffPackage[];
}

export interface ShipmentSummary {
  id: string;
  reference: string;
  status: 'OPEN' | 'DISPATCHED' | 'ARRIVED' | 'IN_CUSTOMS' | 'CLOSED' | 'CANCELLED';
  transportMode: TransportMode;
  origin: WarehouseItem;
  destination: { country: string; city: string | null; agency: { id: string; code: string; name: string; city: string } | null };
  carrierName: string | null;
  transportRef: string | null;
  notes: string | null;
  departedAt: string | null;
  arrivedAt: string | null;
  packageCount: number;
}

export interface ShipmentDetail extends ShipmentSummary {
  totals: { count: number; actualWeightKg: string; declared: Record<string, string> };
  packages: StaffPackage[];
  events: { id: string; type: string; from: string | null; to: string | null; note: string | null; occurredAt: string }[];
}

export const staffKeys = {
  warehouses: ['staff', 'warehouses'] as const,
  agencies: ['staff', 'agencies'] as const,
  packages: ['staff', 'packages'] as const,
  shipments: ['staff', 'shipments'] as const,
  inventory: (warehouseId: string) => ['staff', 'inventory', warehouseId] as const,
  locations: (warehouseId: string) => ['staff', 'locations', warehouseId] as const,
  anomalies: ['staff', 'anomalies'] as const,
  agencyPackages: (agencyId: string) => ['staff', 'agency-packages', agencyId] as const,
};

/** Indication d'interface seulement : le serveur contrôle chaque droit (et sa portée) à chaque requête. */
export function useCan(permission: string): boolean {
  const { user } = useAuth();
  return !!user?.permissions.includes(permission);
}

export const useWarehouses = () => useQuery({ queryKey: staffKeys.warehouses, queryFn: () => api<{ items: WarehouseItem[] }>('/v1/admin/warehouses') });
export const useAgencies = () => useQuery({ queryKey: staffKeys.agencies, queryFn: () => api<{ items: AgencyItem[] }>('/v1/admin/agencies') });

export const useLocations = (warehouseId: string) =>
  useQuery({
    queryKey: staffKeys.locations(warehouseId),
    queryFn: () => api<{ items: LocationItem[] }>(`/v1/admin/warehouses/${warehouseId}/locations`),
    enabled: !!warehouseId,
  });

export const useInventory = (warehouseId: string, locationId: string) =>
  useQuery({
    queryKey: [...staffKeys.inventory(warehouseId), locationId] as const,
    queryFn: () => api<Inventory>(`/v1/admin/warehouses/${warehouseId}/inventory${locationId ? `?locationId=${locationId}` : ''}`),
    enabled: !!warehouseId,
  });

export const useAnomalies = () => useQuery({ queryKey: staffKeys.anomalies, queryFn: () => api<Anomalies>('/v1/admin/anomalies') });

export const useStaffPackages = (filter: { status: string; q: string; unidentified: boolean }) =>
  useInfiniteQuery({
    queryKey: [...staffKeys.packages, filter] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: '20' });
      if (filter.status) params.set('status', filter.status);
      if (filter.q) params.set('q', filter.q);
      if (filter.unidentified) params.set('unidentified', 'true');
      if (pageParam) params.set('cursor', pageParam);
      return api<{ items: StaffPackage[]; nextCursor: string | null }>(`/v1/admin/packages?${params.toString()}`);
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

export const useStaffPackage = (id: string) =>
  useQuery({ queryKey: [...staffKeys.packages, 'one', id] as const, queryFn: () => api<StaffPackageDetail>(`/v1/admin/packages/${id}`) });

export const useShipments = () => useQuery({ queryKey: staffKeys.shipments, queryFn: () => api<{ items: ShipmentSummary[] }>('/v1/admin/shipments?limit=50') });

export const useShipment = (id: string) =>
  useQuery({ queryKey: [...staffKeys.shipments, 'one', id] as const, queryFn: () => api<ShipmentDetail>(`/v1/admin/shipments/${id}`) });

export const useAgencyPackages = (agencyId: string) =>
  useQuery({
    queryKey: staffKeys.agencyPackages(agencyId),
    queryFn: () => api<{ agency: AgencyItem; expected: number; items: StaffPackage[] }>(`/v1/admin/agencies/${agencyId}/packages`),
    enabled: !!agencyId,
  });
