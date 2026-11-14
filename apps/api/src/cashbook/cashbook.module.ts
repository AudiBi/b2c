import { Module } from '@nestjs/common';
import { CashbookService } from './cashbook.service';
import { DepositsController, PettyCashController } from './cashbook.controller';

@Module({ controllers: [PettyCashController, DepositsController], providers: [CashbookService] })
export class CashbookModule {}
