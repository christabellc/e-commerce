# Buckets Tanzania LTD — Social Commerce Backend

A simplified social-commerce backend built for the Buckets Tanzania take-home assignment. It covers authentication, product management, a social feed, real-time 1-to-1 chat, and oversell-safe order processing — plus the bonus Redis caching and rate limiting.

The headline correctness claim (no overselling under concurrency) and the chat status lifecycle are both backed by **runnable tests against a live database**, not just prose. See [Verified behaviour](#verified-behaviour).

---

## Tech stack & why

| Concern | Choice | Reason |
|---|---|---|
| Runtime | Node.js 18+ / TypeScript | Strong typing across the service/controller boundary; ubiquitous. |
| HTTP | Express | Minimal, well understood, easy to review. |
| Database | PostgreSQL (`pg`) | Strong transactional guarantees — essential for the oversell problem. |
| Validation | Zod | Single source of truth for input shape *and* coercion. |
| Auth | JWT (`jsonwebtoken`) + bcrypt | Stateless auth; salted password hashing (cost 12). |
| Real-time | Socket.IO | Rooms map cleanly to per-user delivery; reconnection handled for us. |
| Cache / limits | Redis (`ioredis`) | Atomic counters for rate limiting; TTL cache for the product listing. |

Redis is **optional**: if it is unavailable the API still runs — caching is skipped and rate limiting fails open (logged). This is a deliberate availability trade-off, documented inline in `src/config/redis.ts`.

---

## Project structure

```
backend/
├── docker-compose.yml        # Postgres + Redis for local dev
├── src/
│   ├── server.ts             # HTTP + Socket.IO bootstrap, graceful shutdown
│   ├── app.ts                # Express app, middleware, /health
│   ├── routes.ts             # Mounts all REST modules under /api
│   ├── config/               # env, db pool + transaction helper, redis
│   ├── db/                   # schema.sql, migrate, seed
│   ├── lib/                  # jwt, password, pagination, logger, AppError
│   ├── middleware/           # auth, validate, error, rateLimit
│   └── modules/
│       ├── auth/             # register, login
│       ├── products/         # create / list (cached) / get
│       ├── posts/            # social feed (+ product linkage, pagination)
│       ├── orders/           # transactional, oversell-safe order creation
│       └── chat/             # Socket.IO gateway + persistence service
└── scripts/
    ├── oversell-test.mjs     # 1,000 concurrent buyers vs the last unit
    └── chat-test.mjs         # sent -> delivered -> read over WebSocket
```

The code is organised by **feature module**, each split into `schemas` (validation), `service` (business logic + DB), `controller` (HTTP glue), and `routes`. Business logic never touches `req`/`res`, so it is independently testable.

---

## Setup

### 1. Prerequisites
- Node.js 18+
- Docker (easiest) **or** a local PostgreSQL 14+ and (optional) Redis

### 2. Install
```bash
cd backend
npm install
cp .env.example .env      
```

### 3. Start the database (and Redis) with Docker
```bash
docker compose up -d        # starts postgres on :5432, redis on :6379
```
> No Docker? Point `DATABASE_URL` (and optionally `REDIS_URL`) in `.env` at your own instances.

### 4. Create the schema and seed sample data
```bash
npm run migrate            # applies src/db/schema.sql (idempotent)
npm run seed               # 2 users + 3 products (one with stock = 1)
```
Seeded logins (password `Password123!`): `amani@buckets.co.tz` (seller), `zawadi@buckets.co.tz` (buyer).

### 5. Run
```bash
npm run dev                # hot-reload (tsx)
# or
npm run build && npm start # compiled
```
Server: `http://localhost:4000` — health check at `GET /health`.

---

## Environment variables

See `.env.example` for the full list. Key ones:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | HTTP/WebSocket port |
| `DATABASE_URL` | — | Postgres connection (or use `PG*` vars) |
| `REDIS_URL` | — | Optional; enables cache + rate limiting |
| `JWT_SECRET` | — | **Set a long random value** |
| `JWT_EXPIRES_IN` | `7d` | Token lifetime |
| `PRODUCTS_CACHE_TTL_SECONDS` | `60` | Product-listing cache TTL |
| `RATE_LIMIT_LOGIN_MAX` / `_WINDOW_SECONDS` | `5` / `60` | Login throttle |
| `RATE_LIMIT_ORDER_MAX` / `_WINDOW_SECONDS` | `10` / `60` | Order throttle |

---

## API endpoints

Base path: `/api`. All responses are JSON. Protected routes need `Authorization: Bearer <token>`.

### Auth
| Method | Path | Auth | Body |
|---|---|---|---|
| POST | `/auth/register` | — | `{ name, email, password }` → `{ user, token }` |
| POST | `/auth/login` | — (rate limited) | `{ email, password }` → `{ user, token }` |

### Products
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/products` | ✅ | `{ title, description?, price, stock? }` |
| GET | `/products?page=&limit=` | — | Paginated; **Redis-cached** (`cached: true/false` in payload) |
| GET | `/products/:id` | — | Single product |

### Social feed
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/posts` | ✅ | `{ caption, productId? }` — optional product linkage |
| GET | `/posts?page=&limit=` | — | Paginated feed with author + linked product joined |

### Orders
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/orders` | ✅ (rate limited) | `{ items: [{ productId, quantity }] }` — transactional, oversell-safe |

### Real-time chat (Socket.IO, same origin/port)
Connect with the JWT in the handshake:
```js
const socket = io('http://localhost:4000', { auth: { token } });
```
Events:
| Event | Direction | Payload | Purpose |
|---|---|---|---|
| `message:send` | client → server (ack) | `{ to, body }` | Send a 1-to-1 message; ack returns the persisted message |
| `message:new` | server → client | message object | Incoming message for the recipient |
| `message:status` | server → client | `{ messageId(s), status }` | `delivered` / `read` updates to the sender |
| `message:read` | client → server (ack) | `{ conversationId }` | Mark a conversation read |
| `messages:history` | client → server (ack) | `{ conversationId, page?, limit? }` | Paginated persisted history |

Message status lifecycle: **`sent` → `delivered` → `read`**. Messages are persisted *before* any emit, so they survive restarts and reach users who were offline (flushed and marked `delivered` on reconnect).

Quick curl example:
```bash
TOKEN=$(curl -s localhost:4000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"zawadi@buckets.co.tz","password":"Password123!"}' | npx --yes node -e 'process.stdin.on("data",d=>console.log(JSON.parse(d).token))')
curl -s localhost:4000/api/products | head
```

---

## Design decisions

- **Layered modules.** `schemas → service → controller → routes`. Services contain all logic and DB access and are framework-agnostic, which keeps controllers thin and logic testable.
- **Validation + coercion at the edge** with Zod; the middleware replaces the raw input with the parsed value, so handlers receive correctly typed data (e.g. numeric query params).
- **One transaction helper** (`withTransaction`) owns BEGIN/COMMIT/ROLLBACK and client release, so business code can't leak connections.
- **Errors as data.** `AppError` carries an HTTP status + code; a single error middleware renders a consistent `{ error: { code, message, details } }` shape and maps Postgres unique-violations to `409`.
- **Security touches.** bcrypt cost 12; constant-ish login (always runs a hash compare to avoid user-enumeration timing leaks); `helmet`; JSON body size cap; CORS configurable.
- **Graceful shutdown.** SIGTERM/SIGINT stop accepting connections, close the socket server, and drain the pool.
- **Conversations are the sorted user pair** with a unique constraint, so exactly one conversation exists per pair regardless of who messages first.

### Overselling (summary — full reasoning in `OVERSELLING.md`)
Stock is decremented with a single **atomic, conditional** statement inside a transaction:
```sql
UPDATE products SET stock = stock - $qty
WHERE id = $id AND stock >= $qty;   -- 0 rows affected => reject (insufficient stock)
```
The `stock >= $qty` guard plus the row lock acquired by `UPDATE` means concurrent buyers for the last unit are serialised and only one can win. A `CHECK (stock >= 0)` constraint is a hard database-level backstop. Multi-item orders lock products in a deterministic (sorted) order to avoid deadlocks.

---

## Bonus features

- **Redis caching** of `GET /products` (TTL configurable; invalidated on product create and after stock changes from orders).
- **Rate limiting** on `POST /auth/login` (per IP+email) and `POST /orders` (per user), via atomic Redis counters with a fixed window; emits `X-RateLimit-*` and `Retry-After` headers.

---

## Verified behaviour

Both claims below were checked against a live PostgreSQL instance (scripts included so you can re-run them):

**1. No overselling under load** — `node scripts/oversell-test.mjs`
```
Concurrent attempts : 1000
Succeeded (201)     : 1
Rejected  (409)     : 999
Final stock in DB   : 0
RESULT: PASS — exactly one buyer won, no overselling.
```

**2. Chat status lifecycle** — `node scripts/chat-test.mjs`
```
send ack ok: true | initial status: sent
Statuses Alice received: delivered -> read
RESULT: PASS — sent -> delivered -> read verified.
```
(Both scripts assume the server is running and the DB is migrated + seeded. `scripts/chat-test.mjs` needs `socket.io-client`: `npm i -D socket.io-client`.)

---

## Scripts

| Command | Action |
|---|---|
| `npm run dev` | Run with hot reload |
| `npm run build` / `npm start` | Compile to `dist/` and run |
| `npm run migrate` | Apply the schema |
| `npm run seed` | Insert sample users + products |
| `npm run typecheck` | Type-check without emitting |

---

## What I'd add next (out of scope for 72h)
Refresh-token rotation, an outbox pattern so cache invalidation is transactionally consistent with order commits, idempotency keys on `POST /orders`, structured request tracing, and a proper integration test suite (the scripts here are smoke/load checks).
