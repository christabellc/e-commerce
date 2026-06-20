import { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/AppError';
import { logger } from '../lib/logger';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(AppError.notFound(`Route not found: ${req.method} ${req.path}`));
}

// Express identifies error middleware by its 4-arg signature.
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    if (err.status >= 500) {
      logger.error(err.message, { code: err.code, path: req.path });
    }
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
  }

  // Postgres unique-violation -> friendly 409 (e.g. duplicate email).
  const pgCode = (err as { code?: string })?.code;
  if (pgCode === '23505') {
    return res.status(409).json({
      error: { code: 'CONFLICT', message: 'Resource already exists' },
    });
  }

  logger.error('Unhandled error', {
    error: err instanceof Error ? err.message : String(err),
    path: req.path,
  });
  return res.status(500).json({
    error: { code: 'INTERNAL', message: 'Something went wrong' },
  });
}
