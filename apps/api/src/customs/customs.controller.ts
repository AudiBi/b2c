import { Controller, Delete, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { addCustomsLineSchema, customsItemSchema, idParamSchema, updateCustomsItemSchema } from '@b2c/shared';
import { z } from 'zod';
import { Validate, VBody, VParams, VQuery } from '../common/validation';
import type { AuthContext } from '../security/auth.types';
import { CurrentAuth, RequirePermission } from '../security/decorators';
import { CustomsService } from './customs.service';

const listQuery = z.strictObject({ all: z.enum(['true', 'false']).default('false') });
const lineParams = z.strictObject({ id: z.uuid(), lineId: z.uuid() });

@ApiTags('Administration : frais CONATEL')
@ApiBearerAuth()
@Controller('admin/customs-items')
export class CustomsItemsController {
  constructor(private readonly customs: CustomsService) {}

  @Get()
  @RequirePermission('rate:read')
  @Validate({ query: listQuery })
  @ApiOperation({ summary: 'Table des articles CONATEL (?all=true pour inclure les articles retirés)' })
  list(@CurrentAuth() auth: AuthContext, @VQuery() query: z.infer<typeof listQuery>) {
    return this.customs.listItems(auth, query.all === 'true');
  }

  @Post()
  @RequirePermission('rate:manage')
  @Validate({ body: customsItemSchema })
  @ApiOperation({ summary: 'Ajoute un article à la table' })
  create(@CurrentAuth() auth: AuthContext, @VBody() body: z.infer<typeof customsItemSchema>) {
    return this.customs.createItem(auth, body);
  }

  @Post('defaults')
  @HttpCode(200)
  @RequirePermission('rate:manage')
  @ApiOperation({ summary: 'Charge la table de départ (les articles existants ne sont pas modifiés)' })
  defaults(@CurrentAuth() auth: AuthContext) {
    return this.customs.loadDefaults(auth);
  }

  @Patch(':id')
  @RequirePermission('rate:manage')
  @Validate({ params: idParamSchema, body: updateCustomsItemSchema })
  @ApiOperation({ summary: "Modifie les prix d'un article ou le retire de la table" })
  update(@CurrentAuth() auth: AuthContext, @VParams() params: z.infer<typeof idParamSchema>, @VBody() body: z.infer<typeof updateCustomsItemSchema>) {
    return this.customs.updateItem(auth, params.id, body);
  }
}

@ApiTags('Administration : frais CONATEL')
@ApiBearerAuth()
@Controller('admin/packages/:id/customs-lines')
export class PackageCustomsController {
  constructor(private readonly customs: CustomsService) {}

  @Get()
  @RequirePermission('package:read')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: "Frais CONATEL d'un colis" })
  list(@CurrentAuth() auth: AuthContext, @VParams() params: z.infer<typeof idParamSchema>) {
    return this.customs.listLines(auth, params.id);
  }

  @Post()
  @RequirePermission('package:update')
  @Validate({ params: idParamSchema, body: addCustomsLineSchema })
  @ApiOperation({ summary: 'Ajoute un article au colis ; les frais sont calculés et figés (reversés, hors marge)' })
  add(@CurrentAuth() auth: AuthContext, @VParams() params: z.infer<typeof idParamSchema>, @VBody() body: z.infer<typeof addCustomsLineSchema>) {
    return this.customs.addLine(auth, params.id, body);
  }

  @Delete(':lineId')
  @HttpCode(204)
  @RequirePermission('package:update')
  @Validate({ params: lineParams })
  @ApiOperation({ summary: "Retire une ligne tant que le colis n'est pas facturé" })
  async remove(@CurrentAuth() auth: AuthContext, @VParams() params: z.infer<typeof lineParams>) {
    await this.customs.removeLine(auth, params.id, params.lineId);
  }
}
