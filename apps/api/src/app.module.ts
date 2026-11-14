import { DynamicModule, Module, RequestMethod } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from './config/config.module';
import type { Env } from './config/env';
import { CustomersModule } from './customers/customers.module';
import { DatabaseModule } from './database/database.module';
import { FilesModule } from './files/files.module';
import { ClaimsModule } from './claims/claims.module';
import { DeliveryModule } from './delivery/delivery.module';
import { ReportsModule } from './reports/reports.module';
import { FinanceModule } from './finance/finance.module';
import { HealthModule } from './health/health.module';
import { IamModule } from './iam/iam.module';
import { InfraModule } from './infra/infra.module';
import { LogisticsModule } from './logistics/logistics.module';
import { MailModule } from './mail/mail.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PackagesModule } from './packages/packages.module';
import { PlatformModule } from './platform/platform.module';
import { PlatformSharedModule } from './platform/platform-shared.module';
import { PricingModule } from './pricing/pricing.module';
import { CustomsModule } from './customs/customs.module';
import { ProfitModule } from './profit/profit.module';
import { CashbookModule } from './cashbook/cashbook.module';
import { OpsModule } from './ops/ops.controller';
import { ProformaModule } from './proforma/proforma.controller';
import { RedisModule } from './redis/redis.module';
import { SecurityModule } from './security/security.module';

@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(env),
        LoggerModule.forRoot({
          // Syntaxe de chemin d'Express 5 (le « * » historique déclenche un avertissement de conversion)
          forRoutes: [{ path: '{*splat}', method: RequestMethod.ALL }],
          pinoHttp: {
            level: env.LOG_LEVEL,
            // Jamais d'en-têtes d'authentification ni de cookies dans les journaux
            redact: {
              paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
              censor: '[masqué]',
            },
            genReqId: (req) => String(req.headers['x-request-id']),
            autoLogging: { ignore: (req) => (req.url ?? '').startsWith('/health') },
            serializers: {
              req: (req) => ({ id: req.id, method: req.method, url: String(req.url).split('?')[0] }),
            },
          },
        }),
        DatabaseModule,
        RedisModule,
        MailModule,
        AuditModule,
        SecurityModule,
        InfraModule,
        PlatformSharedModule,
        AuthModule,
        IamModule,
        CustomersModule,
        PricingModule,
        CustomsModule,
        ProfitModule,
        CashbookModule,
        OpsModule,
        ProformaModule,
        PackagesModule,
        FilesModule,
        LogisticsModule,
        NotificationsModule,
        FinanceModule,
    DeliveryModule,
    ClaimsModule,
    ReportsModule,
        PlatformModule,
        HealthModule,
      ],
    };
  }
}
