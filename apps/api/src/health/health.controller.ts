import { Controller, Get, HttpException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DbService } from '../database/db.service';
import { RedisService } from '../redis/redis.service';
import { Public, SkipRateLimit } from '../security/decorators';

@ApiTags('Santé')
@Controller('health')
export class HealthController {
  constructor(
    private readonly db: DbService,
    private readonly redis: RedisService,
  ) {}

  @Get('live')
  @Public()
  @SkipRateLimit()
  @ApiOperation({ summary: 'Le processus répond' })
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  @Public()
  @SkipRateLimit()
  @ApiOperation({ summary: 'Les dépendances (PostgreSQL, Redis) répondent' })
  async ready() {
    const checks = { database: false, redis: false };
    try {
      await this.db.ping();
      checks.database = true;
    } catch {
      /* indisponible */
    }
    checks.redis = await this.redis.ping();
    if (!checks.database || !checks.redis) {
      throw new HttpException({ message: 'Dépendance indisponible', checks }, 503);
    }
    return { status: 'ok', checks };
  }
}
