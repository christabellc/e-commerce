import { z } from 'zod';

/** Shared cursor-free (offset) pagination contract used by feeds and listings. */
export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type Pagination = z.infer<typeof paginationQuery>;

export function toOffset(p: Pagination) {
  return { limit: p.limit, offset: (p.page - 1) * p.limit };
}

export function buildMeta(page: number, limit: number, total: number) {
  return {
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    hasNext: page * limit < total,
  };
}
