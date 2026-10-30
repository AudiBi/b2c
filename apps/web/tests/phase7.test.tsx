import { QueryClient } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../src/App';
import { catalogs } from '../src/i18n';
import { AppProviders } from '../src/providers';

const fr = catalogs.fr;
const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Handler = object | ((init: RequestInit | undefined, url: URL) => Response | Promise<Response>);
const fetchMock = vi.fn();

function mockApi(handlers: Record<string, Handler>) {
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const key = `${init?.method ?? 'GET'} ${url.pathname}`;
    const handler = handlers[key];
    if (handler === undefined) return json(404, { error: { code: 'NOT_FOUND', message: 'x' } });
    return typeof handler === 'function' ? (handler as (i: RequestInit | undefined, u: URL) => Response | Promise<Response>)(init, url) : json(200, handler);
  });
}
const calls = (key: string) =>
  fetchMock.mock.calls.filter(([input, init]) => `${(init as RequestInit | undefined)?.method ?? 'GET'} ${new URL(String(input), 'http://localhost').pathname}` === key);
const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body));

function renderAt(url: string) {
  return render(
    <AppProviders client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[url]}>
        <AppRoutes />
      </MemoryRouter>
    </AppProviders>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = 'b2c_session=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
});

const INV = '3f2b8c1e-9d4a-4e6b-8a1f-2c7d5e9b0a11';
const PAY = '5a9d1c2e-7b3f-4c8a-9e1d-6f4b2a8c0d33';
const CUS = '7c1e9a4b-2d5f-4e8a-b3c6-1a9d7f5e2b44';
const PKG = '9e3b5d7a-1c4f-4a6e-8b2d-3f7a1c9e5d55';
const NOT = '1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d';

const user = (kind: 'CUSTOMER' | 'STAFF', permissions: string[]) => ({
  id: 'u1', companyId: 'c1', kind, email: 'test@example.test', firstName: 'Test', lastName: 'User',
  locale: 'fr', emailVerified: true, roles: [], permissions,
});
function signedIn(kind: 'CUSTOMER' | 'STAFF', permissions: string[], extra: Record<string, Handler>) {
  document.cookie = 'b2c_session=1';
  mockApi({
    'POST /v1/auth/refresh': { accessToken: 'jeton-de-test' },
    'GET /v1/auth/me': user(kind, permissions),
    ...extra,
  });
}
const customerPerms = ['invoice:read_own', 'payment:read_own', 'payment:declare_own', 'notification:read_own'];

const payment = (overrides: Record<string, unknown> = {}) => ({
  id: PAY, invoiceId: INV, method: 'BANK_TRANSFER', status: 'PENDING', currency: 'USD', amount: '5.00', refundedTotal: '0.00',
  reference: 'VIR-2026-0042', declaredByCustomer: true, failureReason: null, confirmedAt: null, createdAt: '2026-03-01T10:00:00Z', receiptNumber: null, ...overrides,
});
const invoice = (overrides: Record<string, unknown> = {}) => ({
  id: INV, number: 'INV-2026-000001', status: 'ISSUED', customer: { id: CUS, customerCode: 'TT-000001', name: 'Marie Jean' }, currency: 'USD',
  subtotal: '9.50', discountTotal: '0.00', taxTotal: '0.00', total: '9.50', creditedTotal: '0.00', paidTotal: '0.00', pendingTotal: '0.00', balance: '9.50',
  discountPercent: null, dueDate: null, notes: null, issuedAt: '2026-03-01T09:00:00Z', voidedAt: null, voidReason: null, createdAt: '2026-03-01T09:00:00Z',
  lines: [
    { id: 'l1', kind: 'FREIGHT', description: 'Fret — EE-ABCDE', quantity: '1', unitPrice: '8.00', amount: '8.00', packageId: PKG },
    { id: 'l2', kind: 'HANDLING', description: 'Manutention', quantity: '1', unitPrice: '1.50', amount: '1.50', packageId: PKG },
  ],
  credits: [], payments: [], packages: [{ id: PKG, trackingNumber: 'EEABCDE12345X', trackingNumberDisplay: 'EE-ABCDE-12345-X' }],
  ...overrides,
});
const options = { cash: true, declare: ['BANK_TRANSFER', 'ZELLE'], online: false, instructions: 'Virement : compte 123' };

describe('espace client : navigation', () => {
  it('« Mes factures » et « Notifications » avec le nombre de non lues', async () => {
    signedIn('CUSTOMER', customerPerms, { 'GET /v1/me/notifications': { items: [], unread: 3, nextCursor: null } });
    renderAt('/fr/account');
    const nav = await screen.findByRole('navigation', { name: fr.a11y.accountNav }, { timeout: 5000 });
    expect(within(nav).getByRole('link', { name: fr.account.nav.invoices })).toBeInTheDocument();
    const notifications = within(nav).getByRole('link', { name: new RegExp(fr.account.nav.notifications) });
    await waitFor(() => expect(notifications).toHaveTextContent('3'));
  });
});

describe('mes factures', () => {
  it('liste les factures émises avec leur solde et mène au détail', async () => {
    signedIn('CUSTOMER', customerPerms, {
      'GET /v1/me/notifications': { items: [], unread: 0, nextCursor: null },
      'GET /v1/me/invoices': { items: [invoice(), invoice({ id: 'x2', number: 'INV-2026-000002', status: 'PAID', balance: '0.00', paidTotal: '9.50' })], nextCursor: null },
    });
    renderAt('/fr/account/invoices');
    const items = await screen.findAllByTestId('invoice-item');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('INV-2026-000001');
    expect(items[0]).toHaveTextContent(fr.finance.invoiceStatuses.ISSUED);
    expect(items[0]).toHaveTextContent(/9,50/);
    expect(items[1]).toHaveTextContent(fr.finance.invoiceStatuses.PAID);
    expect(screen.getByRole('link', { name: `${fr.finance.common.open} : INV-2026-000001` })).toHaveAttribute('href', `/fr/account/invoices/${INV}`);
  });

  it('détail : lignes, totaux, consignes ; la déclaration envoie des données validées et reste « en attente »', async () => {
    signedIn('CUSTOMER', customerPerms, {
      'GET /v1/me/notifications': { items: [], unread: 0, nextCursor: null },
      [`GET /v1/me/invoices/${INV}`]: invoice(),
      'GET /v1/me/payment-options': options,
      [`POST /v1/me/invoices/${INV}/payments`]: () => json(201, payment()),
    });
    const u = userEvent.setup();
    renderAt(`/fr/account/invoices/${INV}`);
    expect(await screen.findByTestId('invoice-total')).toHaveTextContent(/9,50/);
    expect(screen.getAllByText(/Fret/).length).toBeGreaterThan(0);
    expect(await screen.findByText('Virement : compte 123')).toBeInTheDocument();
    expect(screen.getByText(fr.finance.customer.pay.noOnline)).toBeInTheDocument();

    // référence trop courte : rien n'est envoyé
    await u.clear(screen.getByLabelText(fr.finance.customer.pay.amount));
    await u.type(screen.getByLabelText(fr.finance.customer.pay.amount), '5,00');
    await u.type(screen.getByLabelText(fr.finance.customer.pay.reference), 'ab');
    await u.click(screen.getByRole('button', { name: fr.finance.customer.pay.submit }));
    expect(await screen.findByText(fr.common.fixErrors)).toBeInTheDocument();
    expect(calls(`POST /v1/me/invoices/${INV}/payments`)).toHaveLength(0);

    await u.clear(screen.getByLabelText(fr.finance.customer.pay.reference));
    await u.type(screen.getByLabelText(fr.finance.customer.pay.reference), 'VIR-2026-0042');
    await u.click(screen.getByRole('button', { name: fr.finance.customer.pay.submit }));
    await waitFor(() => expect(calls(`POST /v1/me/invoices/${INV}/payments`)).toHaveLength(1));
    expect(bodyOf(calls(`POST /v1/me/invoices/${INV}/payments`)[0])).toEqual({ method: 'BANK_TRANSFER', amount: 5, reference: 'VIR-2026-0042' });
    expect(await screen.findByText(fr.finance.customer.pay.sent)).toBeInTheDocument();
  });

  it('explique un refus du serveur (référence déjà utilisée)', async () => {
    signedIn('CUSTOMER', customerPerms, {
      'GET /v1/me/notifications': { items: [], unread: 0, nextCursor: null },
      [`GET /v1/me/invoices/${INV}`]: invoice(),
      'GET /v1/me/payment-options': options,
      [`POST /v1/me/invoices/${INV}/payments`]: () => json(409, { error: { code: 'DUPLICATE_REFERENCE', message: 'x' } }),
    });
    const u = userEvent.setup();
    renderAt(`/fr/account/invoices/${INV}`);
    await u.type(await screen.findByLabelText(fr.finance.customer.pay.reference), 'VIR-2026-0042');
    await u.click(screen.getByRole('button', { name: fr.finance.customer.pay.submit }));
    expect(await screen.findByText(fr.auth.errors.DUPLICATE_REFERENCE)).toBeInTheDocument();
  });

  it('un paiement en attente peut être retiré ; une facture payée n’a plus de formulaire', async () => {
    signedIn('CUSTOMER', customerPerms, {
      'GET /v1/me/notifications': { items: [], unread: 0, nextCursor: null },
      [`GET /v1/me/invoices/${INV}`]: invoice({ pendingTotal: '5.00', payments: [payment()] }),
      'GET /v1/me/payment-options': options,
      [`DELETE /v1/me/payments/${PAY}`]: () => json(204),
    });
    const u = userEvent.setup();
    renderAt(`/fr/account/invoices/${INV}`);
    const item = await screen.findByTestId('payment-item');
    expect(item).toHaveTextContent(fr.finance.paymentStatuses.PENDING);
    await u.click(within(item).getByRole('button', { name: new RegExp(fr.finance.customer.pay.cancel) }));
    await waitFor(() => expect(calls(`DELETE /v1/me/payments/${PAY}`)).toHaveLength(1));
    expect(await screen.findByText(fr.finance.customer.pay.cancelled)).toBeInTheDocument();
  });

  it('facture payée : reçu téléchargeable et aucun formulaire de paiement', async () => {
    signedIn('CUSTOMER', customerPerms, {
      'GET /v1/me/notifications': { items: [], unread: 0, nextCursor: null },
      [`GET /v1/me/invoices/${INV}`]: invoice({ status: 'PAID', balance: '0.00', paidTotal: '9.50', payments: [payment({ status: 'CONFIRMED', amount: '9.50', receiptNumber: 'RCT-2026-000001' })] }),
      'GET /v1/me/payment-options': options,
    });
    renderAt(`/fr/account/invoices/${INV}`);
    expect(await screen.findByRole('button', { name: `${fr.finance.common.receipt} RCT-2026-000001` })).toBeInTheDocument();
    expect(screen.getByText(fr.finance.customer.pay.settled)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: fr.finance.customer.pay.submit })).not.toBeInTheDocument();
  });
});

describe('mes notifications', () => {
  const item = (overrides: Record<string, unknown> = {}) => ({ id: NOT, eventCode: 'package.received', subject: 'Colis reçu à l’entrepôt', body: 'Votre colis est arrivé.', createdAt: '2026-03-01T10:00:00Z', readAt: null, ...overrides });

  it('affiche les non lues, marque une notification puis toutes comme lues', async () => {
    let unread = true;
    signedIn('CUSTOMER', customerPerms, {
      'GET /v1/me/notifications': () => json(200, { items: [item({ readAt: unread ? null : '2026-03-02T00:00:00Z' }), item({ id: 'n2', subject: 'Achat déclaré', readAt: '2026-03-01T11:00:00Z' })], unread: unread ? 1 : 0, nextCursor: null }),
      [`POST /v1/me/notifications/${NOT}/read`]: () => {
        unread = false;
        return json(200, { updated: 1 });
      },
      'POST /v1/me/notifications/read-all': { updated: 0 },
    });
    const u = userEvent.setup();
    renderAt('/fr/account/notifications');
    const items = await screen.findAllByTestId('notification-item');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent(fr.finance.notifications.isNew);
    expect(items[1]).not.toHaveTextContent(fr.finance.notifications.isNew);
    expect(await screen.findByText(/1 non lue/)).toBeInTheDocument();
    await u.click(within(items[0]).getByRole('button', { name: new RegExp(fr.finance.notifications.markRead) }));
    await waitFor(() => expect(calls(`POST /v1/me/notifications/${NOT}/read`)).toHaveLength(1));
    expect(await screen.findByText(fr.finance.notifications.none)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: fr.finance.notifications.markAll })).toBeDisabled();
  });
});

describe('textes', () => {
  const codes = [
    'ALREADY_INVOICED', 'PACKAGE_NOT_BILLABLE', 'PACKAGE_NOT_PRICED', 'DISCOUNT_ABOVE_CAP', 'INVOICE_NOT_FOUND', 'INVOICE_HAS_PAYMENTS', 'CREDIT_EXCEEDS_UNPAID',
    'CASH_SESSION_REQUIRED', 'AMOUNT_EXCEEDS_BALANCE', 'DUPLICATE_REFERENCE', 'IDEMPOTENCY_KEY_REUSED', 'PAYMENT_NOT_PENDING', 'REFUND_EXCEEDS_PAYMENT', 'NOT_FAILED', 'CHANNEL_NOT_CONFIGURED',
  ];
  it('chaque code d’erreur de la finance a un message dans les trois langues', () => {
    for (const lang of ['fr', 'en', 'ht'] as const) {
      for (const code of codes) expect(catalogs[lang].auth.errors[code], `${lang}:${code}`).toBeTruthy();
    }
  });
});
