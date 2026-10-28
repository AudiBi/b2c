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
const options = { cash: true, declare: ['BANK_TRANSFER', 'MOBILE_MONEY'], online: false, instructions: 'Virement : compte 123' };

describe('espace client : navigation', () => {
  it('« Mes factures » et « Notifications » avec le nombre de non lues ; rien de la facturation du personnel', async () => {
    signedIn('CUSTOMER', customerPerms, { 'GET /v1/me/notifications': { items: [], unread: 3, nextCursor: null } });
    renderAt('/fr/account');
    const nav = await screen.findByRole('navigation', { name: fr.a11y.accountNav }, { timeout: 5000 });
    expect(within(nav).getByRole('link', { name: fr.account.nav.invoices })).toBeInTheDocument();
    const notifications = within(nav).getByRole('link', { name: new RegExp(fr.account.nav.notifications) });
    await waitFor(() => expect(notifications).toHaveTextContent('3'));
    expect(within(nav).queryByRole('link', { name: fr.staff.nav.billing })).not.toBeInTheDocument();
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

describe('facturation du personnel : navigation', () => {
  it('chaque entrée dépend d’un droit précis', async () => {
    signedIn('STAFF', ['invoice:read', 'notification:read'], {});
    renderAt('/fr/account');
    const nav = await screen.findByRole('navigation', { name: fr.a11y.accountNav }, { timeout: 5000 });
    expect(within(nav).getByRole('link', { name: fr.staff.nav.billing })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: fr.staff.nav.notifications })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: fr.staff.nav.payments })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: fr.account.nav.invoices })).not.toBeInTheDocument();
  });
});

describe('factures (personnel)', () => {
  const staffPerms = ['invoice:read', 'invoice:create', 'invoice:void', 'payment:read', 'payment:record_cash', 'payment:reconcile', 'payment:refund', 'agency:read'];

  it('un brouillon : émission, suppression en deux temps', async () => {
    signedIn('STAFF', staffPerms, {
      [`GET /v1/admin/invoices/${INV}`]: invoice({ number: null, status: 'DRAFT', issuedAt: null }),
      [`POST /v1/admin/invoices/${INV}/issue`]: () => json(200, invoice()),
      [`DELETE /v1/admin/invoices/${INV}`]: () => json(204),
      'GET /v1/admin/invoices': { items: [], nextCursor: null },
    });
    const u = userEvent.setup();
    renderAt(`/fr/account/staff/billing/${INV}`);
    expect((await screen.findAllByText(fr.finance.common.draftNumber)).length).toBeGreaterThan(0);
    await u.click(screen.getByRole('button', { name: fr.finance.staff.invoice.issue }));
    await waitFor(() => expect(calls(`POST /v1/admin/invoices/${INV}/issue`)).toHaveLength(1));
    expect(await screen.findByText(fr.finance.staff.invoice.issued)).toBeInTheDocument();

    await u.click(screen.getByRole('button', { name: fr.finance.staff.invoice.delete }));
    expect(calls(`DELETE /v1/admin/invoices/${INV}`)).toHaveLength(0); // confirmation d'abord
    await u.click(screen.getByRole('button', { name: fr.finance.staff.invoice.confirmDelete }));
    await waitFor(() => expect(calls(`DELETE /v1/admin/invoices/${INV}`)).toHaveLength(1));
  });

  it('encaissement en espèces : montant exact, Idempotency-Key, reçu annoncé', async () => {
    signedIn('STAFF', staffPerms, {
      [`GET /v1/admin/invoices/${INV}`]: invoice(),
      'GET /v1/admin/agencies': { items: [] },
      'POST /v1/admin/payments/cash': () => json(201, { payment: payment({ method: 'CASH', status: 'CONFIRMED' }), receiptNumber: 'RCT-2026-000007' }),
    });
    const u = userEvent.setup();
    renderAt(`/fr/account/staff/billing/${INV}`);
    const amount = await screen.findByLabelText(fr.finance.common.amount, { selector: '#cashAmount, input' });
    await u.clear(amount);
    await u.type(amount, '4,5');
    await u.click(screen.getByRole('button', { name: fr.finance.staff.invoice.cashSubmit }));
    await waitFor(() => expect(calls('POST /v1/admin/payments/cash')).toHaveLength(1));
    const call = calls('POST /v1/admin/payments/cash')[0];
    expect(bodyOf(call)).toEqual({ invoiceId: INV, amount: 4.5 });
    expect(new Headers((call[1] as RequestInit).headers).get('Idempotency-Key')).toMatch(/^[\w-]{8,64}$/);
    expect(await screen.findByText(/RCT-2026-000007/)).toBeInTheDocument();
  });

  it('valider ou refuser (motif obligatoire) un paiement déclaré', async () => {
    signedIn('STAFF', staffPerms, {
      [`GET /v1/admin/invoices/${INV}`]: invoice({ pendingTotal: '5.00', payments: [payment()] }),
      'GET /v1/admin/agencies': { items: [] },
      [`POST /v1/admin/payments/${PAY}/reject`]: () => json(200, payment({ status: 'FAILED' })),
    });
    const u = userEvent.setup();
    renderAt(`/fr/account/staff/billing/${INV}`);
    const item = await screen.findByTestId('payment-item');
    await u.click(within(item).getByRole('button', { name: new RegExp(fr.finance.staff.invoice.reject) }));
    const form = await screen.findByRole('form', { name: fr.finance.staff.invoice.reject });
    await u.click(within(form).getByRole('button', { name: fr.finance.staff.invoice.reject }));
    expect(calls(`POST /v1/admin/payments/${PAY}/reject`)).toHaveLength(0); // motif manquant
    await u.type(within(form).getByLabelText(fr.finance.common.reason), 'Virement introuvable');
    await u.click(within(form).getByRole('button', { name: fr.finance.staff.invoice.reject }));
    await waitFor(() => expect(calls(`POST /v1/admin/payments/${PAY}/reject`)).toHaveLength(1));
    expect(bodyOf(calls(`POST /v1/admin/payments/${PAY}/reject`)[0])).toEqual({ reason: 'Virement introuvable' });
  });

  it('avoir : montant et motif contrôlés puis envoyés ; refus du serveur expliqué', async () => {
    signedIn('STAFF', staffPerms, {
      [`GET /v1/admin/invoices/${INV}`]: invoice(),
      'GET /v1/admin/agencies': { items: [] },
      [`POST /v1/admin/invoices/${INV}/credit-notes`]: () => json(422, { error: { code: 'CREDIT_EXCEEDS_UNPAID', message: 'x' } }),
    });
    const u = userEvent.setup();
    renderAt(`/fr/account/staff/billing/${INV}`);
    await u.click(await screen.findByRole('button', { name: fr.finance.staff.invoice.creditTitle }));
    const form = await screen.findByRole('form', { name: fr.finance.staff.invoice.creditTitle });
    await u.type(within(form).getByLabelText(fr.finance.common.amount), '20');
    await u.type(within(form).getByLabelText(fr.finance.common.reason), 'Geste commercial');
    await u.click(within(form).getByRole('button', { name: fr.finance.staff.invoice.creditSubmit }));
    expect(await screen.findByText(fr.auth.errors.CREDIT_EXCEEDS_UNPAID)).toBeInTheDocument();
    expect(bodyOf(calls(`POST /v1/admin/invoices/${INV}/credit-notes`)[0])).toEqual({ amount: 20, reason: 'Geste commercial' });
  });

  it('nouveau brouillon : recherche du client, choix des colis, envoi', async () => {
    signedIn('STAFF', [...staffPerms, 'customer:read', 'discount:apply'], {
      'GET /v1/admin/invoices': { items: [], nextCursor: null },
      'GET /v1/admin/customers': { items: [{ id: CUS, customerCode: 'TT-000001', firstName: 'Marie', lastName: 'Jean', businessName: null }], nextCursor: null },
      'GET /v1/admin/packages': (_init, url) =>
        json(200, { items: url.searchParams.get('status') === 'REGISTERED_WEIGHED' ? [{ id: PKG, trackingNumber: 'EEABCDE12345X', trackingNumberDisplay: 'EE-ABCDE-12345-X', contentDescription: 'Chaussures', measures: { billableWeight: '2', weightUnit: 'KG' } }] : [], nextCursor: null }),
      'POST /v1/admin/invoices': () => json(201, invoice({ number: null, status: 'DRAFT' })),
      [`GET /v1/admin/invoices/${INV}`]: invoice({ number: null, status: 'DRAFT' }),
    });
    const u = userEvent.setup();
    renderAt('/fr/account/staff/billing');
    await u.click(await screen.findByRole('button', { name: fr.finance.staff.billing.new }));
    await u.type(screen.getByLabelText(fr.finance.staff.billing.form.customer), 'jean');
    await u.click(screen.getByRole('button', { name: fr.finance.staff.billing.form.find }));
    const box = await screen.findByRole('checkbox', { name: /EE-ABCDE-12345-X/ });
    expect(calls('GET /v1/admin/customers')[0][0]).toContain('q=jean');
    await u.click(box);
    await u.type(screen.getByLabelText(/^Remise/), '5');
    await u.click(screen.getByRole('button', { name: fr.finance.staff.billing.form.submit }));
    await waitFor(() => expect(calls('POST /v1/admin/invoices')).toHaveLength(1));
    expect(bodyOf(calls('POST /v1/admin/invoices')[0])).toEqual({ customerId: CUS, packageIds: [PKG], extraLines: [], discountPercent: 5 });
  });
});

describe('paiements et caisse (personnel)', () => {
  const perms = ['payment:read', 'payment:record_cash', 'payment:reconcile', 'payment:export', 'settings:read', 'settings:update', 'agency:read'];

  it('file des paiements à valider : validation directe', async () => {
    signedIn('STAFF', perms, {
      'GET /v1/admin/payments': { items: [{ ...payment(), invoiceNumber: 'INV-2026-000001', customerCode: 'TT-000001' }], nextCursor: null },
      'GET /v1/admin/cash-sessions': { items: [] },
      'GET /v1/admin/agencies': { items: [] },
      'GET /v1/admin/settings/finance': { maxDiscountPercent: 10, paymentInstructions: null },
      [`POST /v1/admin/payments/${PAY}/confirm`]: () => json(200, { payment: payment({ status: 'CONFIRMED' }), receiptNumber: 'RCT-2026-000001' }),
    });
    const u = userEvent.setup();
    renderAt('/fr/account/staff/payments');
    const item = await screen.findByTestId('queue-payment');
    expect(item).toHaveTextContent('INV-2026-000001');
    expect(new URL(String(fetchMock.mock.calls.find(([i]) => String(i).includes('/v1/admin/payments'))?.[0]), 'http://x').searchParams.get('status')).toBe('PENDING');
    await u.click(within(item).getByRole('button', { name: new RegExp(fr.finance.staff.invoice.confirm) }));
    await waitFor(() => expect(calls(`POST /v1/admin/payments/${PAY}/confirm`)).toHaveLength(1));
    expect(await screen.findByText(fr.finance.staff.invoice.confirmed)).toBeInTheDocument();
  });

  it('caisse : ouverture puis clôture avec écart affiché', async () => {
    let closed = false;
    signedIn('STAFF', perms, {
      'GET /v1/admin/payments': { items: [], nextCursor: null },
      'GET /v1/admin/agencies': { items: [] },
      'GET /v1/admin/settings/finance': { maxDiscountPercent: 10, paymentInstructions: null },
      'GET /v1/admin/cash-sessions': () =>
        json(200, { items: [{ id: 's1', agencyId: null, openedAt: '2026-03-01T08:00:00Z', openingAmount: '20.00', closedAt: closed ? '2026-03-01T18:00:00Z' : null, countedAmount: closed ? '27.50' : null, expectedAmount: closed ? '28.00' : null, difference: closed ? '-0.50' : null }] }),
      'POST /v1/admin/cash-sessions/s1/close': () => {
        closed = true;
        return json(200, {});
      },
    });
    const u = userEvent.setup();
    renderAt('/fr/account/staff/payments');
    await u.click(await screen.findByRole('button', { name: new RegExp(`^${fr.finance.staff.payments.cash.close}`) }));
    await u.type(screen.getByLabelText(fr.finance.staff.payments.cash.counted), '27,5');
    await u.click(within(screen.getByRole('form', { name: fr.finance.staff.payments.cash.close })).getByRole('button', { name: fr.finance.staff.payments.cash.close }));
    await waitFor(() => expect(calls('POST /v1/admin/cash-sessions/s1/close')).toHaveLength(1));
    expect(bodyOf(calls('POST /v1/admin/cash-sessions/s1/close')[0])).toEqual({ countedAmount: 27.5 });
    const session = await screen.findByTestId('cash-session');
    await waitFor(() => expect(session).toHaveTextContent(/-0,50/));
  });

  it('synthèse de la période et réglages ; dates incohérentes refusées sans appel', async () => {
    signedIn('STAFF', perms, {
      'GET /v1/admin/payments': { items: [], nextCursor: null },
      'GET /v1/admin/cash-sessions': { items: [] },
      'GET /v1/admin/agencies': { items: [] },
      'GET /v1/admin/settings/finance': { maxDiscountPercent: 10, paymentInstructions: null },
      'PUT /v1/admin/settings/finance': () => json(200, {}),
      'GET /v1/admin/finance/summary': { from: '2026-03-01', to: '2026-03-31', confirmed: [{ method: 'CASH', currency: 'USD', count: 2, collected: '15.00', refunded: '2.00', net: '13.00' }], pending: [{ method: 'MOBILE_MONEY', currency: 'USD', count: 1, amount: '2.00' }] },
    });
    const u = userEvent.setup();
    renderAt('/fr/account/staff/payments');
    const from = await screen.findByLabelText(fr.finance.staff.payments.summary.from);
    await u.clear(from);
    await u.type(from, '2026-03-01');
    const to = screen.getByLabelText(fr.finance.staff.payments.summary.to);
    await u.clear(to);
    await u.type(to, '2026-02-01');
    await u.click(screen.getByRole('button', { name: fr.finance.staff.payments.summary.load }));
    expect(calls('GET /v1/admin/finance/summary')).toHaveLength(0);
    await u.clear(to);
    await u.type(to, '2026-03-31');
    await u.click(screen.getByRole('button', { name: fr.finance.staff.payments.summary.load }));
    const table = await screen.findByRole('table', { name: fr.finance.staff.payments.summary.title });
    expect(within(table).getByText(/Espèces/)).toBeInTheDocument();
    expect(within(table).getByText(/13,00/)).toBeInTheDocument();

    const max = await screen.findByLabelText(fr.finance.staff.payments.settings.maxDiscount);
    await u.clear(max);
    await u.type(max, '12');
    await u.click(screen.getByRole('button', { name: fr.finance.staff.payments.settings.save }));
    await waitFor(() => expect(calls('PUT /v1/admin/settings/finance')).toHaveLength(1));
    expect(bodyOf(calls('PUT /v1/admin/settings/finance')[0])).toEqual({ maxDiscountPercent: 12, paymentInstructions: null });
  });
});

describe('notifications (personnel)', () => {
  const perms = ['notification:read', 'notification:template_manage'];
  const logItem = (overrides: Record<string, unknown> = {}) => ({
    id: NOT, eventCode: 'prealert.created', channel: 'EMAIL', locale: 'fr', subject: 'Achat déclaré', body: 'x', status: 'FAILED', skipReason: null, attempts: 5,
    lastError: 'SMTP indisponible', nextAttemptAt: null, sentAt: null, createdAt: '2026-03-01T10:00:00Z', customerCode: 'TT-000001', ...overrides,
  });
  const templates = {
    items: [
      { eventCode: 'prealert.created', channel: 'EMAIL', locale: 'fr', variables: ['customerName', 'trackingNumber', 'storeName'], mandatory: false, source: 'DEFAULT', active: true, subject: 'Achat déclaré', body: 'Bonjour {customerName}, suivi {trackingNumber}.' },
    ],
  };

  it('journal : un envoi en échec peut être relancé ; le traitement manuel affiche son bilan', async () => {
    signedIn('STAFF', perms, {
      'GET /v1/admin/notifications': { items: [logItem(), logItem({ id: 'n2', status: 'SKIPPED', channel: 'SMS', skipReason: 'CHANNEL_NOT_CONFIGURED', attempts: 0, lastError: null })], nextCursor: null },
      'GET /v1/admin/notification-templates': templates,
      [`POST /v1/admin/notifications/${NOT}/retry`]: () => json(200, {}),
      'POST /v1/admin/notifications/process': () => json(200, { fannedOut: 1, sent: 2, failed: 0, retried: 1, skipped: 0 }),
    });
    const u = userEvent.setup();
    renderAt('/fr/account/staff/notifications');
    const items = await screen.findAllByTestId('log-item');
    expect(items[0]).toHaveTextContent('SMTP indisponible');
    expect(items[1]).toHaveTextContent(fr.finance.staff.notifications.skipReasons.CHANNEL_NOT_CONFIGURED);
    expect(within(items[1]).queryByRole('button')).not.toBeInTheDocument();
    await u.click(within(items[0]).getByRole('button', { name: new RegExp(fr.finance.staff.notifications.retry) }));
    await waitFor(() => expect(calls(`POST /v1/admin/notifications/${NOT}/retry`)).toHaveLength(1));
    expect(await screen.findByText(fr.finance.staff.notifications.retried)).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: fr.finance.staff.notifications.process }));
    expect(await screen.findByText('Traitement terminé : 2 envoyée(s), 1 à réessayer, 0 en échec.')).toBeInTheDocument();
  });

  it('modèle : une variable inconnue est refusée sans appel ; sinon enregistré', async () => {
    signedIn('STAFF', perms, {
      'GET /v1/admin/notifications': { items: [], nextCursor: null },
      'GET /v1/admin/notification-templates': templates,
      'PUT /v1/admin/notification-templates': () => json(200, {}),
    });
    const u = userEvent.setup();
    renderAt('/fr/account/staff/notifications');
    const body = await screen.findByLabelText(fr.finance.staff.notifications.body);
    await waitFor(() => expect(body).toHaveValue('Bonjour {customerName}, suivi {trackingNumber}.'));
    await u.clear(body);
    await u.paste('Salut {motDePasse}');
    await u.click(screen.getByRole('button', { name: fr.finance.staff.notifications.save }));
    expect(calls('PUT /v1/admin/notification-templates')).toHaveLength(0);

    await u.clear(body);
    await u.paste('Salut {customerName}');
    await u.click(screen.getByRole('button', { name: fr.finance.staff.notifications.save }));
    await waitFor(() => expect(calls('PUT /v1/admin/notification-templates')).toHaveLength(1));
    expect(bodyOf(calls('PUT /v1/admin/notification-templates')[0])).toEqual({ eventCode: 'prealert.created', channel: 'EMAIL', locale: 'fr', subject: 'Achat déclaré', body: 'Salut {customerName}', active: true });
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
