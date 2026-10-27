import { Controller, Get, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createWarehouseSchema, idParamSchema, updateWarehouseSchema } from '@b2c/shared';
import type { Warehouse } from '@prisma/client';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AppException, isUniqueViolation } from '../common/errors';
import { Validate, VBody, VParams } from '../common/validation';
import { DbService } from '../database/db.service';
import type { AuthContext } from '../security/auth.types';
import { CurrentAuth, RequirePermission } from '../security/decorators';

export function toWarehouseDto(row: Warehouse) {
  return {
    id: row.id,
    reference: row.reference,
    name: row.name,
    country: row.country,
    city: row.city,
    addressLine: row.addressLine,
    publicVisible: row.publicVisible,
    addressTemplate: row.addressTemplate as string[],
    version: row.version,
    timezone: row.timezone,
    status: row.status,
  };
}

/** Entrepôts de réception. Le module complet (emplacements, mouvements, scans) arrive en phase 6. */
@ApiTags('Administration : entrepôts')
@ApiBearerAuth()
@Controller('admin/warehouses')
export class WarehousesController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission('warehouse:read')
  @ApiOperation({ summary: 'Liste des entrepôts' })
  async list(@CurrentAuth() auth: AuthContext) {
    // Droit sur toute l'entreprise : tous les entrepôts ; droit limité à des entrepôts : ceux-là seulement
    const restrictTo = auth.permissions.can('warehouse:read') ? undefined : auth.permissions.scopeIds('warehouse:read', 'WAREHOUSE');
    const rows = await this.db.run({ companyId: auth.companyId }, (tx) =>
      tx.warehouse.findMany({
        where: restrictTo ? { id: { in: restrictTo } } : undefined,
        orderBy: [{ country: 'asc' }, { city: 'asc' }, { reference: 'asc' }],
      }),
    );
    return { items: rows.map(toWarehouseDto) };
  }

  @Post()
  @RequirePermission('warehouse:manage')
  @Validate({ body: createWarehouseSchema })
  @ApiOperation({
    summary: 'Crée un entrepôt',
    description: 'Le modèle d\'adresse accepte {customerName}, {customerCode} et {mode} ; {customerCode} est obligatoire.',
  })
  async create(@CurrentAuth() auth: AuthContext, @VBody() body: z.infer<typeof createWarehouseSchema>) {
    // Créer un entrepôt engage toute l'entreprise : un droit limité à un entrepôt ne suffit pas
    if (!auth.permissions.can('warehouse:manage')) {
      throw AppException.forbidden('FORBIDDEN', 'Permission insuffisante');
    }
    try {
      return await this.db.run({ companyId: auth.companyId }, async (tx) => {
        const row = await tx.warehouse.create({ data: { ...body, companyId: auth.companyId } });
        await this.audit.record(tx, {
          companyId: auth.companyId,
          action: 'warehouse.created',
          entityType: 'warehouse',
          entityId: row.id,
          after: { reference: row.reference, country: row.country, city: row.city },
        });
        return toWarehouseDto(row);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw AppException.conflict('WAREHOUSE_REFERENCE_USED', 'Cette référence existe déjà');
      throw error;
    }
  }

  @Patch(':id')
  @RequirePermission('warehouse:manage')
  @Validate({ params: idParamSchema, body: updateWarehouseSchema })
  @ApiOperation({
    summary: 'Modifie un entrepôt',
    description: 'Changer le modèle d\'adresse incrémente la version : les adresses clients sont régénérées à leur prochaine consultation.',
  })
  async update(
    @CurrentAuth() auth: AuthContext,
    @VParams() params: z.infer<typeof idParamSchema>,
    @VBody() body: z.infer<typeof updateWarehouseSchema>,
  ) {
    if (!auth.permissions.can('warehouse:manage', { type: 'WAREHOUSE', id: params.id })) {
      // Même réponse qu'un entrepôt inexistant pour ne pas révéler les entrepôts hors périmètre
      throw AppException.notFound('WAREHOUSE_NOT_FOUND', 'Entrepôt introuvable');
    }
    try {
      return await this.db.run({ companyId: auth.companyId }, async (tx) => {
        const existing = await tx.warehouse.findUnique({ where: { id: params.id } });
        if (!existing) throw AppException.notFound('WAREHOUSE_NOT_FOUND', 'Entrepôt introuvable');
        const templateChanged =
          body.addressTemplate !== undefined && JSON.stringify(body.addressTemplate) !== JSON.stringify(existing.addressTemplate);
        const row = await tx.warehouse.update({
          where: { id: existing.id },
          data: { ...body, ...(templateChanged ? { version: { increment: 1 } } : {}) },
        });
        await this.audit.record(tx, {
          companyId: auth.companyId,
          action: 'warehouse.updated',
          entityType: 'warehouse',
          entityId: row.id,
          before: { status: existing.status, version: existing.version },
          after: { fields: Object.keys(body), status: row.status, version: row.version },
        });
        return toWarehouseDto(row);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw AppException.conflict('WAREHOUSE_REFERENCE_USED', 'Cette référence existe déjà');
      throw error;
    }
  }
}
