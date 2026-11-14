import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ConvertProformaInput, CreateProformaInput } from '@b2c/shared';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors';
import { DbService } from '../database/db.service';
import { CounterService } from '../infra/counter.service';
import { PackagesService } from '../packages/packages.service';
import { PricingService } from '../pricing/pricing.service';
import type { AuthContext } from '../security/auth.types';

const D = Prisma.Decimal;
const day = (d: Date) => d.toISOString().slice(0, 10);

interface StoredResult {
  card: { id: string; name: string; version: number };
  result: { currency: string; total: string; lines: { code: string; kind: string; label: Record<string, string> | null; amount: string }[] };
}

/** Proforma du personnel : estimation chiffrée pour un client, figée, valable N jours, convertible en colis de comptoir. */
@Injectable()
export class ProformaService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly counters: CounterService,
    private readonly pricing: PricingService,
    private readonly packages: PackagesService,
  ) {}

  private dto(p: { id: string; number: string; customerId: string; currency: string; total: Prisma.Decimal; validUntil: Date; note: string | null; convertedPackageId: string | null; createdAt: Date; input: Prisma.JsonValue; result: Prisma.JsonValue }) {
    const stored = p.result as unknown as StoredResult;
    return {
      id: p.id,
      number: p.number,
      customerId: p.customerId,
      currency: p.currency,
      total: p.total.toFixed(2),
      validUntil: day(p.validUntil),
      expired: p.validUntil < new Date(day(new Date())),
      note: p.note,
      convertedPackageId: p.convertedPackageId,
      createdAt: p.createdAt,
      card: stored.card,
      lines: stored.result.lines,
      input: p.input,
    };
  }

  async create(auth: AuthContext, input: CreateProformaInput) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const customer = await tx.customer.findUnique({ where: { id: input.customerId }, select: { id: true } });
      if (!customer) throw AppException.notFound('CUSTOMER_NOT_FOUND', 'Client introuvable');
      // Le calcul vient de la grille active : sans tarif, erreur TARIFF_UNAVAILABLE, jamais de prix inventé
      let response;
      try {
        response = await this.pricing.quote(tx, input.quote);
      } catch (error) {
        throw error;
      }
      const now = new Date();
      const validUntil = new Date(`${day(new Date(now.getTime() + input.validDays * 86_400_000))}T00:00:00Z`);
      const year = now.getUTCFullYear();
      const sequence = await this.counters.next(tx, auth.companyId, 'proforma', year);
      const row = await tx.proforma.create({
        data: {
          companyId: auth.companyId,
          number: `PF-${year}-${String(sequence).padStart(6, '0')}`,
          customerId: input.customerId,
          rateCardId: response.card.id,
          input: input.quote as unknown as Prisma.InputJsonValue,
          result: { card: response.card, result: response.result } as unknown as Prisma.InputJsonValue,
          currency: response.result.currency,
          total: new D(response.result.total),
          validUntil,
          note: input.note,
          createdBy: auth.userId,
        },
      });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'proforma.created', entityType: 'proforma', entityId: row.id, after: { number: row.number, total: row.total.toFixed(2), currency: row.currency } });
      return this.dto(row);
    });
  }

  async list(auth: AuthContext, query: { customerId?: string; limit: number }) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const rows = await tx.proforma.findMany({ where: query.customerId ? { customerId: query.customerId } : {}, orderBy: { createdAt: 'desc' }, take: query.limit });
      return { items: rows.map((r) => this.dto(r)) };
    });
  }

  async get(auth: AuthContext, id: string) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const row = await tx.proforma.findUnique({ where: { id }, include: { customer: { include: { user: true } } } });
      if (!row) throw AppException.notFound('PROFORMA_NOT_FOUND', 'Proforma introuvable');
      const company = await tx.company.findUniqueOrThrow({ where: { id: auth.companyId }, select: { name: true } });
      return {
        ...this.dto(row),
        company: company.name,
        customer: { customerCode: row.customer.customerCode, name: row.customer.user.businessName || `${row.customer.user.firstName} ${row.customer.user.lastName}` },
      };
    });
  }

  /** Transforme la proforma en colis de comptoir (reçu en entrepôt) ; une proforma périmée ou déjà transformée est refusée. */
  async convert(auth: AuthContext, id: string, input: ConvertProformaInput) {
    const proforma = await this.db.run({ companyId: auth.companyId }, (tx) => tx.proforma.findUnique({ where: { id } }));
    if (!proforma) throw AppException.notFound('PROFORMA_NOT_FOUND', 'Proforma introuvable');
    if (proforma.convertedPackageId) throw AppException.conflict('PROFORMA_ALREADY_CONVERTED', 'Cette proforma a déjà été transformée en colis');
    if (proforma.validUntil < new Date(day(new Date()))) throw AppException.conflict('PROFORMA_EXPIRED', 'Cette proforma n’est plus valable : refaites-la au tarif en vigueur');
    const quote = proforma.input as unknown as { transportMode: 'AIR' | 'SEA'; destinationCountry: string };
    const created = await this.packages.createAtCounter(auth, {
      warehouseId: input.warehouseId,
      customerId: proforma.customerId,
      transportMode: quote.transportMode,
      destinationCountry: quote.destinationCountry,
      recipientName: input.recipientName,
      recipientPhone: input.recipientPhone,
      recipientCity: input.recipientCity,
      destinationAgencyId: input.destinationAgencyId,
      contentDescription: input.contentDescription,
      notes: undefined,
    });
    await this.db.run({ companyId: auth.companyId }, async (tx) => {
      await tx.proforma.update({ where: { id }, data: { convertedPackageId: created.id } });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'proforma.converted', entityType: 'proforma', entityId: id, after: { packageId: created.id } });
    });
    return created;
  }
}
