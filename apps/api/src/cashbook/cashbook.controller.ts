import { Controller, Get, HttpCode, Post, Put, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createDepositSchema, createPettyCashSchema, idParamSchema, listDepositsQuerySchema, listPettyCashQuerySchema, pettyCashThresholdSchema } from '@b2c/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { Validate, VBody, VParams, VQuery } from '../common/validation';
import { depositSlipPdf } from '../finance/finance-pdf';
import type { AuthContext } from '../security/auth.types';
import { CurrentAuth, RequirePermission } from '../security/decorators';
import { CashbookService } from './cashbook.service';

const dayQuery = z.strictObject({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date_format') });

@ApiTags('Administration : petite caisse')
@ApiBearerAuth()
@Controller('admin/petty-cash')
export class PettyCashController {
  constructor(private readonly cashbook: CashbookService) {}

  @Get()
  @RequirePermission('petty_cash:read')
  @Validate({ query: listPettyCashQuerySchema })
  @ApiOperation({ summary: 'Écritures de petite caisse, soldes par devise et alerte de solde bas' })
  list(@CurrentAuth() auth: AuthContext, @VQuery() query: z.infer<typeof listPettyCashQuerySchema>) {
    return this.cashbook.listPetty(auth, query);
  }

  @Post()
  @RequirePermission('petty_cash:manage')
  @Validate({ body: createPettyCashSchema })
  @ApiOperation({ summary: 'Enregistre une dépense ou un approvisionnement (jamais modifiable : écriture inverse)' })
  create(@CurrentAuth() auth: AuthContext, @VBody() body: z.infer<typeof createPettyCashSchema>) {
    return this.cashbook.createPetty(auth, body);
  }

  @Get('daily')
  @RequirePermission('petty_cash:read')
  @Validate({ query: dayQuery })
  @ApiOperation({ summary: 'Rapport du jour : entrées, sorties et solde par devise' })
  daily(@CurrentAuth() auth: AuthContext, @VQuery() query: z.infer<typeof dayQuery>) {
    return this.cashbook.dailyReport(auth, query.date);
  }

  @Put('thresholds')
  @RequirePermission('petty_cash:manage')
  @Validate({ body: pettyCashThresholdSchema })
  @ApiOperation({ summary: 'Seuils d’alerte de solde bas, par devise' })
  thresholds(@CurrentAuth() auth: AuthContext, @VBody() body: z.infer<typeof pettyCashThresholdSchema>) {
    return this.cashbook.setThresholds(auth, body.thresholds);
  }
}

@ApiTags('Administration : dépôts bancaires')
@ApiBearerAuth()
@Controller('admin/deposits')
export class DepositsController {
  constructor(private readonly cashbook: CashbookService) {}

  @Get()
  @RequirePermission('deposit:read')
  @Validate({ query: listDepositsQuerySchema })
  @ApiOperation({ summary: 'Dépôts bancaires' })
  list(@CurrentAuth() auth: AuthContext, @VQuery() query: z.infer<typeof listDepositsQuerySchema>) {
    return this.cashbook.listDeposits(auth, query.limit);
  }

  @Get('to-deposit')
  @RequirePermission('deposit:read')
  @ApiOperation({ summary: 'Reste à déposer : caisses clôturées pas encore déposées, par devise' })
  toDeposit(@CurrentAuth() auth: AuthContext) {
    return this.cashbook.toDeposit(auth);
  }

  @Post()
  @RequirePermission('deposit:manage')
  @Validate({ body: createDepositSchema })
  @ApiOperation({
    summary: 'Enregistre un dépôt des caisses clôturées choisies (une devise) ; l’écart déposé − attendu est calculé et figé',
    description: "Attendu = montant compté à la clôture moins le fonds de caisse d'ouverture. Numéro DEP-AAAA-NNNNNN. Un dépôt ne se modifie pas.",
  })
  create(@CurrentAuth() auth: AuthContext, @VBody() body: z.infer<typeof createDepositSchema>) {
    return this.cashbook.createDeposit(auth, body);
  }

  @Get(':id/slip.pdf')
  @HttpCode(200)
  @RequirePermission('deposit:read')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: 'Bordereau de dépôt imprimable (PDF)' })
  async slip(@CurrentAuth() auth: AuthContext, @VParams() params: z.infer<typeof idParamSchema>, @Res() res: Response) {
    const { deposit, company } = await this.cashbook.getDeposit(auth, params.id);
    const buffer = await depositSlipPdf({ company, ...deposit, sessions: deposit.sessionIds.length });
    res
      .status(200)
      .set({ 'Content-Type': 'application/pdf', 'Content-Length': String(buffer.length), 'Content-Disposition': `attachment; filename="${deposit.number}.pdf"`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' })
      .end(buffer);
  }
}
