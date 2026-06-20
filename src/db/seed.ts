import { pool, closePool } from '../config/db';
import { hashPassword } from '../lib/password';
import { logger } from '../lib/logger';

/**
 * Seeds two users and a few products so the chat/order/feed endpoints have
 * something to act on immediately. Safe to run repeatedly (ON CONFLICT).
 */
async function main() {
  const pw = await hashPassword('Password123!');

  const users = [
    { name: 'Amani Seller', email: 'amani@buckets.co.tz' },
    { name: 'Zawadi Buyer', email: 'zawadi@buckets.co.tz' },
  ];

  const userIds: Record<string, string> = {};
  for (const u of users) {
    const res = await pool.query(
      `INSERT INTO users (name, email, password_hash) VALUES ($1,$2,$3)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, email`,
      [u.name, u.email, pw]
    );
    userIds[res.rows[0].email] = res.rows[0].id;
  }

  const sellerId = userIds['amani@buckets.co.tz'];
  const products = [
    { title: 'Kanga Cloth (Pair)', price: 25000, stock: 50, desc: 'Hand-printed cotton kanga.' },
    { title: 'Zanzibar Spice Box', price: 18000, stock: 1, desc: 'Limited single-unit spice set.' },
    { title: 'Tingatinga Canvas', price: 120000, stock: 8, desc: 'Original Tingatinga painting.' },
  ];

  for (const p of products) {
    await pool.query(
      `INSERT INTO products (seller_id, title, description, price, stock)
       VALUES ($1,$2,$3,$4,$5)`,
      [sellerId, p.title, p.desc, p.price, p.stock]
    );
  }

  logger.info('Seed complete', {
    note: 'Login with amani@buckets.co.tz / zawadi@buckets.co.tz, password "Password123!"',
  });
  await closePool();
}

main().catch(async (err) => {
  logger.error('Seed failed', { error: err instanceof Error ? err.message : String(err) });
  await closePool();
  process.exit(1);
});
