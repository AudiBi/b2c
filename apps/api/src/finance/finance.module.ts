import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PackagesModule } from '../packages/packages.module';
import { PlatformSharedModule } from '../platform/platform-shared.module';
import { AdminInvoicesController, AdminPaymentsController, FinanceSettingsController, PaymentWebhookController, PortalFinanceController } from './finance.controllers';
import { InvoicesService } from './invoices.service';
import { LedgerService } from './ledger.service';
import { PaymentsService } from './payments.service';

@Module({
  imports: [PackagesModule, NotificationsModule, PlatformSharedModule],
  controllers: [AdminInvoicesController, PortalFinanceController, AdminPaymentsController, FinanceSettingsController, PaymentWebhookController],
  providers: [LedgerService, InvoicesService, PaymentsService],
})
export class FinanceModule {}
