import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import api from './routes';
import { notFoundHandler, errorHandler } from './middleware/error';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.corsOrigin === '*' ? true : env.corsOrigin }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', uptime: process.uptime(), env: env.nodeEnv });
  });

  app.use('/api', api);

  // 404 + central error handler must be registered last.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
