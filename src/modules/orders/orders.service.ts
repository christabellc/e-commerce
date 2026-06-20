import { PoolClient } from 'pg';
import { withTransaction } from '../../config/db';
import { AppError } from '../../lib/AppError';
import { invalidateListCache } from '../products/products.service';
import { CreateOrderInput } from './orders.schemas';

interface ProductLock {
  id: string;
  title: string;
  price: string;
}

/**
 * Create an order while guaranteeing stock is never oversold.
 *
 * Strategy (see OVERSELLING.md for the full reasoning):
 *   1. Everything runs inside ONE database transaction.
 *   2. Stock is decremented with a single ATOMIC, CONDITIONAL update:
 *          UPDATE products SET stock = stock - $qty
 *          WHERE id = $id AND stock >= $qty
 *      The `stock >= $qty` guard means two concurrent buyers competing for the
 *      last unit cannot both succeed: the row lock serialises them, and the
 *      loser's UPDATE matches zero rows.
 *   3. A CHECK (stock >= 0) constraint is a hard backstop at the storage layer.
 *   4. Items are processed in a deterministic order (sorted by productId) so
 *      concurrent multi-item orders acquire locks in the same order and cannot
 *      deadlock.
 */
export async function createOrder(buyerId: string, input: CreateOrderInput) {
  // Merge duplicate product lines, then sort for deadlock-free lock ordering.
  const merged = new Map<string, number>();
  for (const item of input.items) {
    merged.set(item.productId, (merged.get(item.productId) ?? 0) + item.quantity);
  }
  const items = [...merged.entries()]
    .map(([productId, quantity]) => ({ productId, quantity }))
    .sort((a, b) => (a.productId < b.productId ? -1 : 1));

  return withTransaction(async (client: PoolClient) => {
    let total = 0;
    const lines: { productId: string; quantity: number; unitPrice: string; title: string }[] = [];

    for (const { productId, quantity } of items) {
      const updated = await client.query<ProductLock>(
        `UPDATE products
            SET stock = stock - $1, updated_at = now()
          WHERE id = $2 AND stock >= $1
        RETURNING id, title, price`,
        [quantity, productId]
      );

      if (updated.rowCount === 0) {
        // Disambiguate: missing product vs. insufficient stock.
        const exists = await client.query<{ stock: number; title: string }>(
          'SELECT stock, title FROM products WHERE id = $1',
          [productId]
        );
        if (exists.rowCount === 0) {
          throw AppError.notFound(`Product ${productId} not found`);
        }
        throw AppError.conflict(
          `Insufficient stock for "${exists.rows[0].title}" (requested ${quantity}, available ${exists.rows[0].stock})`,
          { productId, requested: quantity, available: exists.rows[0].stock }
        );
      }

      const row = updated.rows[0];
      const unitPrice = row.price;
      total += Number(unitPrice) * quantity;
      lines.push({ productId, quantity, unitPrice, title: row.title });
    }

    const orderRes = await client.query<{ id: string; created_at: string }>(
      `INSERT INTO orders (buyer_id, status, total)
       VALUES ($1, 'confirmed', $2)
       RETURNING id, created_at`,
      [buyerId, total.toFixed(2)]
    );
    const order = orderRes.rows[0];

    for (const line of lines) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price)
         VALUES ($1, $2, $3, $4)`,
        [order.id, line.productId, line.quantity, line.unitPrice]
      );
    }

    // Stock changed -> let the product cache invalidate (best effort, outside tx semantics).
    void invalidateListCache();

    return {
      id: order.id,
      status: 'confirmed' as const,
      total: total.toFixed(2),
      createdAt: order.created_at,
      items: lines.map((l) => ({
        productId: l.productId,
        title: l.title,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
      })),
    };
  });
}
