import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PackagesModule } from '../packages/packages.module';
import { PlatformSharedModule } from '../platform/platform-shared.module';
import { AdminDeliveryController, DriverController, PortalDeliveryController } from './delivery.controllers';
import { DeliveryService } from './delivery.service';

@Module({
  imports: [PackagesModule, NotificationsModule, PlatformSharedModule],
  controllers: [AdminDeliveryController, DriverController, PortalDeliveryController],
  providers: [DeliveryService],
})
export class DeliveryModule {}
