import { DynamicModule, Global, Injectable, Module } from '@nestjs/common';
import type { Env } from './env';

@Injectable()
export class ConfigService {
  constructor(readonly env: Env) {}
}

@Global()
@Module({})
export class ConfigModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: ConfigService, useValue: new ConfigService(env) }],
      exports: [ConfigService],
    };
  }
}
