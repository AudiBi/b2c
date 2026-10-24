import { Module } from '@nestjs/common';
import { CompanyDirectory } from './company-directory.service';

/** Résolution d'entreprise partagée entre l'authentification et l'administration de la plateforme. */
@Module({ providers: [CompanyDirectory], exports: [CompanyDirectory] })
export class PlatformSharedModule {}
