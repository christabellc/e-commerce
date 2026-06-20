import { createServer } from 'http';
import { createApp } from './app';
import { initChatGateway } from './modules/chat/chat.gateway';
import { env } from './config/env';
import { logger } from './lib/logger';
import { closePool } from './config/db';

const app = createApp();
const httpServer = createServer(app);

// Attach the WebSocket chat gateway to the same HTTP server.
const io = initChatGateway(httpServer);

httpServer.listen(env.port, () => {
  logger.info(`Buckets backend listening on :${env.port}`, { env: env.nodeEnv });
});

// --- Graceful shutdown: stop accepting connections, drain, close resources. ---
async function shutdown(signal: string) {
  logger.info(`Received ${signal}, shutting down...`);
  io.close();
  httpServer.close(async () => {
    await closePool();
    logger.info('Shutdown complete');
    process.exit(0);
  });
  // Hard exit if cleanup hangs.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
