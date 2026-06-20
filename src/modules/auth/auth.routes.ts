import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import { rateLimit } from '../../middleware/rateLimit';
import { env } from '../../config/env';
import { registerSchema, loginSchema } from './auth.schemas';
import * as controller from './auth.controller';

const router = Router();

router.post('/register', validate(registerSchema), asyncHandler(controller.register));

// Bonus: rate-limit login to blunt credential-stuffing / brute force.
router.post(
  '/login',
  rateLimit({
    name: 'login',
    max: env.rateLimit.login.max,
    windowSeconds: env.rateLimit.login.windowSeconds,
    // Limit per IP + email so one attacker can't lock out everyone from an IP.
    keyResolver: (req) => `${req.ip}:${(req.body?.email ?? '').toString().toLowerCase()}`,
  }),
  validate(loginSchema),
  asyncHandler(controller.login)
);

export default router;
