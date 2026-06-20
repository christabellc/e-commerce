/** Tiny structured logger — zero deps, JSON in prod, readable in dev. */
type Level = 'info' | 'warn' | 'error' | 'debug';

function log(level: Level, message: string, meta?: Record<string, unknown>) {
  const entry = { ts: new Date().toISOString(), level, message, ...meta };
  if (process.env.NODE_ENV === 'production') {
    // Structured single-line JSON is easy for log aggregators to ingest.
    process.stdout.write(JSON.stringify(entry) + '\n');
  } else {
    const tail = meta ? ' ' + JSON.stringify(meta) : '';
    process.stdout.write(`[${entry.ts}] ${level.toUpperCase()} ${message}${tail}\n`);
  }
}

export const logger = {
  info: (m: string, meta?: Record<string, unknown>) => log('info', m, meta),
  warn: (m: string, meta?: Record<string, unknown>) => log('warn', m, meta),
  error: (m: string, meta?: Record<string, unknown>) => log('error', m, meta),
  debug: (m: string, meta?: Record<string, unknown>) =>
    process.env.NODE_ENV !== 'production' && log('debug', m, meta),
};
