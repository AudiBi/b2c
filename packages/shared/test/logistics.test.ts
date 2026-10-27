import { PACKAGE_STATUSES, findTransition, isTerminal } from '../src/package-status';
import { PERMISSIONS } from '../src/permissions';
import {
  SHIPMENT_STATUSES,
  SHIPMENT_TERMINAL,
  SHIPMENT_TRANSITIONS,
  findShipmentTransition,
  LOADABLE_PACKAGE_STATUS,
  IN_WAREHOUSE_STATUSES,
} from '../src/shipment-status';
import {
  createAgencySchema,
  createLocationSchema,
  createShipmentSchema,
  loadPackageSchema,
  moveSchema,
  scanReceiveSchema,
  updateAgencySchema,
  updateShipmentSchema,
} from '../src/schemas/logistics';

const uuid = '3f2b8c1e-9d4a-4e6b-8a1f-2c7d5e9b0a11';

describe('statuts et transitions des lots', () => {
  it('chaque transition utilise une permission qui existe', () => {
    for (const t of SHIPMENT_TRANSITIONS) expect(Object.keys(PERMISSIONS)).toContain(t.permission);
  });

  it('TEST EXHAUSTIF : sur les 36 paires, seules celles de la table sont permises ; rien ne sort d’un statut terminal', () => {
    const allowed = new Set(SHIPMENT_TRANSITIONS.map((t) => `${t.from}>${t.to}`));
    expect(allowed.size).toBe(SHIPMENT_TRANSITIONS.length);
    let checked = 0;
    for (const from of SHIPMENT_STATUSES) {
      for (const to of SHIPMENT_STATUSES) {
        checked += 1;
        expect({ pair: `${from}>${to}`, ok: findShipmentTransition(from, to) !== undefined }).toEqual({ pair: `${from}>${to}`, ok: allowed.has(`${from}>${to}`) });
      }
    }
    expect(checked).toBe(36);
    for (const t of SHIPMENT_TRANSITIONS) expect(SHIPMENT_TERMINAL).not.toContain(t.from);
  });

  it('l’événement d’un lot ne fait avancer les colis que par des transitions que la table des colis autorise', () => {
    for (const t of SHIPMENT_TRANSITIONS) {
      if (!t.packages) continue;
      const rule = findTransition(t.packages.from, t.packages.to);
      expect({ pair: `${t.packages.from}>${t.packages.to}`, found: rule !== undefined }).toEqual({ pair: `${t.packages.from}>${t.packages.to}`, found: true });
      // ces transitions appartiennent au module des lots, pas à l'API générique des colis
      expect(rule?.owner).toBe('SHIPMENTS');
      expect(rule?.permission).toBe(t.permission);
    }
  });

  it('seuls départ, arrivée et douane touchent aux colis ; l’annulation et la clôture non', () => {
    expect(SHIPMENT_TRANSITIONS.filter((t) => t.packages).map((t) => t.to)).toEqual(['DISPATCHED', 'ARRIVED', 'IN_CUSTOMS']);
  });

  it('un colis ne se charge que prêt à expédier, et l’inventaire ne compte aucun statut terminal ni de transport', () => {
    expect(LOADABLE_PACKAGE_STATUS).toBe('READY_TO_SHIP');
    expect(PACKAGE_STATUSES).toContain(LOADABLE_PACKAGE_STATUS);
    for (const status of IN_WAREHOUSE_STATUSES) {
      expect(isTerminal(status)).toBe(false);
      expect(['IN_TRANSIT', 'ARRIVED_DESTINATION', 'IN_CUSTOMS', 'AWAITING_RECEIPT', 'PREALERT_CREATED']).not.toContain(status);
    }
  });
});

describe('schémas de la logistique', () => {
  it('emplacement : code normalisé en majuscules, format strict', () => {
    expect(createLocationSchema.parse({ code: 'a-01' })).toEqual({ code: 'A-01', kind: 'SHELF' });
    for (const bad of ['', ' ', '-A', 'a b', 'a'.repeat(21), '../x', 'é1']) expect(createLocationSchema.safeParse({ code: bad }).success).toBe(false);
  });

  it('déplacement : un emplacement ou null', () => {
    expect(moveSchema.safeParse({ locationId: uuid }).success).toBe(true);
    expect(moveSchema.safeParse({ locationId: null }).success).toBe(true);
    expect(moveSchema.safeParse({}).success).toBe(false);
    expect(moveSchema.safeParse({ locationId: 'x' }).success).toBe(false);
  });

  it('scan : code lisible seulement', () => {
    expect(scanReceiveSchema.safeParse({ warehouseId: uuid, code: 'EE-ABCDE-12345-X' }).success).toBe(true);
    for (const code of ['abc', '', '<script>', 'a'.repeat(81), "1Z' OR 1=1"]) expect(scanReceiveSchema.safeParse({ warehouseId: uuid, code }).success).toBe(false);
  });

  it('agence : valeurs par défaut à la création, aucune à la modification', () => {
    const created = createAgencySchema.parse({ code: 'pap-1', name: 'Agence', country: 'ht', city: 'Port-au-Prince', addressLine: '1 rue X' });
    expect(created).toMatchObject({ code: 'PAP-1', kind: 'AGENCY', publicVisible: true, country: 'HT' });
    // renommer ne doit pas remettre « visible » à vrai ni le type à « agence »
    expect(updateAgencySchema.parse({ name: 'Autre' })).toEqual({ name: 'Autre' });
    expect(updateAgencySchema.safeParse({}).success).toBe(false);
    expect(updateAgencySchema.safeParse({ phone: null, hours: null }).success).toBe(true);
    expect(updateAgencySchema.safeParse({ code: 'NEW' }).success).toBe(false);
  });

  it('lot : création et modification', () => {
    const input = { transportMode: 'AIR', originWarehouseId: uuid, destinationCountry: 'ht' };
    expect(createShipmentSchema.parse(input).destinationCountry).toBe('HT');
    expect(createShipmentSchema.safeParse({ ...input, plannedArrival: '2026-01-01' }).success).toBe(false); // aucune date prévue
    expect(createShipmentSchema.safeParse({ ...input, transportMode: 'ROAD' }).success).toBe(false);
    expect(updateShipmentSchema.parse({ notes: 'x' })).toEqual({ notes: 'x' });
    expect(updateShipmentSchema.safeParse({}).success).toBe(false);
  });

  it('chargement : soit un code, soit un identifiant', () => {
    expect(loadPackageSchema.safeParse({ code: 'EE-ABCDE-12345-X' }).success).toBe(true);
    expect(loadPackageSchema.safeParse({ packageId: uuid }).success).toBe(true);
    expect(loadPackageSchema.safeParse({}).success).toBe(false);
    expect(loadPackageSchema.safeParse({ code: 'EE-ABCDE-12345-X', packageId: uuid }).success).toBe(false);
  });
});
