import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AppException } from '../common/errors';
import type { Tx } from '../database/db.service';

export interface IdempotencyParams {
  companyId: string;
  /** Opération concernée, par exemple « payments.create ». */
  scope: string;
  /** Clé fournie par le client (en-tête Idempotency-Key). */
  key: string;
  /** Condensé de la requête : une même clé avec un contenu différent est refusée. */
  requestHash: string;
}

/**
 * Exécution exactement-une-fois d'une opération (paiements, numérotation). La clé est enregistrée DANS la
 * transaction de l'opération : si elle échoue, rien n'est enregistré et le client peut réessayer ; si deux
 * requêtes arrivent ensemble, la seconde attend la première puis rejoue sa réponse.
 */
@Injectable()
export class IdempotencyService {
  async run<T extends Prisma.InputJsonValue>(
    tx: Tx,
    params: IdempotencyParams,
    operation: () => Promise<T>,
  ): Promise<{ result: T; replayed: boolean }> {
    const inserted = await tx.$queryRaw<{ key: string }[]>`
      INSERT INTO idempotency_keys (company_id, scope, key, request_hash, status)
      VALUES (${params.companyId}::uuid, ${params.scope}, ${params.key}, ${params.requestHash}, 'COMPLETED')
      ON CONFLICT DO NOTHING
      RETURNING key`;

    if (inserted.length === 0) {
      const existing = await tx.idempotencyKey.findUnique({
        where: { companyId_scope_key: { companyId: params.companyId, scope: params.scope, key: params.key } },
      });
      if (!existing) throw new Error('Clé d\'idempotence introuvable après conflit');
      if (existing.requestHash !== params.requestHash) {
        throw AppException.unprocessable(
          'IDEMPOTENCY_KEY_REUSED',
          'Cette clé d\'idempotence a déjà servi pour une requête différente',
        );
      }
      return { result: existing.response as T, replayed: true };
    }

    const result = await operation();
    await tx.idempotencyKey.update({
      where: { companyId_scope_key: { companyId: params.companyId, scope: params.scope, key: params.key } },
      data: { response: result },
    });
    return { result, replayed: false };
  }
}
