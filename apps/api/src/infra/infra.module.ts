import { Global, Module } from '@nestjs/common';
import { CounterService } from './counter.service';
import { IdempotencyService } from './idempotency.service';

@Global()
@Module({ providers: [CounterService, IdempotencyService], exports: [CounterService, IdempotencyService] })
export class InfraModule {}
