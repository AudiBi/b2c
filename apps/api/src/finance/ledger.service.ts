import { Injectable } from '@nestjs/common';
import { Prisma, type Invoice } from '@prisma/client';
import { DEFAULT_MAX_DISCOUNT_PERCENT, type InvoiceStatus } from '@b2c/shared';
import { AppException } from '../common/errors';
import type { Tx } from '../database/db.service';
import { PackagesService } from '../packages/packages.service';

export const D = Prisma.Decimal;
export type Decimal = Prisma.Decimal;

/** Montant arrondi à 2 décimales, 0,5 vers le haut (jamais de flottant). */
export const money = (value: Decimal | number | string): Decimal => new D(String(value)).toDecimalPlaces(2, D.ROUND_HALF_UP);

export interface FinanceSettings {
  maxDiscountPercent: number;
  paymentInstructions: string | null;
}

/**
 * Règles communes aux factures et aux paiements : verrou de la facture, solde, statut dérivé, et effets sur les colis
 * quand la facture est réglée. Toutes les écritures d'argent passent par une facture verrouillée (FOR UPDATE) :
 * deux paiements simultanés se sérialisent et ne peuvent pas dépasser le montant dû (I24, doublé par un déclencheur).
 */
@Injectable()
export class LedgerService {
  constructor(private readonly packages: PackagesService) {}

  async lockInvoice(tx: Tx, invoiceId: string): Promise<Invoice> {
    await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId}::uuid FOR UPDATE`;
    const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw AppException.notFound('INVOICE_NOT_FOUND', 'Facture introuvable');
    return invoice;
  }

  /** Montant réservé par des paiements déclarés mais pas encore confirmés. */
  async pendingTotal(tx: Tx, invoiceId: string): Promise<Decimal> {
    const sum = await tx.payment.aggregate({ where: { invoiceId, status: 'PENDING' }, _sum: { amount: true } });
    return new D(sum._sum.amount ?? 0);
  }

  /** Reste à payer : total − avoirs − encaissé (net des remboursements). */
  balance(invoice: Pick<Invoice, 'total' | 'creditedTotal' | 'paidTotal'>): Decimal {
    return new D(invoice.total).sub(invoice.creditedTotal).sub(invoice.paidTotal);
  }

  deriveStatus(invoice: Pick<Invoice, 'status' | 'total' | 'creditedTotal' | 'paidTotal'>): InvoiceStatus {
    if (invoice.status === 'DRAFT' || invoice.status === 'VOID') return invoice.status;
    const total = new D(invoice.total);
    const credited = new D(invoice.creditedTotal);
    const paid = new D(invoice.paidTotal);
    if (total.gt(0) && credited.eq(total)) return 'CREDITED';
    if (paid.eq(total.sub(credited))) return 'PAID';
    return paid.gt(0) ? 'PARTIALLY_PAID' : 'ISSUED';
  }

  /**
   * Recalcule le statut après un encaissement, un remboursement ou un avoir. Quand la facture devient réglée, les
   * colis qui attendaient le paiement sont autorisés à partir (AWAITING_PAYMENT → READY_TO_SHIP).
   */
  async settle(tx: Tx, companyId: string, actorUserId: string | null, invoiceId: string): Promise<Invoice> {
    const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    const next = this.deriveStatus(invoice);
    if (next === invoice.status) return invoice;
    const updated = await tx.invoice.update({ where: { id: invoiceId }, data: { status: next, version: { increment: 1 } } });
    if (next === 'PAID') await this.releasePackages(tx, companyId, actorUserId, updated);
    return updated;
  }

  async releasePackages(tx: Tx, companyId: string, actorUserId: string | null, invoice: Invoice): Promise<void> {
    const links = await tx.invoicePackage.findMany({ where: { invoiceId: invoice.id }, include: { package: true } });
    for (const link of links) {
      if (link.package.status !== 'AWAITING_PAYMENT') continue;
      await this.packages.transition(tx, companyId, link.packageId, 'READY_TO_SHIP', {
        reason: `Facture ${invoice.number} réglée`,
        actor: { userId: actorUserId, bypassPermission: true },
      });
    }
  }

  async settings(tx: Tx): Promise<FinanceSettings> {
    const row = await tx.companySetting.findFirst({ where: { key: 'finance' } });
    const value = (row?.value ?? {}) as Partial<FinanceSettings>;
    return {
      maxDiscountPercent: typeof value.maxDiscountPercent === 'number' ? value.maxDiscountPercent : DEFAULT_MAX_DISCOUNT_PERCENT,
      paymentInstructions: typeof value.paymentInstructions === 'string' && value.paymentInstructions ? value.paymentInstructions : null,
    };
  }
}
