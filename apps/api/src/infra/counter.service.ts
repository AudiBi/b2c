import { Injectable } from '@nestjs/common';
import type { Tx } from '../database/db.service';

/**
 * Compteurs sans trou et sans doublon (numéros de facture, reçus, codes clients).
 * L'incrément est un UPSERT atomique : deux transactions concurrentes se sérialisent sur la ligne ;
 * si la transaction appelante est annulée, le numéro n'est pas consommé (pas de trou).
 */
@Injectable()
export class CounterService {
  /** @param year 0 pour un compteur qui ne repart pas à zéro chaque année. */
  async next(tx: Tx, companyId: string, name: string, year = 0): Promise<number> {
    const rows = await tx.$queryRaw<{ value: number }[]>`
      INSERT INTO counters (company_id, name, year, value)
      VALUES (${companyId}::uuid, ${name}, ${year}, 1)
      ON CONFLICT (company_id, name, year) DO UPDATE SET value = counters.value + 1
      RETURNING value`;
    return rows[0].value;
  }
}
