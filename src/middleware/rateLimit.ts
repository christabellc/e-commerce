import { NextFunction, Request, Response } from 'express';
import { redis, redisReady } from '../config/redis';
import { AppError } from '../lib/AppError';
import { logger } from '../lib/logger';

interface Options {
  /** Logical bucket name, e.g. "login" or "order". */
  name: string;
  max: number;
  windowSeconds: number;
  /** Override the identity used for the bucket key (defaults to client IP). */
  keyResolver?: (req: Request) => string;
}

/**
 * Fixed-window rate limiter backed by Redis.
 *
 * Implementation: INCR a per-(bucket, identity, window) counter and set the TTL
 * on first hit. INCR is atomic, so concurrent requests can't both "see 0".
 * The window key embeds floor(now / window) so it rotates automatically.
 *
 * If Redis is unavailable we FAIL OPEN (allow the request) and log it, trading
 * strict enforcement for availability. For a security-critical endpoint you
 * might prefer fail-closed; that is a one-line change.
 */
export function rateLimit(opts: Options) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!redisReady() || !redis) {
      logger.debug('Rate limit skipped (Redis unavailable)', { bucket: opts.name });
      return next();
    }

    const identity = opts.keyResolver ? opts.keyResolver(req) : req.ip ?? 'unknown';
    const windowId = Math.floor(Date.now() / 1000 / opts.windowSeconds);
    const key = `rl:${opts.name}:${identity}:${windowId}`;

    try {
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, opts.windowSeconds);

      const remaining = Math.max(0, opts.max - count);
      res.setHeader('X-RateLimit-Limit', String(opts.max));
      res.setHeader('X-RateLimit-Remaining', String(remaining));

      if (count > opts.max) {
        const ttl = await redis.ttl(key);
        res.setHeader('Retry-After', String(ttl > 0 ? ttl : opts.windowSeconds));
        throw AppError.tooManyRequests(
          `Rate limit exceeded for ${opts.name}. Try again in ${ttl > 0 ? ttl : opts.windowSeconds}s.`
        );
      }
      next();
    } catch (err) {
      if (err instanceof AppError) throw err;
      logger.warn('Rate limiter error (failing open)', {
        bucket: opts.name,
        error: err instanceof Error ? err.message : String(err),
      });
      next();
    }
  };
}
