import { Controller, Delete, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createExpenseSchema, idParamSchema, listExpensesQuerySchema, profitQuerySchema, updateExpenseSchema } from '@b2c/shared';
import type { z } from 'zod';
import { Validate, VBody, VParams, VQuery } from '../common/validation';
import type { AuthContext } from '../security/auth.types';
import { CurrentAuth, RequirePermission } from '../security/decorators';
import { ProfitService } from './profit.service';

@ApiTags('Administration : dépenses')
@ApiBearerAuth()
@Controller('admin/expenses')
export class ExpensesController {
  constructor(private readonly profit: ProfitService) {}

  @Get()
  @RequirePermission('expense:read')
  @Validate({ query: listExpensesQuerySchema })
  @ApiOperation({ summary: 'Dépenses (filtre par mois AAAA-MM et catégorie)' })
  list(@CurrentAuth() auth: AuthContext, @VQuery() query: z.infer<typeof listExpensesQuerySchema>) {
    return this.profit.listExpenses(auth, query);
  }

  @Post()
  @RequirePermission('expense:manage')
  @Validate({ body: createExpenseSchema })
  @ApiOperation({ summary: 'Saisit une dépense' })
  create(@CurrentAuth() auth: AuthContext, @VBody() body: z.infer<typeof createExpenseSchema>) {
    return this.profit.createExpense(auth, body);
  }

  @Patch(':id')
  @RequirePermission('expense:manage')
  @Validate({ params: idParamSchema, body: updateExpenseSchema })
  @ApiOperation({ summary: 'Corrige une dépense (ancien montant au journal)' })
  update(@CurrentAuth() auth: AuthContext, @VParams() params: z.infer<typeof idParamSchema>, @VBody() body: z.infer<typeof updateExpenseSchema>) {
    return this.profit.updateExpense(auth, params.id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('expense:manage')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: 'Supprime une dépense (journalisée)' })
  async remove(@CurrentAuth() auth: AuthContext, @VParams() params: z.infer<typeof idParamSchema>) {
    await this.profit.deleteExpense(auth, params.id);
  }
}

@ApiTags('Administration : profit')
@ApiBearerAuth()
@Controller('admin/reports/profit')
export class ProfitController {
  constructor(private readonly profit: ProfitService) {}

  @Get()
  @RequirePermission('report:profit', 'cost:read')
  @Validate({ query: profitQuerySchema })
  @ApiOperation({
    summary: 'Profit mensuel sur 12 mois (chiffre d’affaires, coût, marge, dépenses, net, par mode)',
    description: 'Réservé à l’administration et à la comptabilité. Formules de l’outil de gestion ; les frais CONATEL reversés sont hors marge.',
  })
  get(@CurrentAuth() auth: AuthContext, @VQuery() query: z.infer<typeof profitQuerySchema>) {
    return this.profit.profit(auth, query);
  }
}
