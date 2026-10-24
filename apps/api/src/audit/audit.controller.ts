import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { auditQuerySchema } from '@b2c/shared';
import type { z } from 'zod';
import { Validate, VQuery } from '../common/validation';
import { DbService } from '../database/db.service';
import { CurrentAuth, RequirePermission } from '../security/decorators';
import type { AuthContext } from '../security/auth.types';

@ApiTags('Audit')
@ApiBearerAuth()
@Controller('audit')
export class AuditController {
  constructor(private readonly db: DbService) {}

  @Get()
  @RequirePermission('audit:read')
  @Validate({ query: auditQuerySchema })
  @ApiOperation({ summary: "Journal d'audit de l'entreprise (lecture seule, pagination par curseur)" })
  async list(@CurrentAuth() auth: AuthContext, @VQuery() query: z.infer<typeof auditQuerySchema>) {
    const rows = await this.db.run({ companyId: auth.companyId }, (tx) =>
      tx.auditLog.findMany({
        where: {
          action: query.action,
          entityType: query.entityType,
          entityId: query.entityId,
          actorUserId: query.actorUserId,
          ...(query.cursor ? { id: { lt: query.cursor } } : {}),
        },
        orderBy: { id: 'desc' },
        take: query.limit + 1,
      }),
    );
    const items = rows.slice(0, query.limit);
    return { items, nextCursor: rows.length > query.limit ? items[items.length - 1].id : null };
  }
}
