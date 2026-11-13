import { Injectable } from '@nestjs/common';
import { Prisma, type CustomsItem } from '@prisma/client';
import {
  CustomsFeeError,
  DEFAULT_CUSTOMS_ITEMS,
  customsFee,
  type AddCustomsLineInput,
  type CustomsItemInput,
  type UpdateCustomsItemInput,
} from '@b2c/shared';
import { AuditService } from '../audit/audit.service';
import { AppException, isUniqueViolation } from '../common/errors';
import { DbService } from '../database/db.service';
import type { AuthContext } from '../security/auth.types';

const D = Prisma.Decimal;
/** Les frais CONATEL sont fixés en dollars américains. */
export const CUSTOMS_CURRENCY = 'USD';

const num = (value: Prisma.Decimal | null) => (value === null ? null : value.toNumber());

export const itemDto = (item: CustomsItem) => ({
  id: item.id,
  name: item.name,
  size: item.size,
  kind: item.kind,
  normalPrice: item.normalPrice?.toFixed(2) ?? null,
  vipPrice: item.vipPrice?.toFixed(2) ?? null,
  rate: item.rate?.toString() ?? null,
  requiresAuthorization: item.requiresAuthorization,
  active: item.active,
});

/**
 * Frais CONATEL : table d'articles de l'entreprise et lignes par colis. Les frais sont calculés et FIGÉS à la saisie ;
 * ils passent sur la facture en lignes de type CUSTOMS (reversées, hors marge), jamais mélangées au fret.
 */
@Injectable()
export class CustomsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async listItems(auth: AuthContext, includeInactive: boolean) {
    const rows = await this.db.run({ companyId: auth.companyId }, (tx) =>
      tx.customsItem.findMany({ where: includeInactive ? {} : { active: true }, orderBy: [{ name: 'asc' }, { size: 'asc' }] }),
    );
    return { items: rows.map(itemDto) };
  }

  async createItem(auth: AuthContext, input: CustomsItemInput) {
    try {
      return await this.db.run({ companyId: auth.companyId }, async (tx) => {
        const row = await tx.customsItem.create({ data: this.data(auth.companyId, input) });
        await this.audit.record(tx, { companyId: auth.companyId, action: 'customs_item.created', entityType: 'customs_item', entityId: row.id, after: { name: row.name, size: row.size } });
        return itemDto(row);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw AppException.conflict('CUSTOMS_ITEM_EXISTS', 'Cet article existe déjà (même désignation et même taille)');
      throw error;
    }
  }

  async updateItem(auth: AuthContext, id: string, input: UpdateCustomsItemInput) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const before = await tx.customsItem.findUnique({ where: { id } });
      if (!before) throw AppException.notFound('CUSTOMS_ITEM_NOT_FOUND', 'Article introuvable');
      const row = await tx.customsItem.update({
        where: { id },
        data: {
          normalPrice: input.normalPrice !== undefined ? new D(String(input.normalPrice)) : undefined,
          vipPrice: input.vipPrice !== undefined ? new D(String(input.vipPrice)) : undefined,
          rate: input.rate !== undefined ? new D(String(input.rate)) : undefined,
          requiresAuthorization: input.requiresAuthorization,
          active: input.active,
        },
      });
      await this.audit.record(tx, {
        companyId: auth.companyId,
        action: 'customs_item.updated',
        entityType: 'customs_item',
        entityId: id,
        before: { normalPrice: before.normalPrice?.toFixed(2), vipPrice: before.vipPrice?.toFixed(2), rate: before.rate?.toString() },
        after: input,
      });
      return itemDto(row);
    });
  }

  /** Charge la table de départ ; les articles déjà présents ne sont jamais modifiés. */
  async loadDefaults(auth: AuthContext) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const result = await tx.customsItem.createMany({ data: DEFAULT_CUSTOMS_ITEMS.map((i) => this.data(auth.companyId, i)), skipDuplicates: true });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'customs_item.defaults_loaded', entityType: 'customs_item', after: { added: result.count } });
      return { added: result.count, total: DEFAULT_CUSTOMS_ITEMS.length };
    });
  }

  private data(companyId: string, input: CustomsItemInput): Prisma.CustomsItemUncheckedCreateInput {
    return {
      companyId,
      name: input.name,
      size: input.size,
      kind: input.kind,
      normalPrice: input.normalPrice !== undefined ? new D(String(input.normalPrice)) : null,
      vipPrice: input.vipPrice !== undefined ? new D(String(input.vipPrice)) : null,
      rate: input.rate !== undefined ? new D(String(input.rate)) : null,
      requiresAuthorization: input.requiresAuthorization,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Lignes d'un colis
  // ---------------------------------------------------------------------------------------------

  private lineDto(line: { id: string; quantity: number; vip: boolean; declaredValue: Prisma.Decimal | null; watts: Prisma.Decimal | null; fee: Prisma.Decimal; currency: string; item: CustomsItem }) {
    return {
      id: line.id,
      item: { id: line.item.id, name: line.item.name, size: line.item.size, requiresAuthorization: line.item.requiresAuthorization },
      quantity: line.quantity,
      vip: line.vip,
      declaredValue: line.declaredValue?.toFixed(2) ?? null,
      watts: line.watts?.toString() ?? null,
      fee: line.fee.toFixed(2),
      currency: line.currency,
    };
  }

  private canEdit(auth: AuthContext, warehouseId: string): boolean {
    return auth.permissions.can('package:update', { type: 'WAREHOUSE', id: warehouseId });
  }

  async listLines(auth: AuthContext, packageId: string) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const pkg = await tx.package.findUnique({ where: { id: packageId }, select: { id: true, originWarehouseId: true } });
      if (!pkg || !auth.permissions.can('package:read', { type: 'WAREHOUSE', id: pkg.originWarehouseId })) throw AppException.notFound('PACKAGE_NOT_FOUND', 'Colis introuvable');
      const lines = await tx.packageCustomsLine.findMany({ where: { packageId }, include: { item: true }, orderBy: { createdAt: 'asc' } });
      const total = lines.reduce((acc, l) => acc.add(l.fee), new D(0));
      return { items: lines.map((l) => this.lineDto(l)), total: total.toFixed(2), currency: CUSTOMS_CURRENCY };
    });
  }

  async addLine(auth: AuthContext, packageId: string, input: AddCustomsLineInput) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const pkg = await tx.package.findUnique({ where: { id: packageId }, include: { invoicePackage: true } });
      if (!pkg || !this.canEdit(auth, pkg.originWarehouseId)) throw AppException.notFound('PACKAGE_NOT_FOUND', 'Colis introuvable');
      if (pkg.invoicePackage) throw AppException.conflict('ALREADY_INVOICED', 'Ce colis est déjà facturé : les frais ne peuvent plus changer');
      const item = await tx.customsItem.findFirst({ where: { id: input.itemId, active: true } });
      if (!item) throw AppException.notFound('CUSTOMS_ITEM_NOT_FOUND', 'Article introuvable ou retiré de la table');
      let fee: number;
      try {
        fee = customsFee({ kind: item.kind, normalPrice: num(item.normalPrice), vipPrice: num(item.vipPrice), rate: num(item.rate) }, input);
      } catch (error) {
        if (error instanceof CustomsFeeError) throw AppException.unprocessable(error.code, error.message);
        throw error;
      }
      const line = await tx.packageCustomsLine.create({
        data: {
          companyId: auth.companyId,
          packageId,
          itemId: item.id,
          quantity: input.quantity,
          vip: input.vip,
          declaredValue: input.declaredValue !== undefined ? new D(String(input.declaredValue)) : null,
          watts: input.watts !== undefined ? new D(String(input.watts)) : null,
          fee: new D(fee.toFixed(2)),
          currency: CUSTOMS_CURRENCY,
          createdBy: auth.userId,
        },
        include: { item: true },
      });
      await this.audit.record(tx, {
        companyId: auth.companyId,
        action: 'package.customs_line_added',
        entityType: 'package',
        entityId: packageId,
        after: { item: `${item.name} ${item.size}`.trim(), quantity: input.quantity, vip: input.vip, fee: fee.toFixed(2), requiresAuthorization: item.requiresAuthorization },
      });
      return this.lineDto(line);
    });
  }

  async removeLine(auth: AuthContext, packageId: string, lineId: string) {
    await this.db.run({ companyId: auth.companyId }, async (tx) => {
      const pkg = await tx.package.findUnique({ where: { id: packageId }, include: { invoicePackage: true } });
      if (!pkg || !this.canEdit(auth, pkg.originWarehouseId)) throw AppException.notFound('PACKAGE_NOT_FOUND', 'Colis introuvable');
      if (pkg.invoicePackage) throw AppException.conflict('ALREADY_INVOICED', 'Ce colis est déjà facturé : les frais ne peuvent plus changer');
      const line = await tx.packageCustomsLine.findFirst({ where: { id: lineId, packageId } });
      if (!line) throw AppException.notFound('CUSTOMS_LINE_NOT_FOUND', 'Ligne introuvable');
      await tx.packageCustomsLine.delete({ where: { id: lineId } });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'package.customs_line_removed', entityType: 'package', entityId: packageId, before: { fee: line.fee.toFixed(2) } });
    });
  }
}
