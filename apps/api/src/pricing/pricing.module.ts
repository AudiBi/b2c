import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { PlatformSharedModule } from '../platform/platform-shared.module';
import { CategoriesController, PortalQuotesController, PublicPricingController, RateCardsController } from './pricing.controllers';
import { PricingService } from './pricing.service';

@Module({
  imports: [PlatformSharedModule, CustomersModule],
  controllers: [RateCardsController, CategoriesController, PublicPricingController, PortalQuotesController],
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
