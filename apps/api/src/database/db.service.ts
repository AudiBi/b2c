import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

export type Tx = Prisma.TransactionClient;

export interface DbContext {
  /** Entreprise dont les lignes sont visibles (posée par SET LOCAL pour la RLS). */
  companyId: string;
  /**
   * Mode plateforme : autorise la lecture/écriture de la table `companies` pour toutes les entreprises.
   * Réservé à PlatformService et CompanyDirectory (un test vérifie qu'aucun autre fichier ne l'utilise).
   */
  platform?: boolean;
}

const platformTransactions = new WeakSet<object>();

/**
 * Seul point d'accès aux données métier. Toute requête s'exécute dans une transaction dont le
 * contexte d'entreprise est posé AVANT la première requête : en dehors de `run`, aucune ligne
 * d'une table protégée n'est visible (la RLS échoue « fermé »).
 */
@Injectable()
export class DbService {
  constructor(private readonly prisma: PrismaService) {}

  run<T>(ctx: DbContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.company_id', ${ctx.companyId}, true), set_config('app.platform', ${ctx.platform ? 'on' : 'off'}, true)`;
        if (ctx.platform) platformTransactions.add(tx);
        return fn(tx);
      },
      { maxWait: 5_000, timeout: 20_000 },
    );
  }

  /**
   * Dans une transaction ouverte en mode plateforme, exécute `fn` dans le contexte d'une autre entreprise
   * (par exemple pour écrire l'audit dans l'entreprise créée), puis rétablit le contexte initial.
   */
  async withCompany<T>(tx: Tx, original: string, target: string, fn: () => Promise<T>): Promise<T> {
    if (!platformTransactions.has(tx)) throw new Error('withCompany exige une transaction en mode plateforme');
    await tx.$queryRaw`SELECT set_config('app.company_id', ${target}, true)`;
    try {
      return await fn();
    } finally {
      await tx.$queryRaw`SELECT set_config('app.company_id', ${original}, true)`;
    }
  }

  /** Sonde de disponibilité : requête sans table protégée. */
  async ping(): Promise<void> {
    await this.prisma.$queryRaw`SELECT 1`;
  }
}
