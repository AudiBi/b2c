import { Injectable } from '@nestjs/common';
import type { ActorType, Prisma } from '@prisma/client';
import { currentRequest } from '../common/request-context';
import type { Tx } from '../database/db.service';

export interface AuditEntry {
  companyId: string;
  action: string;
  entityType?: string;
  entityId?: string;
  actorUserId?: string;
  actorType?: ActorType;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

const SENSITIVE_KEY = /pass(word)?|token|secret|hash|authorization|cookie|totp|otp/i;

/** Retire toute clé qui pourrait contenir un secret avant écriture dans le journal. */
export function redact(value: Record<string, unknown> | undefined): Prisma.InputJsonValue | undefined {
  if (!value) return undefined;
  const clean = (input: unknown): Prisma.InputJsonValue => {
    if (Array.isArray(input)) return input.map(clean);
    if (input && typeof input === 'object') {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>).map(([key, val]) => [
          key,
          SENSITIVE_KEY.test(key) ? '[masqué]' : clean(val),
        ]),
      );
    }
    return (input ?? null) as Prisma.InputJsonValue;
  };
  return clean(value) as Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  /**
   * Écrit une ligne d'audit DANS la transaction de l'action : si l'action est annulée, la ligne aussi ;
   * si l'action est validée, la ligne l'est forcément.
   */
  async record(tx: Tx, entry: AuditEntry): Promise<void> {
    const request = currentRequest();
    const actorUserId = entry.actorUserId ?? request?.actorUserId;
    await tx.auditLog.create({
      data: {
        companyId: entry.companyId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        actorUserId,
        actorType: entry.actorType ?? (actorUserId ? 'USER' : 'ANONYMOUS'),
        before: redact(entry.before),
        after: redact(entry.after),
        ip: request?.ip,
        requestId: request?.requestId,
      },
    });
  }
}
