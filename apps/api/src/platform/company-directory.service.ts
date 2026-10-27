import { Injectable } from '@nestjs/common';
import { AppException } from '../common/errors';
import type { CompanyStatus } from '@prisma/client';
import { PLATFORM_COMPANY_ID } from '@b2c/shared';
import { DbService } from '../database/db.service';

export interface CompanyRef {
  id: string;
  slug: string;
  name: string;
  status: CompanyStatus;
}

/**
 * Résolution d'une entreprise à partir de son identifiant public (slug) pour les routes non authentifiées
 * (inscription, connexion). C'est, avec PlatformService, le seul code qui ouvre une transaction en mode plateforme.
 */
@Injectable()
export class CompanyDirectory {
  constructor(private readonly db: DbService) {}

  findBySlug(slug: string): Promise<CompanyRef | null> {
    return this.db.run({ companyId: PLATFORM_COMPANY_ID, platform: true }, (tx) =>
      tx.company.findUnique({ where: { slug }, select: { id: true, slug: true, name: true, status: true } }),
    );
  }

  /** Entreprise visible publiquement (pas la plateforme, pas une entreprise suspendue) ; sinon 404. */
  async requirePublic(slug: string): Promise<CompanyRef> {
    const company = await this.findBySlug(slug);
    if (!company || company.id === PLATFORM_COMPANY_ID || company.status !== 'ACTIVE') {
      throw AppException.notFound('COMPANY_NOT_FOUND', 'Entreprise introuvable');
    }
    return company;
  }
}
