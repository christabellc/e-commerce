# Written Question: Preventing Overselling Under High Concurrency

> **If 1,000 users attempt to buy the last product simultaneously, how would you prevent overselling?**

## 1. Where overselling actually comes from

Overselling is a **race condition** on shared mutable state (`stock`). The classic broken pattern is a read-modify-write split across two statements:

```sql
SELECT stock FROM products WHERE id = $1;   -- 1,000 requests all read stock = 1
-- (application checks stock >= 1 → true for all of them)
UPDATE products SET stock = stock - 1 WHERE id = $1;  -- all 1,000 decrement
```

Every request reads `1`, every request believes it may proceed, and the final stock becomes `-999`: we sold 1,000 of a 1-unit item. The window between the read and the write is the bug. The fix is to make the **check-and-decrement a single atomic, serialised operation**, so only one request can observe and consume the last unit.

## 2. The approach I implemented

I rely on PostgreSQL to do the serialisation, inside one transaction, using a single conditional update:

```sql
BEGIN;

UPDATE products
   SET stock = stock - $qty
 WHERE id = $product_id
   AND stock >= $qty          -- the guard: only succeeds if enough stock remains
RETURNING id, price;
-- rowCount = 1 → reserved successfully
-- rowCount = 0 → insufficient stock (or product missing) → reject with 409, ROLLBACK

-- ... insert order + order_items using the returned price ...

COMMIT;
```

Why this is correct under 1,000 concurrent requests:

1. **Row-level locking.** When a transaction runs `UPDATE ... WHERE id = $x`, Postgres takes an exclusive lock on that row. The other 999 transactions **queue** behind it. They do not all run at once against a stale value — they run one after another against the *current* value.
2. **The `stock >= $qty` guard is re-evaluated per transaction.** The first transaction sets stock `1 → 0` and commits. The next transaction acquires the lock, sees `stock = 0`, its `WHERE` no longer matches, and the `UPDATE` affects **zero rows**. The application treats zero rows as "insufficient stock" and rejects with `409 Conflict`, rolling back.
3. **Exactly one winner.** Only the transaction that flips the last unit gets `rowCount = 1`; the other 999 get `rowCount = 0`. No negative stock, no double-sell.

This is essentially **optimistic concurrency expressed as a conditional write** — there is no separate `SELECT` to race against, because the condition and the mutation are the same statement.

### Defence in depth
- **`CHECK (stock >= 0)` constraint.** Even if application logic were ever wrong, the database physically refuses to store negative stock — the write fails and the transaction aborts. The race-safe `UPDATE` is the primary mechanism; the constraint is the seatbelt.
- **Deterministic lock ordering for multi-item orders.** When an order contains several products, I sort the line items by `productId` before locking. Two concurrent orders touching products A and B therefore always lock A then B (never A-then-B vs B-then-A), which eliminates deadlocks.
- **Whole order is one transaction.** If any single item can't be fulfilled, the entire order rolls back — no partial reservations left behind.

This is verified, not just asserted: `scripts/oversell-test.mjs` fires 1,000 concurrent `POST /orders` at a stock-1 product and reproducibly yields **1 success, 999 rejections, final stock 0**.

## 3. Alternatives and trade-offs

| Strategy | How | When to prefer | Cost |
|---|---|---|---|
| **Atomic conditional UPDATE** (chosen) | `UPDATE ... WHERE stock >= qty` | General case; simple and correct | Brief row-lock contention under extreme load |
| **`SELECT ... FOR UPDATE`** | Pessimistically lock the row, then check + update | When you need to run logic between read and write | Same locking; slightly more verbose |
| **Optimistic version column** | `... WHERE version = $v`; retry on 0 rows | Low contention, dislike of locks | Requires retry logic; wasteful under high contention |
| **Redis atomic decrement** | `DECR` / Lua reserve, reconcile to DB | Flash-sale spikes (10k+ rps on one SKU) | Needs DB↔Redis reconciliation and care on failures |
| **Queue / single-writer** | Serialise orders for a SKU through a queue | Extreme contention, want backpressure | More moving parts, added latency |

## 4. How this scales beyond 1,000

For one product, 1,000 contenders is comfortably handled by row locking — the test runs in a few seconds. Contention is per-row, so unrelated products never block each other. If a single SKU faced **tens of thousands of simultaneous buyers** (a true flash sale), the hot-row lock becomes the bottleneck and I would put a layer in front of the database:

1. **Redis reservation.** Preload the unit count into Redis and reserve with an atomic `DECR` (or a small Lua script). `DECR` is single-threaded and atomic, so it admits exactly N winners instantly and rejects the rest at the edge — the database only ever sees the ~N requests that already hold a reservation.
2. **Reconcile to Postgres** for the durable order record, still inside a transaction with the same conditional update as the authoritative source of truth.
3. **Idempotency keys** on `POST /orders` so client retries (common during spikes) don't create duplicate orders.
4. **Backpressure / queue** if write volume still exceeds what the DB can absorb, smoothing the burst rather than thundering-herding the row.

The key principle stays constant at every scale: **the check and the decrement must be a single atomic step that the system serialises** — whether that step is a guarded SQL `UPDATE` or an atomic Redis `DECR`. Everything else is about moving that step to the right layer for the load.
