import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { NotificationWorker } from './notification.worker';
import { AdminNotificationsController, PortalNotificationsController } from './notifications.controllers';
import { NotificationsService } from './notifications.service';
import { OutboxService } from './outbox.service';

@Module({
  imports: [MailModule],
  controllers: [AdminNotificationsController, PortalNotificationsController],
  providers: [NotificationsService, OutboxService, NotificationWorker],
  exports: [OutboxService, NotificationsService],
})
export class NotificationsModule {}
