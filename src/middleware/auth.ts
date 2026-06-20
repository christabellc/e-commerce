import { NextFunction, Request, Response } from 'express';
import { verifyToken, JwtPayload } from '../lib/jwt';
import { AppError } from '../lib/AppError';

// Augment Express's Request so downstream handlers get a typed req.user.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: string; email: string; name: string };
    }
  }
}

export function authRequired(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw AppError.unauthorized('Missing Bearer token');
  }
  const token = header.slice('Bearer '.length).trim();
  try {
    const payload: JwtPayload = verifyToken(token);
    req.user = { id: payload.sub, email: payload.email, name: payload.name };
    next();
  } catch {
    throw AppError.unauthorized('Invalid or expired token');
  }
}
