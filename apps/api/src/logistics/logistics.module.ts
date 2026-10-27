import { Module } from '@nestjs/common';
import { PackagesModule } from '../packages/packages.module';
import { PlatformSharedModule } from '../platform/platform-shared.module';
import { AgenciesService } from './agencies.service';
import { AgenciesController, PublicAgenciesController, ShipmentsController, WarehouseOpsController } from './logistics.controllers';
import { ShipmentsService } from './shipments.service';
import { WarehouseOpsService } from './warehouse-ops.service';

@Module({
  imports: [PackagesModule, PlatformSharedModule],
  controllers: [WarehouseOpsController, AgenciesController, PublicAgenciesController, ShipmentsController],
  providers: [WarehouseOpsService, AgenciesService, ShipmentsService],
})
export class LogisticsModule {}
