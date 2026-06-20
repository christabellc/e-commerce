import { z } from 'zod';

export const createPostSchema = z.object({
  caption: z.string().trim().min(1, 'Caption is required').max(2200),
  // Optional product linkage — a post can showcase a product.
  productId: z.string().uuid('Invalid product id').optional(),
});

export type CreatePostInput = z.infer<typeof createPostSchema>;
