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

const W = '3f2b8c1e-9d4a-4e6b-8a1f-2c7d5e9b0a11';
const A = '5a9d1c2e-7b3f-4c8a-9e1d-6f4b2a8c0d33';
const P = '7c1e9a4b-2d5f-4e8a-b3c6-1a9d7f5e2b44';
const S = '9e3b5d7a-1c4f-4a6e-8b2d-3f7a1c9e5d55';

const staffUser = (permissions: string[]) => ({
  id: 'u1', companyId: 'c1', kind: 'STAFF', email: 'agent@example.test', firstName: 'Agent', lastName: 'Test',
  locale: 'fr', emailVerified: true, roles: [], permissions,
});
function signedIn(permissions: string[], extra: Record<string, Handler>) {
  document.cookie = 'b2c_session=1';
  mockApi({
    'POST /v1/auth/refresh': { accessToken: 'jeton-de-test' },
    'GET /v1/auth/me': staffUser(permissions),
    ...extra,
  });
}
const warehouse = { id: W, reference: 'MIA1', name: 'Entrepôt de Miami', city: 'Miami', country: 'US' };
const pkg = (overrides: Record<string, unknown> = {}) => ({
  id: P, trackingNumber: 'EEABCDE12345X', trackingNumberDisplay: 'EE-ABCDE-12345-X', status: 'RECEIVED_AT_WAREHOUSE', previousStatus: null,
  customer: { id: 'c', customerCode: 'EE-000001', name: 'Marie Jean' }, warehouse, originCountry: 'US', originCity: 'Miami',
  destinationCountry: 'HT', destinationCity: null, transportMode: 'AIR', supplierTracking: '1ZABC', contentDescription: 'Chaussures',
  declaredValue: null, declaredCurrency: null, destinationAgencyId: null, locationId: null,
  measures: { actualWeightKg: null, billableWeight: null, weightUnit: null }, ...overrides,
});
const detail = (overrides: Record<string, unknown> = {}) => ({ ...pkg(overrides), events: [], holds: [], prealert: null });

describe('navigation du personnel', () => {
  it('chaque entrée du menu dépend des droits ; un client n’en voit aucune', async () => {
    signedIn(['package:receive', 'package:read', 'shipment:read'], {});
    renderAt('/fr/account');
    const nav = await screen.findByRole('navigation', { name: fr.a11y.accountNav }, { timeout: 5000 });
    expect(within(nav).getByRole('link', { name: fr.staff.nav.reception })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: fr.staff.nav.packages })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: fr.staff.nav.shipments })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: fr.staff.nav.warehouse })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: fr.staff.nav.agency })).not.toBeInTheDocument();
  });
});

describe('réception par lecture de codes', () => {
  it('envoie chaque code, vide et refocalise le champ, historise les résultats du plus récent au plus ancien', async () => {
    let n = 0;
    signedIn(['package:receive'], {
      'GET /v1/admin/warehouses': { items: [warehouse] },
      'POST /v1/admin/scan/receive': () => {
        n += 1;
        return json(200, { outcome: n === 1 ? 'RECEIVED' : 'ALREADY_RECEIVED', match: null, package: pkg() });
      },
    });
    const user = userEvent.setup();
    renderAt('/fr/account/staff/reception');
    const field = await screen.findByLabelText(fr.staff.reception.code);
    await waitFor(() => expect(field).toHaveFocus());

    await user.type(field, ' ee-abcde-12345-x {Enter}');
    await waitFor(() => expect(calls('POST /v1/admin/scan/receive')).toHaveLength(1));
    expect(bodyOf(calls('POST /v1/admin/scan/receive')[0])).toEqual({ warehouseId: W, code: 'ee-abcde-12345-x' });
    await waitFor(() => expect(field).toHaveValue(''));
    await waitFor(() => expect(field).toHaveFocus());

    await user.type(field, 'DEUXIEME-0002{Enter}');
    const entries = await waitFor(() => {
      const found = screen.getAllByTestId('scan-entry');
      expect(found).toHaveLength(2);
      return found;
    });
    expect(entries[0]).toHaveTextContent('DEUXIEME-0002');
    expect(entries[0]).toHaveTextContent(fr.staff.reception.outcomes.ALREADY_RECEIVED);
    expect(entries[1]).toHaveTextContent(fr.staff.reception.outcomes.RECEIVED);
    expect(entries[1]).toHaveTextContent('Marie Jean (EE-000001)');
  });

  it('transmet le mode choisi, signale un colis sans client et explique un refus', async () => {
    let call = 0;
    signedIn(['package:receive'], {
      'GET /v1/admin/warehouses': { items: [warehouse] },
      'POST /v1/admin/scan/receive': () => {
        call += 1;
        return call === 1
          ? json(200, { outcome: 'UNIDENTIFIED', match: null, package: pkg({ customer: null }) })
          : json(409, { error: { code: 'PACKAGE_CANCELLED', message: 'x' } });
      },
    });
    const user = userEvent.setup();
    renderAt('/fr/account/staff/reception');
    await user.click(await screen.findByLabelText(fr.staff.common.modes.SEA));
    await user.type(screen.getByLabelText(fr.staff.reception.code), 'INCONNU-0001{Enter}');
    expect(await screen.findByText(fr.staff.reception.unidentifiedHint)).toBeInTheDocument();
    expect(bodyOf(calls('POST /v1/admin/scan/receive')[0])).toEqual({ warehouseId: W, code: 'INCONNU-0001', transportMode: 'SEA' });

    await user.type(screen.getByLabelText(fr.staff.reception.code), 'ANNULE-0002{Enter}');
    expect(await screen.findByText(`Lecture refusée : ${fr.auth.errors.PACKAGE_CANCELLED}`)).toBeInTheDocument();
  });

  it('sans entrepôt dans le périmètre : message clair, aucun champ de lecture', async () => {
    signedIn(['package:receive'], { 'GET /v1/admin/warehouses': { items: [] } });
    renderAt('/fr/account/staff/reception');
    expect(await screen.findByText(fr.staff.common.noWarehouse)).toBeInTheDocument();
    expect(screen.queryByLabelText(fr.staff.reception.code)).not.toBeInTheDocument();
  });
});

describe('fiche d’un colis (personnel)', () => {
  const perms = ['package:read', 'package:update', 'package:register', 'package:hold', 'package:cancel', 'warehouse:move'];

  it('colis sans client : propose l’identification et rien d’autre qui exige un client', async () => {
    signedIn(perms, {
      [`GET /v1/admin/packages/${P}`]: detail({ customer: null }),
      'GET /v1/admin/agencies': { items: [] },
      [`GET /v1/admin/warehouses/${W}/locations`]: { items: [] },
      [`POST /v1/admin/packages/${P}/identify`]: () => json(200, { package: pkg(), merged: null }),
      'GET /v1/files': { items: [] },
    });
    const user = userEvent.setup();
    renderAt(`/fr/account/staff/packages/${P}`);
    expect(await screen.findByRole('region', { name: fr.staff.package.identify.title })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: fr.staff.package.weigh.title })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(fr.staff.package.identify.code), 'ee-000001');
    await user.click(screen.getByRole('button', { name: fr.staff.package.identify.submit }));
    await waitFor(() => expect(calls(`POST /v1/admin/packages/${P}/identify`)).toHaveLength(1));
    expect(bodyOf(calls(`POST /v1/admin/packages/${P}/identify`)[0])).toEqual({ customerCode: 'EE-000001' });
  });

  it('pesée : validation sans appel, puis envoi de nombres et de mesures dans leurs unités', async () => {
    signedIn(perms, {
      [`GET /v1/admin/packages/${P}`]: detail(),
      'GET /v1/admin/agencies': { items: [] },
      [`GET /v1/admin/warehouses/${W}/locations`]: { items: [] },
      [`POST /v1/admin/packages/${P}/register`]: () => json(200, pkg({ status: 'REGISTERED_WEIGHED' })),
      'GET /v1/files': { items: [] },
    });
    const user = userEvent.setup();
    renderAt(`/fr/account/staff/packages/${P}`);
    const weighing = await screen.findByRole('region', { name: fr.staff.package.weigh.title });
    await user.click(within(weighing).getByRole('button', { name: fr.staff.package.weigh.submit }));
    expect((await within(weighing).findAllByText(fr.validation.required)).length).toBeGreaterThanOrEqual(4);
    expect(calls(`POST /v1/admin/packages/${P}/register`)).toHaveLength(0);

    await user.type(within(weighing).getByLabelText(fr.staff.package.weigh.weight), '2,3');
    await user.type(within(weighing).getByLabelText(fr.staff.package.weigh.length), '40');
    await user.type(within(weighing).getByLabelText(fr.staff.package.weigh.width), '30');
    await user.type(within(weighing).getByLabelText(fr.staff.package.weigh.height), '20');
    await user.click(within(weighing).getByLabelText(fr.staff.package.weigh.units.LB));
    await user.click(within(weighing).getByRole('button', { name: fr.staff.package.weigh.submit }));
    await waitFor(() => expect(calls(`POST /v1/admin/packages/${P}/register`)).toHaveLength(1));
    expect(bodyOf(calls(`POST /v1/admin/packages/${P}/register`)[0])).toMatchObject({
      weight: { value: 2.3, unit: 'LB' },
      dimensions: { length: 40, width: 30, height: 20, unit: 'CM' },
      insured: false,
    });
  });

  it('changement de statut : le motif est exigé avant tout appel, le type d’anomalie accompagne une retenue', async () => {
    signedIn(perms, {
      [`GET /v1/admin/packages/${P}`]: detail({ status: 'REGISTERED_WEIGHED' }),
      'GET /v1/admin/agencies': { items: [] },
      [`GET /v1/admin/warehouses/${W}/locations`]: { items: [] },
      [`POST /v1/admin/packages/${P}/transitions`]: () => json(200, pkg({ status: 'ON_HOLD' })),
      'GET /v1/files': { items: [] },
    });
    const user = userEvent.setup();
    renderAt(`/fr/account/staff/packages/${P}`);
    const panel = await screen.findByRole('region', { name: fr.staff.package.transition.title });
    await user.selectOptions(within(panel).getByLabelText(fr.staff.package.transition.target), 'ON_HOLD');
    await user.click(within(panel).getByRole('button', { name: fr.staff.package.transition.submit }));
    expect(await within(panel).findByText(fr.staff.package.transition.reasonRequired)).toBeInTheDocument();
    expect(calls(`POST /v1/admin/packages/${P}/transitions`)).toHaveLength(0);

    await user.selectOptions(within(panel).getByLabelText(fr.staff.package.transition.holdReason), 'DAMAGED');
    await user.type(within(panel).getByLabelText(fr.staff.common.reason), 'Colis écrasé');
    await user.click(within(panel).getByRole('button', { name: fr.staff.package.transition.submit }));
    await waitFor(() => expect(calls(`POST /v1/admin/packages/${P}/transitions`)).toHaveLength(1));
    expect(bodyOf(calls(`POST /v1/admin/packages/${P}/transitions`)[0])).toEqual({ to: 'ON_HOLD', reason: 'Colis écrasé', holdReasonCode: 'DAMAGED' });
  });

  it('n’offre jamais les transitions des lots ni de la livraison, ni une action sans le droit', async () => {
    signedIn(['package:read'], {
      [`GET /v1/admin/packages/${P}`]: detail({ status: 'READY_TO_SHIP' }),
      'GET /v1/admin/agencies': { items: [] },
      [`GET /v1/admin/warehouses/${W}/locations`]: { items: [] },
      'GET /v1/files': { items: [] },
    });
    renderAt(`/fr/account/staff/packages/${P}`);
    await screen.findByTestId('staff-package-tracking');
    expect(screen.queryByRole('region', { name: fr.staff.package.transition.title })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: fr.staff.package.weigh.title })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: fr.staff.package.note.title })).not.toBeInTheDocument();
  });

  it('range un colis dans un emplacement actif', async () => {
    const L = '1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c66';
    signedIn(perms, {
      [`GET /v1/admin/packages/${P}`]: detail(),
      'GET /v1/admin/agencies': { items: [] },
      [`GET /v1/admin/warehouses/${W}/locations`]: { items: [{ id: L, code: 'A-01', kind: 'SHELF', status: 'ACTIVE' }, { id: 'x', code: 'OFF', kind: 'BIN', status: 'INACTIVE' }] },
      [`POST /v1/admin/packages/${P}/move`]: () => json(200, { moved: true, package: pkg({ locationId: L }) }),
      'GET /v1/files': { items: [] },
    });
    const user = userEvent.setup();
    renderAt(`/fr/account/staff/packages/${P}`);
    const panel = await screen.findByRole('region', { name: fr.staff.package.location.title });
    expect(within(panel).queryByRole('option', { name: 'OFF' })).not.toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: fr.staff.package.location.submit }));
    await waitFor(() => expect(calls(`POST /v1/admin/packages/${P}/move`)).toHaveLength(1));
    expect(bodyOf(calls(`POST /v1/admin/packages/${P}/move`)[0])).toEqual({ locationId: L });
  });
});

describe('lots de transport (personnel)', () => {
  const perms = ['shipment:read', 'shipment:manage', 'shipment:dispatch', 'shipment:receive'];
  const shipment = (overrides: Record<string, unknown> = {}) => ({
    id: S, reference: 'MIA1-AIR-20261027-1', status: 'OPEN', transportMode: 'AIR', origin: warehouse,
    destination: { country: 'HT', city: 'Port-au-Prince', agency: null }, carrierName: 'Cargo', transportRef: 'LTA-1', notes: null,
    departedAt: null, arrivedAt: null, packageCount: 1,
    totals: { count: 1, actualWeightKg: '2', declared: { USD: '100.00' } },
    packages: [pkg({ status: 'READY_TO_SHIP' })], events: [{ id: 'e1', type: 'CREATED', from: null, to: 'OPEN', note: null, occurredAt: '2026-10-27T10:00:00.000Z' }],
    ...overrides,
  });

  it('charge un colis par lecture, puis départ en deux temps ; les colis laissés de côté sont nommés', async () => {
    let status = 'OPEN';
    signedIn(perms, {
      [`GET /v1/admin/shipments/${S}`]: () => json(200, shipment({ status })),
      [`POST /v1/admin/shipments/${S}/packages`]: () => json(200, { outcome: 'LOADED', package: pkg() }),
      [`POST /v1/admin/shipments/${S}/dispatch`]: () => {
        status = 'DISPATCHED';
        return json(200, { shipment: shipment({ status }), advanced: 1, skipped: [{ trackingNumber: 'EEZZZ', status: 'ON_HOLD' }] });
      },
    });
    const user = userEvent.setup();
    renderAt(`/fr/account/staff/shipments/${S}`);
    expect(await screen.findByTestId('shipment-reference')).toHaveTextContent('MIA1-AIR-20261027-1');
    expect(screen.getByTestId('shipment-status')).toHaveTextContent(fr.staff.shipments.statuses.OPEN);
    expect(screen.getByTestId('shipment-totals')).toHaveTextContent('1 colis, 2 kg');

    await user.type(screen.getByLabelText(fr.staff.shipment.load.code), 'EE-ABCDE-12345-X{Enter}');
    expect(await screen.findByTestId('load-result')).toHaveTextContent(`EE-ABCDE-12345-X : ${fr.staff.shipment.load.outcomes.LOADED}`);
    expect(bodyOf(calls(`POST /v1/admin/shipments/${S}/packages`)[0])).toEqual({ code: 'EE-ABCDE-12345-X' });

    await user.click(screen.getByRole('button', { name: fr.staff.shipment.actions.dispatch }));
    expect(calls(`POST /v1/admin/shipments/${S}/dispatch`)).toHaveLength(0); // première pression : confirmation seulement
    await user.click(screen.getByRole('button', { name: `Confirmer : ${fr.staff.shipment.actions.dispatch}` }));
    await waitFor(() => expect(calls(`POST /v1/admin/shipments/${S}/dispatch`)).toHaveLength(1));
    expect(await screen.findByText('1 colis mis à jour.')).toBeInTheDocument();
    expect(screen.getByText('1 colis laissés tels quels :')).toBeInTheDocument();
    expect(screen.getByText(/EEZZZ \(ON_HOLD\)/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('shipment-status')).toHaveTextContent(fr.staff.shipments.statuses.DISPATCHED));
    // un lot parti ne se charge plus
    expect(screen.queryByLabelText(fr.staff.shipment.load.code)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: fr.staff.shipment.actions.dispatch })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: fr.staff.shipment.actions.arrive })).toBeInTheDocument();
  });

  it('un refus du serveur est expliqué et le lot ne change pas', async () => {
    signedIn(perms, {
      [`GET /v1/admin/shipments/${S}`]: shipment(),
      [`POST /v1/admin/shipments/${S}/dispatch`]: () => json(409, { error: { code: 'PACKAGES_NOT_READY', message: 'x' } }),
    });
    const user = userEvent.setup();
    renderAt(`/fr/account/staff/shipments/${S}`);
    await user.click(await screen.findByRole('button', { name: fr.staff.shipment.actions.dispatch }));
    await user.click(screen.getByRole('button', { name: `Confirmer : ${fr.staff.shipment.actions.dispatch}` }));
    expect(await screen.findByRole('alert')).toHaveTextContent(fr.auth.errors.PACKAGES_NOT_READY);
    expect(screen.getByTestId('shipment-status')).toHaveTextContent(fr.staff.shipments.statuses.OPEN);
  });

  it('les actions suivent le statut et les droits ; un lot clos n’en offre aucune', async () => {
    signedIn(['shipment:read', 'shipment:manage'], { [`GET /v1/admin/shipments/${S}`]: shipment({ status: 'ARRIVED', arrivedAt: '2026-10-27T12:00:00.000Z', departedAt: '2026-10-27T10:00:00.000Z' }) });
    const first = renderAt(`/fr/account/staff/shipments/${S}`);
    await screen.findByTestId('shipment-reference');
    expect(screen.getByRole('button', { name: fr.staff.shipment.actions.close })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: fr.staff.shipment.actions.customs })).not.toBeInTheDocument(); // sans shipment:receive
    first.unmount();

    signedIn(perms, { [`GET /v1/admin/shipments/${S}`]: shipment({ status: 'CLOSED', arrivedAt: '2026-10-27T12:00:00.000Z', departedAt: '2026-10-27T10:00:00.000Z' }) });
    renderAt(`/fr/account/staff/shipments/${S}`);
    await screen.findByTestId('shipment-reference');
    for (const action of Object.values(fr.staff.shipment.actions)) expect(screen.queryByRole('button', { name: action })).not.toBeInTheDocument();
  });

  it('télécharge le manifeste avec la session (requête authentifiée)', async () => {
    const created: Blob[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: (b: Blob) => (created.push(b), 'blob:test'), revokeObjectURL: () => undefined }));
    signedIn(perms, {
      [`GET /v1/admin/shipments/${S}`]: shipment(),
      [`GET /v1/admin/shipments/${S}/manifest.csv`]: () => new Response('﻿Lot,X', { status: 200, headers: { 'Content-Type': 'text/csv' } }),
    });
    const user = userEvent.setup();
    renderAt(`/fr/account/staff/shipments/${S}`);
    await user.click(await screen.findByRole('button', { name: fr.staff.shipment.csv }));
    await waitFor(() => expect(calls(`GET /v1/admin/shipments/${S}/manifest.csv`)).toHaveLength(1));
    const headers = new Headers((calls(`GET /v1/admin/shipments/${S}/manifest.csv`)[0][1] as RequestInit).headers);
    expect(headers.get('Authorization')).toBe('Bearer jeton-de-test');
    await waitFor(() => expect(created).toHaveLength(1));
  });

  it('création d’un lot : validation puis envoi sans date prévue', async () => {
    signedIn(perms, {
      'GET /v1/admin/shipments': { items: [] },
      'GET /v1/admin/warehouses': { items: [warehouse] },
      'GET /v1/admin/agencies': { items: [] },
      'POST /v1/admin/shipments': () => json(201, shipment()),
    });
    const user = userEvent.setup();
    renderAt('/fr/account/staff/shipments');
    await user.click(await screen.findByRole('button', { name: fr.staff.shipments.new }));
    const country = await screen.findByLabelText(fr.staff.shipments.form.country);
    await user.clear(country);
    await user.type(country, 'H');
    await user.click(screen.getByRole('button', { name: fr.staff.shipments.form.submit }));
    expect(await screen.findByText(fr.validation.countryCode)).toBeInTheDocument();
    expect(calls('POST /v1/admin/shipments')).toHaveLength(0);
    await user.type(country, 'T');
    await user.type(screen.getByLabelText(new RegExp(`^${fr.staff.shipments.form.carrier}`)), 'Cargo Express');
    await user.click(screen.getByRole('button', { name: fr.staff.shipments.form.submit }));
    await waitFor(() => expect(calls('POST /v1/admin/shipments')).toHaveLength(1));
    expect(bodyOf(calls('POST /v1/admin/shipments')[0])).toEqual({ transportMode: 'AIR', originWarehouseId: W, destinationCountry: 'HT', carrierName: 'Cargo Express' });
  });
});

describe('agence', () => {
  it('reçoit un colis par lecture, signale les refus, et marque « prêt pour retrait »', async () => {
    let calledReady = false;
    signedIn(['agency:read', 'agency:receive'], {
      'GET /v1/admin/agencies': { items: [{ id: A, code: 'PAP', name: 'Agence Delmas', city: 'Delmas', country: 'HT' }] },
      [`GET /v1/admin/agencies/${A}/packages`]: () => json(200, { agency: {}, expected: 2, items: [pkg({ status: calledReady ? 'READY_FOR_PICKUP' : 'RECEIVED_AT_AGENCY' })] }),
      [`POST /v1/admin/agencies/${A}/receive`]: (init) => {
        const code = JSON.parse(String(init?.body)).code;
        return code === 'AUTRE-AGENCE' ? json(409, { error: { code: 'WRONG_AGENCY', message: 'x' } }) : json(200, { outcome: 'RECEIVED', package: pkg({ status: 'RECEIVED_AT_AGENCY' }) });
      },
      [`POST /v1/admin/agencies/${A}/packages/${P}/ready-for-pickup`]: () => {
        calledReady = true;
        return json(200, pkg({ status: 'READY_FOR_PICKUP' }));
      },
    });
    const user = userEvent.setup();
    renderAt('/fr/account/staff/agency');
    const field = await screen.findByLabelText(fr.staff.agency.code);
    expect(await screen.findByText('2 colis en route vers cette agence.')).toBeInTheDocument();

    await user.type(field, 'AUTRE-AGENCE{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent(`AUTRE-AGENCE : ${fr.auth.errors.WRONG_AGENCY}`);
    await user.type(field, 'EE-ABCDE-12345-X{Enter}');
    expect(await screen.findByTestId('agency-scan-result')).toHaveTextContent(`EE-ABCDE-12345-X : ${fr.staff.agency.outcomes.RECEIVED}`);

    await user.click(await screen.findByRole('button', { name: `${fr.staff.agency.ready} : EE-ABCDE-12345-X` }));
    expect(await screen.findByText(fr.staff.agency.readyDone)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: new RegExp(`^${fr.staff.agency.ready}`) })).not.toBeInTheDocument());
  });
});

describe('inventaire de l’entrepôt', () => {
  it('affiche les compteurs, les emplacements et la file des anomalies', async () => {
    const L = '1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c66';
    signedIn(['warehouse:read', 'warehouse:manage', 'package:read'], {
      'GET /v1/admin/warehouses': { items: [warehouse] },
      [`GET /v1/admin/warehouses/${W}/inventory`]: { warehouse, total: 3, unplaced: 1, locations: [{ id: L, code: 'A-01', kind: 'SHELF', status: 'ACTIVE', count: 2 }], items: [pkg()], truncated: false },
      [`GET /v1/admin/warehouses/${W}/locations`]: { items: [{ id: L, code: 'A-01', kind: 'SHELF', status: 'ACTIVE' }] },
      'GET /v1/admin/anomalies': { holds: [{ id: 'h1', reasonCode: 'DAMAGED', note: 'Écrasé', openedAt: '2026-10-27T10:00:00.000Z', package: pkg({ status: 'ON_HOLD' }) }], unidentified: [pkg({ customer: null })] },
      [`POST /v1/admin/warehouses/${W}/locations`]: () => json(201, { id: 'n', code: 'B-02', kind: 'BIN', status: 'ACTIVE', warehouseId: W }),
    });
    const user = userEvent.setup();
    renderAt('/fr/account/staff/warehouse');
    expect(await screen.findByTestId('inventory-total')).toHaveTextContent('3');
    expect(screen.getByTestId('inventory-unplaced')).toHaveTextContent('1');
    expect(screen.getAllByText('A-01').length).toBeGreaterThan(0);
    expect(within(await screen.findByTestId('anomaly-holds')).getByText(fr.holdReasons.DAMAGED)).toBeInTheDocument();
    expect(within(screen.getByTestId('anomaly-unidentified')).getByText('EE-ABCDE-12345-X')).toBeInTheDocument();

    await user.type(screen.getByLabelText(fr.staff.warehouse.code), 'b-02');
    await user.click(screen.getByRole('button', { name: fr.common.add }));
    await waitFor(() => expect(calls(`POST /v1/admin/warehouses/${W}/locations`)).toHaveLength(1));
    expect(bodyOf(calls(`POST /v1/admin/warehouses/${W}/locations`)[0])).toEqual({ code: 'b-02', kind: 'SHELF' });
    expect(await screen.findByText(fr.staff.warehouse.created)).toBeInTheDocument();
  });
});

describe('point de retrait et agences publiques', () => {
  const pickup = { name: 'Agence Delmas', kind: 'AGENCY', city: 'Delmas', country: 'HT', addressLine: '1 rue de Test', phone: '+50937000000', hours: 'Lun-Ven 8h-17h', ready: true };

  it('suivi public : montre le point de retrait seulement quand le colis y est', async () => {
    mockApi({
      'GET /v1/public/tracking/EE-ABCDE-12345-X': {
        trackingNumber: 'EE-ABCDE-12345-X', status: 'READY_FOR_PICKUP', lastUpdate: '2026-10-27T10:00:00.000Z', transportMode: 'AIR',
        origin: { country: 'US', city: 'Miami' }, destination: { country: 'HT', city: null }, estimatedDelivery: null, pickup, events: [],
      },
    });
    renderAt('/fr/tracking?n=EE-ABCDE-12345-X');
    const box = await screen.findByTestId('tracking-pickup');
    expect(box).toHaveTextContent(fr.tracking.result.pickupReady);
    expect(box).toHaveTextContent('Agence Delmas');
    expect(box).toHaveTextContent('Lun-Ven 8h-17h');
  });

  it('colis du client : carte du point de retrait', async () => {
    document.cookie = 'b2c_session=1';
    mockApi({
      'POST /v1/auth/refresh': { accessToken: 'jeton' },
      'GET /v1/auth/me': { ...staffUser([]), kind: 'CUSTOMER' },
      [`GET /v1/me/packages/${P}`]: {
        id: P, trackingNumber: 'EEABCDE12345X', trackingNumberDisplay: 'EE-ABCDE-12345-X', status: 'READY_FOR_PICKUP', transportMode: 'AIR', supplierTracking: null,
        contentDescription: null, origin: { country: 'US', city: 'Miami', warehouse: 'Miami' }, destination: { country: 'HT', city: null },
        measures: { actualWeightKg: null, billableWeight: null, weightUnit: 'KG' }, fees: null, pickup, receivedAt: null, createdAt: '2026-10-27T10:00:00.000Z', events: [],
      },
      'GET /v1/files': { items: [] },
    });
    renderAt(`/fr/account/packages/${P}`);
    const card = await screen.findByTestId('pickup-card');
    expect(card).toHaveTextContent(fr.account.packages.detail.pickupReady);
    expect(card).toHaveTextContent('1 rue de Test, Delmas');
  });

  it('page Entrepôts et agences : liste les agences publiées, ou dit honnêtement qu’il n’y en a pas', async () => {
    mockApi({
      'GET /v1/public/companies/demo/warehouses': { items: [] },
      'GET /v1/public/companies/demo/agencies': { items: [{ name: 'Agence Delmas', kind: 'AGENCY', country: 'HT', city: 'Delmas', addressLine: '1 rue de Test', phone: '+50937000000', hours: 'Lun-Ven 8h-17h' }] },
    });
    const first = renderAt('/fr/locations');
    expect(await screen.findByRole('heading', { name: 'Agence Delmas' })).toBeInTheDocument();
    expect(screen.getByText('Lun-Ven 8h-17h')).toBeInTheDocument();
    expect(screen.queryByText(fr.locations.agenciesEmpty)).not.toBeInTheDocument();
    first.unmount();

    mockApi({ 'GET /v1/public/companies/demo/warehouses': { items: [] }, 'GET /v1/public/companies/demo/agencies': { items: [] } });
    renderAt('/fr/locations');
    expect(await screen.findByText(fr.locations.agenciesEmpty)).toBeInTheDocument();
  });
});
