import { memberAccount } from '../customers/account';
import { Injectable } from '@nestjs/common';
import type { Claim, ClaimMessage, Prisma } from '@prisma/client';
import type { ClaimStatus } from '@b2c/shared';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors';
import { DbService, type Tx } from '../database/db.service';
import { CounterService } from '../infra/counter.service';
import { displayName, OutboxService } from '../notifications/outbox.service';
import type { AuthContext } from '../security/auth.types';

const claimNumber = (year: number, sequence: number) => `CLM-${year}-${String(sequence).padStart(6, '0')}`;

const staffInclude = {
  customer: { include: { user: { select: { firstName: true, lastName: true, businessName: true } } } },
  package: { select: { id: true, trackingNumber: true } },
  assignee: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.ClaimInclude;
type ClaimFull = Claim & Prisma.ClaimGetPayload<{ include: typeof staffInclude }>;

const messageDto = (m: ClaimMessage, staffView: boolean) => ({
  id: m.id,
  author: m.authorKind,
  body: m.body,
  createdAt: m.createdAt,
  ...(staffView ? { internal: m.internal } : {}),
});

const claimDto = (c: ClaimFull, staffView: boolean) => ({
  id: c.id,
  number: c.number,
  category: c.category,
  subject: c.subject,
  status: c.status,
  resolution: c.resolution,
  package: c.package ? { id: c.package.id, trackingNumber: c.package.trackingNumber } : null,
  openedAt: c.openedAt,
  resolvedAt: c.resolvedAt,
  updatedAt: c.updatedAt,
  ...(staffView ? { customer: { id: c.customer.id, customerCode: c.customer.customerCode, name: displayName(c.customer) }, assignedTo: c.assignee ? { id: c.assignee.id, name: `${c.assignee.firstName} ${c.assignee.lastName}` } : null } : {}),
});

/** Réclamations : ouverture par le client, traitement par le service client, échanges de messages. */
@Injectable()
export class ClaimsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly counters: CounterService,
    private readonly outbox: OutboxService,
  ) {}

  private async customerOf(tx: Tx, auth: AuthContext) {
    if (auth.kind !== 'CUSTOMER') throw AppException.forbidden('CUSTOMER_ONLY', 'Réservé aux comptes clients');
    // Un membre d'équipe voit et ouvre les réclamations du compte de son propriétaire (selon son rôle)
    return (await memberAccount(tx, auth.userId)) ?? tx.customer.findUnique({ where: { userId: auth.userId } });
  }

  /** Prévient le client qu'il y a du nouveau (réponse visible, changement d'état). */
  private async notify(tx: Tx, auth: AuthContext, claim: ClaimFull): Promise<void> {
    await this.outbox.emit(tx, {
      companyId: auth.companyId,
      eventCode: 'claim.updated',
      aggregateType: 'claim',
      aggregateId: claim.id,
      customerId: claim.customerId,
      payload: { customerName: displayName(claim.customer), claimNumber: claim.number },
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Client
  // ---------------------------------------------------------------------------------------------

  async create(auth: AuthContext, input: { category: Claim['category']; subject: string; message: string; packageId?: string }) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const customer = await this.customerOf(tx, auth);
      if (!customer) throw AppException.notFound('CUSTOMER_NOT_FOUND', 'Client introuvable');
      if (input.packageId) {
        // Seul un colis du client peut être invoqué : celui d'un autre est indistinguable d'un colis inexistant
        const pkg = await tx.package.findFirst({ where: { id: input.packageId, customerId: customer.id }, select: { id: true } });
        if (!pkg) throw AppException.notFound('PACKAGE_NOT_FOUND', 'Colis introuvable');
      }
      const year = new Date().getUTCFullYear();
      const number = claimNumber(year, await this.counters.next(tx, auth.companyId, 'claim', year));
      const claim = await tx.claim.create({
        data: { companyId: auth.companyId, number, customerId: customer.id, packageId: input.packageId, category: input.category, subject: input.subject },
        include: staffInclude,
      });
      await tx.claimMessage.create({ data: { companyId: auth.companyId, claimId: claim.id, authorKind: 'CUSTOMER', authorUserId: auth.userId, body: input.message } });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'claim.opened', entityType: 'claim', entityId: claim.id, after: { number, category: input.category, packageId: input.packageId ?? null } });
      return claimDto(claim, false);
    });
  }

  async listMine(auth: AuthContext, query: { limit: number; cursor?: string }) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const customer = await this.customerOf(tx, auth);
      if (!customer) return { items: [], nextCursor: null };
      const rows = await tx.claim.findMany({
        where: { customerId: customer.id, ...(query.cursor ? { id: { lt: query.cursor } } : {}) },
        include: staffInclude,
        orderBy: { id: 'desc' },
        take: query.limit + 1,
      });
      const items = rows.slice(0, query.limit);
      return { items: items.map((c) => claimDto(c, false)), nextCursor: rows.length > query.limit ? items[items.length - 1].id : null };
    });
  }

  async getMine(auth: AuthContext, id: string) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const customer = await this.customerOf(tx, auth);
      const claim = customer ? await tx.claim.findFirst({ where: { id, customerId: customer.id }, include: staffInclude }) : null;
      if (!claim) throw AppException.notFound('CLAIM_NOT_FOUND', 'Réclamation introuvable');
      const messages = await tx.claimMessage.findMany({ where: { claimId: id, internal: false }, orderBy: { createdAt: 'asc' } });
      return { ...claimDto(claim, false), messages: messages.map((m) => messageDto(m, false)) };
    });
  }

  async replyAsCustomer(auth: AuthContext, id: string, body: string) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const customer = await this.customerOf(tx, auth);
      const claim = customer ? await tx.claim.findFirst({ where: { id, customerId: customer.id } }) : null;
      if (!claim) throw AppException.notFound('CLAIM_NOT_FOUND', 'Réclamation introuvable');
      if (claim.status === 'RESOLVED' || claim.status === 'REJECTED') throw AppException.conflict('CLAIM_CLOSED', 'Cette réclamation est clôturée : ouvrez-en une nouvelle si besoin');
      const message = await tx.claimMessage.create({ data: { companyId: auth.companyId, claimId: id, authorKind: 'CUSTOMER', authorUserId: auth.userId, body } });
      await tx.claim.update({ where: { id }, data: { updatedAt: new Date() } });
      return messageDto(message, false);
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Personnel
  // ---------------------------------------------------------------------------------------------

  async list(auth: AuthContext, query: { limit: number; cursor?: string; status?: ClaimStatus; category?: Claim['category']; assignedTo?: string; q?: string }) {
    const rows = await this.db.run({ companyId: auth.companyId }, (tx) =>
      tx.claim.findMany({
        where: {
          status: query.status,
          category: query.category,
          assignedTo: query.assignedTo,
          ...(query.q ? { OR: [{ number: { contains: query.q.toUpperCase() } }, { customer: { customerCode: { contains: query.q.toUpperCase() } } }, { subject: { contains: query.q, mode: 'insensitive' } }] } : {}),
          ...(query.cursor ? { id: { lt: query.cursor } } : {}),
        },
        include: staffInclude,
        orderBy: { id: 'desc' },
        take: query.limit + 1,
      }),
    );
    const items = rows.slice(0, query.limit);
    return { items: items.map((c) => claimDto(c, true)), nextCursor: rows.length > query.limit ? items[items.length - 1].id : null };
  }

  async get(auth: AuthContext, id: string) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const claim = await tx.claim.findUnique({ where: { id }, include: staffInclude });
      if (!claim) throw AppException.notFound('CLAIM_NOT_FOUND', 'Réclamation introuvable');
      const messages = await tx.claimMessage.findMany({ where: { claimId: id }, orderBy: { createdAt: 'asc' } });
      return { ...claimDto(claim, true), messages: messages.map((m) => messageDto(m, true)) };
    });
  }

  /** Membres actifs du personnel que l'on peut charger d'une réclamation. */
  async assignees(auth: AuthContext) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const rows = await tx.user.findMany({ where: { kind: 'STAFF', status: 'ACTIVE' }, select: { id: true, firstName: true, lastName: true }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] });
      return { items: rows.map((u) => ({ id: u.id, name: `${u.firstName} ${u.lastName}` })) };
    });
  }

  async assign(auth: AuthContext, id: string, userId: string | null) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const claim = await this.lock(tx, id);
      if (userId) {
        const user = await tx.user.findFirst({ where: { id: userId, kind: 'STAFF', status: 'ACTIVE' }, select: { id: true } });
        if (!user) throw AppException.unprocessable('ASSIGNEE_INVALID', 'Le responsable doit être un membre actif du personnel');
      }
      const updated = await tx.claim.update({
        where: { id },
        data: { assignedTo: userId, ...(claim.status === 'OPEN' && userId ? { status: 'IN_PROGRESS' } : {}) },
        include: staffInclude,
      });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'claim.assigned', entityType: 'claim', entityId: id, before: { assignedTo: claim.assignedTo }, after: { assignedTo: userId } });
      return claimDto(updated, true);
    });
  }

  private async lock(tx: Tx, id: string): Promise<Claim> {
    await tx.$queryRaw`SELECT id FROM claims WHERE id = ${id}::uuid FOR UPDATE`;
    const claim = await tx.claim.findUnique({ where: { id } });
    if (!claim) throw AppException.notFound('CLAIM_NOT_FOUND', 'Réclamation introuvable');
    return claim;
  }

  async reply(auth: AuthContext, id: string, input: { body: string; internal?: boolean }) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const claim = await this.lock(tx, id);
      const internal = input.internal === true;
      const message = await tx.claimMessage.create({ data: { companyId: auth.companyId, claimId: id, authorKind: 'STAFF', authorUserId: auth.userId, body: input.body, internal } });
      const updated = await tx.claim.update({
        where: { id },
        data: { ...(claim.status === 'OPEN' && !internal ? { status: 'IN_PROGRESS' } : {}) },
        include: staffInclude,
      });
      await this.audit.record(tx, { companyId: auth.companyId, action: internal ? 'claim.note_added' : 'claim.replied', entityType: 'claim', entityId: id });
      // Une note interne ne prévient jamais le client
      if (!internal) await this.notify(tx, auth, updated);
      return messageDto(message, true);
    });
  }

  async setStatus(auth: AuthContext, id: string, input: { status: ClaimStatus; resolution?: string }) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const claim = await this.lock(tx, id);
      if (claim.status === input.status) throw AppException.conflict('CLAIM_STATUS_UNCHANGED', 'La réclamation est déjà dans cet état');
      const closing = input.status === 'RESOLVED' || input.status === 'REJECTED';
      const updated = await tx.claim.update({
        where: { id },
        data: { status: input.status, resolution: closing ? input.resolution : null, resolvedAt: closing ? new Date() : null },
        include: staffInclude,
      });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'claim.status_changed', entityType: 'claim', entityId: id, before: { status: claim.status }, after: { status: input.status } });
      await this.notify(tx, auth, updated);
      return claimDto(updated, true);
    });
  }
}
