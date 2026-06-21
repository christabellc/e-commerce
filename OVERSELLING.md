# Written Question: Preventing Overselling Under High Concurrency

> **If 1,000 users attempt to buy the last product simultaneously, how would you prevent overselling?**

## 1. Where overselling actually comes from

Overselling is a **race condition** on shared mutable state (`stock`). The classic broken pattern is a read-modify-write split across two statements:

```sql
SELECT stock FROM products WHERE id = $1;   -- 1,000 requests all read stock = 1
-- (application checks stock >= 1 → true for all of them)
UPDATE products SET stock = stock - 1 WHERE id = $1;  -- all 1,000 decrement
```

Preventing Overselling Under High Concurrency

If 1,000 users try to buy the last item at the same time, the main risk is multiple requests reading the same stock before it's updated.

I prevent this by handling the order inside a single database transaction with an atomic stock update:

UPDATE products
SET stock = stock - 1
WHERE id = $1 AND stock > 0;

If the update affects one row, the stock is reserved and the order is created. If no rows are updated, the product is already out of stock, so the request is rejected.

Since the database locks the row during the update, concurrent requests are processed safely. Only one request can purchase the last item, while the rest receive an "Out of Stock" response. This guarantees stock never becomes negative and prevents overselling.

If the update affects one row, the stock is reserved and the order is created. If no rows are updated, the product is already out of stock, so the request is rejected.

Since the database locks the row during the update, concurrent requests are processed safely. Only one request can purchase the last item, while the rest receive an "Out of Stock" response. This guarantees stock never becomes negative and prevents overselling.
