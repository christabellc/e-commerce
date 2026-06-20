import dotenv from 'dotenv';

dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: num('PORT', 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? '*',

  databaseUrl: process.env.DATABASE_URL,
  pg: {
    host: process.env.PGHOST ?? 'localhost',
    port: num('PGPORT', 5432),
    user: process.env.PGUSER ?? 'buckets',
    password: process.env.PGPASSWORD ?? 'buckets',
    database: process.env.PGDATABASE ?? 'buckets',
  },

  redisUrl: process.env.REDIS_URL, // optional

  jwtSecret: required('JWT_SECRET', 'dev-only-insecure-secret'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',

  productsCacheTtl: num('PRODUCTS_CACHE_TTL_SECONDS', 60),

  rateLimit: {
    login: {
      max: num('RATE_LIMIT_LOGIN_MAX', 5),
      windowSeconds: num('RATE_LIMIT_LOGIN_WINDOW_SECONDS', 60),
    },
    order: {
      max: num('RATE_LIMIT_ORDER_MAX', 10),
      windowSeconds: num('RATE_LIMIT_ORDER_WINDOW_SECONDS', 60),
    },
  },
} as const;
