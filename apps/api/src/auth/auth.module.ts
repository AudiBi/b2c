import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { PlatformSharedModule } from '../platform/platform-shared.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TwoFactorController } from './two-factor.controller';
import { TwoFactorService } from './two-factor.service';

@Module({
  imports: [PlatformSharedModule, CustomersModule],
  controllers: [AuthController, TwoFactorController],
  providers: [AuthService, TwoFactorService],
  exports: [AuthService, TwoFactorService],
})
export class AuthModule {}
