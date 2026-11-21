import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { twoFactorEnableSchema, twoFactorProofSchema, twoFactorSetupSchema } from '@b2c/shared';
import type { z } from 'zod';
import { Validate, VBody } from '../common/validation';
import type { AuthContext } from '../security/auth.types';
import { AllowWithoutMfa, AnyAuthenticated, CurrentAuth, RateLimit } from '../security/decorators';
import { TwoFactorService } from './two-factor.service';

type Body<T extends z.ZodType> = z.infer<T>;

@ApiTags('Double authentification')
@ApiBearerAuth()
@Controller('me/2fa')
@AnyAuthenticated()
@AllowWithoutMfa()
export class TwoFactorController {
  constructor(private readonly twoFactor: TwoFactorService) {}

  @Get()
  @ApiOperation({ summary: 'État de ma double authentification (active, en cours d’activation, obligatoire, codes de secours restants)' })
  status(@CurrentAuth() auth: AuthContext) {
    return this.twoFactor.status(auth);
  }

  @Post('setup')
  @HttpCode(200)
  @RateLimit({ name: '2fa-setup', limit: 20, windowSeconds: 3600 })
  @Validate({ body: twoFactorSetupSchema })
  @ApiOperation({ summary: 'Commence l’activation : mot de passe exigé, renvoie le secret et l’adresse otpauth à saisir dans l’application (une activation déjà en cours garde la même clé, sauf renew: true)' })
  setup(@CurrentAuth() auth: AuthContext, @VBody() body: Body<typeof twoFactorSetupSchema>) {
    return this.twoFactor.setup(auth, body.password, body.renew === true);
  }

  @Post('enable')
  @HttpCode(200)
  @RateLimit({ name: '2fa-enable', limit: 20, windowSeconds: 3600 })
  @Validate({ body: twoFactorEnableSchema })
  @ApiOperation({ summary: 'Active avec un premier code ; renvoie 10 codes de secours, montrés une seule fois' })
  enable(@CurrentAuth() auth: AuthContext, @VBody() body: Body<typeof twoFactorEnableSchema>) {
    return this.twoFactor.enable(auth, body.code);
  }

  @Post('disable')
  @HttpCode(204)
  @RateLimit({ name: '2fa-disable', limit: 20, windowSeconds: 3600 })
  @Validate({ body: twoFactorProofSchema })
  @ApiOperation({ summary: 'Désactive (mot de passe + code) ; refusé si la politique l’impose à ce compte' })
  async disable(@CurrentAuth() auth: AuthContext, @VBody() body: Body<typeof twoFactorProofSchema>) {
    await this.twoFactor.disable(auth, body);
  }

  @Post('recovery-codes')
  @HttpCode(200)
  @RateLimit({ name: '2fa-recovery', limit: 20, windowSeconds: 3600 })
  @Validate({ body: twoFactorProofSchema })
  @ApiOperation({ summary: 'Régénère les codes de secours (les anciens sont annulés)' })
  recovery(@CurrentAuth() auth: AuthContext, @VBody() body: Body<typeof twoFactorProofSchema>) {
    return this.twoFactor.regenerateRecoveryCodes(auth, body);
  }
}
