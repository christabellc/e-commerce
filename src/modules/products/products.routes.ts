import { Router } from 'express';
import { authRequired } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import { paginationQuery } from '../../lib/pagination';
import { createProductSchema, productIdParam } from './products.schemas';
import * as controller from './products.controller';

const router = Router();

router.post('/', authRequired, validate(createProductSchema), asyncHandler(controller.create));
router.get('/', validate(paginationQuery, 'query'), asyncHandler(controller.list));
router.get('/:id', validate(productIdParam, 'params'), asyncHandler(controller.getOne));

export default router;
