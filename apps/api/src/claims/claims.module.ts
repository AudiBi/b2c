import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PlatformSharedModule } from '../platform/platform-shared.module';
import { AdminClaimsController, PortalClaimsController } from './claims.controllers';
import { ClaimsService } from './claims.service';

@Module({
  imports: [NotificationsModule, PlatformSharedModule],
  controllers: [AdminClaimsController, PortalClaimsController],
  providers: [ClaimsService],
})
export class ClaimsModule {}
