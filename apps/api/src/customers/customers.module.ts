import { Module } from '@nestjs/common';
import { PlatformSharedModule } from '../platform/platform-shared.module';
import { AdminCustomersController } from './admin-customers.controller';
import { CustomersService } from './customers.service';
import { PortalController } from './portal.controller';
import { PublicController, SettingsController } from './public.controller';
import { WarehousesController } from './warehouses.controller';

@Module({
  imports: [PlatformSharedModule],
  controllers: [PortalController, AdminCustomersController, WarehousesController, PublicController, SettingsController],
  providers: [CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
