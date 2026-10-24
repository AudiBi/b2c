import { Global, Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ValidationInterceptor } from '../common/validation';
import { AuthContextService } from './auth-context.service';
import { AuthGuard, PermissionsGuard, RateLimitGuard } from './guards';
import { OneTimeTokenService } from './one-time-token.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

@Global()
@Module({
  providers: [
    TokenService,
    PasswordService,
    OneTimeTokenService,
    AuthContextService,
    // Ordre d'exécution : limitation de débit → authentification → permissions → validation
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: ValidationInterceptor },
  ],
  exports: [TokenService, PasswordService, OneTimeTokenService, AuthContextService],
})
export class SecurityModule {}
