import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { idParamSchema, listCustomersQuerySchema } from '@b2c/shared';
import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { AppException } from '../common/errors';
import { Validate, VParams, VQuery } from '../common/validation';
import { DbService } from '../database/db.service';
import type { AuthContext } from '../security/auth.types';
import { CurrentAuth, RequirePermission } from '../security/decorators';

const include = { user: true } satisfies Prisma.CustomerInclude;

function toDto(row: Prisma.CustomerGetPayload<{ include: typeof include }>) {
  return {
    id: row.id,
    customerCode: row.customerCode,
    customerType: row.customerType,
    firstName: row.user.firstName,
    lastName: row.user.lastName,
    businessName: row.user.businessName,
    email: row.user.email,
    phone: row.user.phone,
    status: row.user.status,
    createdAt: row.createdAt,
  };
}

/** Consultation des clients par le personnel (lecture seule pour l'instant). */
@ApiTags('Administration : clients')
@ApiBearerAuth()
@Controller('admin/customers')
export class AdminCustomersController {
  constructor(private readonly db: DbService) {}

  @Get()
  @RequirePermission('customer:read')
  @Validate({ query: listCustomersQuerySchema })
  @ApiOperation({ summary: 'Recherche de clients par code, nom, raison sociale ou e-mail' })
  async list(@CurrentAuth() auth: AuthContext, @VQuery() query: z.infer<typeof listCustomersQuerySchema>) {
    const q = query.q;
    const rows = await this.db.run({ companyId: auth.companyId }, (tx) =>
      tx.customer.findMany({
        where: {
          customerType: query.type,
          ...(query.cursor ? { id: { lt: query.cursor } } : {}),
          ...(q
            ? {
                OR: [
                  { customerCode: { contains: q.toUpperCase() } },
                  { user: { email: { contains: q.toLowerCase() } } },
                  { user: { firstName: { contains: q, mode: 'insensitive' } } },
                  { user: { lastName: { contains: q, mode: 'insensitive' } } },
                  { user: { businessName: { contains: q, mode: 'insensitive' } } },
                ],
              }
            : {}),
        },
        include,
        orderBy: { id: 'desc' },
        take: query.limit + 1,
      }),
    );
    const items = rows.slice(0, query.limit);
    return { items: items.map(toDto), nextCursor: rows.length > query.limit ? items[items.length - 1].id : null };
  }

  @Get(':id')
  @RequirePermission('customer:read')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: "Détail d'un client" })
  async get(@CurrentAuth() auth: AuthContext, @VParams() params: z.infer<typeof idParamSchema>) {
    const row = await this.db.run({ companyId: auth.companyId }, (tx) =>
      tx.customer.findUnique({ where: { id: params.id }, include }),
    );
    if (!row) throw AppException.notFound('CUSTOMER_NOT_FOUND', 'Client introuvable');
    return toDto(row);
  }
}
