import { Router } from 'express';
import { authRequired } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import { rateLimit } from '../../middleware/rateLimit';
import { env } from '../../config/env';
import { createOrderSchema } from './orders.schemas';
import * as controller from './orders.controller';

const router = Router();

// Bonus: rate-limit the order endpoint per authenticated user.
router.post(
  '/',
  authRequired,
  rateLimit({
    name: 'order',
    max: env.rateLimit.order.max,
    windowSeconds: env.rateLimit.order.windowSeconds,
    keyResolver: (req) => req.user?.id ?? req.ip ?? 'unknown',
  }),
  validate(createOrderSchema),
  asyncHandler(controller.create)
);

export default router;
