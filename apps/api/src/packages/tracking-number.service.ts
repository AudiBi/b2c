import { Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { generateTrackingNumber } from '@b2c/shared';
import type { Tx } from '../database/db.service';

const FALLBACK_PREFIX = 'TK';

/**
 * Émet des numéros de suivi uniques dans TOUTE la plateforme (suivi public sans connaître l'entreprise).
 * La contrainte UNIQUE de la base est la garantie ; la vérification préalable (fonction SQL qui voit toutes les
 * entreprises sans les exposer) évite d'aller jusqu'à la violation. Avec 50 bits aléatoires, une collision
 * est pratiquement impossible : si elle survenait malgré tout, la contrainte ferait échouer la transaction.
 */
@Injectable()
export class TrackingNumberService {
  async issue(tx: Tx, prefix: string | null | undefined): Promise<string> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = generateTrackingNumber(prefix || FALLBACK_PREFIX, randomInt);
      const taken = await tx.$queryRaw<{ company: string | null }[]>`SELECT app_package_company(${candidate}) AS company`;
      if (!taken[0]?.company) return candidate;
    }
    throw new Error("Impossible d'émettre un numéro de suivi unique");
  }
}
