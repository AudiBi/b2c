import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { PlatformSharedModule } from '../platform/platform-shared.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PricingModule } from '../pricing/pricing.module';
import {
  AdminPackagesController,
  PackageGroupsController,
  PortalPackagesController,
  PortalPrealertsController,
  PublicTrackingController,
} from './packages.controllers';
import { PackagesService } from './packages.service';
import { PortalPackagesService, PrealertsService } from './prealerts.service';
import { TrackingNumberService } from './tracking-number.service';

@Module({
  imports: [CustomersModule, PricingModule, NotificationsModule, PlatformSharedModule],
  controllers: [AdminPackagesController, PackageGroupsController, PortalPrealertsController, PortalPackagesController, PublicTrackingController],
  providers: [PackagesService, PrealertsService, PortalPackagesService, TrackingNumberService],
  exports: [PackagesService],
})
export class PackagesModule {}
