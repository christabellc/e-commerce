import Redis from 'ioredis';
import { env } from './env';
import { logger } from '../lib/logger';

/**
 * Redis is OPTIONAL. It powers product-listing caching and rate limiting.
 * If REDIS_URL is unset or the server is unreachable, the app keeps working:
 * caching is skipped and rate limiting "fails open" (logged), so a missing
 * Redis never takes the API down. This is a deliberate availability choice.
 */
let client: Redis | null = null;

if (env.redisUrl) {
  client = new Redis(env.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });

  client.on('error', (err) => {
    logger.warn('Redis error (continuing without cache/limits)', { error: err.message });
  });
  client.on('connect', () => logger.info('Redis connected'));

  client.connect().catch((err) => {
    logger.warn('Redis initial connect failed (continuing degraded)', { error: err.message });
  });
} else {
  logger.warn('REDIS_URL not set — caching and rate limiting are disabled');
}

export const redis = client;

/** True only when Redis is configured and currently usable. */
export function redisReady(): boolean {
  return !!client && client.status === 'ready';
}
