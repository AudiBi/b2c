import { Controller, Delete, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createAddressSchema,
  createBeneficiarySchema,
  idParamSchema,
  updateAddressSchema,
  updateBeneficiarySchema,
  updateProfileSchema,
} from '@b2c/shared';
import type { z } from 'zod';
import { Validate, VBody, VParams } from '../common/validation';
import type { AuthContext } from '../security/auth.types';
import { CurrentAuth, RequirePermission } from '../security/decorators';
import { CustomersService } from './customers.service';

type Params = z.infer<typeof idParamSchema>;

/** Espace personnel du client connecté. Chaque route ne manipule que les données de l'utilisateur du jeton. */
@ApiTags('Espace client')
@ApiBearerAuth()
@Controller('me')
export class PortalController {
  constructor(private readonly customers: CustomersService) {}

  @Get('profile')
  @RequirePermission('profile:read_own')
  @ApiOperation({ summary: 'Mon profil, mon code client et mes préférences de notification' })
  profile(@CurrentAuth() auth: AuthContext) {
    return this.customers.getProfile(auth);
  }

  @Patch('profile')
  @RequirePermission('profile:update_own')
  @Validate({ body: updateProfileSchema })
  @ApiOperation({ summary: 'Modifie mon profil (nom, téléphone, langue, préférences)' })
  updateProfile(@CurrentAuth() auth: AuthContext, @VBody() body: z.infer<typeof updateProfileSchema>) {
    return this.customers.updateProfile(auth, body);
  }

  @Get('addresses')
  @RequirePermission('profile:read_own')
  @ApiOperation({ summary: 'Mes adresses personnelles et de livraison' })
  addresses(@CurrentAuth() auth: AuthContext) {
    return this.customers.listAddresses(auth);
  }

  @Post('addresses')
  @RequirePermission('profile:update_own')
  @Validate({ body: createAddressSchema })
  @ApiOperation({ summary: 'Ajoute une adresse (la première de chaque type devient celle par défaut)' })
  createAddress(@CurrentAuth() auth: AuthContext, @VBody() body: z.infer<typeof createAddressSchema>) {
    return this.customers.createAddress(auth, body);
  }

  @Patch('addresses/:id')
  @RequirePermission('profile:update_own')
  @Validate({ params: idParamSchema, body: updateAddressSchema })
  @ApiOperation({ summary: 'Modifie une de mes adresses' })
  updateAddress(
    @CurrentAuth() auth: AuthContext,
    @VParams() params: Params,
    @VBody() body: z.infer<typeof updateAddressSchema>,
  ) {
    return this.customers.updateAddress(auth, params.id, body);
  }

  @Delete('addresses/:id')
  @HttpCode(204)
  @RequirePermission('profile:update_own')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: 'Supprime une de mes adresses' })
  async deleteAddress(@CurrentAuth() auth: AuthContext, @VParams() params: Params) {
    await this.customers.deleteAddress(auth, params.id);
  }

  @Get('beneficiaries')
  @RequirePermission('profile:read_own')
  @ApiOperation({ summary: 'Mes bénéficiaires autorisés à retirer un colis' })
  beneficiaries(@CurrentAuth() auth: AuthContext) {
    return this.customers.listBeneficiaries(auth);
  }

  @Post('beneficiaries')
  @RequirePermission('profile:update_own')
  @Validate({ body: createBeneficiarySchema })
  @ApiOperation({
    summary: 'Ajoute un bénéficiaire',
    description: 'Seuls les 4 derniers caractères de la pièce d\'identité sont acceptés et conservés. Maximum 10 bénéficiaires actifs.',
  })
  createBeneficiary(@CurrentAuth() auth: AuthContext, @VBody() body: z.infer<typeof createBeneficiarySchema>) {
    return this.customers.createBeneficiary(auth, body);
  }

  @Patch('beneficiaries/:id')
  @RequirePermission('profile:update_own')
  @Validate({ params: idParamSchema, body: updateBeneficiarySchema })
  @ApiOperation({ summary: 'Modifie un bénéficiaire' })
  updateBeneficiary(
    @CurrentAuth() auth: AuthContext,
    @VParams() params: Params,
    @VBody() body: z.infer<typeof updateBeneficiarySchema>,
  ) {
    return this.customers.updateBeneficiary(auth, params.id, body);
  }

  @Delete('beneficiaries/:id')
  @HttpCode(204)
  @RequirePermission('profile:update_own')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: 'Révoque un bénéficiaire (conservé dans l\'historique)' })
  async revokeBeneficiary(@CurrentAuth() auth: AuthContext, @VParams() params: Params) {
    await this.customers.revokeBeneficiary(auth, params.id);
  }

  @Get('receiving-addresses')
  @RequirePermission('profile:read_own')
  @ApiOperation({
    summary: 'Mes adresses de réception personnalisées, par entrepôt et par mode de transport',
    description: 'Générées par le système à partir du code client ; à utiliser telles quelles chez les marchands.',
  })
  receivingAddresses(@CurrentAuth() auth: AuthContext) {
    return this.customers.receivingAddresses(auth);
  }
}
