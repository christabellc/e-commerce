import { z } from 'zod';

export const createOrderSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().uuid('Invalid product id'),
        quantity: z.coerce.number().int().positive('Quantity must be >= 1'),
      })
    )
    .min(1, 'An order needs at least one item')
    .max(50),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
