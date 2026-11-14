import { Module } from '@nestjs/common';
import { PlatformSharedModule } from '../platform/platform-shared.module';
import { ExpensesController, ProfitController } from './profit.controller';
import { ProfitService } from './profit.service';
import { ClaimCompensationController, CustomerReferrerController, ReferrersController } from './referrers.controller';
import { ReferrersService } from './referrers.service';

@Module({ imports: [PlatformSharedModule], controllers: [ExpensesController, ProfitController, ReferrersController, CustomerReferrerController, ClaimCompensationController], providers: [ProfitService, ReferrersService] })
export class ProfitModule {}
