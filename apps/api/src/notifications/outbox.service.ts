import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { EventCode } from '@b2c/shared';
import type { Tx } from '../database/db.service';

export interface OutboxInput {
  companyId: string;
  eventCode: EventCode;
  aggregateType: 'package' | 'invoice' | 'payment' | 'prealert' | 'claim';
  aggregateId: string;
  customerId: string | null | undefined;
  /** Valeurs des variables du modèle : jamais de secret ni de donnée inutile (ce JSON est conservé). */
  payload: Record<string, string>;
}

/**
 * Écrit l'événement métier DANS la transaction de l'action : si l'action est annulée, l'événement l'est aussi ;
 * si elle est validée, l'événement existe et sera traité même si le serveur s'arrête juste après (outbox).
 */
@Injectable()
export class OutboxService {
  async emit(tx: Tx, input: OutboxInput): Promise<void> {
    if (!input.customerId) return; // pas de destinataire (colis non identifié)
    await tx.outboxEvent.create({
      data: {
        companyId: input.companyId,
        eventCode: input.eventCode,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        customerId: input.customerId,
        payload: input.payload as Prisma.InputJsonValue,
      },
    });
  }
}

/** Nom d'affichage du client (raison sociale pour un compte professionnel). */
export const displayName = (customer: { customerType: string; user: { firstName: string; lastName: string; businessName: string | null } }): string =>
  customer.customerType === 'BUSINESS' && customer.user.businessName ? customer.user.businessName : `${customer.user.firstName} ${customer.user.lastName}`;
