import { NextFunction, Request, Response } from 'express';
import { ZodSchema } from 'zod';
import { AppError } from '../lib/AppError';

type Part = 'body' | 'query' | 'params';

/** Validates and (importantly) coerces a request part using a Zod schema. */
export function validate(schema: ZodSchema, part: Part = 'body') {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        field: i.path.join('.') || '(root)',
        message: i.message,
      }));
      throw AppError.badRequest('Validation failed', details);
    }
    // Replace with the parsed/coerced value (e.g. numeric query params).
    (req as any)[part] = result.data;
    next();
  };
}
