import { query } from '../../config/db';
import { redis, redisReady } from '../../config/redis';
import { env } from '../../config/env';
import { AppError } from '../../lib/AppError';
import { logger } from '../../lib/logger';
import { Pagination, toOffset, buildMeta } from '../../lib/pagination';
import { CreateProductInput } from './products.schemas';

const LIST_CACHE_PREFIX = 'cache:products:list:';

export async function createProduct(sellerId: string, input: CreateProductInput) {
  const res = await query(
    `INSERT INTO products (seller_id, title, description, price, stock)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id, seller_id, title, description, price, stock, created_at, updated_at`,
    [sellerId, input.title, input.description, input.price, input.stock]
  );
  // The catalogue changed — drop cached listings so reads stay fresh.
  await invalidateListCache();
  return res.rows[0];
}

export async function listProducts(p: Pagination) {
  const { limit, offset } = toOffset(p);
  const cacheKey = `${LIST_CACHE_PREFIX}${p.page}:${p.limit}`;

  // ---- Try cache first (bonus: Redis caching of the listing endpoint) ----
  if (redisReady() && redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        logger.debug('Products list cache HIT', { cacheKey });
        return { ...JSON.parse(cached), cached: true };
      }
    } catch (err) {
      logger.warn('Cache read failed', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  const [rows, count] = await Promise.all([
    query(
      `SELECT id, seller_id, title, description, price, stock, created_at
       FROM products ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    ),
    query<{ count: string }>('SELECT COUNT(*)::int AS count FROM products'),
  ]);

  const total = Number(count.rows[0]?.count ?? 0);
  const payload = { data: rows.rows, meta: buildMeta(p.page, p.limit, total) };

  if (redisReady() && redis) {
    redis
      .set(cacheKey, JSON.stringify(payload), 'EX', env.productsCacheTtl)
      .catch((err) => logger.warn('Cache write failed', { error: String(err) }));
  }

  return { ...payload, cached: false };
}

export async function getProduct(id: string) {
  const res = await query(
    `SELECT id, seller_id, title, description, price, stock, created_at, updated_at
     FROM products WHERE id = $1`,
    [id]
  );
  if (!res.rowCount) throw AppError.notFound('Product not found');
  return res.rows[0];
}

/** Wipe every cached listing page. Called on create and after stock changes. */
export async function invalidateListCache() {
  if (!redisReady() || !redis) return;
  try {
    const keys = await redis.keys(`${LIST_CACHE_PREFIX}*`);
    if (keys.length) await redis.del(...keys);
  } catch (err) {
    logger.warn('Cache invalidation failed', { error: String(err) });
  }
}
