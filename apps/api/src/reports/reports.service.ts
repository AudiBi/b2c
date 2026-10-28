import { Injectable } from '@nestjs/common';
import { PACKAGE_STATUSES } from '@b2c/shared';
import { AppException } from '../common/errors';
import { DbService, type Tx } from '../database/db.service';
import type { AuthContext } from '../security/auth.types';

const DAY = 86_400_000;
const iso = (date: Date) => date.toISOString().slice(0, 10);
const AT_WAREHOUSE = ['RECEIVED_AT_WAREHOUSE', 'UNDER_INSPECTION', 'REGISTERED_WEIGHED', 'AWAITING_PAYMENT', 'READY_TO_SHIP'];
const AT_AGENCY = ['RECEIVED_AT_AGENCY', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY'];

export interface Delay {
  count: number;
  avgHours: number | null;
}

/** Une moyenne n'est donnée que s'il y a des mesures : jamais de zéro inventé. */
const delay = (row: { n: number; hours: number | null } | undefined): Delay => ({
  count: row?.n ?? 0,
  avgHours: row && row.n > 0 && row.hours !== null ? Math.round(Number(row.hours) * 10) / 10 : null,
});

/** Indicateurs du tableau de bord : uniquement des requêtes sur les données de l'entreprise (état vide affiché tel quel). */
@Injectable()
export class ReportsService {
  constructor(private readonly db: DbService) {}

  async dashboard(auth: AuthContext, query: { from?: string; to?: string }) {
    // Chiffres de toute l'entreprise : un droit limité à une agence ou un entrepôt ne les voit pas
    if (!auth.permissions.can('report:read')) throw AppException.forbidden('REPORT_SCOPE', 'Le tableau de bord concerne toute l’entreprise');
    const today = new Date();
    const toDay = query.to ? new Date(`${query.to}T00:00:00Z`) : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const fromDay = query.from ? new Date(`${query.from}T00:00:00Z`) : new Date(toDay.getTime() - 29 * DAY);
    const from = fromDay;
    const to = new Date(toDay.getTime() + DAY); // exclusif : la journée de fin est incluse

    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const [customers, packages, shipments, warehouses, finance, incidents, delays, agencies, drivers] = await Promise.all([
        this.customers(tx, from, to),
        this.packages(tx, from, to),
        this.shipments(tx, from, to),
        this.warehouses(tx, from, to),
        this.finance(tx, from, to),
        this.incidents(tx, from, to),
        this.delays(tx, from, to),
        this.agencies(tx, from, to),
        this.drivers(tx, from, to),
      ]);
      return { range: { from: iso(fromDay), to: iso(toDay) }, generatedAt: new Date(), customers, packages, shipments, warehouses, finance, incidents, delays, agencies, drivers };
    });
  }

  private async customers(tx: Tx, from: Date, to: Date) {
    const [total, created] = await Promise.all([tx.customer.count(), tx.customer.count({ where: { createdAt: { gte: from, lt: to } } })]);
    return { total, newInRange: created };
  }

  private async packages(tx: Tx, from: Date, to: Date) {
    const [groups, received, delivered] = await Promise.all([
      tx.package.groupBy({ by: ['status'], _count: { _all: true } }),
      tx.package.count({ where: { receivedAt: { gte: from, lt: to } } }),
      tx.packageEvent.count({ where: { toStatus: 'DELIVERED', occurredAt: { gte: from, lt: to } } }),
    ]);
    const byStatus = Object.fromEntries(PACKAGE_STATUSES.map((s) => [s, 0])) as Record<string, number>;
    for (const g of groups) byStatus[g.status] = g._count._all;
    return {
      receivedInRange: received,
      deliveredInRange: delivered,
      inTransit: byStatus.IN_TRANSIT,
      awaitingPayment: byStatus.AWAITING_PAYMENT,
      toDeliver: AT_AGENCY.reduce((sum, s) => sum + byStatus[s], 0),
      onHold: byStatus.ON_HOLD,
      byStatus,
    };
  }

  private async shipments(tx: Tx, from: Date, to: Date) {
    const groups = await tx.shipment.groupBy({ by: ['transportMode'], where: { createdAt: { gte: from, lt: to } }, _count: { _all: true } });
    return { byMode: groups.map((g) => ({ mode: g.transportMode, count: g._count._all })) };
  }

  private async warehouses(tx: Tx, from: Date, to: Date) {
    const [list, current, received] = await Promise.all([
      tx.warehouse.findMany({ select: { id: true, name: true, city: true }, orderBy: { name: 'asc' } }),
      tx.package.groupBy({ by: ['originWarehouseId'], where: { status: { in: AT_WAREHOUSE as never[] } }, _count: { _all: true } }),
      tx.package.groupBy({ by: ['originWarehouseId'], where: { receivedAt: { gte: from, lt: to } }, _count: { _all: true } }),
    ]);
    const cur = new Map(current.map((g) => [g.originWarehouseId, g._count._all]));
    const rec = new Map(received.map((g) => [g.originWarehouseId, g._count._all]));
    return list.map((w) => ({ id: w.id, name: w.name, city: w.city, atWarehouse: cur.get(w.id) ?? 0, receivedInRange: rec.get(w.id) ?? 0 }));
  }

  private async finance(tx: Tx, from: Date, to: Date) {
    const [collected, refunded, invoiced, unpaid] = await Promise.all([
      tx.$queryRaw<{ currency: string; amount: string; n: number }[]>`
        SELECT currency, sum(amount)::text AS amount, count(*)::int AS n FROM payments
        WHERE confirmed_at >= ${from} AND confirmed_at < ${to} AND status IN ('CONFIRMED', 'REFUNDED_PARTIAL', 'REFUNDED')
        GROUP BY currency ORDER BY currency`,
      tx.$queryRaw<{ currency: string; amount: string }[]>`
        SELECT p.currency, sum(r.amount)::text AS amount FROM refunds r JOIN payments p ON p.id = r.payment_id
        WHERE r.created_at >= ${from} AND r.created_at < ${to} GROUP BY p.currency ORDER BY p.currency`,
      tx.$queryRaw<{ currency: string; amount: string; n: number }[]>`
        SELECT currency, sum(total)::text AS amount, count(*)::int AS n FROM invoices
        WHERE issued_at >= ${from} AND issued_at < ${to} AND status <> 'VOID' GROUP BY currency ORDER BY currency`,
      tx.$queryRaw<{ currency: string; amount: string; n: number }[]>`
        SELECT currency, sum(total - credited_total - paid_total)::text AS amount, count(*)::int AS n FROM invoices
        WHERE status IN ('ISSUED', 'PARTIALLY_PAID') GROUP BY currency ORDER BY currency`,
    ]);
    const money = (rows: { currency: string; amount: string; n?: number }[]) => rows.map((r) => ({ currency: r.currency, amount: Number(r.amount).toFixed(2), ...(r.n !== undefined ? { count: r.n } : {}) }));
    return { collected: money(collected), refunded: money(refunded), invoiced: money(invoiced), unpaid: money(unpaid) };
  }

  private async incidents(tx: Tx, from: Date, to: Date) {
    const [openHolds, holdsInRange, claimGroups, claimsInRange] = await Promise.all([
      tx.packageHold.count({ where: { releasedAt: null } }),
      tx.packageHold.count({ where: { openedAt: { gte: from, lt: to } } }),
      tx.claim.groupBy({ by: ['status'], _count: { _all: true } }),
      tx.claim.count({ where: { openedAt: { gte: from, lt: to } } }),
    ]);
    const claims = { OPEN: 0, IN_PROGRESS: 0, RESOLVED: 0, REJECTED: 0 } as Record<string, number>;
    for (const g of claimGroups) claims[g.status] = g._count._all;
    return { openHolds, holdsOpenedInRange: holdsInRange, claimsByStatus: claims, claimsOpenInProgress: claims.OPEN + claims.IN_PROGRESS, claimsOpenedInRange: claimsInRange };
  }

  /** Délai moyen entre deux étapes, pour les colis dont l'étape d'arrivée tombe dans la période. */
  private async delays(tx: Tx, from: Date, to: Date) {
    const between = (start: string, end: string) =>
      tx.$queryRaw<{ n: number; hours: number | null }[]>`
        SELECT count(*)::int AS n, avg(extract(epoch FROM (b.at - a.at)) / 3600)::float8 AS hours
        FROM (SELECT package_id, min(occurred_at) AS at FROM package_events WHERE to_status = ${start}::"PackageStatus" GROUP BY package_id) a
        JOIN (SELECT package_id, min(occurred_at) AS at FROM package_events WHERE to_status = ${end}::"PackageStatus" GROUP BY package_id) b USING (package_id)
        WHERE b.at >= ${from} AND b.at < ${to} AND b.at >= a.at`;
    const [warehouse, transport, agency] = await Promise.all([
      between('RECEIVED_AT_WAREHOUSE', 'READY_TO_SHIP'),
      between('IN_TRANSIT', 'ARRIVED_DESTINATION'),
      between('RECEIVED_AT_AGENCY', 'DELIVERED'),
    ]);
    return { warehouseReceiptToReady: delay(warehouse[0]), transport: delay(transport[0]), agencyReceiptToDelivered: delay(agency[0]) };
  }

  private async agencies(tx: Tx, from: Date, to: Date) {
    const [list, current, delivered, hours] = await Promise.all([
      tx.agency.findMany({ select: { id: true, name: true, city: true }, orderBy: { name: 'asc' } }),
      tx.package.groupBy({ by: ['destinationAgencyId'], where: { status: { in: AT_AGENCY as never[] }, destinationAgencyId: { not: null } }, _count: { _all: true } }),
      tx.$queryRaw<{ agency_id: string; n: number }[]>`
        SELECT p.destination_agency_id AS agency_id, count(DISTINCT e.package_id)::int AS n
        FROM package_events e JOIN packages p ON p.id = e.package_id
        WHERE e.to_status = 'DELIVERED' AND e.occurred_at >= ${from} AND e.occurred_at < ${to} AND p.destination_agency_id IS NOT NULL
        GROUP BY p.destination_agency_id`,
      tx.$queryRaw<{ agency_id: string; hours: number | null }[]>`
        SELECT p.destination_agency_id AS agency_id, avg(extract(epoch FROM (d.at - r.at)) / 3600)::float8 AS hours
        FROM packages p
        JOIN (SELECT package_id, min(occurred_at) AS at FROM package_events WHERE to_status = 'RECEIVED_AT_AGENCY' GROUP BY package_id) r ON r.package_id = p.id
        JOIN (SELECT package_id, min(occurred_at) AS at FROM package_events WHERE to_status = 'DELIVERED' GROUP BY package_id) d ON d.package_id = p.id
        WHERE d.at >= ${from} AND d.at < ${to} AND d.at >= r.at AND p.destination_agency_id IS NOT NULL
        GROUP BY p.destination_agency_id`,
    ]);
    const cur = new Map(current.map((g) => [g.destinationAgencyId, g._count._all]));
    const del = new Map(delivered.map((g) => [g.agency_id, g.n]));
    const hrs = new Map(hours.map((g) => [g.agency_id, g.hours]));
    return list.map((a) => ({
      id: a.id,
      name: a.name,
      city: a.city,
      inAgency: cur.get(a.id) ?? 0,
      deliveredInRange: del.get(a.id) ?? 0,
      avgHoursToDeliver: hrs.get(a.id) != null ? Math.round(Number(hrs.get(a.id)) * 10) / 10 : null,
    }));
  }

  private async drivers(tx: Tx, from: Date, to: Date) {
    const rows = await tx.deliveryAttempt.groupBy({
      by: ['actorUserId', 'outcome'],
      where: { channel: 'ROUTE', attemptedAt: { gte: from, lt: to }, actorUserId: { not: null } },
      _count: { _all: true },
    });
    const ids = [...new Set(rows.map((r) => r.actorUserId!))];
    const users = ids.length ? await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true } }) : [];
    return users
      .map((u) => {
        const count = (outcome: string) => rows.find((r) => r.actorUserId === u.id && r.outcome === outcome)?._count._all ?? 0;
        const succeeded = count('SUCCEEDED');
        const failed = count('FAILED');
        return { id: u.id, name: `${u.firstName} ${u.lastName}`, succeeded, failed, successRate: succeeded + failed > 0 ? Math.round((succeeded / (succeeded + failed)) * 100) : null };
      })
      .sort((a, b) => b.succeeded - a.succeeded);
  }
}
