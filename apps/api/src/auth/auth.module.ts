import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { PlatformSharedModule } from '../platform/platform-shared.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [PlatformSharedModule, CustomersModule],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
