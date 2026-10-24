import { Injectable } from '@nestjs/common';
import { RedisService } from './redis.service';

export interface HitResult {
  count: number;
  /** Secondes avant la fin de la fenêtre. */
  retryAfter: number;
}

/** Compteurs à fenêtre fixe dans Redis (limitation de débit et verrouillage des connexions). */
@Injectable()
export class RateLimiter {
  constructor(private readonly redis: RedisService) {}

  /** Incrémente le compteur et renvoie sa valeur. La fenêtre est posée atomiquement à la création. */
  async hit(key: string, windowSeconds: number): Promise<HitResult> {
    const results = await this.redis.client
      .multi()
      .set(key, 0, 'EX', windowSeconds, 'NX')
      .incr(key)
      .ttl(key)
      .exec();
    if (!results) throw new Error('Redis indisponible');
    const [[setError], [incrError, count], [ttlError, ttl]] = results as [Error | null, unknown][];
    const failure = setError ?? incrError ?? ttlError;
    if (failure) throw failure;
    return { count: Number(count), retryAfter: Math.max(1, Number(ttl)) };
  }

  async current(key: string): Promise<number> {
    const value = await this.redis.client.get(key);
    return value ? Number(value) : 0;
  }

  async ttl(key: string): Promise<number> {
    return Math.max(0, await this.redis.client.ttl(key));
  }

  async reset(key: string): Promise<void> {
    await this.redis.client.del(key);
  }
}
