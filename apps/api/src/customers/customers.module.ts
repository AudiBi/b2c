import { Module } from '@nestjs/common';
import { PlatformSharedModule } from '../platform/platform-shared.module';
import { AdminCustomersController } from './admin-customers.controller';
import { CustomersService } from './customers.service';
import { PortalController } from './portal.controller';
import { StaffCustomersService } from './staff-customers.service';
import { TeamController } from './team.controller';
import { TeamService } from './team.service';
import { FxRateController, PublicController, SettingsController } from './public.controller';
import { WarehousesController } from './warehouses.controller';

@Module({
  imports: [PlatformSharedModule],
  controllers: [PortalController, TeamController, AdminCustomersController, WarehousesController, PublicController, SettingsController, FxRateController],
  providers: [CustomersService, TeamService, StaffCustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
