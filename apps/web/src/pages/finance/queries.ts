import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';

export type InvoiceStatus = 'DRAFT' | 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'VOID' | 'CREDITED';
export type PaymentMethod = 'CASH' | 'BANK_TRANSFER' | 'ZELLE' | 'MOBILE_MONEY';
export type PaymentStatus = 'PENDING' | 'CONFIRMED' | 'FAILED' | 'CANCELLED' | 'REFUNDED_PARTIAL' | 'REFUNDED';
export type LineKind = 'FREIGHT' | 'STORAGE' | 'HANDLING' | 'INSURANCE' | 'TAX' | 'CUSTOMS' | 'DISCOUNT' | 'OTHER';

export interface Payment {
  id: string;
  invoiceId: string;
  method: PaymentMethod;
  status: PaymentStatus;
  currency: string;
  amount: string;
  refundedTotal: string;
  reference: string | null;
  declaredByCustomer: boolean;
  failureReason: string | null;
  confirmedAt: string | null;
  createdAt: string;
  receiptNumber: string | null;
  invoiceNumber?: string | null;
  customerCode?: string;
}

export interface InvoiceSummary {
  id: string;
  number: string | null;
  status: InvoiceStatus;
  customer: { id: string; customerCode: string; name: string };
  currency: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  creditedTotal: string;
  paidTotal: string;
  pendingTotal: string;
  balance: string;
  discountPercent: string | null;
  dueDate: string | null;
  notes: string | null;
  issuedAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  createdAt: string;
}

export interface InvoiceDetail extends InvoiceSummary {
  lines: { id: string; kind: LineKind; description: string; quantity: string; unitPrice: string; amount: string; packageId: string | null }[];
  credits: { id: string; number: string; amount: string; reason: string; createdAt: string }[];
  payments: Payment[];
  packages: { id: string; trackingNumber: string; trackingNumberDisplay: string }[];
}

export interface PaymentOptions {
  cash: boolean;
  declare: ('BANK_TRANSFER' | 'ZELLE' | 'MOBILE_MONEY')[];
  online: boolean;
  instructions: string | null;
}

export interface CashSession {
  id: string;
  agencyId: string | null;
  openedAt: string;
  openingAmount: string;
  closedAt: string | null;
  countedAmount: string | null;
  expectedAmount: string | null;
  difference: string | null;
}

export interface FinanceSummary {
  from: string;
  to: string;
  confirmed: { method: PaymentMethod; currency: string; count: number; collected: string; refunded: string; net: string }[];
  pending: { method: PaymentMethod; currency: string; count: number; amount: string }[];
}

export interface AppNotification {
  id: string;
  eventCode: string;
  subject: string | null;
  body: string;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationLogItem {
  id: string;
  eventCode: string;
  channel: 'IN_APP' | 'EMAIL' | 'WHATSAPP';
  locale: string;
  subject: string | null;
  body: string;
  status: 'QUEUED' | 'SENT' | 'FAILED' | 'SKIPPED';
  skipReason: string | null;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  sentAt: string | null;
  createdAt: string;
  customerCode: string;
}

export interface TemplateItem {
  eventCode: string;
  channel: 'IN_APP' | 'EMAIL';
  locale: 'fr' | 'ht' | 'en';
  variables: string[];
  mandatory: boolean;
  source: 'DEFAULT' | 'COMPANY';
  active: boolean;
  subject: string | null;
  body: string;
}

export const financeKeys = {
  myInvoices: ['me', 'invoices'] as const,
  myPayments: ['me', 'payments'] as const,
  paymentOptions: ['me', 'payment-options'] as const,
  notifications: ['me', 'notifications'] as const,
  invoices: ['staff', 'invoices'] as const,
  payments: ['staff', 'payments'] as const,
  cash: ['staff', 'cash-sessions'] as const,
  settings: ['staff', 'finance-settings'] as const,
  log: ['staff', 'notification-log'] as const,
  templates: ['staff', 'notification-templates'] as const,
};

export const useMyInvoices = (enabled = true) =>
  useInfiniteQuery({
    enabled,
    queryKey: financeKeys.myInvoices,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api<{ items: InvoiceSummary[]; nextCursor: string | null }>(`/v1/me/invoices?limit=20${pageParam ? `&cursor=${pageParam}` : ''}`),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

export const useMyInvoice = (id: string) => useQuery({ queryKey: [...financeKeys.myInvoices, 'one', id] as const, queryFn: () => api<InvoiceDetail>(`/v1/me/invoices/${id}`) });
/** Taux gourdes/dollar (affichage indicatif d'un équivalent) ; absent si l'entreprise n'en a pas fixé. */
export const useFxRate = () => useQuery({ queryKey: ['fx-rate'] as const, queryFn: () => api<{ htgPerUsd: number | null }>('/v1/me/fx-rate'), staleTime: 300_000, retry: false });
export const usePaymentOptions = () => useQuery({ queryKey: financeKeys.paymentOptions, queryFn: () => api<PaymentOptions>('/v1/me/payment-options') });

export const useMyNotifications = (unreadOnly = false) =>
  useQuery({
    queryKey: [...financeKeys.notifications, unreadOnly] as const,
    queryFn: () => api<{ items: AppNotification[]; unread: number; nextCursor: string | null }>(`/v1/me/notifications?limit=50${unreadOnly ? '&unread=true' : ''}`),
  });

/** Nombre de notifications non lues (pastille de la navigation). */
export const useUnreadCount = (enabled: boolean) =>
  useQuery({
    queryKey: [...financeKeys.notifications, 'count'] as const,
    enabled,
    queryFn: async () => (await api<{ unread: number }>('/v1/me/notifications?limit=1')).unread,
  });

export const useStaffInvoices = (filter: { status: string; q: string }) =>
  useInfiniteQuery({
    queryKey: [...financeKeys.invoices, filter] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: '20' });
      if (filter.status) params.set('status', filter.status);
      if (filter.q) params.set('q', filter.q);
      if (pageParam) params.set('cursor', pageParam);
      return api<{ items: InvoiceSummary[]; nextCursor: string | null }>(`/v1/admin/invoices?${params.toString()}`);
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

export const useStaffInvoice = (id: string) => useQuery({ queryKey: [...financeKeys.invoices, 'one', id] as const, queryFn: () => api<InvoiceDetail>(`/v1/admin/invoices/${id}`) });

export const useStaffPayments = (status: string, enabled = true) =>
  useQuery({
    queryKey: [...financeKeys.payments, status] as const,
    queryFn: () => api<{ items: Payment[]; nextCursor: string | null }>(`/v1/admin/payments?limit=50${status ? `&status=${status}` : ''}`),
    enabled,
  });

export const useCashSessions = (enabled = true) => useQuery({ queryKey: financeKeys.cash, queryFn: () => api<{ items: CashSession[] }>('/v1/admin/cash-sessions'), enabled });

export const useFinanceSettings = (enabled = true) =>
  useQuery({ queryKey: financeKeys.settings, queryFn: () => api<{ maxDiscountPercent: number; paymentInstructions: string | null }>('/v1/admin/settings/finance'), enabled });

export const useNotificationLog = (filter: { status: string; channel: string }) =>
  useQuery({
    queryKey: [...financeKeys.log, filter] as const,
    queryFn: () => {
      const params = new URLSearchParams({ limit: '50' });
      if (filter.status) params.set('status', filter.status);
      if (filter.channel) params.set('channel', filter.channel);
      return api<{ items: NotificationLogItem[]; nextCursor: string | null }>(`/v1/admin/notifications?${params.toString()}`);
    },
  });

export const useTemplates = () => useQuery({ queryKey: financeKeys.templates, queryFn: () => api<{ items: TemplateItem[] }>('/v1/admin/notification-templates') });

/** Identifiant de requête pour l'en-tête Idempotency-Key d'un encaissement (une même saisie rejouée ne s'enregistre qu'une fois). */
export const newIdempotencyKey = (): string => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);
