import { Router } from 'express';
import { authRequired } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import { paginationQuery } from '../../lib/pagination';
import { createPostSchema } from './posts.schemas';
import * as controller from './posts.controller';

const router = Router();

router.post('/', authRequired, validate(createPostSchema), asyncHandler(controller.create));
router.get('/', validate(paginationQuery, 'query'), asyncHandler(controller.list));

export default router;
