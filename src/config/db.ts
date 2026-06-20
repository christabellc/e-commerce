import { Pool, PoolClient, QueryResultRow } from 'pg';
import { env } from './env';
import { logger } from '../lib/logger';

/**
 * A single shared connection pool for the whole process.
 * Order processing borrows a dedicated client from this pool so it can run
 * a multi-statement transaction in isolation (see orders.service.ts).
 */
export const pool = env.databaseUrl
  ? new Pool({ connectionString: env.databaseUrl, max: 20 })
  : new Pool({ ...env.pg, max: 20 });

pool.on('error', (err) => {
  logger.error('Unexpected Postgres pool error', { error: err.message });
});

/** Convenience helper for one-off queries that don't need an explicit transaction. */
export async function query<T extends QueryResultRow = any>(text: string, params: unknown[] = []) {
  return pool.query<T>(text, params);
}

/**
 * Run a function inside a single transaction. Commits on success,
 * rolls back on any thrown error, and always releases the client.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
