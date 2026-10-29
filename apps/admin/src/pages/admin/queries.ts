import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ROLE_DEFINITIONS } from '@b2c/shared';
import { api } from '../../api/client';

export interface RoleAssignment {
  userRoleId: string;
  roleCode: string;
  scopeType: 'COMPANY' | 'WAREHOUSE' | 'AGENCY' | 'ROUTE';
  scopeId: string | null;
}

export interface UserItem {
  id: string;
  kind: 'PLATFORM' | 'STAFF' | 'CUSTOMER';
  email: string;
  firstName: string;
  lastName: string;
  businessName: string | null;
  phone: string | null;
  locale: 'fr' | 'ht' | 'en';
  status: 'PENDING' | 'ACTIVE' | 'DISABLED';
  emailVerified: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  roles: RoleAssignment[];
}

export interface RoleItem {
  code: string;
  name: string;
  description: string;
  isSystem: boolean;
  permissions: string[];
}

export interface CompanyItem {
  id: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'SUSPENDED';
  trackingPrefix: string | null;
  customerCodePrefix: string | null;
  defaultCurrency: string;
  defaultLocale: string;
  paymentPolicy: string;
  createdAt: string;
}

export interface UserFilters {
  q: string;
  kind: string;
  status: string;
}

export const adminKeys = {
  users: (filters: UserFilters) => ['admin', 'users', filters] as const,
  usersAll: ['admin', 'users'] as const,
  user: (id: string) => ['admin', 'user', id] as const,
  roles: ['admin', 'roles'] as const,
  companies: ['admin', 'companies'] as const,
};

export const useUsers = (filters: UserFilters) =>
  useInfiniteQuery({
    queryKey: adminKeys.users(filters),
    initialPageParam: '',
    queryFn: ({ pageParam }) => {
      const query = new URLSearchParams({ limit: '25' });
      if (pageParam) query.set('cursor', pageParam);
      if (filters.q) query.set('q', filters.q);
      if (filters.kind) query.set('kind', filters.kind);
      if (filters.status) query.set('status', filters.status);
      return api<{ items: UserItem[]; nextCursor: string | null }>(`/v1/admin/users?${query}`);
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

export const useUser = (id: string) => useQuery({ queryKey: adminKeys.user(id), queryFn: () => api<UserItem>(`/v1/admin/users/${id}`), enabled: !!id });
export const useRoles = (enabled = true) => useQuery({ queryKey: adminKeys.roles, queryFn: () => api<RoleItem[]>('/v1/admin/roles'), enabled });
/** Nom lisible de chaque rôle : celui du serveur s'il est connu, sinon celui du catalogue partagé (jamais le code brut). */
export function useRoleNames(): Map<string, string> {
  const roles = useRoles();
  const names = new Map<string, string>(ROLE_DEFINITIONS.map((r) => [r.code, r.name]));
  for (const r of roles.data ?? []) names.set(r.code, r.name);
  return names;
}

export const useCompanies = () => useQuery({ queryKey: adminKeys.companies, queryFn: () => api<{ items: CompanyItem[] }>('/v1/platform/companies') });
