import { Injectable } from '@nestjs/common';
import { formatTrackingNumber, type PackageStatus } from '@b2c/shared';
import { AppException } from '../common/errors';
import { DbService } from '../database/db.service';
import type { AuthContext } from '../security/auth.types';

/** Colis qui ne sont ni remis, ni retournés, ni annulés : ceux qui peuvent être « en retard ». */
const OPEN_STATUSES: PackageStatus[] = [
  'AWAITING_RECEIPT',
  'RECEIVED_AT_WAREHOUSE',
  'UNDER_INSPECTION',
  'REGISTERED_WEIGHED',
  'AWAITING_PAYMENT',
  'READY_TO_SHIP',
  'IN_TRANSIT',
  'ARRIVED_DESTINATION',
  'IN_CUSTOMS',
  'RECEIVED_AT_AGENCY',
  'READY_FOR_PICKUP',
  'OUT_FOR_DELIVERY',
  'ON_HOLD',
];

@Injectable()
export class OpsService {
  constructor(private readonly db: DbService) {}

  /** Colis sans changement depuis `days` jours : alerte de retard. Seuls les entrepôts que l'on a le droit de voir sont listés. */
  async delays(auth: AuthContext, days: number) {
    const limit = new Date(Date.now() - days * 86_400_000);
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const rows = await tx.package.findMany({
        where: { status: { in: OPEN_STATUSES }, updatedAt: { lt: limit } },
        orderBy: { updatedAt: 'asc' },
        take: 200,
        include: { customer: { include: { user: true } }, warehouse: true },
      });
      const visible = rows.filter((p) => auth.permissions.can('package:read', { type: 'WAREHOUSE', id: p.originWarehouseId }));
      return {
        days,
        items: visible.map((p) => ({
          id: p.id,
          trackingNumberDisplay: formatTrackingNumber(p.trackingNumber),
          status: p.status,
          customer: p.customer ? { id: p.customer.id, customerCode: p.customer.customerCode, name: p.customer.user.businessName || `${p.customer.user.firstName} ${p.customer.user.lastName}` } : null,
          warehouse: p.warehouse.name,
          lastUpdate: p.updatedAt,
          idleDays: Math.floor((Date.now() - p.updatedAt.getTime()) / 86_400_000),
        })),
      };
    });
  }

  /** « Flot » d'un client : ses colis par statut, son volume et ses derniers colis. */
  async customerFlow(auth: AuthContext, customerId: string) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const customer = await tx.customer.findUnique({ where: { id: customerId }, include: { user: true } });
      if (!customer) throw AppException.notFound('CUSTOMER_NOT_FOUND', 'Client introuvable');
      const byStatus = await tx.package.groupBy({ by: ['status'], where: { customerId }, _count: { _all: true } });
      const recent = await tx.package.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' }, take: 10 });
      const total = byStatus.reduce((acc, r) => acc + r._count._all, 0);
      const open = byStatus.filter((r) => OPEN_STATUSES.includes(r.status)).reduce((acc, r) => acc + r._count._all, 0);
      return {
        customer: { id: customer.id, customerCode: customer.customerCode, name: customer.user.businessName || `${customer.user.firstName} ${customer.user.lastName}` },
        total,
        open,
        byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])),
        recent: recent.map((p) => ({ id: p.id, trackingNumberDisplay: formatTrackingNumber(p.trackingNumber), status: p.status, createdAt: p.createdAt })),
      };
    });
  }
}
