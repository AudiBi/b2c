import { Injectable, Logger } from '@nestjs/common';
import type { Notification, Prisma } from '@prisma/client';
import {
  EVENT_CODES,
  EVENT_VARIABLES,
  MANDATORY_EVENTS,
  MAX_ATTEMPTS,
  RETRY_DELAYS_MINUTES,
  renderTemplate,
  type EventCode,
  type NotificationChannel,
  type TemplateInput,
} from '@b2c/shared';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors';
import { DbService, type Tx } from '../database/db.service';
import { MailService } from '../mail/mail.service';
import type { AuthContext } from '../security/auth.types';
import { DEFAULT_TEMPLATES } from './default-templates';

type Locale = 'fr' | 'ht' | 'en';
const TEMPLATE_CHANNELS: NotificationChannel[] = ['IN_APP', 'EMAIL'];
const LOCALES: Locale[] = ['fr', 'ht', 'en'];
const FANOUT_ORDER: NotificationChannel[] = ['IN_APP', 'EMAIL', 'SMS', 'WHATSAPP'];
const MAX_ROUNDS = 20;

export interface ProcessResult {
  fannedOut: number;
  sent: number;
  failed: number;
  retried: number;
  skipped: number;
}

export const notificationDto = (n: Notification) => ({
  id: n.id,
  eventCode: n.eventCode,
  channel: n.channel,
  locale: n.locale,
  subject: n.subject,
  body: n.body,
  status: n.status,
  skipReason: n.skipReason,
  attempts: n.attempts,
  lastError: n.lastError,
  nextAttemptAt: n.nextAttemptAt,
  sentAt: n.sentAt,
  readAt: n.readAt,
  createdAt: n.createdAt,
});

/**
 * Notifications : transforme les événements de l'outbox en messages (portail, e-mail), les envoie avec nouvelles
 * tentatives espacées, et tient un journal lisible. Aucun canal n'est simulé : SMS et WhatsApp, faute de prestataire,
 * produisent un statut « ignoré » visible (CHANNEL_NOT_CONFIGURED) et rien d'autre.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('Notifications');

  constructor(
    private readonly db: DbService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // Modèles
  // ---------------------------------------------------------------------------------------------

  private async resolve(tx: Tx, companyId: string, event: EventCode, channel: NotificationChannel, locale: Locale) {
    const custom = await tx.notificationTemplate.findUnique({ where: { companyId_eventCode_channel_locale: { companyId, eventCode: event, channel, locale } } });
    const fallback = DEFAULT_TEMPLATES[event][locale];
    return { custom, fallback };
  }

  async listTemplates(auth: AuthContext) {
    const rows = await this.db.run({ companyId: auth.companyId }, (tx) => tx.notificationTemplate.findMany());
    const key = (e: string, c: string, l: string) => `${e}|${c}|${l}`;
    const custom = new Map(rows.map((r) => [key(r.eventCode, r.channel, r.locale), r]));
    const items = [];
    for (const eventCode of EVENT_CODES) {
      for (const channel of TEMPLATE_CHANNELS) {
        for (const locale of LOCALES) {
          const override = custom.get(key(eventCode, channel, locale));
          const base = DEFAULT_TEMPLATES[eventCode][locale];
          items.push({
            eventCode,
            channel,
            locale,
            variables: EVENT_VARIABLES[eventCode],
            mandatory: MANDATORY_EVENTS.includes(eventCode),
            source: override ? 'COMPANY' : 'DEFAULT',
            active: override ? override.active : true,
            subject: override ? override.subject : base.subject,
            body: override ? override.body : base.body,
          });
        }
      }
    }
    return { items };
  }

  async upsertTemplate(auth: AuthContext, input: TemplateInput) {
    if (input.channel === 'SMS' || input.channel === 'WHATSAPP') {
      throw AppException.unprocessable('CHANNEL_NOT_CONFIGURED', "Ce canal n'est pas configuré : aucun prestataire n'est actif");
    }
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const row = await tx.notificationTemplate.upsert({
        where: { companyId_eventCode_channel_locale: { companyId: auth.companyId, eventCode: input.eventCode, channel: input.channel, locale: input.locale } },
        create: { companyId: auth.companyId, eventCode: input.eventCode, channel: input.channel, locale: input.locale, subject: input.subject, body: input.body, active: input.active, updatedBy: auth.userId },
        update: { subject: input.subject, body: input.body, active: input.active, updatedBy: auth.userId },
      });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'notification_template.saved', entityType: 'notification_template', entityId: row.id, after: { eventCode: row.eventCode, channel: row.channel, locale: row.locale, active: row.active } });
      return { eventCode: row.eventCode, channel: row.channel, locale: row.locale, subject: row.subject, body: row.body, active: row.active, source: 'COMPANY' as const };
    });
  }

  /** Revient au modèle par défaut. */
  async resetTemplate(auth: AuthContext, eventCode: EventCode, channel: NotificationChannel, locale: Locale): Promise<void> {
    await this.db.run({ companyId: auth.companyId }, async (tx) => {
      const deleted = await tx.notificationTemplate.deleteMany({ where: { eventCode, channel, locale } });
      if (deleted.count === 0) throw AppException.notFound('TEMPLATE_NOT_FOUND', 'Aucun modèle personnalisé à supprimer');
      await this.audit.record(tx, { companyId: auth.companyId, action: 'notification_template.reset', entityType: 'notification_template', entityId: auth.companyId, after: { eventCode, channel, locale } });
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Traitement : outbox → notifications → envoi
  // ---------------------------------------------------------------------------------------------

  /**
   * Traite une entreprise : plusieurs tours (50 événements et 20 e-mails au plus chacun) tant qu'il y a du travail, dans la limite
   * de MAX_ROUNDS tours, pour qu'un afflux d'événements ne retarde pas les messages suivants d'un tour par intervalle.
   * `now` est injectable pour tester les nouvelles tentatives sans attendre.
   */
  async processCompany(companyId: string, options: { now?: Date; batch?: number } = {}): Promise<ProcessResult> {
    const total: ProcessResult = { fannedOut: 0, sent: 0, failed: 0, retried: 0, skipped: 0 };
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const result = await this.processRound(companyId, options);
      for (const key of Object.keys(total) as (keyof ProcessResult)[]) total[key] += result[key];
      if (result.fannedOut + result.sent + result.failed + result.retried === 0) break;
    }
    return total;
  }

  private async processRound(companyId: string, options: { now?: Date; batch?: number }): Promise<ProcessResult> {
    const now = options.now ?? new Date();
    const batch = options.batch ?? 50;
    const result: ProcessResult = { fannedOut: 0, sent: 0, failed: 0, retried: 0, skipped: 0 };

    // 1. événements → notifications (une transaction par événement : un événement défaillant n'en bloque pas d'autres)
    const ids = await this.db.run({ companyId }, (tx) =>
      tx.$queryRaw<{ id: string }[]>`SELECT id FROM outbox_events WHERE processed_at IS NULL AND next_attempt_at <= ${now} ORDER BY created_at LIMIT ${batch}`,
    );
    for (const { id } of ids) {
      try {
        await this.db.run({ companyId }, async (tx) => {
          const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM outbox_events WHERE id = ${id}::uuid AND processed_at IS NULL FOR UPDATE SKIP LOCKED`;
          if (locked.length === 0) return;
          const counts = await this.fanOut(tx, companyId, id, now);
          result.fannedOut += 1;
          result.skipped += counts.skipped;
        });
      } catch (error) {
        this.logger.error(`Événement ${id} : ${(error as Error).message}`);
        await this.db.run({ companyId }, async (tx) => {
          const row = await tx.outboxEvent.findUnique({ where: { id } });
          if (!row) return;
          const attempts = row.attempts + 1;
          await tx.outboxEvent.update({
            where: { id },
            data: {
              attempts,
              lastError: String((error as Error).message).slice(0, 300),
              // Après trop d'échecs l'événement est écarté (processed_at) pour ne pas bloquer la file ; l'erreur reste lisible
              ...(attempts >= MAX_ATTEMPTS ? { processedAt: now } : { nextAttemptAt: new Date(now.getTime() + RETRY_DELAYS_MINUTES[Math.min(attempts - 1, RETRY_DELAYS_MINUTES.length - 1)] * 60_000) }),
            },
          });
        });
      }
    }

    // 2. envois d'e-mails
    const due = await this.db.run({ companyId }, (tx) =>
      tx.$queryRaw<{ id: string }[]>`SELECT id FROM notifications WHERE status = 'QUEUED' AND channel = 'EMAIL' AND next_attempt_at <= ${now} ORDER BY next_attempt_at LIMIT ${Math.min(batch, 20)}`,
    );
    for (const { id } of due) {
      await this.db.run({ companyId }, async (tx) => {
        const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM notifications WHERE id = ${id}::uuid AND status = 'QUEUED' AND next_attempt_at <= ${now} FOR UPDATE SKIP LOCKED`;
        if (locked.length === 0) return;
        const outcome = await this.deliverEmail(tx, id, now);
        result[outcome] += 1;
      });
    }
    return result;
  }

  private async fanOut(tx: Tx, companyId: string, eventId: string, now: Date): Promise<{ skipped: number }> {
    const event = await tx.outboxEvent.findUniqueOrThrow({ where: { id: eventId } });
    const code = event.eventCode as EventCode;
    const customer = event.customerId ? await tx.customer.findUnique({ where: { id: event.customerId }, include: { user: true } }) : null;
    if (!customer || !EVENT_CODES.includes(code)) {
      await tx.outboxEvent.update({ where: { id: eventId }, data: { processedAt: now, lastError: !customer ? 'CUSTOMER_NOT_FOUND' : 'UNKNOWN_EVENT' } });
      return { skipped: 0 };
    }
    const locale = (['fr', 'ht', 'en'].includes(customer.user.locale) ? customer.user.locale : 'fr') as Locale;
    const prefs = (customer.notificationPrefs ?? {}) as { email?: boolean; sms?: boolean; whatsapp?: boolean; inApp?: boolean };
    const enabled: Record<NotificationChannel, boolean> = { IN_APP: prefs.inApp !== false, EMAIL: prefs.email !== false, SMS: prefs.sms === true, WHATSAPP: prefs.whatsapp === true };
    const mandatory = MANDATORY_EVENTS.includes(code);
    const values = event.payload as Record<string, string>;
    let skipped = 0;

    const rows: Prisma.NotificationCreateManyInput[] = [];
    for (const channel of FANOUT_ORDER) {
      const base = { companyId, outboxEventId: event.id, customerId: customer.id, userId: customer.userId, eventCode: code, channel, locale, dedupeKey: `${event.id}:${channel}` };
      if (!enabled[channel] && !mandatory) {
        if (channel === 'IN_APP' || channel === 'EMAIL') {
          rows.push({ ...base, body: '', status: 'SKIPPED', skipReason: 'PREFERENCE_OFF' });
          skipped += 1;
        }
        continue;
      }
      const { custom, fallback } = await this.resolve(tx, companyId, code, channel === 'IN_APP' || channel === 'EMAIL' ? channel : 'IN_APP', locale);
      if (channel === 'SMS' || channel === 'WHATSAPP') {
        rows.push({ ...base, body: renderTemplate(fallback.body, values), status: 'SKIPPED', skipReason: 'CHANNEL_NOT_CONFIGURED' });
        skipped += 1;
        continue;
      }
      if (custom && !custom.active && !mandatory) {
        rows.push({ ...base, body: '', status: 'SKIPPED', skipReason: 'TEMPLATE_DISABLED' });
        skipped += 1;
        continue;
      }
      const useCustom = custom && custom.active;
      const subject = renderTemplate(useCustom ? (custom.subject ?? fallback.subject) : fallback.subject, values, { singleLine: true });
      const body = renderTemplate(useCustom ? custom.body : fallback.body, values);
      rows.push(
        channel === 'IN_APP'
          ? { ...base, subject, body, status: 'SENT', sentAt: now }
          : { ...base, subject, body, status: 'QUEUED', nextAttemptAt: now },
      );
    }
    // Idempotence : rejouer un événement (ou deux traitements simultanés) ne crée aucune notification en double
    await tx.notification.createMany({ data: rows, skipDuplicates: true });
    await tx.outboxEvent.update({ where: { id: eventId }, data: { processedAt: now } });
    return { skipped };
  }

  private async deliverEmail(tx: Tx, id: string, now: Date): Promise<'sent' | 'failed' | 'retried'> {
    const n = await tx.notification.findUniqueOrThrow({ where: { id } });
    const user = await tx.user.findUnique({ where: { id: n.userId } });
    try {
      if (!user) throw new Error('DESTINATAIRE_INTROUVABLE');
      await this.mail.send({ to: user.email, subject: n.subject ?? '', text: n.body });
      await tx.notification.update({ where: { id }, data: { status: 'SENT', sentAt: now, attempts: n.attempts + 1, lastError: null, nextAttemptAt: null } });
      return 'sent';
    } catch (error) {
      const attempts = n.attempts + 1;
      const message = String((error as Error).message ?? error).slice(0, 300);
      if (attempts >= MAX_ATTEMPTS) {
        await tx.notification.update({ where: { id }, data: { status: 'FAILED', attempts, lastError: message, nextAttemptAt: null } });
        this.logger.error(`Notification ${id} : échec définitif après ${attempts} tentatives (${message})`);
        return 'failed';
      }
      const delay = RETRY_DELAYS_MINUTES[attempts - 1];
      await tx.notification.update({ where: { id }, data: { attempts, lastError: message, nextAttemptAt: new Date(now.getTime() + delay * 60_000) } });
      return 'retried';
    }
  }

  /** Entreprises qui ont du travail (fonction SQL qui ne révèle que des identifiants). */
  async companiesWithWork(): Promise<string[]> {
    const rows = await this.db.run({ companyId: '00000000-0000-7000-8000-000000000001' }, (tx) => tx.$queryRaw<{ id: string }[]>`SELECT app_notification_work_companies() AS id`);
    return rows.map((r) => r.id);
  }

  // ---------------------------------------------------------------------------------------------
  // Lecture
  // ---------------------------------------------------------------------------------------------

  async listForStaff(auth: AuthContext, query: { limit: number; cursor?: string; status?: Notification['status']; channel?: NotificationChannel; eventCode?: EventCode }) {
    const rows = await this.db.run({ companyId: auth.companyId }, (tx) =>
      tx.notification.findMany({
        where: { status: query.status, channel: query.channel, eventCode: query.eventCode, ...(query.cursor ? { id: { lt: query.cursor } } : {}) },
        include: { customer: { select: { customerCode: true } } },
        orderBy: { id: 'desc' },
        take: query.limit + 1,
      }),
    );
    const items = rows.slice(0, query.limit);
    return { items: items.map((n) => ({ ...notificationDto(n), customerCode: n.customer.customerCode })), nextCursor: rows.length > query.limit ? items[items.length - 1].id : null };
  }

  async retry(auth: AuthContext, id: string) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const row = await tx.notification.findUnique({ where: { id } });
      if (!row) throw AppException.notFound('NOTIFICATION_NOT_FOUND', 'Notification introuvable');
      if (row.status !== 'FAILED') throw AppException.conflict('NOT_FAILED', "Seule une notification en échec peut être relancée");
      const updated = await tx.notification.update({ where: { id }, data: { status: 'QUEUED', attempts: 0, lastError: null, nextAttemptAt: new Date() } });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'notification.retried', entityType: 'notification', entityId: id });
      return notificationDto(updated);
    });
  }

  private async customerOf(tx: Tx, auth: AuthContext) {
    if (auth.kind !== 'CUSTOMER') throw AppException.forbidden('CUSTOMER_ONLY', 'Réservé aux comptes clients');
    const customer = await tx.customer.findUnique({ where: { userId: auth.userId } });
    return customer;
  }

  async listMine(auth: AuthContext, query: { limit: number; cursor?: string; unread?: 'true' | 'false' }) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const customer = await this.customerOf(tx, auth);
      if (!customer) return { items: [], unread: 0, nextCursor: null };
      const base = { customerId: customer.id, channel: 'IN_APP' as const, status: 'SENT' as const };
      const [rows, unread] = await Promise.all([
        tx.notification.findMany({
          where: { ...base, ...(query.unread === 'true' ? { readAt: null } : {}), ...(query.cursor ? { id: { lt: query.cursor } } : {}) },
          orderBy: { id: 'desc' },
          take: query.limit + 1,
        }),
        tx.notification.count({ where: { ...base, readAt: null } }),
      ]);
      const items = rows.slice(0, query.limit);
      return {
        items: items.map((n) => ({ id: n.id, eventCode: n.eventCode, subject: n.subject, body: n.body, createdAt: n.createdAt, readAt: n.readAt })),
        unread,
        nextCursor: rows.length > query.limit ? items[items.length - 1].id : null,
      };
    });
  }

  async markRead(auth: AuthContext, id: string | null): Promise<{ updated: number }> {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const customer = await this.customerOf(tx, auth);
      if (!customer) return { updated: 0 };
      if (id) {
        const own = await tx.notification.findFirst({ where: { id, customerId: customer.id, channel: 'IN_APP' } });
        if (!own) throw AppException.notFound('NOTIFICATION_NOT_FOUND', 'Notification introuvable');
      }
      const res = await tx.notification.updateMany({ where: { customerId: customer.id, channel: 'IN_APP', readAt: null, ...(id ? { id } : {}) }, data: { readAt: new Date() } });
      return { updated: res.count };
    });
  }
}
