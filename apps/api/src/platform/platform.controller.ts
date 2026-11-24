import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createCompanySchema, idParamSchema } from '@b2c/shared';
import type { z } from 'zod';
import { Validate, VBody, VParams } from '../common/validation';
import type { AuthContext } from '../security/auth.types';
import { CurrentAuth, RequirePermission } from '../security/decorators';
import { PlatformService } from './platform.service';

@ApiTags('Plateforme')
@ApiBearerAuth()
@Controller('platform/companies')
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Post()
  @RequirePermission('company:manage')
  @Validate({ body: createCompanySchema })
  @ApiOperation({
    summary: 'Crée une entreprise et invite son administrateur',
    description: "Réservé à l'équipe de la plateforme. L'administrateur reçoit un lien d'activation par e-mail.",
  })
  create(@CurrentAuth() auth: AuthContext, @VBody() body: z.infer<typeof createCompanySchema>) {
    return this.platform.createCompany(auth, body);
  }

  @Get()
  @RequirePermission('company:manage')
  @ApiOperation({ summary: 'Liste les entreprises (sans aucune donnée métier)' })
  list(@CurrentAuth() auth: AuthContext) {
    return this.platform.listCompanies(auth);
  }

  @Post(':id/resend-invite')
  @HttpCode(200)
  @RequirePermission('company:manage')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: "Renvoie l'invitation de l'administrateur de l'entreprise (nouveau lien) ; si l'e-mail échoue, le lien est renvoyé au super administrateur" })
  resendInvite(@CurrentAuth() auth: AuthContext, @VParams() params: z.infer<typeof idParamSchema>) {
    return this.platform.resendAdminInvitation(auth, params.id);
  }

  @Post(':id/suspend')
  @HttpCode(200)
  @RequirePermission('company:manage')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: "Suspend une entreprise : connexions et jetons existants refusés immédiatement" })
  suspend(@CurrentAuth() auth: AuthContext, @VParams() params: z.infer<typeof idParamSchema>) {
    return this.platform.setStatus(auth, params.id, 'SUSPENDED');
  }

  @Post(':id/activate')
  @HttpCode(200)
  @RequirePermission('company:manage')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: 'Réactive une entreprise suspendue' })
  activate(@CurrentAuth() auth: AuthContext, @VParams() params: z.infer<typeof idParamSchema>) {
    return this.platform.setStatus(auth, params.id, 'ACTIVE');
  }
}
