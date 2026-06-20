import { z } from 'zod';

export const createProductSchema = z.object({
  title: z.string().trim().min(2).max(140),
  description: z.string().trim().max(2000).default(''),
  price: z.coerce.number().nonnegative('Price must be >= 0'),
  stock: z.coerce.number().int().min(0, 'Stock must be >= 0').default(0),
});

export const productIdParam = z.object({
  id: z.string().uuid('Invalid product id'),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
