import { Module } from '@nestjs/common';
import { PlatformSharedModule } from '../platform/platform-shared.module';
import { CustomsItemsController, PackageCustomsController } from './customs.controller';
import { CustomsService } from './customs.service';

@Module({
  imports: [PlatformSharedModule],
  controllers: [CustomsItemsController, PackageCustomsController],
  providers: [CustomsService],
  exports: [CustomsService],
})
export class CustomsModule {}
