import { readFileSync } from 'fs';
import { join } from 'path';
import { pool, closePool } from '../config/db';
import { logger } from '../lib/logger';

/**
 * Minimal migration runner: applies the single idempotent schema.sql.
 * For a larger project this would become a versioned migration table,
 * but a one-file approach keeps the take-home reviewer's setup trivial.
 */
async function main() {
  const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
  logger.info('Applying schema...');
  await pool.query(sql);
  logger.info('Schema applied successfully');
  await closePool();
}

main().catch(async (err) => {
  logger.error('Migration failed', { error: err instanceof Error ? err.message : String(err) });
  await closePool();
  process.exit(1);
});
